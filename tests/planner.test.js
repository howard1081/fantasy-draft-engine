import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, deriveDraftState, roundForPick, teamOnClock } from '../src/engine.js';
import {
  MATCHUP_CAP,
  PLAYOFF_WEEKS,
  PLAYOFF_WEIGHT,
  WEIGHTED_GAMES,
  byeConflicts,
  effectivePpg,
  expectedPositionValues,
  fillLineup,
  matchupFactor,
  planPick,
  playoffOutlook,
  playoffSlate,
  rosterSeasonValue,
  setMatchups,
  waiverLevels,
  weekWeight,
} from '../src/planner.js';
import {
  applyPick,
  createInitialState,
  deletePick,
  replacePick,
  validateState,
} from '../src/state.js';

const REAL_PLAYERS = JSON.parse(
  readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'),
);
const REAL_MATCHUPS = JSON.parse(
  readFileSync(new URL('../data/matchups.json', import.meta.url), 'utf8'),
);

const syntheticMatchups = () => {
  const week = (opponent) => ({ opponent, home: true });
  const schedule = {};
  for (const team of ['SOFT', 'TOUGH', 'EVEN']) {
    schedule[team] = {};
    for (let index = 1; index <= 18; index += 1) {
      schedule[team][index] = team === 'SOFT' ? week('SIEVE') : team === 'TOUGH' ? week('WALL') : week('AVG');
    }
    schedule[team][5] = null;
  }
  return {
    season: 2026,
    playoffWeeks: [15, 16, 17],
    schedule,
    defense: {
      SIEVE: { QB: 1.4, RB: 1.3, WR: 1.25, TE: 1.6, DST: 2.2, K: 1.2 },
      WALL: { QB: 0.6, RB: 0.7, WR: 0.84, TE: 0.5, DST: 0.3, K: 0.8 },
      AVG: { QB: 1, RB: 1, WR: 1, TE: 1, DST: 1, K: 1 },
    },
  };
};

const PP = (id, position, adp, ppg, { bye = 5, risk = 20, status = 'ACTIVE', team = 'X', adpSd = 6 } = {}) => ({
  id,
  name: id,
  team,
  position,
  bye,
  v31Rank: Math.round(adp),
  positionRank: 1,
  tier: 1,
  projectionValue: 70,
  adp,
  adpSd,
  upside: 60,
  risk,
  status,
  ppg,
});

function syntheticPool() {
  const pool = [];
  const build = (position, count, topPpg, step, startAdp, adpStep, byes) => {
    for (let index = 0; index < count; index += 1) {
      pool.push(PP(
        `${position}${index + 1}`,
        position,
        startAdp + index * adpStep,
        Math.max(1, topPpg - index * step),
        { bye: byes[index % byes.length] },
      ));
    }
  };
  build('QB', 30, 22, 0.55, 15, 8, [7, 10, 13, 6]);
  // Two-man elite tier, then a flat pack of mediocre QBs.
  pool.filter((player) => player.position === 'QB').forEach((player, index) => {
    player.ppg = index === 0 ? 22 : index === 1 ? 21.2 : 17.6 - (index - 2) * 0.3;
  });
  build('RB', 70, 21, 0.28, 1, 3, [5, 8, 11, 13]);
  build('WR', 90, 20, 0.2, 2, 2.6, [6, 9, 10, 14]);
  build('TE', 30, 14, 0.4, 20, 9, [11, 5, 8]);
  build('DST', 20, 7.5, 0.15, 120, 5, [9, 12]);
  build('K', 20, 8.8, 0.15, 125, 5, [6, 11]);
  return pool;
}

const settingsFor = (mySlot, extra = {}) => ({ ...DEFAULT_SETTINGS, mySlot, ...extra });

function stateWith(settings, events, pickNumber) {
  return { version: 1, settings, pickNumber, events, updatedAt: 0 };
}

function eventsFromIds(ids, settings, mine = new Set()) {
  return ids.map((playerId, index) => {
    const pick = index + 1;
    return {
      pick,
      round: roundForPick(pick, settings.teams),
      teamIndex: mine.has(playerId) ? settings.mySlot : teamOnClock(pick, settings.teams),
      playerId,
      owner: mine.has(playerId) ? 'ME' : 'OPPONENT',
      timestamp: 0,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Lineup + season valuation
 * ------------------------------------------------------------------ */
test('fillLineup fills dedicated slots first, then FLEX, then bench', () => {
  const roster = [
    PP('QB1', 'QB', 20, 22), PP('RB1', 'RB', 1, 20), PP('RB2', 'RB', 10, 16), PP('RB3', 'RB', 40, 12),
    PP('WR1', 'WR', 3, 19), PP('WR2', 'WR', 12, 15), PP('TE1', 'TE', 25, 13), PP('K1', 'K', 150, 8),
  ];
  const lineup = fillLineup(roster, DEFAULT_SETTINGS);
  const bySlot = Object.fromEntries(lineup.starters.map((starter) => [starter.slot, starter.player.id]));
  assert.equal(bySlot.RB1, 'RB1');
  assert.equal(bySlot.RB2, 'RB2');
  assert.equal(bySlot.FLEX1, 'RB3');
  assert.equal(bySlot.K1, 'K1');
  assert.deepEqual(lineup.openSlots.map((slot) => slot.slot), ['DST1']);
  assert.equal(lineup.bench.length, 0);
});

test('lineup composition, not raw depth, drives value: a 4th WR is bench-only, a starter counts every week', () => {
  const waiver = { QB: 14, RB: 5, WR: 6, TE: 6, DST: 5, K: 7 };
  const core = [
    PP('RB1', 'RB', 1, 20), PP('RB2', 'RB', 10, 16), PP('WR1', 'WR', 3, 19), PP('WR2', 'WR', 12, 15),
    PP('WR3', 'WR', 30, 13), PP('TE1', 'TE', 25, 13), PP('K1', 'K', 150, 8), PP('DST1', 'DST', 140, 7),
  ];
  const base = rosterSeasonValue(core, DEFAULT_SETTINGS, waiver).total;
  const fourthWr = rosterSeasonValue([...core, PP('WR4', 'WR', 45, 12)], DEFAULT_SETTINGS, waiver).total;
  const qb = rosterSeasonValue([...core, PP('QB1', 'QB', 60, 17)], DEFAULT_SETTINGS, waiver).total;
  assert.ok(fourthWr - base < 4 * 12, 'a 4th WR only adds bench coverage, not a season of starts');
  assert.ok(qb - base > 15 * 17 * 0.9, 'filling the empty QB slot adds roughly a full season of starts');
  assert.ok(qb > fourthWr);
});

test('fantasy-playoff weeks count more than regular-season weeks in the lineup objective', () => {
  assert.deepEqual(PLAYOFF_WEEKS, [15, 16, 17]);
  assert.equal(weekWeight(15), PLAYOFF_WEIGHT);
  assert.equal(weekWeight(8), 1);
  assert.ok(PLAYOFF_WEIGHT > 1);
  const starter = PP('RB1', 'RB', 1, 20, { bye: 8 });
  const only = [starter, PP('QB1', 'QB', 20, 22), PP('RB2', 'RB', 10, 16), PP('WR1', 'WR', 3, 19), PP('WR2', 'WR', 12, 15), PP('TE1', 'TE', 25, 13), PP('K1', 'K', 150, 8), PP('DST1', 'DST', 140, 7)];
  const waiver = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0 };
  const { total } = rosterSeasonValue(only, DEFAULT_SETTINGS, waiver);
  const expected = only.reduce((sum, player) => sum + effectivePpg(player) * WEIGHTED_GAMES, 0);
  assert.ok(Math.abs(total - expected) < 1e-6, `weighted season total ${total} should equal ${expected}`);
});

test('matchup factors are neutral without data, shrunk toward 1 and hard-capped with it', () => {
  setMatchups(null);
  const qb = PP('QB1', 'QB', 20, 22, { team: 'SOFT' });
  assert.equal(matchupFactor(qb, 15), 1);
  assert.equal(playoffOutlook(qb), null);

  setMatchups(syntheticMatchups());
  try {
    assert.equal(matchupFactor(qb, 15), 1 + MATCHUP_CAP, 'a huge raw edge is capped');
    assert.equal(matchupFactor({ ...qb, team: 'TOUGH' }, 15), 1 - MATCHUP_CAP);
    assert.equal(matchupFactor({ ...qb, team: 'EVEN' }, 15), 1);
    assert.equal(matchupFactor({ ...qb, team: 'SOFT' }, 5), 1, 'bye week has no matchup');
    assert.equal(matchupFactor({ ...qb, team: 'FA' }, 15), 1, 'unknown team is neutral');
    const wr = PP('WR1', 'WR', 3, 19, { team: 'SOFT' });
    assert.equal(matchupFactor(wr, 15), 1 + MATCHUP_CAP, 'WR 1.25 raw shrinks by half then caps');
    assert.ok(Math.abs(matchupFactor({ ...wr, team: 'TOUGH' }, 15) - 0.92) < 1e-9, 'WR 0.84 raw shrinks by half to 0.92');
    const outlook = playoffOutlook({ ...qb, team: 'TOUGH' });
    assert.equal(outlook.label, 'tough');
    assert.equal(playoffSlate(outlook), 'vsWALL vsWALL vsWALL');
    assert.equal(playoffOutlook({ ...qb, team: 'EVEN' }).label, 'neutral');
  } finally {
    setMatchups(null);
  }
});

test('matchups act as a bounded tiebreaker in the lineup objective, with playoff weeks weighted', () => {
  setMatchups(syntheticMatchups());
  try {
    const waiver = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0 };
    const core = [PP('RB2', 'RB', 10, 16), PP('WR1', 'WR', 3, 19), PP('WR2', 'WR', 12, 15), PP('TE1', 'TE', 25, 13), PP('K1', 'K', 150, 8), PP('DST1', 'DST', 140, 7)];
    const soft = rosterSeasonValue([...core, PP('QB1', 'QB', 20, 20, { team: 'SOFT' })], DEFAULT_SETTINGS, waiver).total;
    const tough = rosterSeasonValue([...core, PP('QB1', 'QB', 20, 20, { team: 'TOUGH' })], DEFAULT_SETTINGS, waiver).total;
    const even = rosterSeasonValue([...core, PP('QB1', 'QB', 20, 20, { team: 'EVEN' })], DEFAULT_SETTINGS, waiver).total;
    assert.ok(soft > even && even > tough);
    const qbSeason = effectivePpg(PP('QB1', 'QB', 20, 20)) * WEIGHTED_GAMES;
    assert.ok(soft - even <= qbSeason * MATCHUP_CAP + 1e-6, 'matchup swing never exceeds the cap');
    assert.ok(even - tough <= qbSeason * MATCHUP_CAP + 1e-6);
    // A clearly better player beats the softest possible schedule: matchups are a tiebreaker.
    const better = rosterSeasonValue([...core, PP('QB1', 'QB', 20, 22.5, { team: 'EVEN' })], DEFAULT_SETTINGS, waiver).total;
    assert.ok(better > soft);
  } finally {
    setMatchups(null);
  }
});

test('generated matchup table covers 32 teams, playoff weeks and bounded factors for the real pool', () => {
  assert.deepEqual(REAL_MATCHUPS.playoffWeeks, PLAYOFF_WEEKS);
  assert.equal(Object.keys(REAL_MATCHUPS.schedule).length, 32);
  assert.equal(Object.keys(REAL_MATCHUPS.defense).length, 32);
  for (const [team, weeks] of Object.entries(REAL_MATCHUPS.schedule)) {
    assert.ok(REAL_MATCHUPS.defense[team], `${team} has a defense profile`);
    for (const week of PLAYOFF_WEEKS) {
      const game = weeks[week];
      if (game) assert.ok(REAL_MATCHUPS.schedule[game.opponent], `${team} wk${week} opponent ${game.opponent} exists`);
    }
    for (const position of ['QB', 'RB', 'WR', 'TE']) {
      assert.ok(REAL_MATCHUPS.defense[team][position] > 0.3 && REAL_MATCHUPS.defense[team][position] < 2.5, `${team} ${position}`);
    }
  }
  setMatchups(REAL_MATCHUPS);
  try {
    const teams = new Set(REAL_PLAYERS.map((player) => player.team));
    const unknown = [...teams].filter((team) => !REAL_MATCHUPS.schedule[team]);
    assert.deepEqual(unknown.filter((team) => team !== 'FA'), [], 'every rostered NFL team has a schedule');
    let labels = { soft: 0, tough: 0, neutral: 0 };
    for (const player of REAL_PLAYERS.filter((candidate) => candidate.status === 'ACTIVE')) {
      for (let week = 1; week <= 18; week += 1) {
        const factor = matchupFactor(player, week);
        assert.ok(factor >= 1 - MATCHUP_CAP && factor <= 1 + MATCHUP_CAP);
      }
      const outlook = playoffOutlook(player);
      labels[outlook.label] += 1;
    }
    assert.ok(labels.soft > 0 && labels.tough > 0 && labels.neutral > 0, JSON.stringify(labels));
    const plan = planPick(REAL_PLAYERS, createInitialState(DEFAULT_SETTINGS), DEFAULT_SETTINGS, 9);
    assert.ok(plan.best.player.v31Rank <= 8, 'matchup tiebreaker does not upend the opening pick');
  } finally {
    setMatchups(null);
  }
});

test('a backup QB on a different bye is worth more than one sharing the starter bye', () => {
  const waiver = { QB: 14, RB: 5, WR: 6, TE: 6, DST: 5, K: 7 };
  const base = [
    PP('QB1', 'QB', 20, 22, { bye: 7 }), PP('RB1', 'RB', 1, 20), PP('RB2', 'RB', 10, 16),
    PP('WR1', 'WR', 3, 19), PP('WR2', 'WR', 12, 15), PP('TE1', 'TE', 25, 13),
    PP('K1', 'K', 150, 8), PP('DST1', 'DST', 140, 7), PP('WR3', 'WR', 40, 12),
  ];
  const noBackup = rosterSeasonValue(base, DEFAULT_SETTINGS, waiver).total;
  const sameBye = rosterSeasonValue([...base, PP('QB2', 'QB', 90, 17, { bye: 7 })], DEFAULT_SETTINGS, waiver).total;
  const differentBye = rosterSeasonValue([...base, PP('QB2', 'QB', 90, 17, { bye: 10 })], DEFAULT_SETTINGS, waiver).total;
  assert.ok(differentBye > sameBye, 'covering the QB bye must add value');
  assert.ok(sameBye > noBackup, 'injury coverage still adds a little');
  assert.ok(differentBye - noBackup < 17 * 4, 'a backup QB is worth a game or two above waivers, not a season');
});

test('an elite QB adds far more season value than a mediocre QB pair', () => {
  const waiver = { QB: 14, RB: 5, WR: 6, TE: 6, DST: 5, K: 7 };
  const core = [
    PP('RB1', 'RB', 1, 20), PP('RB2', 'RB', 10, 16), PP('WR1', 'WR', 3, 19), PP('WR2', 'WR', 12, 15),
    PP('TE1', 'TE', 25, 13), PP('K1', 'K', 150, 8), PP('DST1', 'DST', 140, 7), PP('WR3', 'WR', 40, 12),
  ];
  const elite = rosterSeasonValue([...core, PP('QBa', 'QB', 15, 22, { bye: 7 })], DEFAULT_SETTINGS, waiver).total;
  const twoMediocre = rosterSeasonValue(
    [...core, PP('QBb', 'QB', 70, 17, { bye: 7 }), PP('QBc', 'QB', 90, 16.5, { bye: 10 })],
    DEFAULT_SETTINGS,
    waiver,
  ).total;
  assert.ok(elite > twoMediocre, `elite ${elite} should beat two mediocre ${twoMediocre}`);
});

test('byeConflicts reports same-position stacks separately from harmless overlaps', () => {
  const conflicts = byeConflicts([
    PP('QB1', 'QB', 20, 22, { bye: 7 }), PP('QB2', 'QB', 90, 17, { bye: 7 }),
    PP('RB1', 'RB', 1, 20, { bye: 9 }), PP('WR1', 'WR', 3, 19, { bye: 9 }),
  ]);
  assert.equal(conflicts.length, 2);
  assert.deepEqual(conflicts[0].samePosition, ['QB']);
  assert.deepEqual(conflicts[1].samePosition, []);
});

/* ------------------------------------------------------------------ *
 * Expected availability
 * ------------------------------------------------------------------ */
test('expected best-available value decays with distance and with opponent demand', () => {
  const pool = syntheticPool();
  const [near, far] = expectedPositionValues(pool, 'RB', 6, [19, 30], 1);
  assert.ok(near[1] > far[1], 'the best RB expected at pick 19 beats the one expected at pick 30');
  assert.ok(near[1] > near[2] && near[2] > near[3], 'n-th best values are ordered');
  const [pressured] = expectedPositionValues(pool, 'RB', 6, [19], 1.4);
  assert.ok(pressured[1] < near[1], 'a demand multiplier lowers what survives');
});

test('waiver levels sit deep in the pool and scale with league size', () => {
  const pool = syntheticPool();
  const twelve = waiverLevels(pool, settingsFor(1, { teams: 12 }));
  const sixteen = waiverLevels(pool, settingsFor(1, { teams: 16 }));
  assert.ok(twelve.QB < 20 && twelve.QB > 8);
  assert.ok(sixteen.QB < twelve.QB && sixteen.RB < twelve.RB);
});

/* ------------------------------------------------------------------ *
 * Planner decisions
 * ------------------------------------------------------------------ */
test('planner grabs the elite QB when the QB drop-off before the next pick is steep', () => {
  const pool = syntheticPool();
  const settings = settingsFor(6);
  const taken = pool.filter((player) => player.adp < 18 && player.position !== 'QB').map((player) => player.id);
  const mine = new Set([taken[5]]);
  const state = stateWith(settings, eventsFromIds(taken, settings, mine), taken.length + 1);
  const plan = planPick(pool, state, settings);
  assert.ok(plan.best, 'planner produced a pick');
  assert.equal(plan.best.player.position, 'QB');
  assert.ok(plan.best.reasons.some((reason) => /QB/.test(reason)));
});

test('planner does not spend a mid-round pick on a second QB once an elite QB is rostered', () => {
  const pool = syntheticPool();
  const settings = settingsFor(6);
  const ids = pool.filter((player) => player.adp < 70).map((player) => player.id).slice(0, 65);
  const mine = new Set(['RB2', 'QB1', 'WR6', 'RB12', 'WR12']);
  const events = eventsFromIds([...mine, ...ids.filter((id) => !mine.has(id))].slice(0, 65), settings, mine);
  const state = stateWith(settings, events, 66);
  const plan = planPick(pool, state, settings);
  assert.notEqual(plan.best.player.position, 'QB', `took ${plan.best.player.id} as a QB2 in round 6`);
  const qbCandidate = plan.candidates.find((candidate) => candidate.player.position === 'QB');
  if (qbCandidate) assert.ok(qbCandidate.total < plan.best.total);
});

test('planner flags a backup QB that shares the starter bye week', () => {
  const pool = syntheticPool();
  const settings = settingsFor(6);
  const drafted = pool.filter((player) => player.adp < 140 && player.position !== 'QB').map((player) => player.id).slice(0, 135);
  const mine = new Set(['QB1', ...drafted.slice(0, 9)]);
  const events = eventsFromIds(['QB1', ...drafted.slice(0, 135)], settings, mine).slice(0, 136);
  const state = stateWith(settings, events, 137);
  const plan = planPick(pool, state, settings);
  const sameBye = plan.candidates.find((candidate) => candidate.player.position === 'QB' && candidate.player.bye === 7);
  if (sameBye) {
    assert.ok(sameBye.byeWarnings.some((warning) => /same bye/.test(warning)));
  }
  const rosterQb = pool.find((player) => player.id === 'QB1');
  assert.equal(rosterQb.bye, 7);
});

test('a WR run lowers the expected WR value at my next pick and the planner reacts', () => {
  const pool = syntheticPool();
  const settings = settingsFor(1);
  const quiet = pool
    .filter((player) => player.adp < 30)
    .sort((a, b) => a.adp - b.adp)
    .slice(0, 23)
    .map((player) => player.id);
  const calm = planPick(pool, stateWith(settings, eventsFromIds(quiet, settings, new Set([quiet[0]])), 24), settings);
  const wrRun = [quiet[0], ...pool.filter((player) => player.position === 'WR').slice(0, 22).map((player) => player.id)];
  const frenzy = planPick(pool, stateWith(settings, eventsFromIds(wrRun, settings, new Set([quiet[0]])), 24), settings);
  assert.ok(frenzy.demand.WR > calm.demand.WR, 'run pressure must raise WR demand');
  assert.ok(frenzy.outlook.WR.nextPpg < calm.outlook.WR.nextPpg, 'fewer WRs survive to my next pick');
  assert.ok(frenzy.best, 'planner still returns a pick');
});

test('planner never recommends K/DST before the configured round or non-ACTIVE players', () => {
  const pool = syntheticPool().concat([PP('HURT', 'RB', 3, 25, { status: 'OUT' })]);
  const settings = settingsFor(3);
  const state = stateWith(settings, [], 1);
  const plan = planPick(pool, state, settings);
  assert.notEqual(plan.best.player.id, 'HURT');
  assert.ok(plan.candidates.every((candidate) => candidate.player.status === 'ACTIVE'));
  assert.ok(plan.candidates.every((candidate) => !['K', 'DST'].includes(candidate.player.position)));
});

test('planner plan covers every remaining pick and fills open starters', () => {
  const pool = syntheticPool();
  const settings = settingsFor(4);
  const plan = planPick(pool, stateWith(settings, [], 4), settings);
  assert.equal(plan.best.plan.picks.length, 15);
  const positions = plan.best.plan.picks.map((pick) => pick.position);
  assert.ok(positions.includes('K') && positions.includes('DST'));
  assert.ok(plan.best.plan.picks.filter((pick) => pick.position === 'K').every((pick) => pick.round >= settings.kDstStartRound));
});

test('planner responds while an opponent is on the clock by planning for my next pick', () => {
  const pool = syntheticPool();
  const settings = settingsFor(6);
  const plan = planPick(pool, stateWith(settings, [], 1), settings);
  assert.equal(plan.onClock, false);
  assert.equal(plan.currentPick, 6);
  assert.ok(plan.best);
});

test('off the clock, the target is a player who can realistically survive to my pick', () => {
  const settings = { ...DEFAULT_SETTINGS, mySlot: 12 };
  const plan = planPick(REAL_PLAYERS, stateWith(settings, [], 1), settings);
  assert.equal(plan.onClock, false);
  assert.equal(plan.currentPick, 12);
  assert.ok(plan.best.reachGone < 0.5, `target ${plan.best.player.name} is ${plan.best.reachGone} gone by #12`);
  assert.ok(plan.best.player.adp >= 4, 'the consensus top-3 picks are not offered as a slot-12 target');
  assert.match(plan.best.reasons[0], /chance still there at #12/);
  const onClock = planPick(REAL_PLAYERS, stateWith(settings, [], 12), settings);
  assert.equal(onClock.best.reachGone, 0);
  assert.ok(onClock.best.reasons.every((reason) => !/still there/.test(reason)));
});

test('planner returns null once the draft is complete', () => {
  const pool = syntheticPool();
  const settings = settingsFor(1);
  assert.equal(planPick(pool, stateWith(settings, [], 193), settings), null);
});

/* ------------------------------------------------------------------ *
 * Draft-log corrections
 * ------------------------------------------------------------------ */
test('deletePick removes any earlier pick, renumbers later picks and re-opens the player', () => {
  let state = createInitialState(settingsFor(2));
  state = applyPick(state, 'RB1', 'OPPONENT');
  state = applyPick(state, 'RB2', 'ME');
  state = applyPick(state, 'WR1', 'OPPONENT');
  const fixed = deletePick(state, 1);
  assert.equal(fixed.events.length, 2);
  assert.deepEqual(fixed.events.map((event) => [event.pick, event.playerId, event.owner]), [[1, 'RB2', 'ME'], [2, 'WR1', 'OPPONENT']]);
  assert.equal(fixed.pickNumber, 3);
  assert.equal(fixed.events[0].teamIndex, 2);
  assert.throws(() => deletePick(state, 9), /not in the draft log/);
});

test('replacePick swaps the player (and optionally the owner) without moving other picks', () => {
  let state = createInitialState(settingsFor(2));
  state = applyPick(state, 'RB1', 'OPPONENT');
  state = applyPick(state, 'RB2', 'ME');
  const swapped = replacePick(state, 1, 'WR1');
  assert.deepEqual(swapped.events.map((event) => event.playerId), ['WR1', 'RB2']);
  assert.equal(swapped.pickNumber, 3);
  const reowned = replacePick(state, 1, 'RB1', 'ME');
  assert.equal(reowned.events[0].owner, 'ME');
  assert.equal(reowned.events[0].teamIndex, 2);
  assert.throws(() => replacePick(state, 1, 'RB2'), /already been drafted/);
  assert.throws(() => replacePick(state, 1, 'RB9', 'BOTH'), /Invalid draft owner/);
  assert.equal(validateState(swapped).events.length, 2);
});

/* ------------------------------------------------------------------ *
 * Snapshot expectations for the planner
 * ------------------------------------------------------------------ */
test('draft snapshot carries ESPN projections, byes and injury exclusions for the planner', () => {
  const active = REAL_PLAYERS.filter((player) => player.status === 'ACTIVE');
  assert.ok(active.length >= 16 * 16);
  assert.ok(REAL_PLAYERS.every((player) => player.bye >= 1 && player.bye <= 18), 'every player has a bye week');
  const withPpg = REAL_PLAYERS.filter((player) => player.ppg > 0).length;
  assert.ok(withPpg / REAL_PLAYERS.length > 0.97, 'nearly every player has a PPG projection');
  for (const player of REAL_PLAYERS) {
    if (['OUT', 'INJURY_RESERVE', 'SUSPENSION'].includes(player.injuryStatus)) {
      assert.equal(player.status, 'OUT', `${player.name} must be excluded while ${player.injuryStatus}`);
    }
  }
  const byName = Object.fromEntries(REAL_PLAYERS.map((player) => [player.name, player]));
  assert.equal(byName['Josh Jacobs'].status, 'HOLD');
  assert.equal(byName['Zach Charbonnet'].status, 'OUT');
  assert.ok(byName['Josh Allen'].ppg > 18);
});

/* ------------------------------------------------------------------ *
 * Full planner simulations on the real snapshot
 * ------------------------------------------------------------------ */
function opponentPick(available, counts, round, settings) {
  const need = (player) => {
    const pos = player.position;
    if (pos === 'K' || pos === 'DST') {
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

function runPlannerDraft(teams, slot) {
  let state = createInitialState(settingsFor(slot, { teams }));
  const settings = state.settings;
  const maxPick = settings.teams * settings.rounds;
  const myPicks = [];
  let slowest = 0;
  for (let pick = 1; pick <= maxPick; pick += 1) {
    const onClock = teamOnClock(pick, settings.teams);
    const round = roundForPick(pick, settings.teams);
    const derived = deriveDraftState(REAL_PLAYERS, state, settings);
    if (onClock === slot) {
      const started = performance.now();
      const plan = planPick(REAL_PLAYERS, state, settings);
      slowest = Math.max(slowest, performance.now() - started);
      assert.ok(plan?.best, `no plan at pick ${pick}`);
      assert.equal(plan.onClock, true);
      assert.equal(plan.best.player.status, 'ACTIVE');
      myPicks.push({ round, player: plan.best.player });
      state = applyPick(state, plan.best.player.id, 'ME');
    } else {
      const chosen = opponentPick(derived.available, derived.teamCounts[onClock], round, settings);
      state = applyPick(state, chosen.id, 'OPPONENT');
    }
  }
  const derived = deriveDraftState(REAL_PLAYERS, state, settings);
  const counts = derived.myCounts;
  for (const [pos, min] of Object.entries({ QB: 1, RB: 2, WR: 2, TE: 1, DST: 1, K: 1 })) {
    assert.ok(counts[pos] >= min, `slot ${slot}/${teams}: ${pos}=${counts[pos]} < ${min}`);
  }
  assert.ok(counts.QB <= 2 && counts.TE <= 2 && counts.K === 1 && counts.DST === 1, `slot ${slot}/${teams} over-drafted ${JSON.stringify(counts)}`);
  assert.ok(myPicks.filter((m) => m.player.position === 'QB' && m.round < 10).length <= 1, 'one QB before round 10');
  for (const m of myPicks) {
    if (['K', 'DST'].includes(m.player.position)) assert.ok(m.round >= settings.kDstStartRound);
  }
  const roster = derived.myIds.map((id) => derived.playersById[id]);
  const qbs = roster.filter((player) => player.position === 'QB');
  if (qbs.length === 2) assert.notEqual(qbs[0].bye, qbs[1].bye, `slot ${slot}/${teams}: both QBs share bye ${qbs[0].bye}`);
  assert.ok(slowest < 1500, `planner took ${slowest.toFixed(0)}ms for one pick`);
  return rosterSeasonValue(roster, settings, waiverLevels(REAL_PLAYERS, settings)).total;
}

for (const teams of [12, 16]) {
  for (let slot = 1; slot <= teams; slot += 1) {
    test(`planner-driven ${teams}-team x 16-round draft from slot ${slot} builds a legal, bye-aware roster`, () => {
      const total = runPlannerDraft(teams, slot);
      assert.ok(total > 1000, `season value ${total} unexpectedly low`);
    });
  }
}
