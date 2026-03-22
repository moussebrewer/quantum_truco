// @ts-nocheck
import {
  setupCfg,
  installOnlineState,
  renderCurrentGame,
  showScreenById,
  showWinState,
} from './game';

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

function installStateEnvelope(envelope) {
  const state = envelope.state;
  if (!state) return;
  state.onlineMode = true;
  state.viewerSeat = session.seat;
  state.roomCode = session.roomCode;
  state.roomId = session.roomId;
  state.statusText = envelope.statusText || '';
  state.opponentConnected = envelope.opponentConnected;
  state.roomReady = envelope.roomReady;
  installOnlineState(state);
  setHeaderStatus(envelope.statusText || 'En línea');
  syncLeaveButton(true);

  if (state.matchEnded) {
    const winnerTeam = state.winnerTeam ?? 0;
    const winnerName = state.winnerName || (winnerTeam === 0 ? state.players?.[0]?.name : state.players?.[1]?.name) || 'Ganador';
    showWinState(`¡${String(winnerName).toUpperCase()} GANA!`, winnerTeam === 0 ? 'Equipo 0 victorioso' : 'Equipo 1 victorioso', `${state.scores[0]} — ${state.scores[1]}`);
    showScreenById('screen-win');
  } else {
    showScreenById('screen-game');
    renderCurrentGame();
  }
}

function handleMessage(payload) {
  if (!payload || typeof payload !== 'object') return;

  if (payload.type === 'room_waiting') {
    setupCfg.mode = 'online_1v1';
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
  const input = document.getElementById('room-code-input');
  const roomCode = String(input?.value || '').trim().toUpperCase();
  if (!roomCode) {
    setStatus('Ingresá un código de sala.', 'err');
    return;
  }
  try {
    const data = await postJson('/api/rooms/join', {
      roomCode,
    });
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
  setStatus('Pediste revancha. Esperando al rival…', 'warn');
  sendAction({ type: 'request_rematch' });
}

export function sendPlayCard(cardIndex) {
  sendAction({ type: 'play_card', cardIndex });
}

export function sendSingTruco() {
  sendAction({ type: 'sing_truco' });
}

export function sendRespondTruco(accept) {
  sendAction({ type: 'respond_truco', action: accept ? 'accept' : 'reject' });
}

export function sendRaiseTruco() {
  sendAction({ type: 'raise_truco' });
}

export function sendInitiateEnvido(call) {
  sendAction({ type: 'initiate_envido', call });
}

export function sendRespondEnvido(action) {
  sendAction({ type: 'respond_envido', action });
}

export function sendSingFlor() {
  sendAction({ type: 'sing_flor' });
}

export function sendRespondFlor(action) {
  sendAction({ type: 'respond_flor', action });
}

export function sendGoToMazo() {
  sendAction({ type: 'go_to_mazo' });
}
