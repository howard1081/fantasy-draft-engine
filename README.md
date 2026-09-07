# V3.1 Live Fantasy Draft Engine

A mobile-first, offline-capable decision engine for 10-, 12-, 14-, and 16-team full-PPR snake drafts. Every `Taken` or `Draft` action immediately recalculates recommendations from the remaining pool, roster construction, dynamic replacement value, positional scarcity, tier cliffs, ADP value, opponent demand, position runs, and the probability a player survives to the user's next pick.

## Run locally

```bash
npm run serve
```

Open `http://localhost:8080`. No install step or backend is required.

## Verify

```bash
npm run check
```

The stress suite simulates 16-round drafts from every slot in both 12- and 16-team leagues and covers event-sourced undo, persistence recovery, roster saturation, position runs, tier exhaustion, ties, HOLD exclusions, extreme value falls, and late K/DST behavior.

## Refresh the player snapshot

```bash
npm run update:data
npm run check
```

The refresh script downloads current 12-team PPR ADP from Fantasy Football Calculator, merges the supplied V3.1 seed overrides by player name, and applies the manually reviewed statuses and risk notes in `data/availability.json`. The resulting static snapshot is committed so the app has no live network dependency on draft day.

Use `HOLD` only when a player is currently ineligible or has an indefinite absence. Short confirmed absences remain draftable with elevated risk because this is a season-long draft board. Preserve the architecture in `docs/ALGORITHM_V3_1.md` and record substantive model changes in `docs/DECISION_LOG.md`.
Reviewed availability notes appear on the hero, recommendation, Quick Taken, and available-player rows.

## Draft-day use

1. Set the league size, rounds, and draft slot.
2. Tap `Taken` for each opponent selection.
3. Tap `Draft` for your own selection.
4. Use `Undo` immediately after a data-entry mistake.
5. Export state periodically as a backup.

Draft state is stored in `localStorage`; refreshes and tab restarts preserve the board.
