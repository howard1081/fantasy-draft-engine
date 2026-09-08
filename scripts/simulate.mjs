import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, deriveDraftState, roundForPick, teamOnClock } from '../src/engine.js';
import { planPick, rosterSeasonValue, byeConflicts, waiverLevels } from '../src/planner.js';
import { applyPick, createInitialState } from '../src/state.js';

const players = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
const teams = Number(process.argv[2] ?? 12);
const slot = Number(process.argv[3] ?? 1);
const verbose = process.argv.includes('--verbose');

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

let state = createInitialState({ ...DEFAULT_SETTINGS, teams, mySlot: slot });
const settings = state.settings;
const maxPick = settings.teams * settings.rounds;
const started = performance.now();
for (let pick = 1; pick <= maxPick; pick += 1) {
  const onClock = teamOnClock(pick, settings.teams);
  const round = roundForPick(pick, settings.teams);
  const derived = deriveDraftState(players, state, settings);
  if (onClock === slot) {
    const plan = planPick(players, state, settings);
    const chosen = plan.best.player;
    if (verbose) {
      console.log(`R${round} #${pick} -> ${chosen.name} (${chosen.position}, ${chosen.ppg} ppg, adp ${chosen.adp}) total=${plan.best.total.toFixed(0)} | ${plan.best.reasons.join(' · ')}`);
      console.log(`    plan: ${plan.best.plan.picks.map((p) => `R${p.round}:${p.position}(${p.expectedPpg.toFixed(1)})`).join(' ')}`);
      if (plan.baseline && plan.baseline.player.id !== chosen.id) {
        console.log(`    v3.1 best available: ${plan.baseline.player.name} total=${plan.baseline.total.toFixed(0)}`);
      }
    }
    state = applyPick(state, chosen.id, 'ME');
  } else {
    const chosen = opponentPick(derived.available, derived.teamCounts[onClock], round, settings);
    state = applyPick(state, chosen.id, 'OPPONENT');
  }
}
const derived = deriveDraftState(players, state, settings);
const roster = derived.myIds.map((id) => derived.playersById[id]);
const { total, lineup } = rosterSeasonValue(roster, settings, waiverLevels(players, settings));
console.log(`\n${teams}-team slot ${slot}: season value ${total.toFixed(0)} (${(performance.now() - started).toFixed(0)}ms)`);
for (const starter of lineup.starters) {
  console.log(`  ${starter.slot.padEnd(6)} ${starter.player.name.padEnd(24)} ${starter.player.ppg} ppg bye ${starter.player.bye}`);
}
console.log(`  bench: ${lineup.bench.map((p) => `${p.name} (${p.position} ${p.ppg}, bye ${p.bye})`).join(', ')}`);
console.log(`  bye conflicts: ${byeConflicts(roster).map((c) => `wk${c.bye}: ${c.players.map((p) => p.position).join('/')}${c.samePosition.length ? ` [${c.samePosition}]` : ''}`).join('; ') || 'none'}`);
