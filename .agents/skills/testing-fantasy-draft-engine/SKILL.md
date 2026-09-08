---
name: testing-fantasy-draft-engine
description: How to runtime-test the Live Draft Engine PWA (howard1081/fantasy-draft-engine) on production GitHub Pages at iPhone width, including proving a service-worker/cache deploy is actually live, measuring text truncation objectively, and exercising Quick Taken and offline reload.
---

# Testing the Live Draft Engine (fantasy-draft-engine)

Static, dependency-free ES-module PWA. No auth, no backend, no build step.

- Production: `https://howard1081.github.io/fantasy-draft-engine/`
- Local run: `npm run serve` (python3 http.server on `:8080`)
- Checks: `npm run lint`, `npm test` (`node --test tests/*.test.js`, ~55 tests incl. full-draft sims), `npm run test:stress`
- Primary target viewport: **390×844** (iPhone) via Chrome device emulation.

## Devin Secrets Needed

None. The app is public and unauthenticated.

## Golden rule: a cache-name bump is NOT proof that new assets are live

This repo's service worker is cache-first. Three separate things can disagree, and you must
distinguish them explicitly or you will file a false pass:

1. what the **live URL** serves,
2. what **Cache Storage** holds,
3. what the **browser HTTP disk cache** holds (GitHub Pages sends `cache-control: max-age=600`).

Observed for real: after a deploy + worker update, Cache Storage had the **new cache name** but the
**old stylesheet bytes**, because `install` used `cache.addAll(CORE_ASSETS)` with plain requests and
was filled from the HTTP disk cache. Always **read the bytes out of Cache Storage**:

```js
// run in the page's console (not the DevTools frontend context)
const keys = await caches.keys();
const c = await caches.open(keys[0]);
const rs = await c.keys();
const r = await c.match(rs.find(k => k.url.endsWith('styles.css')));
const t = await r.text();
console.log(keys, rs.length, r.headers.get('content-length'), t.length,
            t.includes('.player-summary .availability-note'));
```

Compare against live gzip sizes from the shell:
```bash
curl -sI -H 'Accept-Encoding: gzip' https://howard1081.github.io/fantasy-draft-engine/styles.css | grep -i content-length
```

### Reference byte values (as of the `-cache-reload` deploy)

| asset | gzip `content-length` | decoded length |
|---|---|---|
| `styles.css` | 3420 (3388 = older broken build) | 13036 |
| `src/app.js` | 4721 | 17754 chars / 17772 UTF-8 bytes |
| `data/players.json` | 12700 | 110190 chars / 110191 UTF-8 bytes |
| `data/metadata.json` | 611 | 1157 |
| `index.html` | 1758 | — |

**Watch out:** `.text().length` (JS string chars) < UTF-8 byte count when the file contains multibyte
characters. `app.js` and `players.json` both do. A 1-2 char difference is *not* stale content.

## Proving `cache: 'reload'` precaching actually bypasses the HTTP cache

If a commit only touches `service-worker.js`, the other assets are byte-identical to the previous
deploy — so **byte equality cannot distinguish fixed from broken**. Whatever the HTTP disk cache
holds is already the current content. You need a behavioural discriminator:

1. Leave DevTools **"Disable cache" UNCHECKED** (verify visually; screenshot it).
2. Application > Service workers > **Unregister**.
3. Reload. With no worker controlling the page, the document + assets are fetched over HTTP and
   **warm the disk cache** with `max-age=600`, `age: 0`. (This is the opposite of clearing it.)
4. `src/app.js` re-registers the worker unconditionally, so install fires milliseconds later while
   those entries are maximally fresh — exactly the state that produced the bug.
5. In the Network panel, find rows whose **Initiator is `service-worker.js:<line of addAll>`**
   (marked with a `⚙` gear).

| | broken (`addAll(CORE_ASSETS)`) | fixed (`cache: 'reload'`) |
|---|---|---|
| install rows | **`(disk cache)`**, 0 B | **200 + real transferred bytes** |
| `styles.css` install row | `(disk cache)` | ≈3.4-3.7 kB |
| `players.json` install row | `(disk cache)` | ≈12.7-13.0 kB |

Then probe Cache Storage **once, with no retries** — that also indirectly proves `skipWaiting()` was
chained after the cache fill rather than fired synchronously. Check the stored `date` header is newer
than the previous cache's baseline.

## Measuring text truncation objectively (do not eyeball it)

A visual check passed a commit whose warnings were clipped to one line. The trap: `.player-summary`
sets `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` on `strong, span, small`, and
newly added `<small>` content inherits it. Specificity: `.player-summary small` = **(0,1,1)**;
`.player-summary .availability-note` = **(0,2,0)** — so the fix wins regardless of source order.

```js
document.querySelectorAll('.player-summary .availability-note').forEach(n => {
  const s = getComputedStyle(n), r = n.getBoundingClientRect();
  console.log(n.textContent.slice(0,24), s.whiteSpace, s.overflow, s.textOverflow,
    s.overflowWrap, 'h=' + r.height.toFixed(1), 'right=' + r.right.toFixed(1),
    'CLIPPED=' + (n.scrollWidth > n.clientWidth));
});
console.log(document.documentElement.scrollWidth, document.documentElement.clientWidth, innerWidth);
```

Pass bar at 390 px: `white-space: normal`, `overflow: visible`, `text-overflow: clip`,
`overflow-wrap: anywhere`, `scrollWidth <= clientWidth`, `height >= 31` (one line ≈15.5 px, so ≥31
proves real wrapping), `right <= 390`, and page `390/390/390`.

**Two independent checks:** "no horizontal overflow" passes even on the broken build, because hidden
text does not spill. It only counts *alongside* the per-note measurements. Also filter out notes with
`height === 0` — those live in board sections hidden behind an active search and are not laid out.

**Check every call site separately.** The hero renders the note *outside* `.player-summary`, so it
wrapped correctly while all row surfaces clipped. Surfaces: hero, alternatives (narrowest box,
`clientWidth` 230), Quick Taken, Available Players.

## Testing the navigation network-first path and `/refresh.html` recovery

Since `5722655` the worker splits the fetch handler: `event.request.mode === 'navigate'` is
**network-first** (`fetch()` first, `cache.put('./index.html', copy)` on success, `caches.match`
fallback on failure), while every other GET stays **cache-first**. `/refresh.html` unregisters all
workers + deletes all caches, then `location.replace('./?refreshed=' + Date.now())`.

### Simulating a stale returning client (you cannot install an old worker script)

Only the *current* `service-worker.js` exists at the origin, so a genuinely old Aug-24 worker cannot
be installed. Say so plainly rather than claiming reproduction. What you *can* do is reproduce the
user-visible symptom exactly, because the footer (`src/app.js:141`) is driven by
**`data/metadata.json`**, which rides the **cache-first** path:

```js
// NOTE: current cache name as of 54b2863 is ...-client-refresh-v2; read caches.keys() first
const c = await caches.open((await caches.keys()).find(k => k.includes('client-refresh')));
await c.put('./data/metadata.json', new Response(
  '{"snapshotDate":"2026-08-24T12:00:00.000Z","playerCount":150}',
  { headers: { 'content-type': 'application/json' } }));
// plus a bogus leftover bucket standing in for an old worker's cache:
await (await caches.open('fantasy-draft-engine-v1-20260824-legacy')).put('./index.html',
  new Response('<h1>old</h1>', { headers: { 'content-type': 'text/html' } }));
```

Reload → the footer visibly reads `Data snapshot Aug 24, 2026 · 150 players`. This state is
**deliberately not self-healing**: network-first only covers navigations, and `activate` (which prunes
other caches) never fires while the worker script is unchanged. That is exactly what makes
`/refresh.html` the only recovery path, and it makes the recovery test non-vacuous.

### Proving network-first is real (two-step A/B, do not skip step 1)

Doctor the cached **document** with a visible banner, then test offline *before* online:

```js
let html = await (await c.match('./index.html')).text();
html = html.replace(/<body([^>]*)>/i, '<body$1><div id="stale-marker" style="background:#b91c1c;'
  + 'color:#fff;font:700 18px system-ui;padding:14px;text-align:center">STALE CACHED BUILD</div>');
await c.put('./index.html', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
```

1. **Offline + reload → the banner MUST be visible.** This proves the fixture is genuinely servable.
   Without it, step 2 passing means nothing.
2. **No throttling + reload → the banner MUST be gone**, and re-reading cached `./index.html` must
   show the marker removed (the success path `put`s the network copy back). A cache-first worker would
   still render the banner, so this is a true discriminator.

Network panel signatures: the SW's own navigation fetch appears as a second row for the same URL with
initiator **`service-worker.js:44`** (gear icon) — `200` online, **`(failed) net::ERR_*`** offline
right before the cache fallback renders.

### Proving navigations are *strictly* fresh (`cache: 'reload'`, since `54b2863`)

"Network-first" is weaker than it sounds: a plain `fetch(event.request)` still reads the **browser
HTTP disk cache**, so with GitHub Pages' `max-age=600` a returning client can get a 10-minute-old
document. Observed on `5722655`: the `service-worker.js:44` row read **`(disk cache)` 200** on a
fresh reopen and **`304` / 141 B** on reloads. `54b2863` changed it to
`fetch(new Request(event.request, { cache: 'reload' }))`.

Discriminator — warm the document into the HTTP cache first (just load the page once; `cache:'reload'`
still *writes* to the HTTP cache), then **navigate via the address bar** and read the
`service-worker.js:44` row:

| | plain `fetch` | `cache: 'reload'` |
|---|---|---|
| nav fetch row | `(disk cache)` 200, or `304` / ~141 B | **200 with real transferred bytes** (~2.1 kB gzip for `index.html`) |

**Use an address-bar navigation, not `F5`.** A browser reload already sets the request's cache mode to
no-cache, so `F5` would show a real network fetch *even on the broken build* — a vacuous test.

**The trap that makes "the page looks fine" worthless here:** per the Fetch spec, `new Request(input,
init)` with a non-empty `init` **demotes a `navigate`-mode request to `same-origin`**. If that (or
anything else) made the fetch throw, `.catch(() => caches.match(fallback))` would silently serve the
**cached** document and the app would still render perfectly while online. So always pair the byte
evidence with the doctored-banner A/B above: banner visible offline, banner gone online. Verified
working on `54b2863` — navigations succeed and return real network bytes.

### `/refresh.html` assertions worth making

- Address bar ends at `/?refreshed=<13 digits>` (`/\?refreshed=\d{13}$/`). `src/app.js` has no
  `URLSearchParams`/`location.search` handling, so the param is inert by design.
- **LocalStorage `fantasy-draft-engine-v1` must survive** — `refresh.html` never touches it. A naive
  `localStorage.clear()` would wipe a live draft, so assert `pickNumber` and `events.length`
  explicitly, not just that the app loads.
- All foreign caches deleted; only the current cache (`...-client-refresh-v2` as of `54b2863`)
  remains; cached `metadata.json` back to `playerCount 263`.
- "Restores Sep 7 / 263" is **vacuous unless you break it first** — doctor the cached
  `metadata.json` to Aug 24 / 150, reload, and screenshot the stale footer as a precondition before
  visiting `/refresh.html`.
- **Watch for a `controllerchange` reload loop.** `src/app.js` reloads on `controllerchange` behind a
  `refreshing` flag that does *not* survive the reload, so a worker that claims on every load would
  loop. Assert with Preserve log on that **at most one extra document navigation** occurs over ~20 s.

### Cache entry count: 13 is correct since `54b2863`

History worth knowing: before `54b2863` the cache-first branch did `cache.put(event.request, copy)`
with **no `response.ok` guard**, so a **404 for `/favicon.ico`** got stored and the cache held **14**
entries instead of the 13 in `CORE_ASSETS`. Both the navigation and runtime writes are now gated on
`response.ok`, so the correct count is **13**. Always list the entry URLs before calling an
entry-count mismatch a regression.

**Non-obvious but important:** a service worker intercepts **every** subresource fetch from a client
it controls, regardless of the request URL's path or origin — scope only decides which *clients* get
controlled. That is why `https://howard1081.github.io/favicon.ico` (outside the
`/fantasy-draft-engine/` scope) could land in Cache Storage at all.

To test the `response.ok` guard, do **not** rely on Chrome re-requesting the favicon — it negative-caches
and often will not. Exercise the path deliberately from the page console and assert the count is
unchanged:

```js
const c = await caches.open('fantasy-draft-engine-v1-20260907-client-refresh-v2');
const before = (await c.keys()).length;
const r1 = await fetch('https://howard1081.github.io/favicon.ico');   // 404, out of scope
const r2 = await fetch('./data/does-not-exist.json');                 // 404, in scope
const urls = (await c.keys()).map(r => r.url);
console.log(r1.status, r2.status, before, urls.length,
            urls.some(u => u.includes('favicon')), urls.some(u => u.includes('does-not-exist')));
// expect: 404 404 13 13 false false
```

## App-specific interaction notes

- **Quick Taken search:** click the field, then type. Do **not** press `ctrl+a` first unless the input
  is already focused — if focus is still on the document it selects the whole page and the keystrokes
  never reach the field. Click the input, confirm the caret/`Clear` button appeared, then type.
- **Scrolling to the top is unreliable** with `ctrl+Home`/`End` and mouse wheel (the 100-row list eats
  wheel events and reloads restore scroll ~48 px down, which can hide a top-of-body element and make
  you think it never rendered). Use `window.scrollTo(0, 0)` / `scrollIntoView` as a *scroll aid*, then
  do the actual feature interaction with native clicks. Always confirm an element's
  `getBoundingClientRect().top >= 0` before reporting it as "not visible".
- `renderAvailable()` caps at **100 rows** (`.slice(0, 100)`), so low-ranked players (e.g. Charbonnet
  #151, Dell #220) are only reachable via the search box.
- **`opponentTeamForPick()` (`src/state.js:30-42`) deliberately credits an adjacent opponent when your
  own slot is on the clock.** `TEAM 2` at pick 1 for a slot-1 user is correct, not a bug. The real
  assertion is that the **`MY TEAM` roster count is unchanged** after tapping `Taken`.
- `MY TEAM` / `Draft log` / `Draft backup` panels sit **below** the 100-row Available Players list.
  Scrolling there is slow; scroll them into view instead:
  ```js
  [...document.querySelectorAll('*')].find(e => e.children.length === 0 &&
    /^MY TEAM$/i.test(e.textContent.trim())).scrollIntoView({block:'start'});
  ```
  (`h2/h3/.panel-label` selectors do **not** match; the label class is `.eyebrow`.)
- Action-target bar: `.quick-actions` should be `display: grid` with tracks ≈`210.656px 105.344px`
  (**ratio 2.000**), both buttons **52 px** (≥48), and `noteBottom < buttonsTop` (no overlap).
- Footer sanity string: `Data snapshot Sep 7, 2026 · 263 players`.
- Players marked `HOLD` are never recommended, so they cannot be used to test the alternatives
  surface. State this limitation rather than manufacturing an artificial state for a CSS check.

## Offline verification

Network > **Offline**, clear the log, reload **once**. Expect: full render, state preserved, footer
correct, every request `(ServiceWorker)` with **0 B transferred**, `styles.css` resource size
**13.0 kB**, and notes still `white-space: normal … CLIPPED=false`. That last part is the decisive
proof the *fixed* stylesheet is what got cached — a stale one reverts them to a single clipped line.
Restore **No throttling** and reload to confirm parity before finishing.

Also confirm `.player-summary .availability-note` is present in the *cached* CSSOM:
```js
[...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules] } catch { return [] } })
  .some(r => r.selectorText === '.player-summary .availability-note');
```

## Testing the lookahead planner UI (`src/planner.js`, since `8cd61bd`)

The hero recommendation, the `DRAFT PLAN` card and the `WHAT THE ROOM LEAVES YOU` outlook are all
driven by `planPick()` in `src/planner.js`. Cache name for that deploy is
`fantasy-draft-engine-v4-20260908-matchups2`; footer reads `Data snapshot Sep 8, 2026 · 414 players`.

**Deploy proof must read planner bytes, not just the cache name** (same golden rule as above):

```js
const c = await caches.open((await caches.keys())[0]);
const t = await (await c.match((await c.keys()).find(k => k.url.endsWith('src/planner.js')))).text();
console.log(t.includes('planRemainingPicks'), t.length);
```

Also confirm `./src/planner.js` is in `CORE_ASSETS`, otherwise offline reload renders a blank hero.

### Generate exact expected numbers instead of eyeballing "plausible"

Because the app is dependency-free ES modules, you can import the **production** planner in node and
precompute the values the UI must show. Do this only after confirming production bytes are
byte-identical to your local checkout (`sha256sum` each of `players.json`, `planner.js`, `app.js`,
`state.js`, `styles.css`, `index.html`); that's what licenses using local code as the oracle. Correct
import names: `applyPick`/`undoPick`/`deletePick`/`replacePick`/`validateState` from `src/state.js`
(there is no `addPick`), and `normalizeSettings` lives in `src/state.js`, **not** `src/engine.js`.

A planner-driven hero is proven by values a "best available" hero cannot produce — e.g. 12-team/slot-1
fresh shows `YOUR PICK · 15 PICKS PLANNED AHEAD`, Jahmyr Gibbs, `Roster pts 1982`, `0 → 1982 pts`;
after drafting him it flips to `TARGET FOR YOUR PICK #24` with `351 → 1961 pts`.

### Off-clock label

With `slot != 1` the app starts **off the clock**, so at pick 1 the hero must read
`TARGET FOR YOUR PICK #N`, not the on-clock label. 16 teams / slot 16 → `TARGET FOR YOUR PICK #16`,
Trey McBride, `Roster pts 1821`, `78% chance still there at #16`, and `#logFilter` grows to
**17** options (`teams + 1`).

### Overflow expectations at 390 px

`#planStrip` is **supposed** to overflow horizontally (`scrollWidth` ≈1464 vs `clientWidth` ≈356) —
that is the intended internal scroller. The assertion is only about the **document**:
`document.documentElement.scrollWidth <= clientWidth` (390/390). Do not report the strip as a defect.

### Independent scroll panels — the roster needs enough content to overflow

`#roster` and `#recentPicks` are `.scroll-panel` (`overflow-y: auto`). A fresh/small roster gives
`scrollHeight === clientHeight`, so scrolling proves nothing and you must **not** call it passed.
Build a real roster first — tapping the hero `Draft` button repeatedly drafts to your team (9 picks
gave `scrollHeight 420 > clientHeight 388`, 13 rows). Then `scrollIntoView({block:'center'})` the
panel, wheel over it, and assert its `scrollTop` moved while `window.scrollY` **and** the other
panel's `scrollTop` are unchanged.

Correct row selector for the log is **`.recent-row`** (not `.pick-row`); or just read
`recentPicks.children.length`.

### Fix dialog

`<dialog id="fixDialog">`. `replacePick()` keeps the pick position; `deletePick()` + `validateState()`
recompute `pick = index + 1`, `round`, `teamIndex` and `pickNumber = events.length + 1`, so deleting
pick #1 really does renumber the survivor to `R1 · #1`. Assert the renumbering, not just the deletion.

### Console-error check hygiene

Your own malformed probes (`JSON.stringify` syntax errors, referencing an unset `window.__b`) land in
the same console and will look like app errors in a screenshot. **Clear the console (`ctrl+L`), then
reload, then screenshot** for the no-errors assertion. Beware regexes like
`body.textContent.match(/Data snapshot[^A-Z]*/)` — it stops at the capital `S` in `Sep` and returns
just `"Data snapshot"`, which looks like a truncated footer. Use
`document.body.innerText.split('\n').filter(l => /Data snapshot/.test(l))[0]` instead.

### Desktop-width pass with DevTools

Turning off device emulation is not enough if DevTools is **docked to the right** — the page viewport
stays ~390 px. Undock DevTools into a separate window (Customize menu > dock side > undock) so the
page gets true desktop width (`innerWidth` 1600, `docSW === docCW === 1585`). Note the `browser_console`
tool's CDP evaluation fails while DevTools is undocked; use the DevTools window's own Console instead.

**Sequence that works reliably** (verified): (1) undock DevTools; (2) focus the *page* window and
`wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`; (3) focus the *DevTools* window and click
its **"Toggle device toolbar"** button (leftmost group of the main toolbar, next to the inspect arrow)
to leave emulation. Do **not** send `ctrl+shift+m` to the page window — in this Chromium build that
keystroke opens the **profile menu** instead of toggling the device toolbar, which silently leaves you
at 390 px and makes the desktop pass vacuous. Verify `innerWidth` really is ~1600 before asserting.

## Testing defense-vs-position matchups and the playoff slate UI (since `7e1180e`)

Cache name `fantasy-draft-engine-v4-20260908-matchups2` (**15** precached entries), new asset
`data/matchups.json` (~44 kB; `schedule[TEAM][week] = {opponent, home}`, `defense[TEAM][POS]` ratios,
`playoffWeeks [15,16,17]`, 32 teams in each map). Footer `Data snapshot Sep 8, 2026 · 414 players`
(free agents were dropped, so 414 — a footer reading 415 means a stale build).

`src/planner.js` exports `setMatchups`, `matchupFactor`, `playoffOutlook`, `playoffSlate`,
`MATCHUP_CAP` (0.1). `matchupFactor` = `1 + clamp(±0.1, 0.5 * (ratio - 1))` — shrunk **and** capped.
`playoffOutlook` averages the wk 15/16/17 factors; `label = f >= 1.04 ? 'soft' : f <= 0.96 ? 'tough' : 'neutral'`.

### The load-bearing discriminator: a cache bump does not prove the new *math* runs

`setMatchups(null)` is a legitimate fallback path (`src/app.js` does
`fetch('data/matchups.json').then(r => r.ok ? r.json() : null).catch(() => null)`), so a build with a
new cache name but no matchup data renders a **perfectly healthy-looking app** — just with the slate UI
absent and unweighted roster values. Use `Roster pts` as the discriminator: 12 teams / slot 1 fresh
shows **2159** with matchup weighting vs **1982** before it (`8cd61bd`). Reference oracle for drafting
the hero recommendation five times in a row:

| # | hero | Roster pts | slate | tag |
|---|---|---|---|---|
| 1 | Jahmyr Gibbs RB DET 21.7 ppg bye 6 | **2159** | `@MIN vsNYG @CHI` | neutral |
| 2 | Brock Bowers TE LV 14.2 bye 13 | 2164 | `vsDEN vsTEN @ARI` | **soft** |
| 3 | Jalen Hurts QB PHI 18.8 bye 10 | 2195 | `vsSEA vsHOU @SF` | **tough** |
| 4 | Chris Olave WR NO 14.7 bye 8 | 2227 | `@TB vsARI @ATL` | neutral |
| 5 | Rashee Rice WR KC 15.3 bye 5 | 2270 | `vsNE vsSF @LAC` | neutral |

That sequence deliberately yields one `soft` and one `tough` entry, so a build that hardcoded a single
label gets caught. Pool-wide distribution is neutral 316 / soft 51 / tough 47.

To prove the line is data-driven rather than static markup, use DevTools **request blocking** on
`*matchups.json*` and reload: the app must still render fully (hero, plan, footer `414 players`) with
`document.querySelectorAll('.playoff-slate, .playoff-tag').length === 0` and `Roster pts` back to the
unweighted value. Unblock and reload → the line and tags return.

### Hero vs alternatives asymmetry (easy to get wrong)

The hero **strips** the slate reason chip because it has a dedicated line (`src/app.js:221` filters
`!/chance still there|playoff slate/`), while `.recommendation-row` renders `reasons.join(' · ')`
unfiltered so alternatives **keep** a `soft playoff slate (...)` chip. Assert both directions — no hero
chip matching `/playoff slate/`, **and** at least one alternative carrying it.

### My Team `PO` tags: measure name clipping, never eyeball it

Each lineup row renders `<b class="playoff-tag LABEL" title="Weeks 15-17: SLATE">PO LABEL</b>` inside
the right-hand `<em>` after `ppg · bye N`. **A real regression shipped here:** with the tag inline in a
`white-space: nowrap` `em`, the tag consumed the name column and **all 5 lineup names were clipped**,
yet the layout looked fine at a glance. The fix stacks the tag on its own line:

```css
.lineup-row em { ...; text-align: right; white-space: nowrap; }
.lineup-row em .playoff-tag { display: block; width: max-content; margin: .15rem 0 0 auto; }
```

Build a **5+ player roster first** (tap the hero `Draft` button repeatedly), then measure objectively:

```js
const rows = [...document.querySelectorAll('#roster .lineup-row')].filter(r => r.querySelector('.playoff-tag'));
const m = rows.map(r => {
  const s = r.querySelector('strong'), b = r.querySelector('.playoff-tag');
  const sr = s.getBoundingClientRect(), br = b.getBoundingClientRect();
  return { name: s.textContent.trim(), clipped: s.scrollWidth > s.clientWidth, tag: b.textContent.trim(),
           title: b.title, tagDisplay: getComputedStyle(b).display,
           below: br.top >= sr.top, overlap: br.left < sr.right - 1 };
});
console.log(JSON.stringify({ clippedCount: m.filter(x => x.clipped).length, total: m.length, rows: m }, null, 1));
```

Pass bar: `clippedCount: 0`, every `tagDisplay: "block"`, `below: true`, `overlap: false`, and each
`title` matching the oracle exactly (e.g. `Weeks 15-17: vsDEN vsTEN @ARI`). Verify the fix by **cached
bytes**, not the cache name: the cached `styles.css` must contain `em .playoff-tag`.

Hover tooltips: the native OS tooltip frequently does **not** appear in screen captures. Read the
`title` attribute instead and report hover as *inconclusive* rather than claiming it passed.

The hero slate line lives **outside** `.player-summary`, so it escapes the
`overflow:hidden/ellipsis/nowrap` trap — expect `whiteSpace: "normal"`, `CLIPPED: false`, `right <= 390`
at mobile width, with exactly 3 tokens each matching `/^(vs|@)[A-Z]{2,3}$|^bye$/`.

## Gotchas

- Console tools sometimes attach to the **DevTools frontend** instead of the inspected page. Use the
  visible DevTools console attached to the page for Cache API / DOM measurements.
- Use native clicks for ordinary UI actions (taps, navigation); reserve the console for measurements.
- `Number('210.656px')` is `NaN` — strip the `px` before computing grid ratios.
- Maximize the window before recording: `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.
  Do **not** use `xdotool key super+Up` (tiles to half-screen).
- This skill file has gone missing from disk between sessions several times; recreate it if absent.
