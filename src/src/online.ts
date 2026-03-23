// @ts-nocheck
// online.ts — IMPORTANT: must NOT import from ui.ts (circular dependency).
// All UI calls go through game.ts runtime wrappers (uiLog, uiRenderGameFull, etc.)

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
  uiRenderArenaOnly,
  TRUCO_LEVELS,
  teamOf,
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

// Previous state snapshot — used for diffing to synthesize animations + log
let _prevG = null;

// ── Network helpers ───────────────────────────────────────────────

function onlineBase() {
  return 'https://quantum-truco-online.valentinreparaz.workers.dev';
}

function apiUrl(path) {
  return `${onlineBase().replace(/\/$/, '')}${path}`;
}

function wsUrl(roomId, token) {
  const base = onlineBase();
  const u    = new URL(base.replace(/\/$/, ''));
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = `/api/rooms/connect/${roomId}`;
  u.searchParams.set('token', token);
  return u.toString();
}

function persistSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    roomId:   session.roomId,
    roomCode: session.roomCode,
    token:    session.token,
    seat:     session.seat,
  }));
}

function clearSessionStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Status helpers ────────────────────────────────────────────────

function setStatus(text, cls = '') {
  const el = document.getElementById('online-status');
  if (!el) return;
  el.textContent = text || '';
  el.className   = `online-status ${cls}`.trim();
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
  document.querySelectorAll('.opt-btn[data-group="mode"]')
    .forEach(b => b.classList.remove('selected'));
  const btn = document.querySelector('.opt-btn[data-group="mode"][data-val="online_1v1"]');
  if (btn) btn.classList.add('selected');
}

// ── Log synthesis (diff prev → next) ─────────────────────────────

function synthesizeLog(prev, next) {
  if (!prev) return;

  // New hand
  if (next.handNum !== prev.handNum) {
    uiLog(`=== Mano ${next.handNum} · ${next.scores[0]}–${next.scores[1]} ===`, 'important');
    const manoName = next.players?.[next.manoSeat]?.name || '?';
    uiLog(`✦ Es mano: ${manoName}`, 'important');
    return;
  }

  // New cards played
  const prevPlays = Object.keys(prev.playsThisTrick || {}).map(Number);
  const nextPlays = Object.keys(next.playsThisTrick || {}).map(Number);
  for (const seat of nextPlays) {
    if (!prevPlays.includes(seat)) {
      const name = next.players?.[seat]?.name || `Jugador ${seat + 1}`;
      uiLog(`${name} juega carta cuántica`, 'collapse');
    }
  }

  // Trick resolved — new entry in trickWinners
  if (next.trickWinners.length > prev.trickWinners.length) {
    const idx    = prev.trickWinners.length;
    const winner = next.trickWinners[idx];
    if (winner === -1) {
      const manoName = next.players?.[next.manoSeat]?.name || '?';
      uiLog(`Baza ${idx + 1}: PARDA — sale el mano (${manoName})`, 'important');
    } else {
      const winSeat = next.players?.find(p => teamOf(p.seat) === winner)?.seat;
      const winName = winSeat !== undefined ? next.players[winSeat]?.name : `Eq ${winner}`;
      uiLog(`Baza ${idx + 1}: Equipo ${winner} · ${winName}`, 'important');
    }
    // Show collapsed cards
    for (const [seatStr, qc] of Object.entries(next.playsThisTrick || {})) {
      if (qc?.collapsedTo) {
        const name = next.players?.[+seatStr]?.name || '?';
        uiLog(`⊗ ${name}: ${qc.collapsedTo.rank} de ${qc.collapsedTo.suit}`, 'collapse');
      }
    }
  }

  // Truco sung
  if (next.pendingChant?.type === 'truco' && prev.pendingChant?.type !== 'truco') {
    const callerName = next.players?.[next.pendingChant.callerSeat]?.name || '?';
    const levelName  = TRUCO_LEVELS[next.pendingChant.data?.level]?.name || 'Truco';
    uiLog(`${callerName}: ¡${levelName}!`, 'important');
    const phrases = {
      'Truco':   ['¡Truco!', '¡Ahí va el truco!', '¡Trucoooo!'],
      'Retruco': ['¡Retruco!', '¡Mate y retruco!', '¡Retruco, che!'],
      'Vale 4':  ['¡Vale cuatro!', '¡Vale cuatro, jugado!'],
    };
    const opts = phrases[levelName] || [`¡${levelName}!`];
    uiShowTrucoCallToast(opts[Math.floor(Math.random() * opts.length)]);
  }

  // Truco accepted (bet.level rose, no pending truco)
  if (next.bet.level > prev.bet.level && !next.pendingChant) {
    const levelName  = TRUCO_LEVELS[next.bet.level]?.name || 'Truco';
    const raiserTeam = next.bet.lastRaiserTeam;
    const acceptSeat = next.players?.find(p => p.team !== raiserTeam)?.seat;
    const acceptName = acceptSeat !== undefined ? next.players[acceptSeat]?.name : '?';
    const pts        = TRUCO_LEVELS[next.bet.level]?.pts || 2;
    uiLog(`${acceptName} acepta ${levelName}. Vale ${pts} pts.`, 'important');
    uiShowTrucoToast(acceptName);
  }

  // Truco rejected (pending truco disappeared, bet level unchanged)
  if (!next.pendingChant && prev.pendingChant?.type === 'truco'
      && next.bet.level === prev.bet.level && next.trickWinners.length === prev.trickWinners.length) {
    const { raiserTeam, level } = prev.pendingChant.data || {};
    const respName = next.players?.[prev.pendingChant.responderSeat]?.name || '?';
    const pts      = TRUCO_LEVELS[(level ?? 1) - 1]?.pts || 1;
    uiLog(`${respName} rechaza. Eq ${raiserTeam} cobra ${pts} pts.`, 'points');
  }

  // Truco raised (responder became caller at higher level)
  if (next.pendingChant?.type === 'truco' && prev.pendingChant?.type === 'truco'
      && next.pendingChant.data?.level > prev.pendingChant.data?.level) {
    const raiserName = next.players?.[next.pendingChant.callerSeat]?.name || '?';
    const newLevel   = TRUCO_LEVELS[next.pendingChant.data?.level]?.name || 'Retruco';
    uiLog(`${raiserName} sube a ${newLevel}!`, 'important');
  }

  // Envido called / raised
  if (next.chant.envido.calls.length > prev.chant.envido.calls.length) {
    const call       = next.chant.envido.calls[next.chant.envido.calls.length - 1];
    const callerSeat = next.chant.envido.callerSeat;
    const callerName = next.players?.[callerSeat]?.name || '?';
    uiLog(`${callerName} canta ${call}.`, 'important');
  }

  // Envido accepted
  if (next.chant.envido.resolved && !prev.chant.envido.resolved && next.chant.envido.accepted) {
    const respSeat = next.pendingChant?.callerSeat ?? next.chant.envido.callerSeat;
    uiLog('Envido aceptado.', 'points');
  }

  // Envido rejected
  if (next.chant.envido.resolved && !prev.chant.envido.resolved && !next.chant.envido.accepted) {
    const callerTeam = next.chant.envido.callerTeam;
    uiLog(`Envido rechazado. Eq ${callerTeam} cobra pts.`, 'points');
  }

  // Flor sung
  if (next.pendingChant?.type === 'flor' && prev.pendingChant?.type !== 'flor') {
    const callerName = next.players?.[next.pendingChant.callerSeat]?.name || '?';
    uiLog(`${callerName} canta Flor.`, 'important');
  }

  // Scores updated (hand finished)
  if (next.scores[0] !== prev.scores[0] || next.scores[1] !== prev.scores[1]) {
    const d0 = next.scores[0] - prev.scores[0];
    const d1 = next.scores[1] - prev.scores[1];
    uiLog(`=== Mano ${prev.handNum}: +${d0}/${d1} → Total ${next.scores[0]}–${next.scores[1]} ===`, 'important');
  }
}

// ── Collapse animation for online ─────────────────────────────────
// Strategy:
//   1. Temporarily null collapsedTo so renderArena shows entangled cards
//   2. Set phase='collapsing' and render → shows ⊗ glow effect on cards
//   3. Restore collapsedTo
//   4. Run animateCollapse() — it reads both .options and .collapsedTo to do the flip crossfade
//   5. On done → renderCurrentGame() with final state

function runOnlineTrickAnimation(prevState, currentState, onDone) {
  if (typeof document === 'undefined') { onDone(); return; }

  // Save collapsedTo values, then null them out
  const savedCollapsed = {};
  for (const [seatStr, qc] of Object.entries(currentState.playsThisTrick || {})) {
    savedCollapsed[seatStr] = qc.collapsedTo;
    qc.collapsedTo = null;
  }

  // Show uncollapsed (entangled) state in arena
  const savedPhase = currentState.phase;
  currentState.phase = 'collapsing';
  uiRenderGameFull();

  // Restore collapsedTo — now animateCollapse can use both options + collapsedTo
  for (const [seatStr, qc] of Object.entries(currentState.playsThisTrick || {})) {
    qc.collapsedTo = savedCollapsed[seatStr];
  }

  // Short pause so player sees entangled state, then collapse
  setTimeout(() => {
    animateCollapse(() => {
      currentState.phase = savedPhase;
      onDone();
    });
  }, 600);
}

// ── Main state installer ──────────────────────────────────────────

function installStateEnvelope(envelope) {
  const state = envelope.state;
  if (!state) return;

  const prevState = _prevG ? cloneGameState(_prevG) : null;

  // Annotate state with online metadata
  state.onlineMode        = true;
  state.viewerSeat        = session.seat;
  state.roomCode          = session.roomCode;
  state.roomId            = session.roomId;
  state.statusText        = envelope.statusText || '';
  state.opponentConnected = envelope.opponentConnected;
  state.roomReady         = envelope.roomReady;

  // Install into G
  installOnlineState(state);

  // Save snapshot AFTER install (so _prevG reflects what was just installed)
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

  // Synthesize log entries from diff
  synthesizeLog(prevState, state);

  // ── First connection: just render ──────────────────────────────
  if (!prevState) {
    renderCurrentGame();
    return;
  }

  // ── New hand: deal animation ───────────────────────────────────
  if (state.handNum !== prevState.handNum) {
    const overlay = document.createElement('div');
    overlay.className = 'new-hand-overlay';
    const manoName = state.players?.[state.manoSeat]?.name || '?';
    overlay.innerHTML = `
      <div class="new-hand-label">Mano ${state.handNum}</div>
      <div class="new-hand-num">Partida a ${state.target} pts · ${state.scores[0]}–${state.scores[1]}</div>
      <div class="mano-indicator">✦ Es mano: ${manoName} ✦</div>`;
    document.body.appendChild(overlay);
    renderCurrentGame(); // header + action panel update

    setTimeout(() => {
      overlay.remove();
      // dealCardsAnimated uses G.viewerSeat in online mode (patched in game.ts)
      dealCardsAnimated(() => renderCurrentGame());
    }, 2500);
    return;
  }

  // ── Trick resolved: collapse animation ────────────────────────
  const trickJustResolved = state.trickWinners.length > prevState.trickWinners.length
    && Object.keys(prevState.playsThisTrick || {}).length >= 2;

  if (trickJustResolved) {
    // We need the arena to first show the played (entangled) cards from prevState
    // but G is already set to state (with collapsedTo set).
    // runOnlineTrickAnimation temporarily nulls collapsedTo, renders, then animates.
    runOnlineTrickAnimation(prevState, state, () => {
      renderCurrentGame();
      // Sweep cards off table after a pause
      if (state.phase === 'baza_end' || state.phase === 'chant' || state.phase === 'play') {
        setTimeout(() => animateSweepTrick(() => renderCurrentGame()), 2000);
      }
    });
    return;
  }

  // ── Card played: drop animation on new arena slot ─────────────
  const prevCount = Object.keys(prevState.playsThisTrick || {}).length;
  const nextCount = Object.keys(state.playsThisTrick  || {}).length;
  if (nextCount > prevCount) {
    renderCurrentGame();
    // Bounce the newly-appeared slot
    setTimeout(() => {
      const slots = document.querySelectorAll('#arena-slots .arena-slot');
      const last  = slots[slots.length - 1];
      if (last) {
        last.classList.add('dropping');
        setTimeout(() => last.classList.remove('dropping'), 600);
      }
    }, 30);
    return;
  }

  // ── Default ────────────────────────────────────────────────────
  renderCurrentGame();
}

// ── WebSocket ─────────────────────────────────────────────────────

function handleMessage(payload) {
  if (!payload || typeof payload !== 'object') return;

  switch (payload.type) {
    case 'room_waiting':
      setupCfg.mode = 'online_1v1';
      _prevG = null;
      setStatus(`Sala ${payload.roomCode}: esperando rival…`, 'warn');
      setHeaderStatus(`Sala ${payload.roomCode}`);
      syncLeaveButton(false);
      showScreenById('screen-setup');
      return;

    case 'action_rejected':
      setStatus(payload.error || 'Acción rechazada.', 'err');
      return;

    case 'rematch_waiting':
      setStatus(payload.statusText || 'Esperando revancha…', 'warn');
      setHeaderStatus(payload.statusText || '');
      return;

    case 'room_closed':
      setStatus(payload.statusText || 'La sala se cerró.', 'err');
      leaveOnlineRoom(false);
      return;

    case 'room_state':
    case 'presence_update':
      installStateEnvelope(payload);
      if (payload.statusText)
        setStatus(payload.statusText, payload.opponentConnected === false ? 'warn' : 'ok');
      return;
  }
}

function scheduleReconnect() {
  if (!session.roomId || !session.token || session.reconnectTimer) return;
  session.reconnectTimer = window.setTimeout(() => {
    session.reconnectTimer = null;
    connectSocket();
  }, 1500);
}

function connectSocket() {
  if (!session.roomId || !session.token) return;
  if (session.socket &&
      (session.socket.readyState === WebSocket.OPEN ||
       session.socket.readyState === WebSocket.CONNECTING)) return;

  const sock     = new WebSocket(wsUrl(session.roomId, session.token));
  session.socket = sock;
  setStatus(`Conectando a la sala ${session.roomCode}…`, 'warn');

  sock.addEventListener('open', () => {
    session.connected = true;
    setStatus(`Conectado a la sala ${session.roomCode}.`, 'ok');
    setHeaderStatus(`Sala ${session.roomCode}`);
    persistSession();
  });

  sock.addEventListener('message', ev => {
    try { handleMessage(JSON.parse(ev.data)); }
    catch (err) { console.error('[online] ws parse error:', err); }
  });

  const onDisconnect = () => {
    session.connected = false;
    if (!session.roomId) return;
    setStatus(`Conexión perdida. Reintentando…`, 'warn');
    setHeaderStatus('Reconectando…');
    scheduleReconnect();
  };
  sock.addEventListener('close', onDisconnect);
  sock.addEventListener('error', onDisconnect);
}

function sendAction(msg) {
  if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
    setStatus('No hay conexión activa.', 'err');
    return;
  }
  session.socket.send(JSON.stringify(msg));
}

// ── Reconnect on load ─────────────────────────────────────────────

function restoreSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved?.roomId || !saved?.token) return false;
    session.roomId   = saved.roomId;
    session.roomCode = saved.roomCode || saved.roomId;
    session.token    = saved.token;
    session.seat     = saved.seat;
    setupCfg.mode    = 'online_1v1';
    updateSelectedMode();
    setStatus(`Reconectando a la sala ${session.roomCode}…`, 'warn');
    connectSocket();
    return true;
  } catch { return false; }
}

// ── Public exports ────────────────────────────────────────────────

export function isOnlineClientMode() {
  return setupCfg.mode === 'online_1v1' || !!session.roomId;
}

export function bootstrapOnlineUi() {
  syncLeaveButton(false);
  restoreSession();
}

export async function createOnlineRoomFromUI() {
  setupCfg.mode = 'online_1v1';
  _prevG = null;
  try {
    const res  = await fetch(apiUrl('/api/rooms/create'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: setupCfg.target, conFlor: !!setupCfg.conFlor }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    session.roomId   = data.roomId;
    session.roomCode = data.roomCode;
    session.token    = data.token;
    session.seat     = data.seat;
    session.pendingRematch = false;
    persistSession();
    const input = document.getElementById('room-code-input');
    if (input) input.value = data.roomCode;
    setStatus(`Sala ${data.roomCode} creada. Compartí el código con tu rival.`, 'ok');
    connectSocket();
  } catch (err) {
    setStatus(err?.message || 'No se pudo crear la sala.', 'err');
  }
}

export async function joinOnlineRoomFromUI() {
  setupCfg.mode = 'online_1v1';
  _prevG = null;
  const input    = document.getElementById('room-code-input');
  const roomCode = String(input?.value || '').trim().toUpperCase();
  if (!roomCode) { setStatus('Ingresá un código de sala.', 'err'); return; }
  try {
    const res  = await fetch(apiUrl('/api/rooms/join'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    session.roomId   = data.roomId;
    session.roomCode = data.roomCode;
    session.token    = data.token;
    session.seat     = data.seat;
    session.pendingRematch = false;
    persistSession();
    setStatus(`Te uniste a la sala ${data.roomCode}.`, 'ok');
    connectSocket();
  } catch (err) {
    setStatus(err?.message || 'No se pudo entrar a la sala.', 'err');
  }
}

export function leaveOnlineRoom(sendLeave = true) {
  if (sendLeave && session.socket?.readyState === WebSocket.OPEN) {
    try { session.socket.send(JSON.stringify({ type: 'leave_room' })); } catch {}
  }
  try { session.socket?.close(); } catch {}
  Object.assign(session, {
    roomId: '', roomCode: '', token: '', seat: null,
    socket: null, connected: false, pendingRematch: false,
  });
  _prevG = null;
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }
  clearSessionStorage();
  setHeaderStatus('');
  syncLeaveButton(false);
  setStatus('Fuera de la sala.', '');
  showScreenById('screen-setup');
}

export function requestOnlineRematch() {
  if (!isOnlineClientMode()) return;
  session.pendingRematch = true;
  _prevG = null;
  setStatus('Pediste revancha. Esperando al rival…', 'warn');
  sendAction({ type: 'request_rematch' });
}

// Action senders
export function sendPlayCard(cardIndex)    { sendAction({ type: 'play_card', cardIndex }); }
export function sendSingTruco()            { sendAction({ type: 'sing_truco' }); }
export function sendRespondTruco(accept)   { sendAction({ type: 'respond_truco', action: accept ? 'accept' : 'reject' }); }
export function sendRaiseTruco()           { sendAction({ type: 'raise_truco' }); }
export function sendInitiateEnvido(call)   { sendAction({ type: 'initiate_envido', call }); }
export function sendRespondEnvido(action)  { sendAction({ type: 'respond_envido', action }); }
export function sendSingFlor()             { sendAction({ type: 'sing_flor' }); }
export function sendRespondFlor(action)    { sendAction({ type: 'respond_flor', action }); }
export function sendGoToMazo()             { sendAction({ type: 'go_to_mazo' }); }
