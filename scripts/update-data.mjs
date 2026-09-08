import { readFile, writeFile } from 'node:fs/promises';

const YEAR = 2026;
const GAMES = 17;
const ESPN_UNDRAFTED_ADP = 169;
const DATA_URL = `https://fantasyfootballcalculator.com/api/v1/adp/ppr?position=all&teams=12&year=${YEAR}`;
const ESPN_PLAYERS_URL = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${YEAR}/segments/0/leaguedefaults/3?view=kona_player_info`;
const ESPN_TEAMS_URL = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${YEAR}?view=proTeamSchedules_wl`;
const PRIOR_YEAR = YEAR - 1;
const PRIOR_WEEKS = 18;
const ESPN_PRIOR_PLAYERS_URL = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${PRIOR_YEAR}/segments/0/leaguedefaults/3?view=kona_player_info&scoringPeriodId=${PRIOR_WEEKS}`;
const ESPN_PRIOR_TEAMS_URL = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${PRIOR_YEAR}?view=proTeamSchedules_wl`;
const ESPN_PRIOR_FILTER = {
  players: {
    filterSlotIds: { value: [0, 2, 4, 6, 17, 16] },
    limit: 900,
    sortPercOwned: { sortAsc: false, sortPriority: 1 },
  },
};
const ESPN_FILTER = {
  players: {
    filterSlotIds: { value: [0, 2, 4, 6, 17, 16] },
    limit: 450,
    sortPercOwned: { sortAsc: false, sortPriority: 1 },
    filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`00${YEAR}`, `10${YEAR}`] },
  },
};
const ESPN_POSITIONS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const TEAM_ALIASES = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
const ESPN_EXCLUDED_STATUSES = new Set(['OUT', 'INJURY_RESERVE', 'SUSPENSION']);
const ESPN_QUESTIONABLE_STATUSES = new Set(['QUESTIONABLE', 'DOUBTFUL', 'DAY_TO_DAY']);

const seed = JSON.parse(await readFile(new URL('../data/players.seed.json', import.meta.url)));
const availability = JSON.parse(
  await readFile(new URL('../data/availability.json', import.meta.url)),
);
const previous = JSON.parse(await readFile(new URL('../data/players.json', import.meta.url)));
const previousIdByName = new Map(previous.map((player) => [normalizeName(player.name), player.id]));
const seedByName = new Map(seed.map((player) => [normalizeName(player.name), player]));
const availabilityByName = new Map(
  availability.players.map((player) => [normalizeName(player.name), player]),
);

const [ffcPayload, espnPayload, espnTeamsPayload, priorPlayersPayload, priorTeamsPayload] = await Promise.all([
  fetchJson(DATA_URL),
  fetchJson(ESPN_PLAYERS_URL, { 'x-fantasy-filter': JSON.stringify(ESPN_FILTER) }),
  fetchJson(ESPN_TEAMS_URL),
  fetchJson(ESPN_PRIOR_PLAYERS_URL, { 'x-fantasy-filter': JSON.stringify(ESPN_PRIOR_FILTER) }),
  fetchJson(ESPN_PRIOR_TEAMS_URL),
]);
if (!Array.isArray(ffcPayload.players) || ffcPayload.players.length < 192) {
  throw new Error(`ADP response only contained ${ffcPayload.players?.length ?? 0} players`);
}
if (!Array.isArray(espnPayload.players) || espnPayload.players.length < 300) {
  throw new Error(`ESPN response only contained ${espnPayload.players?.length ?? 0} players`);
}

const espnTeams = new Map(
  (espnTeamsPayload.settings?.proTeams ?? []).map((team) => [team.id, {
    abbrev: TEAM_ALIASES[team.abbrev] ?? team.abbrev,
    bye: team.byeWeek || null,
  }]),
);
const byeByTeam = new Map([...espnTeams.values()].map((team) => [team.abbrev, team.bye]));

const espnRows = espnPayload.players
  .map((entry) => {
    const source = entry.player;
    const position = ESPN_POSITIONS[source.defaultPositionId];
    const team = espnTeams.get(source.proTeamId);
    const projection = (source.stats ?? []).find(
      (stat) => stat.seasonId === YEAR && stat.statSourceId === 1 && stat.scoringPeriodId === 0,
    );
    const adp = Number(source.ownership?.averageDraftPosition);
    return {
      espnId: source.id,
      name: source.fullName,
      position,
      team: team?.abbrev ?? 'FA',
      bye: team?.bye ?? null,
      projectedPoints: Number(projection?.appliedTotal ?? 0),
      espnAdp: Number.isFinite(adp) && adp < ESPN_UNDRAFTED_ADP ? adp : null,
      espnRank: source.draftRanksByRankType?.PPR?.rank ?? null,
      percentOwned: Number(source.ownership?.percentOwned ?? 0),
      injuryStatus: source.injuryStatus ?? 'ACTIVE',
      key: position === 'DST' ? `dst-${team?.abbrev}` : normalizeName(source.fullName),
    };
  })
  .filter((row) => row.position && row.team !== 'FA');
const espnByKey = new Map(espnRows.map((row) => [row.key, row]));

const ffcRows = ffcPayload.players.map((source) => {
  const position = source.position === 'DEF' ? 'DST' : source.position === 'PK' ? 'K' : source.position;
  const team = TEAM_ALIASES[source.team] ?? source.team;
  return {
    name: source.name,
    position,
    team,
    bye: source.bye,
    ffcAdp: source.adp,
    ffcSd: source.stdev,
    key: position === 'DST' ? `dst-${team}` : normalizeName(source.name),
  };
}).filter((row) => row.team !== 'FA');
const ffcByKey = new Map(ffcRows.map((row) => [row.key, row]));

const keys = new Set([
  ...ffcRows.map((row) => row.key),
  ...espnRows
    .filter((row) => row.espnAdp !== null || row.projectedPoints > 0)
    .map((row) => row.key),
]);

const merged = [...keys].map((key) => {
  const espn = espnByKey.get(key);
  const ffc = ffcByKey.get(key);
  const name = espn?.name ?? ffc.name;
  const position = espn?.position ?? ffc.position;
  const team = espn?.team ?? ffc.team;
  const adp = espn?.espnAdp ?? ffc?.ffcAdp ?? estimateAdpFromRank(espn?.espnRank);
  const adpSd = ffc?.ffcSd ?? Math.max(6, adp * 0.16);
  const override = seedByName.get(normalizeName(name));
  const currentAvailability = availabilityByName.get(normalizeName(name));
  const projectedPoints = round1(espn?.projectedPoints ?? 0);
  return {
    key,
    name,
    position,
    team,
    bye: espn?.bye ?? byeByTeam.get(team) ?? ffc?.bye ?? null,
    adp: round1(adp),
    adpSd: round1(adpSd),
    ffcAdp: ffc?.ffcAdp ?? null,
    espnAdp: espn?.espnAdp ?? null,
    espnRank: espn?.espnRank ?? null,
    espnId: espn?.espnId ?? null,
    injuryStatus: espn?.injuryStatus ?? 'UNKNOWN',
    projectedPoints,
    ppg: Math.round((projectedPoints / GAMES) * 100) / 100,
    legacyName: ffc?.name ?? name,
    override,
    currentAvailability,
  };
});

merged.sort((a, b) => a.adp - b.adp || b.projectedPoints - a.projectedPoints || a.name.localeCompare(b.name));

const positionRanks = {};
const players = merged.map((row, index) => {
  const { override, currentAvailability, position } = row;
  positionRanks[position] = (positionRanks[position] ?? 0) + 1;
  const positionRank = positionRanks[position];
  const baselineRank = index + 1;
  const projectionValue = Math.round((100 - 15 * Math.log(1 + baselineRank / 8)) * 10) / 10;
  const baselineNotes = override?.notes ?? [`${YEAR} PPR market-baseline fallback`];
  const availabilityStatus = resolveStatus(row, currentAvailability, override);
  const injuryNote = describeInjury(row.injuryStatus);
  const availabilityNotes = [
    ...(currentAvailability?.notes ?? []),
    ...(injuryNote ? [injuryNote] : []),
  ];

  return {
    id: override?.id ?? previousIdByName.get(normalizeName(row.name)) ?? slugify(row.legacyName),
    name: row.name,
    team: row.team,
    position,
    bye: row.bye,
    v31Rank: override?.v31Rank ?? baselineRank,
    positionRank: override?.positionRank ?? positionRank,
    tier: override?.tier ?? tierFor(position, positionRank),
    projectionValue: override?.projectionValue ?? Math.max(32, projectionValue),
    projectedPoints: row.projectedPoints,
    ppg: row.ppg,
    adp: row.adp,
    adpSd: row.adpSd,
    espnAdp: row.espnAdp,
    espnRank: row.espnRank,
    ffcAdp: row.ffcAdp,
    espnId: row.espnId,
    injuryStatus: row.injuryStatus,
    upside: override?.upside ?? upsideFor(position, positionRank, baselineRank),
    risk: availabilityStatus.risk,
    status: availabilityStatus.status,
    notes: [...new Set([...baselineNotes, ...availabilityNotes])],
    availabilityNotes: availabilityNotes.length ? availabilityNotes : undefined,
    dataSource: [
      override ? 'V3.1 seed' : null,
      row.espnId ? 'ESPN projections/ADP' : null,
      row.ffcAdp ? 'FFC PPR ADP' : null,
      currentAvailability ? 'manual availability review' : null,
    ].filter(Boolean).join(' + '),
  };
});

for (const seeded of seed) {
  if (!players.some((player) => player.id === seeded.id)) {
    players.push({
      ...seeded,
      projectedPoints: 0,
      ppg: 0,
      injuryStatus: 'UNKNOWN',
      dataSource: 'V3.1 seed only',
    });
  }
}

players.sort((a, b) => a.v31Rank - b.v31Rank || a.adp - b.adp || a.name.localeCompare(b.name));
assertUnique(players);
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
    adpSource: ESPN_PLAYERS_URL,
    secondaryAdpSource: DATA_URL,
    projectionSource: 'ESPN 2026 season projections (PPR default league)',
    availabilityReviewedAt: availability.reviewedAt,
    availabilitySources: availability.sources,
    methodology: 'V3.1 seed overrides merged onto ESPN projections + ESPN/FFC ADP; ESPN injury statuses applied',
  }, null, 2)}\n`,
);
const matchups = buildMatchups();
await writeFile(
  new URL('../data/matchups.json', import.meta.url),
  `${JSON.stringify(matchups, null, 2)}\n`,
);
console.log(`Wrote ${players.length} players (${snapshotDate})`);
console.log(`Wrote matchups for ${Object.keys(matchups.schedule).length} teams from ${matchups.basis}`);

/**
 * Defense-vs-position from last season's actual PPR points, plus this season's
 * weekly opponents. `defense[TEAM][POS]` is points allowed per game divided by
 * the league average for that position (1 = neutral); the planner shrinks it.
 */
function buildMatchups() {
  const teamAbbrev = (teams) => new Map(
    (teams.settings?.proTeams ?? [])
      .filter((team) => team.id !== 0)
      .map((team) => [team.id, TEAM_ALIASES[team.abbrev.toUpperCase()] ?? team.abbrev.toUpperCase()]),
  );
  const opponentsByWeek = (teams, abbrevs, weeks) => {
    const schedule = {};
    for (const team of teams.settings?.proTeams ?? []) {
      if (team.id === 0) continue;
      const rows = {};
      for (let week = 1; week <= weeks; week += 1) {
        const game = (team.proGamesByScoringPeriod?.[week] ?? [])[0];
        if (!game) { rows[week] = null; continue; }
        const home = game.homeProTeamId === team.id;
        const opponentId = home ? game.awayProTeamId : game.homeProTeamId;
        rows[week] = { opponent: abbrevs.get(opponentId) ?? null, home };
      }
      schedule[abbrevs.get(team.id)] = rows;
    }
    return schedule;
  };

  const priorAbbrevs = teamAbbrev(priorTeamsPayload);
  const priorSchedule = opponentsByWeek(priorTeamsPayload, priorAbbrevs, PRIOR_WEEKS);
  const allowed = {};
  const positionTotals = {};
  for (const entry of priorPlayersPayload.players ?? []) {
    const source = entry.player;
    const position = ESPN_POSITIONS[source.defaultPositionId];
    const team = priorAbbrevs.get(source.proTeamId);
    if (!position || !team) continue;
    for (const stat of source.stats ?? []) {
      if (stat.seasonId !== PRIOR_YEAR || stat.statSourceId !== 0 || stat.statSplitTypeId !== 1) continue;
      const points = Number(stat.appliedTotal ?? 0);
      const game = priorSchedule[team]?.[stat.scoringPeriodId];
      if (!game?.opponent || !Number.isFinite(points)) continue;
      allowed[game.opponent] ??= {};
      allowed[game.opponent][position] ??= { points: 0, weeks: new Set() };
      allowed[game.opponent][position].points += points;
      allowed[game.opponent][position].weeks.add(stat.scoringPeriodId);
      positionTotals[position] ??= { points: 0, games: 0 };
      positionTotals[position].points += points;
    }
  }
  for (const position of Object.keys(positionTotals)) {
    positionTotals[position].games = Object.values(allowed)
      .reduce((sum, byPosition) => sum + (byPosition[position]?.weeks.size ?? 0), 0);
  }
  const defense = {};
  for (const [team, byPosition] of Object.entries(allowed)) {
    defense[team] = {};
    for (const [position, { points, weeks }] of Object.entries(byPosition)) {
      const average = positionTotals[position].points / positionTotals[position].games;
      const perGame = points / weeks.size;
      defense[team][position] = weeks.size >= 8 && average > 0 ? Math.round((perGame / average) * 1000) / 1000 : 1;
    }
  }

  const currentAbbrevs = teamAbbrev(espnTeamsPayload);
  const schedule = opponentsByWeek(espnTeamsPayload, currentAbbrevs, PRIOR_WEEKS);
  if (Object.keys(defense).length < 30 || Object.keys(schedule).length < 30) {
    throw new Error(`Matchup data incomplete: ${Object.keys(defense).length} defenses, ${Object.keys(schedule).length} schedules`);
  }
  return {
    season: YEAR,
    basis: `${PRIOR_YEAR} ESPN PPR actual points allowed per position (regular season)`,
    generatedAt: snapshotDate,
    playoffWeeks: [15, 16, 17],
    schedule,
    defense,
  };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'fantasy-draft-engine/1.0', accept: 'application/json', ...headers },
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
  return response.json();
}

function resolveStatus(row, currentAvailability, override) {
  if (ESPN_EXCLUDED_STATUSES.has(row.injuryStatus)) {
    return { status: 'OUT', risk: Math.max(85, currentAvailability?.risk ?? 0) };
  }
  if (currentAvailability?.status || currentAvailability?.risk) {
    return {
      status: currentAvailability.status ?? override?.status ?? 'ACTIVE',
      risk: currentAvailability.risk ?? override?.risk ?? 30,
    };
  }
  const baseRisk = override?.risk ?? 30;
  return {
    status: override?.status ?? 'ACTIVE',
    risk: ESPN_QUESTIONABLE_STATUSES.has(row.injuryStatus) ? Math.max(baseRisk, 50) : baseRisk,
  };
}

function describeInjury(status) {
  return {
    OUT: 'ESPN lists as OUT',
    INJURY_RESERVE: 'ESPN lists on injured reserve',
    SUSPENSION: 'ESPN lists as suspended',
    QUESTIONABLE: 'ESPN lists as questionable',
    DOUBTFUL: 'ESPN lists as doubtful',
    DAY_TO_DAY: 'ESPN lists as day-to-day',
  }[status] ?? null;
}

function estimateAdpFromRank(rank) {
  return Math.max(ESPN_UNDRAFTED_ADP, Number(rank) || 400);
}

function assertUnique(list) {
  const ids = new Set();
  const names = new Set();
  for (const player of list) {
    if (ids.has(player.id)) throw new Error(`Duplicate id ${player.id}`);
    if (names.has(player.name.toLowerCase())) throw new Error(`Duplicate name ${player.name}`);
    ids.add(player.id);
    names.add(player.name.toLowerCase());
  }
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function normalizeName(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
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
