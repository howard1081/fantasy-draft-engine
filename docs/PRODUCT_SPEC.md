# Product Specification

## Primary user story
During a live ESPN fantasy draft, the user needs to register every pick in under ~2 seconds and instantly see the best next selection for HIS roster, not a generic best-player-available list.

## Default league
- 12 teams
- Snake draft
- Full PPR
- 1 QB
- 2 RB
- 2 WR
- 1 TE
- 1 FLEX (RB/WR/TE)
- 1 D/ST
- 1 K
- 6 bench (configurable later)
- 16 rounds default

## Main screen
Top status strip:
- overall pick
- round
- team on clock
- user next pick

Hero recommendation card:
- `BEST PICK NOW`
- player name, position, team
- Dynamic Draft Score
- V3.1 rank / positional rank
- ADP
- probability gone before next user pick
- reason chips (max 3)
- `DRAFT` button

Alternatives list:
- 4–8 best alternatives
- compact reason
- `DRAFT` and `TAKEN`

Available players:
- search
- position filters
- sort by dynamic score / V3.1 / ADP
- one-tap `TAKEN`

Side/bottom panel:
- My Team
- roster slots
- bench
- current needs
- recent picks
- Undo

## Live draft interaction
When any player is marked TAKEN or DRAFTED:
1. mark player unavailable;
2. append immutable event to history;
3. recompute roster state;
4. recompute remaining replacement levels;
5. recompute positional tier cliffs;
6. recompute opponents' position demand before next user pick;
7. recompute survival probability;
8. recompute dynamic scores;
9. rerender immediately;
10. persist state.

## Opponent roster tracking
Minimum V1:
- every non-user pick is assigned to the team currently on clock;
- track QB/RB/WR/TE/DST/K counts per opponent;
- infer likely demand with soft rules, not hard rules.

Example demand logic:
- opponent with 0 QB by rounds 6–9 => elevated QB demand;
- opponent already with 1 QB before round 10 => very low second-QB demand;
- opponent with 2 RB + 3 WR early => TE/QB demand rises;
- roster rules constrain impossible starter deficits late.

## Opportunity cost / wait logic
For each candidate, estimate:
`P(gone before my next pick)`.

Use current pick gap, ADP distribution, position demand from teams between picks, recent runs, and tier scarcity.

Do not need machine learning in V1. A calibrated heuristic/normal-CDF approximation is fine if deterministic and tested.

## Reliability requirements
- no backend required for V1;
- no authentication required;
- localStorage persistence;
- Undo must work repeatedly without recursive state-history memory growth;
- no network dependency during the live draft after page load;
- export/import draft state JSON is strongly preferred as a backup;
- app should remain usable if external data refresh services fail.
