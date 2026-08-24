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
- Added only small stack, handcuff/team-contingency, and bye-overlap modifiers.
- The supplied 46-player seed could not support a 192-pick draft and contained no K or D/ST. V1 therefore merges those explicit V3.1 overrides onto a 268-player 2026 12-team PPR ADP snapshot. Non-seed players use the market/ADP order as the projection prior with deterministic position tiers, upside defaults, and neutral risk. This follows the V3.1 requirement to prefer a market/projection baseline over invented analyst grades, but these fallback rows should be replaced when a complete projection feed is available.
