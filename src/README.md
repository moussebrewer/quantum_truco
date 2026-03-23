# Quantum Truco ⊗

> *"No sabés qué carta tenés hasta que la jugás."*

Quantum Truco is a browser-based implementation of the classic Argentine card game Truco — with one twist: the cards are quantum.

---

## The concept

In standard Truco, each player holds three cards and the game is about bluffing, reading your opponent, and knowing when to push your bet. The cards are fixed from the moment they are dealt.

In Quantum Truco, each card in your hand exists in **superposition**. Instead of holding, say, the 1 of espadas, you hold a card that is *either* the 1 of espadas *or* the 3 of copas — you don't know which. Neither does your opponent.

### How it works

The deck is shuffled and then paired up: every two cards form an **entangled pair**. Each player receives three quantum cards, where each card shows both possibilities but has not yet collapsed into one. The moment a card is **played to the table**, it collapses — a hidden measurement is resolved and the card becomes one of its two options, definitively.

The entanglement matters: if two cards share the same pair, measuring one determines the other. If your card collapses to the 1 of espadas, you know your opponent's entangled partner is the 3 of copas, and vice versa.

This mechanic is built on a real probabilistic engine (`QuantumDeck` in `game.ts`). Every hand simultaneously enumerates all possible worlds — all combinations of how the superpositions could collapse — to compute expected envido scores, flor probabilities, and truco power distributions. The UI shows you both faces of each card so you can reason about the possibilities before committing.

### What changes strategically

- **Betting is probabilistic by design.** When you sing Truco, you may not know if you have a 14-power card or a 4-power card. The bet itself becomes a statement about your expected hand, not your actual hand.
- **Envido is played on distributions.** Your envido score is a range, not a number. The game computes the expected value and shows it to you, but the reveal at the end collapses everything.
- **Bluffing has a new dimension.** You can sing confidently on a hand that *might* be great. Your opponent faces the same uncertainty about their own cards.
- **Information leaks on play.** Once cards collapse, entangled partners are revealed. Late in a hand, the board state narrows down the remaining possibilities significantly.

The standard Truco rules apply throughout: Truco, ReTruco, ValeCuatro, Envido, Real Envido, Falta Envido, Flor, Contraflor, and Contraflor al Resto are all implemented. The quantum layer sits underneath without changing the social and psychological structure of the game — it just makes the epistemics genuinely uncertain for everyone at the table.

---

## Game modes

| Mode | Description |
|---|---|
| 👥 Humanos | Local hot-seat, 2 or 4 players sharing a device |
| 🌐 Online 1v1 | Real-time online match via Cloudflare Durable Objects |
| 🃏 El Pibe | AI — medium difficulty |
| 🎩 Citadino | AI — hard |
| 🧉 Gaucho Digital | AI — expert (tracks bluff history, adapts) |
| 🃑 El Duende | AI — legend (full Bayesian opponent model, Monte Carlo lookahead) |

The AI difficulties are meaningfully different. El Duende builds a running model of your bluff rates for both truco and envido, estimates opponent hand distributions using Bayesian inference, and uses Monte Carlo simulation to evaluate card plays across all three bazas.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | TypeScript + Vite |
| Online backend | Cloudflare Workers + Durable Objects |
| Realtime | WebSockets |
| Session persistence | `localStorage` (reconnection tokens) |

---

## Installation

### Prerequisites

- **Node.js** ≥ 18 and **npm**
- **Wrangler CLI** — only needed for the online backend
- A **Cloudflare account** — free tier works fine

### 1. Clone and install dependencies

```bash
git clone <your-repo-url>
cd quantum-truco
npm install
```

### 2. Install Wrangler (online backend only)

```bash
npm install -g wrangler
wrangler login
```

`wrangler login` opens a browser to authenticate with your Cloudflare account and saves credentials locally. Skip this entirely if you only want local or AI play.

---

## Running locally

### Local and AI modes

No backend needed. The entire game engine runs in the browser.

```bash
npm run dev
```

Open `http://localhost:5173`. All modes except Online 1v1 work immediately.

### Online mode (local development)

The online backend is a Cloudflare Worker with a Durable Object that persists room state and relays moves over WebSockets. To run it locally you need a `wrangler.toml` in the project root:

```toml
name = "quantum-truco-online"
main = "src/room-do.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "ROOM_DO"
class_name = "RoomDurableObject"

[[migrations]]
tag = "v1"
new_classes = ["RoomDurableObject"]
```

Start the Worker:

```bash
wrangler dev src/room-do.ts --local
```

This runs on `http://localhost:8787`. Durable Object state is persisted locally under `.wrangler/state/` so rooms survive restarts during a session.

Then point the frontend at your local Worker. In `online.ts`, change `onlineBase()`:

```ts
function onlineBase() {
  return 'http://localhost:8787'; // local dev
}
```

Start the frontend in a second terminal:

```bash
npm run dev
```

Open two browser tabs, select **Online 1v1**, create a room in one tab, copy the 6-character code, and join from the other.

---

## Deployment

### Deploy the Worker

```bash
wrangler deploy src/room-do.ts
```

Wrangler prints the deployed URL — something like `https://quantum-truco-online.<your-subdomain>.workers.dev`. Update `onlineBase()` in `online.ts` to return that URL, then build the frontend.

### Build and deploy the frontend

```bash
npm run build
```

The output goes to `dist/`. Deploy it to any static host. For Cloudflare Pages:

```bash
wrangler pages deploy dist --project-name quantum-truco
```

---

## Quick reference

| Task | Command |
|---|---|
| Run frontend (local / AI modes) | `npm run dev` |
| Run Worker locally (online mode) | `wrangler dev src/room-do.ts --local` |
| Deploy Worker | `wrangler deploy src/room-do.ts` |
| Build frontend | `npm run build` |
| Deploy frontend to Pages | `wrangler pages deploy dist --project-name quantum-truco` |

---

## Notes

- Rooms are not garbage-collected automatically. For production, consider adding a TTL alarm to the Durable Object.
- Deleting `.wrangler/state/` wipes all local room state — expected and safe in development.
- Reconnection is automatic: clients store a session token in `localStorage` and re-join transparently on page reload.
- The online mode uses `filterStateForSeat` in `room-do.ts` to hide opponent hand data server-side before broadcasting. You only ever receive your own quantum cards with both options visible; opponent cards arrive hidden.
