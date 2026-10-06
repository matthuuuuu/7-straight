# 7 Straight — notes for Claude

(Earlier working title: "Lucky 7". Internal names such as the `lucky7.`
storage keys and the `lucky` field for the seven-numbers bonus keep the old
name on purpose, so saved games and settings survive.)

The owner does not code. Explain changes in plain language, keep them small,
run `npm test` and check the change in the browser before calling it done.

## Architecture

- `src/engine/` is the single source of truth for the rules (a pure state
  machine; mutates the state object passed in). It must follow the official
  Flip 7 rulebook exactly; the documented edge-case choices are listed in
  README.md ("Rule details worth knowing"). Don't change rules without the
  owner asking.
- Online play is server-authoritative: `server/rooms.js` (called by
  `api/room.js` on Vercel, and by the Vite dev middleware in `vite.config.js`
  locally). Rooms are saved with compare-and-set on a `rev` counter
  (`server/store.js`: Upstash Redis REST in production, in-memory locally).
  Clients poll about once a second; bots and away-player autopilot move lazily
  inside requests (`src/engine/autoplay.js`). Never send `deck` or `rng` to
  clients.
- Every state change emits events (`emit()` in engine.js). The UI replays new
  events step by step (`src/game/display.js` + `useReplay.js`), then snaps to
  the real state. `tests/display.test.js` proves replay == real state; when
  adding an event type, handle it in `applyEvent`, `eventDelay` and
  `eventMessage`.
- "This device" games run the same engine in the browser (`src/net/local.js`).

## Conventions

- Plain JavaScript (ESM), React 19, no CSS framework. All styling in
  `src/styles/app.css`; colors are CSS variables with three themes
  (cream / aqua / night) at the top.
- Fonts: Overpass (headings; open-source Highway Gothic), Roboto and Roboto
  Condensed, bundled via @fontsource.
- Card art and all text are original. Don't copy text or art from the
  rulebook.
- Files contain UTF-8 characters (’ … ·). Edit them with the Edit tool, not
  PowerShell Get-Content/Set-Content, which corrupts them.

## Commands

- `npm run dev`: local server at http://localhost:5173 (also on the LAN)
- `npm test`: rules, server, replay and fuzz tests
- `npm run build`: production build into `dist/`
