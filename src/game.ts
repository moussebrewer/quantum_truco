// @ts-nocheck
// Refactor of the original single-file Quantum Truco source.
// This file owns game state, rules, flow, and gameplay mutations.

import { flying, arenaKey, flyGhost, makeCardBack, prefersReducedMotion, COLLAPSE_DUR, COLLAPSE_STAGGER } from './anim';

export const setupCfg = { tableSize:2, target:15, conFlor:false, mode:'human' };

// Asiento de quien está mirando la pantalla (para orientar animaciones).
function viewerSeatForAnim() {
  if (G.onlineMode && Number.isInteger(G.viewerSeat)) return G.viewerSeat;
  return (G.aiSeat !== null && G.aiSeat !== undefined) ? 0 : G.activeSeat;
}
export let florOn = false;

const runtime = {
  renderGame: null,
  renderHand: null,
  renderArena: null,
  buildCardSVG: null,
  buildEntangled: null,
  showScreen: null,
  showPassOverlay: null,
  hidePassOverlay: null,
  showWinScreen: null,
  isEnvidoOverlayOpen: null,
  setEnvidoOverlayOnClose: null,
  showTrucoCallToast: null,
  showTrucoToast: null,
  showEnvidoAnnouncement: null,
  showModal: null,
  closeModal: null,
  log: null,
  aiNewToken: null,
  aiValidToken: null,
  aiSchedule: null,
  aiThink: null,
  aiTakeTurn: null,
  aiResume: null,
  aiHandlePendingChant: null,
  aiRecordHand: null,
  resetAIState: null,
};

let headlessMode = false;

export function setHeadlessMode(value) {
  headlessMode = !!value;
}

export function isHeadlessMode() {
  return headlessMode;
}

export function setGameState(state) {
  G = state;
  return G;
}

export function getGameState() {
  return G;
}

export function installOnlineState(snapshot) {
  G = snapshot;
  return G;
}

export function renderCurrentGame() {
  if (runtime.renderGame) runtime.renderGame();
}

export function showScreenById(id) {
  if (runtime.showScreen) runtime.showScreen(id);
}

export function showWinState(title, subtitle, score) {
  if (runtime.showWinScreen) runtime.showWinScreen(title, subtitle, score);
}

export function configureGameRuntime(hooks) {
  Object.assign(runtime, hooks);
}

export function uiLog(msg, cls = '') {
  if (runtime.log) runtime.log(msg, cls);
}

function uiRenderHand() {
  if (runtime.renderHand) runtime.renderHand();
}

function uiRenderArena() {
  if (runtime.renderArena) runtime.renderArena();
}

function uiBuildCardSVG(rank, suit, id) {
  return runtime.buildCardSVG ? runtime.buildCardSVG(rank, suit, id) : '';
}

function uiBuildEntangled(numA, paloA, numB, paloB, flip) {
  return runtime.buildEntangled ? runtime.buildEntangled(numA, paloA, numB, paloB, flip) : '';
}

export const SUITS = ["espada","basto","oro","copa"];
export const RANKS = [1,2,3,4,5,6,7,10,11,12];

function trucoDeck40() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({suit:s, rank:r});
  return deck;
}

export function envidoValueSingle(c) { return c.rank <= 7 ? c.rank : 0; }

export function envidoScore(cards) {
  const bySuit = {};
  for (const s of SUITS) bySuit[s] = [];
  for (const c of cards) bySuit[c.suit].push(envidoValueSingle(c));
  let best = 0;
  for (const vals of Object.values(bySuit)) {
    if (vals.length >= 2) {
      vals.sort((a,b)=>b-a);
      best = Math.max(best, 20 + vals[0] + vals[1]);
    }
  }
  if (best === 0) best = Math.max(...cards.map(envidoValueSingle));
  return best;
}

export function hasFlor(cards) {
  const counts = {};
  for (const s of SUITS) counts[s] = 0;
  for (const c of cards) counts[c.suit]++;
  return Math.max(...Object.values(counts)) === 3;
}

export function florScore(cards) {
  for (const s of SUITS) {
    const same = cards.filter(c=>c.suit===s);
    if (same.length === 3) return 20 + same.reduce((acc,c)=>acc+envidoValueSingle(c),0);
  }
  return -1;
}

export function trucoPower(c) {
  if (c.rank===1 && c.suit==="espada") return 14;
  if (c.rank===1 && c.suit==="basto")  return 13;
  if (c.rank===7 && c.suit==="espada") return 12;
  if (c.rank===7 && c.suit==="oro")    return 11;
  if (c.rank===3) return 10;
  if (c.rank===2) return 9;
  if (c.rank===1 && (c.suit==="oro"||c.suit==="copa")) return 8;
  if (c.rank===12) return 7;
  if (c.rank===11) return 6;
  if (c.rank===10) return 5;
  if (c.rank===7 && (c.suit==="basto"||c.suit==="copa")) return 4;
  if (c.rank===6) return 3;
  if (c.rank===5) return 2;
  if (c.rank===4) return 1;
  throw new Error("Carta inesperada: "+JSON.stringify(c));
}

// ─────────────────────────────────────────────────────────────
// Motor cuántico
// ─────────────────────────────────────────────────────────────

class QuantumDeck {
  constructor(seed) {
    this._rng = seededRng(seed);
    const base = trucoDeck40();
    shuffleArr(base, this._rng);
    this.pairs = {};   // pairId -> [cardA, cardB]
    this.pairBit = {}; // pairId -> null | 0 | 1
    this.cards = [];   // QuantumCard objects

    let pid = 0;
    for (let i = 0; i < base.length; i += 2) {
      const a = base[i], b = base[i+1];
      this.pairs[pid] = [a, b];
      this.pairBit[pid] = null;
      this.cards.push({pairId:pid, idxInPair:0, options:[a,b], collapsedTo:null});
      this.cards.push({pairId:pid, idxInPair:1, options:[a,b], collapsedTo:null});
      pid++;
    }
    shuffleArr(this.cards, this._rng);
  }

  deal(n) {
    if (this.cards.length < n) throw new Error("Se acabó el mazo");
    return this.cards.splice(0, n);
  }

  measurePair(pairId) {
    if (this.pairBit[pairId] === null) {
      this.pairBit[pairId] = Math.floor(this._rng() * 2);
    }
    return this.pairBit[pairId];
  }

  collapse(qc) {
    if (qc.collapsedTo !== null) return qc.collapsedTo;
    const [a, b] = this.pairs[qc.pairId];
    const s = this.measurePair(qc.pairId);
    qc.collapsedTo = ((qc.idxInPair===0&&s===0)||(qc.idxInPair===1&&s===1)) ? a : b;
    return qc.collapsedTo;
  }

  collapseAll(cards) { return cards.map(q=>this.collapse(q)); }
}

function collapseHypothetical(qc, sBit) {
  const [a,b] = qc.options;
  return ((qc.idxInPair===0&&sBit===0)||(qc.idxInPair===1&&sBit===1)) ? a : b;
}

export function enumerateWorlds(hand) {
  const pairIds = [...new Set(hand.map(q=>q.pairId))].sort();
  const total = 1 << pairIds.length;
  const worlds = [];
  for (let mask = 0; mask < total; mask++) {
    const bits = {};
    pairIds.forEach((pid,i) => { bits[pid] = (mask>>i)&1; });
    worlds.push(hand.map(q=>collapseHypothetical(q, bits[q.pairId])));
  }
  return worlds;
}

export function envidoMetric(hand) {
  const worlds = enumerateWorlds(hand);
  const scores = worlds.map(w=>envidoScore(w));
  const mu = scores.reduce((a,b)=>a+b,0)/scores.length;
  const p28 = scores.filter(x=>x>=28).length/scores.length;
  return {mu, p28, min:Math.min(...scores), max:Math.max(...scores)};
}

export function florMetric(hand) {
  const worlds = enumerateWorlds(hand);
  const florWorlds = worlds.filter(w=>hasFlor(w));
  const pFlor = florWorlds.length/worlds.length;
  if (florWorlds.length===0) return {mu:0, pFlor:0, min:-1, max:-1};
  const vals = florWorlds.map(w=>florScore(w));
  return {mu:vals.reduce((a,b)=>a+b,0)/vals.length, pFlor, min:Math.min(...vals), max:Math.max(...vals)};
}

// ─────────────────────────────────────────────────────────────
// Reglas de equipo y orden
// ─────────────────────────────────────────────────────────────

export function teamOf(seat) { return seat % 2; }

export function circularOrder(activeSeats, startSeat, tableSize) {
  const active = new Set(activeSeats);
  const out = [];
  for (let i=0; i<tableSize; i++) {
    const s = (startSeat+i) % tableSize;
    if (active.has(s)) out.push(s);
  }
  return out;
}

export const TRUCO_LEVELS = [
  {name:"Base",    pts:1, ptsRej:0},
  {name:"Truco",   pts:2, ptsRej:1},
  {name:"Retruco", pts:3, ptsRej:2},
  {name:"Vale 4",  pts:4, ptsRej:3},
];

const ENVIDO_CALL_PTS = {envido:2, "real envido":3, "falta envido":null};

function trickWinner(collapsedBySeat, playOrder) {
  let bestPower = -1;
  for (const seat of playOrder) {
    const card = collapsedBySeat[seat];
    if (!card) continue; // safety: skip seats that didn't play
    const p = trucoPower(card);
    if (p > bestPower) bestPower = p;
  }
  const bestSeats = playOrder.filter(s => collapsedBySeat[s] && trucoPower(collapsedBySeat[s])===bestPower);
  const bestTeams = new Set(bestSeats.map(teamOf));
  if (bestTeams.size > 1) return {team:-1, seat:null};
  if (!bestSeats.length) return {team:-1, seat:null};
  return {team:teamOf(bestSeats[0]), seat:bestSeats[0]};
}

function resolveHandTruco(trickWinners, manoTeam) {
  const w0 = trickWinners.filter(w=>w===0).length;
  const w1 = trickWinners.filter(w=>w===1).length;
  if (w0 >= 2) return 0;
  if (w1 >= 2) return 1;
  const non = trickWinners.filter(w=>w===0||w===1);
  if (non.length===1) return non[0];
  if (trickWinners.every(w=>w===-1)) return manoTeam;
  if (non.length) return non[0];
  return manoTeam;
}

// Falta envido: lo que le falta al equipo que va ganando para llegar al
// objetivo. Si se quiere, reemplaza a todo lo cantado antes (no se suma).
export function faltaEnvidoPoints(target, scores) {
  return Math.max(target - Math.max(scores[0], scores[1]), 1);
}

export function envidoTotalIfAccepted(calls, callerTeam, target, scores) {
  if (calls.includes("falta envido")) return faltaEnvidoPoints(target, scores);
  let total = 0;
  for (const call of calls) total += ENVIDO_CALL_PTS[call] || 0;
  return total;
}

// No querido: vale lo que se había cantado antes del último canto (mínimo 1).
export function envidoPointsIfRejected(calls, callerTeam, target, scores) {
  if (!calls.length) return 0;
  const prev = calls.slice(0,-1);
  if (!prev.length) return 1;
  let total = 0;
  for (const call of prev) total += ENVIDO_CALL_PTS[call] || 0;
  return Math.max(total, 1);
}

// Qué se puede cantar encima. Acepta la lista completa de cantos (o solo el
// último, por compatibilidad). "Envido" se puede cantar dos veces como mucho.
export function envidoCanRaise(callsOrLast) {
  const calls = Array.isArray(callsOrLast) ? callsOrLast : [callsOrLast];
  const last = calls[calls.length - 1];
  if (last==="falta envido") return [];
  if (last==="real envido") return ["falta envido"];
  if (last==="envido") {
    const envidos = calls.filter(c => c === "envido").length;
    return envidos < 2 ? ["envido","real envido","falta envido"] : ["real envido","falta envido"];
  }
  return [];
}

function settleEnvido(finalCards, activeSeats, players, scores, manoTeam, pts) {
  const teamScores = {0:0, 1:0};
  for (const seat of activeSeats) {
    const e = envidoScore(finalCards[seat]);
    teamScores[teamOf(seat)] = Math.max(teamScores[teamOf(seat)], e);
  }
  let winner;
  if (teamScores[0] > teamScores[1]) winner = 0;
  else if (teamScores[1] > teamScores[0]) winner = 1;
  else winner = manoTeam;
  scores[winner] += pts;
  return {winner, teamScores};
}

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

function seededRng(seed) {
  if (seed == null) seed = Date.now();
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function shuffleArr(arr, rng) {
  for (let i=arr.length-1; i>0; i--) {
    const j = Math.floor(rng() * (i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function qcLabel(qc) {
  const [a,b] = qc.options;
  return `(${rankName(a.rank)} de ${a.suit} | ${rankName(b.rank)} de ${b.suit})`;
}

function rankName(r) {
  if (r===10) return "Sota";
  if (r===11) return "Caballo";
  if (r===12) return "Rey";
  return String(r);
}

export function cardLabel(c) { return `${rankName(c.rank)} de ${c.suit}`; }

function sameCard(a, b) {
  return !!a && !!b && a.rank === b.rank && a.suit === b.suit;
}

function findCollapsedCardForPair(pairId, excludeQc = null) {
  if (!G) return null;
  for (const player of G.players) {
    for (const otherQc of [...player.hand, ...player.played]) {
      if (otherQc !== excludeQc && otherQc.pairId === pairId && otherQc.collapsedTo) {
        return otherQc.collapsedTo;
      }
    }
  }
  for (const otherQc of Object.values(G.playsThisTrick || {})) {
    if (otherQc && otherQc !== excludeQc && otherQc.pairId === pairId && otherQc.collapsedTo) {
      return otherQc.collapsedTo;
    }
  }
  return null;
}

export function getVisibleCard(qc) {
  if (!qc) return null;
  if (qc.collapsedTo) return qc.collapsedTo;
  const partnerCollapsed = findCollapsedCardForPair(qc.pairId, qc);
  if (!partnerCollapsed) return null;
  const [a, b] = qc.options;
  return sameCard(partnerCollapsed, a) ? b : a;
}

// ─────────────────────────────────────────────────────────────
// Estado global del juego
// ─────────────────────────────────────────────────────────────

export let G = null; // Game state object

function createBaseState(cfg) {
  const state = newGame(cfg);
  state.leaderSeat = state.manoSeat;
  state.playOrder = circularOrder(Array.from({length: state.tableSize}, (_, i) => i), state.leaderSeat, state.tableSize);
  state.activeSeat = state.playOrder[0];
  state.pendingChant = null;
  state.aiMode = 'human';
  state.aiSeat = null;
  state.matchEnded = false;
  state.winnerTeam = null;
  state.winnerName = null;
  return state;
}

export function createHeadlessGame(cfg) {
  G = createBaseState(cfg);
  return G;
}

export function rehydrateGameState(state) {
  if (!state) return state;
  if (state.deck) {
    if (typeof state.deck._rng !== 'function') state.deck._rng = seededRng(null);
    if (Object.getPrototypeOf(state.deck) !== QuantumDeck.prototype) {
      Object.setPrototypeOf(state.deck, QuantumDeck.prototype);
    }
  }
  return state;
}

export function serializeGameState(state) {
  if (!state) return state;
  const safe = {
    ...state,
    deck: state.deck ? { ...state.deck, _rng: null } : state.deck,
  };
  return structuredClone(safe);
}

export function cloneGameState(state) {
  return rehydrateGameState(serializeGameState(state));
}

function newGame(cfg) {
  const tableSize = cfg.tableSize;
  const target = cfg.target;
  const conFlor = cfg.conFlor;
  const deck = new QuantumDeck(null);

  const players = [];
  for (let seat=0; seat<tableSize; seat++) {
    const hand = deck.deal(3);
    players.push({
      name: tableSize===2 ? (seat===0 ? 'Jugador 1' : 'Jugador 2')
                          : (seat===0 ? 'J1 (Eq.A)' : seat===1 ? 'J2 (Eq.B)' : seat===2 ? 'J3 (Eq.A)' : 'J4 (Eq.B)'),
      seat,
      team: teamOf(seat),
      hand: hand.slice(),  // quantum cards
      played: [],          // played quantum cards
      metric: envidoMetric(hand),
      florMetric: florMetric(hand),
    });
  }

  return {
    tableSize,
    target,
    conFlor,
    deck,
    players,
    scores: [0,0],
    // El primer mano se sortea; después rota en cada mano.
    manoSeat: Math.floor(Math.random() * tableSize),
    handNum: 1,
    handChant: [0, 0],
    handSettled: false,
    // current hand state
    bet: {level:0, lastRaiserTeam:null},
    chant: {
      flor: {sungBySeat:{}, declarations:{}, contraflorCalled:false, contraflorCallerTeam:null, contraflorAlResto:false, contraflorAccepted:false, resolved:false},
      envido: {calls:[], accepted:false, resolved:false, callerTeam:null, callerSeat:null, responderSeat:null, declarations:{}, pendingRaiser:null},
      florBlockedEnvido: false,
    },
    trickWinners: [],
    trickHistory: [],
    leaderSeat: 0,
    trickIdx: 0,
    activeSeat: 0, // whose turn it is
    playOrder: [],  // order of play this trick
    playOrderIdx: 0,
    playsThisTrick: {}, // seat -> qc
    phase: "chant", // chant | play | baza_end | hand_end
    handScore: [0,0],
    matchEnded: false,
    winnerTeam: null,
    winnerName: null,
  };
}



// ═══════════════════════════════════════════════
// UI CONTROLLER
// ═══════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// UI — Controlador de pantallas y flujo del juego v2
// ══════════════════════════════════════════════════════════════

export function toggleFlor() {
  florOn = !florOn;
  setupCfg.conFlor = florOn;
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btn-flor');
  if (!btn) return;
  btn.textContent = florOn ? 'SÍ' : 'NO';
  btn.classList.toggle('on', florOn);
}

export function startGame() {
  if (setupCfg.mode === 'online_1v1') return;
  G = createBaseState(setupCfg);
  G.aiMode = setupCfg.mode;
  G.aiSeat = (setupCfg.mode !== 'human') ? 1 : null;
  if (G.aiSeat !== null) {
    G.players[G.aiSeat].name = setupCfg.mode === "ai_legend" ? "🃑 El Duende" : setupCfg.mode === "ai_expert" ? "🧉 Gaucho" : setupCfg.mode === "ai_hard" ? "🎩 Citadino" : "🃏 El Pibe";
  }
  animateDeal(() => passTo(G.activeSeat));
}

export function restartGame() { G = null; if (runtime.resetAIState) runtime.resetAIState(); if (runtime.showScreen) runtime.showScreen("screen-setup"); }


export function allSeats() { return Array.from({length: G.tableSize}, (_, i) => i); }

// ── pass-phone flow ──────────────────────────────────────────

function passTo(seat) {
  G.activeSeat = seat;
  // AI turn: skip overlay, render and schedule immediately
  if (G.aiSeat !== null && seat === G.aiSeat) {
    if (runtime.showScreen) runtime.showScreen('screen-game');
    if (runtime.renderGame) runtime.renderGame();
    if (runtime.aiSchedule && runtime.aiTakeTurn) runtime.aiSchedule(() => runtime.aiTakeTurn(), runtime.aiThink ? runtime.aiThink() : 0);
    return;
  }
  // AI mode: human turn — also skip pass overlay, just render directly
  if (G.aiSeat !== null) {
    if (runtime.showScreen) runtime.showScreen('screen-game');
    if (runtime.renderGame) runtime.renderGame();
    return;
  }
  // Human vs human: show pass overlay
  const p = G.players[seat];
  if (runtime.showScreen) runtime.showScreen('screen-game');
  if (runtime.renderGame) runtime.renderGame();
  if (runtime.showPassOverlay) runtime.showPassOverlay(p.name);
}

export function dismissPass() {
  if (runtime.hidePassOverlay) runtime.hidePassOverlay();
  if (runtime.renderGame) runtime.renderGame();
}

export function showHand()   { dismissPass(); }
export function doneReveal() { dismissPass(); }

export function canTeamRaiseNow(bet, actTeam) {
  if (bet.level >= 3) return false;
  if (bet.level === 0) return true; // anyone can open
  return bet.lastRaiserTeam !== null && (1 - bet.lastRaiserTeam) === actTeam;
}

// ── Inline chant panel system ────────────────────────────────
// Instead of modals, all canto interactions happen in the chant panel.
// G.pendingChant stores what's "in the air" and who must respond.
// { type: 'truco'|'envido'|'flor', callerSeat, responderSeat, data:{} }

function setChantPending(type, callerSeat, responderSeat, data) {
  G.pendingChant = { type, callerSeat, responderSeat, data };
  G.activeSeat = responderSeat;
  if (runtime.renderGame) runtime.renderGame();
  // If AI is the responder, schedule a response
  if (G.aiSeat !== null && responderSeat === G.aiSeat) {
    if (runtime.aiSchedule && runtime.aiHandlePendingChant) runtime.aiSchedule(() => runtime.aiHandlePendingChant(), runtime.aiThink ? runtime.aiThink() : 0);
  }
}
export function clearChantPending() {
  G.pendingChant = null;
}

// Lo que un jugador dice en voz alta (cantos y respuestas). Queda en el
// estado (G.says) para que los clientes online también lo muestren.
function announce(seat, text) {
  G.sayN = (G.sayN || 0) + 1;
  G.says = [...(G.says || []), { n: G.sayN, seat, text }].slice(-8);
  if (!headlessMode && typeof document !== 'undefined' && runtime.showSay) {
    runtime.showSay(G.players[seat].name, text, teamOf(seat));
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const ACCEPT_PHRASES = ["¡Sí, canejo!", "¡Por supuesto, carajo!", "¡Quiero, che!", "¡Dale, vamos!", "¡Qué le voy a hacer, quiero!", "¡Venga ese truco!", "¡Jugado está, la puta madre!", "¡Acepto, so bruto!", "¡Quiero, y no me tiembla el pulso!", "¡Tá bien, quiero!", "¡Quiero, que no se diga!", "¡Y dale, quiero carajo!"];

// "El envido está primero": quien debe responder un truco en la primera
// baza puede cantar envido antes; el truco queda pendiente hasta resolverlo.
export function canEnvidoFirst(state = G) {
  const pc = state?.pendingChant;
  const env = state?.chant?.envido;
  // Solo ante el truco inicial (no ante un retruco o vale cuatro).
  return !!pc && pc.type === 'truco' && pc.data?.level === 1 && state.trickIdx === 0
    && !!env && !env.resolved && env.calls.length === 0
    && !state.chant.florBlockedEnvido;
}

// ¿Puede `seat` abrir el envido ahora? Solo en la primera baza, antes de
// jugar su carta, sin truco querido de por medio y sin flor cantada.
export function canOpenEnvido(state = G, seat = state?.activeSeat) {
  if (!state || state.pendingChant) return false;
  const env = state.chant.envido;
  if (state.phase !== 'chant' || state.trickIdx !== 0) return false;
  if (env.resolved || env.calls.length > 0 || state.chant.florBlockedEnvido) return false;
  if (state.bet.level > 0) return false;
  if (state.playsThisTrick?.[seat]) return false;
  if (state.tableSize > 2) {
    // De a cuatro canta el pie de cada equipo (los dos últimos en jugar).
    const order = circularOrder(Array.from({ length: state.tableSize }, (_, i) => i), state.manoSeat, state.tableSize);
    if (order.indexOf(seat) < state.tableSize - 2) return false;
  }
  return true;
}

function florChance(state, seat) {
  return state.players?.[seat]?.florMetric?.pFlor ?? 0;
}

// ¿Puede `seat` cantar flor ahora? Tiene que ser posible en su mano
// (alguna combinación de colapsos le da tres del mismo palo).
export function canSingFlor(state = G, seat = state?.activeSeat) {
  if (!state || !state.conFlor || state.pendingChant) return false;
  const flor = state.chant.flor, env = state.chant.envido;
  if (state.phase !== 'chant' || state.trickIdx !== 0) return false;
  if (flor.resolved || Object.keys(flor.sungBySeat).length > 0) return false;
  if (env.resolved || env.calls.length > 0) return false;
  if (state.playsThisTrick?.[seat]) return false;
  return florChance(state, seat) > 0;
}

// ¿Puede quien debe responder un envido contestar "flor"? La flor anula el envido.
export function canFlorOverEnvido(state = G) {
  const pc = state?.pendingChant;
  if (!state || !state.conFlor || !pc || pc.type !== 'envido') return false;
  const flor = state.chant.flor;
  if (state.trickIdx !== 0 || flor.resolved || Object.keys(flor.sungBySeat).length > 0) return false;
  return florChance(state, pc.responderSeat) > 0;
}

// Puntos de envido/flor (y el punto extra del mazo). Se llevan aparte de los
// del truco porque se cuentan primero al decidir quién llega al objetivo.
function addChantPoints(team, pts) {
  if (!G.handChant) G.handChant = [0, 0];
  G.handScore[team] += pts;
  G.handChant[team] += pts;
}

// Si los puntos de un canto no querido ya alcanzan para ganar, la partida
// termina ahí mismo, sin jugar el truco.
function endMatchIfChantWins() {
  const chant = G.handChant || [0, 0];
  if (G.scores[0] + chant[0] < G.target && G.scores[1] + chant[1] < G.target) return false;
  clearChantPending();
  if (G.bet) delete G.bet._pendingRaise;
  applyHandScore();
  return true;
}

export function deferPendingTrucoAndInitiateEnvido(call) {
  if (!canEnvidoFirst()) return;
  const { level, raiserTeam } = G.pendingChant.data;
  const responderSeat = G.activeSeat;
  G.bet._pendingRaise = { level, raiserTeam, callerSeat: G.pendingChant.callerSeat };
  clearChantPending();
  G.activeSeat = responderSeat;
  announce(responderSeat, '¡El envido está primero!');
  initiateEnvido(call);
}

// ── Truco ─────────────────────────────────────────────────────

export function singTruco() {
  const bet     = G.bet;
  const seat    = G.activeSeat;
  const actTeam = teamOf(seat);
  const nxt     = TRUCO_LEVELS[bet.level + 1];
  if (!nxt) return;
  const oppSeat = getOppSeat(seat);
  const trucoPhrasesMap = {
    "Truco":   ["¡Truco!", "¡Ahí va el truco!", "¡Trucoooo!"],
    "Retruco": ["¡Retruco!", "¡Mate y retruco, carajo!", "¡Mate y retruco!", "¡Retruco, che!"],
    "Vale 4":  ["¡Vale cuatro!", "¡Vale cuatro, jugado!", "¡Y vale cuatro!"],
  };
  const phrasesForCall = trucoPhrasesMap[nxt.name] || [`¡${nxt.name}!`];
  const callPhrase = phrasesForCall[Math.floor(Math.random() * phrasesForCall.length)];
  uiLog(`${G.players[seat].name}: ${callPhrase}`, 'important');
  announce(seat, callPhrase);
  setChantPending('truco', seat, oppSeat, { level: bet.level + 1, raiserTeam: actTeam });
}


export function respondTruco(accept) {
  const { callerSeat, data } = G.pendingChant;
  const { level, raiserTeam } = data;
  const nxt     = TRUCO_LEVELS[level];
  const curPts  = TRUCO_LEVELS[level - 1].pts;
  const responderSeat = G.activeSeat;
  clearChantPending();
  if (accept) {
    G.bet.level = level;
    G.bet.lastRaiserTeam = raiserTeam;
    uiLog(`${G.players[responderSeat].name} acepta ${nxt.name}. Vale ${nxt.pts} pts.`, 'important');
    announce(responderSeat, ACCEPT_PHRASES[Math.floor(Math.random() * ACCEPT_PHRASES.length)]);
    G.phase = 'play';
    // The turn goes back to whoever is next in playOrder from where we left off
    // playOrderIdx points to the CURRENT player who should play next
    G.activeSeat = G.playOrder[G.playOrderIdx];
    if (runtime.renderGame) runtime.renderGame();
    if (runtime.aiResume) runtime.aiResume();
  } else {
    G.handScore[raiserTeam] += curPts;
    uiLog(`${G.players[responderSeat].name} rechaza. Eq ${raiserTeam} cobra ${curPts} pts.`, 'points');
    announce(responderSeat, 'No quiero.');
    finalizeHand();
  }
}

export function raiseTruco() {
  // Responder raises instead of accepting/rejecting
  if (!G.pendingChant || G.pendingChant.type !== 'truco') return;
  const { callerSeat, data } = G.pendingChant;
  // The former responder is now the raiser
  const newRaiserSeat = G.activeSeat;
  const newRaiserTeam = teamOf(newRaiserSeat);
  const newLevel = data.level + 1;
  const nxt = TRUCO_LEVELS[newLevel];
  if (!nxt) return; // sobre el vale cuatro no hay nada más que cantar
  clearChantPending();
  uiLog(`${G.players[newRaiserSeat].name} sube a ${nxt.name}!`, 'important');
  announce(newRaiserSeat, `¡Quiero ${nxt.name.toLowerCase()}!`);
  setChantPending('truco', newRaiserSeat, callerSeat, { level: newLevel, raiserTeam: newRaiserTeam });
}

// ── Envido ────────────────────────────────────────────────────

export function initiateEnvido(call) {
  const env  = G.chant.envido;
  const seat = G.activeSeat;
  if (!ENVIDO_CALL_PTS.hasOwnProperty(call) || env.resolved || env.calls.length > 0) return;
  env.callerTeam = teamOf(seat);
  env.callerSeat = seat;
  env.calls.push(call);
  const oppSeat = getOppSeat(seat);
  uiLog(`${G.players[seat].name} canta ${call}.`, 'important');
  announce(seat, `¡${capitalize(call)}!`);
  setChantPending('envido', seat, oppSeat, { callerSeat: seat });
}

export function respondEnvido(action) {
  // action: 'accept' | 'reject' | call string (raise)
  const env      = G.chant.envido;
  // Save these BEFORE clearing pendingChant
  const prevCallerSeat = G.pendingChant.callerSeat;
  const curPts   = envidoTotalIfAccepted(env.calls, env.callerTeam, G.target, G.scores);
  const rejPts   = envidoPointsIfRejected(env.calls, env.callerTeam, G.target, G.scores);
  const respSeat = G.activeSeat;

  if (action === 'accept') {
    clearChantPending();
    env.accepted = true;
    env.resolved = true;
    uiLog(`${G.players[respSeat].name} acepta. Envido vale ${curPts} pts.`, 'important');
    announce(respSeat, '¡Quiero!');
    afterEnvidoResolved();
  } else if (action === 'reject') {
    clearChantPending();
    env.resolved = true;
    addChantPoints(env.callerTeam, rejPts);
    uiLog(`${G.players[respSeat].name} rechaza. Eq ${env.callerTeam} cobra ${rejPts} pts.`, 'points');
    announce(respSeat, 'No quiero.');
    if (endMatchIfChantWins()) return;
    afterEnvidoResolved();
  } else {
    // raise — action is the call string; roles flip: responder becomes new caller
    if (!envidoCanRaise(env.calls).includes(action)) return;
    env.calls.push(action);
    env.callerTeam = teamOf(respSeat);
    uiLog(`${G.players[respSeat].name} sube: ${action}.`, 'important');
    announce(respSeat, `¡${capitalize(action)}!`);
    clearChantPending();
    setChantPending('envido', respSeat, prevCallerSeat, { callerSeat: respSeat });
  }
}

// Después de resolver un envido o una flor: si había un truco esperando
// respuesta ("el envido está primero") vuelve a quedar pendiente; si no,
// sigue el juego.
function afterEnvidoResolved() {
  if (G.bet._pendingRaise) {
    const { level, raiserTeam, callerSeat } = G.bet._pendingRaise;
    delete G.bet._pendingRaise;
    const trucoRaiserSeat = Number.isInteger(callerSeat)
      ? callerSeat
      : (allSeats().find(s => teamOf(s) === raiserTeam) ?? 0);
    G.activeSeat = getOppSeat(trucoRaiserSeat);
    uiLog(`Ahora hay que responder el ${TRUCO_LEVELS[level].name}.`, 'important');
    setChantPending('truco', trucoRaiserSeat, G.activeSeat, { level, raiserTeam });
  } else {
    G.phase = 'play';
    G.activeSeat = G.playOrder[G.playOrderIdx];
    if (runtime.renderGame) runtime.renderGame();
    if (runtime.aiResume) runtime.aiResume();
  }
}

// ── Flor ─────────────────────────────────────────────────────

// Con cartas cuánticas nadie sabe si tiene flor: cantarla es apostar a que
// va a salir. Por eso al cantar no se cobra nada; todo se liquida al final
// de la mano en settleChants, con las cartas ya colapsadas.

export function singFlor() {
  const seat = G.activeSeat;
  if (!canSingFlor(G, seat)) return;
  startFlor(seat);
}

function startFlor(seat) {
  const flor = G.chant.flor;
  flor.sungBySeat[seat] = true;
  G.chant.florBlockedEnvido = true;
  uiLog(`${G.players[seat].name} canta Flor.`, 'important');
  announce(seat, '¡Flor!');
  // El rival responde siempre, pueda o no tener flor, así el canto no
  // revela nada sobre su mano.
  setChantPending('flor', seat, getOppSeat(seat), { stage: 'initial', firstSeat: seat });
}

// Responder "flor" a un envido: la flor anula el envido.
export function florOverEnvido() {
  if (!canFlorOverEnvido()) return;
  const seat = G.pendingChant.responderSeat;
  const env = G.chant.envido;
  env.calls = [];
  env.accepted = false;
  env.resolved = true;
  uiLog(`${G.players[seat].name} responde con flor: el envido no corre.`, 'important');
  clearChantPending();
  G.activeSeat = seat;
  startFlor(seat);
}

export function respondFlor(action) {
  if (!G.pendingChant || G.pendingChant.type !== 'flor') return;
  const { callerSeat, data } = G.pendingChant;
  const flor  = G.chant.flor;
  const seat  = G.activeSeat;
  const { stage, firstSeat } = data;

  if (stage === 'initial') {
    if (action !== 'yes' && action !== 'no') return;
    // Solo puede sumarse quien tiene alguna chance de flor.
    if (action === 'yes' && florChance(G, seat) > 0) {
      flor.sungBySeat[seat] = true;
      uiLog(`${G.players[seat].name} también canta Flor.`, 'important');
      announce(seat, '¡Yo también tengo flor!');
      clearChantPending();
      setChantPending('flor', callerSeat, seat, { stage: 'contraflor', firstSeat });
    } else {
      flor.resolved = true;
      uiLog(`${G.players[seat].name} no canta flor. Se liquida al final de la mano.`, 'important');
      announce(seat, 'Con flor me achico.');
      clearChantPending();
      afterEnvidoResolved();
    }
  } else if (stage === 'contraflor') {
    if (action === 'simple') {
      flor.resolved = true;
      uiLog('Flor contra flor. Se liquida al final de la mano.', 'important');
      clearChantPending();
      afterEnvidoResolved();
    } else if (action === 'contraflor' || action === 'alresto') {
      const alResto = action === 'alresto';
      flor.contraflorCalled = true;
      flor.contraflorAlResto = alResto;
      const lbl = alResto ? 'Contraflor al resto' : 'Contraflor';
      uiLog(`${G.players[seat].name} canta ${lbl}.`, 'important');
      announce(seat, `¡${lbl}!`);
      clearChantPending();
      setChantPending('flor', seat, firstSeat, { stage: 'resp_contraflor', firstSeat, alResto });
    }
  } else if (stage === 'resp_contraflor') {
    if (action === 'accept') {
      flor.contraflorAccepted = true;
      flor.resolved = true;
      const lbl = data.alResto ? 'Contraflor al resto' : 'Contraflor';
      uiLog(`${lbl} querida. Se liquida al final de la mano.`, 'important');
      announce(seat, '¡Quiero!');
      clearChantPending();
      afterEnvidoResolved();
    } else if (action === 'reject') {
      // No querida: cobra quien la cantó y el truco se sigue jugando.
      const pts = data.alResto ? 6 : 4;
      addChantPoints(teamOf(callerSeat), pts);
      flor.resolved = true;
      flor.settled = true;
      uiLog(`${G.players[seat].name} no quiere la contraflor. Eq ${teamOf(callerSeat)} cobra ${pts} pts.`, 'points');
      announce(seat, 'No quiero.');
      clearChantPending();
      if (endMatchIfChantWins()) return;
      afterEnvidoResolved();
    }
  }
}

function offerContraflor(firstSeat) { /* legacy stub — now handled by respondFlor */ }

// ── Card play ────────────────────────────────────────────────

export function skipChantAndPlay() {
  G.phase = 'play';
  if (runtime.renderGame) runtime.renderGame();
}

export function onCardClick(handIdx) {
  if (G.phase !== 'play' && G.phase !== 'chant') return;
  if (G.phase === 'chant') G.phase = 'play';
  const seat = G.activeSeat;
  const p    = G.players[seat];
  if (handIdx >= p.hand.length || handIdx < 0) return;
  if (G.playsThisTrick[seat]) return;

  if (headlessMode || typeof document === 'undefined') {
    const qc = p.hand.splice(handIdx, 1)[0];
    p.played.push(qc);
    G.playsThisTrick[seat] = qc;
    uiLog(`${p.name} juega carta cuántica: ${qcLabel(qc)}`, 'collapse');
    G.playOrderIdx++;
    if (G.playOrderIdx >= G.playOrder.length) resolveTrick();
    else {
      const nextSeat = G.playOrder[G.playOrderIdx];
      G.activeSeat = nextSeat;
      if (G.trickIdx === 0) G.phase = 'chant';
    }
    return;
  }

  // Origen del vuelo: la carta de la mano si juega quien mira la pantalla,
  // o el abanico del rival si juega el otro.
  const fromHand = seat === viewerSeatForAnim();
  let srcRect = null;
  let ghostNode = null;
  if (fromHand) {
    const srcEl = document.querySelectorAll('#hand-row .hand-card')[handIdx];
    const srcSvg = srcEl ? srcEl.querySelector('svg') : null;
    if (srcEl && srcSvg) {
      srcRect = srcEl.getBoundingClientRect();
      ghostNode = srcSvg.cloneNode(true);
    }
  } else {
    const fan = document.getElementById('opp-fan');
    if (fan && fan.lastElementChild) srcRect = fan.lastElementChild.getBoundingClientRect();
  }

  const qc = p.hand.splice(handIdx, 1)[0];
  p.played.push(qc);
  G.playsThisTrick[seat] = qc;
  uiLog(`${p.name} juega carta cuántica: ${qcLabel(qc)}`, 'collapse');

  const key = arenaKey(G.handNum, G.trickIdx, seat);
  const destSelector = `#arena-slots .arena-slot[data-seat="${seat}"] .table-card`;
  if (srcRect) flying.add(key);

  uiRenderHand();
  uiRenderArena();

  if (srcRect) {
    const dest = document.querySelector(destSelector);
    const destRect = dest ? dest.getBoundingClientRect() : null;
    if (!ghostNode && dest) {
      const destSvg = dest.querySelector('svg');
      ghostNode = destSvg ? destSvg.cloneNode(true) : null;
    }
    flyGhost(ghostNode, srcRect, destRect, { duration: 430 }).then(() => {
      flying.delete(key);
      // La mesa pudo redibujarse durante el vuelo: buscar la carta actual.
      const el = document.querySelector(destSelector);
      if (el) {
        el.classList.remove('is-flying');
        el.classList.add('landed');
      }
    });
  }

  G.playOrderIdx++;
  if (G.playOrderIdx >= G.playOrder.length) {
    resolveTrick();
  } else {
    const nextSeat = G.playOrder[G.playOrderIdx];
    G.activeSeat = nextSeat;
    if (G.trickIdx === 0) G.phase = 'chant';
    passTo(nextSeat);
  }
}

// Collapse all played cards this trick + their entangled partners, with animation
function collapseThisTrick() {
  for (const [seatStr, qc] of Object.entries(G.playsThisTrick)) {
    if (qc.collapsedTo) continue;

    // Collapse this card
    G.deck.collapse(qc);

    // Collapse entangled partner
    allSeats().forEach(s => {
      const op = G.players[s];
      [...op.hand, ...op.played].forEach(otherQc => {
        if (otherQc.pairId === qc.pairId && otherQc !== qc)
          G.deck.collapse(otherQc);
      });
    });

    uiLog(`⊗ Colapsa: ${qcLabel(qc)} → ${cardLabel(qc.collapsedTo)}`, 'collapse');
  }
}

export function goToMazo() {
  if (G.pendingChant) return;
  const seat    = G.activeSeat;
  const p       = G.players[seat];
  const oppTeam = 1 - p.team;
  const pts     = TRUCO_LEVELS[G.bet.level].pts;
  // Irse en la primera baza sin haber jugado carta y sin que se haya cantado
  // envido, flor ni truco regala además el punto del envido.
  const env = G.chant.envido;
  const extra = (G.trickIdx === 0 && G.bet.level === 0 && p.played.length === 0
    && env.calls.length === 0 && !env.resolved
    && Object.keys(G.chant.flor.sungBySeat).length === 0) ? 1 : 0;
  const total = pts + extra;
  const rival = G.tableSize === 2 ? G.players[oppTeam].name : `Equipo ${oppTeam === 0 ? 'A' : 'B'}`;

  const confirm = () => {
    G.handScore[oppTeam] += pts;
    if (extra) addChantPoints(oppTeam, extra);
    uiLog(`${p.name} al mazo. ${rival} cobra ${total} pts.`, 'points');
    announce(seat, 'Me voy al mazo.');
    finalizeHand();
  };

  if (headlessMode || typeof document === 'undefined' || !runtime.showModal) {
    confirm();
    return;
  }

  runtime.showModal('danger',
    `${p.name} se va al Mazo`,
    `${rival} cobra <strong>${total} pts</strong>${extra ? ' (1 del truco y 1 por el envido sin cantar)' : ''}.`,
    total,
    [
      { label: 'Confirmar', cls: 'danger', cb: () => {
          if (runtime.closeModal) runtime.closeModal();
          confirm();
      }},
      { label: 'Cancelar', cls: 'primary', cb: () => { if (runtime.closeModal) runtime.closeModal(); } },
    ]
  );
}

// ── Trick / hand resolution ──────────────────────────────────

function resolveTrick() {
  if (headlessMode || typeof document === 'undefined') {
    collapseThisTrick();
    const collapsedMap = {};
    for (const [seatStr, qc] of Object.entries(G.playsThisTrick)) {
      collapsedMap[parseInt(seatStr)] = qc.collapsedTo;
    }
    if (!G.trickHistory) G.trickHistory = [];
    const histEntry = [];
    G.playOrder.forEach(seat => {
      const qc = G.playsThisTrick[seat];
      if (qc && qc.collapsedTo) histEntry.push({ seat, card: qc.collapsedTo });
    });
    G.trickHistory.push(histEntry);

    const winner = trickWinner(collapsedMap, G.playOrder);
    G.trickWinners.push(winner.team);

    // Resumen de la baza para que los clientes online puedan reproducirla
    // (en modo headless la mesa se limpia en el mismo paso).
    G.eventSeq = (G.eventSeq || 0) + 1;
    G.lastTrick = {
      seq: G.eventSeq,
      handNum: G.handNum,
      trickIdx: G.trickIdx,
      winnerTeam: winner.team,
      plays: G.playOrder.filter(s => G.playsThisTrick[s]).map(s => {
        const qc = G.playsThisTrick[s];
        return { seat: s, pairId: qc.pairId, idxInPair: qc.idxInPair, options: qc.options, card: qc.collapsedTo };
      }),
    };

    if (winner.team !== -1) {
      G.leaderSeat = winner.seat;
      G.activeSeat = winner.seat;
      uiLog(`Baza ${G.trickIdx+1}: Equipo ${winner.team} · ${G.players[winner.seat].name}`, 'important');
    } else {
      G.leaderSeat = G.manoSeat;
      G.activeSeat = G.manoSeat;
      uiLog(`Baza ${G.trickIdx+1}: PARDA — sale el mano (${G.players[G.manoSeat].name})`, 'important');
    }

    const w0 = G.trickWinners.filter(w => w === 0).length;
    const w1 = G.trickWinners.filter(w => w === 1).length;
    const nPardas = G.trickWinners.filter(w=>w===-1).length;
    const handOver = w0 >= 2 || w1 >= 2 || G.trickWinners.length >= 3
      || (nPardas >= 1 && (w0 >= 1 || w1 >= 1));

    if (handOver) {
      G.phase = 'hand_end';
      settleChants(true);
      applyHandScore();
    } else {
      nextTrick();
    }
    return;
  }

  G.phase = 'collapsing';
  if (runtime.renderGame) runtime.renderGame();

  setTimeout(() => {
    collapseThisTrick();
    animateCollapse(() => {
      const collapsedMap = {};
      for (const [seatStr, qc] of Object.entries(G.playsThisTrick)) {
        collapsedMap[parseInt(seatStr)] = qc.collapsedTo;
      }

      if (!G.trickHistory) G.trickHistory = [];
      const histEntry = [];
      G.playOrder.forEach(seat => {
        const qc = G.playsThisTrick[seat];
        if (qc && qc.collapsedTo) histEntry.push({ seat, card: qc.collapsedTo });
      });
      G.trickHistory.push(histEntry);

      const winner = trickWinner(collapsedMap, G.playOrder);
      G.trickWinners.push(winner.team);

      if (winner.team !== -1) {
        G.leaderSeat = winner.seat;
        G.activeSeat = winner.seat;
        uiLog(`Baza ${G.trickIdx+1}: Equipo ${winner.team} · ${G.players[winner.seat].name}`, 'important');
      } else {
        G.leaderSeat = G.manoSeat;
        G.activeSeat = G.manoSeat;
        uiLog(`Baza ${G.trickIdx+1}: PARDA — sale el mano (${G.players[G.manoSeat].name})`, 'important');
      }

      const w0 = G.trickWinners.filter(w => w === 0).length;
      const w1 = G.trickWinners.filter(w => w === 1).length;
      const nPardas = G.trickWinners.filter(w=>w===-1).length;
      const handOver = w0 >= 2 || w1 >= 2 || G.trickWinners.length >= 3
        || (nPardas >= 1 && (w0 >= 1 || w1 >= 1));
      G.phase = handOver ? 'hand_end' : 'baza_end';
      if (runtime.renderGame) runtime.renderGame();
      if (!handOver) {
        setTimeout(() => {
          if (G.phase === 'baza_end') animateSweepTrick(() => nextTrick());
        }, 2600);
      }
    });
  }, 750);
}

// Sweep cards off the table before starting next trick
export function animateSweepTrick(onDone) {
  if (headlessMode || typeof document === 'undefined' || prefersReducedMotion()) {
    onDone();
    return;
  }
  const slots = [...document.querySelectorAll('#arena-slots .arena-slot')];
  const winnerTeam = G.trickWinners[G.trickWinners.length - 1];
  const viewerTeam = teamOf(viewerSeatForAnim());
  // Las cartas se van hacia quien ganó la baza.
  const dy = winnerTeam === -1 ? 0 : (winnerTeam === viewerTeam ? 90 : -90);

  slots.forEach((slot, i) => {
    slot.animate(
      [{ transform: 'none', opacity: 1 }, { transform: `translateY(${dy}px) scale(0.8)`, opacity: 0 }],
      { duration: 320, delay: i * 50, easing: 'ease-in', fill: 'forwards' },
    );
  });

  setTimeout(onDone, 330 + slots.length * 50);
}

// Colapso de las cartas de la mesa (y de sus pares en la mano). El render
// detecta qué cartas pasaron de cuánticas a definidas y las anima en orden.
function animateCollapse(cb) {
  if (headlessMode || typeof document === 'undefined') {
    cb();
    return;
  }
  uiRenderArena();
  uiRenderHand();
  const n = Object.keys(G.playsThisTrick).length;
  setTimeout(cb, Math.max(0, n - 1) * COLLAPSE_STAGGER + COLLAPSE_DUR + 250);
}

function nextTrick() {
  G.trickIdx++;
  G.playsThisTrick = {};
  G.playOrder      = circularOrder(allSeats(), G.leaderSeat, G.tableSize);
  G.playOrderIdx   = 0;
  G.phase          = 'play';
  G.activeSeat     = G.playOrder[0];
  if (headlessMode || typeof document === 'undefined') return;
  passTo(G.activeSeat);
}
// finalizeHand: called when hand ends due to mazo/reject (no trick resolution needed)
function finalizeHand() {
  clearChantPending();
  settleChants(false); // don't re-add truco points (already added)
  applyHandScore();
}

// Called from renderActionBar "Nueva Mano" when phase===hand_end
export function startNewHand() {
  if (G.phase === 'hand_end' && !G.handSettled) {
    settleChants(true); // settle envido + flor; truco already settled in resolveTrick path
    applyHandScore();
  }
}

function settleChants(includeTruco) {
  // Collapse all remaining cards
  G.players.forEach(p => {
    G.deck.collapseAll([...p.hand, ...p.played]);
  });
  const finalCards = {};
  G.players.forEach(p => {
    finalCards[p.seat] = [...p.hand, ...p.played]
      .map(q => q.collapsedTo).filter(Boolean);
  });

  // ── Truco ──
  if (includeTruco) {
    const tw  = resolveHandTruco(G.trickWinners, teamOf(G.manoSeat));
    const pts = TRUCO_LEVELS[G.bet.level].pts;
    G.handScore[tw] += pts;
    uiLog(`Truco: Eq ${tw} gana ${pts} pts.`, 'points');
  }

  // ── Envido ──
  const env = G.chant.envido;
  if (env.accepted && env.resolved) {
    const pts = envidoTotalIfAccepted(env.calls, env.callerTeam, G.target, G.scores);
    const res = settleEnvido(finalCards, allSeats(), G.players, G.handScore, teamOf(G.manoSeat), pts);
    if (!G.handChant) G.handChant = [0, 0];
    G.handChant[res.winner] += pts;
    const playerLines = allSeats().map(seat => {
      const name = G.players[seat].name;
      const score = res.teamScores[teamOf(seat)] ?? 0;
      return `${name}: ${score}`;
    }).join(' · ');
    const winnerName = G.players.find(p => teamOf(p.seat) === res.winner)?.name ?? `Eq ${res.winner}`;
    uiLog(`Envido: ${winnerName} gana ${pts} pts. [${playerLines}]`, 'points');
    G.lastEnvido = { res, pts, finalCards };
    if (runtime.showEnvidoAnnouncement) runtime.showEnvidoAnnouncement(res, pts, finalCards);
  }

  // ── Flor ──
  // Con cartas cuánticas la flor es una apuesta: se canta sin saber si va a
  // salir y recién acá, con todo colapsado, se ve quién la tenía de verdad.
  // Solo cobra quien la cantó. Cantarla y no tenerla le da 3 al rival.
  const flor = G.chant.flor;
  const florSeats = Object.keys(flor.sungBySeat).map(Number);
  if (florSeats.length > 0 && !flor.settled) {
    flor.settled = true;
    const best = {};
    for (const s of florSeats) {
      if (hasFlor(finalCards[s])) {
        const t = teamOf(s);
        best[t] = Math.max(best[t] ?? -1, florScore(finalCards[s]));
      }
    }
    const valid = Object.keys(best).map(Number);
    const sangTeams = [...new Set(florSeats.map(teamOf))];
    const contra = flor.contraflorCalled && flor.contraflorAccepted;
    const stake = !contra ? 3 : flor.contraflorAlResto ? faltaEnvidoPoints(G.target, G.scores) : 6;
    const label = !contra ? 'Flor' : flor.contraflorAlResto ? 'Contraflor al resto' : 'Contraflor';
    const teamName = (t) => (G.tableSize === 2 ? G.players[t].name : `Equipo ${t === 0 ? 'A' : 'B'}`);
    let text = '';

    if (valid.length === 2) {
      const winner = best[0] > best[1] ? 0 : best[1] > best[0] ? 1 : teamOf(G.manoSeat);
      addChantPoints(winner, stake);
      text = `${label}: ${best[0]} contra ${best[1]}. ${teamName(winner)} cobra ${stake}.`;
    } else if (valid.length === 1) {
      addChantPoints(valid[0], stake);
      text = `${label}: ${teamName(valid[0])} la tenía (${best[valid[0]]}) y cobra ${stake}.`;
    } else if (sangTeams.length === 1) {
      const liar = sangTeams[0];
      addChantPoints(1 - liar, 3);
      text = `${teamName(liar)} cantó flor y no le salió: ${teamName(1 - liar)} cobra 3.`;
    } else {
      text = `${label}: a nadie le salió la flor. No hay puntos.`;
    }
    uiLog(text, 'points');
    G.lastFlorText = text;
    if (!headlessMode && runtime.showTrucoCallToast) runtime.showTrucoCallToast(text, 3000);
  }
}

function applyHandScore() {
  // Una mano se liquida una sola vez (evita el doble clic en "Nueva mano").
  if (G.handSettled) return;
  G.handSettled = true;

  // Orden de conteo: primero envido/flor, después truco. Si alguien llega
  // al objetivo con los cantos, gana ahí y el truco ya no se cuenta.
  const chant = G.handChant || [0, 0];
  const truco = [G.handScore[0] - chant[0], G.handScore[1] - chant[1]];
  const reached = () => {
    const a = G.scores[0] >= G.target, b = G.scores[1] >= G.target;
    if (a && b) {
      if (G.scores[0] !== G.scores[1]) return G.scores[0] > G.scores[1] ? 0 : 1;
      return teamOf(G.manoSeat);
    }
    return a ? 0 : b ? 1 : null;
  };

  G.scores[0] += chant[0];
  G.scores[1] += chant[1];
  let winner = reached();
  if (winner === null) {
    G.scores[0] += truco[0];
    G.scores[1] += truco[1];
    winner = reached();
  } else {
    G.handScore = [chant[0], chant[1]];
  }

  uiLog(`=== Mano ${G.handNum}: +${G.handScore[0]}/${G.handScore[1]} → Total ${G.scores[0]}–${G.scores[1]} ===`, 'important');

  if (runtime.aiRecordHand) runtime.aiRecordHand();

  // Resumen de la mano para los clientes online.
  G.eventSeq = (G.eventSeq || 0) + 1;
  G.lastHand = {
    seq: G.eventSeq,
    handNum: G.handNum,
    handScore: [...G.handScore],
    scores: [...G.scores],
    envido: G.lastEnvido || null,
    florText: G.lastFlorText || null,
  };
  G.lastEnvido = null;
  G.lastFlorText = null;

  const doNext = () => {
    if (winner !== null) showWin(winner);
    else dealNewHand();
  };

  if (headlessMode || typeof document === 'undefined') {
    doNext();
    return;
  }

  if (runtime.isEnvidoOverlayOpen && runtime.setEnvidoOverlayOnClose && runtime.isEnvidoOverlayOpen()) {
    runtime.setEnvidoOverlayOnClose(doNext);
  } else {
    doNext();
  }
}

function dealNewHand() {
  G.handNum++;
  G.manoSeat = (G.manoSeat + 1) % G.tableSize;

  const deck = new QuantumDeck(null);
  G.deck = deck;
  G.players.forEach((p, seat) => {
    const hand = deck.deal(3);
    p.hand    = hand;
    p.played  = [];
    p.metric      = envidoMetric(hand);
    p.florMetric  = florMetric(hand);
  });

  G.bet       = { level: 0, lastRaiserTeam: null };
  G.chant     = {
    flor: { sungBySeat:{}, declarations:{}, contraflorCalled:false,
            contraflorCallerTeam:null, contraflorAlResto:false,
            contraflorAccepted:false, resolved:false },
    envido: { calls:[], accepted:false, resolved:false,
              callerTeam:null, callerSeat:null, declarations:{} },
    florBlockedEnvido: false,
  };
  G.trickWinners = [];
  G.trickHistory = [];
  G.pendingChant = null;
  G.trickIdx     = 0;
  G.handScore    = [0, 0];
  G.handChant    = [0, 0];
  G.handSettled  = false;
  G.playsThisTrick = {};
  G.leaderSeat   = G.manoSeat;
  G.playOrder    = circularOrder(allSeats(), G.leaderSeat, G.tableSize);
  G.playOrderIdx = 0;
  G.activeSeat   = G.playOrder[0];
  G.phase        = 'chant';

  // Show new hand announcement then animate the deal
  animateDeal(() => passTo(G.activeSeat));
}

// ── Deal animation ─────────────────────────────────────────
export function animateDeal(onDone) {
  if (headlessMode || typeof document === 'undefined') {
    if (runtime.showScreen) runtime.showScreen('screen-game');
    if (runtime.renderGame) runtime.renderGame();
    onDone();
    return;
  }
  if (runtime.showScreen) runtime.showScreen('screen-game');
  if (runtime.renderGame) runtime.renderGame();

  // La mano ya está dibujada en su lugar final, pero oculta hasta repartir.
  const handArea = document.querySelector('.hand-area');
  const oppZone  = document.getElementById('opp-zone');
  if (handArea) handArea.classList.add('pre-deal');
  if (oppZone)  oppZone.classList.add('pre-deal');

  const overlay = document.createElement('div');
  overlay.className = 'new-hand-overlay';
  const manoName = G.players[G.manoSeat].name;
  overlay.innerHTML = `
    <div class="new-hand-label">Mano ${G.handNum}</div>
    <div class="new-hand-num">Partida a ${G.target} pts · ${G.scores[0]}–${G.scores[1]}</div>
    <div class="mano-indicator"></div>`;
  overlay.querySelector('.mano-indicator').textContent = `✦ Es mano: ${manoName} ✦`;
  document.body.appendChild(overlay);

  const mazoEl = document.getElementById('mazo-stack');
  if (mazoEl) {
    mazoEl.classList.add('shuffling');
    setTimeout(() => mazoEl.classList.remove('shuffling'), 1100);
  }

  const LABEL_DURATION = prefersReducedMotion() ? 700 : 1500;
  setTimeout(() => {
    overlay.remove();
    dealCardsAnimated(onDone);
  }, LABEL_DURATION);
}

function dealCardsAnimated(onDone) {
  const handArea = document.querySelector('.hand-area');
  const oppZone  = document.getElementById('opp-zone');
  const reveal = () => {
    if (handArea) handArea.classList.remove('pre-deal');
    if (oppZone)  oppZone.classList.remove('pre-deal');
  };
  if (headlessMode || typeof document === 'undefined' || prefersReducedMotion()) {
    reveal();
    onDone();
    return;
  }

  const mine = [...document.querySelectorAll('#hand-row .hand-card')];
  const opp  = [...document.querySelectorAll('#opp-fan .card-back')];
  const mazoEl = document.getElementById('mazo-c1');
  if (!mazoEl || mine.length === 0) {
    reveal();
    onDone();
    return;
  }
  const from = mazoEl.getBoundingClientRect();

  // Cada carta queda oculta por separado hasta que le llega su dorso volando.
  [...mine, ...opp].forEach(el => { el.style.visibility = 'hidden'; });
  reveal();

  const STEP = 130;
  const FLY  = 380;
  const order = [];
  for (let i = 0; i < Math.max(mine.length, opp.length); i++) {
    if (opp[i])  order.push({ el: opp[i],  mine: false });
    if (mine[i]) order.push({ el: mine[i], mine: true });
  }

  order.forEach(({ el, mine: isMine }, k) => {
    setTimeout(() => {
      const to = el.getBoundingClientRect();
      flyGhost(makeCardBack(), from, to, { duration: FLY, fromRot: -25 }).then(() => {
        el.style.visibility = '';
        if (isMine) el.classList.add('reveal');
      });
    }, k * STEP);
  });

  setTimeout(onDone, (order.length - 1) * STEP + FLY + 380);
}

function showWin(winnerTeam) {
  const winner = (winnerTeam === 0 || winnerTeam === 1)
    ? winnerTeam
    : (G.scores[0] >= G.target ? 0 : 1);
  const name   = G.tableSize === 2
    ? G.players[winner === 0 ? 0 : 1].name
    : `Equipo ${winner}`;
  G.matchEnded = true;
  G.winnerTeam = winner;
  G.winnerName = name;
  G.phase = 'match_end';
  if (runtime.showWinScreen) {
    runtime.showWinScreen(`¡${name.toUpperCase()} GANA!`, winner === 0 ? 'Equipo 0 victorioso' : 'Equipo 1 victorioso', `${G.scores[0]} — ${G.scores[1]}`);
  }
  if (runtime.showScreen) runtime.showScreen('screen-win');
}

// ── helpers ──────────────────────────────────────────────────

export function validateIntentActor(seat, type) {
  if (!G) return false;
  if (G.matchEnded) return false;
  if (type === 'pending') return !!G.pendingChant && G.pendingChant.responderSeat === seat;
  return !G.pendingChant && G.activeSeat === seat;
}

// Rival que responde un canto: el que sigue en la ronda (los equipos se
// sientan alternados, así que el siguiente siempre es del otro equipo).
export function getOppSeat(seat) {
  return (seat + 1) % G.tableSize;
}

// ── modal ────────────────────────────────────────────────────
