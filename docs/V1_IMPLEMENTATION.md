# V1 Implementation Notes

## Runtime
- Static ES modules, JSON data, CSS, and a service worker.
- No backend, authentication, build step, framework, or live draft-night network dependency.
- Draft state uses an append-only event list in `localStorage`.

## Recommendation context
For every pick, the engine derives:
- available players;
- the user's roster and positional counts;
- every opponent roster and positional counts;
- dynamic remaining-pool replacement values;
- shared position/tier cliff state;
- teams selecting before the user's next turn;
- soft positional demand for those opponents;
- recent position-run pressure;
- ADP discount/reach and survival probability.

The final score retains the V3.1 weights in `ALGORITHM_V3_1.md`. Named penalties cover roster saturation, reaches, concentrated known risk, and weak bye overlap. QB/receiver stacks and same-team RB contingency are small positive modifiers only.

## Reliability
- Every mutation is synchronous and immediately persisted.
- Duplicate selections are rejected.
- Imports are validated and normalized.
- Undo removes one event and exactly restores the prior pick number, availability, and all derived rosters.
- Static core assets and the player snapshot are cached after the first successful load.
- New service-worker versions precache with `cache: reload`, preventing the browser HTTP cache from seeding a new Cache Storage version with stale deployment bytes.
- Online navigations bypass the browser HTTP cache, check the network first, and fall back to the cached app offline. The client explicitly checks for worker updates and reloads once when a new worker takes control.
- Runtime caching stores only successful responses, so transient 404/error pages are not persisted for offline use.
- `refresh.html` is a recovery entry point that removes obsolete service-worker registrations and caches before reopening the current deployment.

## Data
`data/players.seed.json` is the supplied V3.1 override set. `data/availability.json` contains a timestamped manual review of current injury and transaction risk. `scripts/update-data.mjs` merges both with a current full-PPR ADP board and writes the draft-night snapshot to `data/players.json`. Fallback players and manually reviewed rows are explicitly labeled in `dataSource`; reviewed notes are also copied to `availabilityNotes` for concise rendering throughout the draft UI.

## Quick Taken
`searchAvailable` ranks available players by name-prefix match, then V3.1 rank, capped at eight rows. The UI collapses the board and available list while a query is active, so the only visible actions are the matching players. Submitting the field marks the top match taken; every quick action clears the query and returns to the full board.

## League size
Supported league sizes are 10, 12, 14, and 16 teams with 10-20 rounds. The September 7 draft-night snapshot has 262 ACTIVE players, so a 16-team, 16-round draft leaves six fallback selections.

## Lookahead planner
`src/planner.js` layers a multi-pick planner on top of the V3.1 engine. `planPick(players, state, settings)` returns the recommended branch, ranked alternatives, the V3.1 baseline, a per-position outlook (best now, chance it is gone by the next user pick, expected best available at that pick), and roster bye conflicts. Each candidate carries `total` (projected weekly starting-lineup points summed over the season, with weeks 15–17 weighted `PLAYOFF_WEIGHT`), `plan.picks` (position/slot targets for every remaining user pick), `nextGone`, `reachGone` (off-clock only), bye warnings and human-readable reasons. `fillLineup`, `rosterSeasonValue`, `waiverLevels`, `byeConflicts` and `expectedPositionValues` are exported for the UI and tests. The hero, Live Board and Draft Plan panels render this output; the V3.1 label is still shown on the hero.

## Draft-log corrections
`replacePick(state, pick, playerId, owner)` and `deletePick(state, pick)` in `src/state.js` edit any historical event. Replacement keeps the pick number; deletion removes the event and `validateState` renumbers later picks and their team attribution. The Draft Log lists every pick (filterable by team) with a Fix action that opens the correction dialog; My Team shows the projected starting lineup with PPG and byes. Both panels scroll independently on desktop and mobile.

## Data
`scripts/update-data.mjs` now merges ESPN projections/ADP/injury status/byes with FantasyFootballCalculator ADP and the V3.1 seed. `data/players.json` rows carry `projectedPoints`, `ppg`, `espnAdp`, `ffcAdp`, `espnRank`, `injuryStatus` and `bye`. Run `npm run update:data` before a draft; `node scripts/simulate.mjs <teams> <slot> --verbose` replays a planner-driven draft for review.

The same script writes `data/matchups.json`: `schedule[TEAM][week] = { opponent, home } | null` for the 2026 season and `defense[TEAM][POS]` = prior-season PPR points allowed per game at that position relative to league average. `src/planner.js` consumes it through `setMatchups()`, `matchupFactor(player, week)` (shrunk 50% toward neutral, capped at `MATCHUP_CAP` = ±10%), and `playoffOutlook(player)` (weeks 15–17 slate, average factor, soft/neutral/tough label). `rosterSeasonValue()` applies the weekly factor to every starter and bye cover; the app loads the file at startup and treats a missing file as neutral. The table is position-by-opponent-by-week, which is the input a weekly start/sit tool would need.
