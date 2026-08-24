export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];

export const DEFAULT_SETTINGS = Object.freeze({
  teams: 12,
  rounds: 16,
  mySlot: 1,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 },
  bench: 6,
  kDstStartRound: 13,
});

const REPLACEMENT_ANCHORS = { QB: 14, RB: 34, WR: 39, TE: 14, DST: 13, K: 13 };
const STARTER_TARGETS = { QB: 1, RB: 2, WR: 2, TE: 1, DST: 1, K: 1 };

export function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function roundForPick(pickNumber, teams = 12) {
  return Math.floor((pickNumber - 1) / teams) + 1;
}

export function teamOnClock(pickNumber, teams = 12) {
  const round = roundForPick(pickNumber, teams);
  const inRound = (pickNumber - 1) % teams;
  return round % 2 === 1 ? inRound + 1 : teams - inRound;
}

export function myPickNumbers(slot, teams = 12, rounds = 16) {
  const picks = [];
  for (let round = 1; round <= rounds; round += 1) {
    const start = (round - 1) * teams;
    const within = round % 2 === 1 ? slot : teams - slot + 1;
    picks.push(start + within);
  }
  return picks;
}

export function nextMyPick(currentPick, slot, teams = 12, rounds = 16, strictlyAfter = false) {
  return myPickNumbers(slot, teams, rounds)
    .find((pick) => strictlyAfter ? pick > currentPick : pick >= currentPick) ?? null;
}

export function recommendationHorizon(pickNumber, settings) {
  const onClock = teamOnClock(pickNumber, settings.teams);
  return nextMyPick(
    pickNumber,
    settings.mySlot,
    settings.teams,
    settings.rounds,
    onClock === settings.mySlot,
  );
}

export function countPositions(playersById, ids) {
  const counts = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  for (const id of ids) {
    const player = playersById[id];
    if (player) counts[player.position] += 1;
  }
  return counts;
}

export function deriveDraftState(players, state, settings = DEFAULT_SETTINGS) {
  const playersById = Object.fromEntries(players.map((player) => [player.id, player]));
  const draftedIds = new Set(state.events.map((event) => event.playerId));
  const teamRosters = Object.fromEntries(
    Array.from({ length: settings.teams }, (_, index) => [index + 1, []]),
  );

  for (const event of state.events) {
    const teamIndex = event.owner === 'ME' ? settings.mySlot : event.teamIndex;
    if (teamRosters[teamIndex]) teamRosters[teamIndex].push(event.playerId);
  }

  const myIds = teamRosters[settings.mySlot] ?? [];
  const teamCounts = Object.fromEntries(
    Object.entries(teamRosters).map(([team, ids]) => [team, countPositions(playersById, ids)]),
  );

  return {
    playersById,
    draftedIds,
    available: players.filter((player) => !draftedIds.has(player.id)),
    teamRosters,
    teamCounts,
    myIds,
    myCounts: countPositions(playersById, myIds),
  };
}

function flexCount(counts) {
  const excessRb = Math.max(0, counts.RB - STARTER_TARGETS.RB);
  const excessWr = Math.max(0, counts.WR - STARTER_TARGETS.WR);
  const excessTe = Math.max(0, counts.TE - STARTER_TARGETS.TE);
  return excessRb + excessWr + excessTe;
}

export function rosterNeedScore(position, counts, round, settings = DEFAULT_SETTINGS) {
  const target = settings.starters[position] ?? STARTER_TARGETS[position] ?? 0;
  const deficit = Math.max(0, target - (counts[position] ?? 0));
  let score = 48 + deficit * 22;

  if (position === 'RB' || position === 'WR') {
    const flexOpen = flexCount(counts) < settings.starters.FLEX;
    score += flexOpen ? 8 : 0;
    score += clamp(11 - round, 0, 10) * 0.8;
  }

  if (position === 'TE' && counts.TE === 0) score += round >= 5 ? 5 : 2;
  if (position === 'QB' && counts.QB === 0) score += round >= 5 ? 8 : 0;
  if ((position === 'DST' || position === 'K') && counts[position] === 0 && round >= settings.kDstStartRound) {
    score += 30;
  }
  if (position === 'QB' && counts.QB >= 1 && round < 11) score -= 46;
  if (position === 'TE' && counts.TE >= 1 && round < 11) score -= 26;
  if ((position === 'DST' || position === 'K') && round < settings.kDstStartRound) score -= 80;

  return clamp(score);
}

export function adpValueScore(player, pickNumber) {
  const adp = player.adp ?? pickNumber;
  const sd = player.adpSd ?? Math.max(6, adp * 0.14);
  const valueZ = (pickNumber - adp) / Math.max(4, sd);
  return clamp(50 + valueZ * 18);
}

export function reachPenalty(player, pickNumber) {
  const adp = player.adp ?? pickNumber;
  const sd = player.adpSd ?? Math.max(6, adp * 0.14);
  return clamp((adp - pickNumber - Math.max(5, sd * 0.5)) * 0.55, 0, 18);
}

export function goneProbability(player, currentPick, nextPick, demandMultiplier = 1) {
  if (!nextPick || nextPick <= currentPick) return 0.98;
  const adp = player.adp ?? currentPick;
  const sd = player.adpSd ?? Math.max(7, adp * 0.14);
  const z = (nextPick - adp) / Math.max(4, sd);
  const cdfApproximation = 1 / (1 + Math.exp(-1.7 * z));
  const gap = nextPick - currentPick;
  const gapPressure = Math.min(0.18, gap * 0.008);
  return clamp((cdfApproximation + gapPressure) * demandMultiplier, 0.02, 0.98);
}

function bestProjection(players) {
  return players.reduce(
    (best, player) => Math.max(best, player.projectionValue ?? Math.max(0, 101 - player.v31Rank)),
    0,
  );
}

export function tierCliffScore(player, availableAtPosition) {
  const currentTier = availableAtPosition.filter((candidate) => candidate.tier === player.tier);
  const laterTiers = availableAtPosition
    .filter((candidate) => candidate.tier > player.tier)
    .sort((a, b) => a.tier - b.tier || b.projectionValue - a.projectionValue);

  if (!laterTiers.length) return currentTier.length <= 2 ? 68 : 56;
  const nextTierNumber = laterTiers[0].tier;
  const nextTier = laterTiers.filter((candidate) => candidate.tier === nextTierNumber);
  const cliff = Math.max(0, bestProjection(currentTier) - bestProjection(nextTier));
  const availabilityPressure = currentTier.length <= 2 ? 16 : currentTier.length <= 4 ? 7 : 0;
  return clamp(45 + cliff * 4 + availabilityPressure);
}

export function replacementProjection(position, available) {
  const pool = available
    .filter((player) => player.position === position && player.status === 'ACTIVE')
    .sort((a, b) => b.projectionValue - a.projectionValue || a.v31Rank - b.v31Rank);
  if (!pool.length) return 0;
  const anchor = Math.min(pool.length - 1, Math.max(0, REPLACEMENT_ANCHORS[position] - 1));
  return pool[anchor].projectionValue ?? 0;
}

export function vorpScore(player, available) {
  const replacement = replacementProjection(player.position, available);
  const projection = player.projectionValue ?? Math.max(0, 101 - player.v31Rank);
  return clamp(50 + (projection - replacement) * 2.4);
}

function teamsPickingBetween(currentPick, nextPick, settings) {
  if (!nextPick) return [];
  const teams = [];
  for (let pick = currentPick + 1; pick < nextPick; pick += 1) {
    teams.push(teamOnClock(pick, settings.teams));
  }
  return teams;
}

function teamPositionDemand(position, counts, round, settings) {
  if (position === 'QB') {
    if (counts.QB === 0 && round >= 5) return 1.35;
    if (counts.QB >= 1 && round < 10) return 0.25;
  }
  if (position === 'TE') {
    if (counts.TE === 0 && round >= 4) return 1.25;
    if (counts.TE >= 1 && round < 10) return 0.4;
  }
  if (position === 'RB' || position === 'WR') {
    const target = settings.starters[position];
    if (counts[position] < target) return 1.25;
    if (counts.RB + counts.WR < 6) return 1.08;
  }
  if (position === 'DST' || position === 'K') {
    return round >= settings.kDstStartRound ? (counts[position] ? 0.15 : 1.2) : 0.1;
  }
  return 0.8;
}

export function demandMultipliers(state, derived, settings = DEFAULT_SETTINGS) {
  const round = roundForPick(state.pickNumber, settings.teams);
  const nextPick = recommendationHorizon(state.pickNumber, settings);
  const teams = teamsPickingBetween(state.pickNumber, nextPick, settings);
  const recentEvents = state.events.slice(-8);
  const recentCounts = countPositions(
    derived.playersById,
    recentEvents.map((event) => event.playerId),
  );
  const multipliers = {};

  for (const position of POSITIONS) {
    const opponentDemand = teams.length
      ? teams.reduce((sum, team) => {
        const counts = derived.teamCounts[team] ?? {};
        return sum + teamPositionDemand(position, counts, round, settings);
      }, 0) / teams.length
      : 1;
    const runPressure = Math.min(0.3, Math.max(0, recentCounts[position] - 2) * 0.08);
    multipliers[position] = clamp(0.72 + opponentDemand * 0.28 + runPressure, 0.65, 1.45);
  }

  return multipliers;
}

function saturationPenalty(position, counts, round) {
  if (position === 'QB') {
    if (counts.QB >= 2) return round < 13 ? 32 : 38;
    if (counts.QB >= 1) return round < 11 ? 18 : 15;
  }
  if (position === 'TE') {
    if (counts.TE >= 2) return round < 13 ? 22 : 26;
    if (counts.TE >= 1) return round < 11 ? 10 : 8;
  }
  if (position === 'RB') return Math.max(0, counts.RB - 5) * 4;
  if (position === 'WR') return Math.max(0, counts.WR - 6) * 4;
  if (position === 'DST' || position === 'K') return counts[position] >= 1 ? 35 : 0;
  return 0;
}

function riskConcentrationPenalty(player, myPlayers) {
  if ((player.risk ?? 25) <= 50) return 0;
  const highRiskAtPosition = myPlayers.filter(
    (candidate) => candidate.position === player.position && (candidate.risk ?? 25) > 50,
  ).length;
  return Math.min(8, highRiskAtPosition * 2 + ((player.risk ?? 25) - 50) * 0.08);
}

function stackModifier(player, myPlayers) {
  const sameTeam = myPlayers.filter((candidate) => candidate.team === player.team);
  if (player.position === 'QB' && sameTeam.some((candidate) => ['WR', 'TE'].includes(candidate.position))) {
    return 1.5;
  }
  if (['WR', 'TE'].includes(player.position) && sameTeam.some((candidate) => candidate.position === 'QB')) {
    return 1.5;
  }
  if (player.position === 'RB' && sameTeam.some((candidate) => candidate.position === 'RB')) {
    return 0.8;
  }
  return 0;
}

function byeOverlapPenalty(player, myPlayers) {
  if (!player.bye) return 0;
  const overlap = myPlayers.filter(
    (candidate) => candidate.bye === player.bye && candidate.position === player.position,
  ).length;
  return Math.min(1.2, overlap * 0.4);
}

export function scorePlayer(player, context) {
  if (player.status !== 'ACTIVE' || context.derived.draftedIds.has(player.id)) {
    return { score: -Infinity, breakdown: null };
  }

  const { state, settings, derived, demandByPosition, nextPick } = context;
  const round = roundForPick(state.pickNumber, settings.teams);
  const positionPool = derived.available.filter(
    (candidate) => candidate.position === player.position && candidate.status === 'ACTIVE',
  );
  const myPlayers = derived.myIds.map((id) => derived.playersById[id]).filter(Boolean);
  const gone = goneProbability(
    player,
    state.pickNumber,
    nextPick,
    demandByPosition[player.position],
  );
  const breakdown = {
    projection: clamp(player.projectionValue ?? Math.max(0, 101 - player.v31Rank)),
    vorp: vorpScore(player, derived.available),
    rosterNeed: rosterNeedScore(player.position, derived.myCounts, round, settings),
    tierCliff: tierCliffScore(player, positionPool),
    adpValue: adpValueScore(player, state.pickNumber),
    goneBeforeNextPick: gone * 100,
    flexibility: ['RB', 'WR', 'TE'].includes(player.position) ? 62 : 45,
    upside: clamp(player.upside ?? 50),
  };
  const penalties = {
    saturation: saturationPenalty(player.position, derived.myCounts, round),
    reach: reachPenalty(player, state.pickNumber),
    riskConcentration: riskConcentrationPenalty(player, myPlayers),
    byeOverlap: byeOverlapPenalty(player, myPlayers),
    timing: ['DST', 'K'].includes(player.position) && round < settings.kDstStartRound ? 100 : 0,
  };
  const modifiers = {
    stack: stackModifier(player, myPlayers),
  };

  const score = (
    0.34 * breakdown.projection
    + 0.18 * breakdown.vorp
    + 0.12 * breakdown.rosterNeed
    + 0.10 * breakdown.tierCliff
    + 0.10 * breakdown.adpValue
    + 0.08 * breakdown.goneBeforeNextPick
    + 0.04 * breakdown.flexibility
    + 0.04 * breakdown.upside
    - penalties.saturation
    - penalties.reach
    - penalties.riskConcentration
    - penalties.byeOverlap
    - penalties.timing
    + modifiers.stack
  );

  return { score, gone, breakdown, penalties, modifiers };
}

function valueLabel(result) {
  if (result.score >= 78 || result.breakdown.adpValue >= 72) return 'TARGET';
  if (result.penalties.reach >= 10 && result.gone < 0.45) return 'WAIT';
  if (result.score < 45) return 'AVOID';
  return 'FAIR';
}

function buildReasons(player, result, round, settings) {
  const reasons = [];
  const { breakdown, penalties, gone } = result;
  if (breakdown.tierCliff >= 64) reasons.push(`${player.position} tier cliff`);
  if (breakdown.rosterNeed >= 72) reasons.push(`${player.position} roster need`);
  if (breakdown.adpValue >= 68) reasons.push('value fall');
  if (gone >= 0.68) reasons.push(`${Math.round(gone * 100)}% chance gone`);
  if (breakdown.vorp >= 72) reasons.push('strong value over replacement');
  if (breakdown.upside >= 82 && round >= 9) reasons.push('late-round upside');
  if (penalties.reach >= 10) reasons.push('likely available later');
  if ((player.position === 'DST' || player.position === 'K') && round < settings.kDstStartRound) {
    reasons.push('late-round position');
  }
  if (!reasons.length) reasons.push('best projection and roster fit');
  return reasons.slice(0, 3);
}

export function recommend(players, state, settings = DEFAULT_SETTINGS, limit = 8) {
  const derived = deriveDraftState(players, state, settings);
  const nextPick = recommendationHorizon(state.pickNumber, settings);
  const demandByPosition = demandMultipliers(state, derived, settings);
  const context = { state, settings, derived, nextPick, demandByPosition };
  const round = roundForPick(state.pickNumber, settings.teams);

  return derived.available
    .map((player) => {
      const result = scorePlayer(player, context);
      return {
        player,
        ...result,
        label: Number.isFinite(result.score) ? valueLabel(result) : 'AVOID',
        reasons: Number.isFinite(result.score) ? buildReasons(player, result, round, settings) : [],
      };
    })
    .filter((result) => Number.isFinite(result.score))
    .sort((a, b) => (
      b.score - a.score
      || a.player.v31Rank - b.player.v31Rank
      || a.player.name.localeCompare(b.player.name)
    ))
    .slice(0, limit);
}

export function currentRosterNeeds(counts, settings = DEFAULT_SETTINGS) {
  const needs = [];
  for (const position of POSITIONS) {
    const target = settings.starters[position] ?? 0;
    const missing = Math.max(0, target - (counts[position] ?? 0));
    if (missing) needs.push(`${position} ×${missing}`);
  }
  if (flexCount(counts) < settings.starters.FLEX) needs.push('FLEX ×1');
  return needs;
}
