# 7 Straight

A push-your-luck card game for 1–8 players that follows the rules of *Flip 7*
exactly. Everyone plays on their own phone (or pass one device around), on
mobile or desktop.

A fan-made, non-commercial tribute to *Flip 7* by Eric Olsen (The Op), made for
a class project. The card art, name and text are original; only the rules are
the same.

## Play it on your computer

You need [Node.js](https://nodejs.org) (version 20 or newer). In this folder:

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5173>. To test online rooms, open a second browser
window (or a private window) and join with the room code. Phones on the **same
Wi-Fi** can join too: use the "Network" address that `npm run dev` prints
(something like `http://192.168.1.49:5173`).

To put it on the internet, see [DEPLOY.md](DEPLOY.md).

## How it works

| Part | What it does |
| --- | --- |
| `src/engine/` | **The rules.** The deck, dealing, Hit/Stay, Freeze, Flip Three, Second Chance, scoring and winning. Pure logic, shared by the server and the browser. |
| `src/engine/bot.js` | Computer players. They count cards using only what's face up. |
| `server/rooms.js` | Online rooms: codes, joining, whose turn it is, autopilot for people who wander off. The server keeps the only copy of the deck, so nobody can peek. |
| `api/room.js` | The tiny Vercel function that runs `server/rooms.js`. |
| `src/net/` | How the browser talks to the server (online) or runs the game itself (this device). |
| `src/game/display.js` | Replays each move one step at a time so everyone sees the cards flip in order. |
| `src/ui/` | The screens: home, lobby, game table, rules. |
| `src/styles/app.css` | All the colors, fonts and layout. The three themes are at the top. |
| `src/config.js` | The game's name, tagline, player pictures and bot names. |
| `public/` | App icon, install manifest and the offline helper. |
| `tests/` | Automatic checks for the rules, the server and the animations. |

## Handy changes

- **Rename the game:** `GAME_NAME` in `src/config.js` (and the `<title>` in `index.html`, and `public/manifest.webmanifest`).
- **Colors:** the variables at the top of `src/styles/app.css`.
- **Card colors:** the `SUIT` list in `src/ui/Card.jsx`.
- **Player pictures / bot names:** `src/config.js`.
- **How long bots think, and when autopilot kicks in:** `src/engine/autoplay.js`.

## Checks

```bash
npm test
```

Runs hundreds of simulated games to make sure the rules are followed, no card
is ever lost or duplicated, online rooms behave, and the animations always
match the real game.

## Rule details worth knowing

The rulebook doesn't spell out a few edge cases. This is what the game does:

- If someone is knocked out of the round during the deal (Freeze, or busting
  on a Flip Three) before their turn to be dealt, they don't get dealt a card.
- An action card with only one legal target (for example, you're the only
  player left in the round) is played automatically.
- A tie for the highest score at the end is a shared win.
- In online games, a player whose phone has been asleep for 30 seconds on
  their turn is auto-played (safely) until they come back.

## Fonts

The rulebook uses Highway Gothic for headings and Roboto for text. Highway
Gothic isn't licensed for websites, so headings use **Overpass**, the free
open-source typeface based on it. Text uses **Roboto** and **Roboto Condensed**.
All are bundled with the app, so nothing loads from Google.
