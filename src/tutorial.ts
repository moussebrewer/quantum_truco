// @ts-nocheck
// Tutorial dentro del juego, con dos recorridos:
//  - "knows": para quien ya juega al truco (solo lo que cambia)
//  - "new":   para quien nunca jugó (lo básico del truco y después lo cuántico)
// Las ilustraciones usan las mismas cartas que la partida.

import { buildCardSVG, buildEntangled } from './cards';

const card = (n, palo, w = 74) =>
  `<div class="qcard tut-card" style="--card-w:${w}px">${buildCardSVG(n, palo)}</div>`;
const qcard = (a, pa, b, pb, w = 74) =>
  `<div class="qcard tut-card tut-quantum" style="--card-w:${w}px">${buildEntangled(a, pa, b, pb, false)}</div>`;
const arrow = (t = '→') => `<div class="tut-arrow">${t}</div>`;
const note = (t) => `<div class="tut-note">${t}</div>`;
const col = (inner, label) => `<div class="tut-col">${inner}${label ? `<div class="tut-label">${label}</div>` : ''}</div>`;
const chip = (t, cls = '') => `<span class="tut-chip ${cls}">${t}</span>`;
const mini = (n, palo) => card(n, palo, 38);

// ── Lo básico del truco ──────────────────────────────────────
const BASICS = [
  {
    title: 'De qué se trata',
    art: `<div class="tut-row">${card(1, 'espada', 70)}${card(7, 'oro', 70)}${card(3, 'copa', 70)}</div>`,
    body: `
      <p>El truco se juega mano a mano o en equipos, a <b>15 o 30 puntos</b>.</p>
      <p>En cada <b>mano</b> recibís 3 cartas y se juegan 3 <b>bazas</b>: en cada baza cada jugador tira una carta y gana la más alta.</p>
      <p>Quien gana <b>2 de las 3 bazas</b> gana la mano y suma 1 punto… o más, si se apostó.</p>`,
  },
  {
    title: 'Qué carta le gana a cuál',
    art: `
      <div class="tut-ladder">
        <div class="tut-rung"><span class="tut-rung-name">Las cuatro bravas</span>
          <div class="tut-row tight">${mini(1, 'espada')}${arrow('›')}${mini(1, 'basto')}${arrow('›')}${mini(7, 'espada')}${arrow('›')}${mini(7, 'oro')}</div></div>
        <div class="tut-rung"><span class="tut-rung-name">Después</span>
          <div class="tut-row tight">${mini(3, 'copa')}${arrow('›')}${mini(2, 'basto')}${arrow('›')}${mini(1, 'copa')}${arrow('›')}${mini(12, 'oro')}${arrow('›')}${mini(11, 'espada')}${arrow('›')}${mini(10, 'basto')}</div></div>
        <div class="tut-rung"><span class="tut-rung-name">Las más bajas</span>
          <div class="tut-row tight">${mini(7, 'copa')}${arrow('›')}${mini(6, 'oro')}${arrow('›')}${mini(5, 'espada')}${arrow('›')}${mini(4, 'basto')}</div></div>
      </div>`,
    body: `
      <p>El orden no es el de los números. Mandan cuatro cartas: <b>1 de espadas</b>, <b>1 de bastos</b>, <b>7 de espadas</b> y <b>7 de oros</b>.</p>
      <p>Después vienen los <b>3</b>, los <b>2</b>, los otros <b>1</b>, y las figuras: <b>12</b>, <b>11</b>, <b>10</b>. Al final los otros 7, los 6, los 5 y los 4.</p>
      <p>Fuera de las cuatro bravas el palo no importa: dos cartas del mismo número empatan. Eso es una <b>parda</b>.</p>`,
  },
  {
    title: 'El truco: apostar la mano',
    art: `<div class="tut-row">${chip('Truco · 2', 'gold')}${arrow()}${chip('Retruco · 3', 'gold')}${arrow()}${chip('Vale cuatro · 4', 'gold')}</div>
          <div class="tut-row">${chip('Quiero', 'green')}${chip('No quiero', 'red')}${chip('Subir', 'gold')}</div>`,
    body: `
      <p>En tu turno podés cantar <b>Truco</b>: la mano pasa a valer 2 puntos en vez de 1.</p>
      <p>El rival elige: <b>Quiero</b> (se juega por 2), <b>No quiero</b> (se rinde y vos cobrás 1) o sube a <b>Retruco</b> (3). Sobre el retruco se puede cantar <b>Vale cuatro</b> (4).</p>
      <p>Solo puede subir la apuesta el que aceptó la anterior.</p>`,
  },
  {
    title: 'El envido: el tanto',
    art: `<div class="tut-row">${card(7, 'oro', 62)}${card(6, 'oro', 62)}${card(12, 'espada', 62)}${arrow('=')}<div class="tut-big">33</div></div>
          ${note('20 por tener dos del mismo palo + 7 + 6')}`,
    body: `
      <p>Es una apuesta aparte, que se canta <b>en la primera baza</b>, antes de tirar tu carta. Gana quien tenga más <b>tanto</b>.</p>
      <p>Dos cartas del mismo palo valen <b>20 más la suma de las dos</b>. Las figuras (10, 11 y 12) suman cero. Sin dos del mismo palo, tu tanto es tu carta más alta.</p>
      <p><b>Envido</b> vale 2, <b>Real envido</b> 3 y <b>Falta envido</b> lo que le falta al que va ganando. Si no te lo quieren, cobrás 1.</p>`,
  },
  {
    title: 'Mentir es parte del juego',
    art: `<div class="tut-row">${chip('¡Truco!', 'gold big')}${arrow('…')}${chip('No quiero', 'red big')}</div>`,
    body: `
      <p>Nadie ve tus cartas. Podés cantar truco o envido con una mano mala para que el otro se achique, o hacerte el débil con una buena.</p>
      <p>Si no querés seguir, podés <b>irte al mazo</b>: te rendís y el rival cobra lo que estaba en juego.</p>
      <p>Hasta acá, truco de toda la vida. Ahora viene lo distinto.</p>`,
  },
];

// ── Lo cuántico ──────────────────────────────────────────────
const QUANTUM = [
  {
    title: 'Cada carta son dos a la vez',
    art: `<div class="tut-row">${col(qcard(1, 'espada', 4, 'copa', 104))}</div>
          ${note('Puede ser el 1 de espadas… o el 4 de copas')}`,
    body: `
      <p>Cada carta de tu mano está partida en diagonal y muestra <b>sus dos posibilidades</b>. Va a terminar siendo una de las dos, y no sabés cuál.</p>
      <p>Tu rival tampoco sabe qué tiene. Todos apuestan sobre lo que <b>podría</b> salir.</p>`,
  },
  {
    title: 'Colapsa cuando termina la baza',
    art: `<div class="tut-row">${col(qcard(1, 'espada', 4, 'copa', 78), 'la jugás así')}${arrow()}
          <div class="tut-col"><div class="tut-row tight">${card(1, 'espada', 60)}<span class="tut-or">o</span>${card(4, 'copa', 60)}</div><div class="tut-label">mitad y mitad</div></div></div>`,
    body: `
      <p>Tirás la carta sin saber cuál es. Cuando todos jugaron, las cartas de la mesa <b>colapsan</b>: cada una queda definida en una de sus dos opciones, con la misma chance.</p>
      <p>Recién ahí se sabe quién ganó la baza.</p>`,
  },
  {
    title: 'Las cartas están entrelazadas',
    art: `<div class="tut-row">${col(qcard(1, 'espada', 4, 'copa', 66), 'en la mesa')}<div class="tut-link">⊗</div>${col(qcard(1, 'espada', 4, 'copa', 66), 'su gemela')}</div>
          <div class="tut-row">${col(card(1, 'espada', 52), 'sale esta')}${arrow('⇒')}${col(card(4, 'copa', 52), 'la otra es esta')}</div>`,
    body: `
      <p>Cada par de opciones está en <b>dos cartas gemelas</b>. Si una colapsa en el 1 de espadas, la otra queda sí o sí como el 4 de copas.</p>
      <p>La gemela puede estar en tu mano, en la del rival o en el mazo. Por eso <b>cada baza te da información</b>: si colapsa una carta de la mesa, puede definirse una de las tuyas sin que la hayas jugado.</p>`,
  },
  {
    title: 'El envido se canta a ciegas',
    art: `<div class="tut-row">${qcard(7, 'oro', 3, 'espada', 58)}${qcard(6, 'oro', 12, 'basto', 58)}${qcard(5, 'copa', 2, 'oro', 58)}</div>
          <div class="tut-row">${chip('Envido medio 18.0')}${chip('P(≥28) 50%')}${chip('Rango 3–33')}</div>`,
    body: `
      <p>Como nadie conoce su tanto, <b>no se dice en voz alta</b>. Se canta y se responde como siempre, pero se cuenta <b>al final de la mano</b>, con todas las cartas ya colapsadas.</p>
      <p>Debajo de tu mano tenés la ayuda para decidir: tu envido promedio, la chance de tener 28 o más, y el mínimo y el máximo que te pueden salir.</p>`,
  },
  {
    title: 'La flor es una apuesta',
    art: `<div class="tut-row">${qcard(7, 'copa', 3, 'espada', 58)}${qcard(5, 'copa', 12, 'copa', 58)}${qcard(2, 'copa', 6, 'basto', 58)}</div>
          <div class="tut-row">${chip('🌸 Flor (25% de tenerla)', 'flor')}</div>`,
    body: `
      <p>Si juegan con flor, podés cantarla cuando alguna combinación te da <b>tres cartas del mismo palo</b>. El botón te muestra la chance.</p>
      <p>Si al final te sale, cobrás <b>3 puntos</b>. Si la cantaste y no salió, los 3 son <b>para el rival</b>.</p>`,
  },
  {
    title: 'Modo opcional: estados preparados',
    art: `<div class="tut-row">${col(`<div class="qcard tut-card tut-quantum" style="--card-w:92px">${buildEntangled(1, 'espada', 4, 'copa', false, 0.7)}</div>`, 'esta carta')}<div class="tut-link">⊗</div>${col(`<div class="qcard tut-card tut-quantum" style="--card-w:92px">${buildEntangled(1, 'espada', 4, 'copa', false, 0.3)}</div>`, 'su gemela')}</div>`,
    body: `
      <p>Si lo activás en el menú, las dos opciones de cada carta <b>dejan de ser mitad y mitad</b>. Cada par se prepara al azar entre 25% y 75%, de a 5.</p>
      <p>Cada mitad muestra su chance. Las gemelas son <b>complementarias</b>: si una tiene 70% de ser el 1 de espadas, la otra tiene 30%.</p>
      <p>El envido promedio y la chance de flor ya tienen en cuenta esos porcentajes.</p>`,
  },
  {
    title: 'Lo demás es truco de siempre',
    art: `<div class="tut-row wrap">${chip('Truco · Retruco · Vale cuatro', 'gold')}${chip('El envido está primero', 'green')}${chip('Irse al mazo', 'red')}${chip('De a 2, 4 o 6')}</div>`,
    body: `
      <p>La jerarquía de las cartas, las apuestas y los puntos son los del truco argentino.</p>
      <p>El <b>cartel sobre tu mano</b> te dice siempre qué se espera: si te toca jugar, si te cantaron algo o a quién se está esperando.</p>
      <p>De a 6 se juega además el <b>pica-pica</b>: una mano por medio, cada uno juega mano a mano contra el rival que tiene enfrente.</p>`,
  },
];

const TRACKS = {
  knows: { label: 'Ya sé jugar al truco', slides: QUANTUM },
  new:   { label: 'Nunca jugué al truco', slides: [...BASICS, ...QUANTUM] },
};

let track = 'knows';
let index = 0;
let onClose = null;

function render() {
  const slides = TRACKS[track].slides;
  const s = slides[index];
  const el = document.getElementById('help-slide');
  if (!el) return;
  el.innerHTML = `
    <div class="help-step">${index + 1} de ${slides.length}</div>
    <h2 class="help-h">${s.title}</h2>
    <div class="help-art">${s.art}</div>
    <div class="help-body">${s.body}</div>`;
  el.scrollTop = 0;

  document.querySelectorAll('#help-tracks .opt-btn').forEach(b => b.classList.toggle('selected', b.dataset.track === track));
  const dots = document.getElementById('help-dots');
  if (dots) dots.innerHTML = slides.map((_, i) => `<span class="help-dot${i === index ? ' on' : ''}"></span>`).join('');
  const prev = document.getElementById('help-prev');
  const next = document.getElementById('help-next');
  if (prev) prev.disabled = index === 0;
  if (next) next.textContent = index === slides.length - 1 ? '¡A jugar!' : 'Siguiente →';
}

function go(delta) {
  const slides = TRACKS[track].slides;
  const n = index + delta;
  if (n >= slides.length) { closeTutorial(); return; }
  index = Math.max(0, n);
  render();
}

export function openTutorial(which) {
  if (which && TRACKS[which]) track = which;
  index = 0;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-help')?.classList.add('active');
  render();
}

export function closeTutorial() {
  document.getElementById('screen-help')?.classList.remove('active');
  document.getElementById('screen-setup')?.classList.add('active');
  if (onClose) onClose();
}

export function initTutorial() {
  document.querySelectorAll('#help-tracks .opt-btn').forEach(b => {
    b.addEventListener('click', () => { track = b.dataset.track; index = 0; render(); });
  });
  document.getElementById('help-prev')?.addEventListener('click', () => go(-1));
  document.getElementById('help-next')?.addEventListener('click', () => go(1));

  // Flechas del teclado y deslizar con el dedo.
  document.addEventListener('keydown', (ev) => {
    if (!document.getElementById('screen-help')?.classList.contains('active')) return;
    if (ev.key === 'ArrowRight') go(1);
    else if (ev.key === 'ArrowLeft') go(-1);
    else if (ev.key === 'Escape') closeTutorial();
  });
  const slide = document.getElementById('help-slide');
  let x0 = null, y0 = null;
  slide?.addEventListener('touchstart', (ev) => { x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; }, { passive: true });
  slide?.addEventListener('touchend', (ev) => {
    if (x0 === null) return;
    const dx = ev.changedTouches[0].clientX - x0;
    const dy = ev.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });
}
