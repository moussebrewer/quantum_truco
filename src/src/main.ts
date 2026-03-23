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
} from './ui';

import {
  configureGameRuntime,
  toggleFlor,
  startGame as startLocalGame,
  restartGame as restartLocalGame,
  dismissPass,
} from './game';

import {
  bootstrapOnlineUi,
  createOnlineRoomFromUI,
  joinOnlineRoomFromUI,
  leaveOnlineRoom,
  requestOnlineRematch,
  isOnlineClientMode,
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
  resetAITurn,
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
        <button class="opt-btn" data-group="mode" data-val="online_1v1">🌐 Online 1v1</button>
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
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!-- PASS PHONE OVERLAY (modal sobre la game screen)           -->
<!-- ══════════════════════════════════════════════════════════ -->
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
        <div class="score-team-name t0">Eq A</div>
        <div class="score-pts-wrap" id="score-tally-0"></div>
      </div>
      <div class="score-sep">vs</div>
      <div class="score-team">
        <div class="score-team-name t1">Eq B</div>
        <div class="score-pts-wrap" id="score-tally-1"></div>
      </div>
    </div>
    <div class="game-info">
      <div class="game-round-label" id="hdr-round">Mano 1 · Baza 1</div>
      <div class="game-bet-label" id="hdr-bet">Truco: Base (1 pt)</div>
    </div>
    <div class="online-header-status" id="online-header-status"></div>
    <button class="quantum-btn-small" id="btn-online-leave" onclick="leaveOnlineRoom()" style="display:none">SALIR</button>
    <button class="quantum-btn-small" id="btn-log-toggle" onclick="toggleLog()">⊗ LOG</button>
  </div>

  <!-- Main area: log sidebar + arena + history sidebar -->
  <div class="game-table">
    <!-- Log sidebar (left, open by default) -->
    <div class="log-sidebar" id="log-sidebar">
      <div class="log-sidebar-header">
        <span class="log-sidebar-title">⊗ Log</span>
        <button class="log-close-btn" onclick="toggleLog()" title="Cerrar log">✕</button>
      </div>
      <div class="log-entries" id="log-panel"></div>
    </div>

    <div class="arena" id="arena">
      <div class="mazo-stack" id="mazo-stack">
        <div class="mazo-card mazo-c3"></div>
        <div class="mazo-card mazo-c2"></div>
        <div class="mazo-card mazo-c1" id="mazo-c1">⊗</div>
        <div class="mazo-label">Mazo</div>
      </div>
      <div class="baza-result" id="baza-result-display"></div>
      <div class="arena-slots" id="arena-slots"></div>
    </div>
    <div class="history-panel" id="history-panel">
      <div class="history-title">Bazas</div>
      <div class="history-list" id="history-list"></div>
    </div>
  </div>

  <!-- Bottom zone: cards + action panel side by side -->
  <div class="bottom-zone">

    <!-- Mano: cartas en fila + info envido -->
    <div class="hand-area">
      <div class="hand-row" id="hand-row"></div>
      <div class="envido-info" id="envido-info"></div>
    </div>

    <!-- Cantos panel (a la derecha de las cartas) -->
    <div class="chant-panel">
      <div class="chant-turn" id="chant-turn">Turno</div>
      <div class="chant-btns" id="chant-btns"></div>
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
  <button class="continue-btn" onclick="restartGame()">NUEVA PARTIDA</button>
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
  resetAITurn,
});

bootstrapOnlineUi();

window.toggleFlor = toggleFlor;
window.startGame = () => {
  if (isOnlineClientMode()) {
    const codeInput = document.getElementById('room-code-input') as HTMLInputElement | null;
    const code = (codeInput?.value || '').trim();
    if (code) joinOnlineRoomFromUI();
    else createOnlineRoomFromUI();
    return;
  }
  startLocalGame();
};
window.dismissPass = dismissPass;
window.toggleLog = toggleLog;
window.restartGame = () => {
  if (isOnlineClientMode()) {
    requestOnlineRematch();
    return;
  }
  restartLocalGame();
};
window.closeEnvidoOverlay = closeEnvidoOverlay;
window.createOnlineRoom = createOnlineRoomFromUI;
window.joinOnlineRoom = joinOnlineRoomFromUI;
window.leaveOnlineRoom = leaveOnlineRoom;
