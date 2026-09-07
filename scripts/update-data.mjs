import { readFile, writeFile } from 'node:fs/promises';

const YEAR = 2026;
const DATA_URL = `https://fantasyfootballcalculator.com/api/v1/adp/ppr?position=all&teams=12&year=${YEAR}`;
const seed = JSON.parse(await readFile(new URL('../data/players.seed.json', import.meta.url)));
const availability = JSON.parse(
  await readFile(new URL('../data/availability.json', import.meta.url)),
);
const seedByName = new Map(seed.map((player) => [normalizeName(player.name), player]));
const availabilityByName = new Map(
  availability.players.map((player) => [normalizeName(player.name), player]),
);

const response = await fetch(DATA_URL, {
  headers: { 'user-agent': 'fantasy-draft-engine/1.0' },
});
if (!response.ok) throw new Error(`ADP request failed: ${response.status}`);
const payload = await response.json();
if (!Array.isArray(payload.players) || payload.players.length < 192) {
  throw new Error(`ADP response only contained ${payload.players?.length ?? 0} players`);
}

const positionRanks = {};
const players = payload.players.map((source, index) => {
  const position = source.position === 'DEF' ? 'DST' : source.position === 'PK' ? 'K' : source.position;
  positionRanks[position] = (positionRanks[position] ?? 0) + 1;
  const positionRank = positionRanks[position];
  const override = seedByName.get(normalizeName(source.name));
  const currentAvailability = availabilityByName.get(normalizeName(source.name));
  const baselineRank = index + 1;
  const projectionValue = Math.round((100 - 15 * Math.log(1 + baselineRank / 8)) * 10) / 10;
  const baselineNotes = override?.notes ?? ['2026 PPR market-baseline fallback'];

  return {
    id: override?.id ?? slugify(source.name),
    name: source.name,
    team: source.team,
    position,
    bye: source.bye,
    v31Rank: override?.v31Rank ?? baselineRank,
    positionRank: override?.positionRank ?? positionRank,
    tier: override?.tier ?? tierFor(position, positionRank),
    projectionValue: override?.projectionValue ?? Math.max(32, projectionValue),
    adp: source.adp,
    adpSd: source.stdev,
    upside: override?.upside ?? upsideFor(position, positionRank, baselineRank),
    risk: currentAvailability?.risk ?? override?.risk ?? 30,
    status: currentAvailability?.status ?? override?.status ?? 'ACTIVE',
    notes: [...new Set([...baselineNotes, ...(currentAvailability?.notes ?? [])])],
    availabilityNotes: currentAvailability?.notes,
    dataSource: [
      override ? 'V3.1 seed + 2026 PPR ADP' : '2026 PPR ADP baseline',
      currentAvailability ? 'manual availability review' : null,
    ].filter(Boolean).join(' + '),
  };
});

for (const seeded of seed) {
  if (!players.some((player) => player.id === seeded.id)) {
    players.push({
      ...seeded,
      dataSource: 'V3.1 seed only',
    });
  }
}

players.sort((a, b) => a.v31Rank - b.v31Rank || a.adp - b.adp || a.name.localeCompare(b.name));
const snapshotDate = new Date().toISOString();
await writeFile(
  new URL('../data/players.json', import.meta.url),
  `${JSON.stringify(players, null, 2)}\n`,
);
await writeFile(
  new URL('../data/metadata.json', import.meta.url),
  `${JSON.stringify({
    snapshotDate,
    season: YEAR,
    scoring: 'Full PPR',
    leagueSize: 12,
    playerCount: players.length,
    adpSource: DATA_URL,
    availabilityReviewedAt: availability.reviewedAt,
    availabilitySources: availability.sources,
    methodology: 'V3.1 seed overrides merged onto a current market/ADP baseline',
  }, null, 2)}\n`,
);
console.log(`Wrote ${players.length} players (${snapshotDate})`);

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slugify(value) {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function tierFor(position, rank) {
  const boundaries = {
    QB: [3, 8, 15, 22],
    RB: [5, 13, 26, 42, 58],
    WR: [6, 15, 30, 50, 72],
    TE: [3, 8, 15, 22],
    DST: [3, 8, 15, 22],
    K: [3, 8, 15, 22],
  }[position] ?? [5, 15, 30, 50];
  const boundaryIndex = boundaries.findIndex((boundary) => rank <= boundary);
  return boundaryIndex === -1 ? boundaries.length + 1 : boundaryIndex + 1;
}

function upsideFor(position, positionRank, overallRank) {
  const positionBonus = ['RB', 'WR'].includes(position) ? 8 : position === 'QB' ? 5 : 2;
  const lateRoundBonus = overallRank > 100 ? 8 : overallRank > 60 ? 4 : 0;
  return Math.max(42, Math.min(94, 88 - positionRank * 1.2 + positionBonus + lateRoundBonus));
}
