# BreakFit 休息練

Windows 托盤程式：上班時段每隔 N 分鐘跳出全螢幕休息，把當天的無器械訓練菜單拆到每次休息做完。跳過或沒做完的量滾到下一次，最後一次休息要全部做完，否則當天不合格。附每日合格月曆。

A Windows tray app that turns your work breaks into short no-equipment workouts. Every N minutes a full-screen break shows a looping demo and walks you through sets with rest timers. Skipped sets roll over to the next break; the last break of the day must clear everything, or the day is marked as failed.

> 開發中(work in progress)。English UI is coming.

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

## 網頁版 / Web

**<https://chi2tseng.github.io/breakfit/>** — 不用安裝，瀏覽器開著就會照時間表跳休息。

- 分頁要開著(可以在背景);休息畫面蓋在頁面上，按「開始」後進全螢幕。
- 側欄「開啟通知」:分頁在背景時，休息時間到會跳系統通知。
- 側欄「暫停提醒」:30 分鐘 / 1 小時 / 2 小時 / 到明天。
- 記錄存在這個瀏覽器的 localStorage(清除網站資料就會不見;不同瀏覽器、裝置不共用)。
- 沒有開機啟動、托盤;要常駐提醒請用 Windows 版。

No install: keep the tab open (background is fine) and breaks open on schedule as an in-page layer; the Start button switches to full screen. Use "Enable notifications" in the sidebar to get a system notification when a break is due while the tab is in the background, and the pause item for 30 min / 1 h / 2 h / until tomorrow. Records stay in this browser's localStorage (per browser and device; clearing site data erases them). Start-at-login and the tray exist only in the Windows app.

```powershell
npm.cmd run build:web    # → web-dist\(相對路徑，可放在任何子路徑下 / relative paths, works under /breakfit/)
npm.cmd run test:web     # build + 在隱藏視窗裡跑一遍 → selftest-out\web\*.png
```

網頁版跑的是同一份 renderer 與 `src/main/app.js`,`src/web/` 只是 Electron API 的瀏覽器替身;推上 `main` 由 `.github/workflows/pages.yml` 自動部署。
The web build runs the same renderer pages and the same `src/main/app.js`; `src/web/` only stands in for the Electron APIs. Pushing to `main` deploys via `.github/workflows/pages.yml`.

## 資料位置 / Data

- `%APPDATA%\BreakFit\data.json`(寫入時先寫 `.tmp` 再改名)
- `selftest` / `fast` 用 `%TEMP%\breakfit-*` 暫存資料夾，不會碰正式資料。

## 文件 / Docs

- `SPEC.md` 行為規格、`DESIGN.md` 設計規範、`plan.json` 菜單
- `docs/hig/APPLE-STYLE.md`、`docs/hig/getdesign-apple.md`(MIT,取自 VoltAgent/awesome-design-md)設計參考(Apple HIG 原文未收錄，請見 <https://developer.apple.com/design/human-interface-guidelines>)
