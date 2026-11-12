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
import { tr, trText, trName } from './i18n';
import {
  showEnvidoAnnouncement,
  setEnvidoOverlayOnClose,
  showTrucoCallToast,
  showSay,
  selectPlayMode,
  log,
  clearLog,
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
  el.textContent = trText(text || '');
  el.className = `online-status ${cls}`.trim();
}

function setHeaderStatus(text) {
  const el = document.getElementById('online-header-status');
  if (el) el.textContent = trText(text || '');
}

function syncLeaveButton(show) {
  const btn = document.getElementById('btn-online-leave');
  if (btn) btn.style.display = show ? '' : 'none';
  // El chat acompaña a la sala: visible mientras haya partida online.
  setChatEnabled(show);
}

function updateSelectedMode() {
  selectPlayMode('online');
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
    setStatus(tr(`Reconectando a la sala ${session.roomCode}…`, `Reconnecting to room ${session.roomCode}…`), 'warn');
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

let presentGen = 0;

function resetPresentation() {
  presentGen++;
  presenting = false;
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
        const name = s.seat === session.seat ? tr('Vos', 'You') : (next.players?.[s.seat]?.name || tr('Rival', 'Opponent'));
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
  // Si la sala se abandona a mitad de una presentación, esta corrida queda
  // vieja (cambia presentGen) y no debe seguir ni bloquear a la siguiente.
  const gen = presentGen;
  presenting = true;
  try {
    while (stateQueue.length && gen === presentGen) {
      const envelope = stateQueue.shift();
      try {
        await presentEnvelope(envelope);
      } catch (err) {
        if (gen !== presentGen) return;
        console.error(err);
        applyEnvelope(envelope);
      }
    }
  } finally {
    if (gen === presentGen) presenting = false;
  }
}

async function presentEnvelope(envelope) {
  const next = envelope.state;
  // Los nombres que arma el servidor ("Jugador 2") van en el idioma elegido.
  next.players?.forEach(p => { p.name = trName(p.name); });
  const prev = G && G.onlineMode ? G : null;
  const seq = next.eventSeq || 0;
  const isNewGame = lastSeq === null || !prev || seq < lastSeq;

  // Partida nueva (o reconexión): el log arranca limpio y se vuelve a
  // llenar con lo que el servidor guarda de la partida en curso.
  if (isNewGame) {
    clearLog();
    lastLogN = 0;
  }
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
    // Entre los dos duelos de un pica-pica no se reparte de nuevo.
    if (hand.redeal !== false) {
      await new Promise(resolve => animateDeal(resolve));
      renderCurrentGame();
    }
    if (next.duelSeats) {
      const [a, b] = next.duelSeats;
      showTrucoCallToast(`Pica-pica: ${next.players[a].name} vs ${next.players[b].name}`, 2000);
    }
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
    view.playsThisTrick[p.seat] = { pairId: p.pairId, idxInPair: p.idxInPair, options: p.options, probA: p.probA, collapsedTo: null };
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
  const four = (G?.players?.length || 2) > 2;
  const names = four
    ? [tr('Equipo A', 'Team A'), tr('Equipo B', 'Team B')]
    : [G?.players?.[0]?.name || 'Jugador 1', G?.players?.[1]?.name || 'Jugador 2'];
  const title = hand.duel ? `Pica-pica (mano ${hand.handNum})` : `Mano ${hand.handNum}`;
  showTrucoCallToast(`${title} · ${names[0]} +${hand.handScore[0]} · ${names[1]} +${hand.handScore[1]}`, 2200);
  await sleep(2400);
}

function applyEnvelope(envelope) {
  const state = envelope.state;
  if (!state) return;
  if (!session.roomId) return; // ya se salió de la sala
  state.onlineMode = true;
  state.viewerSeat = session.seat;
  state.roomCode = session.roomCode;
  state.roomId = session.roomId;
  state.statusText = envelope.statusText || '';
  state.opponentConnected = envelope.opponentConnected;
  state.roomReady = envelope.roomReady;
  installOnlineState(state);
  setHeaderStatus(envelope.statusText || tr('En línea', 'Online'));
  syncLeaveButton(true);

  if (state.matchEnded) {
    const winnerTeam = state.winnerTeam ?? 0;
    const winnerName = state.winnerName || (winnerTeam === 0 ? state.players?.[0]?.name : state.players?.[1]?.name) || tr('Ganador', 'Winner');
    showWinState(tr(`¡${trText(String(winnerName)).toUpperCase()} GANA!`, `${trText(String(winnerName)).toUpperCase()} WINS!`), tr('Partida online terminada', 'Online game over'), `${state.scores[0]} — ${state.scores[1]}`);
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
    setStatus(payload.statusText || tr(`Sala ${payload.roomCode}: esperando rival…`, `Room ${payload.roomCode}: waiting for opponent…`), 'warn');
    setHeaderStatus(tr(`Sala ${payload.roomCode}`, `Room ${payload.roomCode}`));
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
    setStatus(payload.error || tr('Acción rechazada.', 'Action rejected.'), 'err');
    setHeaderStatus(payload.error || tr('Acción rechazada', 'Action rejected'));
    return;
  }

  if (payload.type === 'rematch_waiting') {
    setStatus(payload.statusText || tr('Esperando revancha…', 'Waiting for the rematch…'), 'warn');
    setHeaderStatus(payload.statusText || tr('Esperando revancha', 'Waiting for the rematch'));
    return;
  }

  if (payload.type === 'room_closed') {
    setStatus(payload.statusText || tr('La sala se cerró.', 'The room was closed.'), 'err');
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
  setStatus(tr(`Conectando a la sala ${session.roomCode}…`, `Connecting to room ${session.roomCode}…`), 'warn');

  sock.addEventListener('open', () => {
    session.connected = true;
    setStatus(tr(`Conectado a la sala ${session.roomCode}.`, `Connected to room ${session.roomCode}.`), 'ok');
    setHeaderStatus(tr(`Sala ${session.roomCode}`, `Room ${session.roomCode}`));
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
    setStatus(tr(`Conexión perdida con la sala ${session.roomCode}. Reintentando…`, `Lost connection to room ${session.roomCode}. Retrying…`), 'warn');
    setHeaderStatus(tr('Reconectando…', 'Reconnecting…'));
    scheduleReconnect();
  };

  sock.addEventListener('close', onDisconnect);
  sock.addEventListener('error', onDisconnect);
}

function sendAction(message) {
  if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
    setStatus(tr('No hay conexión activa con la sala.', 'There is no active connection to the room.'), 'err');
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

// ¿Hay una sala online activa o guardada en este navegador?
export function hasOnlineSession() {
  return !!session.roomId;
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
      prepared: !!setupCfg.prepared,
      tableSize: [2, 4, 6].includes(setupCfg.tableSize) ? setupCfg.tableSize : 2,
    });
    session.roomId = data.roomId;
    session.roomCode = data.roomCode;
    session.token = data.token;
    session.seat = data.seat;
    session.pendingRematch = false;
    persistSession();
    const input = document.getElementById('room-code-input');
    if (input) input.value = data.roomCode;
    setStatus(data.tableSize > 2
      ? tr(`Sala ${data.roomCode} creada para ${data.tableSize}. Compartí el código: los equipos se arman por orden de llegada, intercalados (${data.tableSize === 6 ? '1º, 3º y 5º contra 2º, 4º y 6º' : '1º y 3º contra 2º y 4º'}).`,
           `Room ${data.roomCode} created for ${data.tableSize}. Share the code: teams are formed in order of arrival, alternating (${data.tableSize === 6 ? '1st, 3rd and 5th vs 2nd, 4th and 6th' : '1st and 3rd vs 2nd and 4th'}).`)
      : tr(`Sala ${data.roomCode} creada. Compartí el código y esperá al rival.`, `Room ${data.roomCode} created. Share the code and wait for your opponent.`), 'ok');
    connectSocket();
  } catch (err) {
    setStatus(err?.message || tr('No se pudo crear la sala.', 'Could not create the room.'), 'err');
  }
}

export async function joinOnlineRoomFromUI() {
  setupCfg.mode = 'online_1v1';
  const input = document.getElementById('room-code-input');
  const roomCode = String(input?.value || '').trim().toUpperCase();
  if (!roomCode) {
    setStatus(tr('Ingresá un código de sala.', 'Enter a room code.'), 'err');
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
    setStatus(tr(`Te uniste a la sala ${data.roomCode}.`, `You joined room ${data.roomCode}.`), 'ok');
    connectSocket();
  } catch (err) {
    setStatus(err?.message || tr('No se pudo entrar a la sala.', 'Could not join the room.'), 'err');
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
  setStatus(tr('Fuera de la sala.', 'You left the room.'), '');
  showScreenById('screen-setup');
}

export function requestOnlineRematch() {
  if (!isOnlineClientMode()) return;
  session.pendingRematch = true;
  setStatus(tr('Pediste revancha. Esperando al rival…', 'You asked for a rematch. Waiting for your opponent…'), 'warn');
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
