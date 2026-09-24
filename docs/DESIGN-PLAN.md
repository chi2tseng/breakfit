# Design plan — frontend-design pass 2 (2026-09-25)

Written by the main session following the frontend-design skill process (plan → review against brief → build → critique). Implementers follow this; DESIGN.md stays the token source of truth and must be updated to match.

## Subject, audience, job

- **Subject:** forced workout breaks for someone who sits at a trading desk all day. The app slices one workday into timed stops; each stop owes a specific exercise.
- **Audience:** one person, glancing at it between trades — seconds, not minutes.
- **Primary job:** answer "what do I owe at the next stop, and when?" at a glance; second job: show whether the habit is holding (streak / pass-fail calendar).

## Pinned by the client (do not change)

Apple Fitness (dark: #000 + HIG green) / Apple Health (light: #f5f5f7 + accessible orange) palettes; SF Pro → Inter (ss03) + Noto Sans TC; weights 400/600/700; Material Symbols; minimal text, no grey explanatory microcopy; min text 13px; break overlay = demo video left, controls right, Space = primary; layout lint 0 at every size; both languages.

## Tokens (unchanged values, clarified roles)

| Name | Dark | Light | Role |
|---|---|---|---|
| Ground | #000000 | #f5f5f7 | page |
| Surface | #1c1c1e | #ffffff | the ONE raised surface per screen area (hero, grouped lists) |
| Ink | #ffffff | #1d1d1f | text |
| Accent | #30d158 | #c55300 | the next stop, primary action, done state |
| Fail | HIG red | HIG red (accessible) | missed / failed |

Type roles: display numerals (time, countdown) = Inter/SF 700 tabular, the typographic hero; titles 600; body 400. One family (Latin) + Noto TC for CJK — no second display face.

## Layout concept

### 今天 — the day is a line, the next stop is the hero

Replace the two big-number cards + card-wrapped timeline with:

```
第 1 天
胸與三頭                                              [▶ 現在就休息]

┌─ next stop (the one raised surface) ───────────────────────────────┐
│ ┌──────────────┐   14:00            還有 20 分                       │
│ │  looping demo │   鑽石伏地挺身                                      │
│ │  of that move │   4 組 × 8–15 下                                    │
│ └──────────────┘                                                    │
└────────────────────────────────────────────────────────────────────┘
10:00 ●━━━●━━━●━━━◉───○───○───○───○───○───○───○ 21:00     7 / 25 組
      the workday as a transit line: done ● · next ◉ (accent) · later ○ ·
      missed ● red; each stop labelled with its time; hover/focus shows
      the exercise; narrow widths → vertical list (current timeline rows)
動作示範庫 (grid directly on the ground, no wrapper card)
```

- The **hero is the move you owe next, playing** — the most characteristic thing in this subject's world is the movement itself, not a number.
- Progress "7 / 25 組" becomes a quiet inline figure at the end of the day line, not a big-number card.
- Rest day / all done / day failed: the hero surface says what to do next (rest day → 「今天休息」 + next training day; all done → 「今天完成」 + tomorrow's plan; no more stops → 「今天結束」) — directive, not mood.
- Left aligned throughout; content column max 1200px (existing).

### 記錄 — the streak is the hero, the calendar is the evidence

Replace the 4 identical stat cards:

```
記錄
連續 4 天                                  合格率 63%   最長 6 天   9 月 183 組
━━━━━━━━━━━━  (streak as the one big numeral, stats as a quiet inline row)

┌ 2026 年 9 月  ‹ ›  ─────────────────────┐ ┌ selected day detail ─┐
│ calendar (existing cells)                │ │                       │
└──────────────────────────────────────────┘ └───────────────────────┘
最近 30 個訓練日 (bar chart, no wrapper card)
```

### 設定 — keep Apple grouped lists (that IS the platform idiom). Only fix what the web-design-guidelines review flags.

### Break overlay — keep (pinned). Only guideline fixes.

## Hierarchy of surfaces (anti card-kit)

- Exactly one raised surface per region: 今天 hero; 記錄 calendar + detail; 設定 groups. Everything else (day line, library grid, chart, section headings) sits on the ground with no card, no border.
- Radii follow hierarchy: hero/grouped surfaces 18, media 11, controls pill. No shadows (existing).

## Copy

- Titles: CJK 「胸與三頭」「背、肩、二頭與臀腿」「腹肌核心」 (no middle dots), EN "Chest & Triceps" etc. (done).
- Same verb end to end: 「現在就休息」 opens the break whose intro button is 「開始」; finish says 「完成」.

## Principles

1. The next move is always visible and moving.
2. One accent = "what's next / done"; red only for missed.
3. Spend boldness once per screen (the hero); everything else quiet.
4. Before shipping each screen: remove one accessory.

## Review against the brief (what I changed from my first instinct)

- First instinct kept the stat cards and just restyled them → that is the skill's named default (big number + small label cards). Changed to hero = next move (today) and hero = streak (history).
- First instinct for the day line was an Activity-ring style progress circle → rejected: HIG forbids imitating Activity rings and it's the Fitness cliché; a transit line matches the "workday sliced into stops" subject.
- Kept dark #000 + green despite the skill listing "near-black + acid green" as a default: the client pinned Apple Fitness dark; the brief wins.
