# Draft-Day Launch Checklist

## Data freshness — do 24h before draft and again 1–2h before
- refresh current ESPN/FantasyPros-style ADP / projection baseline;
- refresh depth charts;
- refresh injuries;
- mark unclear acute injuries HOLD;
- update trades/team changes;
- update rookie roles;
- update D/ST and K names;
- preserve algorithm rules; do not move players manually without a named reason.

## Product QA
- run automated tests;
- full 16-round simulation all 12 draft slots;
- test iPhone-sized viewport;
- test Undo x20;
- test refresh persistence;
- test export/import backup;
- verify no player appears twice;
- verify no HOLD recommendation;
- verify current pick snake math.

## Deployment
- GitHub Pages HTTPS URL loads;
- cache-busting/version label visible;
- current data snapshot date visible;
- offline-after-load behavior verified;
- open on phone before draft starts;
- optionally keep laptop as second screen.

## Live draft operating procedure
- set draft slot before first pick;
- for each opponent selection tap TAKEN;
- on own pick use hero recommendation + alternatives;
- if ESPN timer gets short, trust the top recommendation unless a data-entry mistake occurred;
- Undo immediately after any mistaken tap;
- do not manually “correct” rankings mid-draft unless there is new injury/news information.
