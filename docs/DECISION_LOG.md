# Decision Log

## V1 -> V2
Role/opportunity increased after 2025 exploratory backtest; generic schedule weight reduced.

## V2 -> V2.2
Converted subjective category ideas into deterministic inputs and confidence shrinkage; recognized that unspecified subscore equations made earlier backtests too easy to influence.

## V2.2 diagnostic
Historical 2022–23 diagnostics suggested a hand-built eight-factor score should NOT replace a strong projection baseline. Generic preseason SOS overlays often worsened prediction.

## V3
Projection/market ensemble became the prior. Our football criteria became bounded residual adjustments.

## V3.1
Critical refinement after Drake Maye stress test:
- realized opponent difficulty is distinct from future SOS;
- schedule shock matters;
- future preseason SOS remains a smaller modifier;
- pressure+coverage stress is particularly relevant for QB;
- WR schedule must include alignment/shadow behavior rather than generic secondary rank.

## App architecture
Static client-side app for reliability. Manual one-tap input preferred to fragile ESPN automation in V1.

## V1 implementation — August 24, 2026
- Preserved the documented V3.1 weighted architecture: projection baseline, VORP, roster need, tier cliff, ADP value, wait probability, flexibility, and upside, followed by named penalties.
- Implemented draft history as event sourcing. Undo removes the latest immutable event rather than storing recursive state snapshots.
- Derived replacement levels from the live remaining pool using the V3.1 positional anchors.
- Applied position-run and opponent-roster signals only to expected availability. A run does not directly force a positional selection.
- Applied one shared tier-state cliff score to every player in a tier, preventing the last member of a tier from receiving an artificial ordinal bonus.
- Applied an explicit pre-eligibility timing penalty to K and D/ST through round 12. A soft roster-need reduction alone allowed tier and wait components to surface D/ST too early, contradicting the locked product requirement that both positions remain suppressed until late rounds.
- Added only small stack, handcuff/team-contingency, and bye-overlap modifiers.
- The supplied 46-player seed could not support a 192-pick draft and contained no K or D/ST. V1 therefore merges those explicit V3.1 overrides onto a current 2026 12-team PPR ADP snapshot. Non-seed players use the market/ADP order as the projection prior with deterministic position tiers, upside defaults, and neutral risk. This follows the V3.1 requirement to prefer a market/projection baseline over invented analyst grades, but these fallback rows should be replaced when a complete projection feed is available.

## 16-team leagues and quick removal — August 24, 2026
- League size now accepts 16 teams. The engine's snake math was already size-agnostic, but `normalizeSettings` silently coerced anything outside 10/12/14 to 12, which would have discarded a real 16-team slot. Full-draft simulations now run for every slot of both 12-team and 16-team leagues.
- Added a Quick Taken search directly under the recommendation. Draft-night speed depends on removing opponent picks in one or two taps, so a non-empty query hides the board and available list and shows only matching available players with an oversized Taken action. Return marks the top match taken. Matching is name-prefix first so common first names resolve without typing a full name.

## Draft-night availability refresh — September 7, 2026
- Refreshed the market baseline immediately before the draft to 263 players, including 262 ACTIVE players. A 16 x 16 draft consumes 256 players, leaving six active fallback selections.
- Separated current injury and transaction notes into `data/availability.json` so a market refresh does not silently discard manual availability review.
- `HOLD` is reserved for confirmed current ineligibility with an indefinite return, such as Josh Jacobs on the commissioner's exempt list. Shorter confirmed absences remain ACTIVE with elevated risk because fully excluding them would misrepresent their season-long draft value. Players expected to play remain ACTIVE with a documented health discount.
- Ashton Jeanty's stale emergency HOLD was removed after current reporting indicated an ankle sprain and likely Week 1 availability. He now follows the current market baseline with elevated risk rather than an invented replacement rank.
- Reviewed availability notes render anywhere a player can be drafted or marked Taken, so the user can see why an ACTIVE player is discounted rather than relying on an invisible scoring input.
- Service-worker installation requests bypass the browser HTTP cache. GitHub Pages serves assets with a short `max-age`, which could otherwise populate a newly named Cache Storage bucket with the previous deployment's bytes.
- Online page navigations are network-first with `cache: reload`, service-worker updates bypass the HTTP cache, and a controller change reloads the open page. This prevents a returning home-screen client from continuing to display an older snapshot after a successful deployment.

## Lookahead planner, ESPN projections, and draft-log corrections — September 8, 2026
Post-draft review found that a single-pick "best available" score, however well weighted, ignores what the room is doing and what the roster will look like after the next several picks. The user's notes: an elite QB was passed for a "back end" QB pair, a 4th WR was recommended while RB/TE tiers emptied, both QBs shared a bye, and past picks could not be corrected. The changes below extend V3.1 rather than replacing it.

- **V3.1 is preserved as the immediate-decision layer.** `recommend()` and every V3.1 component/penalty are unchanged. The planner (`src/planner.js`) uses the V3.1 board as its candidate set and as the "best available" baseline it must beat; the UI shows the V3.1 label on the hero and the season-point gap versus the V3.1 top pick when they disagree.
- **Season-value objective.** Each candidate branch is scored as projected *starting-lineup points through the rest of the draft*: the roster with the candidate added, plus the expected value of every remaining pick assigned to open lineup slots by a maximum-weight (Hungarian) assignment. Weekly lineup value replaces bye-week and injury absences with bench coverage measured *above the waiver replacement level* for that position and league size, so a backup QB is worth roughly one bye week of marginal points, while an elite QB's weekly edge counts every week. This is the mathematical form of the user's rule "an elite QB carries the season; a QB2 is only there for one game".
- **Opponent demand and survival.** Expected availability at each future user pick uses the existing V3.1 `goneProbability` per player, multiplied by the existing `demandMultipliers` (opponent roster needs and recent position runs). Run pressure decays by 0.6 per future user pick so a current WR frenzy raises near-term WR scarcity without assuming it lasts the whole draft.
- **Off the clock.** While opponents pick, the hero shows the target for the user's *next* pick: candidates are discounted by their probability of being gone by that pick, and the candidate pool is widened to players the market expects around that slot. When the user is on the clock the discount is zero and the immediate branch value decides.
- **Bye weeks.** Same-position bye stacks (including QB1/QB2) reduce the roster's weekly value directly and are surfaced as warnings on the candidate and as a My Team conflict summary. Bye conflicts are a cost, not a hard block, because a large projection edge can still justify the overlap.
- **Projection source.** ESPN's public projection feed (season points, ADP, injury status, bye) is now the primary PPG source, merged with FantasyFootballCalculator ADP and the V3.1 seed overrides. `OUT`, `INJURY_RESERVE` and `SUSPENSION` map to `OUT`; questionable statuses raise `risk`. Manual `availability.json` review still wins. Players with no ESPN projection fall back to the documented V3.1 projection/rank scale. Player IDs keep the legacy FFC slug so saved drafts still resolve.
- **Roster caps in the planner** (QB 2, TE 2, DST 1, K 1) and the existing K/DST start round bound the candidate set. This is a search-space decision, not a scoring change; the caps only exclude roster spots V3.1 would already treat as saturated.
- **Draft-log corrections.** Any past pick can be replaced (player and/or owner, same pick number) or deleted (later picks shift up one slot and team attribution is recomputed). Undo remains the one-tap path for the most recent pick.
- **Planner-driven simulations** run for every slot of 12- and 16-team leagues in the test suite; `scripts/simulate.mjs` prints the per-pick plan and reasons for review. Observed: from slot 12 of 12 the planner weighs an elite QB at the 1/2 turn as roughly equal to the remaining WR1s (a ~2 point gap over ~1900 season points); in 16-team leagues the elite QB tier often disappears before the user's pick and the planner accepts a lower QB rather than reaching.
