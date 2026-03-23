// @ts-nocheck
// Refactor of the original single-file Quantum Truco source.
// This file owns game state, rules, flow, and gameplay mutations.

export const setupCfg = { tableSize:2, target:15, conFlor:false, mode:'human', playerNames:['',''] };
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
  resetAITurn: null,   // lightweight: clears pending without wiping model
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

export function envidoTotalIfAccepted(calls, callerTeam, target, scores) {
  let total = 0;
  for (const call of calls) {
    if (call==="falta envido") total += Math.max(target - scores[1-callerTeam], 1);
    else total += ENVIDO_CALL_PTS[call];
  }
  return total;
}

export function envidoPointsIfRejected(calls, callerTeam, target, scores) {
  if (!calls.length) return 0;
  const prev = calls.slice(0,-1);
  if (!prev.length) return 1;
  let total = 0;
  for (const call of prev) {
    if (call==="falta envido") total += Math.max(target-scores[1-callerTeam],1);
    else total += ENVIDO_CALL_PTS[call];
  }
  return Math.max(total, 1);
}

export function envidoCanRaise(lastCall) {
  if (lastCall==="falta envido") return [];
  if (lastCall==="real envido") return ["falta envido"];
  if (lastCall==="envido") return ["envido","real envido","falta envido"];
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
    manoSeat: 0,
    handNum: 1,
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
  G.aiThinking = false;
  // Apply custom player names from setup (empty string = keep default)
  if (G.tableSize === 2) {
    const names = setupCfg.playerNames || [];
    const n0 = (names[0] || '').trim();
    const n1 = (names[1] || '').trim();
    if (n0) G.players[0].name = n0;
    if (n1) G.players[1].name = n1;
  }
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

export function deferPendingTrucoAndInitiateEnvido(call) {
  if (!G || !G.pendingChant || G.pendingChant.type !== 'truco') return;
  const { level, raiserTeam } = G.pendingChant.data;
  const responderSeat = G.activeSeat;
  G.bet._pendingRaise = { level, raiserTeam };
  clearChantPending();
  G.activeSeat = responderSeat;
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
  if (runtime.showTrucoCallToast) runtime.showTrucoCallToast(callPhrase);
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
    if (runtime.showTrucoToast) runtime.showTrucoToast(G.players[responderSeat].name);
    G.phase = 'play';
    // The turn goes back to whoever is next in playOrder from where we left off
    // playOrderIdx points to the CURRENT player who should play next
    G.activeSeat = G.playOrder[G.playOrderIdx];
    if (runtime.renderGame) runtime.renderGame();
    if (runtime.aiResume) runtime.aiResume();
  } else {
    G.handScore[raiserTeam] += curPts;
    uiLog(`${G.players[responderSeat].name} rechaza. ${teamName(raiserTeam)} cobra ${curPts} pts.`, 'points');
    finalizeHand();
  }
}

export function raiseTruco() {
  // Responder raises instead of accepting/rejecting
  const { callerSeat, data } = G.pendingChant;
  clearChantPending();
  // The former responder is now the raiser
  const newRaiserSeat = G.activeSeat;
  const newRaiserTeam = teamOf(newRaiserSeat);
  const newLevel = data.level + 1;
  const nxt = TRUCO_LEVELS[newLevel];
  if (!nxt) return;
  uiLog(`${G.players[newRaiserSeat].name} sube a ${nxt.name}!`, 'important');
  setChantPending('truco', newRaiserSeat, callerSeat, { level: newLevel, raiserTeam: newRaiserTeam });
}

// ── Envido ────────────────────────────────────────────────────

export function initiateEnvido(call) {
  const env  = G.chant.envido;
  const seat = G.activeSeat;
  env.callerTeam = teamOf(seat);
  env.callerSeat = seat;
  env.calls.push(call);
  const oppSeat = getOppSeat(seat);
  uiLog(`${G.players[seat].name} canta ${call}.`, 'important');
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
    afterEnvidoResolved();
  } else if (action === 'reject') {
    clearChantPending();
    env.resolved = true;
    G.handScore[env.callerTeam] += rejPts;
    uiLog(`${G.players[respSeat].name} rechaza. ${teamName(env.callerTeam)} cobra ${rejPts} pts.`, 'points');
    afterEnvidoResolved();
  } else {
    // raise — action is the call string; roles flip: responder becomes new caller
    env.calls.push(action);
    env.callerTeam = teamOf(respSeat);
    uiLog(`${G.players[respSeat].name} sube: ${action}.`, 'important');
    clearChantPending();
    setChantPending('envido', respSeat, prevCallerSeat, { callerSeat: respSeat });
  }
}

// After envido is resolved, check if truco was pending
function afterEnvidoResolved() {
  if (G.bet._pendingRaise) {
    const { level, raiserTeam } = G.bet._pendingRaise;
    delete G.bet._pendingRaise;
    const trucoRaiserSeat = allSeats().find(s => teamOf(s) === raiserTeam) ?? 0;
    G.activeSeat = getOppSeat(trucoRaiserSeat);
    uiLog(`Envido resuelto. Ahora hay que responder el ${TRUCO_LEVELS[level].name}.`, 'important');
    setChantPending('truco', trucoRaiserSeat, G.activeSeat, { level, raiserTeam });
  } else {
    G.phase = 'play';
    G.activeSeat = G.playOrder[G.playOrderIdx];
    if (runtime.renderGame) runtime.renderGame();
    if (runtime.aiResume) runtime.aiResume();
  }
}

// ── Flor ─────────────────────────────────────────────────────

export function singFlor() {
  const flor    = G.chant.flor;
  const seat    = G.activeSeat;
  const oppSeat = getOppSeat(seat);
  flor.sungBySeat[seat] = true;
  const oppFm = G.players[oppSeat].florMetric;
  uiLog(`${G.players[seat].name} canta Flor.`, 'important');
  if (oppFm.pFlor > 0) {
    setChantPending('flor', seat, oppSeat, { stage: 'initial', firstSeat: seat });
  } else {
    G.handScore[teamOf(seat)] += 3;
    G.chant.florBlockedEnvido = true;
    flor.resolved = true;
    uiLog(`Flor sin rival. ${teamName(teamOf(seat))} cobra 3 pts.`, 'points');
    G.phase = 'play';
    G.activeSeat = G.playOrder[G.playOrderIdx];
    if (runtime.renderGame) runtime.renderGame(); if (runtime.aiResume) runtime.aiResume();
  }
}

export function respondFlor(action) {
  const { callerSeat, data } = G.pendingChant;
  const flor  = G.chant.flor;
  const seat  = G.activeSeat;
  const { stage, firstSeat } = data;

  if (stage === 'initial') {
    if (action === 'yes') {
      flor.sungBySeat[seat] = true;
      uiLog(`${G.players[seat].name} también tiene Flor.`, 'important');
      clearChantPending();
      setChantPending('flor', callerSeat, seat, { stage: 'contraflor', firstSeat });
    } else {
      G.handScore[teamOf(callerSeat)] += 3;
      G.chant.florBlockedEnvido = true;
      flor.resolved = true;
      uiLog(`Sin flor rival. ${teamName(teamOf(callerSeat))} cobra 3 pts.`, 'points');
      clearChantPending();
      G.phase = 'play'; G.activeSeat = G.playOrder[G.playOrderIdx]; if (runtime.renderGame) runtime.renderGame(); if (runtime.aiResume) runtime.aiResume();
    }
  } else if (stage === 'contraflor') {
    if (action === 'simple') {
      flor.resolved = true; G.chant.florBlockedEnvido = true;
      uiLog('Flor simple. Se liquida al final.', 'important');
      clearChantPending(); G.phase = 'play'; G.activeSeat = G.playOrder[G.playOrderIdx]; if (runtime.renderGame) runtime.renderGame(); if (runtime.aiResume) runtime.aiResume();
    } else if (action === 'contraflor') {
      flor.contraflorCalled = true;
      uiLog(`${G.players[seat].name} canta Contraflor.`, 'important');
      clearChantPending();
      setChantPending('flor', seat, firstSeat, { stage: 'resp_contraflor', firstSeat, alResto: false });
    } else if (action === 'alresto') {
      flor.contraflorCalled = true; flor.contraflorAlResto = true;
      uiLog(`${G.players[seat].name} canta Contraflor al Resto.`, 'important');
      clearChantPending();
      setChantPending('flor', seat, firstSeat, { stage: 'resp_contraflor', firstSeat, alResto: true });
    }
  } else if (stage === 'resp_contraflor') {
    if (action === 'accept') {
      flor.contraflorAccepted = true; flor.resolved = true; G.chant.florBlockedEnvido = true;
      const lbl = data.alResto ? 'Contraflor al Resto' : 'Contraflor';
      uiLog(`${lbl} aceptada. Se liquida al final.`, 'important');
      clearChantPending(); G.phase = 'play'; G.activeSeat = G.playOrder[G.playOrderIdx]; if (runtime.renderGame) runtime.renderGame(); if (runtime.aiResume) runtime.aiResume();
    } else {
      const pts = data.alResto ? 4 : 3;
      G.handScore[teamOf(callerSeat)] += pts;
      flor.resolved = true; G.chant.florBlockedEnvido = true;
      uiLog(`Rechaza contraflor. ${teamName(teamOf(callerSeat))} cobra ${pts} pts.`, 'points');
      clearChantPending(); finalizeHand();
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

  const handWraps = document.querySelectorAll('#hand-row .hand-card-wrap');
  const srcEl  = handWraps[handIdx];
  const srcRect = srcEl ? srcEl.getBoundingClientRect() : null;
  const srcSvg  = srcEl ? srcEl.querySelector('svg') : null;
  const ghostSvg = srcSvg ? srcSvg.cloneNode(true) : null;

  const qc = p.hand.splice(handIdx, 1)[0];
  p.played.push(qc);
  G.playsThisTrick[seat] = qc;
  uiLog(`${p.name} juega carta cuántica: ${qcLabel(qc)}`, 'collapse');

  uiRenderHand();

  const cScale    = G.tableSize > 2 ? 0.62 : 0.76;
  const srcScale  = G.tableSize > 2 ? 0.795 : 0.925;
  const FLY       = 620;

  const continueGame = () => {
    G.playOrderIdx++;
    if (G.playOrderIdx >= G.playOrder.length) {
      resolveTrick();
    } else {
      const nextSeat = G.playOrder[G.playOrderIdx];
      G.activeSeat = nextSeat;
      if (G.trickIdx === 0) G.phase = 'chant';
      passTo(nextSeat);
    }
  };

  if (srcRect && ghostSvg) {
    const ghost = document.createElement('div');
    const srcCX = srcRect.left + srcRect.width  / 2;
    const srcCY = srcRect.top  + srcRect.height / 2;
    ghost.style.cssText = `
      position:fixed; pointer-events:none; z-index:600;
      left:${srcCX}px; top:${srcCY}px;
      transform:translate(-50%,-50%) scale(${srcScale});
      transition:none;
      filter:drop-shadow(0 10px 28px rgba(0,0,0,0.75));
    `;
    ghost.appendChild(ghostSvg);
    document.body.appendChild(ghost);

    uiRenderArena();
    const slots   = document.querySelectorAll('#arena-slots .arena-slot');
    const destSlot = slots[slots.length - 1];
    const destInner = destSlot ? destSlot.querySelector('div') : null;
    if (destInner) destInner.style.visibility = 'hidden';

    // Force a layout pass so the inner div has its final CSS-transformed position
    destInner && destInner.getBoundingClientRect();
    const destRect  = destSlot  ? destSlot.getBoundingClientRect()  : null;
    // getBoundingClientRect on the inner element returns its visual (post-transform) rect
    const innerRect = destInner ? destInner.getBoundingClientRect() : destRect;
    const destCX   = innerRect ? innerRect.left + innerRect.width  / 2 : srcCX;
    const destCY   = innerRect ? innerRect.top  + innerRect.height / 2 : srcCY + 200;

    ghost.getBoundingClientRect();
    ghost.style.transition = `left ${FLY}ms cubic-bezier(0.25,0.1,0.2,1),
                               top  ${FLY}ms cubic-bezier(0.35,0,0.15,1),
                               transform ${FLY}ms cubic-bezier(0.25,0.1,0.2,1),
                               filter ${FLY}ms ease`;
    ghost.style.left      = `${destCX}px`;
    ghost.style.top       = `${destCY}px`;
    ghost.style.transform = `translate(-50%,-50%) scale(${cScale})`;
    ghost.style.filter    = 'drop-shadow(0 3px 8px rgba(0,0,0,0.45))';

    setTimeout(() => {
      ghost.remove();
      const target = (destInner && destInner.isConnected && destInner.style.visibility === 'hidden')
        ? destInner
        : null;
      if (target) {
        target.style.visibility = 'visible';
        target.style.transform  = `scale(${cScale * 1.07})`;
        target.getBoundingClientRect();
        target.style.transition = 'transform 0.28s cubic-bezier(0.34,1.4,0.64,1)';
        target.style.transform  = `scale(${cScale})`;
        setTimeout(() => { if (target) target.style.transition = ''; }, 350);
      }
    }, FLY);

    continueGame();

  } else {
    uiRenderArena();
    continueGame();
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
  // Guard: only valid when it is the active player's turn, no pending chant
  if (!G || G.matchEnded) return;
  if (G.pendingChant) return;
  if (G.phase !== 'play' && G.phase !== 'chant') return;

  const seat    = G.activeSeat;
  const p       = G.players[seat];
  if (!p) return;
  const oppTeam = 1 - p.team;
  const betLevel = (G.bet && G.bet.level >= 0 && G.bet.level <= 3) ? G.bet.level : 0;
  // If a deferred truco raise is pending, use its level for the pts
  const effectiveLevel = (G.bet._pendingRaise && G.bet._pendingRaise.level != null)
    ? G.bet._pendingRaise.level - 1   // pts for not-yet-accepted raise = previous level
    : betLevel;
  const pts = TRUCO_LEVELS[Math.max(0, effectiveLevel)].pts;

  if (headlessMode || typeof document === 'undefined' || !runtime.showModal) {
    clearChantPending();
    if (G.bet._pendingRaise) delete G.bet._pendingRaise;
    G.handScore[oppTeam] += pts;
    uiLog(`${p.name} al mazo. ${teamName(oppTeam)} cobra ${pts} pts.`, 'points');
    finalizeHand();
    return;
  }

  runtime.showModal('danger',
    `${p.name} se va al Mazo`,
    `${teamName(oppTeam)} cobra <strong>${pts} pts</strong> de Truco.`,
    pts,
    [
      { label: 'Confirmar', cls: 'danger', cb: () => {
          clearChantPending();
          if (G.bet._pendingRaise) delete G.bet._pendingRaise;
          G.handScore[oppTeam] += pts;
          uiLog(`${p.name} al mazo. ${teamName(oppTeam)} cobra ${pts} pts.`, 'points');
          if (runtime.closeModal) runtime.closeModal();
          finalizeHand();
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
      if (handOver) { G.aiThinking = false; if (runtime.resetAITurn) runtime.resetAITurn(); }
      if (runtime.renderGame) runtime.renderGame();
      if (!handOver) {
        setTimeout(() => {
          if (G.phase === 'baza_end') animateSweepTrick(() => nextTrick());
        }, 5600);
      }
    });
  }, 1400);
}

// Sweep cards off the table before starting next trick
export function animateSweepTrick(onDone) {
  if (headlessMode || typeof document === 'undefined') {
    onDone();
    return;
  }
  const slots = [...document.querySelectorAll('#arena-slots .arena-slot')];
  const winnerTeam = G.trickWinners[G.trickWinners.length - 1];
  const sweepY = winnerTeam === -1 ? 80 : -60;
  const sweepX = winnerTeam === 1 ? 60 : -60;

  slots.forEach((slot, i) => {
    const d = slot.querySelector('div');
    if (!d) return;
    d.style.transition = `transform 0.32s cubic-bezier(0.4,0,1,1) ${i * 55}ms, opacity 0.28s ease ${i * 55 + 60}ms`;
    d.style.transform += ` translate(${sweepX}px, ${sweepY}px) scale(0.7)`;
    d.style.opacity = '0';
  });

  setTimeout(onDone, 450);
}

// Run collapse animation on cards in the arena, then call cb
export function animateCollapse(cb) {
  if (headlessMode || typeof document === 'undefined') {
    cb();
    return;
  }
  const arena = document.getElementById('arena-slots');
  const slots = [...arena.querySelectorAll('.arena-slot')];

  const ANIM_DURATION = 1800;
  const STAGGER = 1200;
  let maxEnd = 0;

  slots.forEach((slot, i) => {
    const delay = i * STAGGER;
    maxEnd = Math.max(maxEnd, delay + ANIM_DURATION);

    setTimeout(() => {
      const d = slot.querySelector('div');
      if (!d) return;

      const seat = G.playOrder[i];
      const qc = G.playsThisTrick[seat];
      if (!qc || !qc.collapsedTo) return;

      const [a, b] = qc.options;
      const entangledSvg = uiBuildEntangled(a.rank, a.suit, b.rank, b.suit, false);

      const cScale = G.tableSize > 2 ? 0.62 : 0.76;
      const rot = ((seat * 7) % 15) - 7;
      const collapsedSvg = uiBuildCardSVG(qc.collapsedTo.rank, qc.collapsedTo.suit,
        `col_${seat}_${qc.collapsedTo.rank}_${qc.collapsedTo.suit}_${i}`);

      d.innerHTML = `
        <div class="collapse-wrap" style="--ds:${cScale};--dr:${rot}deg;">
          <div class="layer-collapsed">${collapsedSvg}</div>
          <div class="layer-entangled">${entangledSvg}</div>
        </div>`;
      d.style.filter = '';

      document.querySelectorAll('#hand-row .hand-card-wrap svg').forEach(svg => {
        svg.style.animation = 'none';
        svg.offsetHeight;
        svg.style.animation = 'shakePartner 0.5s ease';
      });
    }, delay);
  });

  setTimeout(cb, maxEnd + 300);
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
  G.aiThinking = false;
  if (runtime.resetAITurn) runtime.resetAITurn();
  settleChants(false); // don't re-add truco points (already added)
  applyHandScore();
}

// Called from renderActionBar "Nueva Mano" when phase===hand_end
export function startNewHand() {
  if (G.phase === 'hand_end') {
    G.aiThinking = false;
    if (runtime.resetAITurn) runtime.resetAITurn();
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
    uiLog(`Truco: ${teamName(tw)} gana ${pts} pts.`, 'points');
  }

  // ── Envido ──
  const env = G.chant.envido;
  if (env.accepted && env.resolved) {
    const pts = envidoTotalIfAccepted(env.calls, env.callerTeam, G.target, G.scores);
    const res = settleEnvido(finalCards, allSeats(), G.players, G.handScore, teamOf(G.manoSeat), pts);
    const playerLines = allSeats().map(seat => {
      const name = G.players[seat].name;
      const score = res.teamScores[teamOf(seat)] ?? 0;
      return `${name}: ${score}`;
    }).join(' · ');
    const winnerName = G.players.find(p => teamOf(p.seat) === res.winner)?.name ?? `Eq ${res.winner}`;
    uiLog(`Envido: ${winnerName} gana ${pts} pts. [${playerLines}]`, 'points');
    if (runtime.showEnvidoAnnouncement) runtime.showEnvidoAnnouncement(res, pts, finalCards);
  }

  // ── Flor ──
  const flor = G.chant.flor;
  if (Object.keys(flor.sungBySeat).length > 0) {
    const teamFlorScores = {};
    G.players.forEach(p => {
      if (hasFlor(finalCards[p.seat])) {
        const fs = florScore(finalCards[p.seat]);
        teamFlorScores[p.team] = Math.max(teamFlorScores[p.team] ?? -1, fs);
      }
    });
    const florTeams = Object.keys(teamFlorScores).map(Number);

    if (flor.contraflorCalled && flor.contraflorAccepted) {
      if (florTeams.length === 2) {
        const winner = teamFlorScores[0] >= teamFlorScores[1] ? 0 : 1;
        const pts    = flor.contraflorAlResto
          ? Math.max(G.target - G.scores[1 - winner], 1)
          : Math.abs(teamFlorScores[0] - teamFlorScores[1]) + 3;
        G.handScore[winner] += pts;
        uiLog(`${flor.contraflorAlResto?'Contraflor al Resto':'Contraflor'}: ${teamName(winner)} cobra ${pts} pts.`, 'points');
      }
    } else if (!flor.contraflorCalled || !flor.contraflorAccepted) {
      if (florTeams.length === 1) {
        G.handScore[florTeams[0]] += 3;
        uiLog(`Flor: ${teamName(florTeams[0])} cobra 3 pts.`, 'points');
      } else if (florTeams.length === 2) {
        const winner = teamFlorScores[0] > teamFlorScores[1] ? 0 :
                       teamFlorScores[1] > teamFlorScores[0] ? 1 : teamOf(G.manoSeat);
        G.handScore[winner] += 3;
        uiLog(`Flor: ${teamName(winner)} cobra 3 pts.`, 'points');
      }
    }
  }
}

function applyHandScore() {
  G.scores[0] += G.handScore[0];
  G.scores[1] += G.handScore[1];
  uiLog(`=== Mano ${G.handNum}: +${G.handScore[0]}/${G.handScore[1]} → Total ${G.scores[0]}–${G.scores[1]} ===`, 'important');

  if (runtime.aiRecordHand) runtime.aiRecordHand();

  const doNext = () => {
    if (G.scores[0] >= G.target || G.scores[1] >= G.target) showWin();
    else dealNewHand();
  };

  if (headlessMode || typeof document === 'undefined') {
    // In headless mode (server): stop here so the hand_end state can be
    // broadcast to clients before advancing. Server calls serverStartNextHand().
    if (G.scores[0] >= G.target || G.scores[1] >= G.target) {
      const winner = G.scores[0] >= G.target ? 0 : 1;
      G.matchEnded = true;
      G.winnerTeam = winner;
      G.winnerName = G.tableSize === 2
        ? G.players[winner === 0 ? 0 : 1].name : `Equipo ${winner}`;
      G.phase = 'match_end';
    }
    // phase remains 'hand_end' unless match ended above
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
  G.playsThisTrick = {};
  G.leaderSeat   = G.manoSeat;
  G.playOrder    = circularOrder(allSeats(), G.leaderSeat, G.tableSize);
  G.playOrderIdx = 0;
  G.activeSeat   = G.playOrder[0];
  G.phase        = 'chant';
  G.aiThinking   = false;
  // Invalidate any stale AI timeouts from the previous hand
  if (runtime.resetAITurn) runtime.resetAITurn();

  // Show new hand announcement then animate the deal
  animateDeal(() => passTo(G.activeSeat));
}

// ── Deal animation ─────────────────────────────────────────
function animateDeal(onDone) {
  if (headlessMode || typeof document === 'undefined') {
    if (runtime.showScreen) runtime.showScreen('screen-game');
    if (runtime.renderGame) runtime.renderGame();
    onDone();
    return;
  }
  if (runtime.showScreen) runtime.showScreen('screen-game');
  if (runtime.renderGame) runtime.renderGame();
  // Clear envido metrics immediately – they'll reappear after the deal animation completes
  { const _ie = document.getElementById && document.getElementById('envido-info'); if (_ie) _ie.innerHTML = ''; }

  const overlay = document.createElement('div');
  overlay.className = 'new-hand-overlay';
  const manoName = G.players[G.manoSeat].name;
  overlay.innerHTML = `
    <div class="new-hand-label">Mano ${G.handNum}</div>
    <div class="new-hand-num">Partida a ${G.target} pts · ${G.scores[0]}–${G.scores[1]}</div>
    <div class="mano-indicator">✦ Es mano: ${manoName} ✦</div>`;
  document.body.appendChild(overlay);

  const mazoEl = document.getElementById('mazo-stack');
  if (mazoEl) {
    mazoEl.style.animation = 'mazoShake 0.5s ease 200ms, mazoGlow 1.2s ease 100ms';
    setTimeout(() => { if (mazoEl) mazoEl.style.animation = ''; }, 1400);
  }

  const LABEL_DURATION = 3000;
  setTimeout(() => {
    overlay.remove();
    dealCardsAnimated(onDone);
  }, LABEL_DURATION);
}

export function dealCardsAnimated(onDone) {
  if (headlessMode || typeof document === 'undefined') {
    onDone();
    return;
  }
  const rowEl  = document.getElementById('hand-row');
  if (rowEl) rowEl.innerHTML = '';
  const infoEl = document.getElementById('envido-info');
  if (infoEl) infoEl.innerHTML = '';

  const humanSeat = G.onlineMode ? (G.viewerSeat ?? G.activeSeat) : (G.aiSeat !== null) ? 0 : G.activeSeat;
  const p     = G.players[humanSeat];
  const scale = G.tableSize > 2 ? 0.795 : 0.925;

  const mazoEl   = document.getElementById('mazo-c1') || document.querySelector('.mazo-c1');
  const mazoRect = mazoEl
    ? mazoEl.getBoundingClientRect()
    : { left: window.innerWidth - 100, top: window.innerHeight - 150, width: 62, height: 96 };
  const origX = mazoRect.left + mazoRect.width  / 2;
  const origY = mazoRect.top  + mazoRect.height / 2;

  const STAGGER     = 320;
  const FLY         = 520;
  const TOTAL       = STAGGER * (p.hand.length - 1) + FLY + 180;

  p.hand.forEach((qc, i) => {
    setTimeout(() => {
      const wrap = document.createElement('div');
      wrap.className = 'hand-card-wrap';
      wrap.style.cssText = `transform:scale(${scale});--hw-hover:scale(${scale*1.08}) translateY(-20px);visibility:hidden;`;
      const [a, b] = qc.options;
      wrap.innerHTML = uiBuildEntangled(a.rank, a.suit, b.rank, b.suit, false);
      rowEl.appendChild(wrap);

      const destRect = wrap.getBoundingClientRect();
      const destX    = destRect.left + destRect.width  / 2;
      const destY    = destRect.top  + destRect.height / 2;

      const realSvg  = wrap.querySelector('svg');
      const ghostSvg = realSvg ? realSvg.cloneNode(true) : null;
      if (!ghostSvg) { wrap.style.visibility = 'visible'; return; }

      const ghost = document.createElement('div');
      ghost.style.cssText = `
        position:fixed; pointer-events:none; z-index:600;
        left:${origX}px; top:${origY}px;
        transform:translate(-50%,-50%) scale(${scale * 0.5}) rotate(${(i-1)*12}deg);
        transition:none;
        filter:drop-shadow(0 6px 18px rgba(0,0,0,0.7));
        opacity:0.85;
      `;
      ghost.appendChild(ghostSvg);
      document.body.appendChild(ghost);

      ghost.getBoundingClientRect();
      ghost.style.transition = `left   ${FLY}ms cubic-bezier(0.25,0.1,0.2,1),
                                 top    ${FLY}ms cubic-bezier(0.35,0,0.15,1),
                                 transform ${FLY}ms cubic-bezier(0.25,0.1,0.2,1),
                                 opacity   ${FLY}ms ease,
                                 filter    ${FLY}ms ease`;
      ghost.style.left      = `${destX}px`;
      ghost.style.top       = `${destY}px`;
      ghost.style.transform = `translate(-50%,-50%) scale(${scale})`;
      ghost.style.filter    = 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))';
      ghost.style.opacity   = '1';

      setTimeout(() => {
        ghost.remove();
        wrap.style.visibility = 'visible';
        wrap.style.transform  = `scale(${scale * 1.06})`;
        wrap.getBoundingClientRect();
        wrap.style.transition = `transform 0.24s cubic-bezier(0.34,1.4,0.64,1)`;
        wrap.style.transform  = `scale(${scale})`;
        setTimeout(() => { wrap.style.transition = ''; }, 300);
      }, FLY);

    }, i * STAGGER);
  });

  setTimeout(onDone, TOTAL);
}

function showWin() {
  const winner = G.scores[0] >= G.target ? 0 : 1;
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

// Called by server after broadcasting hand_end state to clients.
// Deals the next hand (or does nothing if match already ended).
export function serverStartNextHand() {
  if (!G || G.matchEnded || G.phase === 'match_end' || G.phase !== 'hand_end') return;
  dealNewHand();
}

export function getOppSeat(seat) {
  return allSeats().find(s => teamOf(s) !== teamOf(seat)) ?? (1 - seat);
}

// Returns a readable team label using player names (2-player) or "Eq 0/1" fallback
export function teamName(team) {
  if (!G || G.tableSize !== 2) return `Eq ${team}`;
  const p = G.players.find(pl => pl.team === team);
  return p ? p.name : `Eq ${team}`;
}


// ── Runtime UI wrappers (used by online.ts to avoid circular imports) ────────
export function uiShowTrucoCallToast(phrase) { if (runtime.showTrucoCallToast) runtime.showTrucoCallToast(phrase); }
export function uiShowTrucoToast(name)        { if (runtime.showTrucoToast) runtime.showTrucoToast(name); }
export function uiRenderGameFull()            { if (runtime.renderGame) runtime.renderGame(); }
export function uiRenderArenaOnly()           { if (runtime.renderArena) runtime.renderArena(); }
export function uiShowEnvidoAnnouncement(res, pts, finalCards) { if (runtime.showEnvidoAnnouncement) runtime.showEnvidoAnnouncement(res, pts, finalCards); }

// ── modal ────────────────────────────────────────────────────
