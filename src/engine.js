export const DEFAULT_SETTINGS = {
  teams: 12,
  rounds: 16,
  mySlot: 1,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 },
  bench: 6,
};

export function teamOnClock(pickNumber, teams = 12) {
  const round = Math.floor((pickNumber - 1) / teams) + 1;
  const inRound = (pickNumber - 1) % teams;
  return round % 2 === 1 ? inRound + 1 : teams - inRound;
}

export function roundForPick(pickNumber, teams = 12) {
  return Math.floor((pickNumber - 1) / teams) + 1;
}

export function myPickNumbers(slot, teams = 12, rounds = 16) {
  const picks = [];
  for (let round = 1; round <= rounds; round++) {
    const start = (round - 1) * teams;
    const within = round % 2 === 1 ? slot : teams - slot + 1;
    picks.push(start + within);
  }
  return picks;
}

export function nextMyPick(currentPick, slot, teams = 12, rounds = 16) {
  return myPickNumbers(slot, teams, rounds).find(p => p >= currentPick) ?? null;
}

export function countPositions(playersById, ids) {
  const counts = { QB:0,RB:0,WR:0,TE:0,DST:0,K:0 };
  for (const id of ids) {
    const p = playersById[id];
    if (p) counts[p.position] = (counts[p.position] || 0) + 1;
  }
  return counts;
}

export function rosterNeedScore(position, counts, round) {
  const starterTarget = { QB:1,RB:2,WR:2,TE:1,DST:1,K:1 };
  const need = Math.max(0, (starterTarget[position] || 0) - (counts[position] || 0));
  let score = need * 28;
  if (position === 'RB' || position === 'WR') score += Math.max(0, 12 - round) * 0.9;
  if (position === 'QB' && counts.QB >= 1 && round < 11) score -= 35;
  if (position === 'TE' && counts.TE >= 1 && round < 11) score -= 20;
  if ((position === 'DST' || position === 'K') && round < 13) score -= 55;
  return score;
}

export function adpValueScore(player, pickNumber) {
  const delta = (player.adp ?? pickNumber) - pickNumber; // positive means likely available later
  if (delta > 30) return -16; // reach now
  if (delta > 15) return -8;
  if (delta > 5) return -2;
  if (delta < -25) return 20; // fell a lot
  if (delta < -12) return 12;
  if (delta < -5) return 6;
  return 0;
}

export function goneProbability(player, currentPick, nextPick, demandMultiplier = 1) {
  if (!nextPick || nextPick <= currentPick) return 1;
  const gap = nextPick - currentPick;
  const adp = player.adp ?? currentPick;
  const sd = player.adpSd ?? Math.max(7, adp * 0.14);
  const z = (nextPick - adp) / sd;
  const logistic = 1 / (1 + Math.exp(-1.7 * z));
  const gapPressure = Math.min(0.22, gap * 0.012);
  return Math.max(0.02, Math.min(0.98, (logistic + gapPressure) * demandMultiplier));
}

export function tierCliffScore(player, availableAtPosition) {
  const sameTier = availableAtPosition.filter(p => p.tier === player.tier);
  const nextTier = availableAtPosition.filter(p => p.tier > player.tier).sort((a,b)=>a.tier-b.tier || b.projectionValue-a.projectionValue);
  if (!nextTier.length) return 8;
  const next = nextTier[0];
  const cliff = Math.max(0, (player.projectionValue ?? 50) - (next.projectionValue ?? 50));
  // Same-tier players share the same tier-state bonus; never reward lower-ranked members simply for being last in tier.
  const tierAvailabilityPressure = sameTier.length <= 2 ? 5 : sameTier.length <= 4 ? 2 : 0;
  return Math.min(16, cliff * 1.5 + tierAvailabilityPressure);
}

export function dynamicScore(player, ctx) {
  if (player.status !== 'ACTIVE' || ctx.draftedIds.has(player.id)) return -Infinity;
  const round = roundForPick(ctx.pickNumber, ctx.settings.teams);
  const counts = ctx.myCounts;
  const posPool = ctx.available.filter(p => p.position === player.position && p.status === 'ACTIVE');
  const need = rosterNeedScore(player.position, counts, round);
  const adp = adpValueScore(player, ctx.pickNumber);
  const gone = goneProbability(player, ctx.pickNumber, ctx.nextMyPick, ctx.demandByPosition?.[player.position] ?? 1);
  const cliff = tierCliffScore(player, posPool);
  const projection = player.projectionValue ?? Math.max(0, 101 - player.v31Rank);
  const upside = player.upside ?? 50;
  const riskPenalty = Math.max(0, (player.risk ?? 25) - 45) * 0.18;
  const flexibility = ['RB','WR','TE'].includes(player.position) ? 5 : 0;
  const saturation = (player.position === 'QB' && counts.QB >= 1 && round < 11) ? 18 :
                     (player.position === 'TE' && counts.TE >= 1 && round < 11) ? 10 : 0;

  return (
    0.34 * projection +
    0.18 * Math.max(0, projection - 55) +
    0.12 * need +
    0.10 * cliff +
    0.10 * (50 + adp) +
    0.08 * (gone * 100) +
    0.04 * (50 + flexibility) +
    0.04 * upside -
    saturation -
    riskPenalty
  );
}

export function recommend(players, state, settings = DEFAULT_SETTINGS, limit = 8) {
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  const draftedIds = new Set(state.events.map(e => e.playerId));
  const myIds = state.events.filter(e => e.owner === 'ME').map(e => e.playerId);
  const myCounts = countPositions(byId, myIds);
  const available = players.filter(p => !draftedIds.has(p.id));
  const nextPick = nextMyPick(state.pickNumber, settings.mySlot, settings.teams, settings.rounds);
  const ctx = {
    settings, pickNumber: state.pickNumber, nextMyPick: nextPick,
    draftedIds, myCounts, available,
    demandByPosition: state.demandByPosition || {}
  };
  return available
    .map(player => ({ player, score: dynamicScore(player, ctx), gone: goneProbability(player, state.pickNumber, nextPick, state.demandByPosition?.[player.position] ?? 1) }))
    .filter(x => Number.isFinite(x.score))
    .sort((a,b) => b.score - a.score)
    .slice(0, limit);
}
