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
  envidoScore,
  envidoTotalIfAccepted,
  animateCollapse,
  animateSweepTrick,
  dealCardsAnimated,
} from './game';

const STORAGE_KEY = 'qt-online-session';

const session = {
  roomId: '', roomCode: '', token: '', seat: null,
  socket: null, connected: false, reconnectTimer: null, pendingRematch: false,
};

let _prevG = null;

// Time when the local card fly animation ends — used to delay arena render

// ── Network ───────────────────────────────────────────────────────

function onlineBase() { return 'https://quantum-truco-online.valentinreparaz.workers.dev'; }
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
    token: session.token,   seat:    session.seat,
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

  // Cards played this tick
  const prevPlays = Object.keys(prev.playsThisTrick || {}).map(Number);
  const nextPlays = Object.keys(next.playsThisTrick || {}).map(Number);
  for (const seat of nextPlays)
    if (!prevPlays.includes(seat))
      uiLog(`${next.players?.[seat]?.name || '?'} juega carta cuántica`, 'collapse');

  // Trick resolved: trickHistory grew
  if (next.trickHistory.length > prev.trickHistory.length) {
    const idx   = prev.trickHistory.length;
    const entry = next.trickHistory[idx] || [];
    for (const {seat, card} of entry)
      uiLog(`⊗ ${next.players?.[seat]?.name || '?'}: ${card.rank} de ${card.suit}`, 'collapse');
    const winner = next.trickWinners[idx];
    if (winner === -1) uiLog(`Baza ${idx+1}: PARDA — sale el mano (${next.players?.[next.manoSeat]?.name || '?'})`, 'important');
    else {
      const ws = next.players?.find(p => teamOf(p.seat) === winner)?.seat;
      uiLog(`Baza ${idx+1}: Equipo ${winner} · ${ws !== undefined ? next.players[ws]?.name : '?'}`, 'important');
    }
  }

  // Truco sung
  if (next.pendingChant?.type === 'truco' && prev.pendingChant?.type !== 'truco') {
    const name  = next.players?.[next.pendingChant.callerSeat]?.name || '?';
    const level = TRUCO_LEVELS[next.pendingChant.data?.level]?.name || 'Truco';
    uiLog(`${name}: ¡${level}!`, 'important');
    const phrases = {
      'Truco':   ['¡Truco!','¡Ahí va el truco!','¡Trucoooo!'],
      'Retruco': ['¡Retruco!','¡Mate y retruco!','¡Retruco, che!'],
      'Vale 4':  ['¡Vale cuatro!','¡Vale cuatro, jugado!'],
    };
    const opts = phrases[level] || [`¡${level}!`];
    uiShowTrucoCallToast(opts[Math.floor(Math.random() * opts.length)]);
  }
  // Truco raised
  if (next.pendingChant?.type === 'truco' && prev.pendingChant?.type === 'truco'
      && next.pendingChant.data?.level > prev.pendingChant.data?.level)
    uiLog(`${next.players?.[next.pendingChant.callerSeat]?.name || '?'} sube a ${TRUCO_LEVELS[next.pendingChant.data?.level]?.name}!`, 'important');
  // Truco accepted
  if (next.bet.level > prev.bet.level && !next.pendingChant) {
    const level = TRUCO_LEVELS[next.bet.level]?.name || 'Truco';
    const as    = next.players?.find(p => p.team !== next.bet.lastRaiserTeam)?.seat;
    const an    = as !== undefined ? next.players[as]?.name : '?';
    uiLog(`${an} acepta ${level}. Vale ${TRUCO_LEVELS[next.bet.level]?.pts} pts.`, 'important');
    uiShowTrucoToast(an);
  }
  // Truco rejected
  if (!next.pendingChant && prev.pendingChant?.type === 'truco'
      && next.bet.level === prev.bet.level && next.trickHistory.length === prev.trickHistory.length) {
    const {raiserTeam, level} = prev.pendingChant.data || {};
    uiLog(`${next.players?.[prev.pendingChant.responderSeat]?.name || '?'} rechaza. Eq ${raiserTeam} cobra ${TRUCO_LEVELS[(level??1)-1]?.pts} pts.`, 'points');
  }
  // Envido called
  if (next.chant.envido.calls.length > prev.chant.envido.calls.length) {
    const call = next.chant.envido.calls.at(-1);
    uiLog(`${next.players?.[next.chant.envido.callerSeat]?.name || '?'} canta ${call}.`, 'important');
  }
  // Envido resolved
  if (next.chant.envido.resolved && !prev.chant.envido.resolved) {
    if (next.chant.envido.accepted) uiLog('Envido aceptado.', 'points');
    else uiLog(`Envido rechazado. Eq ${next.chant.envido.callerTeam} cobra pts.`, 'points');
  }
  // Flor
  if (next.pendingChant?.type === 'flor' && prev.pendingChant?.type !== 'flor')
    uiLog(`${next.players?.[next.pendingChant.callerSeat]?.name || '?'} canta Flor.`, 'important');
  // Scores
  if (next.scores[0] !== prev.scores[0] || next.scores[1] !== prev.scores[1]) {
    const d0 = next.scores[0] - prev.scores[0], d1 = next.scores[1] - prev.scores[1];
    uiLog(`=== Mano ${prev.handNum}: +${d0}/${d1} → Total ${next.scores[0]}–${next.scores[1]} ===`, 'important');
  }
}

// ── Deal animation (no pre-flash) ─────────────────────────────────

function triggerDealAnimation(state) {
  // Immediately empty hand so cards don't flash before the deal
  const rowEl  = document.getElementById('hand-row');
  const infoEl = document.getElementById('envido-info');
  if (rowEl)  rowEl.innerHTML  = '';
  if (infoEl) infoEl.innerHTML = '';

  // Show new-hand overlay
  const overlay = document.createElement('div');
  overlay.className = 'new-hand-overlay';
  const manoName = state.players?.[state.manoSeat]?.name || '?';
  overlay.innerHTML = `
    <div class="new-hand-label">Mano ${state.handNum}</div>
    <div class="new-hand-num">Partida a ${state.target} pts · ${state.scores[0]}–${state.scores[1]}</div>
    <div class="mano-indicator">✦ Es mano: ${manoName} ✦</div>`;
  document.body.appendChild(overlay);

  // Render arena + header WITHOUT hand (hand-row is already empty)
  // Temporarily hide viewer's hand from G so renderCurrentGame doesn't refill it
  const vs = state.viewerSeat ?? session.seat ?? 0;
  const savedHand = G.players?.[vs]?.hand;
  if (G.players?.[vs]) G.players[vs].hand = [];
  renderCurrentGame();
  if (G.players?.[vs] && savedHand !== undefined) G.players[vs].hand = savedHand;

  setTimeout(() => {
    overlay.remove();
    dealCardsAnimated(() => renderCurrentGame());
  }, 2500);
}

// ── Collapse animation for online ─────────────────────────────────
// Server already resolved the trick and cleared playsThisTrick.
// We reconstruct it from players[seat].played (visible for all seats)
// and trickHistory (gives us seat order and which card was played).

function runCollapseAnimation(state, onDone) {
  if (typeof document === 'undefined') { onDone(); return; }

  const lastEntry = state.trickHistory[state.trickHistory.length - 1];
  if (!lastEntry || lastEntry.length < 2) { onDone(); return; }

  const seatOrder = lastEntry.map(e => e.seat);

  // Reconstruct playsThisTrick: find the played quantum card matching each collapsed card
  const reconstructed = {};
  for (const {seat, card} of lastEntry) {
    const played = state.players?.[seat]?.played || [];
    const qc = played.find(q =>
      q.collapsedTo && q.collapsedTo.rank === card.rank && q.collapsedTo.suit === card.suit
    ) ?? played[played.length - 1];
    if (qc?.options?.length === 2) reconstructed[seat] = qc;
  }
  if (Object.keys(reconstructed).length < 2) { onDone(); return; }

  // Stash current G values we'll temporarily override
  const saved = {
    playsThisTrick: G.playsThisTrick,
    playOrder:      G.playOrder,
    phase:          G.phase,
    trickIdx:       G.trickIdx,
  };

  // Set up animation state: show entangled cards first (null out collapsedTo)
  G.playOrder      = seatOrder;
  G.playsThisTrick = {};
  for (const [seat, qc] of Object.entries(reconstructed))
    G.playsThisTrick[seat] = { ...qc, collapsedTo: null };
  G.phase = 'collapsing';
  uiRenderGameFull(); // arena shows entangled cards with ⊗ glow

  // Restore collapsedTo so animateCollapse knows what each card becomes
  for (const [seat, qc] of Object.entries(reconstructed))
    G.playsThisTrick[seat].collapsedTo = qc.collapsedTo;

  setTimeout(() => {
    animateCollapse(() => {
      // Restore G to real state
      G.playsThisTrick = saved.playsThisTrick;
      G.playOrder      = saved.playOrder;
      G.phase          = saved.phase;
      G.trickIdx       = saved.trickIdx;
      onDone();
    });
  }, 800);
}

// ── Envido dialog at hand_end ─────────────────────────────────────
// At hand_end, filterStateForSeat no longer hides opponent cards,
// so all cards are visible and collapsed — we can compute real scores.

function triggerEnvidoDialog(state) {
  if (!state.chant?.envido?.accepted || !state.chant?.envido?.resolved) return;

  // Build finalCards: all cards for all players (hand + played, all collapsed)
  const finalCards = {};
  for (const p of state.players) {
    finalCards[p.seat] = [...(p.hand || []), ...(p.played || [])]
      .map(q => q.collapsedTo).filter(Boolean);
  }

  // Compute envido scores per team
  const teamScores = { 0: 0, 1: 0 };
  for (const p of state.players) {
    const cards = finalCards[p.seat];
    if (cards.length) {
      const s = envidoScore(cards);
      teamScores[p.team] = Math.max(teamScores[p.team], s);
    }
  }

  // Winner
  let winner;
  if (teamScores[0] > teamScores[1]) winner = 0;
  else if (teamScores[1] > teamScores[0]) winner = 1;
  else winner = teamOf(state.manoSeat);

  const pts = envidoTotalIfAccepted(
    state.chant.envido.calls,
    state.chant.envido.callerTeam,
    state.target,
    // Use pre-settlement scores (handScore not yet applied to scores at hand_end)
    state.scores.map((s, i) => s - (state.handScore?.[i] || 0))
  );

  uiShowEnvidoAnnouncement({ winner, teamScores }, pts, finalCards);
}

// ── Main state installer ──────────────────────────────────────────

function installStateEnvelope(envelope) {
  const state = envelope.state;
  if (!state) return;

  const prevState = _prevG ? cloneGameState(_prevG) : null;

  // Annotate with session metadata
  state.onlineMode        = true;
  state.viewerSeat        = session.seat;
  state.roomCode          = session.roomCode;
  state.roomId            = session.roomId;
  state.statusText        = envelope.statusText || '';
  state.opponentConnected = envelope.opponentConnected;
  state.roomReady         = envelope.roomReady;

  installOnlineState(state); // G = state
  _prevG = cloneGameState(state);

  setHeaderStatus(envelope.statusText || 'En línea');
  syncLeaveButton(true);

  if (state.matchEnded || state.phase === 'match_end') {
    const wt   = state.winnerTeam ?? 0;
    const name = state.winnerName || state.players?.[wt === 0 ? 0 : 1]?.name || 'Ganador';
    showWinState(`¡${String(name).toUpperCase()} GANA!`, '', `${state.scores[0]} — ${state.scores[1]}`);
    showScreenById('screen-win');
    return;
  }

  showScreenById('screen-game');
  synthesizeLog(prevState, state);

  // ── CASE 1: First connection ──────────────────────────────────
  if (!prevState) {
    triggerDealAnimation(state);
    return;
  }

  // ── CASE 2: hand_end — show results, then send next_hand ──────
  if (state.phase === 'hand_end') {
    // Detect if a trick just resolved (last trick of this hand)
    const trickJustResolved = state.trickHistory.length > prevState.trickHistory.length;

    if (trickJustResolved) {
      // Show collapse animation for the decisive trick
      runCollapseAnimation(state, () => {
        renderCurrentGame();
        // After collapse, show envido dialog if needed
        const envidoAccepted = state.chant?.envido?.accepted && state.chant?.envido?.resolved;
        if (envidoAccepted) {
          setTimeout(() => {
            triggerEnvidoDialog(state);
            // Send next_hand after envido dialog auto-dismisses (10s) or sooner
            setTimeout(() => sendAction({ type: 'next_hand' }), 5500);
          }, 1200);
        } else {
          setTimeout(() => sendAction({ type: 'next_hand' }), 3500);
        }
      });
    } else {
      // Hand ended via truco reject / mazo (no last trick to animate)
      renderCurrentGame();
      const envidoAccepted = state.chant?.envido?.accepted && state.chant?.envido?.resolved;
      if (envidoAccepted) {
        setTimeout(() => {
          triggerEnvidoDialog(state);
          setTimeout(() => sendAction({ type: 'next_hand' }), 5500);
        }, 600);
      } else {
        setTimeout(() => sendAction({ type: 'next_hand' }), 3000);
      }
    }
    return;
  }

  // ── CASE 3: New hand (next_hand processed, new cards dealt) ──
  if (state.handNum !== prevState.handNum) {
    triggerDealAnimation(state);
    return;
  }

  // ── CASE 4: Trick just resolved (not last trick) ──────────────
  const trickJustResolved = state.trickHistory.length > prevState.trickHistory.length;
  if (trickJustResolved) {
    runCollapseAnimation(state, () => {
      renderCurrentGame();
      setTimeout(() => animateSweepTrick(() => renderCurrentGame()), 2000);
    });
    return;
  }

  // ── CASE 5: Card played (first card of trick) ─────────────────
  const prevCount = Object.keys(prevState.playsThisTrick || {}).length;
  const nextCount = Object.keys(state.playsThisTrick   || {}).length;
  if (nextCount > prevCount) {
    // If viewer just played: delay render so fly animation finishes first
    const newSeat  = Object.keys(state.playsThisTrick).map(Number)
                       .find(s => !Object.keys(prevState.playsThisTrick||{}).map(Number).includes(s));
    const isMyCard = newSeat === session.seat;
    const delay    = isMyCard ? Math.max(0, ((window).__qtFlyEnd || 0) - Date.now()) : 0;
    setTimeout(() => renderCurrentGame(), delay);
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
      setStatus(payload.statusText || 'La sala se cerró.', 'err'); leaveOnlineRoom(false); return;
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
  sock.addEventListener('message', ev => { try { handleMessage(JSON.parse(ev.data)); } catch(e) { console.error('[ws]', e); } });
  const onDisc = () => {
    session.connected = false;
    if (!session.roomId) return;
    setStatus('Conexión perdida. Reintentando…', 'warn'); setHeaderStatus('Reconectando…'); scheduleReconnect();
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
    Object.assign(session, { roomId: saved.roomId, roomCode: saved.roomCode||saved.roomId, token: saved.token, seat: saved.seat });
    setupCfg.mode = 'online_1v1'; updateSelectedMode();
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
    Object.assign(session, { roomId:data.roomId, roomCode:data.roomCode, token:data.token, seat:data.seat, pendingRematch:false });
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
    Object.assign(session, { roomId:data.roomId, roomCode:data.roomCode, token:data.token, seat:data.seat, pendingRematch:false });
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
