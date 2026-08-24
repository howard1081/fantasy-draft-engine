# Devin Start Here — Fantasy Draft Engine

## Mission
Build and deploy a fast, mobile-first live fantasy football draft decision engine for a 12-team ESPN-style full-PPR snake draft.

This is NOT a static cheat sheet. After every draft pick, the app must recalculate the best choice for the user's next selection based on:
- which players remain available;
- the user's current roster;
- starter/flex/bench needs;
- positional scarcity and tier cliffs;
- player projection / V3.1 ranking;
- value over replacement;
- ADP and reach/discount;
- probability a player survives until the user's next pick;
- opponents' roster needs between the current pick and the user's next pick;
- position runs;
- roster saturation;
- late-round upside / contingency value;
- health/HOLD status;
- QB/WR stack value and RB handcuff/contingency value as small modifiers;
- bye-week overlap as a weak tiebreaker only.

## Required outcome
A GitHub repository deployed as a working web app (GitHub Pages is acceptable for V1) that works reliably on iPhone and desktop during a live draft.

## Non-negotiable product behavior
1. One-tap `TAKEN` removes a player drafted by an opponent.
2. One-tap `DRAFT` assigns a player to the user's roster.
3. `UNDO` restores the exact prior draft state.
4. Recommendations recalculate immediately after every action.
5. State persists in `localStorage` so refresh/reopen does not lose the draft.
6. The app always shows a #1 recommendation plus at least 4 alternatives.
7. The recommendation must include a short reason: e.g. `WR tier cliff + 74% chance gone before next pick`.
8. It must never recommend a player marked `HOLD` or already drafted.
9. It must not blindly stop drafting a position after starters are filled; extreme value may justify FLEX/bench selections.
10. It should resist panic position-runs when value elsewhere is better.
11. K and D/ST are suppressed until late rounds unless league settings explicitly require otherwise.
12. Mobile interaction speed matters more than decorative UI.

## Build sequence
1. Read every file in `/docs`.
2. Implement deterministic engine functions first, with tests.
3. Load player data from a simple JSON/JS data source.
4. Build UI around the tested engine.
5. Run stress tests from all 12 draft slots through a full 16-round draft.
6. Run manual mobile QA at ~390px width.
7. Deploy.
8. Return deployment URL, repo URL, test results, known limitations, and exact instructions for refreshing projections/ADP.

## Critical modeling principle
Do not invent new fantasy weights just because a ranking “feels wrong.” The model evolved specifically to avoid hindsight overfitting. Use the architecture in `docs/ALGORITHM_V3_1.md`.

## Data freshness
The included player list is a seed snapshot, not a permanent source of truth. Before final launch, refresh projections/ADP/injury statuses and preserve the model rules. Any player with unclear acute injury status should be `HOLD` until evidence supports a quantified downgrade.
