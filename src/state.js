import { DEFAULT_SETTINGS, roundForPick, teamOnClock } from './engine.js';

export const STORAGE_KEY = 'fantasy-draft-engine-v1';
export const STATE_VERSION = 1;

export function normalizeSettings(settings = {}) {
  const teams = [10, 12, 14, 16].includes(Number(settings.teams)) ? Number(settings.teams) : 12;
  const rounds = Math.max(10, Math.min(20, Number(settings.rounds) || 16));
  const mySlot = Math.max(1, Math.min(teams, Number(settings.mySlot) || 1));
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    teams,
    rounds,
    mySlot,
    starters: { ...DEFAULT_SETTINGS.starters, ...(settings.starters ?? {}) },
  };
}

export function createInitialState(settings = DEFAULT_SETTINGS) {
  return {
    version: STATE_VERSION,
    settings: normalizeSettings(settings),
    pickNumber: 1,
    events: [],
    updatedAt: Date.now(),
  };
}

function opponentTeamForPick(pickNumber, settings) {
  const onClock = teamOnClock(pickNumber, settings.teams);
  if (onClock !== settings.mySlot) return onClock;

  const maxPick = settings.teams * settings.rounds;
  const adjacentPicks = [pickNumber - 1, pickNumber + 1]
    .filter((pick) => pick >= 1 && pick <= maxPick);
  for (const pick of adjacentPicks) {
    const team = teamOnClock(pick, settings.teams);
    if (team !== settings.mySlot) return team;
  }
  return settings.mySlot === 1 ? 2 : 1;
}

export function applyPick(state, playerId, owner) {
  if (!['ME', 'OPPONENT'].includes(owner)) throw new Error('Invalid draft owner');
  if (state.events.some((event) => event.playerId === playerId)) {
    throw new Error('Player has already been drafted');
  }
  const settings = normalizeSettings(state.settings);
  const maxPick = settings.teams * settings.rounds;
  if (state.pickNumber > maxPick) throw new Error('Draft is complete');
  const onClock = teamOnClock(state.pickNumber, settings.teams);
  const teamIndex = owner === 'ME'
    ? settings.mySlot
    : opponentTeamForPick(state.pickNumber, settings);
  const event = {
    pick: state.pickNumber,
    round: roundForPick(state.pickNumber, settings.teams),
    teamIndex,
    playerId,
    owner,
    timestamp: Date.now(),
  };
  return {
    ...state,
    settings,
    pickNumber: state.pickNumber + 1,
    events: [...state.events, event],
    updatedAt: Date.now(),
  };
}

export function undoPick(state) {
  if (!state.events.length) return state;
  const events = state.events.slice(0, -1);
  const removed = state.events[state.events.length - 1];
  return {
    ...state,
    pickNumber: removed.pick,
    events,
    updatedAt: Date.now(),
  };
}

export function deletePick(state, pick) {
  const index = state.events.findIndex((event) => event.pick === pick);
  if (index === -1) throw new Error(`Pick ${pick} is not in the draft log`);
  const events = state.events.filter((_, position) => position !== index);
  return validateState({ ...state, events });
}

export function replacePick(state, pick, playerId, owner = null) {
  const index = state.events.findIndex((event) => event.pick === pick);
  if (index === -1) throw new Error(`Pick ${pick} is not in the draft log`);
  if (owner !== null && !['ME', 'OPPONENT'].includes(owner)) throw new Error('Invalid draft owner');
  if (state.events.some((event) => event.playerId === playerId && event.pick !== pick)) {
    throw new Error('Player has already been drafted');
  }
  const events = state.events.map((event, position) => (
    position === index
      ? { ...event, playerId, owner: owner ?? event.owner, timestamp: Date.now() }
      : event
  ));
  return validateState({ ...state, events });
}

export function validateState(candidate, playerIds = null) {
  if (!candidate || typeof candidate !== 'object') throw new Error('Draft state must be an object');
  const settings = normalizeSettings(candidate.settings);
  if (!Array.isArray(candidate.events)) throw new Error('Draft state events are missing');
  const seen = new Set();
  const maxPick = settings.teams * settings.rounds;
  const events = candidate.events.map((event, index) => {
    if (!event || typeof event.playerId !== 'string') throw new Error(`Invalid event ${index + 1}`);
    if (seen.has(event.playerId)) throw new Error(`Duplicate drafted player: ${event.playerId}`);
    if (playerIds && !playerIds.has(event.playerId)) throw new Error(`Unknown player: ${event.playerId}`);
    seen.add(event.playerId);
    const pick = index + 1;
    return {
      pick,
      round: roundForPick(pick, settings.teams),
      teamIndex: event.owner === 'ME'
        ? settings.mySlot
        : opponentTeamForPick(pick, settings),
      playerId: event.playerId,
      owner: event.owner === 'ME' ? 'ME' : 'OPPONENT',
      timestamp: Number(event.timestamp) || Date.now(),
    };
  });
  if (events.length > maxPick) throw new Error('Draft state exceeds configured rounds');
  return {
    version: STATE_VERSION,
    settings,
    pickNumber: events.length + 1,
    events,
    updatedAt: Date.now(),
  };
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadState(storage, playerIds = null) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return createInitialState();
  try {
    return validateState(JSON.parse(raw), playerIds);
  } catch {
    return createInitialState();
  }
}

export function clearState(storage) {
  storage.removeItem(STORAGE_KEY);
}

export function exportState(state) {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    app: 'Fantasy Draft Engine V1',
    state,
  }, null, 2);
}

export function importState(json, playerIds = null) {
  const parsed = JSON.parse(json);
  return validateState(parsed.state ?? parsed, playerIds);
}
