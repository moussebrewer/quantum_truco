// @ts-nocheck
import {
  createHeadlessGame,
  cloneGameState,
  serializeGameState,
  rehydrateGameState,
  setGameState,
  getGameState,
  setHeadlessMode,
  onCardClick,
  singTruco,
  respondTruco,
  raiseTruco,
  initiateEnvido,
  respondEnvido,
  singFlor,
  respondFlor,
  goToMazo,
  envidoCanRaise,
  canTeamRaiseNow,
  teamOf,
  canEnvidoFirst,
  canOpenEnvido,
  canSingFlor,
  canFlorOverEnvido,
  florOverEnvido,
  deferPendingTrucoAndInitiateEnvido,
  configureGameRuntime,
} from './game';

export interface Env {
  ROOM_DO: DurableObjectNamespace;
}

const baseCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function withCors(response, request = null) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(baseCorsHeaders)) headers.set(key, value);

  const reqHeaders = request?.headers?.get?.('Access-Control-Request-Headers');
  if (reqHeaders) headers.set('Access-Control-Allow-Headers', reqHeaders);

  const vary = headers.get('Vary');
  headers.set('Vary', vary ? `${vary}, Access-Control-Request-Headers` : 'Access-Control-Request-Headers');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsJson(data, status = 200, request = null) {
  return withCors(new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  }), request);
}

function handleOptions(request) {
  const headers = new Headers(baseCorsHeaders);
  const reqHeaders = request.headers.get('Access-Control-Request-Headers');
  if (reqHeaders) headers.set('Access-Control-Allow-Headers', reqHeaders);
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Vary', 'Access-Control-Request-Headers');
  return new Response(null, { status: 204, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function randomToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function hiddenCard() {
  return { pairId: -1, idxInPair: 0, options: [], collapsedTo: null, hidden: true };
}

function computeStatusText(meta, state, seat) {
  if (!meta.players[0].token || !meta.players[1].token) return `Sala ${meta.roomCode} · esperando rival`;
  if (!meta.players[1 - seat].connected) return `Sala ${meta.roomCode} · rival desconectado`;
  if (state?.matchEnded && meta.players[seat].rematchRequested && !meta.players[1 - seat].rematchRequested) {
    return `Sala ${meta.roomCode} · revancha pedida`;
  }
  if (state?.matchEnded && !meta.players[seat].rematchRequested && meta.players[1 - seat].rematchRequested) {
    return `Sala ${meta.roomCode} · rival quiere revancha`;
  }
  return `Sala ${meta.roomCode} · Jugador ${seat + 1}`;
}

function filterStateForSeat(fullState, seat, meta) {
  const state = cloneGameState(fullState);
  // El cliente no necesita el mazo, y trae el orden de las cartas sin repartir.
  state.deck = null;
  state.onlineMode = true;
  state.viewerSeat = seat;
  state.roomCode = meta.roomCode;
  state.roomReady = !!meta.players[0].token && !!meta.players[1].token;
  state.opponentConnected = !!meta.players[1 - seat].connected;
  state.statusText = computeStatusText(meta, state, seat);
  state.players = state.players.map((player) => {
    if (player.seat === seat) return player;
    return {
      ...player,
      hand: new Array(player.hand.length).fill(0).map(() => hiddenCard()),
      metric: null,
      florMetric: null,
    };
  });
  return state;
}

const ENVIDO_CALLS = ['envido', 'real envido', 'falta envido'];
const FLOR_ACTIONS = {
  initial: ['yes', 'no'],
  contraflor: ['simple', 'contraflor', 'alresto'],
  resp_contraflor: ['accept', 'reject'],
};

export function validateIntent(state, seat, intent) {
  if (intent.type === 'request_rematch' || intent.type === 'leave_room' || intent.type === 'chat') return true;
  if (!state || state.matchEnded) return false;

  if (state.pendingChant) {
    const pc = state.pendingChant;
    if (pc.responderSeat !== seat) return false;
    if (pc.type === 'truco') {
      if (intent.type === 'envido_first') {
        return canEnvidoFirst(state) && ENVIDO_CALLS.includes(intent.call);
      }
      if (intent.type === 'respond_truco') return intent.action === 'accept' || intent.action === 'reject';
      // Sobre el vale cuatro no hay nada más que cantar.
      if (intent.type === 'raise_truco') return (pc.data?.level ?? 3) < 3;
      return false;
    }
    if (pc.type === 'envido') {
      if (intent.type === 'flor_over_envido') return canFlorOverEnvido(state);
      if (intent.type !== 'respond_envido') return false;
      if (intent.action === 'accept' || intent.action === 'reject') return true;
      return envidoCanRaise(state.chant.envido.calls).includes(intent.action);
    }
    if (pc.type === 'flor') {
      if (intent.type !== 'respond_flor') return false;
      return (FLOR_ACTIONS[pc.data?.stage] || []).includes(intent.action);
    }
    return false;
  }

  if (state.activeSeat !== seat) return false;
  if (state.phase !== 'chant' && state.phase !== 'play') return false;

  if (intent.type === 'play_card') {
    return Number.isInteger(intent.cardIndex) && intent.cardIndex >= 0 && intent.cardIndex < state.players[seat].hand.length;
  }
  if (intent.type === 'sing_truco') {
    return canTeamRaiseNow(state.bet, teamOf(seat));
  }
  if (intent.type === 'initiate_envido') {
    return canOpenEnvido(state, seat) && ENVIDO_CALLS.includes(intent.call);
  }
  if (intent.type === 'sing_flor') {
    return canSingFlor(state, seat);
  }
  if (intent.type === 'go_to_mazo') return true;
  return false;
}

const LOG_TAIL = 60;

export function applyIntentToState(state, intent) {
  setHeadlessMode(true);
  setGameState(cloneGameState(state));
  // Lo que el motor escribe en el log durante esta jugada.
  const logged = [];
  configureGameRuntime({ log: (msg, cls) => logged.push({ msg, cls: cls || '' }) });
  try {
    switch (intent.type) {
      case 'envido_first':
        deferPendingTrucoAndInitiateEnvido(intent.call);
        break;
      case 'flor_over_envido':
        florOverEnvido();
        break;
      case 'play_card':
        onCardClick(intent.cardIndex);
        break;
      case 'sing_truco':
        singTruco();
        break;
      case 'respond_truco':
        respondTruco(intent.action === 'accept');
        break;
      case 'raise_truco':
        raiseTruco();
        break;
      case 'initiate_envido':
        initiateEnvido(intent.call);
        break;
      case 'respond_envido':
        respondEnvido(intent.action);
        break;
      case 'sing_flor':
        singFlor();
        break;
      case 'respond_flor':
        respondFlor(intent.action);
        break;
      case 'go_to_mazo':
        goToMazo();
        break;
      default:
        break;
    }
    const result = cloneGameState(getGameState());
    // Las últimas líneas del log viajan con el estado, numeradas, para que
    // cada cliente agregue solo las que todavía no mostró.
    let n = state.logN || 0;
    const tail = [...(state.logTail || [])];
    for (const entry of logged) tail.push({ n: ++n, ...entry });
    result.logN = n;
    result.logTail = tail.slice(-LOG_TAIL);
    return result;
  } finally {
    configureGameRuntime({ log: null });
    setGameState(null);
    setHeadlessMode(false);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return handleOptions(request);
    }

    if (request.method === 'POST' && url.pathname === '/api/rooms/create') {
      const body = await request.json().catch(() => ({}));
      const code = makeRoomCode();
      const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(code));
      const req = new Request('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ roomCode: code, target: body.target || 15, conFlor: !!body.conFlor }),
      });
      return withCors(await stub.fetch(req), request);
    }

    if (request.method === 'POST' && url.pathname === '/api/rooms/join') {
      const body = await request.json().catch(() => ({}));
      const code = String(body.roomCode || '').trim().toUpperCase();
      if (!code) return corsJson({ error: 'Código de sala inválido.' }, 400, request);
      const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(code));
      const req = new Request('https://room/join', {
        method: 'POST',
        body: JSON.stringify({ roomCode: code }),
      });
      return withCors(await stub.fetch(req), request);
    }

    if (url.pathname.startsWith('/api/rooms/connect/')) {
      const code = url.pathname.split('/').pop();
      const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(code));
      return stub.fetch(request); // preserve the original websocket upgrade request
    }

    if (url.pathname.startsWith('/api/')) {
      return corsJson({ error: 'Not found' }, 404, request);
    }
    return json({ error: 'Not found' }, 404);
  },
};

export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.loaded = false;
    this.meta = null;
    this.game = null;
    this.sockets = new Map();
    this.chatTimes = new Map();
  }

  async load() {
    if (this.loaded) return;
    this.meta = await this.state.storage.get('meta');
    this.game = await this.state.storage.get('game');
    if (!this.meta) {
      this.meta = {
        roomCode: '',
        cfg: { tableSize: 2, target: 15, conFlor: false, mode: 'online_1v1' },
        players: [
          { token: null, connected: false, rematchRequested: false, left: false },
          { token: null, connected: false, rematchRequested: false, left: false },
        ],
      };
    }
    if (this.game) this.game = rehydrateGameState(this.game);
    this.loaded = true;
  }

  async persist() {
    await this.state.storage.put('meta', this.meta);
    await this.state.storage.put('game', this.game ? serializeGameState(this.game) : null);
  }

  seatForToken(token) {
    return this.meta.players.findIndex((p) => p.token === token);
  }

  async ensureGame() {
    if (!this.game && this.meta.players[0].token && this.meta.players[1].token) {
      this.game = createHeadlessGame(this.meta.cfg);
      this.meta.players[0].rematchRequested = false;
      this.meta.players[1].rematchRequested = false;
      await this.persist();
    }
  }

  send(socket, payload) {
    try { socket.send(JSON.stringify(payload)); } catch {}
  }

  broadcastWaiting() {
    for (const [seat, socket] of this.sockets.entries()) {
      this.send(socket, {
        type: 'room_waiting',
        roomCode: this.meta.roomCode,
        statusText: computeStatusText(this.meta, this.game, seat),
      });
    }
  }

  broadcastState(type = 'room_state') {
    if (!this.game) {
      this.broadcastWaiting();
      return;
    }
    for (const [seat, socket] of this.sockets.entries()) {
      const filtered = filterStateForSeat(this.game, seat, this.meta);
      this.send(socket, {
        type,
        roomReady: true,
        opponentConnected: !!this.meta.players[1 - seat].connected,
        statusText: filtered.statusText,
        state: filtered,
      });
    }
  }

  async markDisconnected(seat) {
    if (seat < 0) return;
    this.meta.players[seat].connected = false;
    this.sockets.delete(seat);
    await this.persist();
    if (this.game) this.broadcastState('presence_update');
    else this.broadcastWaiting();
  }

  async handleIntent(seat, intent, socket) {
    if (intent.type === 'leave_room') {
      this.meta.players[seat].connected = false;
      this.meta.players[seat].left = true;
      this.meta.players[seat].token = null;
      this.sockets.delete(seat);
      await this.persist();
      if (this.sockets.has(1 - seat)) this.broadcastState('presence_update');
      return;
    }

    if (intent.type === 'chat') {
      const text = String(intent.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return;
      // Freno simple: como mucho 5 mensajes cada 5 segundos por jugador.
      const now = Date.now();
      const recent = (this.chatTimes.get(seat) || []).filter(t => now - t < 5000);
      if (recent.length >= 5) return;
      recent.push(now);
      this.chatTimes.set(seat, recent);

      this.meta.chatN = (this.meta.chatN || 0) + 1;
      const msg = { n: this.meta.chatN, seat, text };
      this.meta.chat = [...(this.meta.chat || []), msg].slice(-40);
      await this.persist();
      for (const sock of this.sockets.values()) this.send(sock, { type: 'chat', message: msg });
      return;
    }

    if (intent.type === 'request_rematch') {
      this.meta.players[seat].rematchRequested = true;
      await this.persist();
      if (this.meta.players[0].rematchRequested && this.meta.players[1].rematchRequested) {
        this.game = createHeadlessGame(this.meta.cfg);
        this.meta.players[0].rematchRequested = false;
        this.meta.players[1].rematchRequested = false;
        await this.persist();
        this.broadcastState();
      } else {
        this.send(socket, { type: 'rematch_waiting', statusText: 'Revancha pedida. Esperando al rival…' });
        this.broadcastState('presence_update');
      }
      return;
    }

    if (!validateIntent(this.game, seat, intent)) {
      this.send(socket, { type: 'action_rejected', error: 'Acción inválida para este turno.' });
      return;
    }

    this.game = applyIntentToState(this.game, intent);
    await this.persist();
    this.broadcastState();
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/create') {
      if (this.meta.players[0].token || this.meta.players[1].token) {
        return json({ error: 'La sala ya existe.' }, 409);
      }
      const body = await request.json().catch(() => ({}));
      this.meta.roomCode = body.roomCode;
      this.meta.cfg = {
        tableSize: 2,
        target: body.target || 15,
        conFlor: !!body.conFlor,
        mode: 'online_1v1',
      };
      this.meta.players[0] = { token: randomToken(), connected: false, rematchRequested: false, left: false };
      await this.persist();
      return json({ roomId: this.meta.roomCode, roomCode: this.meta.roomCode, token: this.meta.players[0].token, seat: 0 });
    }

    if (request.method === 'POST' && url.pathname === '/join') {
      if (!this.meta.players[0].token) return json({ error: 'La sala no existe.' }, 404);
      if (this.meta.players[1].token) return json({ error: 'La sala ya está llena.' }, 409);
      this.meta.players[1] = { token: randomToken(), connected: false, rematchRequested: false, left: false };
      await this.ensureGame();
      await this.persist();
      return json({ roomId: this.meta.roomCode, roomCode: this.meta.roomCode, token: this.meta.players[1].token, seat: 1 });
    }

    if (url.pathname === '/connect' || url.pathname.startsWith('/api/rooms/connect/')) {
      const token = url.searchParams.get('token') || '';
      const seat = this.seatForToken(token);
      if (seat < 0) return new Response('Unauthorized', { status: 401 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();

      const prev = this.sockets.get(seat);
      try { prev?.close(1012, 'Reemplazada'); } catch {}
      this.sockets.set(seat, server);
      this.meta.players[seat].connected = true;
      this.meta.players[seat].left = false;
      await this.ensureGame();
      await this.persist();

      server.addEventListener('message', (event) => {
        let payload = null;
        try { payload = JSON.parse(event.data); } catch {}
        if (!payload) return;
        this.handleIntent(seat, payload, server).catch((err) => {
          this.send(server, { type: 'action_rejected', error: err?.message || 'Error interno.' });
        });
      });
      const closeHandler = () => this.markDisconnected(seat).catch(() => {});
      server.addEventListener('close', closeHandler);
      server.addEventListener('error', closeHandler);

      if (this.game) this.broadcastState();
      else this.broadcastWaiting();
      // Al (re)conectarse, el jugador recibe el chat que hubo hasta ahora.
      this.send(server, { type: 'chat_history', messages: this.meta.chat || [] });

      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ error: 'Ruta inválida.' }, 404);
  }
}
