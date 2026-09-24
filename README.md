# BreakFit 休息練

Windows 托盤程式：上班時段每隔 N 分鐘跳出全螢幕休息，把當天的無器械訓練菜單拆到每次休息做完。跳過或沒做完的量滾到下一次，最後一次休息要全部做完，否則當天不合格。附每日合格月曆。

A Windows tray app that turns your work breaks into short no-equipment workouts. Every N minutes a full-screen break shows a looping demo and walks you through sets with rest timers. Skipped sets roll over to the next break; the last break of the day must clear everything, or the day is marked as failed.

> 開發中(work in progress)。English UI and a web version are coming.

## 菜單與示範片來源 / Credits

訓練菜單與示範片段取自 **FitMen六六** 的 Bilibili 影片「無器械健身教程」:<https://www.bilibili.com/video/BV1Gy4y1n7Pv/>。版權屬原作者所有，這裡的片段僅供示範動作使用。

The workout plan and demo clips come from **FitMen六六**'s Bilibili tutorial (link above). All rights to the footage belong to the original creator.

## 執行 / Run

```powershell
npm.cmd install
npm.cmd start            # 正式執行(常駐托盤)
npm.cmd test             # 核心邏輯單元測試(node --test)
npm.cmd run selftest     # 自動截圖自驗，不動真資料 → selftest-out\*.png
npm.cmd run fast         # 手動測時間表：1 分鐘 = 1 秒
npm.cmd run pack         # → dist\BreakFit-win32-x64\BreakFit.exe
```

- 關掉主視窗只會縮到托盤；要結束請用托盤選單「結束」。
- 打包版第一次啟動會註冊開機自動啟動(設定頁可關)。

## 資料位置 / Data

- `%APPDATA%\BreakFit\data.json`(寫入時先寫 `.tmp` 再改名)
- `selftest` / `fast` 用 `%TEMP%\breakfit-*` 暫存資料夾，不會碰正式資料。

## 文件 / Docs

- `SPEC.md` 行為規格、`DESIGN.md` 設計規範、`plan.json` 菜單
- `docs/hig/APPLE-STYLE.md`、`docs/hig/getdesign-apple.md`(MIT,取自 VoltAgent/awesome-design-md)設計參考(Apple HIG 原文未收錄，請見 <https://developer.apple.com/design/human-interface-guidelines>)
