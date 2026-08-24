# Data Schema

## Player
```ts
type Player = {
  id: string;
  name: string;
  team: string;
  position: 'QB'|'RB'|'WR'|'TE'|'DST'|'K';
  bye?: number;
  v31Rank: number;
  positionRank: number;
  tier: number;
  projectionPoints?: number;
  projectionValue: number; // normalized 0-100 if raw projection unavailable
  adp: number;
  adpSd?: number;          // estimated draft-position dispersion
  vorpBase?: number;
  upside: number;          // 0-100
  risk: number;            // 0-100 higher = more risk
  status: 'ACTIVE'|'HOLD'|'OUT';
  roleSignal?: number;     // -1..+1
  contextSignal?: number;  // -1..+1
  realizedOpponentAdj?: number;
  scheduleShock?: number;
  futureSosAdj?: number;
  notes?: string[];
}
```

## Draft event
```ts
type DraftEvent = {
  pick: number;
  round: number;
  teamIndex: number;
  playerId: string;
  owner: 'ME'|'OPPONENT';
  timestamp: number;
}
```

## Draft state
```ts
type DraftState = {
  settings: LeagueSettings;
  pickNumber: number;
  events: DraftEvent[];
  draftedPlayerIds: string[];
  myPlayerIds: string[];
  teamRosters: Record<number, string[]>;
  ui?: { positionFilter?: string; search?: string };
}
```

## State history / Undo
Do NOT snapshot the history stack inside each history snapshot.
Use either event sourcing or snapshots that explicitly omit undo history.
This prevents recursive memory growth in a long draft.
