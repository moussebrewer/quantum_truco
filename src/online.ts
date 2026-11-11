// @ts-nocheck
import {
  G,
  setupCfg,
  TRUCO_LEVELS,
  installOnlineState,
  renderCurrentGame,
  showScreenById,
  showWinState,
  animateDeal,
  animateSweepTrick,
} from './game';
import { COLLAPSE_DUR, COLLAPSE_STAGGER } from './anim';
import {
  showEnvidoAnnouncement,
  setEnvidoOverlayOnClose,
  showTrucoCallToast,
  showSay,
  log,
  setChatEnabled,
  clearChat,
  appendChatMessage,
  initChat,
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

// Servidor de salas. Orden de prioridad:
//  1. VITE_ONLINE_URL (archivo .env o variable de entorno al compilar)
//  2. en desarrollo (npm run dev): el Worker local de `npm run worker:dev`
//  3. el Worker desplegado
const DEPLOYED_ONLINE_URL = 'https://quantum-truco-online.ignaciocarraro99.workers.dev';

function onlineBase() {
  const fromEnv = import.meta.env?.VITE_ONLINE_URL;
  if (fromEnv) return fromEnv;
  if (import.meta.env?.DEV) return `http://${window.location.hostname}:8787`;
  return DEPLOYED_ONLINE_URL;
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
  // El chat acompaña a la sala: visible mientras haya partida online.
  setChatEnabled(show);
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

// ─────────────────────────────────────────────────────────────
// Presentación de estados
// El servidor resuelve cada jugada de una sola vez: al jugarse la última
// carta de una baza ya manda la baza siguiente (o la mano siguiente). Para
// que se vea el colapso, quién ganó y el reparto, los estados entran a una
// cola y se reproducen en orden usando los resúmenes lastTrick / lastHand.
// ─────────────────────────────────────────────────────────────
const stateQueue = [];
let presenting = false;
let lastSeq = null; // último eventSeq ya mostrado; null = todavía sin estado

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let lastSayN = 0; // último "dicho" (canto o respuesta) ya mostrado
let lastLogN = 0; // última línea de log ya agregada

function resetPresentation() {
  stateQueue.length = 0;
  lastSeq = null;
  lastSayN = 0;
  lastLogN = 0;
  lastChatN = 0;
}

// Agrega al log y muestra como cartel lo nuevo que trae un estado.
// `silent` se usa al entrar o reconectarse: el log se completa, sin carteles.
function flushSaysAndLog(next, silent) {
  const logTail = next.logTail || [];
  if ((next.logN || 0) < lastLogN) lastLogN = 0; // partida nueva
  for (const entry of logTail) {
    if (entry.n > lastLogN) log(entry.msg, entry.cls);
  }
  lastLogN = next.logN || 0;

  const says = next.says || [];
  if ((next.sayN || 0) < lastSayN) lastSayN = 0;
  if (!silent) {
    for (const s of says) {
      if (s.n > lastSayN) {
        const name = s.seat === session.seat ? 'Vos' : (next.players?.[s.seat]?.name || 'Rival');
        showSay(name, s.text, s.seat % 2);
      }
    }
  }
  lastSayN = next.sayN || 0;
}

function installStateEnvelope(envelope) {
  if (!envelope.state) return;
  stateQueue.push(envelope);
  if (!presenting) drainStateQueue();
}

async function drainStateQueue() {
  presenting = true;
  try {
    while (stateQueue.length) {
      const envelope = stateQueue.shift();
      try {
        await presentEnvelope(envelope);
      } catch (err) {
        console.error(err);
        applyEnvelope(envelope);
      }
    }
  } finally {
    presenting = false;
  }
}

async function presentEnvelope(envelope) {
  const next = envelope.state;
  const prev = G && G.onlineMode ? G : null;
  const seq = next.eventSeq || 0;
  const isNewGame = lastSeq === null || !prev || seq < lastSeq;

  flushSaysAndLog(next, isNewGame);

  if (isNewGame) {
    lastSeq = seq;
    applyEnvelope(envelope);
    // Partida recién empezada: repartir.
    const untouched = next.handNum === 1 && next.trickIdx === 0
      && Object.keys(next.playsThisTrick || {}).length === 0;
    if (untouched && !next.matchEnded && next.roomReady) {
      await new Promise(resolve => animateDeal(resolve));
      renderCurrentGame();
    }
    return;
  }

  const trick = next.lastTrick && next.lastTrick.seq > lastSeq ? next.lastTrick : null;
  const hand  = next.lastHand  && next.lastHand.seq  > lastSeq ? next.lastHand  : null;
  lastSeq = seq;

  if (trick && prev.handNum === trick.handNum && prev.trickIdx === trick.trickIdx) {
    await presentTrick(prev, trick);
  }
  if (hand) await presentHandEnd(hand);

  applyEnvelope(envelope);

  if (hand && !next.matchEnded) {
    await new Promise(resolve => animateDeal(resolve));
    renderCurrentGame();
  }
}

// Reproduce el final de una baza sobre una copia del estado anterior:
// entra la carta que faltaba, colapsan, se muestra quién ganó y se barren.
async function presentTrick(prev, trick) {
  const view = JSON.parse(JSON.stringify(prev));
  view.pendingChant = null;
  view.phase = 'collapsing';
  view.playsThisTrick = {};
  for (const p of trick.plays) {
    view.playsThisTrick[p.seat] = { pairId: p.pairId, idxInPair: p.idxInPair, options: p.options, collapsedTo: null };
    const player = view.players[p.seat];
    if (p.seat === session.seat) {
      player.hand = player.hand.filter(q => !(q.pairId === p.pairId && q.idxInPair === p.idxInPair));
    } else if (!prev.playsThisTrick?.[p.seat]) {
      player.hand = player.hand.slice(1);
    }
  }
  installOnlineState(view);
  renderCurrentGame();
  await sleep(750);

  for (const p of trick.plays) view.playsThisTrick[p.seat].collapsedTo = p.card;
  renderCurrentGame();
  await sleep(Math.max(0, trick.plays.length - 1) * COLLAPSE_STAGGER + COLLAPSE_DUR + 250);

  view.trickWinners = [...(view.trickWinners || []), trick.winnerTeam];
  view.trickHistory = [...(view.trickHistory || []), trick.plays.map(p => ({ seat: p.seat, card: p.card }))];
  view.phase = 'baza_end';
  renderCurrentGame();
  await sleep(2200);

  await new Promise(resolve => animateSweepTrick(resolve));
}

// Cierre de mano: revelación del envido (si se jugó) y puntos de la mano.
async function presentHandEnd(hand) {
  if (hand.envido) {
    showEnvidoAnnouncement(hand.envido.res, hand.envido.pts, hand.envido.finalCards);
    await new Promise(resolve => setEnvidoOverlayOnClose(resolve));
  }
  if (hand.florText) {
    showTrucoCallToast(hand.florText, 3000);
    await sleep(3200);
  }
  const names = [G?.players?.[0]?.name || 'Jugador 1', G?.players?.[1]?.name || 'Jugador 2'];
  showTrucoCallToast(`Mano ${hand.handNum} · ${names[0]} +${hand.handScore[0]} · ${names[1]} +${hand.handScore[1]}`, 2200);
  await sleep(2400);
}

function applyEnvelope(envelope) {
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

  if (payload.type === 'chat_history') {
    clearChat();
    lastChatN = 0;
    for (const m of payload.messages || []) addChat(m, false);
    return;
  }

  if (payload.type === 'chat') {
    addChat(payload.message, true);
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

// ── Chat ─────────────────────────────────────────────────────
let lastChatN = 0;

function addChat(message, announce) {
  if (!message || message.n <= lastChatN) return;
  lastChatN = message.n;
  const mine = message.seat === session.seat;
  const name = G?.players?.[message.seat]?.name || `Jugador ${message.seat + 1}`;
  appendChatMessage(name, message.text, message.seat % 2, mine, announce);
}

export function sendChat(text) {
  sendAction({ type: 'chat', text });
}

export function isOnlineClientMode() {
  return setupCfg.mode === 'online_1v1' || !!session.roomId;
}

export function bootstrapOnlineUi() {
  syncLeaveButton(false);
  initChat(sendChat);
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
  resetPresentation();
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

export function sendEnvidoFirst(call) {
  sendAction({ type: 'envido_first', call });
}

export function sendFlorOverEnvido() {
  sendAction({ type: 'flor_over_envido' });
}

export function sendGoToMazo() {
  sendAction({ type: 'go_to_mazo' });
}
