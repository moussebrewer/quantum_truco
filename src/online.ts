// @ts-nocheck
import {
  G,
  setupCfg,
  installOnlineState,
  renderCurrentGame,
  showScreenById,
  showWinState,
  cloneGameState,
  uiLog,
  TRUCO_LEVELS,
  teamOf,
  animateCollapse,
  animateSweepTrick,
  dealCardsAnimated,
  allSeats,
} from './game';

import {
  showTrucoCallToast,
  showTrucoToast,
  showEnvidoAnnouncement,
  renderGame,
  renderArena,
} from './ui';

const STORAGE_KEY = 'qt-online-session';

const session = {
  roomId: '',
  roomCode: '',
  token: '',
  seat: null,
  socket: null,
  connected: false,
  reconnectTimer: null,
  pendingRematch: false,
};

// ── State diffing: previous G snapshot ───────────────────────────
let _prevG = null;

function onlineBase() {
  return 'https://quantum-truco-online.valentinreparaz.workers.dev';
}

function apiUrl(path) {
  const base = onlineBase();
  if (!base) return path;
  return `${base.replace(/\/$/, '')}${path}`;
}

function wsUrl(roomId, token) {
  const base = onlineBase();
  if (base) {
    const u = new URL(base.replace(/\/$/, ''));
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = `/api/rooms/connect/${roomId}`;
    u.searchParams.set('token', token);
    return u.toString();
  }
  const u = new URL(window.location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = `/api/rooms/connect/${roomId}`;
  u.searchParams.set('token', token);
  u.hash = '';
  return u.toString();
}

function persistSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    roomId: session.roomId,
    roomCode: session.roomCode,
    token: session.token,
    seat: session.seat,
  }));
}

function clearSessionStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

function setStatus(text, cls = '') {
  const el = document.getElementById('online-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `online-status ${cls}`.trim();
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
  const online = document.querySelector('.opt-btn[data-group="mode"][data-val="online_1v1"]');
  if (online) online.classList.add('selected');
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved?.roomId || !saved?.token) return false;
    session.roomId = saved.roomId;
    session.roomCode = saved.roomCode || saved.roomId;
    session.token = saved.token;
    session.seat = saved.seat;
    setupCfg.mode = 'online_1v1';
    updateSelectedMode();
    setStatus(`Reconectando a la sala ${session.roomCode}…`, 'warn');
    connectSocket();
    return true;
  } catch {
    return false;
  }
}

async function postJson(path, body) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ── State diff: synthesize all visual effects from what changed ───

function synthesizeLog(prev, next) {
  if (!prev) return;
  const viewSeat = session.seat ?? 0;

  // New hand started
  if (next.handNum > prev.handNum) {
    uiLog(`=== Mano ${next.handNum} · ${next.scores[0]}–${next.scores[1]} ===`, 'important');
    const manoName = next.players[next.manoSeat]?.name || '?';
    uiLog(`✦ Es mano: ${manoName}`, 'important');
    return; // rest of log will follow after actions
  }

  // Cards played this tick
  const prevSeats = new Set(Object.keys(prev.playsThisTrick || {}).map(Number));
  const nextSeats = new Set(Object.keys(next.playsThisTrick || {}).map(Number));
  for (const seat of nextSeats) {
    if (!prevSeats.has(seat)) {
      const name = next.players[seat]?.name || `Jugador ${seat + 1}`;
      uiLog(`${name} juega carta cuántica`, 'collapse');
    }
  }

  // Trick just resolved — trickWinners grew
  if (next.trickWinners.length > prev.trickWinners.length) {
    const idx    = prev.trickWinners.length;
    const winner = next.trickWinners[idx];
    if (winner === -1) {
      const manoName = next.players[next.manoSeat]?.name || '?';
      uiLog(`Baza ${idx + 1}: PARDA — sale el mano (${manoName})`, 'important');
    } else {
      // Find winning seat
      const winSeat = next.players.find(p => teamOf(p.seat) === winner)?.seat;
      const winName = winSeat !== undefined ? next.players[winSeat]?.name : `Eq ${winner}`;
      uiLog(`Baza ${idx + 1}: Equipo ${winner} · ${winName}`, 'important');
    }
    // Collapse log: show what each card collapsed to
    for (const [seatStr, qc] of Object.entries(next.playsThisTrick || {})) {
      if (qc?.collapsedTo && prev.playsThisTrick?.[seatStr]?.collapsedTo === null) {
        const name = next.players[parseInt(seatStr)]?.name || '?';
        uiLog(`⊗ ${name}: ${qc.collapsedTo.rank} de ${qc.collapsedTo.suit}`, 'collapse');
      }
    }
  }

  // Truco sung / accepted
  const prevPending = prev.pendingChant;
  const nextPending = next.pendingChant;

  // New truco pending (someone just sang)
  if (nextPending?.type === 'truco' && prevPending?.type !== 'truco') {
    const callerName = next.players[nextPending.callerSeat]?.name || '?';
    const levelName  = TRUCO_LEVELS[nextPending.data?.level]?.name || 'Truco';
    uiLog(`${callerName}: ¡${levelName}!`, 'important');
    const phrases = {
      'Truco':   ['¡Truco!', '¡Ahí va el truco!', '¡Trucoooo!'],
      'Retruco': ['¡Retruco!', '¡Mate y retruco!'],
      'Vale 4':  ['¡Vale cuatro!', '¡Vale cuatro, jugado!'],
    };
    const opts = phrases[levelName] || [`¡${levelName}!`];
    const phrase = opts[Math.floor(Math.random() * opts.length)];
    if (showTrucoCallToast) showTrucoCallToast(phrase);
  }

  // Truco accepted (bet.level went up, no pending truco now)
  if (next.bet.level > prev.bet.level && !nextPending) {
    const levelName   = TRUCO_LEVELS[next.bet.level]?.name || 'Truco';
    const raiserTeam  = next.bet.lastRaiserTeam;
    // The accepter is the opponent of the raiser
    const acceptSeat  = next.players.find(p => p.team !== raiserTeam)?.seat;
    const acceptName  = acceptSeat !== undefined ? next.players[acceptSeat]?.name : '?';
    const pts         = TRUCO_LEVELS[next.bet.level]?.pts || 2;
    uiLog(`${acceptName} acepta ${levelName}. Vale ${pts} pts.`, 'important');
    if (showTrucoToast) showTrucoToast(acceptName);
  }

  // Truco rejected (hand ended, bet level didn't increase)
  if (!next.pendingChant && prev.pendingChant?.type === 'truco' && next.bet.level === prev.bet.level) {
    const { raiserTeam, level } = prev.pendingChant.data || {};
    const respSeat = prev.pendingChant.responderSeat;
    const respName = next.players[respSeat]?.name || '?';
    const pts      = TRUCO_LEVELS[level - 1]?.pts || 1;
    uiLog(`${respName} rechaza. Eq ${raiserTeam} cobra ${pts} pts.`, 'points');
  }

  // Envido called / raised
  if (next.chant.envido.calls.length > prev.chant.envido.calls.length) {
    const call       = next.chant.envido.calls[next.chant.envido.calls.length - 1];
    const callerSeat = next.chant.envido.callerSeat;
    const callerName = next.players[callerSeat]?.name || '?';
    uiLog(`${callerName} canta ${call}.`, 'important');
  }

  // Envido resolved
  if (next.chant.envido.resolved && !prev.chant.envido.resolved) {
    if (next.chant.envido.accepted) {
      uiLog(`Envido resuelto.`, 'points');
    } else {
      const callerTeam = next.chant.envido.callerTeam;
      uiLog(`Envido rechazado. Eq ${callerTeam} cobra pts.`, 'points');
    }
  }

  // Flor
  if (nextPending?.type === 'flor' && prevPending?.type !== 'flor') {
    const callerName = next.players[nextPending.callerSeat]?.name || '?';
    uiLog(`${callerName} canta Flor.`, 'important');
  }

  // Scores changed (hand ended)
  if (next.scores[0] !== prev.scores[0] || next.scores[1] !== prev.scores[1]) {
    const d0 = next.scores[0] - prev.scores[0];
    const d1 = next.scores[1] - prev.scores[1];
    uiLog(`=== Mano ${prev.handNum}: +${d0}/${d1} → Total ${next.scores[0]}–${next.scores[1]} ===`, 'important');
  }
}

// ── Animate the trick resolution for online ───────────────────────
// prev.playsThisTrick has the cards with options (entangled)
// next.playsThisTrick has the same cards with collapsedTo set
// We render entangled state, run collapse animation, then update

function animateOnlineTrick(prevState, nextState, onDone) {
  if (typeof document === 'undefined') { onDone(); return; }

  // 1. Set G to a hybrid: next state but with prev (uncollapsed) playsThisTrick
  //    so renderArena shows entangled cards
  const savedPlays  = nextState.playsThisTrick;
  const savedPhase  = nextState.phase;
  const savedTrickW = nextState.trickWinners;

  nextState.playsThisTrick = prevState.playsThisTrick;
  nextState.phase = 'collapsing';
  nextState.trickWinners = prevState.trickWinners;
  renderGame();

  // 2. Restore collapsed state in G (animateCollapse reads G.playsThisTrick[seat].collapsedTo)
  nextState.playsThisTrick = savedPlays;
  nextState.trickWinners   = savedTrickW;

  // 3. Run collapse animation (reads G.playsThisTrick for collapsedTo)
  setTimeout(() => {
    animateCollapse(() => {
      // 4. Restore phase and render final state
      nextState.phase = savedPhase;
      onDone();
    });
  }, 400);
}

// ── Main envelope handler ─────────────────────────────────────────

function installStateEnvelope(envelope) {
  const state = envelope.state;
  if (!state) return;

  // Save previous state snapshot before installing new one
  const prevState = _prevG ? cloneGameState(_prevG) : null;

  // Prepare state metadata
  state.onlineMode    = true;
  state.viewerSeat    = session.seat;
  state.roomCode      = session.roomCode;
  state.roomId        = session.roomId;
  state.statusText    = envelope.statusText || '';
  state.opponentConnected = envelope.opponentConnected;
  state.roomReady     = envelope.roomReady;

  // Install state (sets G = state)
  installOnlineState(state);
  _prevG = cloneGameState(state);

  setHeaderStatus(envelope.statusText || 'En línea');
  syncLeaveButton(true);

  if (state.matchEnded) {
    const winnerTeam = state.winnerTeam ?? 0;
    const winnerName = state.winnerName || state.players?.[winnerTeam === 0 ? 0 : 1]?.name || 'Ganador';
    showWinState(`¡${String(winnerName).toUpperCase()} GANA!`, '', `${state.scores[0]} — ${state.scores[1]}`);
    showScreenById('screen-win');
    return;
  }

  showScreenById('screen-game');

  // Synthesize log from state diff
  synthesizeLog(prevState, state);

  if (!prevState) {
    // First state: just render, trigger deal animation if needed
    renderCurrentGame();
    return;
  }

  // ── New hand: trigger deal animation ─────────────────────────
  if (state.handNum > prevState.handNum) {
    const overlay = document.createElement('div');
    overlay.className = 'new-hand-overlay';
    const manoName = state.players[state.manoSeat]?.name || '?';
    overlay.innerHTML = `
      <div class="new-hand-label">Mano ${state.handNum}</div>
      <div class="new-hand-num">Partida a ${state.target} pts · ${state.scores[0]}–${state.scores[1]}</div>
      <div class="mano-indicator">✦ Es mano: ${manoName} ✦</div>`;
    document.body.appendChild(overlay);
    renderCurrentGame(); // renders header + action panel
    setTimeout(() => {
      overlay.remove();
      dealCardsAnimated(() => renderCurrentGame());
    }, 2500);
    return;
  }

  // ── Trick just resolved: animate collapse ─────────────────────
  const trickJustResolved = state.trickWinners.length > prevState.trickWinners.length
    && Object.keys(prevState.playsThisTrick || {}).length > 0;

  if (trickJustResolved) {
    animateOnlineTrick(prevState, state, () => {
      renderCurrentGame();

      // Sweep cards after a pause, then render next trick state
      if (state.phase === 'baza_end' || state.phase === 'chant' || state.phase === 'play') {
        setTimeout(() => {
          animateSweepTrick(() => renderCurrentGame());
        }, 2200);
      }
    });
    return;
  }

  // ── Card played: animate card drop in arena ───────────────────
  const prevPlayCount = Object.keys(prevState.playsThisTrick || {}).length;
  const nextPlayCount = Object.keys(state.playsThisTrick || {}).length;
  if (nextPlayCount > prevPlayCount) {
    renderCurrentGame();
    // Animate the new card slot in arena with a drop effect
    setTimeout(() => {
      const slots = document.querySelectorAll('#arena-slots .arena-slot');
      const lastSlot = slots[slots.length - 1];
      if (lastSlot) {
        lastSlot.classList.add('dropping');
        setTimeout(() => lastSlot.classList.remove('dropping'), 600);
      }
    }, 30);
    return;
  }

  // ── Envido resolved: show announcement ───────────────────────
  if (state.chant.envido.resolved && !prevState.chant.envido.resolved && state.chant.envido.accepted) {
    renderCurrentGame();
    // Build finalCards for announcement from trickHistory + current hands
    // (server already settled it in handScore, we just show it)
    // For simplicity show the overlay without detailed scores — the log has them
    return;
  }

  // ── Default: just render ──────────────────────────────────────
  renderCurrentGame();
}

function handleMessage(payload) {
  if (!payload || typeof payload !== 'object') return;

  if (payload.type === 'room_waiting') {
    setupCfg.mode = 'online_1v1';
    _prevG = null;
    setStatus(`Sala ${payload.roomCode}: esperando rival…`, 'warn');
    setHeaderStatus(`Sala ${payload.roomCode}`);
    syncLeaveButton(false);
    showScreenById('screen-setup');
    return;
  }

  if (payload.type === 'action_rejected') {
    setStatus(payload.error || 'Acción rechazada.', 'err');
    setHeaderStatus(payload.error || 'Acción rechazada');
    return;
  }

  if (payload.type === 'rematch_waiting') {
    setStatus(payload.statusText || 'Esperando revancha…', 'warn');
    setHeaderStatus(payload.statusText || 'Esperando revancha');
    return;
  }

  if (payload.type === 'room_closed') {
    setStatus(payload.statusText || 'La sala se cerró.', 'err');
    leaveOnlineRoom(false);
    return;
  }

  if (payload.type === 'room_state' || payload.type === 'presence_update') {
    installStateEnvelope(payload);
    if (payload.statusText) setStatus(payload.statusText, payload.opponentConnected === false ? 'warn' : 'ok');
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

  sock.addEventListener('message', (ev) => {
    try {
      handleMessage(JSON.parse(ev.data));
    } catch (err) {
      console.error(err);
    }
  });

  const onDisconnect = () => {
    session.connected = false;
    if (!session.roomId) return;
    setStatus(`Conexión perdida con la sala ${session.roomCode}. Reintentando…`, 'warn');
    setHeaderStatus('Reconectando…');
    scheduleReconnect();
  };

  sock.addEventListener('close', onDisconnect);
  sock.addEventListener('error', onDisconnect);
}

function sendAction(message) {
  if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
    setStatus('No hay conexión activa con la sala.', 'err');
    return;
  }
  session.socket.send(JSON.stringify(message));
}

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
    const data = await postJson('/api/rooms/create', {
      target: setupCfg.target,
      conFlor: !!setupCfg.conFlor,
    });
    session.roomId = data.roomId;
    session.roomCode = data.roomCode;
    session.token = data.token;
    session.seat = data.seat;
    session.pendingRematch = false;
    persistSession();
    const input = document.getElementById('room-code-input');
    if (input) input.value = data.roomCode;
    setStatus(`Sala ${data.roomCode} creada. Compartí el código y esperá al rival.`, 'ok');
    connectSocket();
  } catch (err) {
    setStatus(err?.message || 'No se pudo crear la sala.', 'err');
  }
}

export async function joinOnlineRoomFromUI() {
  setupCfg.mode = 'online_1v1';
  _prevG = null;
  const input = document.getElementById('room-code-input');
  const roomCode = String(input?.value || '').trim().toUpperCase();
  if (!roomCode) {
    setStatus('Ingresá un código de sala.', 'err');
    return;
  }
  try {
    const data = await postJson('/api/rooms/join', { roomCode });
    session.roomId = data.roomId;
    session.roomCode = data.roomCode;
    session.token = data.token;
    session.seat = data.seat;
    session.pendingRematch = false;
    persistSession();
    setStatus(`Te uniste a la sala ${data.roomCode}.`, 'ok');
    connectSocket();
  } catch (err) {
    setStatus(err?.message || 'No se pudo entrar a la sala.', 'err');
  }
}

export function leaveOnlineRoom(sendLeave = true) {
  if (sendLeave && session.socket && session.socket.readyState === WebSocket.OPEN) {
    try { session.socket.send(JSON.stringify({ type: 'leave_room' })); } catch {}
  }
  try { session.socket?.close(); } catch {}
  session.roomId = '';
  session.roomCode = '';
  session.token = '';
  session.seat = null;
  session.socket = null;
  session.connected = false;
  session.pendingRematch = false;
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

export function sendPlayCard(cardIndex)     { sendAction({ type: 'play_card', cardIndex }); }
export function sendSingTruco()             { sendAction({ type: 'sing_truco' }); }
export function sendRespondTruco(accept)    { sendAction({ type: 'respond_truco', action: accept ? 'accept' : 'reject' }); }
export function sendRaiseTruco()            { sendAction({ type: 'raise_truco' }); }
export function sendInitiateEnvido(call)    { sendAction({ type: 'initiate_envido', call }); }
export function sendRespondEnvido(action)   { sendAction({ type: 'respond_envido', action }); }
export function sendSingFlor()              { sendAction({ type: 'sing_flor' }); }
export function sendRespondFlor(action)     { sendAction({ type: 'respond_flor', action }); }
export function sendGoToMazo()              { sendAction({ type: 'go_to_mazo' }); }
