---
name: run-desktop
description: Build, run, and drive the HanCode Electron desktop app. Use when asked to start the desktop app, take a screenshot of it, build it, or interact with its UI.
---

HanCode is an Electron desktop app (electron-vite + React renderer, sidecar agent process). Drive it with Playwright `_electron` from the repo root.

## Build

```bash
bun run desktop:build   # compiles out/main, out/preload, out/renderer
```

## Launch & drive (agent path)

One-shot interactive smoke test covering side panel collapse, settings modal, vision fields, and profiles:

```bash
env -u ELECTRON_RUN_AS_NODE node .claude/skills/run-desktop/smoke.mjs
```

Screenshots land in `%TEMP%\hancode-shots\` (override: `SCREENSHOT_DIR`).

For ad-hoc poking, use the REPL driver:

```bash
env -u ELECTRON_RUN_AS_NODE node .claude/skills/run-desktop/driver.mjs
```

Commands: `launch`, `ss [name]`, `click <css>`, `click-text <text>`, `set-value <css>||<value>`, `type`, `press`, `wait <css>`, `eval <js>`, `text [css]`, `windows`, `quit`.

## Gotchas

- **`ELECTRON_RUN_AS_NODE=1` in the agent session env makes every launch fail** with "Process failed to launch!" or `electron.app` being `undefined` — Electron runs as plain Node and never opens a window. Always launch with `env -u ELECTRON_RUN_AS_NODE`.
- Launch with args `['.']` (project root) so Electron reads `package.json` `main` (`out/main/index.cjs`). Passing the cjs path directly also works but is less faithful to production.
- `page.waitForSelector('.app-shell')` is the app-ready signal (React mounted).
- Click via `page.evaluate(el => el.click())`, not `locator.click()` — DOM clicks bypass coordinate math.
- React-controlled inputs need the native value setter + `input` event (see `set-value` in the driver); `fill()` alone does not trigger React state updates.
- Dev mode: `bun run desktop:dev` (human path, opens a real window).

## Troubleshooting

- Launch timeout → did `bun run desktop:build` run? `out/main/index.cjs` must exist.
- Window opens but blank → check the devtools console; renderer errors surface there.
