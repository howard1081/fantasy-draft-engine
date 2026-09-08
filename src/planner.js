import {
  DEFAULT_SETTINGS,
  POSITIONS,
  clamp,
  demandMultipliers,
  deriveDraftState,
  goneProbability,
  myPickNumbers,
  recommend,
  roundForPick,
  teamOnClock,
} from './engine.js';

export const GAMES = 17;
export const SEASON_WEEKS = 18;
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];
const MAX_DEPTH = 6;
const FORBIDDEN = -1e6;
const BENCH_GAMES = { RB: [2.6, 1.6, 0.9, 0.5], WR: [2.6, 1.6, 0.9, 0.5], TE: [1.6, 0.4], QB: [1.9, 0.2] };
const WAIVER_DEPTH_PER_TEAM = { QB: 1.4, RB: 3.6, WR: 4.2, TE: 1.3, DST: 1, K: 1 };
const ROSTER_CAPS = { QB: 2, TE: 2, DST: 1, K: 1 };
const NO_WAIVER = Object.freeze(Object.fromEntries(POSITIONS.map((position) => [position, 0])));

export function missRate(player) {
  return 0.03 + clamp(player.risk ?? 30) / 100 * 0.1;
}

export function playerPpg(player) {
  if (Number.isFinite(player.ppg) && player.ppg > 0) return player.ppg;
  const projection = player.projectionValue ?? Math.max(0, 101 - player.v31Rank);
  const scale = { QB: 0.22, RB: 0.2, WR: 0.19, TE: 0.15, DST: 0.09, K: 0.1 }[player.position] ?? 0.15;
  return Math.max(0, projection * scale);
}

export function effectivePpg(player) {
  return playerPpg(player) * (1 - missRate(player));
}

function slotsFor(settings) {
  const slots = [];
  for (const position of POSITIONS) {
    for (let index = 0; index < (settings.starters[position] ?? 0); index += 1) {
      slots.push({ slot: `${position}${index + 1}`, position, eligible: [position] });
    }
  }
  for (let index = 0; index < (settings.starters.FLEX ?? 0); index += 1) {
    slots.push({ slot: `FLEX${index + 1}`, position: 'FLEX', eligible: FLEX_POSITIONS });
  }
  return slots;
}

export function fillLineup(rosterPlayers, settings = DEFAULT_SETTINGS) {
  const slots = slotsFor(settings);
  const remaining = [...rosterPlayers].sort((a, b) => effectivePpg(b) - effectivePpg(a));
  const starters = [];
  const openSlots = [];
  for (const slot of slots.filter((candidate) => candidate.position !== 'FLEX')) {
    const index = remaining.findIndex((player) => player.position === slot.position);
    if (index === -1) openSlots.push(slot);
    else starters.push({ ...slot, player: remaining.splice(index, 1)[0] });
  }
  for (const slot of slots.filter((candidate) => candidate.position === 'FLEX')) {
    const index = remaining.findIndex((player) => slot.eligible.includes(player.position));
    if (index === -1) openSlots.push(slot);
    else starters.push({ ...slot, player: remaining.splice(index, 1)[0] });
  }
  return { starters, bench: remaining, openSlots };
}

export function waiverLevels(players, settings = DEFAULT_SETTINGS) {
  const levels = {};
  for (const position of POSITIONS) {
    const pool = players
      .filter((player) => player.position === position && player.status === 'ACTIVE')
      .sort((a, b) => effectivePpg(b) - effectivePpg(a));
    const index = Math.round(settings.teams * WAIVER_DEPTH_PER_TEAM[position]);
    levels[position] = pool[Math.min(index, pool.length - 1)] ? effectivePpg(pool[Math.min(index, pool.length - 1)]) : 0;
  }
  return levels;
}

function coverValue(player, waiver) {
  return Math.max(0, effectivePpg(player) - (waiver[player.position] ?? 0));
}

function bestCover(slot, bench, week, used, waiver) {
  let best = null;
  for (const player of bench) {
    if (used.has(player.id) || !slot.eligible.includes(player.position)) continue;
    if (week !== null && player.bye === week) continue;
    if (!best || coverValue(player, waiver) > coverValue(best, waiver)) best = player;
  }
  return best;
}

export function rosterSeasonValue(rosterPlayers, settings = DEFAULT_SETTINGS, waiver = NO_WAIVER) {
  const lineup = fillLineup(rosterPlayers, settings);
  let total = 0;
  for (let week = 1; week <= SEASON_WEEKS; week += 1) {
    const used = new Set();
    for (const starter of lineup.starters) {
      if (starter.player.bye === week) {
        const cover = bestCover(starter, lineup.bench, week, used, waiver);
        if (cover) {
          used.add(cover.id);
          total += coverValue(cover, waiver);
        }
      } else {
        total += effectivePpg(starter.player);
      }
    }
  }
  for (const starter of lineup.starters) {
    const cover = bestCover(starter, lineup.bench, null, new Set(), waiver);
    if (cover) total += missRate(starter.player) * GAMES * coverValue(cover, waiver);
  }
  return { total, lineup };
}

export function byeConflicts(rosterPlayers) {
  const conflicts = [];
  const byBye = new Map();
  for (const player of rosterPlayers) {
    if (!player.bye) continue;
    if (!byBye.has(player.bye)) byBye.set(player.bye, []);
    byBye.get(player.bye).push(player);
  }
  for (const [bye, players] of [...byBye.entries()].sort((a, b) => a[0] - b[0])) {
    if (players.length < 2) continue;
    const positions = new Map();
    for (const player of players) {
      positions.set(player.position, (positions.get(player.position) ?? 0) + 1);
    }
    const samePosition = [...positions.entries()].filter(([, count]) => count > 1).map(([position]) => position);
    conflicts.push({ bye, players, samePosition });
  }
  return conflicts;
}

function survival(player, currentPick, targetPick, multiplier) {
  return 1 - goneProbability(player, currentPick, targetPick, multiplier);
}

function horizonMultiplier(base, stepIndex) {
  return 1 + (base - 1) * (0.6 ** stepIndex);
}

export function expectedPositionValues(pool, position, currentPick, futurePicks, demand = 1, depth = MAX_DEPTH) {
  const sorted = pool
    .filter((player) => player.position === position && player.status === 'ACTIVE')
    .sort((a, b) => effectivePpg(b) - effectivePpg(a));
  return futurePicks.map((targetPick, stepIndex) => {
    const multiplier = horizonMultiplier(demand, stepIndex);
    const values = new Array(depth + 1).fill(0);
    let distribution = new Array(depth + 1).fill(0);
    distribution[0] = 1;
    for (const player of sorted) {
      const alive = survival(player, currentPick, targetPick, multiplier);
      const value = effectivePpg(player);
      for (let n = 1; n <= depth; n += 1) values[n] += value * alive * distribution[n - 1];
      const next = new Array(depth + 1).fill(0);
      for (let n = 0; n <= depth; n += 1) {
        next[n] += distribution[n] * (1 - alive);
        if (n + 1 <= depth) next[n + 1] += distribution[n] * alive;
      }
      distribution = next;
    }
    return values;
  });
}

function hungarianMax(values) {
  const rows = values.length;
  const cols = Math.max(rows, values[0]?.length ?? 0);
  if (!rows) return [];
  const cost = values.map((row) => Array.from({ length: cols }, (_, j) => -(row[j] ?? 0)));
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(rows + 1).fill(0);
  const v = new Array(cols + 1).fill(0);
  const p = new Array(cols + 1).fill(0);
  const way = new Array(cols + 1).fill(0);
  for (let i = 1; i <= rows; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(cols + 1).fill(INF);
    const used = new Array(cols + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= cols; j += 1) {
        if (used[j]) continue;
        const current = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (current < minv[j]) {
          minv[j] = current;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= cols; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assignment = new Array(rows).fill(-1);
  for (let j = 1; j <= cols; j += 1) {
    if (p[j]) assignment[p[j] - 1] = j - 1 < (values[0]?.length ?? 0) ? j - 1 : -1;
  }
  return assignment;
}

function benchSlotOptions(benchIndex, starterCounts, openCounts) {
  const options = [];
  for (const position of ['RB', 'WR', 'TE', 'QB']) {
    const depthIndex = ['RB', 'WR'].includes(position) ? Math.floor(benchIndex / 2) : benchIndex;
    const games = BENCH_GAMES[position][depthIndex];
    if (games === undefined) continue;
    options.push({
      position,
      n: starterCounts[position] + (openCounts[position] ?? 0) + depthIndex + 1,
      games,
    });
  }
  return options;
}

function planRemainingPicks(context, rosterPlayers, expectations) {
  const { settings, futurePicks, waiver } = context;
  const lineup = fillLineup(rosterPlayers, settings);
  const starterCounts = Object.fromEntries(POSITIONS.map((position) => [
    position,
    lineup.starters.filter((starter) => starter.player.position === position).length
      + lineup.bench.filter((player) => player.position === position).length,
  ]));
  const openCounts = {};
  const slots = lineup.openSlots.map((slot) => {
    const eligible = slot.eligible.map((position) => {
      openCounts[position] = (openCounts[position] ?? 0) + 1;
      return { position, n: starterCounts[position] + openCounts[position], games: GAMES };
    });
    return { slot: slot.slot, options: eligible, starter: true };
  });
  const benchNeeded = Math.max(0, futurePicks.length - slots.length);
  for (let index = 0; index < benchNeeded; index += 1) {
    slots.push({
      slot: `BENCH${index + 1}`,
      options: benchSlotOptions(index, starterCounts, openCounts),
      starter: false,
    });
  }
  if (!slots.length || !futurePicks.length) return { total: 0, picks: [] };

  const lateEnough = (position, pick) => !['DST', 'K'].includes(position)
    || roundForPick(pick, settings.teams) >= settings.kDstStartRound;
  const evaluate = (slot, stepIndex) => {
    let best = { value: 0, position: null, expectedPpg: 0 };
    for (const option of slot.options) {
      if (!lateEnough(option.position, futurePicks[stepIndex])) continue;
      const expectedPpg = expectations[option.position]?.[stepIndex]?.[Math.min(option.n, MAX_DEPTH)] ?? 0;
      const usable = slot.starter ? expectedPpg : Math.max(0, expectedPpg - waiver[option.position]);
      const value = usable * option.games;
      if (value > best.value) best = { value, position: option.position, expectedPpg };
    }
    if (slot.starter && !best.position) return { value: FORBIDDEN, position: null, expectedPpg: 0 };
    return best;
  };
  const matrix = slots.map((slot) => futurePicks.map((_, stepIndex) => evaluate(slot, stepIndex)));
  const assignment = hungarianMax(matrix.map((row) => row.map((cell) => cell.value)));
  const picks = [];
  let total = 0;
  assignment.forEach((stepIndex, slotIndex) => {
    if (stepIndex < 0) return;
    const cell = matrix[slotIndex][stepIndex];
    if (cell.value <= FORBIDDEN / 2) return;
    total += cell.value;
    picks.push({
      pick: futurePicks[stepIndex],
      round: roundForPick(futurePicks[stepIndex], settings.teams),
      slot: slots[slotIndex].slot,
      position: cell.position ?? 'DEPTH',
      expectedPpg: cell.expectedPpg,
      starter: slots[slotIndex].starter,
    });
  });
  picks.sort((a, b) => a.pick - b.pick);
  return { total, picks };
}

function candidatePool(derived, round, settings, v31, reachPick = null) {
  const active = derived.available.filter((player) => player.status === 'ACTIVE');
  const capped = active.filter((player) => (
    !['DST', 'K'].includes(player.position) || round >= settings.kDstStartRound
  ) && (derived.myCounts[player.position] ?? 0) < (ROSTER_CAPS[player.position] ?? Infinity));
  const eligible = capped.length ? capped : active;
  const chosen = new Map();
  for (const position of POSITIONS) {
    eligible
      .filter((player) => player.position === position)
      .sort((a, b) => effectivePpg(b) - effectivePpg(a) || a.adp - b.adp)
      .slice(0, 5)
      .forEach((player) => chosen.set(player.id, player));
  }
  eligible
    .sort((a, b) => a.adp - b.adp)
    .slice(0, 8)
    .forEach((player) => chosen.set(player.id, player));
  if (reachPick) {
    // Off the clock: also weigh players the market expects to be there at my pick.
    const window = settings.teams * 0.75;
    for (const position of POSITIONS) {
      eligible
        .filter((player) => player.position === position && Math.abs(player.adp - reachPick) <= window)
        .sort((a, b) => effectivePpg(b) - effectivePpg(a) || a.adp - b.adp)
        .slice(0, 4)
        .forEach((player) => chosen.set(player.id, player));
    }
  }
  for (const result of v31) {
    if (eligible.some((player) => player.id === result.player.id)) chosen.set(result.player.id, result.player);
  }
  return [...chosen.values()];
}

function buildReasons(candidate, context) {
  const { player, plan, byeWarnings, nextDrop, nextGone, baselineDelta, reachGone } = candidate;
  const reasons = [];
  if (context.currentPick && reachGone > 0) {
    reasons.push(`${Math.round((1 - reachGone) * 100)}% chance still there at #${context.currentPick}`);
  }
  if (nextDrop >= 1.5) reasons.push(`${player.position} drops ~${nextDrop.toFixed(1)} ppg by your next pick`);
  if (nextGone >= 0.6) reasons.push(`${Math.round(nextGone * 100)}% gone before your next turn`);
  if (player.position === 'QB' && nextDrop >= 1) reasons.push('elite QB edge carries every week');
  if (baselineDelta > 0.5 && context.baseline && context.baseline.player.id !== player.id) {
    reasons.push(`+${baselineDelta.toFixed(0)} season pts vs ${context.baseline.player.name}`);
  }
  const nextPlan = plan.picks.find((pick) => pick.starter) ?? plan.picks[0];
  if (nextPlan) reasons.push(`next: ${nextPlan.position} in R${nextPlan.round}`);
  for (const warning of byeWarnings) reasons.push(warning);
  if (!reasons.length) reasons.push('best projected roster through the draft');
  return reasons.slice(0, 4);
}

function byeWarningsFor(player, rosterPlayers) {
  const warnings = [];
  const sameBye = rosterPlayers.filter((teammate) => teammate.bye && teammate.bye === player.bye);
  const samePosition = sameBye.filter((teammate) => teammate.position === player.position);
  if (samePosition.length) {
    warnings.push(`same bye (wk ${player.bye}) as ${samePosition.map((teammate) => teammate.name).join(', ')}`);
  } else if (sameBye.length >= 2) {
    warnings.push(`bye week ${player.bye} already stacked (${sameBye.length})`);
  }
  return warnings;
}

export function planPick(players, state, settings = DEFAULT_SETTINGS, limit = 9) {
  const derived = deriveDraftState(players, state, settings);
  const maxPick = settings.teams * settings.rounds;
  if (state.pickNumber > maxPick) return null;
  const round = roundForPick(state.pickNumber, settings.teams);
  const onClock = teamOnClock(state.pickNumber, settings.teams) === settings.mySlot;
  const mine = myPickNumbers(settings.mySlot, settings.teams, settings.rounds);
  const currentPick = onClock ? state.pickNumber : (mine.find((pick) => pick > state.pickNumber) ?? state.pickNumber);
  const futurePicks = mine.filter((pick) => pick > currentPick);
  const rosterPlayers = derived.myIds.map((id) => derived.playersById[id]).filter(Boolean);
  const demand = demandMultipliers(state, derived, settings);
  const waiver = waiverLevels(players, settings);
  const v31 = recommend(players, state, settings, 12);
  const baselineResult = v31[0] ?? null;
  const context = { settings, futurePicks, waiver, currentPick: state.pickNumber };

  const expectations = Object.fromEntries(POSITIONS.map((position) => [
    position,
    expectedPositionValues(derived.available, position, state.pickNumber, futurePicks, demand[position]),
  ]));
  const currentValue = rosterSeasonValue(rosterPlayers, settings, waiver).total;

  const evaluate = (player) => {
    const pool = derived.available.filter((candidate) => candidate.id !== player.id);
    const adjusted = {
      ...expectations,
      [player.position]: expectedPositionValues(pool, player.position, state.pickNumber, futurePicks, demand[player.position]),
    };
    const roster = [...rosterPlayers, player];
    const base = rosterSeasonValue(roster, settings, waiver);
    const plan = planRemainingPicks(context, roster, adjusted);
    const nextExpected = expectations[player.position]?.[0]?.[1] ?? 0;
    const nextPick = futurePicks[0] ?? null;
    return {
      player,
      total: base.total + plan.total,
      rosterValue: base.total,
      plannedValue: plan.total,
      plan,
      lineup: base.lineup,
      nextDrop: nextPick ? effectivePpg(player) - nextExpected : 0,
      nextGone: nextPick ? goneProbability(player, state.pickNumber, nextPick, demand[player.position]) : 0.98,
      reachGone: onClock ? 0 : goneProbability(player, state.pickNumber, currentPick, demand[player.position]),
      byeWarnings: byeWarningsFor(player, rosterPlayers),
      v31: v31.find((result) => result.player.id === player.id) ?? null,
    };
  };

  const candidates = candidatePool(derived, round, settings, v31, onClock ? null : currentPick).map(evaluate);
  let baseline = null;
  if (baselineResult) {
    baseline = candidates.find((candidate) => candidate.player.id === baselineResult.player.id)
      ?? evaluate(baselineResult.player);
  }
  // Off the clock, a player who will not survive to my pick is not a usable target:
  // discount each branch's edge over the weakest candidate by its chance of being gone.
  const floor = Math.min(...candidates.map((candidate) => candidate.total));
  const sorted = candidates
    .map((candidate) => ({
      ...candidate,
      expectedTotal: candidate.total - candidate.reachGone * (candidate.total - floor),
      baselineDelta: baseline ? candidate.total - baseline.total : 0,
      gain: candidate.total - currentValue,
    }))
    .sort((a, b) => b.expectedTotal - a.expectedTotal
      || (b.v31?.score ?? 0) - (a.v31?.score ?? 0)
      || a.player.v31Rank - b.player.v31Rank
      || a.player.name.localeCompare(b.player.name));
  const ranked = sorted.map((candidate) => ({
    ...candidate,
    reasons: buildReasons(candidate, { baseline, currentPick: onClock ? null : currentPick }),
  }));

  const outlook = Object.fromEntries(POSITIONS.map((position) => {
    const bestNow = derived.available
      .filter((player) => player.position === position && player.status === 'ACTIVE')
      .sort((a, b) => effectivePpg(b) - effectivePpg(a))[0] ?? null;
    return [position, {
      bestNow,
      nowPpg: bestNow ? effectivePpg(bestNow) : 0,
      nextPpg: expectations[position]?.[0]?.[1] ?? 0,
      laterPpg: expectations[position]?.[1]?.[1] ?? 0,
      bestNowGone: bestNow && futurePicks[0]
        ? goneProbability(bestNow, state.pickNumber, futurePicks[0], demand[position])
        : 0.98,
    }];
  }));

  return {
    onClock,
    currentPick,
    futurePicks,
    round,
    currentValue,
    best: ranked[0] ?? null,
    candidates: ranked.slice(0, limit),
    baseline,
    outlook,
    byeConflicts: byeConflicts(rosterPlayers),
    demand,
    waiver,
  };
}
