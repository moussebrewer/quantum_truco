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
import { tr, lang, setLang } from './i18n';

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
  <div class="lang-switch" title="Idioma / Language">
    <button class="lang-btn${lang === 'es' ? ' on' : ''}" onclick="setLang('es')">ES</button>
    <button class="lang-btn${lang === 'en' ? ' on' : ''}" onclick="setLang('en')">EN</button>
  </div>
  <h1 class="setup-title">${tr("TRUCO ⊗ CUÁNTICO", "QUANTUM ⊗ TRUCO")}</h1>
  <p class="setup-tagline">${tr("Truco argentino con cartas cuánticas: cada carta es dos a la vez hasta que se juega.", "Argentine Truco with quantum cards: every card is two at once until it is played.")}</p>
  <div class="setup-card">

    <!-- 1. Contra quién -->
    <div class="setup-step">
      <div class="setup-q"><span class="setup-n">1</span>${tr("¿Contra quién jugás?", "Who are you playing against?")}</div>
      <div class="play-options" id="opts-play">
        <button class="play-btn selected" data-play="ai">
          <span class="play-ico">🤖</span>
          <span class="play-txt"><span class="play-name">${tr("Contra la máquina", "Against the computer")}</span><span class="play-desc">${tr("Vos solo, sin conexión", "Just you, offline")}</span></span>
        </button>
        <button class="play-btn" data-play="local">
          <span class="play-ico">👥</span>
          <span class="play-txt"><span class="play-name">${tr("En este dispositivo", "On this device")}</span><span class="play-desc">${tr("Se lo pasan entre todos", "Pass it around the table")}</span></span>
        </button>
        <button class="play-btn" data-play="online">
          <span class="play-ico">🌐</span>
          <span class="play-txt"><span class="play-name">Online</span><span class="play-desc">${tr("Cada uno desde el suyo, con un código", "Each on their own device, with a code")}</span></span>
        </button>
      </div>
    </div>

    <!-- 2a. Rival (solo contra la máquina) -->
    <div class="setup-step" id="step-level">
      <div class="setup-q"><span class="setup-n">2</span>${tr("Elegí tu rival", "Pick your opponent")}</div>
      <div class="setup-options" id="opts-mode">
        <button class="opt-btn level-btn selected" data-group="mode" data-val="ai_medium"><span>🃏 El Pibe</span><span class="lvl-tag">${tr("Fácil", "Easy")}</span></button>
        <button class="opt-btn level-btn" data-group="mode" data-val="ai_hard"><span>🎩 Citadino</span><span class="lvl-tag">${tr("Medio", "Medium")}</span></button>
        <button class="opt-btn level-btn" data-group="mode" data-val="ai_expert"><span>🧉 Gaucho Digital</span><span class="lvl-tag">${tr("Difícil", "Hard")}</span></button>
        <button class="opt-btn level-btn" data-group="mode" data-val="ai_legend"><span>🃑 El Duende</span><span class="lvl-tag">${tr("Experto", "Expert")}</span></button>
      </div>
    </div>

    <!-- 2b. Cuántos (en este dispositivo u online) -->
    <div class="setup-step" id="step-players" style="display:none">
      <div class="setup-q"><span class="setup-n">2</span>${tr("¿Cuántos juegan?", "How many players?")}</div>
      <div class="setup-options players-options" id="opts-players">
        <button class="opt-btn level-btn selected" data-group="players" data-val="2"><span>2</span><span class="lvl-tag">${tr("Mano a mano", "One on one")}</span></button>
        <button class="opt-btn level-btn" data-group="players" data-val="4"><span>4</span><span class="lvl-tag">${tr("Dos parejas", "Two pairs")}</span></button>
        <button class="opt-btn level-btn" data-group="players" data-val="6"><span>6</span><span class="lvl-tag">${tr("Dos tríos", "Two trios")}</span></button>
      </div>
    </div>

    <!-- 3. Reglas -->
    <div class="setup-step">
      <div class="setup-q"><span class="setup-n">3</span>${tr("Reglas de la partida", "Game rules")}</div>
      <div class="setup-row">
        <span class="setup-label">${tr("Puntaje", "Points")}<small>${tr("Hasta cuánto se juega", "Points needed to win")}</small></span>
        <div class="setup-options" id="opts-target">
          <button class="opt-btn selected" data-group="target" data-val="15">15 pts</button>
          <button class="opt-btn" data-group="target" data-val="30">30 pts</button>
        </div>
      </div>
      <div class="setup-row">
        <span class="setup-label">Flor<small>${tr("Tres del mismo palo valen puntos", "Three cards of the same suit score points")}</small></span>
        <button class="toggle-btn" id="btn-flor" onclick="toggleFlor()">NO</button>
      </div>
      <div class="setup-row">
        <span class="setup-label">${tr("Estados preparados", "Prepared states")}<small>${tr("Las dos opciones de cada carta dejan de ser mitad y mitad: van de 25% a 75%", "The two options of each card stop being fifty-fifty: they range from 25% to 75%")}</small></span>
        <button class="toggle-btn" id="btn-prepared" onclick="togglePrepared()">NO</button>
      </div>
    </div>

    <!-- Online: crear o unirse -->
    <div class="online-room-panel" id="online-room-panel" style="display:none">
      <div class="setup-row">
        <span class="setup-label">${tr("Sala nueva", "New room")}<small>${tr("Te da un código para compartir", "Gives you a code to share")}</small></span>
        <div class="online-room-actions">
          <button class="opt-btn online-room-btn" onclick="createOnlineRoom()">${tr("Crear sala", "Create room")}</button>
        </div>
      </div>
      <div class="setup-row">
        <span class="setup-label">${tr("Unirme", "Join")}<small>${tr("Con el código que te pasaron", "With the code you were given")}</small></span>
        <div class="online-join-controls">
          <input id="room-code-input" class="online-room-input" maxlength="8" placeholder="${tr("Código", "Code")}" />
          <button class="opt-btn online-room-btn" onclick="joinOnlineRoom()">${tr("Entrar", "Join")}</button>
        </div>
      </div>
      <div class="online-status" id="online-status">${tr("Creá una sala o ingresá un código para unirte.", "Create a room or enter a code to join.")}</div>
    </div>

    <button class="start-btn" id="btn-start-game" onclick="startGame()">${tr("COMENZAR PARTIDA →", "START GAME →")}</button>
    <button class="help-btn" onclick="openTutorial()">${tr("¿Cómo se juega?", "How to play")}</button>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!-- PASS PHONE OVERLAY (modal sobre la game screen)           -->
<!-- ══════════════════════════════════════════════════════════ -->
<!-- Tutorial -->
<div id="screen-help" class="screen">
  <div class="help-top">
    <button class="quantum-btn-small" onclick="closeTutorial()">${tr("← Volver", "← Back")}</button>
    <div class="help-title">${tr("Cómo se juega", "How to play")}</div>
  </div>
  <div class="help-tracks" id="help-tracks">
    <button class="opt-btn selected" data-track="knows">${tr("Ya sé jugar al truco", "I already play truco")}</button>
    <button class="opt-btn" data-track="new">${tr("Nunca jugué al truco", "I have never played truco")}</button>
  </div>
  <div class="help-slide" id="help-slide"></div>
  <div class="help-nav">
    <button class="continue-btn secondary" id="help-prev">${tr("← Atrás", "← Back")}</button>
    <div class="help-dots" id="help-dots"></div>
    <button class="continue-btn" id="help-next">${tr("Siguiente →", "Next →")}</button>
  </div>
</div>

<div class="pass-overlay" id="pass-overlay">
  <div class="pass-box">
    <div class="pass-title" id="pass-title">${tr("TURNO", "TURN")}</div>
    <div class="pass-sub" id="pass-sub">${tr("Pasá el dispositivo. No mires.", "Pass the device. No peeking.")}</div>
    <button class="continue-btn" onclick="dismissPass()">${tr("VER MI MANO →", "SHOW MY HAND →")}</button>
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
        <div class="score-team-head t0"><span class="score-team-name" id="score-name-0">${tr("Equipo A", "Team A")}</span><span class="score-num" id="score-num-0">0</span></div>
        <div class="score-pts-wrap" id="score-tally-0"></div>
      </div>
      <div class="score-sep">vs</div>
      <div class="score-team">
        <div class="score-team-head t1"><span class="score-team-name" id="score-name-1">${tr("Equipo B", "Team B")}</span><span class="score-num" id="score-num-1">0</span></div>
        <div class="score-pts-wrap" id="score-tally-1"></div>
      </div>
    </div>
    <div class="game-info">
      <div class="game-round-label" id="hdr-round">${tr("Mano 1 · Baza 1", "Hand 1 · Trick 1")}</div>
      <div class="game-bet-label" id="hdr-bet">Truco: Base (1 pt)</div>
    </div>
    <div class="header-actions">
      <div class="online-header-status" id="online-header-status"></div>
      <button class="quantum-btn-small" id="btn-exit" onclick="exitToMenu()" title="${tr("Salir al menú principal", "Leave to the main menu")}">${tr("Salir", "Leave")}</button>
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
          <button class="log-clear-btn" onclick="clearLog()" title="${tr("Borrar el log", "Clear the log")}">${tr("Limpiar", "Clear")}</button>
          <button class="log-close-btn" onclick="toggleLog()" title="${tr("Cerrar log", "Close log")}">✕</button>
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
          <div class="mazo-label">${tr("Mazo", "Deck")}</div>
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
        <div class="history-title">${tr("Bazas", "Tricks")}</div>
        <div class="history-list" id="history-list"></div>
      </div>
      <!-- Chat: solo se ve en partidas online -->
      <div class="chat-panel" id="chat-panel">
        <div class="chat-header">
          <span>Chat</span>
          <button class="log-close-btn chat-close" onclick="toggleChat()" title="${tr("Cerrar chat", "Close chat")}">✕</button>
        </div>
        <div class="chat-list" id="chat-list"></div>
        <form class="chat-form" id="chat-form" autocomplete="off">
          <input class="chat-input" id="chat-input" maxlength="200" placeholder="${tr("Escribí un mensaje…", "Write a message…")}" />
          <button class="chat-send" type="submit" title="${tr("Enviar", "Send")}">➤</button>
        </form>
      </div>
      <div class="chant-panel">
        <div class="chant-turn" id="chant-turn">${tr("Turno", "Turn")}</div>
        <div class="chant-btns" id="chant-btns"></div>
      </div>
    </div>
  </div>

</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!-- WIN SCREEN                                                 -->
<!-- ══════════════════════════════════════════════════════════ -->
<div id="screen-win" class="screen">
  <div class="win-title" id="win-title">${tr("¡GANARON!", "WINNERS!")}</div>
  <div class="win-sub" id="win-sub"></div>
  <div class="win-score" id="win-score">15 — 8</div>
  <div class="win-status" id="win-status"></div>
  <div class="win-actions">
    <button class="continue-btn" id="btn-win-again" onclick="restartGame()">${tr("Nueva partida", "New game")}</button>
    <button class="continue-btn secondary" id="btn-win-menu" onclick="backToMenu()">${tr("Volver al menú", "Back to menu")}</button>
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
  document.documentElement.lang = lang;
  document.title = tr('Truco Cuántico', 'Quantum Truco');
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
window.setLang = setLang;

// Modo de estados preparados: las dos opciones de cada carta dejan de ser
// mitad y mitad (se sortea entre 25% y 75%, de a 5).
window.togglePrepared = () => {
  setupCfg.prepared = !setupCfg.prepared;
  const btn = document.getElementById('btn-prepared');
  if (btn) {
    btn.textContent = setupCfg.prepared ? tr('SÍ', 'YES') : 'NO';
    btn.classList.toggle('on', setupCfg.prepared);
  }
};
window.openTutorial = () => openTutorial();
window.closeTutorial = closeTutorial;

// Botón "Salir" de la partida: pregunta antes y vuelve al menú principal.
// Offline la partida se cancela; online se abandona la sala.
window.exitToMenu = () => {
  const online = hasOnlineSession();
  showModal('danger', tr('¿Salir al menú?', 'Leave to the menu?'),
    online
      ? tr('Vas a abandonar la sala. Tu lugar queda libre y los demás se quedan esperando.', 'You will leave the room. Your seat becomes free and the others will be left waiting.')
      : tr('La partida en curso se cancela y no se puede retomar.', 'The current game is cancelled and cannot be resumed.'),
    null,
    [
      { label: tr('Sí, salir', 'Yes, leave'), cls: 'danger', cb: () => {
          closeModal();
          // Cerrar lo que pudiera estar abierto encima de la mesa.
          setEnvidoOverlayOnClose(null);
          document.getElementById('envido-overlay')?.classList.remove('open');
          hidePassOverlay();
          document.querySelectorAll('.new-hand-overlay, .fly-ghost').forEach(el => el.remove());
          if (online) leaveOnlineRoom();
          restartLocalGame();
      }},
      { label: tr('Seguir jugando', 'Keep playing'), cls: 'primary', cb: () => closeModal() },
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
