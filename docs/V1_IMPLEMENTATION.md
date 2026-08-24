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

## Data
`data/players.seed.json` is the supplied V3.1 override set. `scripts/update-data.mjs` merges it with a current full-PPR ADP board and writes the draft-night snapshot to `data/players.json`. Fallback players are explicitly labeled in `dataSource`.
