# Apple Fitness / Health 風格參考(全部來自 HIG 原文，2026-09-24 下載)

使用者要求：設計照 Apple Fitness(深色)與 Apple Health(淺色),字體要一樣。

## 字體 —— 不能內嵌 SF

- HIG typography.txt:50:"don't embed system fonts in your app or game." SF Pro 只能靠系統提供。
- 本機(Windows)沒有安裝 SF Pro / PingFang。做法：font stack 把 Apple 字體放最前面，裝了就自動用；沒裝退回最接近的開源替代。
  - 拉丁/數字:`"SF Pro Display", "SF Pro Text", -apple-system, "Inter", ...`(Inter 已在專案裡)
  - 中文:`"PingFang TC", "Microsoft JhengHei UI", ...`
- 大數字(計時、次數)用 `font-variant-numeric: tabular-nums`,避免倒數時跳動。

## 字級(HIG iOS 預設 Dynamic Type「Large」表，typography.txt)

| Style | Size / Leading (pt) | Weight(強調) |
|---|---|---|
| Large Title | 34 / 41 | Regular(Bold) |
| Title 1 | 28 / 34 | Regular(Bold) |
| Title 2 | 22 / 28 | Regular(Bold) |
| Title 3 | 20 / 25 | Regular(Semibold) |
| Headline | 17 / 22 | Semibold |
| Body | 17 / 22 | Regular(Semibold) |
| Callout | 16 / 21 | Regular |
| Subhead | 15 / 20 | Regular |
| Footnote | 13 / 18 | Regular |
| Caption 1 | 12 / 16 | Regular |
| Caption 2 | 11 / 13 | Regular |

macOS 表(主視窗滑鼠操作可參考):Large Title 26、Title1 22、Title2 17、Title3 15、Headline 13 Bold、Body 13、Caption 10。

## 系統色(HIG color 頁原始 RGB)

| 色 | Light | Dark | Accessible light | Accessible dark |
|---|---|---|---|---|
| Orange | 255,141,40 | 255,146,48 | 197,83,0 | 255,160,86 |
| Red | 255,56,60 | 255,66,69 | 233,21,45 | 255,97,101 |
| Green | 52,199,89 | 48,209,88 | 0,137,50 | 74,217,104 |
| Yellow | 255,204,0 | 255,214,0 | 161,106,0 | 254,223,67 |
| Blue | 0,136,255 | 0,145,255 | 30,110,244 | 92,184,255 |
| Pink | 255,45,85 | 255,55,95 | 231,18,77 | 255,138,196 |

灰階(iOS default):

| | Light | Dark |
|---|---|---|
| systemGray | 142,142,147 | 142,142,147 |
| systemGray2 | 174,174,178 | 99,99,102 |
| systemGray3 | 199,199,204 | 72,72,74 |
| systemGray4 | 209,209,214 | 58,58,60 |
| systemGray5 | 229,229,234 | 44,44,46 |
| systemGray6 | 242,242,247 | 28,28,30 |

- 深色(Fitness 風):底色純黑 #000,卡片 systemGray6 dark(28,28,30),分隔 systemGray5/4 dark。
- 淺色(Health 風):底色 systemGray6 light(242,242,247),卡片白色 #FFF。強調色 = Orange。**白底上的橘色文字/細線用 accessible light 197,83,0**;橘色實心按鈕上的字要算對比(4.5:1 / 18pt 以上或粗體 3:1)。
- 失敗 = Red。

## Activity rings 的禁忌(activity-rings.txt)

- 不可以把自己的圓環做得像 Activity rings(紅/綠/藍三圈同心):「Differentiate other ring-like elements from Activity rings」「Don't use Activity rings for decoration」。倒數圓環用單一強調色、單圈。

## 運動中畫面(workouts.txt:29)

- "Make sure text is legible for when people are in motion. When a session requires movement, use large font sizes, high-contrast colors" —— 休息畫面的數字要大、對比要高。
- 運動中不顯示不相關資訊(workouts.txt Best practices)。
