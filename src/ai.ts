// @ts-nocheck
// Rivales de IA del Truco Cuántico.
//
// El archivo tiene dos mitades:
//   1. Decisión pura: aiDecide(estado, asiento, nivel, memoria) → acción.
//      No toca el DOM ni el estado; sirve igual para el juego y para simular
//      partidas IA contra IA sin navegador.
//   2. Pegamento con el juego: turnos, demoras "humanas" y aplicación de la
//      acción elegida llamando a las funciones de game.ts.
//
// Regla de oro: la IA solo usa lo que vería un jugador sentado en su lugar:
// las dos opciones de cada carta propia, las cartas jugadas (con sus opciones
// y colapsos), los cantos y el puntaje. Nunca lee la mano rival, el mazo ni
// los bits de colapso todavía no revelados.

import {
  G,
  SUITS,
  RANKS,
  teamOf,
  TRUCO_LEVELS,
  trucoPower,
  envidoCanRaise,
  envidoTotalIfAccepted,
  envidoPointsIfRejected,
  faltaEnvidoPoints,
  canTeamRaiseNow,
  canEnvidoFirst,
  canOpenEnvido,
  canSingFlor,
  canFlorOverEnvido,
  raiseTruco,
  respondTruco,
  respondEnvido,
  respondFlor,
  singTruco,
  singFlor,
  florOverEnvido,
  deferPendingTrucoAndInitiateEnvido,
  initiateEnvido,
  onCardClick,
  uiLog,
} from './game';

// ═════════════════════════════════════════════════════════════
// 1. TABLAS DE CARTAS
// ═════════════════════════════════════════════════════════════

const POW = [], ENVV = [], SUITI = [];
for (let s = 0; s < 4; s++) {
  for (let r = 0; r < 10; r++) {
    POW.push(trucoPower({ suit: SUITS[s], rank: RANKS[r] }));
    ENVV.push(RANKS[r] <= 7 ? RANKS[r] : 0);
    SUITI.push(s);
  }
}
const cid = (c) => SUITS.indexOf(c.suit) * 10 + RANKS.indexOf(c.rank);

// PCT[poder] = probabilidad de ganarle a otra carta cualquiera del mazo.
const PCT = [];
{
  const cnt = new Array(15).fill(0);
  for (const p of POW) cnt[p]++;
  let below = 0;
  for (let p = 1; p <= 14; p++) { PCT[p] = (below + 0.5 * (cnt[p] - 1)) / 39; below += cnt[p]; }
}

function env3(a, b, c) {
  const va = ENVV[a], vb = ENVV[b], vc = ENVV[c];
  let best = va > vb ? va : vb; if (vc > best) best = vc;
  if (SUITI[a] === SUITI[b] && 20 + va + vb > best) best = 20 + va + vb;
  if (SUITI[a] === SUITI[c] && 20 + va + vc > best) best = 20 + va + vc;
  if (SUITI[b] === SUITI[c] && 20 + vb + vc > best) best = 20 + vb + vc;
  return best;
}
function flor3(a, b, c) {
  if (SUITI[a] !== SUITI[b] || SUITI[a] !== SUITI[c]) return -1;
  return 20 + ENVV[a] + ENVV[b] + ENVV[c];
}
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ═════════════════════════════════════════════════════════════
// 2. OBSERVACIÓN: lo que ve legítimamente un asiento
// ═════════════════════════════════════════════════════════════

function observe(st, seat) {
  const opp = 1 - seat;
  const me = st.players[seat];
  const A = [], B = [], bit = [], cnt = [], side0 = [];
  const map = new Map();
  const reg = (qc) => {
    let p = map.get(qc.pairId);
    if (p === undefined) {
      p = A.length; map.set(qc.pairId, p);
      A.push(cid(qc.options[0])); B.push(cid(qc.options[1]));
      bit.push(-1); cnt.push(0); side0.push(qc.idxInPair);
    }
    cnt[p]++;
    if (qc.collapsedTo) bit[p] = cid(qc.collapsedTo) === A[p] ? qc.idxInPair : 1 - qc.idxInPair;
    return { p, side: qc.idxInPair };
  };
  const hand = me.hand.map(reg);
  const myPlayed = me.played.map(reg);
  // Del rival solo se miran las cartas que ya jugó (son públicas).
  const oppPlayed = st.players[opp].played.map(reg);

  const used = new Array(40).fill(false);
  for (let p = 0; p < A.length; p++) { used[A[p]] = true; used[B[p]] = true; }
  const rest = [];
  for (let i = 0; i < 40; i++) if (!used[i]) rest.push(i);
  // Parejas de cartas vistas que no sabemos dónde están (mazo o mano rival).
  const unloc = [];
  for (let p = 0; p < A.length; p++) if (cnt[p] === 1) unloc.push({ p, side: 1 - side0[p] });

  const myTeam = teamOf(seat);
  let n = 0, w = 0, l = 0, first = 0;
  for (const tw of st.trickWinners) {
    const r = tw === myTeam ? 1 : tw === -1 ? 0 : -1;
    n++; if (r > 0) w++; else if (r < 0) l++;
    if (first === 0 && r !== 0) first = r;
  }
  const pt = st.playsThisTrick || {};
  const myTable = pt[seat] ? myPlayed[myPlayed.length - 1] : null;
  const oppTable = pt[opp] ? oppPlayed[oppPlayed.length - 1] : null;
  const nextSeat = st.pendingChant ? st.playOrder[st.playOrderIdx] : st.activeSeat;

  return {
    A, B, bit, hand, myPlayed, oppPlayed, rest, unloc,
    my3: hand.concat(myPlayed),
    oppHidden: 3 - oppPlayed.length,
    n, w, l, first,
    myTable, oppTable,
    nextMe: nextSeat === seat,
    manoMe: teamOf(st.manoSeat) === myTeam,
  };
}

const idOf = (c, A, B, bits) => (c.side === bits[c.p] ? A[c.p] : B[c.p]);
// Probabilidad de ganarle a una carta cualquiera, vista por su dueño.
function cardQ(c, A, B, bits) {
  const b = bits[c.p];
  if (b >= 0) return PCT[POW[c.side === b ? A[c.p] : B[c.p]]];
  return (PCT[POW[A[c.p]]] + PCT[POW[B[c.p]]]) / 2;
}
function cardEP(c, A, B, bits) {
  const b = bits[c.p];
  if (b >= 0) return POW[c.side === b ? A[c.p] : B[c.p]];
  return (POW[A[c.p]] + POW[B[c.p]]) / 2;
}

// Sortea una mano rival compatible con lo que se ve.
function drawSample(o, rng) {
  const A = o.A.slice(), B = o.B.slice(), bits = o.bit.slice();
  const K = o.unloc.slice(), rest = o.rest.slice();
  const hid = [];
  const take = () => {
    const i = Math.floor(rng() * rest.length);
    const x = rest[i]; rest[i] = rest[rest.length - 1]; rest.pop();
    return x;
  };
  for (let j = 0; j < o.oppHidden; j++) {
    const r = Math.floor(rng() * (K.length + rest.length));
    if (r < K.length) { hid.push(K[r]); K[r] = K[K.length - 1]; K.pop(); }
    else {
      const x = take(), y = take();
      const p = A.length; A.push(x); B.push(y); bits.push(-1);
      hid.push({ p, side: 0 }); K.push({ p, side: 1 });
    }
  }
  return { A, B, bits, hid, opp: o.oppPlayed.concat(hid), wt: 1, we: 1 };
}

function unknownPairs(cards, bits) {
  const out = [];
  for (const c of cards) if (bits[c.p] < 0 && out.indexOf(c.p) < 0) out.push(c.p);
  return out;
}

// Envido de una muestra: lo que espera el rival de su mano y quién gana.
function evalEnv(o, s, rng) {
  const { A, B } = s;
  const tb = s.bits.slice();
  const up = unknownPairs(s.opp, tb);
  let sum = 0;
  const tot = 1 << up.length;
  for (let m = 0; m < tot; m++) {
    for (let i = 0; i < up.length; i++) tb[up[i]] = (m >> i) & 1;
    sum += env3(idOf(s.opp[0], A, B, tb), idOf(s.opp[1], A, B, tb), idOf(s.opp[2], A, B, tb));
  }
  s.omu = sum / tot;
  const all = unknownPairs(o.my3.concat(s.opp), s.bits);
  let win = 0;
  const D = 3;
  for (let d = 0; d < D; d++) {
    for (const p of all) tb[p] = rng() < 0.5 ? 0 : 1;
    const me = env3(idOf(o.my3[0], A, B, tb), idOf(o.my3[1], A, B, tb), idOf(o.my3[2], A, B, tb));
    const op = env3(idOf(s.opp[0], A, B, tb), idOf(s.opp[1], A, B, tb), idOf(s.opp[2], A, B, tb));
    win += me > op ? 1 : me < op ? 0 : (o.manoMe ? 1 : 0);
  }
  s.win = win / D;
}

// Datos propios: envido esperado y chance de flor (enumeración exacta).
function myStats(o) {
  const tb = o.bit.slice();
  const up = unknownPairs(o.my3, tb);
  const tot = 1 << up.length;
  let mu = 0, fl = 0;
  for (let m = 0; m < tot; m++) {
    for (let i = 0; i < up.length; i++) tb[up[i]] = (m >> i) & 1;
    const a = idOf(o.my3[0], o.A, o.B, tb), b = idOf(o.my3[1], o.A, o.B, tb), c = idOf(o.my3[2], o.A, o.B, tb);
    mu += env3(a, b, c);
    if (flor3(a, b, c) >= 0) fl++;
  }
  return { mu: mu / tot, pFlor: fl / tot };
}

// ═════════════════════════════════════════════════════════════
// 3. TRUCO: expectimax sobre las bazas que faltan
// ═════════════════════════════════════════════════════════════
// Para una mano rival sorteada, las dos manos (cuánticas) se suponen
// conocidas y el azar es el colapso de cada par al resolverse la baza.
// Devuelve la probabilidad de ganar la mano de truco.

let _PA, _PB, _BT, _mP, _mS, _oP, _oS, _MANO;

function _after(r, mMask, oMask, n, w, l, first) {
  n++;
  if (r > 0) w++; else if (r < 0) l++;
  if (first === 0 && r !== 0) first = r;
  if (w >= 2) return 1;
  if (l >= 2) return 0;
  if (n >= 3 || (n - w - l >= 1 && (w >= 1 || l >= 1))) return first > 0 ? 1 : first < 0 ? 0 : (_MANO ? 1 : 0);
  return _node(mMask, oMask, n, w, l, first, r > 0 ? true : r < 0 ? false : _MANO);
}

function _resolve(cm, co, mMask, oMask, n, w, l, first) {
  const pm = _mP[cm], po = _oP[co];
  const bm0 = _BT[pm];
  let total = 0, count = 0;
  for (let bm = 0; bm < 2; bm++) {
    if (bm0 >= 0 && bm !== bm0) continue;
    _BT[pm] = bm;
    const bo0 = _BT[po];
    for (let bo = 0; bo < 2; bo++) {
      if (bo0 >= 0 && bo !== bo0) continue;
      _BT[po] = bo;
      const a = _mS[cm] === bm ? _PA[pm] : _PB[pm];
      const b = _oS[co] === bo ? _PA[po] : _PB[po];
      total += _after(a > b ? 1 : a < b ? -1 : 0, mMask, oMask, n, w, l, first);
      count++;
    }
    _BT[po] = bo0;
  }
  _BT[pm] = bm0;
  return total / count;
}

function _node(mMask, oMask, n, w, l, first, leadMe) {
  if (leadMe) {
    let best = -1;
    for (let i = 0; i < _mP.length; i++) {
      if (!(mMask & (1 << i))) continue;
      let worst = 2;
      for (let j = 0; j < _oP.length; j++) {
        if (!(oMask & (1 << j))) continue;
        const v = _resolve(i, j, mMask ^ (1 << i), oMask ^ (1 << j), n, w, l, first);
        if (v < worst) { worst = v; if (worst <= best) break; }
      }
      if (worst > best) best = worst;
    }
    return best;
  }
  let worst = 2;
  for (let j = 0; j < _oP.length; j++) {
    if (!(oMask & (1 << j))) continue;
    let best = -1;
    for (let i = 0; i < _mP.length; i++) {
      if (!(mMask & (1 << i))) continue;
      const v = _resolve(i, j, mMask ^ (1 << i), oMask ^ (1 << j), n, w, l, first);
      if (v > best) { best = v; if (best >= worst) break; }
    }
    if (best < worst) worst = best;
  }
  return worst;
}

function evalTruco(o, s) {
  const np = s.A.length;
  _PA = new Array(np); _PB = new Array(np);
  for (let p = 0; p < np; p++) { _PA[p] = POW[s.A[p]]; _PB[p] = POW[s.B[p]]; }
  _BT = s.bits.slice();
  _mP = []; _mS = []; _oP = []; _oS = [];
  for (const c of o.hand) { _mP.push(c.p); _mS.push(c.side); }
  let myT = -1, opT = -1;
  if (o.myTable) { myT = _mP.length; _mP.push(o.myTable.p); _mS.push(o.myTable.side); }
  for (const c of s.hid) { _oP.push(c.p); _oS.push(c.side); }
  if (o.oppTable) { opT = _oP.length; _oP.push(o.oppTable.p); _oS.push(o.oppTable.side); }
  _MANO = o.manoMe;
  const { n, w, l, first } = o;
  const mAll = (1 << o.hand.length) - 1, oAll = (1 << s.hid.length) - 1;
  let v;
  s.cv = null;
  if (o.nextMe) {
    s.cv = [];
    v = -1;
    for (let i = 0; i < o.hand.length; i++) {
      let val;
      if (opT >= 0) val = _resolve(i, opT, mAll ^ (1 << i), oAll, n, w, l, first);
      else {
        val = 2;
        for (let j = 0; j < s.hid.length; j++) {
          const x = _resolve(i, j, mAll ^ (1 << i), oAll ^ (1 << j), n, w, l, first);
          if (x < val) val = x;
        }
      }
      s.cv.push(val);
      if (val > v) v = val;
    }
  } else if (myT >= 0) {
    v = 2;
    for (let j = 0; j < s.hid.length; j++) {
      const x = _resolve(myT, j, mAll, oAll ^ (1 << j), n, w, l, first);
      if (x < v) v = x;
    }
  } else {
    v = _node(mAll, oAll, n, w, l, first, false);
  }
  s.v = v;

  // Qué tan fuerte se ve el rival a sí mismo (sirve para ordenar su rango).
  const qs = [];
  for (const c of s.hid) qs.push(cardQ(c, s.A, s.B, s.bits));
  if (o.oppTable) qs.push(cardQ(o.oppTable, s.A, s.B, s.bits));
  qs.sort((a, b) => b - a);
  s.os = strength(qs, n, l, w, first === 0 ? 0 : -first);
}

// Fuerza heurística de las cartas sin resolver (qs ordenado de mayor a menor)
// para quien ganó `won` bazas y perdió `lost`.
function strength(qs, n, won, lost, firstMine) {
  const q1 = qs[0] || 0, q2 = qs[1] || 0, q3 = qs[2] || 0;
  if (n === 0) return (q1 + q2) * 0.425 + q3 * 0.15;
  if (n === 1) {
    if (won === 1) return 1 - (1 - q1) * (1 - q2) * 0.9;
    if (lost === 1) return q1 * q2;
    return q1;
  }
  return firstMine > 0 ? 0.3 + 0.7 * q1 : q1 * 0.8;
}

// ═════════════════════════════════════════════════════════════
// 4. UTILIDAD: puntos o probabilidad de ganar la partida
// ═════════════════════════════════════════════════════════════

const _wTables = {};
const HAND_DIST = [[1, 0.34], [2, 0.30], [3, 0.16], [4, 0.10], [5, 0.05], [6, 0.03], [8, 0.02]];
// edge: probabilidad de llevarse cada mano (algo más de 0.5: quien se
// sabe mejor prefiere muchas manos chicas a una sola moneda al aire).
const EDGE = 0.56;
function matchTable(T) {
  if (_wTables[T]) return _wTables[T];
  const W = [];
  for (let a = 0; a <= T; a++) W.push(new Array(T + 1).fill(0));
  const at = (a, b) => (a >= T ? 1 : b >= T ? 0 : W[a][b]);
  for (let a = T - 1; a >= 0; a--) {
    for (let b = T - 1; b >= 0; b--) {
      let v = 0;
      for (const [k, pr] of HAND_DIST) v += pr * (EDGE * at(a + k, b) + (1 - EDGE) * at(a, b + k));
      W[a][b] = v;
    }
  }
  _wTables[T] = W;
  return W;
}

function makeU(st, seat, kind) {
  const T = st.target, my = teamOf(seat);
  const hc = st.handChant || [0, 0];
  const me0 = st.scores[my] + hc[my], op0 = st.scores[1 - my] + hc[1 - my];
  if (kind === 'match') {
    const W = matchTable(T);
    return (a, b) => {
      const x = me0 + a, y = op0 + b;
      if (x >= T) return 1;
      if (y >= T) return 0;
      return W[x][y];
    };
  }
  if (kind === 'cap') return (a, b) => Math.min(T, me0 + a) - Math.min(T, op0 + b);
  return (a, b) => a - b;
}

// ═════════════════════════════════════════════════════════════
// 5. MEMORIA: modelo del rival (solo hechos públicos)
// ═════════════════════════════════════════════════════════════

function freshHand() {
  return { handNum: -1, trucoPend: 0, envPend: 0, oppTruco: false };
}
export function aiNewMemory() {
  return {
    hands: 0,
    tFaced: [null, { n: 0, fold: 0 }, { n: 0, fold: 0 }, { n: 0, fold: 0 }],
    tOpp: { calls: 0 },
    tShow: { n: 0, lost: 0 },
    eFaced: { n: 0, fold: 0, raise: 0 },
    eOpen: { n: 0, open: 0 },
    h: freshHand(),
  };
}

function memSync(mem, st, seat) {
  if (mem.h.handNum !== st.handNum) { mem.h = freshHand(); mem.h.handNum = st.handNum; }
  const h = mem.h, opp = 1 - seat, my = teamOf(seat), pc = st.pendingChant;
  if (h.trucoPend) {
    const L = h.trucoPend;
    if (pc && pc.type === 'truco' && pc.callerSeat === opp && pc.data.level === L + 1) { mem.tFaced[L].n++; mem.tFaced[L].raise = (mem.tFaced[L].raise || 0) + 1; h.trucoPend = 0; }
    else if (st.bet.level >= L && st.bet.lastRaiserTeam === my) { mem.tFaced[L].n++; h.trucoPend = 0; }
  }
  if (pc && pc.type === 'truco' && pc.callerSeat === opp) h.oppTruco = true;
  if (h.envPend) {
    const env = st.chant.envido;
    if (pc && pc.type === 'envido' && pc.responderSeat === seat && env.calls.length > h.envPend) {
      mem.eFaced.n++; mem.eFaced.raise++; h.envPend = 0;
    } else if (env.resolved) {
      mem.eFaced.n++;
      if (!env.accepted && env.calls.length > 0) mem.eFaced.fold++;
      h.envPend = 0;
    }
  }
}

function memNote(mem, st, a) {
  const h = mem.h;
  if (a.type === 'truco') h.trucoPend = st.bet.level + 1;
  else if (a.type === 'raise_truco') h.trucoPend = st.pendingChant.data.level + 1;
  else if (a.type === 'envido' || a.type === 'envido_first') h.envPend = 1;
  else if (a.type === 'respond_envido' && a.action !== 'accept' && a.action !== 'reject') h.envPend = st.chant.envido.calls.length + 1;
}

// Al terminar la mano: actualizar frecuencias del rival.
export function aiMemRecordHand(mem, st, seat) {
  if (!mem || !st) return;
  if (mem.h.handNum !== st.handNum) return; // la IA no llegó a actuar en esta mano
  memSync(mem, st, seat);
  const h = mem.h, my = teamOf(seat), opp = 1 - seat;
  if (h.trucoPend && st.bet.level < h.trucoPend) {
    const f = mem.tFaced[h.trucoPend]; f.n++; f.fold++;
  }
  mem.hands++;
  if (h.oppTruco) {
    mem.tOpp.calls++;
    const tw = st.trickWinners;
    const w0 = tw.filter(x => x === 0).length, w1 = tw.filter(x => x === 1).length, np = tw.filter(x => x === -1).length;
    const over = w0 >= 2 || w1 >= 2 || tw.length >= 3 || (np >= 1 && (w0 >= 1 || w1 >= 1));
    if (over && st.bet.level > 0) {
      const non = tw.filter(x => x !== -1);
      const winner = w0 >= 2 ? 0 : w1 >= 2 ? 1 : non.length ? non[0] : teamOf(st.manoSeat);
      mem.tShow.n++;
      if (winner === my) mem.tShow.lost++;
    }
  }
  mem.eOpen.n++;
  if (st.chant.envido.callerSeat === opp) mem.eOpen.open++;
  mem.h = freshHand();
}

const TF_PRIOR = [0, 0.38, 0.25, 0.20];
function foldTruco(mem, L) {
  const f = mem.tFaced[L];
  return clamp((f.fold + TF_PRIOR[L] * 6) / (f.n + 6), 0.05, 0.9);
}
function raiseTruco_(mem, L) {
  const f = mem.tFaced[L];
  return clamp(((f.raise || 0) + (L === 1 ? 0.2 : 0.15) * 6) / (f.n + 6), 0.03, 0.6);
}
function oppTrucoFreq(mem) { return clamp((mem.tOpp.calls + 0.35 * 5) / (mem.hands + 5), 0.12, 0.85); }
function oppBluffW(mem) {
  const rate = (mem.tShow.lost + 0.3 * 4) / (mem.tShow.n + 4);
  return clamp(0.2 + (rate - 0.3) * 1.2, 0.08, 0.6);
}
function foldEnvido(mem, call, tot) {
  const base = (mem.eFaced.fold + 0.42 * 6) / (mem.eFaced.n + 6);
  const add = call === 'falta envido' ? 0.12 + (tot >= 8 ? 0.1 : 0) : call === 'real envido' ? 0.06 : 0;
  return clamp(base + add, 0.05, 0.9);
}
function oppEnvFreq(mem) { return clamp((mem.eOpen.open + 0.35 * 6) / (mem.eOpen.n + 6), 0.1, 0.85); }

// ═════════════════════════════════════════════════════════════
// 6. CONTEXTO Y MODELOS POR DECISIÓN
// ═════════════════════════════════════════════════════════════

const PROF = {
  medium: { name: 'El Pibe', kind: 'pibe', util: 'lin' },
  hard:   { name: 'Citadino', kind: 'cita', util: 'lin', nT: 14, nEnv: 70, cond: false, temp: 0 },
  expert: { name: 'Gaucho', kind: 'ev', util: 'cap', nT: 16, nEnv: 100, cond: true, temp: 0, margin: 0.10, greedy: true },
  legend: { name: 'El Duende', kind: 'ev', util: 'match', nT: 36, nEnv: 160, cond: true, temp: 0.05, margin: 0.05, mix: true, deep: true },
};

function makeCtx(st, seat, level, mem, rng) {
  const prof = PROF[level] || PROF.medium;
  const ctx = { st, seat, opp: 1 - seat, team: teamOf(seat), o: observe(st, seat), prof, mem, rng, S: [] };
  ctx.U = makeU(st, seat, prof.util);
  ctx.U0 = ctx.U(0, 0);
  ctx.sc = Math.max((ctx.U(1, 0) - ctx.U(0, 1)) / 2, 1e-4);
  ctx.my = myStats(ctx.o);
  return ctx;
}
function samples(ctx, n) {
  while (ctx.S.length < n) ctx.S.push(drawSample(ctx.o, ctx.rng));
  return ctx.S;
}

function trucoModel(ctx) {
  if (ctx._t) return ctx._t;
  const { st, o, mem, prof } = ctx;
  const S = samples(ctx, prof.nT).slice(0, prof.nT);
  for (const s of S) { if (s.v === undefined) evalTruco(o, s); s.wt = 1; }
  const N = S.length;
  // Orden del rango rival: su propia fuerza y, en parte, cómo le va contra mí.
  // (El Gaucho ordena solo por la fuerza propia del rival.)
  for (const s of S) s.rk = prof.deep ? s.os * 0.6 + (1 - s.v) * 0.4 : s.os;
  const asc = S.map((_, i) => i).sort((a, b) => S[a].rk - S[b].rk);
  if (prof.cond) {
    const pc = st.pendingChant, lvl = st.bet.level, oppTeam = 1 - ctx.team;
    let q = 0, low = 0.15;
    // Rango de quien canta: el truco inicial según su frecuencia; un retruco
    // o vale cuatro, mucho más cerrado (el Duende lo lee más fino).
    const range = (L) => {
      if (L === 1) { q = oppTrucoFreq(mem); low = oppBluffW(mem); }
      else if (prof.deep) { q = clamp(raiseTruco_(mem, L - 1) * (L === 2 ? 0.8 : 0.67), 0.08, 0.5); low = oppBluffW(mem) * 0.25; }
      else { q = 0.3; low = oppBluffW(mem) * 0.5; }
    };
    if (pc && pc.type === 'truco' && pc.callerSeat === ctx.opp) range(pc.data.level);
    else if (lvl > 0 && st.bet.lastRaiserTeam === oppTeam) range(lvl);
    else if (lvl > 0 && st.bet.lastRaiserTeam === ctx.team) { q = 1 - foldTruco(mem, lvl); low = 0.12; }
    if (q > 0) {
      const cut = Math.min(N - 2, Math.round(N * (1 - q)));
      for (let k = 0; k < N; k++) S[asc[k]].wt = k >= cut ? 1 : low;
    }
  }
  let W = 0, pv = 0;
  const cv = o.nextMe ? new Array(o.hand.length).fill(0) : null;
  for (const s of S) {
    W += s.wt; pv += s.wt * s.v;
    if (cv) for (let i = 0; i < cv.length; i++) cv[i] += s.wt * s.cv[i];
  }
  if (cv) for (let i = 0; i < cv.length; i++) cv[i] /= W;
  const U = ctx.U;
  const T = {
    p: pv / W, cv,
    show: (n) => { let e = 0; for (const s of S) e += s.wt * (s.v * U(n, 0) + (1 - s.v) * U(0, n)); return e / W; },
    // Canto que el rival no quiere (cobro c) en la parte floja de su rango,
    // o quiere (se juega por n) en el resto.
    // Con n2 > 0 además se prevé que lo mejor de su rango (fracción r)
    // contesta subiendo a n2, y ahí habrá que elegir entre irse o pagar.
    call: (c, n, f, n2 = 0, r = 0) => {
      let e = 0, cum = 0, accA = 0, rejA = 0;
      for (let k = 0; k < N; k++) {
        const s = S[asc[k]];
        const mid = cum + s.wt / 2; cum += s.wt;
        if (mid < f * W) e += s.wt * U(c, 0);
        else if (n2 > 0 && mid >= (1 - r) * W) {
          accA += s.wt * (s.v * U(n2, 0) + (1 - s.v) * U(0, n2));
          rejA += s.wt * U(0, n);
        } else e += s.wt * (s.v * U(n, 0) + (1 - s.v) * U(0, n));
      }
      return (e + Math.max(accA, rejA)) / W;
    },
  };
  ctx._t = T;
  return T;
}

function oppPassedEnvido(ctx) {
  const { st } = ctx, pc = st.pendingChant;
  return st.chant.envido.calls.length === 0 && st.trickIdx === 0
    && (!!(st.playsThisTrick && st.playsThisTrick[ctx.opp]) || !!(pc && pc.type === 'truco' && pc.callerSeat === ctx.opp));
}

function envModel(ctx) {
  if (ctx._e) return ctx._e;
  const { st, o, mem, prof } = ctx;
  const env = st.chant.envido;
  const S = samples(ctx, prof.nEnv).slice(0, prof.nEnv);
  for (const s of S) { if (s.win === undefined) evalEnv(o, s, ctx.rng); s.we = 1; }
  const N = S.length;
  const asc = S.map((_, i) => i).sort((a, b) => S[a].omu - S[b].omu);
  const gE = oppEnvFreq(mem);
  const passed = oppPassedEnvido(ctx);
  if (prof.cond) {
    let q = 0;
    env.calls.forEach((c, i) => {
      const by = i % 2 === 0 ? env.callerSeat : 1 - env.callerSeat;
      if (by !== ctx.opp) return;
      const qq = c === 'falta envido' ? 0.15 : c === 'real envido' ? 0.25 : i === 0 ? gE : 0.3;
      q = q ? Math.min(q, qq) : qq;
    });
    if (q > 0) {
      const cut = Math.round(N * (1 - q));
      for (let k = 0; k < N; k++) S[asc[k]].we = k >= cut ? 1 : 0.15;
    } else if (passed) {
      const cut = Math.round(N * (1 - gE));
      for (let k = 0; k < N; k++) S[asc[k]].we = k >= cut ? 0.3 : 1;
    }
  }
  let W = 0, pw = 0;
  for (const s of S) { W += s.we; pw += s.we * s.win; }
  const U = ctx.U, T = st.target, sco = st.scores;
  const E = {
    pWin: pw / W, passed, gE,
    accept: (tot) => { let e = 0; for (const s of S) e += s.we * (s.win * U(tot, 0) + (1 - s.win) * U(0, tot)); return e / W; },
    // Valor de cantar/subir dejando la lista de cantos en `calls`.
    call: (calls) => {
      const tot = envidoTotalIfAccepted(calls, 0, T, sco), rej = envidoPointsIfRejected(calls, 0, T, sco);
      const f = foldEnvido(mem, calls[calls.length - 1], tot);
      const ups = envidoCanRaise(calls);
      const r = ups.length ? 0.12 : 0;
      let tot2 = 0, rej2 = 0;
      if (ups.length) {
        const c2 = calls.concat([ups[0]]);
        tot2 = envidoTotalIfAccepted(c2, 0, T, sco); rej2 = envidoPointsIfRejected(c2, 0, T, sco);
      }
      let e = 0, cum = 0, accA = 0, rejA = 0;
      for (let k = 0; k < N; k++) {
        const s = S[asc[k]];
        const mid = cum + s.we / 2; cum += s.we;
        if (mid < f * W) e += s.we * U(rej, 0);
        else if (r > 0 && mid >= (1 - r) * W) {
          accA += s.we * (s.win * U(tot2, 0) + (1 - s.win) * U(0, tot2));
          rejA += s.we * U(0, rej2);
        } else e += s.we * (s.win * U(tot, 0) + (1 - s.win) * U(0, tot));
      }
      return (e + Math.max(accA, rejA)) / W;
    },
    // Valor de no cantar: puede que cante el rival después.
    none: (first) => {
      if (first || passed) return ctx.U0;
      const cut = Math.round(N * (1 - gE));
      let a = 0, c = 0;
      for (let k = cut; k < N; k++) { const s = S[asc[k]]; a += s.win * U(2, 0) + (1 - s.win) * U(0, 2); c++; }
      if (!c) return ctx.U0;
      return (1 - gE) * ctx.U0 + gE * Math.max(a / c, U(0, 1));
    },
  };
  ctx._e = E;
  return E;
}

// Flor: manos rivales con alguna chance de flor y cómo sale el cruce.
function florModel(ctx) {
  if (ctx._f) return ctx._f;
  const { o, rng } = ctx;
  const list = [];
  for (let t = 0; t < 500 && list.length < 40; t++) {
    const s = drawSample(o, rng);
    const { A, B } = s;
    const tb = s.bits.slice();
    const up = unknownPairs(s.opp, tb);
    const tot = 1 << up.length;
    let fl = 0;
    for (let m = 0; m < tot; m++) {
      for (let i = 0; i < up.length; i++) tb[up[i]] = (m >> i) & 1;
      if (flor3(idOf(s.opp[0], A, B, tb), idOf(s.opp[1], A, B, tb), idOf(s.opp[2], A, B, tb)) >= 0) fl++;
    }
    if (!fl) continue;
    const pfo = fl / tot;
    const all = unknownPairs(o.my3.concat(s.opp), s.bits);
    let meWin = 0, oppWin = 0, oppValid = 0;
    const D = 8;
    for (let d = 0; d < D; d++) {
      for (const p of all) tb[p] = rng() < 0.5 ? 0 : 1;
      const me = flor3(idOf(o.my3[0], A, B, tb), idOf(o.my3[1], A, B, tb), idOf(o.my3[2], A, B, tb));
      const op = flor3(idOf(s.opp[0], A, B, tb), idOf(s.opp[1], A, B, tb), idOf(s.opp[2], A, B, tb));
      if (op >= 0) oppValid++;
      if (me >= 0 && (op < 0 || me > op || (me === op && o.manoMe))) meWin++;
      else if (op >= 0) oppWin++;
    }
    list.push({ w: pfo >= 0.5 ? 1 : 0.3, pfo, meWin: meWin / D, oppWin: oppWin / D, oppValid: oppValid / D });
  }
  ctx._f = list;
  return list;
}

function softPick(opts, temp, rng) {
  let best = opts[0];
  for (const o of opts) if (o.ev > best.ev) best = o;
  if (!(temp > 0)) return best;
  let tot = 0;
  for (const o of opts) { o._w = Math.exp((o.ev - best.ev) / temp); tot += o._w; }
  let r = rng() * tot;
  for (const o of opts) { r -= o._w; if (r <= 0) return o; }
  return best;
}

// ═════════════════════════════════════════════════════════════
// 7. NIVELES
// ═════════════════════════════════════════════════════════════

const TNAME = (L) => TRUCO_LEVELS[L].name.toLowerCase();

// ── Jugadas de carta comunes ─────────────────────────────────

// Probabilidad exacta de ganar/empatar la baza con la carta c contra la de la mesa.
function trickProb(o, c, t) {
  const tb = o.bit.slice();
  const up = unknownPairs([c, t], tb);
  const tot = 1 << up.length;
  let win = 0, tie = 0;
  for (let m = 0; m < tot; m++) {
    for (let i = 0; i < up.length; i++) tb[up[i]] = (m >> i) & 1;
    const a = POW[idOf(c, o.A, o.B, tb)], b = POW[idOf(t, o.A, o.B, tb)];
    if (a > b) win++; else if (a === b) tie++;
  }
  return { win: win / tot, tie: tie / tot };
}

function handByQ(o) {
  return o.hand.map((c, i) => ({ i, q: cardQ(c, o.A, o.B, o.bit), ep: cardEP(c, o.A, o.B, o.bit) })).sort((a, b) => a.q - b.q);
}

// ── EL PIBE: cuentas simples con el valor esperado de cada carta ──

function pibeStrength(ctx) {
  const o = ctx.o;
  const cards = o.myTable ? o.hand.concat([o.myTable]) : o.hand;
  const qs = cards.map(c => cardQ(c, o.A, o.B, o.bit)).sort((a, b) => b - a);
  const q1 = qs[0] || 0, q2 = qs[1] || 0;
  let s;
  if (o.n === 0) s = (q1 + q2) / 2;
  else if (o.n === 1) s = o.w === 1 ? 0.45 + 0.55 * q1 : o.l === 1 ? q1 * q2 + 0.1 : q1;
  else s = q1;
  return s + (ctx.rng() - 0.5) * 0.24;
}

function pibePlay(ctx) {
  const o = ctx.o;
  const byQ = handByQ(o);
  if (ctx.rng() < 0.1) return { type: 'play', idx: byQ[Math.floor(ctx.rng() * byQ.length)].i, why: 'Juega' };
  if (o.oppTable) {
    const tep = cardEP(o.oppTable, o.A, o.B, o.bit);
    for (const h of byQ) if (h.ep > tep) return { type: 'play', idx: h.i, why: 'Juega para ganar la baza' };
    return { type: 'play', idx: byQ[0].i, why: 'Tira la más baja' };
  }
  return { type: 'play', idx: byQ[byQ.length - 1].i, why: 'Sale con la más alta' };
}

function pibe(ctx) {
  const { st, seat, o, rng } = ctx;
  const pc = st.pendingChant;
  const mu = ctx.my.mu + (rng() - 0.5) * 4, pF = ctx.my.pFlor;
  if (pc) {
    if (pc.type === 'truco') {
      const L = pc.data.level;
      if (canEnvidoFirst(st) && mu >= 21.5) return { type: 'envido_first', call: 'envido', why: 'El envido está primero' };
      const s = pibeStrength(ctx);
      if (L < 3 && s >= 0.86) return { type: 'raise_truco', why: `Se agranda: ${TNAME(L + 1)}` };
      const need = [0, 0.50, 0.60, 0.70][L];
      return { type: 'respond_truco', accept: s >= need, why: s >= need ? 'Quiere' : 'No quiere' };
    }
    if (pc.type === 'envido') {
      const calls = st.chant.envido.calls;
      if (canFlorOverEnvido(st) && pF >= 0.5) return { type: 'flor_over_envido', why: 'Contesta con flor' };
      const ups = envidoCanRaise(calls);
      const last = calls[calls.length - 1];
      if (mu >= 25.5 && ups.length && last !== 'real envido') return { type: 'respond_envido', action: ups[0], why: 'Sube el envido' };
      const need = last === 'falta envido' ? 24 : last === 'real envido' ? 21 : 18 + 1.5 * (calls.length - 1);
      return { type: 'respond_envido', action: mu >= need ? 'accept' : 'reject', why: mu >= need ? 'Quiere el envido' : 'No quiere el envido' };
    }
    const stage = pc.data.stage;
    if (stage === 'initial') return { type: 'respond_flor', action: pF >= 0.5 ? 'yes' : 'no', why: pF >= 0.5 ? 'También canta flor' : 'Sin flor' };
    if (stage === 'contraflor') return { type: 'respond_flor', action: pF >= 1 ? 'contraflor' : 'simple', why: 'Flor' };
    return { type: 'respond_flor', action: pF >= 0.75 ? 'accept' : 'reject', why: 'Contraflor' };
  }
  if (canSingFlor(st, seat) && pF >= 0.5) return { type: 'flor', why: 'Canta flor' };
  if (canOpenEnvido(st, seat)) {
    if (mu >= 25) return { type: 'envido', call: 'real envido', why: 'Canta real envido' };
    if (mu >= 20.5) return { type: 'envido', call: 'envido', why: 'Canta envido' };
  }
  if (canTeamRaiseNow(st.bet, ctx.team) && st.bet.level < 3) {
    const s = pibeStrength(ctx);
    const need = [0.72, 0.8, 0.88][st.bet.level];
    if (s >= need || rng() < 0.03) return { type: 'truco', why: `Canta ${TNAME(st.bet.level + 1)}` };
  }
  return pibePlay(ctx);
}

// ── CITADINO: probabilidades bien calculadas, sin leer al rival ──

function citaPlay(ctx) {
  const o = ctx.o;
  const byQ = handByQ(o);
  if (o.oppTable) {
    const pr = byQ.map(h => ({ ...h, ...trickProb(o, o.hand[h.i], o.oppTable) }));
    for (const h of pr) if (h.win >= 0.5) return { type: 'play', idx: h.i, why: 'Gana la baza con lo justo' };
    if (o.l >= 1 || o.first < 0) {
      let b = pr[0];
      for (const h of pr) if (h.win + h.tie * 0.5 > b.win + b.tie * 0.5) b = h;
      if (b.win + b.tie > 0) return { type: 'play', idx: b.i, why: 'Se la juega' };
    }
    return { type: 'play', idx: pr[0].i, why: 'Guarda las buenas' };
  }
  const top = byQ[byQ.length - 1];
  if (o.n === 0 && byQ.length === 3 && top.q >= 0.93 && byQ[1].q >= 0.6) return { type: 'play', idx: byQ[1].i, why: 'Sale fuerte y guarda la mejor' };
  return { type: 'play', idx: top.i, why: 'Sale con la mejor' };
}

function cita(ctx) {
  const { st, seat, team } = ctx;
  const pc = st.pendingChant;
  const pF = ctx.my.pFlor;
  const T = st.target, myS = st.scores[team], opS = st.scores[1 - team];
  if (pc) {
    if (pc.type === 'truco') {
      const L = pc.data.level;
      if (canEnvidoFirst(st)) {
        const pw = envModel(ctx).pWin;
        if (pw >= 0.8) return { type: 'envido_first', call: 'real envido', why: 'El envido está primero' };
        if (pw >= 0.6) return { type: 'envido_first', call: 'envido', why: 'El envido está primero' };
      }
      const p = trucoModel(ctx).p;
      const c = TRUCO_LEVELS[L - 1].pts;
      const forced = opS + c >= T; // si no quiere, pierde la partida igual
      if (L < 3 && (p >= 0.82 || (forced && p >= 0.5))) return { type: 'raise_truco', why: `Sube a ${TNAME(L + 1)}` };
      const need = [0, 0.40, 0.48, 0.55][L];
      const ok = forced || p >= need;
      return { type: 'respond_truco', accept: ok, why: ok ? 'Quiere: le dan las cuentas' : 'No quiere' };
    }
    if (pc.type === 'envido') {
      const calls = st.chant.envido.calls;
      if (canFlorOverEnvido(st) && pF >= 0.5) return { type: 'flor_over_envido', why: 'Contesta con flor' };
      const pw = envModel(ctx).pWin;
      const tot = envidoTotalIfAccepted(calls, 0, T, st.scores), rej = envidoPointsIfRejected(calls, 0, T, st.scores);
      const ups = envidoCanRaise(calls);
      if (pw >= 0.82 && ups.length && ups[0] !== 'falta envido') return { type: 'respond_envido', action: ups[0], why: 'Sube el envido' };
      const need = (tot - rej) / (2 * tot) + 0.25;
      const ok = pw >= need || opS + rej >= T;
      return { type: 'respond_envido', action: ok ? 'accept' : 'reject', why: ok ? 'Quiere el envido' : 'No quiere el envido' };
    }
    const stage = pc.data.stage;
    if (stage === 'initial') return { type: 'respond_flor', action: pF >= 0.5 ? 'yes' : 'no', why: pF >= 0.5 ? 'También canta flor' : 'Sin flor' };
    if (stage === 'contraflor') return { type: 'respond_flor', action: pF >= 0.75 ? 'contraflor' : 'simple', why: 'Flor' };
    return { type: 'respond_flor', action: pF >= 0.5 ? 'accept' : 'reject', why: 'Contraflor' };
  }
  if (canSingFlor(st, seat) && (pF > 0.5 || (pF >= 0.5 && envModel(ctx).pWin < 0.55))) return { type: 'flor', why: 'Canta flor' };
  if (canOpenEnvido(st, seat)) {
    const pw = envModel(ctx).pWin;
    if (pw >= 0.9 && faltaEnvidoPoints(T, st.scores) <= 8) return { type: 'envido', call: 'falta envido', why: 'Canta falta envido' };
    if (pw >= 0.78) return { type: 'envido', call: 'real envido', why: 'Canta real envido' };
    if (pw >= 0.58) return { type: 'envido', call: 'envido', why: 'Canta envido' };
  }
  if (canTeamRaiseNow(st.bet, team) && st.bet.level < 3) {
    const p = trucoModel(ctx).p;
    if (p >= [0.66, 0.76, 0.86][st.bet.level]) return { type: 'truco', why: `Canta ${TNAME(st.bet.level + 1)}` };
  }
  return citaPlay(ctx);
}

// ── GAUCHO y DUENDE: valor esperado con modelo del rival ─────────

function evPlay(ctx) {
  const o = ctx.o;
  if (o.hand.length === 1) return { type: 'play', idx: 0, why: 'Juega' };
  const cv = trucoModel(ctx).cv;
  let best = 0;
  const q = o.hand.map(c => cardQ(c, o.A, o.B, o.bit));
  for (let i = 1; i < cv.length; i++) {
    if (cv[i] > cv[best] + 0.012 || (Math.abs(cv[i] - cv[best]) <= 0.012 && q[i] < q[best])) best = i;
  }
  return { type: 'play', idx: best, why: 'Juega' };
}

function florValue(ctx, p) { return p * ctx.U(3, 0) + (1 - p) * ctx.U(0, 3); }

// La falta puede valer la partida entera: solo se usa cuando es chica o
// cuando el tanteador lo pide (rival por cerrar, o muy abajo).
function faltaOk(ctx) {
  const { st, team } = ctx;
  const myS = st.scores[team], opS = st.scores[1 - team];
  return faltaEnvidoPoints(st.target, st.scores) <= 5 || opS >= st.target - 3 || myS <= opS - 7;
}

function evEnvidoOpen(ctx, first) {
  const E = envModel(ctx);
  const opts = [{ call: null, ev: E.none(first) + ctx.prof.margin * ctx.sc }];
  const fOk = faltaOk(ctx);
  for (const c of ['envido', 'real envido', 'falta envido']) {
    if (c === 'falta envido' && !fOk) continue;
    opts.push({ call: c, ev: E.call([c]) });
  }
  return opts;
}

// Valor de cantar (o subir) hasta el nivel L.
function trucoCallEV(ctx, T, L) {
  const c = TRUCO_LEVELS[L - 1].pts, n = TRUCO_LEVELS[L].pts;
  const f = foldTruco(ctx.mem, L);
  if (!ctx.prof.deep || L >= 3) return T.call(c, n, f);
  return T.call(c, n, f, TRUCO_LEVELS[L + 1].pts, raiseTruco_(ctx.mem, L));
}

function evTrucoInit(ctx) {
  const { st, o, mem, prof } = ctx;
  const L0 = st.bet.level;
  const T = trucoModel(ctx);
  const c = TRUCO_LEVELS[L0].pts, n = TRUCO_LEVELS[L0 + 1].pts;
  const pass = T.show(c), call = trucoCallEV(ctx, T, L0 + 1);
  const last = o.hand.length <= 1;
  const gain = (call - pass) / ctx.sc - (last ? 0 : prof.margin);
  let go = gain > 0;
  if (prof.mix) {
    let pr = 1 / (1 + Math.exp(-gain / prof.temp));
    if (T.p > 0.9 && !last && st.trickIdx === 0) pr *= 0.6; // a veces se hace el distraído
    go = ctx.rng() < pr;
  }
  if (!go) return null;
  return { type: 'truco', why: `Canta ${TNAME(L0 + 1)}` };
}

function evFlorStage(ctx, stage, data) {
  const { st, U, U0 } = ctx;
  const pF = ctx.my.pFlor;
  const F = florModel(ctx);
  if (stage === 'initial') {
    if (pF <= 0) return { type: 'respond_flor', action: 'no', why: 'Sin flor' };
    if (!F.length) return { type: 'respond_flor', action: pF >= 0.5 ? 'yes' : 'no', why: 'Flor' };
    let no = 0, yes = 0;
    for (const f of F) {
      no += f.w * (f.oppValid * U(0, 3) + (1 - f.oppValid) * U(3, 0));
      yes += f.w * (f.meWin * U(3, 0) + f.oppWin * U(0, 3) + (1 - f.meWin - f.oppWin) * U0);
    }
    return yes > no
      ? { type: 'respond_flor', action: 'yes', why: 'También canta flor' }
      : { type: 'respond_flor', action: 'no', why: 'No se suma a la flor' };
  }
  const falta = faltaEnvidoPoints(st.target, st.scores);
  if (stage === 'contraflor') {
    if (!F.length) return { type: 'respond_flor', action: pF >= 0.75 ? 'contraflor' : 'simple', why: 'Flor' };
    let simple = 0, contra = 0, resto = 0;
    for (const f of F) {
      const rest = 1 - f.meWin - f.oppWin;
      simple += f.w * (f.meWin * U(3, 0) + f.oppWin * U(0, 3) + rest * U0);
      contra += f.w * (f.pfo >= 0.45 ? f.meWin * U(6, 0) + f.oppWin * U(0, 6) + rest * U0 : U(4, 0));
      resto += f.w * (f.pfo >= 0.75 ? f.meWin * U(falta, 0) + f.oppWin * U(0, falta) + rest * U0 : U(6, 0));
    }
    const best = softPick([{ a: 'simple', ev: simple }, { a: 'contraflor', ev: contra }, { a: 'alresto', ev: resto - 0.3 * ctx.sc }], 0, ctx.rng);
    return { type: 'respond_flor', action: best.a, why: best.a === 'simple' ? 'Flor contra flor' : 'Va por la contraflor' };
  }
  // resp_contraflor
  const stake = data.alResto ? falta : 6, rej = data.alResto ? 6 : 4;
  if (!F.length) return { type: 'respond_flor', action: pF >= 0.5 ? 'accept' : 'reject', why: 'Contraflor' };
  let acc = 0, W = 0;
  for (const f of F) {
    const w = f.w * (f.pfo >= 0.5 ? 1 : 0.4);
    acc += w * (f.meWin * U(stake, 0) + f.oppWin * U(0, stake) + (1 - f.meWin - f.oppWin) * U0); W += w;
  }
  const ok = acc / W >= U(0, rej);
  return { type: 'respond_flor', action: ok ? 'accept' : 'reject', why: ok ? 'Quiere la contraflor' : 'No quiere la contraflor' };
}

function ev(ctx) {
  const { st, seat, team, prof, mem, U, rng } = ctx;
  const pc = st.pendingChant;
  const temp = prof.temp * ctx.sc;
  const pF = ctx.my.pFlor;
  if (pc) {
    if (pc.type === 'truco') {
      const L = pc.data.level;
      if (canEnvidoFirst(st)) {
        const best = softPick(evEnvidoOpen(ctx, true), temp, rng);
        if (best.call) return { type: 'envido_first', call: best.call, why: 'El envido está primero' };
      }
      const T = trucoModel(ctx);
      const c = TRUCO_LEVELS[L - 1].pts, n = TRUCO_LEVELS[L].pts;
      const opts = [
        { a: 'reject', ev: U(0, c) },
        { a: 'accept', ev: T.show(n) },
      ];
      if (L < 3) opts.push({ a: 'raise', ev: trucoCallEV(ctx, T, L + 1) - prof.margin * ctx.sc });
      const best = softPick(opts, temp, rng);
      if (best.a === 'raise') return { type: 'raise_truco', why: `Sube a ${TNAME(L + 1)}` };
      return { type: 'respond_truco', accept: best.a === 'accept', why: best.a === 'accept' ? 'Quiere' : 'No quiere' };
    }
    if (pc.type === 'envido') {
      const calls = st.chant.envido.calls;
      const E = envModel(ctx);
      const tot = envidoTotalIfAccepted(calls, 0, st.target, st.scores), rej = envidoPointsIfRejected(calls, 0, st.target, st.scores);
      const opts = [{ a: 'reject', ev: U(0, rej) }, { a: 'accept', ev: E.accept(tot) }];
      const fOk = faltaOk(ctx);
      for (const y of envidoCanRaise(calls)) {
        if (y === 'falta envido' && !fOk) continue;
        opts.push({ a: y, ev: E.call(calls.concat([y])) - prof.margin * ctx.sc });
      }
      if (canFlorOverEnvido(st)) opts.push({ a: 'flor', ev: florValue(ctx, pF) });
      const best = softPick(opts, temp, rng);
      if (best.a === 'flor') return { type: 'flor_over_envido', why: 'Contesta con flor' };
      const why = best.a === 'accept' ? 'Quiere el envido' : best.a === 'reject' ? 'No quiere el envido' : `Sube: ${best.a}`;
      return { type: 'respond_envido', action: best.a, why };
    }
    return evFlorStage(ctx, pc.data.stage, pc.data);
  }

  const canEnv = canOpenEnvido(st, seat);
  let envOpts = null;
  if (canSingFlor(st, seat)) {
    let alt = ctx.U0;
    if (canEnv) { envOpts = evEnvidoOpen(ctx, false); for (const o of envOpts) if (o.ev > alt) alt = o.ev; }
    if (florValue(ctx, pF) > alt + 0.05 * ctx.sc) return { type: 'flor', why: 'Canta flor' };
  }
  if (canEnv) {
    const best = softPick(envOpts || evEnvidoOpen(ctx, false), temp, rng);
    if (best.call) return { type: 'envido', call: best.call, why: `Canta ${best.call}` };
  }
  if (canTeamRaiseNow(st.bet, team) && st.bet.level < 3) {
    const a = evTrucoInit(ctx);
    if (a) return a;
  }
  return prof.greedy ? citaPlay(ctx) : evPlay(ctx);
}

// ═════════════════════════════════════════════════════════════
// 8. API PURA
// ═════════════════════════════════════════════════════════════

export function aiLegalActions(st, seat) {
  const out = [];
  if (!st || st.matchEnded) return out;
  const pc = st.pendingChant;
  if (pc) {
    if (pc.responderSeat !== seat) return out;
    if (pc.type === 'truco') {
      out.push({ type: 'respond_truco', accept: true }, { type: 'respond_truco', accept: false });
      if (pc.data.level < 3) out.push({ type: 'raise_truco' });
      if (canEnvidoFirst(st)) for (const c of ['envido', 'real envido', 'falta envido']) out.push({ type: 'envido_first', call: c });
    } else if (pc.type === 'envido') {
      out.push({ type: 'respond_envido', action: 'accept' }, { type: 'respond_envido', action: 'reject' });
      for (const c of envidoCanRaise(st.chant.envido.calls)) out.push({ type: 'respond_envido', action: c });
      if (canFlorOverEnvido(st)) out.push({ type: 'flor_over_envido' });
    } else if (pc.type === 'flor') {
      const acts = pc.data.stage === 'initial' ? ['yes', 'no'] : pc.data.stage === 'contraflor' ? ['simple', 'contraflor', 'alresto'] : ['accept', 'reject'];
      for (const a of acts) out.push({ type: 'respond_flor', action: a });
    }
    return out;
  }
  if (st.activeSeat !== seat || (st.phase !== 'chant' && st.phase !== 'play')) return out;
  const n = st.players[seat].hand.length;
  for (let i = 0; i < n; i++) out.push({ type: 'play', idx: i });
  if (canTeamRaiseNow(st.bet, teamOf(seat)) && st.bet.level < 3) out.push({ type: 'truco' });
  if (canOpenEnvido(st, seat)) for (const c of ['envido', 'real envido', 'falta envido']) out.push({ type: 'envido', call: c });
  if (canSingFlor(st, seat)) out.push({ type: 'flor' });
  out.push({ type: 'mazo' });
  return out;
}

function sameAction(a, b) {
  return a.type === b.type && a.idx === b.idx && a.call === b.call && a.action === b.action && a.accept === b.accept;
}

// Decide la jugada de `seat` con el nivel dado. Siempre devuelve una acción
// legal (o null si no le toca).
export function aiDecide(st, seat, level, mem, rng = Math.random) {
  const legal = aiLegalActions(st, seat);
  if (!legal.length) return null;
  if (!mem) mem = aiNewMemory();
  memSync(mem, st, seat);
  let a = null;
  try {
    const ctx = makeCtx(st, seat, level, mem, rng);
    a = ctx.prof.kind === 'pibe' ? pibe(ctx) : ctx.prof.kind === 'cita' ? cita(ctx) : ev(ctx);
  } catch (e) {
    if (typeof console !== 'undefined') console.error('[IA] error de decisión', e);
    a = null;
  }
  if (!a || a.type === 'mazo' || !legal.some(x => sameAction(x, a))) {
    // Red de seguridad: jugada legal y prudente.
    a = legal.find(x => x.type === 'play')
      || legal.find(x => x.type === 'respond_truco' && !x.accept)
      || legal.find(x => x.type === 'respond_envido' && x.action === 'reject')
      || legal.find(x => x.type === 'respond_flor' && (x.action === 'no' || x.action === 'simple' || x.action === 'reject'))
      || legal[0];
    a = { ...a, why: 'Juega' };
  }
  memNote(mem, st, a);
  return a;
}

// Aplica una acción sobre el estado global del juego (G).
export function aiApplyAction(a) {
  switch (a.type) {
    case 'play': onCardClick(a.idx); break;
    case 'truco': singTruco(); break;
    case 'envido': initiateEnvido(a.call); break;
    case 'flor': singFlor(); break;
    case 'respond_truco': respondTruco(!!a.accept); break;
    case 'raise_truco': raiseTruco(); break;
    case 'envido_first': deferPendingTrucoAndInitiateEnvido(a.call); break;
    case 'respond_envido': respondEnvido(a.action); break;
    case 'flor_over_envido': florOverEnvido(); break;
    case 'respond_flor': respondFlor(a.action); break;
    default: break;
  }
}

export function aiLevelOf(mode) {
  return mode === 'ai_legend' ? 'legend' : mode === 'ai_expert' ? 'expert' : mode === 'ai_hard' ? 'hard' : 'medium';
}

// ═════════════════════════════════════════════════════════════
// 9. PEGAMENTO CON EL JUEGO (asiento de la IA, demoras, log)
// ═════════════════════════════════════════════════════════════

let _aiTurnToken = 0;
let _aiPending = false;
let _mem = aiNewMemory();

export function aiNewToken() { return ++_aiTurnToken; }
export function aiValidToken(t) { return !!G && t === _aiTurnToken; }
export function aiSchedule(fn, delay) {
  if (_aiPending) return;
  _aiPending = true;
  const token = aiNewToken();
  if (G) G.aiThinking = true;
  setTimeout(() => {
    if (!aiValidToken(token)) return; // quedó viejo: otra partida u otro turno
    _aiPending = false;
    fn();
  }, delay);
}
export function aiThink() { return 750 + Math.random() * 450; }

export function aiResume() {
  if (!G || G.aiSeat === null || G.aiSeat === undefined || _aiPending) return;
  if (G.matchEnded || G.pendingChant) return;
  if (G.activeSeat !== G.aiSeat) return;
  if (G.phase !== 'chant' && G.phase !== 'play') return;
  aiSchedule(() => aiTakeTurn(), aiThink());
}

function aiAct() {
  if (!G) return;
  G.aiThinking = false;
  if (G.aiSeat === null || G.aiSeat === undefined || G.matchEnded) return;
  const a = aiDecide(G, G.aiSeat, aiLevelOf(G.aiMode), _mem);
  if (!a) return;
  if (a.type !== 'play') uiLog(`[IA] ${a.why || 'Decide'}`, 'important');
  aiApplyAction(a);
}

export function aiTakeTurn() {
  _aiPending = false;
  aiAct();
}

export function aiHandlePendingChant() {
  _aiPending = false;
  aiAct();
}

export function aiRecordHand() {
  if (!G || G.aiSeat === null || G.aiSeat === undefined) return;
  aiMemRecordHand(_mem, G, G.aiSeat);
}

// Nueva partida: se invalidan los turnos agendados. Lo aprendido del rival
// en la mano en curso se descarta; las frecuencias se conservan suavizadas
// (la persona del otro lado suele ser la misma).
export function resetAIState() {
  _aiPending = false;
  _aiTurnToken++;
  const m = _mem;
  const half = (o) => { for (const k in o) if (typeof o[k] === 'number') o[k] = o[k] / 2; };
  half(m); for (let L = 1; L <= 3; L++) half(m.tFaced[L]);
  half(m.tOpp); half(m.tShow); half(m.eFaced); half(m.eOpen);
  m.h = freshHand();
}
