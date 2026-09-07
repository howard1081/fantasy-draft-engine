import {
  POSITIONS,
  currentRosterNeeds,
  deriveDraftState,
  nextMyPick,
  recommend,
  roundForPick,
  searchAvailable,
  teamOnClock,
} from './engine.js';
import {
  applyPick,
  clearState,
  createInitialState,
  exportState,
  importState,
  loadState,
  normalizeSettings,
  saveState,
  undoPick,
} from './state.js';

const elements = Object.fromEntries(
  [
    'pickNumber', 'roundNumber', 'onClock', 'nextPick', 'hero', 'recommendations',
    'positionFilters', 'availableList', 'searchInput', 'roster', 'rosterNeeds',
    'quickSearch', 'quickForm', 'quickResults', 'quickClear', 'quickHint',
    'boardSection', 'availableSection',
    'recentPicks', 'undoBtn', 'settingsBtn', 'settingsDialog', 'teamsSelect',
    'roundsInput', 'slotSelect', 'settingsForm', 'myTeamTitle', 'rosterCount',
    'exportBtn', 'importBtn', 'importInput', 'resetBtn', 'dataSnapshot', 'toast',
  ].map((id) => [id, document.getElementById(id)]),
);

let players = [];
let metadata = {};
let state;
let positionFilter = 'ALL';
let actionLocked = false;

initialize();

async function initialize() {
  try {
    [players, metadata] = await Promise.all([
      fetch('data/players.json').then(requireSuccessfulResponse).then((response) => response.json()),
      fetch('data/metadata.json').then(requireSuccessfulResponse).then((response) => response.json()),
    ]);
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
}

function handleActionClick(event) {
  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) {
    positionFilter = filterButton.dataset.filter;
    renderFilters();
    renderAvailable();
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
  const recommendations = draftComplete ? [] : recommend(players, state, settings, 9);
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

  renderHero(recommendations[0], draftComplete);
  renderQuick();
  renderRecommendations(recommendations.slice(1));
  renderAvailable();
  renderRoster(derived);
  renderRecent(derived);
}

function renderHero(result, draftComplete) {
  if (draftComplete) {
    elements.hero.innerHTML = '<div class="empty-state"><strong>Draft complete</strong><span>Your full draft is saved on this device.</span></div>';
    return;
  }
  if (!result) {
    elements.hero.innerHTML = '<div class="empty-state"><strong>No eligible recommendations</strong><span>Check the remaining player pool or undo the last pick.</span></div>';
    return;
  }

  const { player } = result;
  elements.hero.innerHTML = `
    <div class="hero-label">BEST AVAILABLE PICK</div>
    <div class="hero-main">
      <div>
        <div class="player-heading">
          <span class="position-badge ${player.position.toLowerCase()}">${player.position}</span>
          <div>
            <h2>${escapeHtml(player.name)}</h2>
            <p>${escapeHtml(player.team)} · V3.1 #${player.v31Rank} · ${player.position}${player.positionRank} · ADP ${formatNumber(player.adp)}</p>
          </div>
        </div>
        <div class="reason-chips">${result.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
        ${renderAvailabilityNote(player)}
      </div>
      <div class="score-block">
        <span>Dynamic score</span>
        <strong>${result.score.toFixed(1)}</strong>
        <em class="value-label ${result.label.toLowerCase()}">${result.label}</em>
      </div>
    </div>
    <div class="hero-footer">
      <span><strong>${Math.round(result.gone * 100)}%</strong> projected gone before next turn</span>
      <div class="hero-actions">
        <button class="button draft-button" data-player-id="${player.id}" data-owner="ME" type="button">Draft ${escapeHtml(player.name)}</button>
        <button class="button taken-button" data-player-id="${player.id}" data-owner="OPPONENT" type="button">Taken</button>
      </div>
    </div>
  `;
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

function renderRecommendations(results) {
  if (!results.length) {
    elements.recommendations.innerHTML = '<p class="muted">No alternatives remain.</p>';
    return;
  }
  elements.recommendations.innerHTML = results.map((result, index) => {
    const { player } = result;
    return `
      <article class="recommendation-row">
        <span class="rank-number">${index + 2}</span>
        <div class="player-summary">
          <div><strong>${escapeHtml(player.name)}</strong><span>${player.position} · ${escapeHtml(player.team)} · ADP ${formatNumber(player.adp)}</span></div>
          <small>${escapeHtml(result.reasons.join(' · '))}</small>
          ${renderAvailabilityNote(player)}
        </div>
        <div class="compact-score"><strong>${result.score.toFixed(1)}</strong><span>${result.label}</span></div>
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
  if (!rosterPlayers.length) {
    elements.roster.innerHTML = '<p class="muted">Your selections will appear here.</p>';
    return;
  }
  elements.roster.innerHTML = POSITIONS.map((position) => {
    const atPosition = rosterPlayers.filter((player) => player.position === position);
    if (!atPosition.length) return '';
    return `
      <div class="roster-group">
        <span>${position}</span>
        <div>${atPosition.map((player) => `<strong>${escapeHtml(player.name)} <small>${escapeHtml(player.team)}</small></strong>`).join('')}</div>
      </div>
    `;
  }).join('');
}

function renderRecent(derived) {
  const recent = state.events.slice(-10).reverse();
  if (!recent.length) {
    elements.recentPicks.innerHTML = '<p class="muted">No picks registered yet.</p>';
    return;
  }
  elements.recentPicks.innerHTML = recent.map((event) => {
    const player = derived.playersById[event.playerId];
    return `
      <div class="recent-row">
        <span>#${event.pick}</span>
        <strong>${escapeHtml(player?.name ?? event.playerId)}</strong>
        <em>${event.owner === 'ME' ? 'MY TEAM' : `TEAM ${event.teamIndex}`}</em>
      </div>
    `;
  }).join('');
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
