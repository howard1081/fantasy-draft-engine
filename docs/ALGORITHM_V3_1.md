# Algorithm V3.1 — Locked Architecture

## Why V3.1 exists
Earlier versions over-weighted preseason strength of schedule and used hand-built categorical scores too aggressively. Historical diagnostics showed that a strong projection baseline should be the anchor, while our football criteria are best used as controlled, named adjustments.

## Principle
`Market/Projection Baseline -> Independent Residual Adjustments -> Draft Value / Roster Context`

Do not replace the projection prior with arbitrary 0–100 analyst grades.

## Player projection layer
Start with a consensus projection or V3.1 seed score.

### Strongest adjustment: Role / Opportunity
Signals:
- projected targets/carries;
- target/touch share;
- routes and snap participation;
- red-zone / goal-line share;
- vacated targets/touches;
- depth-chart security;
- role growth/decline.

Typical cap preseason: about +/- 5–6% of baseline projection.

### Context adjustments
Use only where the factor adds information not already fully embedded in the baseline.
- QB change for WR/TE
- OL/pass protection for QB and deep-route WR
- OL/run blocking for RB
- scoring environment / red-zone environment
- coaching / scheme change where role consequences are clear

Typical individual cap: +/- 1–3%.

### Health
Separate predictable known risk from random future injury.
Known risk can reduce projection; unknown random injury must not be retroactively used to claim the model was wrong/right.
Acute injury with unclear diagnosis => HOLD, not arbitrary ranking.

### Schedule — three distinct concepts
1. **Realized Opponent Difficulty — HIGH importance**
   Normalize the prior-season statistics for quality of competition. A 25-point QB game against a top defense is stronger evidence than 25 against a bottom defense.

2. **Schedule Shock — MEDIUM importance**
   Change between the environment that generated last year's stats and the coming year's expected environment.
   Example: historically easy prior schedule -> materially harder next schedule deserves a regression adjustment.

3. **Projected Future SOS — LOW/MEDIUM preseason importance**
   Useful as a tiebreaker/modifier, not a primary driver.

## QB-specific V3.1
Opponent-adjust historical performance using:
- EPA/dropback
- success rate
- CPOE / accuracy
- YPA
- TD/INT
- sack rate / pressure-to-sack
- performance under pressure
- clean-pocket performance
- explosive pass rate
- rushing contribution

Add **Pressure Stress Score** for defenses combining high pressure + strong coverage.

Career-stage prior:
- Year 1 -> Year 2 development is common;
- do not assume another equal leap Year 2 -> Year 3;
- large Year-2 efficiency spikes should regress toward sustainable performance unless context supports them.

## WR-specific V3.1
Role dominates.
Schedule/coverage adjusts close calls using:
- realized pass-defense strength faced;
- outside vs slot alignment;
- secondary quality;
- pass rush / time-to-throw pressure interaction;
- coverage tendencies;
- actual shadow-corner behavior only when the CB travels;
- projected alignment overlap.

Do NOT do `elite CB on roster = automatic WR downgrade`.

Shadow CB modifier should only activate when:
- evidence of shadow behavior;
- meaningful alignment overlap (e.g. >=60% expected);
- relevant scheme;
- repeated season exposure or a particularly important weekly matchup.

Preseason full-season shadow/CB effect must remain small enough that elite 150+ target volume is not erased by speculative matchups.

## RB-specific V3.1
Focus on:
- carries and targets;
- receiving role (especially full PPR);
- goal-line share;
- committee probability;
- run blocking / yards-before-contact environment;
- team scoring / game script;
- run-front quality and schedule shock;
- contingency value if starter/backup role changes.

## TE-specific V3.1
Role/route participation/target concentration dominate.
Opponent LB/S coverage is a smaller modifier.

## Dynamic Draft Score
The live app must turn player value into decision value.

Suggested starting formula (normalize components before combining):

DynamicScore =
  0.34 * ProjectionValue
+ 0.18 * VORP
+ 0.12 * RosterNeed
+ 0.10 * TierCliff
+ 0.10 * ADPValue
+ 0.08 * GoneBeforeNextPick
+ 0.04 * Flexibility
+ 0.04 * Upside
- SaturationPenalty
- ReachPenalty
- RiskConcentrationPenalty

This formula is a STARTING implementation, not sacred. Changes must be justified by deterministic stress tests, not hindsight.

### Important state-sensitive behavior
- Early rounds: projection/VORP dominate.
- Middle rounds: roster need, tier cliffs, scarcity, and wait probability grow.
- Late rounds: upside/contingency grow; K/DST become eligible.

## Replacement-level / VORP
Default 12-team replacement anchors should be derived dynamically from remaining player pool and lineup requirements rather than fixed forever.
Reasonable initial anchors:
- QB: QB13–15 range
- RB: RB30–36 range because FLEX/bench demand is high
- WR: WR36–42 range
- TE: TE13–15 range

Recompute as the draft drains positions.

## Scarcity / tier cliff
IMPORTANT bug guardrail:
Do NOT reward the “last player inside a tier” more than the best player in the same tier just because of ordinal location.
Scarcity belongs to the available position/tier state, not as a bonus that inversely rewards lower-ranked players within the same tier.

A tier-cliff bonus can be based on:
`candidate projection - best projected replacement in next tier`.

## Roster Need
Soft, not hard.
Example default starter deficits can add value, but extreme falling value can override starter balance.

Do not implement crude rules like `already have 2 RB -> no more RB`.

## Position-run response
A run should affect survival probability and scarcity but should NOT force the user to join the run if the market is creating better value elsewhere.

## Draft value labels
- TARGET: dynamic value materially above cost
- FAIR: roughly correct cost
- WAIT: good player but likely available later / reach now
- AVOID: cost exceeds value or risk/HOLD issue
