// @ts-nocheck
import './styles.css';

import {
  initSetupOptions,
  showScreen,
  renderGame,
  renderHand,
  renderArena,
  buildCardSVG,
  buildEntangled,
  showPassOverlay,
  hidePassOverlay,
  showWinScreen,
  isEnvidoOverlayOpen,
  setEnvidoOverlayOnClose,
  showTrucoCallToast,
  showTrucoToast,
  showEnvidoAnnouncement,
  closeEnvidoOverlay,
  showModal,
  closeModal,
  log,
  toggleLog,
  clearLog,
  toggleChat,
  showSay,
} from './ui';

import {
  configureGameRuntime,
  setupCfg,
  toggleFlor,
  startGame as startLocalGame,
  restartGame as restartLocalGame,
  dismissPass,
} from './game';

import { initTutorial, openTutorial, closeTutorial } from './tutorial';

import {
  bootstrapOnlineUi,
  createOnlineRoomFromUI,
  joinOnlineRoomFromUI,
  leaveOnlineRoom,
  requestOnlineRematch,
  isOnlineClientMode,
  hasOnlineSession,
} from './online';

import {
  aiNewToken,
  aiValidToken,
  aiSchedule,
  aiThink,
  aiTakeTurn,
  aiResume,
  aiHandlePendingChant,
  aiRecordHand,
  resetAIState,
} from './ai';

const APP_HTML = `<!-- ══════════════════════════════════════════════════════════ -->
<!-- SETUP SCREEN                                               -->
<!-- ══════════════════════════════════════════════════════════ -->
<div id="screen-setup" class="screen active">
  <h1 class="setup-title">QUANTUM ⊗ TRUCO</h1>
  <div class="setup-card">
    <div class="setup-row">
      <span class="setup-label">Modo</span>
      <div class="setup-options" id="opts-mode">
        <button class="opt-btn selected" data-group="mode" data-val="human">👥 Humanos</button>
        <button class="opt-btn" data-group="mode" data-val="online_1v1">🌐 Online</button>
        <button class="opt-btn" data-group="mode" data-val="ai_medium">🃏 El Pibe</button>
        <button class="opt-btn" data-group="mode" data-val="ai_hard">🎩 Citadino</button>
        <button class="opt-btn" data-group="mode" data-val="ai_expert">🧉 Gaucho Digital</button>
        <button class="opt-btn" data-group="mode" data-val="ai_legend">🃑 El Duende</button>
      </div>
    </div>
    <div class="setup-divider"></div>
    <div class="setup-row">
      <span class="setup-label">Jugadores</span>
      <div class="setup-options" id="opts-players">
        <button class="opt-btn selected" data-group="players" data-val="2">2</button>
        <button class="opt-btn" data-group="players" data-val="4">4</button>
        <button class="opt-btn" data-group="players" data-val="6">6</button>
      </div>
    </div>
    <div class="setup-divider"></div>
    <div class="setup-row">
      <span class="setup-label">Puntaje</span>
      <div class="setup-options" id="opts-target">
        <button class="opt-btn selected" data-group="target" data-val="15">15 pts</button>
        <button class="opt-btn" data-group="target" data-val="30">30 pts</button>
      </div>
    </div>
    <div class="setup-divider"></div>
    <div class="setup-row">
      <span class="setup-label">Con Flor</span>
      <button class="toggle-btn" id="btn-flor" onclick="toggleFlor()">NO</button>
    </div>
    <div class="setup-divider" id="online-divider" style="display:none"></div>
    <div class="online-room-panel" id="online-room-panel" style="display:none">
      <div class="setup-row">
        <span class="setup-label">Crear</span>
        <div class="online-room-actions">
          <button class="opt-btn online-room-btn" onclick="createOnlineRoom()">Crear sala</button>
        </div>
      </div>
      <div class="setup-row">
        <span class="setup-label">Unirme</span>
        <div class="online-join-controls">
          <input id="room-code-input" class="online-room-input" maxlength="8" placeholder="Código de sala" />
          <button class="opt-btn online-room-btn" onclick="joinOnlineRoom()">Entrar</button>
        </div>
      </div>
      <div class="online-status" id="online-status">Elegí crear una sala o ingresá un código para unirte.</div>
    </div>
    <button class="start-btn" id="btn-start-game" onclick="startGame()">COMENZAR PARTIDA →</button>
    <button class="help-btn" onclick="openTutorial()">¿Cómo se juega?</button>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!-- PASS PHONE OVERLAY (modal sobre la game screen)           -->
<!-- ══════════════════════════════════════════════════════════ -->
<!-- Tutorial -->
<div id="screen-help" class="screen">
  <div class="help-top">
    <button class="quantum-btn-small" onclick="closeTutorial()">← Volver</button>
    <div class="help-title">Cómo se juega</div>
  </div>
  <div class="help-tracks" id="help-tracks">
    <button class="opt-btn selected" data-track="knows">Ya sé jugar al truco</button>
    <button class="opt-btn" data-track="new">Nunca jugué al truco</button>
  </div>
  <div class="help-slide" id="help-slide"></div>
  <div class="help-nav">
    <button class="continue-btn secondary" id="help-prev">← Atrás</button>
    <div class="help-dots" id="help-dots"></div>
    <button class="continue-btn" id="help-next">Siguiente →</button>
  </div>
</div>

<div class="pass-overlay" id="pass-overlay">
  <div class="pass-box">
    <div class="pass-title" id="pass-title">TURNO</div>
    <div class="pass-sub" id="pass-sub">Pasá el dispositivo. No mires.</div>
    <button class="continue-btn" onclick="dismissPass()">VER MI MANO →</button>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!-- GAME SCREEN                                                -->
<!-- ══════════════════════════════════════════════════════════ -->
<div id="screen-game" class="screen">

  <!-- Header -->
  <div class="game-header">
    <div class="score-display">
      <div class="score-team">
        <div class="score-team-head t0"><span class="score-team-name" id="score-name-0">Equipo A</span><span class="score-num" id="score-num-0">0</span></div>
        <div class="score-pts-wrap" id="score-tally-0"></div>
      </div>
      <div class="score-sep">vs</div>
      <div class="score-team">
        <div class="score-team-head t1"><span class="score-team-name" id="score-name-1">Equipo B</span><span class="score-num" id="score-num-1">0</span></div>
        <div class="score-pts-wrap" id="score-tally-1"></div>
      </div>
    </div>
    <div class="game-info">
      <div class="game-round-label" id="hdr-round">Mano 1 · Baza 1</div>
      <div class="game-bet-label" id="hdr-bet">Truco: Base (1 pt)</div>
    </div>
    <div class="header-actions">
      <div class="online-header-status" id="online-header-status"></div>
      <button class="quantum-btn-small" id="btn-exit" onclick="exitToMenu()" title="Salir al menú principal">Salir</button>
      <button class="quantum-btn-small chat-toggle" id="btn-chat-toggle" onclick="toggleChat()">Chat<span class="chat-badge" id="chat-badge" style="display:none">0</span></button>
      <button class="quantum-btn-small" id="btn-log-toggle" onclick="toggleLog()">Log</button>
    </div>
  </div>

  <!-- Cuerpo: log | mesa + mano | bazas + cantos -->
  <div class="game-table">
    <!-- Log (izquierda, plegable) -->
    <div class="log-sidebar" id="log-sidebar">
      <div class="log-sidebar-header">
        <span class="log-sidebar-title">⊗ Log</span>
        <span class="log-header-actions">
          <button class="log-clear-btn" onclick="clearLog()" title="Borrar el log">Limpiar</button>
          <button class="log-close-btn" onclick="toggleLog()" title="Cerrar log">✕</button>
        </span>
      </div>
      <div class="log-entries" id="log-panel"></div>
    </div>

    <!-- Columna de juego: mesa arriba, mano abajo -->
    <div class="play-col">
      <div class="arena" id="arena">
        <div class="opp-zone" id="opp-zone"></div>
        <div class="arena-center">
          <div class="arena-slots" id="arena-slots"></div>
          <div class="baza-result" id="baza-result-display"></div>
        </div>
        <div class="mazo-stack" id="mazo-stack">
          <div class="mazo-pile">
            <div class="card-back mazo-c3"></div>
            <div class="card-back mazo-c2"></div>
            <div class="card-back mazo-c1" id="mazo-c1">⊗</div>
          </div>
          <div class="mazo-label">Mazo</div>
        </div>
      </div>
      <div class="hand-area">
        <div class="turn-banner empty" id="turn-banner"></div>
        <div class="hand-row" id="hand-row"></div>
        <div class="envido-info" id="envido-info"></div>
      </div>
    </div>

    <!-- Columna lateral: historial de bazas arriba, cantos abajo.
         Así los botones pueden crecer sin mover la mesa. -->
    <div class="side-col">
      <div class="history-panel" id="history-panel">
        <div class="history-title">Bazas</div>
        <div class="history-list" id="history-list"></div>
      </div>
      <!-- Chat: solo se ve en partidas online -->
      <div class="chat-panel" id="chat-panel">
        <div class="chat-header">
          <span>Chat</span>
          <button class="log-close-btn chat-close" onclick="toggleChat()" title="Cerrar chat">✕</button>
        </div>
        <div class="chat-list" id="chat-list"></div>
        <form class="chat-form" id="chat-form" autocomplete="off">
          <input class="chat-input" id="chat-input" maxlength="200" placeholder="Escribí un mensaje…" />
          <button class="chat-send" type="submit" title="Enviar">➤</button>
        </form>
      </div>
      <div class="chant-panel">
        <div class="chant-turn" id="chant-turn">Turno</div>
        <div class="chant-btns" id="chant-btns"></div>
      </div>
    </div>
  </div>

</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!-- WIN SCREEN                                                 -->
<!-- ══════════════════════════════════════════════════════════ -->
<div id="screen-win" class="screen">
  <div class="win-title" id="win-title">¡GANARON!</div>
  <div class="win-sub" id="win-sub">Equipo victorioso</div>
  <div class="win-score" id="win-score">15 — 8</div>
  <div class="win-status" id="win-status"></div>
  <div class="win-actions">
    <button class="continue-btn" id="btn-win-again" onclick="restartGame()">Nueva partida</button>
    <button class="continue-btn secondary" id="btn-win-menu" onclick="backToMenu()">Volver al menú</button>
  </div>
</div>

<!-- Truco acceptance toast -->
<div class="truco-toast" id="truco-toast"></div>

<!-- ══════════════════════════════════════════════════════════ -->
<!-- ENVIDO REVEAL OVERLAY                                      -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="envido-overlay" id="envido-overlay">
  <div class="envido-reveal-box">
    <div class="envido-reveal-title">⚡ Envido ⚡</div>
    <div class="envido-reveal-subtitle" id="envido-reveal-subtitle">Las cartas colapsan</div>
    <div class="envido-teams-row" id="envido-teams-row"></div>
    <div class="envido-pts-awarded" id="envido-pts-awarded"></div>
    <button class="envido-continue-btn" id="envido-continue-btn" onclick="closeEnvidoOverlay()">Seguir jugando →</button>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!-- MODAL                                                      -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="modal-overlay" id="modal">
  <div class="modal-box">
    <div class="modal-title" id="modal-title">Acción</div>
    <div class="modal-body" id="modal-body"></div>
    <div class="modal-pts-display" id="modal-pts" style="display:none"></div>
    <div class="modal-btns" id="modal-btns"></div>
  </div>
</div>

<!-- log panel is now inside .game-table -->`;

function ensureFonts() {
  if (!document.querySelector('link[data-qt-font-preconnect]')) {
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = 'https://fonts.googleapis.com';
    preconnect.setAttribute('data-qt-font-preconnect', '1');
    document.head.appendChild(preconnect);
  }
  if (!document.querySelector('link[data-qt-font-stylesheet]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=IM+Fell+English:ital@0;1&family=Space+Mono:wght@400;700&display=swap';
    stylesheet.setAttribute('data-qt-font-stylesheet', '1');
    document.head.appendChild(stylesheet);
  }
}

function mountApp() {
  ensureFonts();
  document.body.innerHTML = APP_HTML;
  // En pantallas angostas el log arranca cerrado para no tapar la mesa.
  if (window.innerWidth < 1200) {
    document.getElementById('log-sidebar')?.classList.add('closed');
  }
}

declare global {
  interface Window {
    toggleFlor: () => void;
    startGame: () => void;
    dismissPass: () => void;
    toggleLog: () => void;
    restartGame: () => void;
    closeEnvidoOverlay: () => void;
    createOnlineRoom: () => void;
    joinOnlineRoom: () => void;
    leaveOnlineRoom: () => void;
  }
}

mountApp();
initSetupOptions();
initTutorial();

configureGameRuntime({
  renderGame,
  renderHand,
  renderArena,
  buildCardSVG,
  buildEntangled,
  showScreen,
  showPassOverlay,
  hidePassOverlay,
  showWinScreen,
  isEnvidoOverlayOpen,
  setEnvidoOverlayOnClose,
  showTrucoCallToast,
  showTrucoToast,
  showSay,
  showEnvidoAnnouncement,
  showModal,
  closeModal,
  log,
  aiNewToken,
  aiValidToken,
  aiSchedule,
  aiThink,
  aiTakeTurn,
  aiResume,
  aiHandlePendingChant,
  aiRecordHand,
  resetAIState,
});

bootstrapOnlineUi();

window.toggleFlor = toggleFlor;
window.startGame = () => {
  if (setupCfg.mode === 'online_1v1') {
    const codeInput = document.getElementById('room-code-input') as HTMLInputElement | null;
    const code = (codeInput?.value || '').trim();
    if (code) joinOnlineRoomFromUI();
    else createOnlineRoomFromUI();
    return;
  }
  // Si quedó guardada una sala online vieja, se abandona antes de jugar offline.
  if (hasOnlineSession()) leaveOnlineRoom();
  clearLog(); // cada partida arranca con el log vacío
  startLocalGame();
};
window.clearLog = clearLog;
window.openTutorial = () => openTutorial();
window.closeTutorial = closeTutorial;

// Botón "Salir" de la partida: pregunta antes y vuelve al menú principal.
// Offline la partida se cancela; online se abandona la sala.
window.exitToMenu = () => {
  const online = hasOnlineSession();
  showModal('danger', '¿Salir al menú?',
    online
      ? 'Vas a abandonar la sala. Tu lugar queda libre y los demás se quedan esperando.'
      : 'La partida en curso se cancela y no se puede retomar.',
    null,
    [
      { label: 'Sí, salir', cls: 'danger', cb: () => {
          closeModal();
          // Cerrar lo que pudiera estar abierto encima de la mesa.
          setEnvidoOverlayOnClose(null);
          document.getElementById('envido-overlay')?.classList.remove('open');
          hidePassOverlay();
          document.querySelectorAll('.new-hand-overlay, .fly-ghost').forEach(el => el.remove());
          if (online) leaveOnlineRoom();
          restartLocalGame();
      }},
      { label: 'Seguir jugando', cls: 'primary', cb: () => closeModal() },
    ]);
};
// Salida de la pantalla de final: siempre vuelve al menú, y si la partida
// era online abandona la sala (para que no se reabra sola al recargar).
window.backToMenu = () => {
  if (hasOnlineSession()) leaveOnlineRoom();
  else restartLocalGame();
};
window.dismissPass = dismissPass;
window.toggleLog = toggleLog;
window.toggleChat = toggleChat;
window.restartGame = () => {
  if (hasOnlineSession()) {
    requestOnlineRematch();
    return;
  }
  restartLocalGame();
};
window.closeEnvidoOverlay = closeEnvidoOverlay;
window.createOnlineRoom = createOnlineRoomFromUI;
window.joinOnlineRoom = joinOnlineRoomFromUI;
window.leaveOnlineRoom = leaveOnlineRoom;
