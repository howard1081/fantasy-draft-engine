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
- Online page navigations are network-first, service-worker updates bypass the HTTP cache, and a controller change reloads the open page. This prevents a returning home-screen client from continuing to display an older snapshot after a successful deployment.
