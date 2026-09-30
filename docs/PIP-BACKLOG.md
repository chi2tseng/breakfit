# PIP (畫中畫) — parked, spec collected 2026-09-30

User: 「休息的時候讓我能夠選擇全螢幕以及 PIP 畫中畫模式」, then 「先不要管 pip 這個之後再用」. **Not implemented.** The first agent was stopped before it edited anything. Requirements the user has given so far:

- Default break display = **PIP**, full screen = the option (PIP listed first everywhere). The last break of the day is PIP too (the user declined a forced full screen).
- **Mouse-only; the keyboard stays with the app underneath.** The PIP window is non-focusable (`focusable: false` / WS_EX_NOACTIVATE, `setFocusable(false)` when switching to PIP, `true` when going back); the overlay ignores Space/Enter/Esc/P in PIP and hides the keycap hints; clicking its buttons must not change the foreground window.
- **Free drag + free resize**: drag from anywhere that is not a control, inset no-drag border so the native resize handles stay reachable, visible bottom-right grip, no Aero Snap (`maximizable: false`, keep `fullscreenable` true), no aspect lock, remembered position/size. Wide → compact two-column, narrow/tall → stacked; font size scales with the window.
- **Stays on top while a video (YouTube in a browser) plays underneath**: alwaysOnTop 'screen-saver' + `moveTop()` every ~1.5–2 s without focus; never pauses or disturbs the video; cannot cover exclusive-fullscreen games.
- The full workout (完整訓練) must support PIP too, and its chooser dialog gets a display row (畫中畫 | 全螢幕).
- Entry points: settings row, an overlay toggle button, tray radio submenu; live switching keeps the break's state; no cover windows on other displays while in PIP.
- Web: Document Picture-in-Picture later, separate task.

Builds on the windowed mode (`breakView: 'full' | 'window'`): add `'pip'` as a third view.
