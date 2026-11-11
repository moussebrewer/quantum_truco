// @ts-nocheck
// Refactor of the original single-file Quantum Truco source.
// This file owns HTML mounting, setup-screen DOM wiring, rendering, overlays, and log UI.

import {
  G,
  setupCfg,
  TRUCO_LEVELS,
  SUITS,
  envidoValueSingle,
  envidoMetric,
  teamOf,
  circularOrder,
  allSeats,
  canTeamRaiseNow,
  envidoTotalIfAccepted,
  envidoPointsIfRejected,
  envidoCanRaise,
  initiateEnvido,
  respondTruco,
  raiseTruco,
  respondEnvido,
  singFlor,
  respondFlor,
  singTruco,
  skipChantAndPlay,
  onCardClick,
  goToMazo,
  startNewHand,
  getVisibleCard,
  deferPendingTrucoAndInitiateEnvido,
  canEnvidoFirst,
  canOpenEnvido,
  canSingFlor,
  canFlorOverEnvido,
  florOverEnvido,
  faltaEnvidoPoints,
} from './game';

import {
  isOnlineClientMode,
  sendPlayCard,
  sendSingTruco,
  sendRespondTruco,
  sendRaiseTruco,
  sendInitiateEnvido,
  sendRespondEnvido,
  sendSingFlor,
  sendRespondFlor,
  sendGoToMazo,
  sendEnvidoFirst,
  sendFlorOverEnvido,
} from './online';

import { flying, arenaKey, COLLAPSE_DUR, COLLAPSE_STAGGER } from './anim';
import { buildCardSVG, buildEntangled } from './cards';

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

export function showPassOverlay(playerName) {
  const title = document.getElementById('pass-title');
  const sub = document.getElementById('pass-sub');
  const overlay = document.getElementById('pass-overlay');
  if (title) title.textContent = `TURNO: ${playerName.toUpperCase()}`;
  if (sub) sub.textContent = `Pasá el dispositivo a ${playerName}. Que nadie mire.`;
  if (overlay) overlay.classList.add('open');
}

export function hidePassOverlay() {
  const overlay = document.getElementById('pass-overlay');
  if (overlay) overlay.classList.remove('open');
}

export function showWinScreen(title, subtitle, score) {
  const titleEl = document.getElementById('win-title');
  const subEl = document.getElementById('win-sub');
  const scoreEl = document.getElementById('win-score');
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
  if (scoreEl) scoreEl.textContent = score;
}

function getEnvidoOverlayEl() {
  return document.getElementById('envido-overlay');
}

export function isEnvidoOverlayOpen() {
  const overlay = getEnvidoOverlayEl();
  return !!overlay && overlay.classList.contains('open');
}

export function setEnvidoOverlayOnClose(cb) {
  const overlay = getEnvidoOverlayEl();
  if (overlay) overlay._onClose = cb;
}

export function initSetupOptions() {
  const updateSetupModeUi = (mode) => {
    const players = document.getElementById('opts-players');
    const onlinePanel = document.getElementById('online-room-panel');
    const onlineDivider = document.getElementById('online-divider');
    const startBtn = document.getElementById('btn-start-game');
    const isOnline = mode === 'online_1v1';
    // Contra la IA siempre es mano a mano; entre personas (en la misma
    // pantalla u online) puede ser de a 2 o de a 4.
    const forceTwo = !isOnline && mode !== 'human';

    if (forceTwo) {
      document.querySelectorAll('.opt-btn[data-group="players"]').forEach(b => b.classList.remove('selected'));
      const twoPlayers = document.querySelector('.opt-btn[data-group="players"][data-val="2"]');
      if (twoPlayers) twoPlayers.classList.add('selected');
      setupCfg.tableSize = 2;
      if (players) {
        players.style.opacity = '0.35';
        players.style.pointerEvents = 'none';
      }
    } else if (players) {
      players.style.opacity = '';
      players.style.pointerEvents = '';
    }

    if (onlinePanel) onlinePanel.style.display = isOnline ? 'block' : 'none';
    if (onlineDivider) onlineDivider.style.display = isOnline ? 'block' : 'none';
    if (startBtn) startBtn.style.display = isOnline ? 'none' : '';
  };

  document.querySelectorAll('.opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      document.querySelectorAll(`.opt-btn[data-group="${group}"]`).forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (group === 'players') setupCfg.tableSize = parseInt(btn.dataset.val, 10);
      if (group === 'target')  setupCfg.target    = parseInt(btn.dataset.val, 10);
      if (group === 'mode') {
        setupCfg.mode = btn.dataset.val;
        updateSetupModeUi(setupCfg.mode);
      }
    });
  });

  updateSetupModeUi(setupCfg.mode);
}


// El dibujo de las cartas vive en cards.ts.
export { buildCardSVG, buildEntangled };

// ═══════════════════════════════════════════════
// GAME ENGINE
// ═══════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// QUANTUM TRUCO — Motor de juego (traducción del Python)
// ══════════════════════════════════════════════════════════════

const RANKS = [1,2,3,4,5,6,7,10,11,12];

function getViewerSeatForRender() {
  if (!G) return 0;
  if (G.onlineMode && Number.isInteger(G.viewerSeat)) return G.viewerSeat;
  return (G.aiSeat !== null) ? 0 : G.activeSeat;
}

function dispatchPlayCard(handIdx) {
  if (G?.onlineMode) return sendPlayCard(handIdx);
  return onCardClick(handIdx);
}

function dispatchSingTruco() {
  return G?.onlineMode ? sendSingTruco() : singTruco();
}

function dispatchRespondTruco(accept) {
  return G?.onlineMode ? sendRespondTruco(accept) : respondTruco(accept);
}

function dispatchRaiseTruco() {
  return G?.onlineMode ? sendRaiseTruco() : raiseTruco();
}

function dispatchInitiateEnvido(call) {
  return G?.onlineMode ? sendInitiateEnvido(call) : initiateEnvido(call);
}

function dispatchRespondEnvido(action) {
  return G?.onlineMode ? sendRespondEnvido(action) : respondEnvido(action);
}

function dispatchEnvidoFirst(call) {
  return G?.onlineMode ? sendEnvidoFirst(call) : deferPendingTrucoAndInitiateEnvido(call);
}

function dispatchFlorOverEnvido() {
  return G?.onlineMode ? sendFlorOverEnvido() : florOverEnvido();
}

function dispatchSingFlor() {
  return G?.onlineMode ? sendSingFlor() : singFlor();
}

function dispatchRespondFlor(action) {
  return G?.onlineMode ? sendRespondFlor(action) : respondFlor(action);
}

function dispatchGoToMazo() {
  return G?.onlineMode ? sendGoToMazo() : goToMazo();
}

// ─────────────────────────────────────────────────────────────
// Funciones de cartas clásicas
// ─────────────────────────────────────────────────────────────

// Nombre visible de un equipo: en mano a mano es el nombre del jugador.
export function teamLabel(team) {
  if (G && G.tableSize === 2 && G.players?.[team]) return G.players[team].name;
  return team === 0 ? 'Equipo A' : 'Equipo B';
}

export function renderGame() {
  const screen = document.getElementById('screen-game');
  if (screen) screen.classList.toggle('four-players', G.tableSize > 2);
  updateHeader();
  renderArena();
  renderHand();
  renderHistoryPanel();
  renderActionPanel();
  renderTurnBanner();
}

function updateHeader() {
  const { scores, handNum, bet } = G;
  renderTally('score-tally-0', scores[0], 0);
  renderTally('score-tally-1', scores[1], 1);
  for (const t of [0, 1]) {
    const nameEl = document.getElementById(`score-name-${t}`);
    const mine = G.onlineMode && G.tableSize > 2 && teamOf(getViewerSeatForRender()) === t;
    if (nameEl) nameEl.textContent = teamLabel(t) + (mine ? ' · vos' : '');
    const numEl = document.getElementById(`score-num-${t}`);
    if (numEl) numEl.textContent = String(scores[t]);
  }
  const duel = G.duelSeats
    ? ` · Pica-pica: ${G.players[G.duelSeats[0]].name} vs ${G.players[G.duelSeats[1]].name}`
    : '';
  document.getElementById('hdr-round').textContent = `Mano ${handNum} · Baza ${G.trickIdx+1}${duel}`;
  const lvl = TRUCO_LEVELS[bet.level];
  document.getElementById('hdr-bet').textContent = `Truco: ${lvl.name} (${lvl.pts} pt${lvl.pts>1?'s':''})`;
}

function renderTally(elId, pts, team) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = '';
  const cls  = team === 0 ? 't0' : 't1';
  const full = Math.floor(pts / 5);
  const rem  = pts % 5;
  for (let g = 0; g < full; g++) {
    const grp = document.createElement('div');
    grp.className = 'tally-group';
    for (let i = 0; i < 4; i++) {
      const m = document.createElement('div');
      m.className = `tally-mark ${cls}`;
      grp.appendChild(m);
    }
    const diag = document.createElement('div');
    diag.className = `tally-diag ${cls}`;
    grp.appendChild(diag);
    el.appendChild(grp);
  }
  if (rem > 0) {
    const grp = document.createElement('div');
    grp.className = 'tally-group';
    for (let i = 0; i < rem; i++) {
      const m = document.createElement('div');
      m.className = `tally-mark ${cls}`;
      grp.appendChild(m);
    }
    el.appendChild(grp);
  }
}

// ─────────────────────────────────────────────────────────────
// Estado de animación por carta. El render es idempotente: si se vuelve a
// dibujar en medio de una animación, la retoma donde iba (delay negativo).
// Así las animaciones salen de comparar el estado anterior con el nuevo y
// funcionan igual en local y en online.
// ─────────────────────────────────────────────────────────────
const ENTER_DUR = 360;
const arenaSeen = new Map(); // arenaKey -> { state:'q'|'c', enterAt, collapseAt }
const handSeen  = new Map(); // handKey  -> { state:'q'|'c', collapseAt }

function pruneSeen(map, handNum) {
  if (map.size < 60) return;
  const prefix = `${handNum}:`;
  for (const k of [...map.keys()]) if (!k.startsWith(prefix)) map.delete(k);
}

// HTML de una carta que está colapsando: la cara cuántica se desvanece
// sobre la cara definitiva.
function collapseLayers(qc, id, startAt, now) {
  const [a, b] = qc.options;
  const c = qc.collapsedTo || getVisibleCard(qc);
  const delay = Math.round(startAt - now);
  return `<div class="collapse-layers" style="--cdelay:${delay}ms">
      <div class="layer-collapsed">${buildCardSVG(c.rank, c.suit, id)}</div>
      <div class="layer-entangled">${buildEntangled(a.rank, a.suit, b.rank, b.suit, false)}</div>
    </div>`;
}

export function renderArena() {
  const slotsEl = document.getElementById('arena-slots');
  const bazaEl  = document.getElementById('baza-result-display');
  slotsEl.innerHTML = '';

  renderOpponentIndicator();

  const now = performance.now();
  const viewerTeam = teamOf(getViewerSeatForRender());
  pruneSeen(arenaSeen, G.handNum);
  let newCollapses = 0;

  G.playOrder.forEach(seat => {
    const qc = G.playsThisTrick[seat];
    if (!qc) return;
    const key = arenaKey(G.handNum, G.trickIdx, seat);
    const isC = !!qc.collapsedTo;
    const hasOptions = qc.options?.length === 2;
    const isFlying = flying.has(key);

    let rec = arenaSeen.get(key);
    if (!rec) {
      rec = { state: isC ? 'c' : 'q', enterAt: isFlying ? null : now, collapseAt: null };
      // Llegó ya colapsada (online): entra y después colapsa.
      if (isC && hasOptions && !isFlying) rec.collapseAt = now + ENTER_DUR + (newCollapses++) * COLLAPSE_STAGGER;
      arenaSeen.set(key, rec);
    } else if (rec.state === 'q' && isC) {
      rec.state = 'c';
      if (hasOptions) rec.collapseAt = now + (newCollapses++) * COLLAPSE_STAGGER;
    }

    const collapsing = isC && hasOptions && rec.collapseAt != null && now < rec.collapseAt + COLLAPSE_DUR;
    const entering   = rec.enterAt != null && now < rec.enterAt + ENTER_DUR;

    const slot = document.createElement('div');
    slot.className = 'arena-slot ' + (teamOf(seat) === viewerTeam ? 'side-me' : 'side-opp');
    slot.dataset.seat = String(seat);

    const card = document.createElement('div');
    card.className = 'qcard table-card';
    card.style.setProperty('--rot', `${((seat * 7) % 9) - 4}deg`);
    if (isFlying) card.classList.add('is-flying');
    if (entering) {
      card.classList.add('enter');
      card.style.setProperty('--edelay', `${Math.round(rec.enterAt - now)}ms`);
    }

    if (collapsing) {
      card.classList.add('collapsing');
      card.innerHTML = collapseLayers(qc, `ct_${seat}_${qc.collapsedTo.rank}_${qc.collapsedTo.suit}`, rec.collapseAt, now);
    } else if (isC) {
      const c = qc.collapsedTo;
      card.innerHTML = buildCardSVG(c.rank, c.suit, `ct_${seat}_${c.rank}_${c.suit}`);
    } else if (hasOptions) {
      const [a, b] = qc.options;
      card.innerHTML = buildEntangled(a.rank, a.suit, b.rank, b.suit, false);
      card.classList.add('quantum');
    }
    slot.appendChild(card);

    const name = document.createElement('div');
    name.className = 'slot-name t' + teamOf(seat);
    name.textContent = G.players[seat]?.name || '';
    slot.appendChild(name);

    slotsEl.appendChild(slot);
  });

  if (G.phase === 'baza_end' || G.phase === 'hand_end') {
    const last = G.trickWinners[G.trickWinners.length - 1];
    if (last === undefined) {
      bazaEl.textContent = '';
    } else {
      bazaEl.textContent = last === -1 ? '⚔ Parda' : `▲ Gana ${teamLabel(last)}`;
      bazaEl.style.color = last === -1 ? 'var(--gold)' : last === 0 ? 'var(--accent-a)' : 'var(--accent-b)';
      slotsEl.querySelectorAll('.arena-slot').forEach(s => {
        if (last === -1) s.classList.add('winner-draw');
        else if (teamOf(Number(s.dataset.seat)) === last) s.classList.add(`winner-t${last}`);
        else s.classList.add('loser');
      });
    }
  } else if (G.phase === 'collapsing') {
    bazaEl.textContent = '⊗ Colapsando…';
    bazaEl.style.color = 'rgba(0,200,255,0.8)';
  } else {
    bazaEl.textContent = '';
  }
}

function renderOpponentIndicator() {
  const ind = document.getElementById('opp-zone');
  if (!ind) return;

  const viewerSeat = getViewerSeatForRender();
  const oppSeats = allSeats().filter(s => teamOf(s) !== teamOf(viewerSeat));
  const oppCardCount = oppSeats.reduce((sum, s) => sum + (G.players[s]?.hand?.length || 0), 0);
  const isMano = oppSeats.some(s => s === G.manoSeat);
  const isTurn = oppSeats.includes(G.pendingChant ? G.pendingChant.responderSeat : G.activeSeat)
    && (G.phase === 'play' || G.phase === 'chant');

  ind.innerHTML = '';
  ind.classList.toggle('is-turn', isTurn);

  const fan = document.createElement('div');
  fan.className = 'opp-fan';
  fan.id = 'opp-fan';
  for (let i = 0; i < oppCardCount; i++) {
    const c = document.createElement('div');
    c.className = 'card-back mini';
    c.style.setProperty('--fan', `${(i - (oppCardCount - 1) / 2) * 7}deg`);
    c.textContent = '⊗';
    fan.appendChild(c);
  }
  ind.appendChild(fan);

  const info = document.createElement('div');
  info.className = 'opp-info';
  const oppName = oppSeats.length === 1 ? G.players[oppSeats[0]].name : 'Rivales';
  info.innerHTML = `<span class="opp-name"></span>${isMano ? '<span class="opp-mano">✦ mano</span>' : ''}`;
  info.querySelector('.opp-name').textContent = oppName;
  ind.appendChild(info);
}

export function renderHand() {
  const rowEl  = document.getElementById('hand-row');
  const infoEl = document.getElementById('envido-info');
  if (!rowEl) return;
  rowEl.innerHTML = '';

  const viewerSeat = getViewerSeatForRender();
  const isMyTurn   = G.activeSeat === viewerSeat && !G.pendingChant;
  const p          = G.players[viewerSeat];
  const isPlayable = !!p && isMyTurn && (G.phase === 'play' || G.phase === 'chant');

  const area = rowEl.closest('.hand-area');
  if (area) area.classList.toggle('my-turn', isPlayable);

  if (!p) {
    if (infoEl) infoEl.innerHTML = '';
    return;
  }

  const now = performance.now();
  pruneSeen(handSeen, G.handNum);
  const n = p.hand.length;
  const dup = {};

  p.hand.forEach((qc, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'qcard hand-card' + (isPlayable ? ' playable' : '');
    const off = i - (n - 1) / 2;
    wrap.style.setProperty('--fan', `${off * 4}deg`);
    wrap.style.setProperty('--lift', `${Math.abs(off) * 7}px`);

    const visibleCard = getVisibleCard(qc);
    const hasOptions = qc?.options?.length === 2;
    dup[qc.pairId] = (dup[qc.pairId] || 0) + 1;
    const key = `${G.handNum}:${viewerSeat}:${qc.pairId}:${dup[qc.pairId]}`;

    let rec = handSeen.get(key);
    if (!rec) {
      rec = { state: visibleCard ? 'c' : 'q', collapseAt: null };
      handSeen.set(key, rec);
    } else if (rec.state === 'q' && visibleCard) {
      rec.state = 'c';
      // Sincronizar con la carta entrelazada que colapsa en la mesa.
      let at = now;
      for (const [seatStr, played] of Object.entries(G.playsThisTrick || {})) {
        if (played.pairId === qc.pairId) {
          const r = arenaSeen.get(arenaKey(G.handNum, G.trickIdx, Number(seatStr)));
          if (r?.collapseAt != null) at = Math.max(now, r.collapseAt);
        }
      }
      rec.collapseAt = at;
    }
    const collapsing = visibleCard && hasOptions && rec.collapseAt != null && now < rec.collapseAt + COLLAPSE_DUR;

    if (collapsing) {
      wrap.classList.add('collapsing');
      wrap.innerHTML = collapseLayers({ ...qc, collapsedTo: visibleCard }, `hc_${qc.pairId}_${i}`, rec.collapseAt, now);
    } else if (visibleCard) {
      wrap.innerHTML = buildCardSVG(visibleCard.rank, visibleCard.suit,
        `hc_${qc.pairId}_${i}_${Math.random().toString(36).slice(2,4)}`);
    } else if (hasOptions) {
      const [a, b] = qc.options;
      wrap.innerHTML = buildEntangled(a.rank, a.suit, b.rank, b.suit, false);
    } else {
      wrap.innerHTML = '<div class="hidden-card-placeholder"></div>';
    }

    if (isPlayable) wrap.addEventListener('click', () => dispatchPlayCard(i));
    rowEl.appendChild(wrap);
  });

  if (infoEl) {
    if (G.trickIdx >= 2) infoEl.innerHTML = '';
    else renderEnvidoInfo(p, infoEl);
  }
}

function renderEnvidoInfo(p, el) {
  const liveHand = p.hand.map(qc => {
    const visibleCard = getVisibleCard(qc);
    return visibleCard
      ? { options: [visibleCard, visibleCard], collapsedTo: visibleCard, pairId: qc.pairId }
      : qc;
  });
  const lm = envidoMetric(liveHand);
  let html = `
    <div class="envido-stat"><span class="envido-stat-label">Envido medio</span><span class="envido-stat-val">${lm.mu.toFixed(1)}</span></div>
    <div class="envido-stat"><span class="envido-stat-label">P(≥28)</span><span class="envido-stat-val">${(lm.p28*100).toFixed(0)}%</span></div>
    <div class="envido-stat"><span class="envido-stat-label">Rango</span><span class="envido-stat-val">${lm.min}–${lm.max}</span></div>`;
  if (G.conFlor) {
    const fm = p.florMetric;
    html += `<div class="envido-stat"><span class="envido-stat-label">P(Flor)</span><span class="envido-stat-val">${(fm.pFlor*100).toFixed(0)}%</span></div>`;
  }
  el.innerHTML = html;
}

function renderHistoryPanel() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  const history = G.trickHistory || [];
  const panel = document.getElementById('history-panel');
  if (panel) panel.classList.toggle('empty', history.length === 0);

  history.forEach((entry, idx) => {
    const winner = G.trickWinners[idx];
    const baza   = document.createElement('div');
    baza.className = 'history-baza';

    const hdr = document.createElement('div');
    hdr.className = 'history-baza-header';
    hdr.textContent = `Baza ${idx + 1}`;
    baza.appendChild(hdr);

    const row = document.createElement('div');
    row.className = 'history-cards-row';

    entry.forEach(({ seat, card }) => {
      const d = document.createElement('div');
      d.className = 'qcard history-card';
      d.innerHTML = buildCardSVG(card.rank, card.suit,
        `h_${idx}_${card.rank}_${card.suit}_${Math.random().toString(36).slice(2,4)}`);
      if (winner === -1) d.classList.add('draw');
      else if (teamOf(seat) === winner) d.classList.add(`win-t${winner}`);
      else d.classList.add('lost');
      row.appendChild(d);
    });

    baza.appendChild(row);

    const wlbl = document.createElement('div');
    wlbl.className = 'history-winner';
    if (winner === -1) { wlbl.textContent = '⚔ Parda'; wlbl.style.color = 'var(--gold)'; }
    else { wlbl.textContent = `▲ ${teamLabel(winner)}`; wlbl.style.color = winner===0?'var(--accent-a)':'var(--accent-b)'; }
    baza.appendChild(wlbl);
    list.appendChild(baza);
  });
}

function renderActionPanel() {
  const turnLbl = document.getElementById('chant-turn');
  const btns    = document.getElementById('chant-btns');
  if (!turnLbl || !btns) return;
  btns.innerHTML = '';

  if (G.phase === 'collapsing') { turnLbl.textContent = '⊗ Colapsando…'; return; }

  if (G.aiSeat !== null && G.aiThinking && !G.pendingChant) {
    turnLbl.textContent = `${G.players[G.aiSeat].name} está pensando…`;
    return;
  }

  const viewerSeat = getViewerSeatForRender();

  if (G.onlineMode && G.statusText) {
    addChantState(btns, 'Sala', G.statusText, '');
  }
  if (G.onlineMode && G.opponentConnected === false) {
    turnLbl.textContent = 'Esperando rival…';
    return;
  }

  if (G.pendingChant) {
    if (viewerSeat === G.pendingChant.responderSeat) {
      renderPendingChant(turnLbl, btns);
    } else {
      const caller = G.players[G.pendingChant.callerSeat];
      const responder = G.players[G.pendingChant.responderSeat];
      turnLbl.textContent = `Turno de ${responder.name}`;
      addChantState(btns, `${caller.name} cantó`, G.pendingChant.type.toUpperCase(), 'Esperando respuesta');
    }
    return;
  }

  if (G.onlineMode && viewerSeat !== G.activeSeat) {
    turnLbl.textContent = `Turno de ${G.players[G.activeSeat].name}`;
    return;
  }

  const seat    = G.onlineMode ? viewerSeat : G.activeSeat;
  const p       = G.players[seat];
  const bet     = G.bet;
  const chant   = G.chant;
  const actTeam = p.team;

  turnLbl.textContent = p.name;

  if (G.phase === 'chant') {
    if (canOpenEnvido(G, seat)) {
      addBtn(btns, 'Envido',        'success', () => dispatchInitiateEnvido('envido'));
      addBtn(btns, 'Real Envido',   'success', () => dispatchInitiateEnvido('real envido'));
      addBtn(btns, 'Falta Envido',  'success', () => dispatchInitiateEnvido('falta envido'));
    }
    // La flor solo se ofrece si alguna combinación de colapsos te la da.
    if (canSingFlor(G, seat)) {
      const pct = Math.round((p.florMetric?.pFlor ?? 0) * 100);
      addBtn(btns, `🌸 Flor (${pct}% de tenerla)`, 'flor', dispatchSingFlor);
    }
    if (canTeamRaiseNow(bet, actTeam)) {
      const nxt = TRUCO_LEVELS[bet.level + 1];
      if (nxt) addBtn(btns, `${nxt.name} (${nxt.pts}p)`, 'gold', dispatchSingTruco);
    }
    addBtn(btns, 'Al Mazo', 'danger', dispatchGoToMazo);

  } else if (G.phase === 'play') {
    if (canTeamRaiseNow(bet, actTeam)) {
      const nxt = TRUCO_LEVELS[bet.level + 1];
      if (nxt) addBtn(btns, `${nxt.name} (${nxt.pts}p)`, 'gold', dispatchSingTruco);
    }
    addBtn(btns, 'Al Mazo', 'danger', dispatchGoToMazo);

  } else if (G.phase === 'baza_end') {
    const last = G.trickWinners[G.trickWinners.length - 1];
    turnLbl.textContent = last === -1 ? '⚔ Parda' : `${teamLabel(last)} gana`;
    // Entre baza y baza no se canta: el truco se canta en tu turno.

  } else if (G.phase === 'hand_end') {
    turnLbl.textContent = `+${G.handScore[0]} / +${G.handScore[1]}`;
    if (!G.onlineMode) addBtn(btns, 'Nueva Mano →', 'primary', startNewHand);
  }
}

// ── Render the pending chant response inline in the chant panel ──────────
function renderPendingChant(turnLbl, btns) {
  const pc      = G.pendingChant;
  const seat    = G.activeSeat;
  const p       = G.players[seat];
  const caller  = G.players[pc.callerSeat];
  const env     = G.chant.envido;

  if (pc.type === 'truco') {
    const { level, raiserTeam } = pc.data;
    const nxt    = TRUCO_LEVELS[level];
    const curPts = TRUCO_LEVELS[level - 1].pts;

    turnLbl.textContent = p.name;
    addChantState(btns,
      `${caller.name} canta`,
      nxt.name.toUpperCase(),
      `Querer: ${nxt.pts} pts | Rechazar: ${teamLabel(raiserTeam)} cobra ${curPts} pt${curPts>1?'s':''}`
    );

    addBtn(btns, `✓ Quiero (${nxt.pts}p)`, 'success', () => dispatchRespondTruco(true));
    addBtn(btns, `✗ No Quiero (−${curPts}p)`, 'danger', () => dispatchRespondTruco(false));

    if (level < 3) {
      const higher = TRUCO_LEVELS[level + 1];
      if (higher) addBtn(btns, `↑ ${higher.name} (${higher.pts}p)`, 'gold', dispatchRaiseTruco);
    }

    // "El envido está primero": también vale online.
    if (canEnvidoFirst()) {
      addSep(btns);
      addBtn(btns, 'Envido primero', 'success', () => dispatchEnvidoFirst('envido'));
      addBtn(btns, 'Real Envido primero', 'success', () => dispatchEnvidoFirst('real envido'));
      addBtn(btns, 'Falta Envido primero', 'success', () => dispatchEnvidoFirst('falta envido'));
    }

  } else if (pc.type === 'envido') {
    const curPts = envidoTotalIfAccepted(env.calls, env.callerTeam, G.target, G.scores);
    const rejPts = envidoPointsIfRejected(env.calls, env.callerTeam, G.target, G.scores);
    const raises = envidoCanRaise(env.calls);
    const callStr = env.calls.map(c => c.toUpperCase()).join(' + ');

    turnLbl.textContent = p.name;
    addChantState(btns,
      `${caller.name} canta`,
      callStr,
      `Querer: ${curPts} pts | Rechazar: ${teamLabel(env.callerTeam)} cobra ${rejPts} pts`
    );

    addBtn(btns, `✓ Quiero (${curPts}p)`, 'success', () => dispatchRespondEnvido('accept'));
    addBtn(btns, `✗ No Quiero (+${rejPts}p)`, 'danger', () => dispatchRespondEnvido('reject'));
    for (const r of raises) {
      addBtn(btns, `↑ ${r}`, 'gold', () => dispatchRespondEnvido(r));
    }
    // Contestar con flor anula el envido.
    if (canFlorOverEnvido()) {
      const pct = Math.round((G.players[pc.responderSeat].florMetric?.pFlor ?? 0) * 100);
      addSep(btns);
      addBtn(btns, `🌸 Flor (${pct}%): anula el envido`, 'flor', dispatchFlorOverEnvido);
    }

  } else if (pc.type === 'flor') {
    const { stage } = pc.data;
    turnLbl.textContent = p.name;

    if (stage === 'initial') {
      const myPct = Math.round((G.players[pc.responderSeat].florMetric?.pFlor ?? 0) * 100);
      addChantState(btns, `${caller.name} canta`, 'FLOR',
        'Se cobra al final: 3 si le sale. Si no le sale, los 3 son para vos.');
      if (myPct > 0) addBtn(btns, `🌸 Yo también (${myPct}% de tenerla)`, 'success', () => dispatchRespondFlor('yes'));
      addBtn(btns, 'Seguir sin flor', 'primary', () => dispatchRespondFlor('no'));

    } else if (stage === 'contraflor') {
      addChantState(btns, 'Los dos cantaron flor', '¿CONTRAFLOR?', 'Gana la flor más alta que salga al colapsar.');
      addBtn(btns, 'Dejarla en flor (3p)', 'primary', () => dispatchRespondFlor('simple'));
      addBtn(btns, 'Contraflor (6p)', 'gold', () => dispatchRespondFlor('contraflor'));
      addBtn(btns, `Contraflor al resto (${faltaEnvidoPoints(G.target, G.scores)}p)`, 'danger', () => dispatchRespondFlor('alresto'));

    } else if (stage === 'resp_contraflor') {
      const alResto = pc.data.alResto;
      const lbl = alResto ? 'CONTRAFLOR AL RESTO' : 'CONTRAFLOR';
      const win = alResto ? faltaEnvidoPoints(G.target, G.scores) : 6;
      const rej = alResto ? 6 : 4;
      addChantState(btns, `${caller.name} canta`, lbl,
        `Querer: ${win} pts | Rechazar: ${teamLabel(teamOf(pc.callerSeat))} cobra ${rej} pts`);
      addBtn(btns, `✓ Quiero (${win}p)`, 'success', () => dispatchRespondFlor('accept'));
      addBtn(btns, `✗ No Quiero (+${rej}p)`, 'danger', () => dispatchRespondFlor('reject'));
    }
  }
}

function addChantState(container, label, value, pts) {
  const d = document.createElement('div');
  d.className = 'chant-state';
  d.innerHTML = `<span class="chant-state-label">${label}</span>
    <span class="chant-state-value">${value}</span>
    ${pts ? `<span class="chant-state-pts">${pts}</span>` : ''}`;
  container.appendChild(d);
  return d;
}
function addSep(container) {
  const d = document.createElement('div');
  d.className = 'chant-sep';
  container.appendChild(d);
}

function renderActionBar() { renderActionPanel(); }


function addBtn(container, label, cls, cb) {
  const b = document.createElement('button');
  b.className = 'act-btn ' + (cls === 'flor' ? 'success' : cls);
  if (cls === 'flor') b.style.cssText = 'border-color:rgba(204,68,255,0.5);color:#cc44ff;background:rgba(204,68,255,0.08);';
  b.textContent = label;
  b.addEventListener('click', cb);
  container.appendChild(b);
}

// ── Truco ────────────────────────────────────────────────────

// Carteles en el centro de la pantalla. Van en cola para que dos cantos
// seguidos (p. ej. "¡Truco!" y "¡Quiero!") no se pisen.
const toastQueue = [];
let toastBusy = false;

function pumpToasts() {
  const el = document.getElementById('truco-toast');
  if (!el || toastBusy) return;
  const item = toastQueue.shift();
  if (!item) return;
  toastBusy = true;
  el.innerHTML = '';
  el.className = 'truco-toast';
  if (item.name) {
    const who = document.createElement('div');
    who.className = `say-name t${item.team}`;
    who.textContent = item.name;
    el.appendChild(who);
    el.classList.add(`say-t${item.team}`);
  }
  const what = document.createElement('div');
  what.className = 'say-text';
  what.textContent = item.text;
  el.appendChild(what);
  el.classList.add('show');
  // Si hay más carteles esperando, este dura menos.
  const hold = toastQueue.length ? 1300 : (item.hold || 2000);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { toastBusy = false; pumpToasts(); }, 220);
  }, hold);
}

// Cartel neutro (sin autor), p. ej. el resumen de la mano.
export function showTrucoCallToast(phrase, hold) {
  toastQueue.push({ text: phrase, hold });
  pumpToasts();
}

// Algo que dice un jugador: canto, respuesta o mensaje de chat.
export function showSay(name, text, team = 0) {
  toastQueue.push({ name, text, team });
  pumpToasts();
}

// (Las frases de "quiero" ahora las elige el motor y llegan por showSay.)
export function showTrucoToast() {}

// ── Cartel de turno ──────────────────────────────────────────
// Una línea bien visible sobre la mano que dice qué se espera ahora.
function renderTurnBanner() {
  const el = document.getElementById('turn-banner');
  if (!el) return;
  const viewer = getViewerSeatForRender();
  const hotSeat = !G.onlineMode && G.aiSeat === null;
  let text = '';
  let mine = false;

  if (G.onlineMode && G.opponentConnected === false) {
    text = 'Rival desconectado. Esperando que vuelva…';
  } else if (G.phase === 'collapsing') {
    text = '⊗ Colapsando…';
  } else if (G.phase === 'baza_end' || G.phase === 'hand_end') {
    text = '';
  } else if (G.pendingChant) {
    const pc = G.pendingChant;
    const what = pc.type === 'truco' ? (TRUCO_LEVELS[pc.data?.level]?.name || 'Truco')
      : pc.type === 'envido' ? (G.chant.envido.calls.slice(-1)[0] || 'envido')
      : 'flor';
    if (pc.responderSeat === viewer) {
      mine = true;
      text = hotSeat
        ? `${G.players[viewer].name}: te cantaron ${what}. Respondé.`
        : `Te cantaron ${what}. Respondé.`;
    } else {
      text = `Esperando la respuesta de ${G.players[pc.responderSeat].name}…`;
    }
  } else if (G.aiSeat !== null && G.aiThinking) {
    text = `${G.players[G.aiSeat].name} está pensando…`;
  } else if (G.activeSeat === viewer && (G.phase === 'play' || G.phase === 'chant')) {
    mine = true;
    const canChant = G.phase === 'chant';
    const who = hotSeat ? `${G.players[viewer].name}, es tu turno` : 'Es tu turno';
    text = canChant ? `${who}: cantá o jugá una carta` : `${who}: jugá una carta`;
  } else if (G.players[G.activeSeat]) {
    text = `Turno de ${G.players[G.activeSeat].name}…`;
  }

  el.textContent = text;
  el.classList.toggle('mine', mine);
  el.classList.toggle('empty', !text);
}

// ── Chat (solo online) ───────────────────────────────────────
let chatUnread = 0;

function chatIsOpen() {
  const panel = document.getElementById('chat-panel');
  if (!panel) return false;
  // En escritorio el panel está siempre a la vista; en celular es un cajón.
  return panel.classList.contains('open') || getComputedStyle(panel).position !== 'fixed';
}

function updateChatBadge() {
  const badge = document.getElementById('chat-badge');
  if (!badge) return;
  badge.textContent = chatUnread > 9 ? '9+' : String(chatUnread);
  badge.style.display = chatUnread > 0 ? '' : 'none';
}

export function setChatEnabled(on) {
  document.getElementById('screen-game')?.classList.toggle('has-chat', !!on);
  if (!on) clearChat();
}

export function clearChat() {
  const list = document.getElementById('chat-list');
  if (list) list.innerHTML = '';
  chatUnread = 0;
  updateChatBadge();
}

// mine: lo escribí yo. announce: mostrarlo además como cartel si el chat no está a la vista.
export function appendChatMessage(name, text, team, mine, announce = true) {
  const list = document.getElementById('chat-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'chat-msg' + (mine ? ' mine' : '');
  const who = document.createElement('span');
  who.className = `chat-who t${team}`;
  who.textContent = mine ? 'Vos' : name;
  const what = document.createElement('span');
  what.className = 'chat-text';
  what.textContent = text;
  row.append(who, what);
  list.appendChild(row);
  while (list.children.length > 80) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;

  if (!mine && announce && !chatIsOpen()) {
    chatUnread++;
    updateChatBadge();
    showSay(`💬 ${name}`, text, team);
  }
}

export function toggleChat() {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  const open = panel.classList.toggle('open');
  if (open) {
    chatUnread = 0;
    updateChatBadge();
    const list = document.getElementById('chat-list');
    if (list) list.scrollTop = list.scrollHeight;
    document.getElementById('chat-input')?.focus();
  }
}

export function initChat(onSend) {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  if (!form || !input) return;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    onSend(text);
    input.value = '';
  });
}

// Returns which cards from a 3-card hand contribute to the envido score, and their individual values
function envidoContributions(cards) {
  // Find the best suit combo
  const bySuit = {};
  for (const s of SUITS) bySuit[s] = [];
  for (const c of cards) bySuit[c.suit].push(c);

  let bestScore = 0, bestSuit = null;
  for (const [suit, cs] of Object.entries(bySuit)) {
    if (cs.length >= 2) {
      const vals = cs.map(c => envidoValueSingle(c)).sort((a,b)=>b-a);
      const s = 20 + vals[0] + vals[1];
      if (s > bestScore) { bestScore = s; bestSuit = suit; }
    }
  }
  // Mark contributing cards
  return cards.map(c => {
    if (bestSuit && c.suit === bestSuit) {
      return { card: c, contrib: envidoValueSingle(c), isSuit: true };
    }
    return { card: c, contrib: 0, isSuit: false };
  });
}

export function showEnvidoAnnouncement(res, pts, finalCards) {
  // Build overlay content
  const teamsRow = document.getElementById('envido-teams-row');
  const ptsEl = document.getElementById('envido-pts-awarded');
  const subtitle = document.getElementById('envido-reveal-subtitle');
  if (!teamsRow || !ptsEl) return;

  teamsRow.innerHTML = '';

  // Subtitle with call sequence
  const callStr = G.chant.envido.calls.map(c => c.toUpperCase()).join(' → ');
  subtitle.textContent = callStr || 'Cartas al descubierto';

  const cardScale = 0.52;
  const cW = Math.round(130 * cardScale), cH = Math.round(200 * cardScale);

  allSeats().forEach(seat => {
    const p = G.players[seat];
    const team = teamOf(seat);
    const isWinner = team === res.winner;
    const cards = finalCards[seat] || [];
    if (!cards.length) return; // no jugó esta mano (pica-pica)
    const score = res.teamScores[team] ?? 0;
    const contribs = envidoContributions(cards);

    const block = document.createElement('div');
    block.className = 'envido-team-block' + (isWinner ? ' winner' : '');

    // Team name
    const nameEl = document.createElement('div');
    nameEl.className = `envido-team-name t${team}`;
    nameEl.textContent = p.name;
    block.appendChild(nameEl);

    // Cards row
    const cardsRow = document.createElement('div');
    cardsRow.className = 'envido-cards-row';

    contribs.forEach(({ card, contrib, isSuit }) => {
      const wrap = document.createElement('div');
      wrap.className = 'envido-card-wrap' + (isSuit ? ' contributes' : ' notcontrib');

      const inner = document.createElement('div');
      inner.className = 'qcard';
      inner.innerHTML = buildCardSVG(card.rank, card.suit, `env_${seat}_${card.rank}_${card.suit}_${Math.random().toString(36).slice(2,4)}`);
      wrap.appendChild(inner);

      // Contribution label below card
      const lbl = document.createElement('div');
      lbl.className = 'envido-card-contrib' + (contrib === 0 ? ' zero' : '');
      lbl.textContent = isSuit ? `+${contrib}` : '—';
      wrap.appendChild(lbl);

      cardsRow.appendChild(wrap);
    });
    block.appendChild(cardsRow);

    // Big score number
    const scoreEl = document.createElement('div');
    scoreEl.className = 'envido-team-score-big';
    scoreEl.textContent = score;
    block.appendChild(scoreEl);

    if (isWinner) {
      const badge = document.createElement('div');
      badge.className = 'envido-winner-badge';
      badge.textContent = '✦ Gana el envido ✦';
      block.appendChild(badge);
    }

    teamsRow.appendChild(block);
  });

  // Points awarded line
  const winnerName = G.players.find(p => teamOf(p.seat) === res.winner)?.name ?? `Eq ${res.winner}`;
  ptsEl.innerHTML = `<strong>+${pts}</strong> pts para ${winnerName}`;

  // Open overlay
  const overlay = document.getElementById('envido-overlay');
  if (!overlay) return;
  (overlay)._onClose = null; // will be set by applyHandScore
  overlay.classList.add('open');

  // Auto-dismiss after 10s if not clicked
  if ((overlay)._autoDismiss) clearTimeout((overlay)._autoDismiss);
  (overlay)._autoDismiss = setTimeout(() => closeEnvidoOverlay(), 10000);
}

export function closeEnvidoOverlay() {
  const overlay = document.getElementById('envido-overlay');
  if (!overlay) return;
  if ((overlay)._autoDismiss) clearTimeout((overlay)._autoDismiss);
  overlay.classList.remove('open');
  const cb = (overlay)._onClose;
  (overlay)._onClose = null;
  if (cb) cb();
}

export function showModal(titleCls, title, body, pts, buttons) {
  const titleEl = document.getElementById('modal-title');
  const bodyEl  = document.getElementById('modal-body');
  const ptsEl   = document.getElementById('modal-pts');
  const btnsEl  = document.getElementById('modal-btns');

  titleEl.className   = `modal-title ${titleCls}`;
  titleEl.innerHTML   = title;
  bodyEl.innerHTML    = body;
  btnsEl.innerHTML    = '';

  if (pts != null) {
    ptsEl.style.display = '';
    ptsEl.innerHTML = `<span class="pts-big">${pts}</span> pts en juego`;
  } else {
    ptsEl.style.display = 'none';
  }

  buttons.forEach(btn => {
    const b = document.createElement('button');
    b.className = `act-btn ${btn.cls}`;
    b.textContent = btn.label;
    b.addEventListener('click', btn.cb);
    btnsEl.appendChild(b);
  });

  document.getElementById('modal').classList.add('open');
}

export function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

// ── log ──────────────────────────────────────────────────────

export function log(msg, cls = '') {
  const panel = document.getElementById('log-panel'); // now the .log-entries div
  if (!panel) return;
  const entry = document.createElement('div');
  entry.className = `log-entry${cls ? ' '+cls : ''}`;
  const t = new Date().toLocaleTimeString('es', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  entry.textContent = `[${t}] ${msg}`;
  panel.appendChild(entry);
  panel.scrollTop = panel.scrollHeight;
}

export function toggleLog() {
  const sb = document.getElementById('log-sidebar');
  if (sb) sb.classList.toggle('closed');
}

// ═══════════════════════════════════════════════════════════════
// AI ENGINE — tres niveles: pibe / citadino / gaucho digital
// ═══════════════════════════════════════════════════════════════
