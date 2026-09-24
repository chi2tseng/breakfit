# BreakFit design system

Scope: every renderer screen (`src/renderer/*`): main window (今天 / 記錄 / 設定, library,
player), break overlay (every phase + dialogs), cover windows.

**One design language, two colour themes (2026-09-24 rewrite).** The language is Apple's, taken
from `docs/hig/getdesign-apple.md` (typography, radius, spacing, elevation, pill CTA) and the HIG
text in `docs/hig/*.txt` (system colours, contrast, hit regions). The user asked for the same
「字體感覺」 across everything. Dark = Apple Fitness (black, HIG Green); light = Apple Health
(parchment + white cards, HIG Orange). **Only colour tokens differ between the themes.**

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
| `--font-display` | `"SF Pro Display", "SF Pro Text", -apple-system, "Inter", "PingFang TC", "Microsoft JhengHei UI", …` |
| `--font` (text) | `"SF Pro Text", "SF Pro Display", -apple-system, "Inter", "PingFang TC", "Microsoft JhengHei UI", …` |
| features | `font-feature-settings: "ss03"` (Inter's closest match to SF's rounded forms), `tabular-nums` everywhere |
| weights | `--w-regular` 400 · `--w-semibold` 600 · `--w-bold` 700. **No 500 anywhere** (Inter 500.css is no longer loaded; 400/600/700 are) |
| tracking | `--tr-display` −0.015em (≥21 px: Apple −0.005em + Inter nudge −0.01em) · `--tr-body` −0.02em (17 px = −0.374 px) · `--tr-caption` −0.016em (14 px = −0.224 px) · 0 at ≤12 px |
| `--lh-body` | 1.44 (Apple 1.47 − 0.03 for Inter's taller x-height) |

SF Pro is never embedded (typography.txt: "don't embed system fonts"); it is used when the OS has
it and Inter (bundled via @fontsource) takes over on Windows. `system-ui` / `BlinkMacSystemFont`
are deliberately left out: on Windows they resolve to Segoe UI and would beat Inter.

### 1.2 Shape, size, elevation (same in both themes)

| Token | Value | Use |
|---|---|---|
| `--r-xs` | 5 px | `kbd` |
| `--r-sm` | 8 px | nav items, inputs, cycle cells |
| `--r-md` | 11 px | library cards, calendar cells, player video, textarea |
| `--r-lg` | 18 px | cards, panels, player card, overlay video + dialog (`--o-r-lg` 1.125rem) |
| `--r-pill` | 9999 px | every button, segmented control, pills/chips, switch, progress bars |
| `--btn` / `--ctl` | 44 / 36 px | main-window buttons (HIG 44 pt hit region) / form controls |
| `--press` | `scale(0.95)` | `:active` on buttons, icon buttons, library cards |
| `--blur` | `saturate(180%) blur(20px)` | the frosted sticky page head only |

Squircle: `corner-shape: squircle` on every box; everything pill/circle opts out with
`corner-shape: round` (list in `base.css`, now including `.btn`, `.icon-btn`, `.seg`, day
toggles, stepper and the slider).

**Elevation [Apple: no shadows on cards or buttons].** `--shadow` / `--shadow-pop` are gone.
Levels: flat (page, sidebar) → 1 px `--hairline` rgba edge (cards, panels, dialogs, player) →
backdrop blur (the sticky page head, the one floating bar). The only `box-shadow`s left are
1 px hairline rings on the switch/slider knob and the 1–2 px inset ring on the "next" timeline dot.

### 1.3 Colour roles (values per theme in §9)

| Token | Role |
|---|---|
| `--bg` / `--side-bg` / `--side-on` | page / sidebar / selected nav item |
| `--surface` / `--surface-2` / `--surface-3` | cards + dialogs / control fill (secondary pill, chip, seg track, input) / track + hover (never under muted text) |
| `--seg-on` · `--switch-off` · `--knob` · `--ghost` | selected segment · switch off track · switch + slider knob · secondary pill on the overlay stage |
| `--hairline` / `--line-soft` | 1 px card/input edge / row dividers |
| `--text` / `--muted` (`--faint` = `--muted`) | the only two text colours |
| `--accent` | HIG accent for thick graphics: ring arc, 8 px bars, switch on, slider fill, chart bars, logo, dots |
| `--accent-text` | accent as text, icons, thin (4 px) strokes, focus ring |
| `--accent-fill` / `--accent-ink` | primary pill fill / its label (also pass pill, selected weekday) |
| `--accent-soft` / `--accent-line` / `--accent-on-soft` | tint (pass cell, chip, cycle) / tint edge / text on the tint |
| `--fail` / `--fail-text` / `--fail-soft` / `--fail-line` / `--fail-on-soft` | the same five roles for failure (HIG Red) |
| `--danger` / `--danger-ink` | destructive pill (離開 / 跳過 confirm), 不合格 pill |
| `--stage` / `--cover-bg` / `--bar-bg` / `--scrim` / `--backdrop` / `--track` / `--thumb` / `--strike` | overlay page / other monitors / frosted head / over the finished video / behind dialogs / progress + ring track / scrollbar / line-through |

## 2. Spacing

Apple scale: 4 · 8 · 12 · 17 · 24 · 32 · 48 px (base 8). Structural gaps 16/24/32; 4 and 12
inside components. Overlay rem equivalents 0.25 / 0.5 / 1 / 1.5 / 2 / 3.

- Content padding 0 32 32; page head (sticky, frosted) 88 high, full-bleed, h1 left + action right.
- Grid gap 16. Card/panel padding 24 (Apple utility card). Panel head 36 + 12 below.
- Sidebar 200 wide, padding 24 12, brand 44 high, nav items 40 high, gap 4.

## 3. Type scale

Main window (px / line-height / weight / tracking):

| Style | Spec | Where |
|---|---|---|
| fine-print | 12 / 16 px / 400·600 / 0 | pills, calendar day + labels, chart axis, week header, menu-table labels, slot strip |
| caption | 14 / 20 px / 400·600 / −0.016em | card labels (600), seg, cycle cells, timeline status, library names (600), footer clock |
| body | 17 / 1.44 / 400·600 / −0.02em | default: nav, labels, inputs, buttons (400), timeline, tips, detail rows |
| tagline | 21 / 1.19 / 600 / −0.015em | panel titles, detail date, brand |
| title | 28 / 1.14 / 600 / −0.015em | player title |
| display-md | 34 / 1.12 / 600 / −0.015em | page h1 |
| display-lg | 40 / 1.10 / 600 / −0.015em | KPI values (`7 / 25 組`, `14:00`, `63 %`) |

Overlay (rem, 1rem = 16 px at 1280×720, 24 px at 1080p; same styles, bigger for distance —
workouts.txt "use large font sizes, high-contrast colors"):
14 `mode-tag`, `kbd` · 17 body, chips (600), plan rows, tips, all buttons (600) · 21 meta line,
unit `下`, `13 / 25 組` · 28 dialog title · 34 stopwatch (400), stepper value (600) · 40 title (600)
· 48 ring number (700; 36 for 3 digits) · 96 work target (700). Big numerals use `--font-display`.

Button weight **[choice]**: main-window pills use 400 (the doc's `button-primary` = body 17/400);
overlay pills and chips use 600, because they are read mid-workout from a distance.

## 4. Break overlay: one fixed stage for every phase

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
  (800×450 at 720p). The panel is exactly `--vh` tall, so its top edge equals the video top and
  the primary button's bottom edge equals the video bottom. The top bar uses the same two
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
  - The main timer (rest, round rest, timed move) is one ring, 8rem, at the left of body D, with
    the number only (no 秒 / 秒後開始).
- **Space / Enter = the primary button (F) in every phase** that has one: intro 開始, demo 開始,
  work 完成這組, rest / round rest 跳過休息, preview 開始, finish 關閉 (timed has no primary; the
  key does nothing). Every primary carries the same `Space` kbd after its label; the auto-advance
  countdown stays the trailing number. Auto-repeat is ignored and the key is dead for 400 ms after
  each phase change, so holding Space advances exactly one phase. In a confirm dialog the key only
  activates the focused button and focus opens on the safe 繼續, so Space/Enter never confirm
  離開 / 跳過.
- **示範 OFF** (設定): no demo steps and no 5 s previews; intro goes straight to work / timed.
  The video box is unchanged and keeps looping the current move.

| Phase | Video | A chip | B title | C meta | D body | E | F primary |
|---|---|---|---|---|---|---|---|
| intro | first item | `第 1 天` (muted); last slot: `warning 最後一次` (fail) | day focus `胸 + 三頭` | — | plan rows 2.5rem: name ‹history icon if carried› · `4 × 8–15 下` | 跳過這次 | 開始 ‹10› |
| demo | this move | `示範` | name | `第 3/4 組 · 8–15 下` | up to 2 tips | — | 開始 ‹8› |
| work | same clip (keeps playing) | `換你做` (accent) | name | `第 3/4 組` | `8–15 下` 6rem + stopwatch + `3–5 秒/下` | — | 完成這組 Space |
| rest / roundRest | next move | `下一組` / `下一個動作` / `下一輪` | next name | next target | ring + `上一組 − 12 +` stepper | +30 秒 | 跳過休息 |
| preview | this move | `下一個` | move | `30 秒` | move dots + up to 2 tips | — | 開始 ‹5› |
| timed | this move | `換你做` (accent) | move | circuit name | ring + move dots | — | — (reserved) |
| finish | last clip, dimmed, with the status icon | verdict `今天合格` / `今天不合格` / `完成` | `這次 6 組` | `下次 17:00` | `13 / 25 組` + bar, stepper if the break ended on a rep set | — | 關閉 ‹5› |

Leave and skip dialogs: title and buttons only. A body line appears only for a consequence, in red
(`離開 = 今天不合格`, `跳過 = 今天不合格`).

## 5. Main window

- **Today:** `.cards` = `360px 1fr 1fr`, `.today-grid` = `360px 1fr`, so the first column edge
  lines up across rows. Card = label row (fixed 24 px, pills only for pass/fail) + value; no
  explanatory subtitles. Only live data stays (`還有 00:30`, `已暫停到明天`).
- **Library:** cards `minmax(176px,1fr)`, clip 16:9 `object-fit: cover`, name only (no muscle line).
- **Player:** video `1fr` + 320px side column, top-aligned with the video and 關閉 flush with the
  video bottom. Title 28/600, `30 秒` meta only for circuit moves. Secondary 關閉 is a grey pill.
- **History:** stat cards `repeat(3,1fr) 320px`, lower grid `1fr 320px`, so the detail panel
  aligns with the 4th card **[choice: audit 2; a 320px detail panel is readable, ¼ width is not]**.
  Calendar cells 72 px, radius 11, gap 8; pass/fail cells are tints with no border, rest/off cells
  `--surface-2`, empty days a `--line-soft` outline. Chart text 12 px. Empty states share one pattern
  (32 px `--muted` icon + 17 px `--muted` text). Slot strip = pills.
- **Settings:** two top panels stretch to equal height, each with exactly 5 field rows of 52 px, so
  row dividers line up across the columns: 時段 = 開始 / 結束 / 間隔(分鐘) / 上班日 / 提醒走動;
  一般 = 今天是 / 配色 (seg 深色 | 淺色) / 示範 (switch) / 示範秒數 / 開機啟動. With 示範 OFF the
  示範秒數 row stays in place (keeps the alignment) but is disabled at 40 % opacity. Each field row = `1fr auto`; every control's
  right edge sits on the panel content edge; time/number inputs are 88×36 `--surface-2` fills (radius 8, no border), centred, `--text`.
  Switches are iOS-sized (51×31, white knob); weekday toggles are 36 px circles (on = `--accent-fill`);
  the 示範秒數 slider is a 4 px pill track with `--accent` fill left of a white 22 px knob
  (`--p` set by `rangeFill()` in main.js); segmented controls are a pill track with a pill `--seg-on` thumb.
- **Menu table (菜單組數 / 次數):** two columns, `column-gap: 64px` (= 16 gap + 2 × 24 padding),
  so column 2 starts exactly under the 一般 panel's content. Every row, including the header, uses
  ONE fixed-track grid:
  `minmax(0,1fr) 56px 24px 56px 24px 56px 16px 32px` = name | 組 | · | min | – | max | · | reset.
  Row height 52 with `--line-soft` dividers. The header row carries the day title plus `組` and
  `次數` labels (12 px muted) centred over their inputs; no per-row units. Inputs 56×36.
  The reset column is always reserved. A changed row shows a 6 px accent dot after the name.

## 6. Text policy

Delete any text that explains instead of informing: page eyebrows (BreakFit, 每日記錄, date),
slot preview, 從明天起生效, 照順序練三天休一天, 非上班日不算進循環, 循環休息日…, 不排休息,
還剩 N 組, `N 次`, 休息日不中斷, `N 合格 · N 不合格`, legend, 完成率, 這天沒有開程式, detail
section headers, 秒後開始, 秒, 共 N 組, 上次留下 (icon only), muscle line, 下一個 label, 第一個：,
測試：沒有記錄, the `今天` bar label, the non-warning leave text, the full-width warning banner.
Keep only data the user acts on: times, statuses, counts, targets, tips (≤ 2), consequences.

SPEC.md §5 was updated to match (the work phase no longer shrinks the demo clip).

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
and the colour is carried by the tint + icon. Pass/fail pills are solid (`--accent-fill` /
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
