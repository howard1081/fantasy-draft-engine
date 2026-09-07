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
