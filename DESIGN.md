# BreakFit design system

Scope: every renderer screen (`src/renderer/*`): main window (今天 / 記錄 / 設定, library,
player), break overlay (every phase + dialogs), cover windows.

**One design language, two colour themes (2026-09-24 rewrite).** The language is Apple's, taken
from `docs/hig/getdesign-apple.md` (typography, radius, spacing, elevation, pill CTA) and the HIG
text in `docs/hig/*.txt` (system colours, contrast, hit regions). The user asked for the same
「字體感覺」 across everything. Dark = Apple Fitness (black, HIG Green); light = Apple Health
(parchment + white surfaces, HIG Orange). **Only colour tokens differ between the themes.**

**Hero pass (2026-09-25, `docs/DESIGN-PLAN.md`).** Anti card-kit: one raised surface per screen
region, everything else on the ground; one hero per screen (今天 = the stop you owe next with its
move playing, 記錄 = the streak numeral); radii follow the hierarchy (§1.2).

Standing rules from the user: the demo video always stays left at one size, all controls stay
right, no explanatory grey microcopy, aligned grids, Material Symbols (never emoji), Traditional
Chinese UI. Where a choice was made, it is marked **[choice]**.

## 1. Tokens (`base.css :root`, light overrides under `:root[data-theme="light"]`)

Component rules use tokens only: no hex/rgba outside the two token blocks in `base.css`
(checked with a grep over `main.css`, `overlay.css`, `cover.html`, `*.js`: 0 hits). The main
process mirrors `--bg` / `--stage` in `app.js` `BG` / `STAGE_BG` for the BrowserWindow background.

### 1.1 Type (same in both themes)

| Token | Value |
|---|---|
| `--font-display` / `--font` | `"SF Pro Display"/"SF Pro Text", -apple-system, "Inter", "PingFang TC", "Noto Sans TC Variable", "Noto Sans TC", "Microsoft JhengHei UI", …` |
| features | `font-feature-settings: "ss03", "tnum"` on `body` (tabular digits live in the feature list because the `font` shorthand resets `font-variant-numeric`) |
| weights | 400 · 600 · 700 only. No 500 |
| type tokens | `--t-footnote(-em)` · `--t-subhead(-em)` · `--t-body` · `--t-headline` · `--t-title3` · `--t-title2` · `--t-large` · `--t-ring` · `--t-hero` (full `font` shorthands, §3); overlay `--o-*` rem twins in `overlay.css` |
| tracking | `--tr-13` 0 · `--tr-15` −0.016em · `--tr-17` −0.02em · `--tr-display` −0.015em (≥ 21 px) |

**Fonts [choice, 2026-09-24].** Latin and digits: SF Pro where the OS has it, otherwise Inter
(bundled, @fontsource 400/600/700). CJK: PingFang TC on macOS, otherwise **Noto Sans TC**
(bundled, `@fontsource-variable/noto-sans-tc`, OFL, one variable font split into 105
unicode-range woff2 chunks, 4.6 MB on disk, only the chunks a page uses are loaded). Microsoft
JhengHei is last-resort only: it has just Regular/Bold, so 600 rendered as a faux-bold blob
(the 「第 1 天 · 胸 + 三頭」 title the user rejected). SF Pro is never embedded; `system-ui` /
`BlinkMacSystemFont` stay out (they resolve to Segoe UI on Windows).

### 1.2 Shape, size, elevation (same in both themes)

| Token | Value | Use |
|---|---|---|
| `--r-xs` | 5 px | `kbd` |
| `--r-sm` | 8 px | nav items, text inputs, a day-line stop's focus ring |
| `--r-md` | 11 px | media and things inside a surface: hero clip, library clips, player video, calendar cells, day-line tooltip, textarea |
| `--r-lg` | 18 px | the raised surfaces only: 今天 hero, 記錄 calendar + detail, 設定 groups, player card, overlay video + dialog (`--o-r-lg` 1.125rem) |
| `--r-pill` | 9999 px | every button, segmented control, pills/chips, switch, progress bars |
| `--btn` / `--ctl` | 44 / 36 px | main-window buttons (HIG 44 pt hit region) / form controls |
| `--press` | `scale(0.95)` | `:active` on buttons, icon buttons, library cards |
| `--blur` | `saturate(180%) blur(20px)` | the frosted sticky page head only |

**Radii follow hierarchy [choice, 2026-09-25]:** surface 18 → media 11 → controls pill; never one
radius on everything. Squircle: `corner-shape: squircle` on every box; everything pill/circle opts out with
`corner-shape: round` (list in `base.css`, now including `.btn`, `.icon-btn`, `.seg`, day
toggles, stepper and the slider).

**Elevation [Apple: no shadows on cards or buttons].** `--shadow` / `--shadow-pop` are gone.
Levels: ground (`--bg`: page, the day line, library, chart, section headings) → raised surface
(`--surface` fill, **no border, no shadow**: the ground/surface step is the edge; exactly one per
screen region, §5) → backdrop blur (the sticky page head, the one floating bar). Dialogs, the player
card and the day-line tooltip keep a 1 px `--hairline` edge (they float over content). The only
`box-shadow`s left are 1 px hairline rings on the switch/slider knob, the 2 px inset rings on
"later" / "partial" / "missed" stops and the 5 px `--accent-soft` halo on the next stop.

### 1.3 Colour roles (values per theme in §9)

| Token | Role |
|---|---|
| `--bg` / `--side-bg` / `--side-on` | page / sidebar / selected nav item |
| `--surface` / `--surface-2` / `--surface-3` | raised surfaces + dialogs / control fill (secondary pill, chip, seg track, input, clip placeholder) / hover (never under muted text) |
| `--seg-on` · `--switch-off` · `--knob` · `--ghost` | selected segment · switch off track · switch + slider knob · secondary pill on the overlay stage |
| `--hairline` / `--line-soft` | 1 px dialog/tooltip/input edge / row dividers |
| `--text` / `--muted` (`--faint` = `--muted`) | the only two text colours |
| `--accent` | HIG accent for thick graphics: ring arc, 8 px bars, switch on, slider fill, chart bars, logo, dots |
| `--accent-text` | accent as text, icons, thin (4 px) strokes, focus ring |
| `--accent-fill` / `--accent-ink` | primary pill fill / its label (also pass pill, selected weekday) |
| `--accent-soft` / `--accent-line` / `--accent-on-soft` | tint (chip, cycle, next-stop halo) / tint edge / text on the tint |
| `--fail` / `--fail-text` / `--fail-soft` / `--fail-line` / `--fail-on-soft` | the same five roles for failure (HIG Red) |
| `--danger` / `--danger-ink` | destructive pill (離開 / 跳過 confirm), 不合格 pill |
| `--stage` / `--cover-bg` / `--bar-bg` / `--scrim` / `--backdrop` / `--track` / `--thumb` / `--strike` | overlay page / other monitors / frosted head / over the finished video / behind dialogs / progress + ring track / scrollbar / line-through |

## 2. Spacing

Apple scale: 4 · 8 · 12 · 17 · 24 · 32 · 48 px (base 8). Structural gaps 16/24/32; 4 and 12
inside components. Overlay rem equivalents 0.25 / 0.5 / 1 / 1.5 / 2 / 3.

- Tokens: `--gap` 12 (between raised surfaces), `--pad` 16 (surface padding), `--content-max`
  1200 (main-window content column). Denser than Apple's 24 utility card on purpose (user: blocks
  too far apart); everything stays on the 4/8 grid.
- Content column: gutter `max(32px, (100% − 1200px) / 2)` (24 under 600), so wide windows
  (1600, 1920, 2560) centre a 1200 px column and the margins absorb the rest (Apple content lock,
  getdesign-apple §Grid: 980–1440). Page head (sticky, frosted) 88 high, background full-bleed,
  h1 + action aligned to the same column. Content padding bottom 32.
- Grid gap `--gap`. Surface padding `--pad`. Hero → day line 24, day line → library 40. Timeline rows 40
  (8 + 24 + 8). Section head 36 + 12 below. Library gap 24 × 16.
- Sidebar 200 wide, padding 24 12, brand 44 high, nav items 40 high, gap 4.

## 3. Type scale

Every text rule sets ONE whole token (`font: var(--t-…)` = size / line-height / weight together),
so comparable elements cannot drift. The size-matrix lint (§10 f) rejects any other combination.
Minimum rendered size 13 px anywhere; secondary (grey) text only where it carries a value, and
then ≥ 15 px in `--muted` (≥ 4.5:1, §9).

| Token | px / line-height / weight | Main window | Overlay (rem = px/16) |
|---|---|---|---|
| footnote | 13 / 18 / 400·600 | chart axis (400), pass/fail pill (600) | kbd, mode tag (600) |
| subheadline | 15 / 20 / 400·600 | segments (selected 600), timeline counts + status, day-line stop times (next 600), reps line, weekday toggles; 600: eyebrow `第 1 天`, table headers `組` `次數`, calendar weekday row + day numbers | — |
| body | 17 / 24 / 400 | default: nav, row labels, inputs, buttons, timeline names, library names, tips, hero meta `2 × 8–15 下`, progress `7 / 25 組`, stat labels | slot time, plan rows, tips, `上一組` |
| headline | 17 / 24 / 600 | active nav, table day header, calendar %, detail counts, next slot time (rows), stat values, the done count in `7 / 25 組` | chips, every button |
| title3 | 21 / 26 / 600 (400 overlay meta) | section titles, detail date, brand, `還有 25 分` (accent) | meta line (400), unit `下` (400), `13 / 25 組` (600) |
| title2 | 28 / 34 / 600 | player title, hero move name, `連續` / `天` around the streak | dialog title |
| largeTitle | 34 / 41 / 600 | page h1, directive hero word `今天完成` | stopwatch (400), stepper value (600) |
| display | 40 / 48 / 600 | — (KPI cards are gone) | phase title |
| ring / ring3 / hero | 48/48 · 36/36 · 96/96 / 700 | `--t-ring`: hero time under 1000 content px; `--t-hero`: hero time ≥ 1000, streak numeral | ring number · 3-digit ring number · work target |

Comparable elements share one token: all row labels = body, all section/panel titles = title3,
all table headers = subheadline 600. Display numerals (next-stop time, streak) are the one 700 face
in the main window, tabular, and there is exactly one per screen.
Button weight: main-window pills 400 (body), overlay pills 600 (headline, read from a distance).

## 4. Break overlay: one fixed stage for every phase

Scale: `html { font-size: max(16px, min(100vh / 45, 100vw / 80)) }`: 16 px at 1024×768, 1280×720
and 1280×800, 17 px at 1366×768, 19.2 px at 1536×864, 24 px at 1080p, 32 px at 1440p. The 16 px
floor keeps the smallest token (13 px) legal on 4:3 screens.

```
┌ top bar (4rem): [schedule 16:00][測試] [────── progress ──────]   │        [離開 Esc] ┐
│                                                                   │                   │
│  ┌──────────── video box 16:9, ALWAYS here ────────────┐  2rem  ┌─ panel 24rem ─────┐ │
│  │                                                      │        │ A chip   (2rem)   │ │
│  │   #clipMain — same element in every phase            │        │ B title  (3rem)   │ │
│  │   (demo → work keeps playing, no reload)             │        │ C meta   (1.5rem) │ │
│  │                                                      │        │ D body   (flex 1) │ │
│  │                                                      │        │ E secondary 3.5rem│ │
│  └──────────────────────────────────────────────────────┘        │ F PRIMARY  3.5rem │ │
│                                                                  └───────────────────┘ │
```

- Video width `--vw = min(100vw − 30rem, (100vh − 8rem) × 16/9)`, height `--vh = --vw × 9/16`
  (800×450 at 720p). Stage height `--ph = max(--vh, 28.125rem)`; on 16:9 and 16:10 screens
  `--ph = --vh`, so the panel's top edge equals the video top and the primary button's bottom edge
  equals the video bottom. On 4:3 (1024×768) the width-limited video would leave the panel too
  short for the ring / stepper, so the stage keeps 28.125rem and the 16:9 clip sits vertically
  centred in its column (never cropped, never letterboxed with bars). The top bar uses the same two
  columns, so the progress bar ends at the video's right edge and 離開 sits on the panel's right edge.
- The video box never moves, resizes, or becomes a corner thumbnail. No banner and no centred
  single-column screen.
- Slots A–C are always present (even when empty), so titles sit at the same y in every phase.
- **Primary button (F) is always the same full-width box at the bottom of the panel.** Slot E
  (secondary, grey `--ghost` pill) is reserved even when empty. Both are 3.5rem capsules (56 px at
  720p, ≥52 px primary, ≥44 px HIG).
- Timers have two roles only **[choice: merges both audits]**:
  - The auto-advance countdown (intro 10 s, demo, preview 5 s, finish 5 s) is the trailing number
    inside the primary button.
  - The main timer (rest, round rest, timed move, stretch hold) is one ring, 8rem, at the left of
    body D, with the number only (no 秒 / 秒後開始).
- **Space / Enter = the primary button (F) in every phase** that has one: intro 開始, demo 開始,
  work 完成這組, rest / round rest 跳過休息, preview / stretch preview 開始, hold 下一個, finish 關閉 (timed has no primary; the
  key does nothing). Every primary carries the same `Space` kbd after its label; the auto-advance
  countdown stays the trailing number. Auto-repeat is ignored and the key is dead for 400 ms after
  each phase change, so holding Space advances exactly one phase. In a confirm dialog the key only
  activates the focused button and focus opens on the safe 繼續, so Space/Enter never confirm
  離開 / 跳過.
- **示範 OFF** (設定): no demo steps and no 5 s previews (circuit and stretch); intro goes straight
  to work / timed, and one stretch hold follows the other. The video box is unchanged and keeps
  looping the current move.
- **End-of-day stretch (last break only, after the training items, no rest before it):** per
  stretch and side (sided stretches: 右側 then 左側) a 5 s preview, then a `holdSec` (30 s) hold.
  Same frame as the circuit: the stretch clip loops in the video box, the side is the first span of
  the meta line. Sound is softer than the training chime (one low note per step, a two-note cue on
  the first step of the left side). The stretch is recorded only when its last hold ends; 離開 during
  it leaves it undone, and the day fails like unfinished sets.

| Phase | Video | A chip | B title | C meta | D body | E | F primary |
|---|---|---|---|---|---|---|---|
| intro | first item | `第 1 天` (plan `label`); last slot: `warning 最後一次` (fail) | plan `title` `胸與三頭` | — | plan rows 2.5rem: name ‹history icon if carried› · `4 × 8–15 下` | 跳過這次 | 開始 ‹10› |
| demo | this move | `示範` | name | `第 3/4 組`  `8–15 下` (two spans, 1rem gap) | up to 2 tips | — | 開始 ‹8› |
| work | same clip (keeps playing) | `換你做` (accent) | name | `第 3/4 組` | `8–15 下` 6rem + stopwatch + `3–5 秒/下` | — | 完成這組 Space |
| rest / roundRest | next move | `下一組` / `下一個動作` / `下一輪` | next name | next target | ring + `上一組 − 12 +` stepper | 延長 30 秒 | 跳過休息 |
| preview | this move | `下一個` | move | `30 秒` | move dots + up to 2 tips | — | 開始 ‹5› |
| timed | this move | `換你做` (accent) | move | circuit name | ring + move dots | — | — (reserved) |
| stretch preview | this stretch | `下一個` | stretch name | `右側`  `30 秒` (side only if sided) | stretch dots + up to 2 tips | — | 開始 ‹5› |
| hold | same clip | `self_improvement 拉伸` (accent) | stretch name | `右側`  `第 1/3 個` | ring + up to 2 tips beside it (the body is too short to stack them) | — | 下一個 Space |
| finish | last clip, dimmed, with the status icon | verdict `今天合格` / `今天不合格` / `完成` | `這次 6 組` | `下次 17:00`; `最後一次休息拉伸` when every set is done but the stretch waits; `拉伸沒做完` when the last break fails on the stretch | `13 / 25 組` + bar, stepper if the break ended on a rep set | — | 關閉 ‹5› |

The intro lists the stretch as its own row, last: `拉伸`  `5 × 30 秒` (holds × seconds; a sided
stretch counts two holds). The stretch is not a set: `N / 25 組` never includes it.

Leave and skip dialogs: title and buttons only. A body line appears only for a consequence, in red
(`離開 = 今天不合格`, `跳過 = 今天不合格`).

## 5. Main window

**Window.** Content size (`useContentSize`), minimum **800×600** CSS px (the smallest size the
matrix lint passes at with the sidebar expanded); default `min(1180, workArea − 80) ×
min(760, workArea − 60)`, i.e. 1180×668 on a 1366×768 screen (work area 1366×728), 1180×760 on
1080p.

**Breakpoints [choice].** Container queries on `#content` (the area right of the sidebar, so they
follow Windows display scaling too; 965×940 at 150 % = 643×627 CSS px):

| Width | Change |
|---|---|
| window < 720 | sidebar → 64 px icon rail (brand + nav labels hidden, `title` tooltips) |
| content < 600 | gutter 32 → 24 |
| day line < 46 px per stop (JS, `#dayLine` width − 120) | 今天 day line → vertical rows (time · dot · owed moves · status) |
| content < 1000 | 今天 hero time `--t-ring` 48 instead of `--t-hero` 96 |
| content < 700 | calendar gap 6, cell padding 6 |
| content < 960 | 設定 panels stack; menu table one column |
| content < 1000 | 記錄 calendar → detail → chart in one column |
| window < 720 | player modal padding 16 |
| window < 560 | player one column (video above the tips); the modal scrolls, `overscroll-behavior: contain` |
| window ≤ 600 (web build only, `src/web/main.css`) | the sidebar becomes a bottom tab bar (3 tabs + pause / notification, icons, active = accent icon, `safe-area-inset-bottom` padding); the pause menu opens above its button; the sticky head gets `safe-area-inset-top` |
| content < 480 (phone, web build) | gutter 16, surface padding 12, page title → title2, page action drops under the title, 今天 hero one column (clip above the text), 記錄 stats wrap under the streak, calendar cells 44 px date only (colour = status, % stays in the detail), month label short (`Sep 2026`), segmented controls in a field span it, weekday toggles 30 px, menu table puts the name above its controls (`52 12 52 20 52 1fr 32`) |

- **Page head:** sticky frosted bar, `min-height` 88, full-bleed (`.tab > :not(.page-head)` get
  the gutter instead of negative margins). 今天 = eyebrow `第 1 天` (subheadline 600, muted) above
  the large title = plan `title` (`胸與三頭`, `背、肩、二頭與臀腿`, `腹肌核心`; English `Chest & Triceps`,
  `Back, Shoulders, Biceps & Legs`, `Core`). Titles never wrap. Rest / off day: no eyebrow, h1 = the
  date (`9月24日 週四`), since the hero already says 今天休息. `現在就休息` is hidden when nothing
  is owed today (no dead button beside a directive hero).
- **今天 hero (the one raised surface):** `5fr 4fr` grid, clip left (16:9, `--r-md`, looping,
  muted: the first move of the next stop that owes sets; a stop that owes nothing only sends the walk
  reminder, so it is skipped) + text right: time (`--t-hero` / `--t-ring`, ink) and `還有 25 分` /
  `還有 1 小時 1 分` (title3, accent; minutes rounded up, `即將開始` at 0) on one baseline, `最後一次`
  fail pill when it is the last stop; move name (title2); meta in the overlay's intro format
  (`2 × 8–15 下`, `8 × 30 秒`, body muted); further moves owed at the same stop as quiet rows under a
  divider. **Directive states** (nothing owed today), same frame: state word (largeTitle) —
  `今天完成` (day passed) / `今天結束` (day failed or no stop left) / `已暫停到明天` / `今天休息` /
  `今天不用練` — then when the next training day starts (`明天 11:00` or `9月28日 週一 11:00`, title3
  accent), its plan title (headline) and the move that is playing with its meta (`Y字 · 3 × 15–20 下`,
  body muted). The state word is the only large line; no separate `第 2 天` line (the title implies
  it). The clip plays that day's first move, so a move is always visible and moving.
- **Day line (on the ground):** the workday as a transit line. `grid-auto-flow: column`, one equal
  track per stop; each stop = dot + time (subheadline, muted; next = 600 accent). **Shape carries the
  state, colour is the second cue:** done = filled accent 12, partial = 2 px accent ring with the left
  half filled, missed or skipped = hollow 12 with a 2 px red ring, later (owes sets) = hollow 12 (2 px
  muted ring), passed / free (nothing owed) = 6 px muted, covered (owed nothing on a passed day, its
  sets were done earlier) = 6 px accent, **next = accent 16 + 5 px `--accent-soft` halo** (= the
  hero's stop). Track 2 px: `--muted` into a stop behind you, `--track` ahead. Hover / keyboard focus
  on a stop (`tabindex=0`, `aria-label` = time, status, moves) opens a tooltip below it (`--surface`,
  hairline, `--r-md`): the status word (`完成` / `部分完成` / `跳過`, subheadline 600 muted), then
  `伏地挺身 5/5` per move; a stop with no moves of its own shows the sets done in its break (`3 組`),
  `補做` (last stop) or `走動` (walk reminder only), never `—`. The last stop of a training day
  holds `拉伸` (no count; `full` once done), after `補做` when earlier sets are carried to it, and
  its `aria-label` says `拉伸` too. When every set is done but the stretch is owed, the hero is
  that last stop: `拉伸`  `5 × 30 秒`, the first stretch's clip looping. The progress figure `7 / 25 組` (done
  count headline ink, rest body muted) ends the line; in vertical mode it sits above the rows. Narrow
  (< 46 px per stop): the same stops as the vertical rows (time · dot · moves with counts · status),
  same dot shapes at 8 px, no surface.
- **Library (on the ground):** `repeat(var(--cols), 1fr)`, gap 24 × 16. `main.js libCols()` picks
  the column count that divides the day's move count, tiles ≥ 180 px, so no tile is left alone on a
  last row: 第 1 天 (6) = 2 at 800, 3 at 965–1366, 6 at 1920+; 第 2 天 (8) = 2 / 4; 第 3 天 (2) = one
  row in up to 3 columns; 拉伸 = today's stretches (every stretch on a rest / off day; 第 1 天 3,
  第 2 天 6, 第 3 天 2), player meta `每邊 30 秒` for a sided stretch; phone 1. Each tile is a `<button>`: clip 16:9 `--r-md` + name under it
  (body, one line with an ellipsis; English may wrap), no tile background; hover plays the clip,
  `:active` press. Header = title3 + segmented filter. No moves for a filter: an empty state.
- **Segmented control:** equal-width segments (`inline-grid`, `grid-auto-columns: 1fr`), 2 px track
  padding, 32 px segments, selected = neutral raised thumb (`--seg-on`: white + `--seg-edge`
  shadow in light, systemGray2 in dark) with primary text; labels subheadline, never wrap.
- **Player:** video `1fr` + side column `clamp(220px, 30%, 320px)`, title2 title, 關閉 at the bottom.
- **History:** the streak is the hero: `連續 4 天` / `4 days in a row` with the numeral in
  `--t-hero` ink and the words in title2, one baseline. No streak: the same slot says when the next
  training starts (`下次 11:00` / `明天 11:00`, time in `--t-hero`), never a big `0`. The other three
  stats are a quiet inline row on the same baseline, right-aligned (wraps under at narrow widths):
  `合格率 63%` `最長 6 天` `9月 183 組` (label body muted, value headline ink; percentages via
  `Intl.NumberFormat`). Below, grid `1fr 320px` with areas
  `cal detail / chart detail`: the calendar and the picked day's detail are the two raised surfaces,
  the 30-day chart sits on the ground under the calendar (title3 heading, no wrapper); one column
  under 1000 content px (calendar → detail → chart). Calendar cells 64 px: day number (subheadline
  600) + % (headline); no plan-day line. **Only results get a fill, and pass / fail differ by
  fill type, not only hue:** pass = solid `--accent-fill` with `--accent-ink` text, fail =
  `--fail-soft` tint with `--fail-on-soft` text, today in progress = 1 px `--accent-line` ring; every
  other day (future, rest, off, before the first record) is a bare numeral, no border, no fill. A
  cell with a record is a `<button>` (`aria-pressed` = picked) and gets a `--muted` edge on hover.
  Chart drawn at its real pixel width (ResizeObserver), bars ≤ 16 px: pass = `--accent`, anything
  else `--muted` (the height shows the shortfall; the bar `<title>` carries the % and 合格 / 不合格);
  date label every 5th bar (every 10th under 480 px), axis footnote 13 px. Detail = date + pill,
  then one row per exercise (name, `3/4 組` accent when complete, muted when short: the red is the
  day pill), reps `12、10、9 下` in subheadline), then the note. No subtitle, no slot strip, no 已儲存
  caption.
- **Settings:** each field = label (one line, never wraps) left + control right; if the control
  can't fit it drops below, still right-aligned. Rows ≥ 52 px with `--line-soft` dividers; the
  two top groups are top-aligned and each ends at its last row (grouped lists, not equal-height
  cards). Inputs 88×36 (`name`, `autocomplete="off"`, `inputmode="numeric"`); switches 51×31 (knob
  moves by `transform`, hover = 8 % text mix); weekday
  toggles 36 px circles (built once per language, then only restyled, so a click is never lost to a
  re-render); slider 160×28 hit region with a 4 px track; `間隔（分鐘）` uses full-width
  parentheses. An invalid 開始 / 結束 time keeps the typed text with a `--fail-text` edge and
  `aria-invalid` until it is fixed; nothing is saved and no error text is added (§6).
- **Menu table (菜單組數 / 次數):** one fixed-track grid per row, header included:
  `minmax(max-content,1fr) 56 12 56 20 56 12 32` = name | 組 | · | min | – | max | · | reset.
  Names never truncate (longest 保加利亞分腿蹲). Two columns ≥ 960 content px with
  `column-gap: calc(var(--gap) + 2 × var(--pad))` (column 2 starts under the 一般 panel), one below.
- **Focus ring:** keyboard only. `:focus-visible` plus `theme.js` tracking the last input device
  on `<html data-input>` (Chromium re-shows the ring on a mouse-clicked nav item after Alt+Tab).
  Any key other than a lone modifier or typing into a field hands the ring back to Chromium's own
  `:focus-visible`, so focus a key moves by script (Esc → 離開休息？ focuses 繼續) is shown.
  `#content` has `scroll-padding-top` = the sticky head, so a focused item never lands under it.
- **Navigation hover:** a 50 % `--side-on` step, lighter than the selected tab, so only one item
  ever reads as selected.
- **URL:** tab, picked day and library filter are in the query string (`?tab=history&date=…&f=d2`,
  `history.replaceState`; `f` = d1 / d2 / d3 / stretch), so a reload or bookmark of the web build returns to the same view.

## 6. Text policy

Delete any text that explains instead of informing: page eyebrows other than 第 N 天, slot
preview, 從明天起生效, 照順序練三天休一天, 非上班日不算進循環, 不排休息, 還剩 N 組, `N 次`,
`N 合格 · N 不合格`, legend, 完成率, detail section headers, detail subtitle (`第 1 天 · 胸 + 三頭 ·
完成 0%`), slot strip, 已儲存, calendar plan-day line, sidebar date/clock, 循環 card, 秒後開始,
共 N 組, 上次留下 (icon only), muscle line, the non-warning leave text, the warning banner.

**No middle dots, no ASCII `+` inside CJK text [2026-09-25].** Plan titles are written the way a
person says them: `胸與三頭`, `背、肩、二頭與臀腿`, `腹肌核心` (`、` between items, `與` before
the last); separate facts are separate spans with a gap (overlay meta) or separate lines / a
full-width space (tray menu `第 1 天　胸與三頭`, tooltip lines); lists use `、` (`12、10、9 下`);
`+30 秒` became `延長 30 秒`.
**Numerals and CJK [2026-09-25]:** dates have no space (`9月15日 週二`, `2026年9月`, `9月` in the
month stat, Apple zh-TW / `Intl`), standalone counts and ordinals do (`183 組`, `第 1 天`,
`7 / 25 組`, `還有 25 分`). `plan.json` days carry `label` (`第 1 天`) + `title` (`胸與三頭`); ids
and structure unchanged. English titles are names joined with `,` / `&` (`Chest & Triceps`), never
a `·` chain (the tray header is `Day 1: Chest & Triceps`; circuit rounds `Core Round 1`).
**One verb per action, end to end:** `現在就休息` opens the break, whose intro button is `開始`;
the last screen says `完成`. English copy uses curly apostrophes (`don’t`) and Title
Case for labels and buttons (`Walk Reminder`, `Open at Login`). One term per feature in both
places it shows (`開機啟動` in settings and the tray; `預覽休息畫面` / `Preview Break`). The one
error the user can hit before the app starts (`dataError`) names the file and the fix; empty
states stay bare (`沒有記錄`), per the minimal-text brief.

## 7. Demo clip assets (`assets/clips/*.mp4`)

The video box is always visible, so the footage itself must be clean. Every clip is:
- 960×540 (exact 16:9, fills the box with no `object-fit` cropping), H.264 CRF 22, no audio,
  poster `<clip>.jpg` = the clip's first frame (no flash when playback starts).
- A hard crop of the source, `1664×936` at `x=256, y=0` (1920×1080 source), so the burned-in
  subtitle line (top ≈ y 955) is outside the frame. No blurred bands. The source watermark stays whole.
- Core circuit moves (plank, crunch, v_crunch, crunch_toe_touch, alt_leg_raise): the source's
  title and countdown ring are replaced by a clean wall plate taken from the same camera setup
  before the overlay appears (brightness-matched per frame). No blur patches.
- Cut inside one shot: no hard cut within ±1 frame of either end. In/out points are chosen so
  the last frame flows into the first (loop seam ≤ the clip's largest normal frame step); where
  poses cannot match, the last 8 frames cross-fade into the frames just before the in-point.
- Rebuild script and in/out log: session scratchpad `recrop/build.py`, `recrop/build_log_all.json`.
- Stretch clips `stretch_<id>.mp4` / `.jpg` come from a second video (Bilibili BV1yz411q7XE, plan
  `stretchSource`); `plan.stretches[id].window` is the source time range. Same spec. Until a file
  exists the box shows the placeholder (desktop: `fs.existsSync`; web: the file list build-web.js
  bakes into the bundle, so a missing clip is never requested).

## 8. HIG pass (`docs/hig/*.txt`)

- **Hit regions** (buttons.txt: 44×44 pt): overlay pills 3.5rem (56 px at 720p), `#leaveBtn`
  2.75rem (44 px), dialog pills 3rem (48 px), stepper circles 3rem (48 px). Main window buttons
  44 px (`--btn`), form controls 36 px (mouse-driven, macOS level).
- **Contrast** (accessibility.txt: 4.5:1 up to 17 pt, 3:1 at 18 pt or bold): every text/background
  pair in §9 is computed with the WCAG luminance formula; all text pairs are ≥4.5:1, so no pair
  relies on the bold exception. Countdown numbers in the primary pill are full-opacity (was 60 %).
  `kbd` keeps full-opacity text and fades only its outline (`color-mix`, 45 %).
- **Capsules** (buttons.txt: prefer a capsule when a button stands alone): every button is a pill.
- **Activity rings** (activity-rings.txt): the timer is ONE ring, ONE accent, neutral grey track
  (`--track`), never a coloured dim track and never concentric rings.
- **System colours**: exact HIG RGB values only (Green dark 48,209,88; Orange 255,141,40 and
  accessible 197,83,0; Red 255,56,60 / dark 255,66,69 / accessible 233,21,45 and dark 255,97,101;
  systemGray2/4/5/6).
- **Corners**: `corner-shape: squircle` (supported in this Electron, Chrome 152); pills and circles
  opt out to `round`.
- **Assistive tech**: every Material Symbol is `aria-hidden` (ICON() in main.js / overlay.js,
  clip.js, static markup), so buttons read their text label, not `play_arrow`. Icon-only buttons
  carry an `aria-label` (month arrows, rep stepper, menu reset); 開始 / 結束 labels use `for`;
  the note has an `aria-label`; weekday toggles expose `aria-pressed`. Headings go h1 → h2 → h3
  (overlay dialog title h2, menu table day h3). `BreakFit` is `translate="no"`.
- **Motion**: `prefers-reduced-motion: reduce` makes every UI transition instant and drops the
  press scale. The demo clip keeps playing: it is the exercise instruction, and 設定 → 示範
  turns it off.
- **Touch (web build)**: `touch-action: manipulation` on controls, no tap highlight (the press
  scale is the feedback), `viewport-fit=cover` + safe-area insets on the phone break overlay,
  `<meta name="theme-color">` follows `--bg` (theme.js).

## 9. Themes (設定 → 配色)

`settings.theme` = `dark` (default) | `light`, persisted. Windows load with `?theme=`; `theme.js`
sets `<html data-theme>` before first paint; `applyTheme()` in app.js pushes changes live to the
main window, the overlay and every cover window, and sets each BrowserWindow's background colour
(`BG` / `STAGE_BG`, = `--bg` / `--stage`).

| Token | Dark (Fitness) | Light (Health) |
|---|---|---|
| `--bg` / `--stage` / `--cover-bg` | `#000000` | `#f5f5f7` parchment |
| `--side-bg` / `--side-on` | `#161617` / `#2c2c2e` | `#e8e8ed` / `#ffffff` |
| `--surface` | `#1c1c1e` (systemGray6) | `#ffffff` |
| `--surface-2` / `--surface-3` | `#2c2c2e` / `#3a3a3c` (systemGray5/4) | `#e8e8ed` / `#d2d2d7` |
| `--seg-on` / `--switch-off` / `--knob` / `--ghost` | `#636366` / `#3a3a3c` / `#fff` / `#2c2c2e` | `#fff` / `#e8e8ed` / `#fff` / `#fff` |
| `--hairline` / `--line-soft` | white .08 / white .10 | black .08 / black .08 |
| `--text` / `--muted` | `#ffffff` / `#98989d` | `#1d1d1f` ink / `#636366` |
| `--accent` | `#30d158` HIG Green dark | `#ff8d28` HIG Orange |
| `--accent-text` | `#30d158` | `#c55300` HIG Orange accessible |
| `--accent-fill` / `--accent-ink` | `#30d158` / `#000000` | `#c55300` / `#ffffff` |
| `--accent-soft` / `-line` / `-on-soft` | green .16 / green .45 / `#30d158` | orange .16 / `#c55300` .45 / `#1d1d1f` |
| `--fail` / `--fail-text` | `#ff4245` / `#ff6165` | `#ff383c` / `#e9152d` |
| `--fail-soft` / `-line` / `-on-soft` | red .16 / red .45 / `#ff6165` | red .14 / `#e9152d` .45 / `#1d1d1f` |
| `--danger` / `--danger-ink` | `#e9152d` / `#fff` | `#e9152d` / `#fff` |
| `--bar-bg` / `--scrim` / `--backdrop` | black .80 / black .72 / black .60 | parchment .86 / parchment .84 / black .30 |
| `--track` / `--thumb` / `--strike` | `#2c2c2e` / `#3a3a3c` / white .30 | `#d2d2d7` / `#d2d2d7` / black .30 |

**Label on the accent [choice].** Dark: white on HIG Green is 2.02:1, so the green pill carries a
black label (10.39:1, the watchOS workout look). Light: white on HIG Orange 255,141,40 is 2.31:1;
the primary pill uses the accessible orange 197,83,0 as its fill with a white label (4.55:1),
which reads as an Apple tinted button; a dark label on bright orange was rejected as un-Apple.
Bright orange stays for thick graphics only (ring, 8 px bars, switch, slider, chart).

**Text on tints.** No HIG orange or red reaches 4.5:1 on its own tint (#c55300 on the orange tint
= 3.99), so in light the tints carry ink text (`--accent-on-soft` / `--fail-on-soft` = `#1d1d1f`)
and the colour is carried by the tint + icon. Pass/fail pills and pass calendar cells are solid (`--accent-fill` /
`--danger`), never tinted.

**Destructive [choice].** One `--danger` = HIG Red accessible 233,21,45 in both themes: white on
the dark-mode red 255,66,69 is only 3.43:1.

### Contrast (WCAG formula, computed from the token values; alpha tints composited first)

**Dark**

| Pair | Ratio | HIG |
|---|---|---|
| --text #fff on --bg #000 | 21.00 | ✓ |
| --text on --surface #1c1c1e | 17.01 | ✓ |
| --text on --surface-2 #2c2c2e | 13.94 | ✓ |
| --text on --seg-on #636366 | 5.99 | ✓ |
| --muted #98989d on --bg | 7.31 | ✓ |
| --muted on --side-bg #161617 | 6.30 | ✓ |
| --muted on --surface | 5.93 | ✓ |
| --muted on --surface-2 | 4.85 | ✓ |
| --accent-ink #000 on --accent-fill #30d158 | 10.39 | ✓ |
| countdown number (full opacity) on --accent-fill | 10.39 | ✓ |
| --accent-text #30d158 on --bg | 10.39 | ✓ |
| --accent-text on --surface | 8.42 | ✓ |
| --accent-text on --side-on #2c2c2e | 6.89 | ✓ |
| --accent-on-soft on --accent-soft/--bg | 8.42 | ✓ |
| --accent-on-soft on --accent-soft/--surface | 6.21 | ✓ |
| --fail-text #ff6165 on --bg | 7.15 | ✓ |
| --fail-text on --surface | 5.79 | ✓ |
| --fail-on-soft on --fail-soft/--bg | 6.23 | ✓ |
| --fail-on-soft on --fail-soft/--surface | 4.86 | ✓ |
| --danger-ink #fff on --danger #e9152d | 4.56 | ✓ |
| --accent #30d158 vs --track #2c2c2e (non-text) | 6.89 | graphic, no HIG minimum |

**Light**

| Pair | Ratio | HIG |
|---|---|---|
| --text #1d1d1f on --surface #fff | 16.83 | ✓ |
| --text on --bg #f5f5f7 | 15.46 | ✓ |
| --text on --surface-2 #e8e8ed | 13.78 | ✓ |
| --text on --surface-3 #d2d2d7 | 11.17 | ✓ |
| --muted #636366 on --surface | 5.99 | ✓ |
| --muted on --bg | 5.50 | ✓ |
| --muted on --surface-2 / --side-bg | 4.90 | ✓ |
| --accent-ink #fff on --accent-fill #c55300 | 4.55 | ✓ |
| countdown number (full opacity) on --accent-fill | 4.55 | ✓ |
| --accent-text #c55300 on --surface | 4.55 | ✓ |
| --accent-text on --bg (icons/strokes only) | 4.18 | ✓ ≥3 (icons/strokes, never text) |
| --accent-on-soft #1d1d1f on --accent-soft/--surface | 14.75 | ✓ |
| --accent-on-soft on --accent-soft/--bg | 13.64 | ✓ |
| (rejected) #c55300 on --accent-soft/--surface | 3.99 | ✗ (not used) |
| (rejected) white on HIG Orange #ff8d28 | 2.31 | ✗ (not used) |
| --fail-text #e9152d on --surface | 4.56 | ✓ |
| --fail-on-soft #1d1d1f on --fail-soft/--surface | 13.91 | ✓ |
| --danger-ink #fff on --danger #e9152d | 4.56 | ✓ |
| --accent #ff8d28 vs --track #d2d2d7 (non-text) | 1.53 | graphic, no HIG minimum |
| --accent #ff8d28 on --surface (non-text fill) | 2.31 | graphic, no HIG minimum |

Re-verify after any token change: selftest-out/*.png (dark) and selftest-out/light-*.png.
The selftest drives Space/Enter in every phase with a primary (intro, demo, work, rest, round rest,
finish) and in both confirm dialogs (離開, 跳過), and flips the theme while an overlay and a cover
window are already open (light-30-cover = live-switched cover; light-31-cover-new = freshly opened).


## 10. Size matrix + layout lint

`npm.cmd run selftest -- --matrix` (≈ 4 min; the normal selftest stays ≈ 50 s and keeps the
matrix folder; add `--quick` for main window 965/1366/1920/2560 only, ≈ 25 s, while iterating).
Hidden windows, temp profile, both themes:

- Main window 800×600, 900×700, 965×940, 1024×768, 1280×720, 1366×768, 1440×900, 1600×900,
  1920×1080, 2560×1440, plus 965×940 at zoom 125 % and 150 % → 今天 (top + bottom, plus the
  directive hero states `done` and `rest` via `__test.hero()`), player, 記錄 (detail +
  chart, top + bottom), 設定 (top + bottom incl. menu table).
- Overlay 1024×768, 1280×720, 1280×800, 1366×768, 1440×900, 1536×864, 1920×1080, 2560×1440 →
  intro, demo, work, rest, finish, leave dialog (第 1 天) and last intro, timed, round rest,
  finish pass (第 3 天).
- PNGs: `selftest-out/matrix/<theme>-<screen>-<W>x<H>[@zoom].png`; lint: `selftest-out/matrix/lint.json`
  (`total`, `bySize`, `byRule`, distinct type combos with counts, every issue with selector +
  text + size). Lint source: `src/main/layout-lint.js`.

Rules: (a) horizontal overflow (scrollWidth > clientWidth + 1) unless `[data-lint-scroll]`;
(b) border box outside its card / panel / dialog, or outside the window (overlay: also below);
(c) ellipsis-truncated or overflow-clipped text (overlay scrollers count as clipped);
(d) a ≤ 8-char label, button, segment, chip, pill or heading on more than one line;
(e) list/table column edges differing > 1 px (settings fields, menu rows + header, timeline,
detail rows, overlay plan rows); (f) font-size / line-height / weight not a §3 token, or < 13 px
rendered; (g) hit targets: main window ≥ 28×28 (macOS default control size), `.btn` ≥ 44 high;
overlay ≥ 44×44.

Phone widths (web build only; the desktop window's minimum is 800×600): `npm.cmd run test:web`
runs the same lint (`TOKENS` / `GROUPS` / `ROLES` exported from `layout-lint.js`) at 390×844 and
360×740, 繁中 + English, top and bottom of 今天 / 記錄 / 設定; any issue fails the run.

Result 2026-09-24: 6444 issues before (1280×720 alone: 348) → **0** at every size, both themes (256 screens incl. main 2560×1440).
Result 2026-09-25: phone widths 750 issues → **0**; matrix still 0 (306 screens).
Result 2026-09-25 (hero pass): matrix **0** (364 screens) incl. the new 今天 hero / day line / directive states and
the 記錄 streak row, both themes, 繁中 + English; phone lint 0.
Intentional exceptions: none.
