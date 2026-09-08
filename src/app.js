import {
  POSITIONS,
  currentRosterNeeds,
  deriveDraftState,
  nextMyPick,
  roundForPick,
  searchAvailable,
  teamOnClock,
} from './engine.js';
import {
  byeConflicts,
  fillLineup,
  planPick,
  playerPpg,
  playoffOutlook,
  playoffSlate,
  setMatchups,
} from './planner.js';
import {
  applyPick,
  clearState,
  createInitialState,
  deletePick,
  exportState,
  importState,
  loadState,
  normalizeSettings,
  replacePick,
  saveState,
  undoPick,
} from './state.js';

const elements = Object.fromEntries(
  [
    'pickNumber', 'roundNumber', 'onClock', 'nextPick', 'hero', 'recommendations',
    'positionFilters', 'availableList', 'searchInput', 'roster', 'rosterNeeds',
    'quickSearch', 'quickForm', 'quickResults', 'quickClear', 'quickHint',
    'boardSection', 'availableSection', 'planSection', 'planTitle', 'planValue', 'planStrip', 'outlook',
    'byeConflicts', 'logFilter',
    'recentPicks', 'undoBtn', 'settingsBtn', 'settingsDialog', 'teamsSelect',
    'roundsInput', 'slotSelect', 'settingsForm', 'myTeamTitle', 'rosterCount',
    'exportBtn', 'importBtn', 'importInput', 'resetBtn', 'dataSnapshot', 'toast',
    'fixDialog', 'fixTitle', 'fixCurrent', 'fixOwnerOpponent', 'fixOwnerMe', 'fixSearch', 'fixResults',
    'fixDelete', 'fixClose',
  ].map((id) => [id, document.getElementById(id)]),
);

let players = [];
let metadata = {};
let state;
let positionFilter = 'ALL';
let actionLocked = false;
let fixingPick = null;

initialize();

async function initialize() {
  try {
    let matchups;
    [players, metadata, matchups] = await Promise.all([
      fetch('data/players.json').then(requireSuccessfulResponse).then((response) => response.json()),
      fetch('data/metadata.json').then(requireSuccessfulResponse).then((response) => response.json()),
      fetch('data/matchups.json').then((response) => (response.ok ? response.json() : null)).catch(() => null),
    ]);
    setMatchups(matchups);
    const playerIds = new Set(players.map((player) => player.id));
    state = loadState(localStorage, playerIds);
    bindEvents();
    renderFilters();
    render();
    registerServiceWorker();
  } catch (error) {
    elements.hero.innerHTML = `<div class="empty-state"><strong>Unable to load the draft board.</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function requireSuccessfulResponse(response) {
  if (!response.ok) throw new Error(`Data request failed (${response.status})`);
  return response;
}

function bindEvents() {
  document.addEventListener('click', handleActionClick);
  elements.searchInput.addEventListener('input', renderAvailable);
  elements.quickSearch.addEventListener('input', renderQuick);
  elements.quickForm.addEventListener('submit', takeTopQuickMatch);
  elements.quickClear.addEventListener('click', clearQuickSearch);
  elements.undoBtn.addEventListener('click', () => updateState(undoPick(state), 'Last pick restored'));
  elements.settingsBtn.addEventListener('click', openSettings);
  elements.teamsSelect.addEventListener('change', populateSlots);
  elements.settingsForm.addEventListener('submit', applySettings);
  elements.exportBtn.addEventListener('click', downloadState);
  elements.importBtn.addEventListener('click', () => elements.importInput.click());
  elements.importInput.addEventListener('change', uploadState);
  elements.resetBtn.addEventListener('click', resetDraft);
  elements.logFilter.addEventListener('change', () => renderRecent(deriveDraftState(players, state, normalizeSettings(state.settings))));
  elements.fixSearch.addEventListener('input', renderFixResults);
  elements.fixDelete.addEventListener('click', deleteFixingPick);
  elements.fixClose.addEventListener('click', () => elements.fixDialog.close());
  elements.fixDialog.addEventListener('close', () => { fixingPick = null; });
  elements.fixDialog.addEventListener('click', (event) => {
    if (event.target === elements.fixDialog) elements.fixDialog.close();
  });
}

function handleActionClick(event) {
  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) {
    positionFilter = filterButton.dataset.filter;
    renderFilters();
    renderAvailable();
    return;
  }

  const fixButton = event.target.closest('[data-fix-pick]');
  if (fixButton) {
    openFixDialog(Number(fixButton.dataset.fixPick));
    return;
  }
  const ownerButton = event.target.closest('[data-fix-owner]');
  if (ownerButton && fixingPick !== null) {
    correctPick(null, ownerButton.dataset.fixOwner);
    return;
  }
  const replaceButton = event.target.closest('[data-replace-player]');
  if (replaceButton && fixingPick !== null) {
    correctPick(replaceButton.dataset.replacePlayer, null);
    return;
  }

  const actionButton = event.target.closest('[data-player-id][data-owner]');
  if (!actionButton || actionLocked) return;
  const playerId = actionButton.dataset.playerId;
  const owner = actionButton.dataset.owner;
  const player = players.find((candidate) => candidate.id === playerId);
  if (!player) return;

  actionLocked = true;
  try {
    if (actionButton.closest('#quickResults')) elements.quickSearch.value = '';
    updateState(
      applyPick(state, playerId, owner),
      owner === 'ME' ? `${player.name} added to my team` : `${player.name} marked taken`,
    );
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionLocked = false;
  }
}

function updateState(nextState, message = '') {
  state = nextState;
  saveState(localStorage, state);
  render();
  if (message) showToast(message);
}

function render() {
  const settings = normalizeSettings(state.settings);
  const derived = deriveDraftState(players, state, settings);
  const maxPick = settings.teams * settings.rounds;
  const draftComplete = state.pickNumber > maxPick;
  const plan = draftComplete ? null : planPick(players, state, settings, 9);
  const onClock = draftComplete ? null : teamOnClock(state.pickNumber, settings.teams);
  const upcoming = draftComplete
    ? null
    : nextMyPick(state.pickNumber, settings.mySlot, settings.teams, settings.rounds);

  elements.pickNumber.textContent = draftComplete ? `${maxPick} / ${maxPick}` : state.pickNumber;
  elements.roundNumber.textContent = draftComplete
    ? settings.rounds
    : roundForPick(state.pickNumber, settings.teams);
  elements.onClock.textContent = draftComplete
    ? 'Complete'
    : onClock === settings.mySlot ? 'My team' : `Team ${onClock}`;
  elements.onClock.classList.toggle('mine', onClock === settings.mySlot);
  elements.nextPick.textContent = upcoming ?? '—';
  elements.undoBtn.disabled = state.events.length === 0;
  elements.myTeamTitle.textContent = `Draft slot ${settings.mySlot}`;
  elements.rosterCount.textContent = `${derived.myIds.length} / ${settings.rounds}`;
  elements.dataSnapshot.textContent = `Data snapshot ${formatDate(metadata.snapshotDate)} · ${metadata.playerCount ?? players.length} players`;

  renderHero(plan, draftComplete);
  renderPlan(plan, draftComplete);
  renderQuick();
  renderRecommendations(plan?.candidates.slice(1) ?? [], plan?.best?.total ?? 0);
  renderAvailable();
  renderRoster(derived);
  renderRecent(derived);
}

function renderHero(plan, draftComplete) {
  if (draftComplete) {
    elements.hero.innerHTML = '<div class="empty-state"><strong>Draft complete</strong><span>Your full draft is saved on this device.</span></div>';
    return;
  }
  const result = plan?.best;
  if (!result) {
    elements.hero.innerHTML = '<div class="empty-state"><strong>No eligible recommendations</strong><span>Check the remaining player pool or undo the last pick.</span></div>';
    return;
  }

  const { player } = result;
  const baseline = plan.baseline;
  const beatsBaseline = baseline && baseline.player.id !== player.id && result.total - baseline.total >= 0.5;
  const label = plan.onClock
    ? `YOUR PICK · ${plan.futurePicks.length} PICKS PLANNED AHEAD`
    : `TARGET FOR YOUR PICK #${plan.currentPick}`;
  elements.hero.innerHTML = `
    <div class="hero-label">${label}</div>
    <div class="hero-main">
      <div>
        <div class="player-heading">
          <span class="position-badge ${player.position.toLowerCase()}">${player.position}</span>
          <div>
            <h2>${escapeHtml(player.name)}</h2>
            <p>${escapeHtml(player.team)} · ${formatNumber(playerPpg(player))} ppg · bye ${player.bye ?? '—'} · ${player.position}${player.positionRank} · ADP ${formatNumber(player.adp)}</p>
          </div>
        </div>
        <div class="reason-chips">${result.reasons.filter((reason) => !/chance still there|playoff slate/.test(reason)).map((reason) => `<span class="${/same bye|stacked/.test(reason) ? 'warn' : ''}">${escapeHtml(reason)}</span>`).join('')}</div>
        ${renderPlayoffSlate(player)}
        ${renderAvailabilityNote(player)}
      </div>
      <div class="score-block">
        <span>Roster pts</span>
        <strong>${Math.round(result.total)}</strong>
        <em class="value-label ${(result.v31?.label ?? 'plan').toLowerCase()}">${result.v31?.label ?? 'PLAN'}</em>
      </div>
    </div>
    <div class="hero-footer">
      <span>${plan.onClock
        ? `<strong>${Math.round(result.nextGone * 100)}%</strong> gone before your next turn`
        : `<strong>${Math.round((1 - result.reachGone) * 100)}%</strong> chance still there at #${plan.currentPick}`}${beatsBaseline ? ` · beats best-available <strong>${escapeHtml(baseline.player.name)}</strong> by ${Math.max(1, Math.round(result.total - baseline.total))} pts` : ''}</span>
      <div class="hero-actions">
        <button class="button draft-button" data-player-id="${player.id}" data-owner="ME" type="button">Draft ${escapeHtml(player.name)}</button>
        <button class="button taken-button" data-player-id="${player.id}" data-owner="OPPONENT" type="button">Taken</button>
      </div>
    </div>
  `;
}

function renderPlan(plan, draftComplete) {
  if (draftComplete || !plan?.best) {
    elements.planSection.hidden = true;
    return;
  }
  elements.planSection.hidden = false;
  const picks = plan.best.plan.picks;
  elements.planTitle.textContent = plan.onClock
    ? `After ${plan.best.player.name}, your next ${picks.length} picks`
    : `If you land ${plan.best.player.name} at #${plan.currentPick}`;
  elements.planValue.textContent = `${Math.round(plan.currentValue)} → ${Math.round(plan.best.total)} pts`;
  elements.planStrip.innerHTML = picks.length
    ? picks.map((pick) => `
      <div class="plan-step ${pick.starter ? 'starter' : ''}">
        <span>R${pick.round} · #${pick.pick}</span>
        <strong class="pos-${pick.position.toLowerCase()}">${pick.position === 'DEPTH' ? 'Depth' : pick.position}</strong>
        <em>${pick.expectedPpg ? `~${pick.expectedPpg.toFixed(1)} ppg` : 'best value'}</em>
      </div>
    `).join('')
    : '<p class="muted plan-empty">This is your final pick.</p>';

  const rows = ['QB', 'RB', 'WR', 'TE'].map((position) => {
    const outlook = plan.outlook[position];
    if (!outlook.bestNow) return '';
    const drop = outlook.nowPpg - outlook.nextPpg;
    return `
      <div class="outlook-row">
        <span class="position-badge small ${position.toLowerCase()}">${position}</span>
        <div class="outlook-now"><strong>${escapeHtml(outlook.bestNow.name)}</strong><small>${formatNumber(outlook.nowPpg)} ppg now · ${Math.round(outlook.bestNowGone * 100)}% gone by #${plan.futurePicks[0] ?? '—'}</small></div>
        <div class="outlook-next ${drop >= 2 ? 'cliff' : ''}"><strong>~${formatNumber(outlook.nextPpg)}</strong><small>expected at your next pick</small></div>
      </div>
    `;
  }).join('');
  elements.outlook.innerHTML = plan.futurePicks.length
    ? `<div class="outlook-head">What the room leaves you</div>${rows}`
    : '';
}

function quickMatches() {
  const query = elements.quickSearch.value;
  if (!query.trim()) return [];
  const derived = deriveDraftState(players, state, normalizeSettings(state.settings));
  return searchAvailable(derived.available, query);
}

function renderQuick() {
  const searching = elements.quickSearch.value.trim().length > 0;
  elements.quickClear.hidden = !searching;
  elements.quickResults.hidden = !searching;
  elements.boardSection.hidden = searching;
  elements.availableSection.hidden = searching;
  if (!searching) {
    elements.quickResults.innerHTML = '';
    elements.quickHint.textContent = 'Press return to mark the top match taken.';
    return;
  }

  const matches = quickMatches();
  if (!matches.length) {
    elements.quickHint.textContent = 'No available player matches that search.';
    elements.quickResults.innerHTML = '<div class="empty-state compact"><span>Already off the board or misspelled.</span></div>';
    return;
  }

  elements.quickHint.textContent = `Return marks ${matches[0].name} taken.`;
  elements.quickResults.innerHTML = matches.map((player) => `
    <article class="available-row quick-row">
      <span class="position-badge ${player.position.toLowerCase()}">${player.position}</span>
      <div class="player-summary">
        <div><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.team)} · ${player.position}${player.positionRank}</span></div>
        <small>V3.1 #${player.v31Rank} · ADP ${formatNumber(player.adp)}</small>
        ${renderAvailabilityNote(player)}
      </div>
      <div class="row-actions quick-actions">
        <button class="button taken-button" data-player-id="${player.id}" data-owner="OPPONENT" type="button">Taken</button>
        <button class="button draft-small" data-player-id="${player.id}" data-owner="ME" type="button">Mine</button>
      </div>
    </article>
  `).join('');
}

function takeTopQuickMatch(event) {
  event.preventDefault();
  const [top] = quickMatches();
  if (!top) {
    showToast('No available player matches that search', true);
    return;
  }
  elements.quickSearch.value = '';
  try {
    updateState(applyPick(state, top.id, 'OPPONENT'), `${top.name} marked taken`);
  } catch (error) {
    showToast(error.message, true);
  }
}

function clearQuickSearch() {
  elements.quickSearch.value = '';
  renderQuick();
  elements.quickSearch.focus();
}

function renderRecommendations(results, bestTotal) {
  if (!results.length) {
    elements.recommendations.innerHTML = '<p class="muted">No alternatives remain.</p>';
    return;
  }
  elements.recommendations.innerHTML = results.map((result, index) => {
    const { player } = result;
    const diff = Math.round(result.total - bestTotal);
    return `
      <article class="recommendation-row">
        <span class="rank-number">${index + 2}</span>
        <div class="player-summary">
          <div><strong>${escapeHtml(player.name)}</strong><span>${player.position} · ${escapeHtml(player.team)} · ${formatNumber(playerPpg(player))} ppg · bye ${player.bye ?? '—'} · ADP ${formatNumber(player.adp)}</span></div>
          <small>${escapeHtml(result.reasons.join(' · '))}</small>
          ${renderAvailabilityNote(player)}
        </div>
        <div class="compact-score"><strong>${Math.round(result.total)}</strong><span>${diff === 0 ? 'even' : `${diff} pts`}</span></div>
        <div class="row-actions">
          <button class="button draft-small" data-player-id="${player.id}" data-owner="ME" type="button">Draft</button>
          <button class="button taken-small" data-player-id="${player.id}" data-owner="OPPONENT" type="button">Taken</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderFilters() {
  elements.positionFilters.innerHTML = ['ALL', ...POSITIONS].map((position) => `
    <button type="button" data-filter="${position}" class="${positionFilter === position ? 'active' : ''}">${position}</button>
  `).join('');
}

function renderAvailable() {
  if (!state || !players.length) return;
  const derived = deriveDraftState(players, state, normalizeSettings(state.settings));
  const query = elements.searchInput.value.trim().toLowerCase();
  const visible = derived.available
    .filter((player) => positionFilter === 'ALL' || player.position === positionFilter)
    .filter((player) => !query || `${player.name} ${player.team} ${player.position}`.toLowerCase().includes(query))
    .sort((a, b) => a.v31Rank - b.v31Rank || a.adp - b.adp)
    .slice(0, 100);

  if (!visible.length) {
    elements.availableList.innerHTML = '<div class="empty-state compact"><span>No matching available players.</span></div>';
    return;
  }
  elements.availableList.innerHTML = visible.map((player) => `
    <article class="available-row ${player.status !== 'ACTIVE' ? 'unavailable-status' : ''}">
      <span class="position-badge ${player.position.toLowerCase()}">${player.position}</span>
      <div class="player-summary">
        <div><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.team)} · ${player.position}${player.positionRank}</span></div>
        <small>V3.1 #${player.v31Rank} · ADP ${formatNumber(player.adp)} · Tier ${player.tier}${player.status !== 'ACTIVE' ? ` · ${player.status}` : ''}</small>
        ${renderAvailabilityNote(player)}
      </div>
      <div class="row-actions">
        <button class="button draft-small" data-player-id="${player.id}" data-owner="ME" type="button">Draft</button>
        <button class="button taken-small" data-player-id="${player.id}" data-owner="OPPONENT" type="button">Taken</button>
      </div>
    </article>
  `).join('');
}

function renderRoster(derived) {
  const settings = normalizeSettings(state.settings);
  const needs = currentRosterNeeds(derived.myCounts, settings);
  elements.rosterNeeds.innerHTML = needs.length
    ? needs.map((need) => `<span>${need}</span>`).join('')
    : '<span class="complete">Starter needs covered</span>';

  const rosterPlayers = derived.myIds.map((id) => derived.playersById[id]).filter(Boolean);
  const conflicts = byeConflicts(rosterPlayers);
  elements.byeConflicts.innerHTML = conflicts.length
    ? conflicts.map((conflict) => `
      <span class="${conflict.samePosition.length ? 'warn' : ''}">Bye ${conflict.bye}: ${conflict.players.map((player) => player.position).join('/')}${conflict.samePosition.length ? ` — ${conflict.samePosition.join('/')} doubled` : ''}</span>
    `).join('')
    : '';
  if (!rosterPlayers.length) {
    elements.roster.innerHTML = '<p class="muted">Your selections will appear here.</p>';
    return;
  }
  const lineup = fillLineup(rosterPlayers, settings);
  const row = (slot, player) => {
    const playoffs = playoffOutlook(player);
    return `
    <div class="lineup-row">
      <span>${slot}</span>
      <strong>${escapeHtml(player.name)} <small>${escapeHtml(player.team)} · ${player.position}</small></strong>
      <em>${formatNumber(playerPpg(player))} ppg · bye ${player.bye ?? '—'}${playoffs ? `<b class="playoff-tag ${playoffs.label}" title="Weeks 15-17: ${escapeHtml(playoffSlate(playoffs))}">PO ${playoffs.label}</b>` : ''}</em>
    </div>
  `;
  };
  elements.roster.innerHTML = `
    ${lineup.starters.map((starter) => row(starter.slot, starter.player)).join('')}
    ${lineup.openSlots.map((slot) => `<div class="lineup-row open"><span>${slot.slot}</span><strong>Open</strong><em></em></div>`).join('')}
    ${lineup.bench.length ? `<div class="lineup-divider">Bench</div>${lineup.bench.map((player) => row('BN', player)).join('')}` : ''}
  `;
}

function renderRecent(derived) {
  const filter = elements.logFilter.value;
  const settings = normalizeSettings(state.settings);
  const teamOptions = Array.from({ length: settings.teams }, (_, index) => index + 1)
    .filter((team) => team !== settings.mySlot)
    .map((team) => `<option value="${team}">Team ${team}</option>`).join('');
  if (elements.logFilter.options.length !== settings.teams + 1) {
    elements.logFilter.innerHTML = `<option value="ALL">All teams</option><option value="ME">My team</option>${teamOptions}`;
    elements.logFilter.value = ['ALL', 'ME'].includes(filter) || Number(filter) <= settings.teams ? filter : 'ALL';
  }
  const active = elements.logFilter.value;
  const events = state.events
    .filter((event) => active === 'ALL'
      || (active === 'ME' ? event.owner === 'ME' : (event.owner !== 'ME' && event.teamIndex === Number(active))))
    .reverse();
  if (!events.length) {
    elements.recentPicks.innerHTML = '<p class="muted">No picks registered yet.</p>';
    return;
  }
  elements.recentPicks.innerHTML = events.map((event) => {
    const player = derived.playersById[event.playerId];
    return `
      <div class="recent-row ${event.owner === 'ME' ? 'mine' : ''}">
        <span>R${event.round} · #${event.pick}</span>
        <strong>${escapeHtml(player?.name ?? event.playerId)} <small>${player ? `${player.position} · ${escapeHtml(player.team)}` : ''}</small></strong>
        <em>${event.owner === 'ME' ? 'MY TEAM' : `TEAM ${event.teamIndex}`}</em>
        <button class="button fix-button" type="button" data-fix-pick="${event.pick}" aria-label="Fix pick ${event.pick}">Fix</button>
      </div>
    `;
  }).join('');
}

function openFixDialog(pick) {
  const event = state.events.find((candidate) => candidate.pick === pick);
  if (!event) return;
  fixingPick = pick;
  elements.fixSearch.value = '';
  renderFixDialog();
  elements.fixDialog.showModal();
  elements.fixSearch.focus();
}

function renderFixDialog() {
  const event = state.events.find((candidate) => candidate.pick === fixingPick);
  if (!event) {
    elements.fixDialog.close();
    return;
  }
  const player = players.find((candidate) => candidate.id === event.playerId);
  elements.fixTitle.textContent = `Round ${event.round} · Pick #${event.pick}`;
  elements.fixCurrent.textContent = `${player?.name ?? event.playerId} · ${event.owner === 'ME' ? 'my team' : `Team ${event.teamIndex}`}`;
  elements.fixOwnerOpponent.classList.toggle('active', event.owner === 'OPPONENT');
  elements.fixOwnerMe.classList.toggle('active', event.owner === 'ME');
  renderFixResults();
}

function renderFixResults() {
  const query = elements.fixSearch.value;
  if (!query.trim()) {
    elements.fixResults.innerHTML = '<p class="muted fix-hint">Search for the player who was really picked here, or switch who picked.</p>';
    return;
  }
  const derived = deriveDraftState(players, state, normalizeSettings(state.settings));
  const matches = searchAvailable(derived.available, query);
  if (!matches.length) {
    elements.fixResults.innerHTML = '<p class="muted fix-hint">No available player matches that search.</p>';
    return;
  }
  elements.fixResults.innerHTML = matches.slice(0, 6).map((player) => `
    <button class="fix-result" type="button" data-replace-player="${player.id}">
      <span class="position-badge small ${player.position.toLowerCase()}">${player.position}</span>
      <strong>${escapeHtml(player.name)}</strong>
      <small>${escapeHtml(player.team)} · ADP ${formatNumber(player.adp)}</small>
    </button>
  `).join('');
}

function correctPick(playerId, owner) {
  const event = state.events.find((candidate) => candidate.pick === fixingPick);
  if (!event) return;
  try {
    const nextPlayerId = playerId ?? event.playerId;
    const nextOwner = owner ?? event.owner;
    if (nextPlayerId === event.playerId && nextOwner === event.owner) return;
    const player = players.find((candidate) => candidate.id === nextPlayerId);
    updateState(
      replacePick(state, fixingPick, nextPlayerId, nextOwner),
      `Pick #${fixingPick} now ${player?.name ?? nextPlayerId} (${nextOwner === 'ME' ? 'my team' : 'opponent'})`,
    );
    if (playerId) elements.fixDialog.close();
    else renderFixDialog();
  } catch (error) {
    showToast(error.message, true);
  }
}

function deleteFixingPick() {
  const event = state.events.find((candidate) => candidate.pick === fixingPick);
  if (!event) return;
  const player = players.find((candidate) => candidate.id === event.playerId);
  if (!window.confirm(`Delete pick #${event.pick} (${player?.name ?? event.playerId})? Later picks move up one spot.`)) return;
  try {
    updateState(deletePick(state, fixingPick), `Pick #${fixingPick} deleted`);
    elements.fixDialog.close();
  } catch (error) {
    showToast(error.message, true);
  }
}

function openSettings() {
  const settings = normalizeSettings(state.settings);
  elements.teamsSelect.value = settings.teams;
  elements.roundsInput.value = settings.rounds;
  populateSlots();
  elements.slotSelect.value = settings.mySlot;
  elements.settingsDialog.showModal();
}

function populateSlots() {
  const teams = Number(elements.teamsSelect.value);
  const current = Number(elements.slotSelect.value) || state?.settings.mySlot || 1;
  elements.slotSelect.innerHTML = Array.from(
    { length: teams },
    (_, index) => `<option value="${index + 1}">${index + 1}</option>`,
  ).join('');
  elements.slotSelect.value = Math.min(current, teams);
}

function applySettings(event) {
  event.preventDefault();
  if (state.events.length && !window.confirm('Reset this draft and apply new league settings?')) return;
  const settings = normalizeSettings({
    ...state.settings,
    teams: Number(elements.teamsSelect.value),
    rounds: Number(elements.roundsInput.value),
    mySlot: Number(elements.slotSelect.value),
  });
  elements.settingsDialog.close();
  updateState(createInitialState(settings), 'League settings applied');
}

function downloadState() {
  const blob = new Blob([exportState(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `fantasy-draft-state-pick-${state.pickNumber}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast('Draft state exported');
}

async function uploadState() {
  const [file] = elements.importInput.files;
  if (!file) return;
  try {
    const nextState = importState(await file.text(), new Set(players.map((player) => player.id)));
    updateState(nextState, 'Draft state imported');
  } catch (error) {
    showToast(`Import failed: ${error.message}`, true);
  } finally {
    elements.importInput.value = '';
  }
}

function resetDraft() {
  if (!window.confirm('Clear every registered pick and start over?')) return;
  clearState(localStorage);
  state = createInitialState(state.settings);
  saveState(localStorage, state);
  render();
  showToast('Draft reset');
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.add('visible');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => elements.toast.classList.remove('visible'), 2200);
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1).replace('.0', '') : '—';
}

function formatDate(value) {
  if (!value) return 'unknown';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(value));
}

function renderPlayoffSlate(player) {
  const playoffs = playoffOutlook(player);
  if (!playoffs) return '';
  return `<small class="playoff-slate"><strong>Playoffs (wk 15-17):</strong> ${escapeHtml(playoffSlate(playoffs))} <b class="playoff-tag ${playoffs.label}">${playoffs.label}</b></small>`;
}

function renderAvailabilityNote(player) {
  if (!player.availabilityNotes?.length) return '';
  return `<small class="availability-note"><strong>Availability:</strong> ${escapeHtml(player.availabilityNotes.join(' · '))}</small>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register('service-worker.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {});
  }
}
