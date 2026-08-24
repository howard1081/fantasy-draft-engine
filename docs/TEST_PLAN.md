# Stress / Acceptance Test Plan

## Unit tests
### Snake math
For 12 teams:
- slot 1 picks: 1,24,25,48,49...
- slot 6 picks: 6,19,30,43...
- slot 12 picks: 12,13,36,37...

### Availability
- TAKEN removes player from every recommendation list.
- DRAFT removes player and adds to user's roster.
- HOLD is never recommended.
- OUT is never recommended.

### Undo
- restores exact previous player availability, pick number, roster, opponent roster.
- 100 repeated draft/undo operations must not create exponential state size.

### Roster adaptation
Scenario A: user has RB/RB after first two rounds.
Expected: WR/TE starter deficit gets a meaningful boost, but an extreme RB value fall can still win.

Scenario B: user has WR/WR.
Expected: RB scarcity/need rises.

Scenario C: user has QB early.
Expected: second QB heavily suppressed until very late bench rounds in a 1-QB league.

### Position run resistance
If 5 QBs are drafted early and strong RB/WR value falls, engine should not automatically chase QB.

### Tier cliff
If TE4 is available and next remaining TE tier is materially weaker, TE4 receives a real cliff bonus.
Within the same tier, TE1 must not be outranked by TE4 merely because TE4 is “last in tier.”

### Wait probability
If candidate A has ADP 35 at pick 28 and next user pick is 45, P(gone) should be materially higher than for candidate B with ADP 70.
Opponent positional demand between picks should move this probability in the expected direction.

### Late positions
K/DST should generally not appear as best pick before the late rounds under default settings.

## Full-draft simulation
Simulate 16 rounds from each draft slot 1–12.
Pass criteria:
- no crashes;
- no duplicate player selections;
- user finishes with legal roster or near-legal if intentionally testing value exceptions;
- no >1 QB before round 10 unless exceptional value rules explicitly permit it;
- K/DST acquired late;
- no HOLD players selected;
- available pool remains sufficient through final pick;
- state size remains bounded.

## Mobile QA
At ~390x844 viewport:
- primary recommendation visible without horizontal scrolling;
- Taken/Draft buttons have >=44px touch targets;
- search input usable with mobile keyboard;
- sticky controls do not cover content;
- no accidental double-tap duplication;
- refresh preserves draft.

## Draft-night chaos tests
1. First 8 preferred players all disappear before user pick.
2. Six RBs go in a row.
3. Six QBs go irrationally early.
4. Elite TE falls 20+ picks.
5. User accidentally marks own player TAKEN -> Undo -> correct DRAFT.
6. Browser refresh mid-round.
7. Close/reopen tab.
8. Search and mark a player in <2 seconds.
9. Network goes offline after initial load; app continues working.
