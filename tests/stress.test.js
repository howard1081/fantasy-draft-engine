import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  POSITIONS,
  deriveDraftState,
  demandMultipliers,
  goneProbability,
  myPickNumbers,
  recommend,
  roundForPick,
  searchAvailable,
  teamOnClock,
  tierCliffScore,
} from '../src/engine.js';
import {
  applyPick,
  createInitialState,
  loadState,
  saveState,
  undoPick,
  validateState,
} from '../src/state.js';

const REAL_PLAYERS = JSON.parse(
  readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'),
);

const P = (id, pos, rank, adp, {
  tier = 1, projection = 90, status = 'ACTIVE', team = 'X', upside = 80, risk = 20, adpSd = 6,
} = {}) => ({
  id,
  name: id,
  team,
  position: pos,
  v31Rank: rank,
  positionRank: rank,
  tier,
  projectionValue: projection,
  adp,
  adpSd,
  upside,
  risk,
  status,
});

const settingsFor = (mySlot, extra = {}) => ({ ...DEFAULT_SETTINGS, mySlot, ...extra });

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function stateAt(pickNumber, events) {
  return { version: 1, settings: DEFAULT_SETTINGS, pickNumber, events, updatedAt: 0 };
}

const ev = (pick, playerId, owner, teamIndex) => ({
  pick, round: roundForPick(pick, 12), teamIndex, playerId, owner, timestamp: 0,
});

/* ------------------------------------------------------------------ *
 * 1. Snake math for every slot
 * ------------------------------------------------------------------ */
test('snake math is consistent for 12-team and 16-team drafts over 16 rounds', () => {
  assert.deepEqual(myPickNumbers(1, 12, 4), [1, 24, 25, 48]);
  assert.deepEqual(myPickNumbers(6, 12, 4), [6, 19, 30, 43]);
  assert.deepEqual(myPickNumbers(12, 12, 4), [12, 13, 36, 37]);
  assert.deepEqual(myPickNumbers(1, 16, 4), [1, 32, 33, 64]);
  assert.deepEqual(myPickNumbers(16, 16, 4), [16, 17, 48, 49]);

  for (const teams of [12, 16]) {
    const seen = new Set();
    for (let slot = 1; slot <= teams; slot += 1) {
      const picks = myPickNumbers(slot, teams, 16);
      assert.equal(picks.length, 16, `slot ${slot} should own 16 picks`);
      for (const pick of picks) {
        assert.equal(teamOnClock(pick, teams), slot, `pick ${pick} should belong to slot ${slot}`);
        assert.ok(!seen.has(pick), `pick ${pick} claimed twice`);
        seen.add(pick);
      }
    }
    assert.equal(seen.size, teams * 16);
  }
});

/* ------------------------------------------------------------------ *
 * 2. Availability: Taken / Draft / HOLD / OUT
 * ------------------------------------------------------------------ */
test('TAKEN removes a player from every recommendation list and the pool', () => {
  // slot 5 so that pick 1 belongs to an opponent
  const settings = settingsFor(5);
  const state0 = createInitialState(settings);
  const target = recommend(REAL_PLAYERS, state0, settings, 9)[0].player;
  const state1 = applyPick(state0, target.id, 'OPPONENT');

  const derived = deriveDraftState(REAL_PLAYERS, state1, settings);
  assert.ok(!derived.available.some((p) => p.id === target.id));
  assert.equal(derived.myIds.length, 0, 'TAKEN must not enter my roster');
  assert.equal(state1.events[0].teamIndex, 1, 'pick 1 belongs to team 1');
  assert.equal(state1.pickNumber, 2);

  for (let pick = 2; pick <= 40; pick += 1) {
    const probe = { ...state1, pickNumber: pick };
    assert.ok(
      !recommend(REAL_PLAYERS, probe, settings, 9).some((r) => r.player.id === target.id),
      `taken player resurfaced at pick ${pick}`,
    );
  }
  assert.throws(() => applyPick(state1, target.id, 'ME'), /already been drafted/);
});

test('a TAKEN pick made while I am on the clock must not join my roster', () => {
  const settings = settingsFor(1); // pick 1 is my own clock
  const state = applyPick(createInitialState(settings), REAL_PLAYERS[0].id, 'OPPONENT');
  const derived = deriveDraftState(REAL_PLAYERS, state, settings);
  assert.equal(
    derived.myIds.length,
    0,
    'marking a player TAKEN on my own clock incorrectly credits them to my roster',
  );
});

test('DRAFT adds the player to my roster and removes them from the pool', () => {
  const settings = settingsFor(4);
  const state0 = createInitialState(settings);
  const target = REAL_PLAYERS.find((p) => p.status === 'ACTIVE');
  const state1 = applyPick(state0, target.id, 'ME');
  const derived = deriveDraftState(REAL_PLAYERS, state1, settings);
  assert.deepEqual(derived.myIds, [target.id]);
  assert.equal(derived.teamRosters[4].length, 1, 'ME picks land on my slot regardless of clock');
  assert.ok(!derived.available.some((p) => p.id === target.id));
});

test('HOLD and OUT players are never recommended, even when best in class', () => {
  const players = [
    P('elite-hold', 'RB', 1, 1, { projection: 100, status: 'HOLD' }),
    P('elite-out', 'WR', 2, 2, { projection: 100, status: 'OUT' }),
    P('active-rb', 'RB', 3, 3, { projection: 70 }),
    P('active-wr', 'WR', 4, 4, { projection: 68 }),
  ];
  const recs = recommend(players, createInitialState(settingsFor(1)), settingsFor(1), 9);
  assert.deepEqual(recs.map((r) => r.player.id).sort(), ['active-rb', 'active-wr']);

  // Real pool: the committed HOLD player must never surface across a whole first round.
  const hold = REAL_PLAYERS.filter((p) => p.status === 'HOLD').map((p) => p.id);
  assert.ok(hold.length > 0, 'fixture should contain at least one HOLD player');
  for (let pick = 1; pick <= 24; pick += 1) {
    const recs2 = recommend(REAL_PLAYERS, stateAt(pick, []), settingsFor(1), 9);
    for (const id of hold) {
      assert.ok(!recs2.some((r) => r.player.id === id), `HOLD ${id} recommended at pick ${pick}`);
    }
  }
});

test('draft-night snapshot is unique, deep enough, and applies reviewed availability', () => {
  assert.equal(new Set(REAL_PLAYERS.map((player) => player.id)).size, REAL_PLAYERS.length);
  assert.equal(new Set(REAL_PLAYERS.map((player) => player.name.toLowerCase())).size, REAL_PLAYERS.length);
  assert.ok(
    REAL_PLAYERS.filter((player) => player.status === 'ACTIVE').length >= 16 * 16,
    '16-team x 16-round drafts require at least 256 ACTIVE players',
  );

  const byName = Object.fromEntries(REAL_PLAYERS.map((player) => [player.name, player]));
  assert.equal(byName['Josh Jacobs'].status, 'HOLD');
  assert.equal(byName['Ashton Jeanty'].status, 'ACTIVE');
  assert.equal(byName['Ashton Jeanty'].v31Rank, 22);
  assert.ok(byName['Zach Charbonnet'].risk >= 80);
  assert.ok(byName['Tank Dell'].risk >= 80);
});

/* ------------------------------------------------------------------ *
 * 3. Undo: exactness, localStorage recovery, bounded chains
 * ------------------------------------------------------------------ */
test('undo restores exact pick number, availability, my roster and opponent rosters', () => {
  const settings = settingsFor(3);
  let state = createInitialState(settings);
  const snapshot = (s) => JSON.stringify({
    pickNumber: s.pickNumber,
    events: s.events,
    derived: (() => {
      const d = deriveDraftState(REAL_PLAYERS, s, settings);
      return { my: d.myIds, teams: d.teamRosters, avail: d.available.length };
    })(),
  });

  const ids = REAL_PLAYERS.slice(0, 6).map((p) => p.id);
  for (const [i, id] of ids.entries()) {
    state = applyPick(state, id, i === 2 ? 'ME' : 'OPPONENT');
  }
  const before = snapshot(state);
  const withExtra = applyPick(state, REAL_PLAYERS[10].id, 'ME');
  assert.notEqual(snapshot(withExtra), before);
  assert.equal(snapshot(undoPick(withExtra)), before, 'undo must be an exact inverse');

  // Own player accidentally marked TAKEN -> undo -> correct DRAFT (chaos test 5)
  const mistaken = applyPick(state, REAL_PLAYERS[11].id, 'OPPONENT');
  const corrected = applyPick(undoPick(mistaken), REAL_PLAYERS[11].id, 'ME');
  const cd = deriveDraftState(REAL_PLAYERS, corrected, settings);
  assert.ok(cd.myIds.includes(REAL_PLAYERS[11].id));
  assert.equal(corrected.pickNumber, mistaken.pickNumber);
  assert.equal(corrected.events.length, mistaken.events.length);
});

test('undo on an empty draft is a no-op and 200 draft/undo cycles stay bounded', () => {
  let state = createInitialState(settingsFor(7));
  assert.equal(undoPick(state).events.length, 0);
  assert.equal(undoPick(state).pickNumber, 1);

  for (const id of REAL_PLAYERS.slice(0, 20).map((p) => p.id)) {
    state = applyPick(state, id, 'OPPONENT');
  }
  const baseSize = JSON.stringify(state).length;
  const baseEvents = state.events.length;

  let work = state;
  for (let i = 0; i < 200; i += 1) {
    work = applyPick(work, REAL_PLAYERS[50 + (i % 40)].id, i % 2 ? 'ME' : 'OPPONENT');
    work = undoPick(work);
  }
  assert.equal(work.events.length, baseEvents, 'event log must not grow through undo cycles');
  assert.equal(work.pickNumber, state.pickNumber);
  assert.equal(JSON.stringify(work).length, baseSize, 'state size must not grow');

  // deep undo chain unwinds to the empty draft
  let unwound = work;
  for (let i = 0; i < 40; i += 1) unwound = undoPick(unwound);
  assert.equal(unwound.events.length, 0);
  assert.equal(unwound.pickNumber, 1);
});

test('localStorage round-trip recovers the draft and rejects corrupt state', () => {
  const storage = memoryStorage();
  const settings = settingsFor(9);
  let state = createInitialState(settings);
  state = applyPick(state, REAL_PLAYERS[0].id, 'OPPONENT');
  state = applyPick(state, REAL_PLAYERS[1].id, 'ME');
  saveState(storage, state);

  const ids = new Set(REAL_PLAYERS.map((p) => p.id));
  const reloaded = loadState(storage, ids);
  assert.equal(reloaded.pickNumber, 3);
  assert.deepEqual(reloaded.events.map((e) => e.playerId), [REAL_PLAYERS[0].id, REAL_PLAYERS[1].id]);
  assert.equal(reloaded.settings.mySlot, 9);
  assert.deepEqual(deriveDraftState(REAL_PLAYERS, reloaded, settings).myIds, [REAL_PLAYERS[1].id]);

  storage.setItem('fantasy-draft-engine-v1', '{not json');
  const recovered = loadState(storage, ids);
  assert.equal(recovered.pickNumber, 1);
  assert.equal(recovered.events.length, 0);

  assert.throws(() => validateState({ settings, events: [{ playerId: 'ghost', owner: 'ME' }] }, ids), /Unknown player/);
  assert.throws(
    () => validateState({ settings, events: [{ playerId: REAL_PLAYERS[0].id, owner: 'ME' }, { playerId: REAL_PLAYERS[0].id, owner: 'ME' }] }, ids),
    /Duplicate/,
  );
});

/* ------------------------------------------------------------------ *
 * 4. Roster adaptation, runs, saturation, extreme value falls
 * ------------------------------------------------------------------ */
test('roster adaptation: RB/RB start raises WR/TE, WR/WR start raises RB', () => {
  // identical remaining candidates at RB / WR / TE, so only roster need can decide
  const candidates = [
    P('wr-next', 'WR', 20, 25, { projection: 80, tier: 2 }),
    P('rb-next', 'RB', 21, 25, { projection: 80, tier: 2 }),
    P('te-next', 'TE', 22, 25, { projection: 80, tier: 2 }),
  ];
  const rbrbPool = [P('rb1', 'RB', 1, 1), P('rb2', 'RB', 2, 2), ...candidates];
  const wrwrPool = [P('wr1', 'WR', 1, 1), P('wr2', 'WR', 2, 2), ...candidates];
  const rbrb = stateAt(25, [ev(1, 'rb1', 'ME', 1), ev(24, 'rb2', 'ME', 1)]);
  const wrwr = stateAt(25, [ev(1, 'wr1', 'ME', 1), ev(24, 'wr2', 'ME', 1)]);
  const top = (pool, state) => recommend(pool, state, settingsFor(1), 5)[0].player.id;
  assert.ok(['wr-next', 'te-next'].includes(top(rbrbPool, rbrb)), 'RB/RB roster should pivot to WR/TE');
  assert.equal(top(wrwrPool, wrwr), 'rb-next', 'WR/WR roster should pivot to RB');
});

test('an extreme value fall still beats roster balance', () => {
  const players = [
    P('rb-owned1', 'RB', 1, 1), P('rb-owned2', 'RB', 2, 2),
    P('rb-fall', 'RB', 3, 4, { projection: 99, adpSd: 3 }),
    P('wr-need', 'WR', 30, 30, { projection: 74, tier: 3 }),
  ];
  const state = stateAt(30, [ev(1, 'rb-owned1', 'ME', 1), ev(24, 'rb-owned2', 'ME', 1)]);
  const recs = recommend(players, state, settingsFor(1), 5);
  assert.equal(recs[0].player.id, 'rb-fall');
  assert.ok(recs[0].reasons.some((r) => /value fall|replacement/.test(r)), `reasons: ${recs[0].reasons}`);
});

test('a six-QB early run does not make the engine chase QB', () => {
  const players = [
    ...Array.from({ length: 6 }, (_, i) => P(`qb-gone${i}`, 'QB', 5 + i, 20 + i * 2, { projection: 90 - i })),
    P('qb-left', 'QB', 30, 60, { projection: 74, tier: 3 }),
    P('rb-fall', 'RB', 8, 12, { projection: 92, adpSd: 4 }),
    P('wr-fall', 'WR', 9, 14, { projection: 91, adpSd: 4 }),
  ];
  const events = Array.from({ length: 6 }, (_, i) => ev(i + 1, `qb-gone${i}`, 'OPPONENT', i + 1));
  const recs = recommend(players, stateAt(7, events), settingsFor(7), 5);
  assert.ok(['rb-fall', 'wr-fall'].includes(recs[0].player.id), `chased QB: ${recs[0].player.id}`);
  const qbRank = recs.findIndex((r) => r.player.id === 'qb-left');
  assert.ok(qbRank !== 0, 'weak leftover QB must not be the top pick during a QB run');
});

test('a six-RB run raises RB gone-probability via opponent demand', () => {
  const rbRunPlayers = [
    ...Array.from({ length: 6 }, (_, i) => P(`rb-run${i}`, 'RB', i + 1, i + 1)),
    P('rb-target', 'RB', 20, 30, { projection: 85 }),
  ];
  const runEvents = Array.from({ length: 6 }, (_, i) => ev(i + 1, `rb-run${i}`, 'OPPONENT', i + 1));
  const quietPlayers = [
    ...Array.from({ length: 6 }, (_, i) => P(`k-run${i}`, 'K', i + 1, i + 1)),
    P('rb-target', 'RB', 20, 30, { projection: 85 }),
  ];
  const quietEvents = Array.from({ length: 6 }, (_, i) => ev(i + 1, `k-run${i}`, 'OPPONENT', i + 1));

  const runState = stateAt(7, runEvents);
  const quietState = stateAt(7, quietEvents);
  const runMult = demandMultipliers(runState, deriveDraftState(rbRunPlayers, runState, settingsFor(7)), settingsFor(7)).RB;
  const quietMult = demandMultipliers(quietState, deriveDraftState(quietPlayers, quietState, settingsFor(7)), settingsFor(7)).RB;
  assert.ok(runMult > quietMult, `run demand ${runMult} should exceed quiet demand ${quietMult}`);
});

test('roster saturation suppresses extra QB/TE/DST/K and deep RB/WR stacks', () => {
  const qbTest = [
    P('qb-owned', 'QB', 1, 1), P('qb2', 'QB', 2, 10, { projection: 94 }),
    P('wr', 'WR', 3, 20, { projection: 88 }),
  ];
  const qbState = stateAt(20, [ev(5, 'qb-owned', 'ME', 1)]);
  assert.equal(recommend(qbTest, qbState, settingsFor(1), 3)[0].player.id, 'wr');

  const dstTest = [
    P('dst-owned', 'DST', 1, 150), P('dst2', 'DST', 2, 151, { projection: 95 }),
    P('wr-bench', 'WR', 3, 160, { projection: 60 }),
  ];
  const dstState = stateAt(157, [ev(150, 'dst-owned', 'ME', 1)]);
  assert.equal(recommend(dstTest, dstState, settingsFor(1), 3)[0].player.id, 'wr-bench');

  const deepRb = [
    ...Array.from({ length: 6 }, (_, i) => P(`rb-mine${i}`, 'RB', i + 1, i + 1)),
    P('rb-extra', 'RB', 20, 100, { projection: 70 }),
    P('te-need', 'TE', 21, 101, { projection: 66 }),
  ];
  const deepState = stateAt(100, Array.from({ length: 6 }, (_, i) => ev(i + 1, `rb-mine${i}`, 'ME', 1)));
  assert.equal(recommend(deepRb, deepState, settingsFor(1), 3)[0].player.id, 'te-need');
});

/* ------------------------------------------------------------------ *
 * 5. Tier cliffs, exhausted tiers, ties, wait probability, late K/DST
 * ------------------------------------------------------------------ */
test('tier cliff rewards the last player above a real cliff but not above same-tier peers', () => {
  const te1 = P('te1', 'TE', 1, 20, { tier: 1, projection: 95 });
  const te4 = P('te4', 'TE', 4, 26, { tier: 1, projection: 88 });
  const weak = [
    P('te5', 'TE', 25, 90, { tier: 4, projection: 50 }),
    P('te6', 'TE', 26, 95, { tier: 4, projection: 48 }),
  ];
  const pool = [te1, te4, ...weak];
  assert.ok(
    tierCliffScore(te4, pool) > tierCliffScore(te4, [te1, te4, P('te5b', 'TE', 25, 90, { tier: 2, projection: 86 })]),
    'a bigger drop to the next tier must yield a bigger cliff score',
  );

  const recs = recommend(pool, stateAt(20, []), settingsFor(8), 4);
  assert.equal(recs[0].player.id, 'te1', 'TE1 must outrank TE4 inside the same tier');
});

test('exhausted position tiers do not crash and do not resurrect drafted players', () => {
  const tes = Array.from({ length: 3 }, (_, i) => P(`te${i}`, 'TE', i + 1, i + 1, { tier: 1 }));
  const others = [P('wr-a', 'WR', 10, 10), P('rb-a', 'RB', 11, 11)];
  const events = tes.map((p, i) => ev(i + 1, p.id, 'OPPONENT', i + 1));
  const recs = recommend([...tes, ...others], stateAt(4, events), settingsFor(4), 5);
  assert.equal(recs.length, 2);
  assert.ok(!recs.some((r) => r.player.position === 'TE'));

  // whole pool exhausted -> empty list, no throw
  const allGone = [...tes, ...others].map((p, i) => ev(i + 1, p.id, 'OPPONENT', teamOnClock(i + 1, 12)));
  assert.deepEqual(recommend([...tes, ...others], stateAt(6, allGone), settingsFor(4), 5), []);
});

test('perfect ties break deterministically by V3.1 rank then name', () => {
  const a = { ...P('zzz-player', 'WR', 5, 30), name: 'Zed Alpha' };
  const b = { ...P('aaa-player', 'WR', 5, 30), name: 'Adam Alpha' };
  const c = { ...P('mid-player', 'WR', 4, 30), name: 'Mid Alpha' };
  const order = recommend([a, b, c], stateAt(30, []), settingsFor(6), 3).map((r) => r.player.name);
  assert.deepEqual(order, ['Mid Alpha', 'Adam Alpha', 'Zed Alpha']);
  const repeat = recommend([c, a, b], stateAt(30, []), settingsFor(6), 3).map((r) => r.player.name);
  assert.deepEqual(repeat, order, 'ordering must not depend on input order');
});

test('wait probability responds to ADP distance and opponent demand', () => {
  const near = P('adp35', 'WR', 10, 35, { adpSd: 8 });
  const far = P('adp70', 'WR', 40, 70, { adpSd: 8 });
  const pNear = goneProbability(near, 28, 45);
  const pFar = goneProbability(far, 28, 45);
  assert.ok(pNear > pFar + 0.3, `expected ${pNear} >> ${pFar}`);
  assert.ok(goneProbability(near, 28, 45, 1.4) > goneProbability(near, 28, 45, 0.7), 'demand must move P(gone) up');
  assert.equal(goneProbability(near, 28, null), 0.98, 'no future pick => treat as gone');
});

test('K and DST are not the best pick before the late rounds', () => {
  const settings = settingsFor(1);
  for (let pick = 1; pick <= 132; pick += 7) {
    const rec = recommend(REAL_PLAYERS, stateAt(pick, []), settings, 3)[0];
    const round = roundForPick(pick, 12);
    if (round < settings.kDstStartRound) {
      assert.ok(
        !['K', 'DST'].includes(rec.player.position),
        `round ${round} recommended ${rec.player.position} ${rec.player.name}`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * 6. Opponent tracking
 * ------------------------------------------------------------------ */
test('opponent picks are attributed to the correct snake team and tracked per roster', () => {
  const settings = settingsFor(5);
  let state = createInitialState(settings);
  const picked = [];
  for (let i = 0; i < 24; i += 1) {
    const id = REAL_PLAYERS[i].id;
    const onClock = teamOnClock(state.pickNumber, 12);
    const owner = onClock === settings.mySlot ? 'ME' : 'OPPONENT';
    picked.push({ pick: state.pickNumber, id, onClock, owner });
    state = applyPick(state, id, owner);
  }
  const derived = deriveDraftState(REAL_PLAYERS, state, settings);
  for (const entry of picked) {
    assert.ok(
      derived.teamRosters[entry.onClock].includes(entry.id),
      `pick ${entry.pick} not tracked on team ${entry.onClock}`,
    );
  }
  assert.equal(derived.myIds.length, 2, 'slot 5 owns picks 5 and 20 in the first two rounds');
  const total = Object.values(derived.teamRosters).reduce((sum, ids) => sum + ids.length, 0);
  assert.equal(total, 24);
  for (const team of Object.keys(derived.teamCounts)) {
    const counts = derived.teamCounts[team];
    assert.equal(
      POSITIONS.reduce((sum, pos) => sum + counts[pos], 0),
      derived.teamRosters[team].length,
    );
  }
});

/* ------------------------------------------------------------------ *
 * 7. Full 12-team x 16-round simulations from all 12 slots
 * ------------------------------------------------------------------ */
test('quick search finds available players and drops drafted ones', () => {
  const settings = settingsFor(4);
  let state = createInitialState(settings);
  const target = deriveDraftState(REAL_PLAYERS, state, settings).available
    .find((p) => p.status === 'ACTIVE');

  const first = target.name.split(' ')[0];
  const matches = searchAvailable(
    deriveDraftState(REAL_PLAYERS, state, settings).available,
    first,
  );
  assert.ok(matches.some((p) => p.id === target.id), 'search must surface the player');
  assert.ok(matches.length <= 8, 'quick search stays short enough to tap');

  state = applyPick(state, target.id, 'OPPONENT');
  const after = searchAvailable(
    deriveDraftState(REAL_PLAYERS, state, settings).available,
    target.name,
  );
  assert.ok(!after.some((p) => p.id === target.id), 'taken player must leave quick search');
});

test('quick search ranks name-prefix matches over substring matches', () => {
  const pool = [
    P('sub', 'WR', 4, 40, { }),
    P('lead', 'RB', 9, 90, { }),
  ];
  pool[0].name = 'Marcus Ashton';
  pool[1].name = 'Ash Carter';

  const ranked = searchAvailable(pool, 'ash').map((p) => p.name);
  assert.deepEqual(ranked, ['Ash Carter', 'Marcus Ashton']);
  assert.deepEqual(searchAvailable(pool, '   '), []);
  assert.deepEqual(searchAvailable(pool, 'zzz'), []);
});

function opponentPick(available, counts, round, settings) {
  const need = (player) => {
    const pos = player.position;
    if ((pos === 'K' || pos === 'DST')) {
      if (round < settings.kDstStartRound || counts[pos] >= 1) return -1000;
      return 40;
    }
    if (pos === 'QB') return counts.QB >= 1 ? -60 : (round >= 5 ? 12 : 0);
    if (pos === 'TE') return counts.TE >= 1 ? -35 : (round >= 5 ? 8 : 0);
    if (pos === 'RB') return counts.RB < 2 ? 10 : counts.RB > 5 ? -20 : 0;
    if (pos === 'WR') return counts.WR < 2 ? 10 : counts.WR > 6 ? -20 : 0;
    return 0;
  };
  return available
    .filter((p) => p.status === 'ACTIVE')
    .map((p) => ({ p, score: (300 - p.adp) + need(p) }))
    .sort((a, b) => b.score - a.score || a.p.v31Rank - b.p.v31Rank)[0]?.p ?? null;
}

function runFullDraftSimulation(teams, slot) {
    const requestedSettings = settingsFor(slot, { teams });
    const storage = memoryStorage();
    let state = createInitialState(requestedSettings);
    const settings = state.settings;
    assert.equal(settings.teams, teams);
    assert.equal(settings.mySlot, slot);
    const maxPick = settings.teams * settings.rounds;
    const seenIds = new Set();
    const myPicks = [];
    let maxStateSize = 0;

    for (let pick = 1; pick <= maxPick; pick += 1) {
      assert.equal(state.pickNumber, pick);
      const onClock = teamOnClock(pick, settings.teams);
      const round = roundForPick(pick, settings.teams);
      const derived = deriveDraftState(REAL_PLAYERS, state, settings);
      assert.ok(
        derived.available.filter((p) => p.status === 'ACTIVE').length > 0,
        `pool exhausted at pick ${pick}`,
      );

      let chosen;
      if (onClock === slot) {
        const recs = recommend(REAL_PLAYERS, state, settings, 9);
        assert.ok(recs.length > 0, `no recommendation at pick ${pick}`);
        chosen = recs[0].player;
        assert.equal(chosen.status, 'ACTIVE', `recommended non-ACTIVE ${chosen.id}`);
        myPicks.push({ pick, round, player: chosen });
        state = applyPick(state, chosen.id, 'ME');
      } else {
        chosen = opponentPick(derived.available, derived.teamCounts[onClock], round, settings);
        assert.ok(chosen, `opponent had nothing to pick at ${pick}`);
        state = applyPick(state, chosen.id, 'OPPONENT');
      }

      assert.ok(!seenIds.has(chosen.id), `duplicate selection ${chosen.id} at pick ${pick}`);
      seenIds.add(chosen.id);
      saveState(storage, state);
      maxStateSize = Math.max(maxStateSize, JSON.stringify(state).length);
    }

    // completion + integrity
    assert.equal(state.events.length, maxPick);
    assert.equal(state.pickNumber, maxPick + 1);
    assert.throws(() => applyPick(state, REAL_PLAYERS.at(-1).id, 'ME'), /Draft is complete/);

    const derived = deriveDraftState(REAL_PLAYERS, state, settings);
    assert.equal(derived.myIds.length, settings.rounds, 'my roster must hold one player per round');

    // legal roster
    const counts = derived.myCounts;
    for (const [pos, min] of Object.entries({ QB: 1, RB: 2, WR: 2, TE: 1, DST: 1, K: 1 })) {
      assert.ok(counts[pos] >= min, `slot ${slot} roster illegal: ${pos}=${counts[pos]} < ${min}`);
    }

    // positional discipline
    const qbRounds = myPicks.filter((m) => m.player.position === 'QB').map((m) => m.round);
    assert.ok(
      qbRounds.filter((r) => r < 10).length <= 1,
      `slot ${slot} took multiple QBs before round 10 (rounds ${qbRounds})`,
    );
    for (const m of myPicks) {
      if (['K', 'DST'].includes(m.player.position)) {
        assert.ok(m.round >= settings.kDstStartRound, `slot ${slot} took ${m.player.position} in round ${m.round}`);
      }
      assert.equal(m.player.status, 'ACTIVE', `slot ${slot} drafted non-ACTIVE ${m.player.id}`);
    }

    // persistence + bounded state
    const reloaded = loadState(storage, new Set(REAL_PLAYERS.map((p) => p.id)));
    assert.equal(reloaded.events.length, maxPick);
    assert.deepEqual(
      deriveDraftState(REAL_PLAYERS, reloaded, settings).myIds,
      derived.myIds,
      'reloaded state must reproduce my roster',
    );
    assert.ok(maxStateSize < 200 * maxPick, `state size ${maxStateSize} grew beyond linear bound`);

    // undo at the very end restores pick 192
    const undone = undoPick(state);
    assert.equal(undone.pickNumber, maxPick);
    assert.equal(undone.events.length, maxPick - 1);
}

for (const teams of [12, 16]) {
  for (let slot = 1; slot <= teams; slot += 1) {
    test(`full ${teams}-team x 16-round snake simulation from slot ${slot}`, () => {
      runFullDraftSimulation(teams, slot);
    });
  }
}
