// @ts-nocheck
// online.ts — must NOT import from ui.ts (circular dependency).
// All UI calls go through game.ts runtime wrappers.

import {
  G,
  setupCfg,
  installOnlineState,
  renderCurrentGame,
  showScreenById,
  showWinState,
  cloneGameState,
  uiLog,
  uiShowTrucoCallToast,
  uiShowTrucoToast,
  uiRenderGameFull,
  uiShowEnvidoAnnouncement,
  TRUCO_LEVELS,
  teamOf,
  envidoTotalIfAccepted,
  envidoPointsIfRejected,
  animateCollapse,
  animateSweepTrick,
  dealCardsAnimated,
} from './game';

const STORAGE_KEY = 'qt-online-session';

const session = {
  roomId:         '',
  roomCode:       '',
  token:          '',
  seat:           null,
  socket:         null,
  connected:      false,
  reconnectTimer: null,
  pendingRematch: false,
};

// Snapshot of previous G — used for state diffing
let _prevG = null;

// ── Network ───────────────────────────────────────────────────────

function onlineBase() {
  return 'https://quantum-truco-online.valentinreparaz.workers.dev';
}
function apiUrl(path) { return `${onlineBase().replace(/\/$/, '')}${path}`; }
function wsUrl(roomId, token) {
  const u = new URL(onlineBase().replace(/\/$/, ''));
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = `/api/rooms/connect/${roomId}`;
  u.searchParams.set('token', token);
  return u.toString();
}

function persistSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    roomId: session.roomId, roomCode: session.roomCode,
    token: session.token,  seat: session.seat,
  }));
}
function clearSessionStorage() { localStorage.removeItem(STORAGE_KEY); }

// ── DOM helpers ───────────────────────────────────────────────────

function setStatus(text, cls = '') {
  const el = document.getElementById('online-status');
  if (el) { el.textContent = text || ''; el.className = `online-status ${cls}`.trim(); }
}
function setHeaderStatus(text) {
  const el = document.getElementById('online-header-status');
  if (el) el.textContent = text || '';
}
function syncLeaveButton(show) {
  const btn = document.getElementById('btn-online-leave');
  if (btn) btn.style.display = show ? '' : 'none';
}
function updateSelectedMode() {
  document.querySelectorAll('.opt-btn[data-group="mode"]').forEach(b => b.classList.remove('selected'));
  const btn = document.querySelector('.opt-btn[data-group="mode"][data-val="online_1v1"]');
  if (btn) btn.classList.add('selected');
}

// ── Log synthesis ─────────────────────────────────────────────────

function synthesizeLog(prev, next) {
  if (!prev) return;

  // New hand
  if (next.handNum !== prev.handNum) {
    uiLog(`=== Mano ${next.handNum} · ${next.scores[0]}–${next.scores[1]} ===`, 'important');
    uiLog(`✦ Es mano: ${next.players?.[next.manoSeat]?.name || '?'}`, 'important');
    return;
  }

  // Card played (1st card of trick)
  const prevPlays = Object.keys(prev.playsThisTrick || {}).map(Number);
  const nextPlays = Object.keys(next.playsThisTrick || {}).map(Number);
  for (const seat of nextPlays) {
    if (!prevPlays.includes(seat))
      uiLog(`${next.players?.[seat]?.name || '?'} juega carta cuántica`, 'collapse');
  }

  // Trick resolved: trickHistory grew
  if (next.trickHistory.length > prev.trickHistory.length) {
    const idx    = prev.trickHistory.length;
    const winner = next.trickWinners[idx];
    // Log each card that collapsed
    const entry = next.trickHistory[idx] || [];
    for (const {seat, card} of entry) {
      uiLog(`⊗ ${next.players?.[seat]?.name || '?'}: ${card.rank} de ${card.suit}`, 'collapse');
    }
    if (winner === -1) uiLog(`Baza ${idx+1}: PARDA — sale el mano (${next.players?.[next.manoSeat]?.name || '?'})`, 'important');
    else {
      const winSeat = next.players?.find(p => teamOf(p.seat) === winner)?.seat;
      uiLog(`Baza ${idx+1}: Equipo ${winner} · ${winSeat !== undefined ? next.players[winSeat]?.name : '?'}`, 'important');
    }
  }

  // Also log if the 2nd card was played (i.e. prev had 1 card, next has trickHistory grown)
  if (prevPlays.length === 1 && next.trickHistory.length > prev.trickHistory.length) {
    // Find who played 2nd
    const firstSeat  = prevPlays[0];
    const entry      = next.trickHistory[prev.trickHistory.length] || [];
    const secondEntry = entry.find(e => e.seat !== firstSeat);
    if (secondEntry)
      uiLog(`${next.players?.[secondEntry.seat]?.name || '?'} juega carta cuántica`, 'collapse');
  }

  // Truco sung
  if (next.pendingChant?.type === 'truco' && prev.pendingChant?.type !== 'truco') {
    const callerName = next.players?.[next.pendingChant.callerSeat]?.name || '?';
    const levelName  = TRUCO_LEVELS[next.pendingChant.data?.level]?.name || 'Truco';
    uiLog(`${callerName}: ¡${levelName}!`, 'important');
    const phrases = {
      'Truco':   ['¡Truco!','¡Ahí va el truco!','¡Trucoooo!'],
      'Retruco': ['¡Retruco!','¡Mate y retruco!','¡Retruco, che!'],
      'Vale 4':  ['¡Vale cuatro!','¡Vale cuatro, jugado!'],
    };
    const opts = phrases[levelName] || [`¡${levelName}!`];
    uiShowTrucoCallToast(opts[Math.floor(Math.random() * opts.length)]);
  }

  // Truco raised
  if (next.pendingChant?.type === 'truco' && prev.pendingChant?.type === 'truco'
      && next.pendingChant.data?.level > prev.pendingChant.data?.level) {
    const raiserName = next.players?.[next.pendingChant.callerSeat]?.name || '?';
    uiLog(`${raiserName} sube a ${TRUCO_LEVELS[next.pendingChant.data?.level]?.name}!`, 'important');
  }

  // Truco accepted
  if (next.bet.level > prev.bet.level && !next.pendingChant) {
    const levelName  = TRUCO_LEVELS[next.bet.level]?.name || 'Truco';
    const acceptSeat = next.players?.find(p => p.team !== next.bet.lastRaiserTeam)?.seat;
    const acceptName = acceptSeat !== undefined ? next.players[acceptSeat]?.name : '?';
    uiLog(`${acceptName} acepta ${levelName}. Vale ${TRUCO_LEVELS[next.bet.level]?.pts} pts.`, 'important');
    uiShowTrucoToast(acceptName);
  }

  // Truco rejected (pending disappeared without bet rising, hand still going)
  if (!next.pendingChant && prev.pendingChant?.type === 'truco'
      && next.bet.level === prev.bet.level && next.trickHistory.length === prev.trickHistory.length) {
    const { raiserTeam, level } = prev.pendingChant.data || {};
    const respName = next.players?.[prev.pendingChant.responderSeat]?.name || '?';
    uiLog(`${respName} rechaza. Eq ${raiserTeam} cobra ${TRUCO_LEVELS[(level??1)-1]?.pts} pts.`, 'points');
  }

  // Envido called / raised
  if (next.chant.envido.calls.length > prev.chant.envido.calls.length) {
    const call       = next.chant.envido.calls.at(-1);
    const callerName = next.players?.[next.chant.envido.callerSeat]?.name || '?';
    uiLog(`${callerName} canta ${call}.`, 'important');
  }

  // Envido resolved
  if (next.chant.envido.resolved && !prev.chant.envido.resolved) {
    if (next.chant.envido.accepted) uiLog('Envido aceptado.', 'points');
    else uiLog(`Envido rechazado. Eq ${next.chant.envido.callerTeam} cobra pts.`, 'points');
  }

  // Flor
  if (next.pendingChant?.type === 'flor' && prev.pendingChant?.type !== 'flor')
    uiLog(`${next.players?.[next.pendingChant.callerSeat]?.name || '?'} canta Flor.`, 'important');

  // Scores updated (hand finished)
  if (next.scores[0] !== prev.scores[0] || next.scores[1] !== prev.scores[1]) {
    const d0 = next.scores[0] - prev.scores[0];
    const d1 = next.scores[1] - prev.scores[1];
    uiLog(`=== Mano ${prev.handNum}: +${d0}/${d1} → Total ${next.scores[0]}–${next.scores[1]} ===`, 'important');
  }
}

// ── Deal animation ────────────────────────────────────────────────

function triggerDealAnimation(state) {
  const overlay = document.createElement('div');
  overlay.className = 'new-hand-overlay';
  const manoName = state.players?.[state.manoSeat]?.name || '?';
  overlay.innerHTML = `
    <div class="new-hand-label">Mano ${state.handNum}</div>
    <div class="new-hand-num">Partida a ${state.target} pts · ${state.scores[0]}–${state.scores[1]}</div>
    <div class="mano-indicator">✦ Es mano: ${manoName} ✦</div>`;
  document.body.appendChild(overlay);
  renderCurrentGame(); // update header + action panel

  setTimeout(() => {
    overlay.remove();
    // dealCardsAnimated reads G.viewerSeat in online mode (patched in game.ts)
    dealCardsAnimated(() => renderCurrentGame());
  }, 2500);
}

// ── Collapse animation for online ─────────────────────────────────
// Problem: server resolves trick synchronously → by the time client receives state,
// playsThisTrick is already {} (cleared by nextTrick).
// Solution: reconstruct playsThisTrick from players[seat].played (which keeps full
// quantum cards including options and collapsedTo) and trickHistory for seat order.

function runCollapseAnimation(state, prevState, onDone) {
  if (typeof document === 'undefined') { onDone(); return; }

  const lastEntry = state.trickHistory[state.trickHistory.length - 1];
  if (!lastEntry || lastEntry.length < 2) { onDone(); return; }

  // Reconstruct playsThisTrick from players[seat].played (last played card per seat)
  // filterStateForSeat does NOT hide played[], so opponent's played cards are visible.
  const reconstructed = {};
  const seatOrder = lastEntry.map(e => e.seat); // preserves original playOrder

  for (const { seat, card } of lastEntry) {
    const p       = state.players[seat];
    const played  = p?.played || [];
    // Find the played card that matches the collapsed card
    const qc = played.find(q => q.collapsedTo && q.collapsedTo.rank === card.rank && q.collapsedTo.suit === card.suit)
            ?? played[played.length - 1]; // fallback: last played

    if (qc && qc.options && qc.options.length === 2) {
      reconstructed[seat] = { ...qc }; // full quantum card with options + collapsedTo
    }
  }

  if (Object.keys(reconstructed).length < 2) {
    // Can't animate — just render final state
    onDone();
    return;
  }

  // Temporarily restore playsThisTrick and playOrder so renderArena + animateCollapse work
  const savedPlaysThisTrick = G.playsThisTrick;
  const savedPlayOrder      = G.playOrder;
  const savedTrickIdx       = G.trickIdx;
  const savedPhase          = G.phase;

  // Set up animation state: playOrder from last trick, trickIdx = last trick
  G.playOrder      = seatOrder;
  G.playsThisTrick = {};
  // Temporarily null out collapsedTo so arena shows entangled cards
  for (const [seat, qc] of Object.entries(reconstructed)) {
    G.playsThisTrick[seat] = { ...qc, collapsedTo: null };
  }
  G.phase = 'collapsing';
  uiRenderGameFull(); // shows entangled cards in arena with ⊗ glow

  // Restore collapsedTo so animateCollapse can show the flip
  for (const [seat, qc] of Object.entries(reconstructed)) {
    G.playsThisTrick[seat].collapsedTo = qc.collapsedTo;
  }

  // Run the collapse animation
  setTimeout(() => {
    animateCollapse(() => {
      // Restore everything
      G.playsThisTrick = savedPlaysThisTrick;
      G.playOrder      = savedPlayOrder;
      G.trickIdx       = savedTrickIdx;
      G.phase          = savedPhase;
      onDone();
    });
  }, 800); // small pause so player sees entangled state
}

// ── Envido announcement ───────────────────────────────────────────

function maybeShowEnvidoDialog(prev, next) {
  if (!next.chant.envido.resolved || !next.chant.envido.accepted) return;
  if (prev && prev.chant.envido.resolved) return; // already shown

  // Build finalCards from players[].played (collapsed)
  const finalCards = {};
  for (const p of next.players) {
    finalCards[p.seat] = p.played.map(q => q.collapsedTo).filter(Boolean);
    // If played is empty (cards not collapsed yet), use hand's visible card
    if (!finalCards[p.seat].length) {
      finalCards[p.seat] = p.hand.map(q => q.collapsedTo).filter(Boolean);
    }
  }

  const pts = envidoTotalIfAccepted(
    next.chant.envido.calls,
    next.chant.envido.callerTeam,
    next.target,
    next.scores
  );

  // Build minimal res object that showEnvidoAnnouncement expects
  const teamScores = { 0: 0, 1: 0 };
  for (const p of next.players) {
    if (finalCards[p.seat]?.length) {
      const s = finalCards[p.seat].reduce((best, c) => {
        // Simple max envidoValue
        return best; // showEnvidoAnnouncement will compute it internally
      }, 0);
      teamScores[p.team] = Math.max(teamScores[p.team], 0);
    }
  }
  const winner = next.handScore[0] > next.handScore[1] ? 0 : 1;
  const res = { winner, teamScores };

  uiShowEnvidoAnnouncement(res, pts, finalCards);
}

// ── Main state installer ──────────────────────────────────────────

function installStateEnvelope(envelope) {
  const state = envelope.state;
  if (!state) return;

  // Capture previous state BEFORE installing new one
  const prevState = _prevG ? cloneGameState(_prevG) : null;

  // Annotate with online session metadata
  state.onlineMode        = true;
  state.viewerSeat        = session.seat;
  state.roomCode          = session.roomCode;
  state.roomId            = session.roomId;
  state.statusText        = envelope.statusText || '';
  state.opponentConnected = envelope.opponentConnected;
  state.roomReady         = envelope.roomReady;

  // Install → G = state
  installOnlineState(state);

  // Save snapshot of what was just installed (deep clone)
  _prevG = cloneGameState(state);

  setHeaderStatus(envelope.statusText || 'En línea');
  syncLeaveButton(true);

  if (state.matchEnded) {
    const wt   = state.winnerTeam ?? 0;
    const name = state.winnerName || state.players?.[wt === 0 ? 0 : 1]?.name || 'Ganador';
    showWinState(`¡${String(name).toUpperCase()} GANA!`, '', `${state.scores[0]} — ${state.scores[1]}`);
    showScreenById('screen-win');
    return;
  }

  showScreenById('screen-game');
  synthesizeLog(prevState, state);

  // ── First connection ever: deal animation ─────────────────────
  if (!prevState) {
    triggerDealAnimation(state);
    return;
  }

  // ── New hand: deal animation ──────────────────────────────────
  if (state.handNum !== prevState.handNum) {
    triggerDealAnimation(state);
    return;
  }

  // ── Trick just resolved: collapse + sweep ─────────────────────
  // Detected by trickHistory growing (works even after playsThisTrick is cleared)
  const trickJustResolved = state.trickHistory.length > prevState.trickHistory.length;

  if (trickJustResolved) {
    runCollapseAnimation(state, prevState, () => {
      renderCurrentGame();
      // Sweep then render next tick
      const isHandOver = state.phase === 'hand_end';
      if (!isHandOver) {
        setTimeout(() => animateSweepTrick(() => renderCurrentGame()), 2000);
      }
    });
    return;
  }

  // ── Envido resolved: show announcement ───────────────────────
  if (state.chant?.envido?.resolved && !prevState.chant?.envido?.resolved && state.chant.envido.accepted) {
    maybeShowEnvidoDialog(prevState, state);
    renderCurrentGame();
    return;
  }

  // ── Card played (1st card): drop animation ────────────────────
  const prevCount = Object.keys(prevState.playsThisTrick || {}).length;
  const nextCount = Object.keys(state.playsThisTrick  || {}).length;
  if (nextCount > prevCount) {
    renderCurrentGame();
    setTimeout(() => {
      const slots = document.querySelectorAll('#arena-slots .arena-slot');
      const last  = slots[slots.length - 1];
      if (last) { last.classList.add('dropping'); setTimeout(() => last.classList.remove('dropping'), 600); }
    }, 30);
    return;
  }

  // ── Default ───────────────────────────────────────────────────
  renderCurrentGame();
}

// ── WebSocket ─────────────────────────────────────────────────────

function handleMessage(payload) {
  if (!payload || typeof payload !== 'object') return;
  switch (payload.type) {
    case 'room_waiting':
      setupCfg.mode = 'online_1v1'; _prevG = null;
      setStatus(`Sala ${payload.roomCode}: esperando rival…`, 'warn');
      setHeaderStatus(`Sala ${payload.roomCode}`);
      syncLeaveButton(false); showScreenById('screen-setup'); return;
    case 'action_rejected':
      setStatus(payload.error || 'Acción rechazada.', 'err'); return;
    case 'rematch_waiting':
      setStatus(payload.statusText || 'Esperando revancha…', 'warn');
      setHeaderStatus(payload.statusText || ''); return;
    case 'room_closed':
      setStatus(payload.statusText || 'La sala se cerró.', 'err');
      leaveOnlineRoom(false); return;
    case 'room_state': case 'presence_update':
      installStateEnvelope(payload);
      if (payload.statusText) setStatus(payload.statusText, payload.opponentConnected === false ? 'warn' : 'ok');
      return;
  }
}

function scheduleReconnect() {
  if (!session.roomId || !session.token || session.reconnectTimer) return;
  session.reconnectTimer = window.setTimeout(() => { session.reconnectTimer = null; connectSocket(); }, 1500);
}

function connectSocket() {
  if (!session.roomId || !session.token) return;
  if (session.socket && (session.socket.readyState === WebSocket.OPEN || session.socket.readyState === WebSocket.CONNECTING)) return;
  const sock = new WebSocket(wsUrl(session.roomId, session.token));
  session.socket = sock;
  setStatus(`Conectando a la sala ${session.roomCode}…`, 'warn');
  sock.addEventListener('open', () => {
    session.connected = true;
    setStatus(`Conectado a la sala ${session.roomCode}.`, 'ok');
    setHeaderStatus(`Sala ${session.roomCode}`);
    persistSession();
  });
  sock.addEventListener('message', ev => { try { handleMessage(JSON.parse(ev.data)); } catch (e) { console.error('[ws]', e); } });
  const onDisc = () => {
    session.connected = false;
    if (!session.roomId) return;
    setStatus(`Conexión perdida. Reintentando…`, 'warn'); setHeaderStatus('Reconectando…'); scheduleReconnect();
  };
  sock.addEventListener('close', onDisc); sock.addEventListener('error', onDisc);
}

function sendAction(msg) {
  if (!session.socket || session.socket.readyState !== WebSocket.OPEN) { setStatus('Sin conexión.', 'err'); return; }
  session.socket.send(JSON.stringify(msg));
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved?.roomId || !saved?.token) return false;
    Object.assign(session, { roomId: saved.roomId, roomCode: saved.roomCode || saved.roomId, token: saved.token, seat: saved.seat });
    setupCfg.mode = 'online_1v1';
    updateSelectedMode();
    setStatus(`Reconectando a la sala ${session.roomCode}…`, 'warn');
    connectSocket(); return true;
  } catch { return false; }
}

// ── Public exports ────────────────────────────────────────────────

export function isOnlineClientMode() { return setupCfg.mode === 'online_1v1' || !!session.roomId; }

export function bootstrapOnlineUi() { syncLeaveButton(false); restoreSession(); }

export async function createOnlineRoomFromUI() {
  setupCfg.mode = 'online_1v1'; _prevG = null;
  try {
    const res  = await fetch(apiUrl('/api/rooms/create'), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ target: setupCfg.target, conFlor: !!setupCfg.conFlor }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    Object.assign(session, { roomId: data.roomId, roomCode: data.roomCode, token: data.token, seat: data.seat, pendingRematch: false });
    persistSession();
    const input = document.getElementById('room-code-input');
    if (input) input.value = data.roomCode;
    setStatus(`Sala ${data.roomCode} creada. Compartí el código.`, 'ok');
    connectSocket();
  } catch (err) { setStatus(err?.message || 'Error al crear sala.', 'err'); }
}

export async function joinOnlineRoomFromUI() {
  setupCfg.mode = 'online_1v1'; _prevG = null;
  const input    = document.getElementById('room-code-input');
  const roomCode = String(input?.value || '').trim().toUpperCase();
  if (!roomCode) { setStatus('Ingresá un código de sala.', 'err'); return; }
  try {
    const res  = await fetch(apiUrl('/api/rooms/join'), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ roomCode }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    Object.assign(session, { roomId: data.roomId, roomCode: data.roomCode, token: data.token, seat: data.seat, pendingRematch: false });
    persistSession();
    setStatus(`Te uniste a la sala ${data.roomCode}.`, 'ok');
    connectSocket();
  } catch (err) { setStatus(err?.message || 'Error al unirse.', 'err'); }
}

export function leaveOnlineRoom(sendLeave = true) {
  if (sendLeave && session.socket?.readyState === WebSocket.OPEN) try { session.socket.send(JSON.stringify({ type: 'leave_room' })); } catch {}
  try { session.socket?.close(); } catch {}
  Object.assign(session, { roomId:'', roomCode:'', token:'', seat:null, socket:null, connected:false, pendingRematch:false });
  _prevG = null;
  if (session.reconnectTimer) { clearTimeout(session.reconnectTimer); session.reconnectTimer = null; }
  clearSessionStorage(); setHeaderStatus(''); syncLeaveButton(false);
  setStatus('Fuera de la sala.', ''); showScreenById('screen-setup');
}

export function requestOnlineRematch() {
  if (!isOnlineClientMode()) return;
  session.pendingRematch = true; _prevG = null;
  setStatus('Pediste revancha. Esperando al rival…', 'warn');
  sendAction({ type: 'request_rematch' });
}

export function sendPlayCard(cardIndex)    { sendAction({ type: 'play_card', cardIndex }); }
export function sendSingTruco()            { sendAction({ type: 'sing_truco' }); }
export function sendRespondTruco(accept)   { sendAction({ type: 'respond_truco', action: accept ? 'accept' : 'reject' }); }
export function sendRaiseTruco()           { sendAction({ type: 'raise_truco' }); }
export function sendInitiateEnvido(call)   { sendAction({ type: 'initiate_envido', call }); }
export function sendRespondEnvido(action)  { sendAction({ type: 'respond_envido', action }); }
export function sendSingFlor()             { sendAction({ type: 'sing_flor' }); }
export function sendRespondFlor(action)    { sendAction({ type: 'respond_flor', action }); }
export function sendGoToMazo()             { sendAction({ type: 'go_to_mazo' }); }
