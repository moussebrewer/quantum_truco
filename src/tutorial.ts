// @ts-nocheck
// Tutorial dentro del juego, con dos recorridos:
//  - "knows": para quien ya juega al truco (solo lo que cambia)
//  - "new":   para quien nunca jugó (lo básico del truco y después lo cuántico)
// Las ilustraciones usan las mismas cartas que la partida.
// Los nombres de los cantos van en español en los dos idiomas.

import { buildCardSVG, buildEntangled } from './cards';
import { tr } from './i18n';

const card = (n, palo, w = 74) =>
  `<div class="qcard tut-card" style="--card-w:${w}px">${buildCardSVG(n, palo)}</div>`;
const qcard = (a, pa, b, pb, w = 74, p) =>
  `<div class="qcard tut-card tut-quantum" style="--card-w:${w}px">${buildEntangled(a, pa, b, pb, false, p)}</div>`;
const arrow = (t = '→') => `<div class="tut-arrow">${t}</div>`;
const note = (t) => `<div class="tut-note">${t}</div>`;
const col = (inner, label) => `<div class="tut-col">${inner}${label ? `<div class="tut-label">${label}</div>` : ''}</div>`;
const chip = (t, cls = '') => `<span class="tut-chip ${cls}">${t}</span>`;
const mini = (n, palo) => card(n, palo, 38);

// ── Lo básico del truco ──────────────────────────────────────
const BASICS = [
  {
    title: tr('De qué se trata', 'What the game is about'),
    art: `<div class="tut-row">${card(1, 'espada', 70)}${card(7, 'oro', 70)}${card(3, 'copa', 70)}</div>`,
    body: tr(`
      <p>El truco se juega mano a mano o en equipos, a <b>15 o 30 puntos</b>.</p>
      <p>En cada <b>mano</b> recibís 3 cartas y se juegan 3 <b>bazas</b>: en cada baza cada jugador tira una carta y gana la más alta.</p>
      <p>Quien gana <b>2 de las 3 bazas</b> gana la mano y suma 1 punto… o más, si se apostó.</p>`, `
      <p>Truco is played one on one or in teams, to <b>15 or 30 points</b>.</p>
      <p>Each <b>hand</b> you get 3 cards and play 3 <b>tricks</b>: in every trick each player plays one card and the highest one wins.</p>
      <p>Whoever wins <b>2 of the 3 tricks</b> wins the hand and scores 1 point… or more, if there was a bet.</p>`),
  },
  {
    title: tr('Qué carta le gana a cuál', 'Which card beats which'),
    art: `
      <div class="tut-ladder">
        <div class="tut-rung"><span class="tut-rung-name">${tr('Las cuatro bravas', 'The top four')}</span>
          <div class="tut-row tight">${mini(1, 'espada')}${arrow('›')}${mini(1, 'basto')}${arrow('›')}${mini(7, 'espada')}${arrow('›')}${mini(7, 'oro')}</div></div>
        <div class="tut-rung"><span class="tut-rung-name">${tr('Después', 'Then')}</span>
          <div class="tut-row tight">${mini(3, 'copa')}${arrow('›')}${mini(2, 'basto')}${arrow('›')}${mini(1, 'copa')}${arrow('›')}${mini(12, 'oro')}${arrow('›')}${mini(11, 'espada')}${arrow('›')}${mini(10, 'basto')}</div></div>
        <div class="tut-rung"><span class="tut-rung-name">${tr('Las más bajas', 'The lowest')}</span>
          <div class="tut-row tight">${mini(7, 'copa')}${arrow('›')}${mini(6, 'oro')}${arrow('›')}${mini(5, 'espada')}${arrow('›')}${mini(4, 'basto')}</div></div>
      </div>`,
    body: tr(`
      <p>El orden no es el de los números. Mandan cuatro cartas: <b>1 de espadas</b>, <b>1 de bastos</b>, <b>7 de espadas</b> y <b>7 de oros</b>.</p>
      <p>Después vienen los <b>3</b>, los <b>2</b>, los otros <b>1</b>, y las figuras: <b>12</b>, <b>11</b>, <b>10</b>. Al final los otros 7, los 6, los 5 y los 4.</p>
      <p>Fuera de las cuatro bravas el palo no importa: dos cartas del mismo número empatan. Eso es una <b>parda</b>.</p>`, `
      <p>The ranking does not follow the numbers. Four cards rule: the <b>1 of espadas</b> (swords), the <b>1 of bastos</b> (clubs), the <b>7 of espadas</b> and the <b>7 of oros</b> (coins).</p>
      <p>Then come the <b>3s</b>, the <b>2s</b>, the other <b>1s</b>, and the face cards: <b>12</b> (king), <b>11</b> (horse), <b>10</b> (jack). Last are the other 7s, the 6s, the 5s and the 4s.</p>
      <p>Outside the top four the suit does not matter: two cards with the same number tie. That is a <b>parda</b>.</p>`),
  },
  {
    title: tr('El truco: apostar la mano', 'Truco: betting on the hand'),
    art: `<div class="tut-row">${chip('Truco · 2', 'gold')}${arrow()}${chip('Retruco · 3', 'gold')}${arrow()}${chip('Vale cuatro · 4', 'gold')}</div>
          <div class="tut-row">${chip('Quiero', 'green')}${chip('No quiero', 'red')}${chip(tr('Subir', 'Raise'), 'gold')}</div>`,
    body: tr(`
      <p>En tu turno podés cantar <b>Truco</b>: la mano pasa a valer 2 puntos en vez de 1.</p>
      <p>El rival elige: <b>Quiero</b> (se juega por 2), <b>No quiero</b> (se rinde y vos cobrás 1) o sube a <b>Retruco</b> (3). Sobre el retruco se puede cantar <b>Vale cuatro</b> (4).</p>
      <p>Solo puede subir la apuesta el que aceptó la anterior.</p>`, `
      <p>On your turn you can call <b>Truco</b>: the hand is now worth 2 points instead of 1.</p>
      <p>Your opponent chooses: <b>Quiero</b> ("I accept": play on for 2), <b>No quiero</b> ("I decline": they fold and you get 1) or raise to <b>Retruco</b> (3). Over a retruco you can call <b>Vale cuatro</b> (4).</p>
      <p>Only the player who accepted the last bet may raise it.</p>`),
  },
  {
    title: tr('El envido: el tanto', 'Envido: the points in your hand'),
    art: `<div class="tut-row">${card(7, 'oro', 62)}${card(6, 'oro', 62)}${card(12, 'espada', 62)}${arrow('=')}<div class="tut-big">33</div></div>
          ${note(tr('20 por tener dos del mismo palo + 7 + 6', '20 for two cards of the same suit + 7 + 6'))}`,
    body: tr(`
      <p>Es una apuesta aparte, que se canta <b>en la primera baza</b>, antes de tirar tu carta. Gana quien tenga más <b>tanto</b>.</p>
      <p>Dos cartas del mismo palo valen <b>20 más la suma de las dos</b>. Las figuras (10, 11 y 12) suman cero. Sin dos del mismo palo, tu tanto es tu carta más alta.</p>
      <p><b>Envido</b> vale 2, <b>Real envido</b> 3 y <b>Falta envido</b> lo que le falta al que va ganando. Si no te lo quieren, cobrás 1.</p>`, `
      <p>This is a separate bet, called <b>during the first trick</b>, before you play your card. Whoever has the higher <b>tanto</b> (envido score) wins it.</p>
      <p>Two cards of the same suit are worth <b>20 plus the sum of both</b>. Face cards (10, 11 and 12) count as zero. With no two cards of the same suit, your tanto is your highest card.</p>
      <p><b>Envido</b> is worth 2, <b>Real envido</b> 3 and <b>Falta envido</b> whatever the leader still needs to win. If they decline, you get 1.</p>`),
  },
  {
    title: tr('Mentir es parte del juego', 'Bluffing is part of the game'),
    art: `<div class="tut-row">${chip('¡Truco!', 'gold big')}${arrow('…')}${chip('No quiero', 'red big')}</div>`,
    body: tr(`
      <p>Nadie ve tus cartas. Podés cantar truco o envido con una mano mala para que el otro se achique, o hacerte el débil con una buena.</p>
      <p>Si no querés seguir, podés <b>irte al mazo</b>: te rendís y el rival cobra lo que estaba en juego.</p>
      <p>Hasta acá, truco de toda la vida. Ahora viene lo distinto.</p>`, `
      <p>Nobody sees your cards. You can call truco or envido with a bad hand to make the other player back down, or act weak with a good one.</p>
      <p>If you do not want to go on you can <b>go "al mazo"</b>: you fold and your opponent gets what was at stake.</p>
      <p>So far, this is the classic game. Now for what is different.</p>`),
  },
];

// ── Lo cuántico ──────────────────────────────────────────────
const QUANTUM = [
  {
    title: tr('Cada carta son dos a la vez', 'Every card is two at once'),
    art: `<div class="tut-row">${col(qcard(1, 'espada', 4, 'copa', 104))}</div>
          ${note(tr('Puede ser el 1 de espadas… o el 4 de copas', 'It may be the 1 of espadas… or the 4 of copas'))}`,
    body: tr(`
      <p>Cada carta de tu mano está partida en diagonal y muestra <b>sus dos posibilidades</b>. Va a terminar siendo una de las dos, y no sabés cuál.</p>
      <p>Tu rival tampoco sabe qué tiene. Todos apuestan sobre lo que <b>podría</b> salir.</p>`, `
      <p>Every card in your hand is split diagonally and shows <b>its two possibilities</b>. It will end up being one of them, and you do not know which.</p>
      <p>Your opponent does not know what they hold either. Everyone bets on what <b>might</b> come out.</p>`),
  },
  {
    title: tr('Colapsa cuando termina la baza', 'It collapses when the trick ends'),
    art: `<div class="tut-row">${col(qcard(1, 'espada', 4, 'copa', 78), tr('la jugás así', 'you play it like this'))}${arrow()}
          <div class="tut-col"><div class="tut-row tight">${card(1, 'espada', 60)}<span class="tut-or">${tr('o', 'or')}</span>${card(4, 'copa', 60)}</div><div class="tut-label">${tr('mitad y mitad', 'fifty-fifty')}</div></div></div>`,
    body: tr(`
      <p>Tirás la carta sin saber cuál es. Cuando todos jugaron, las cartas de la mesa <b>colapsan</b>: cada una queda definida en una de sus dos opciones, con la misma chance.</p>
      <p>Recién ahí se sabe quién ganó la baza.</p>`, `
      <p>You play the card without knowing which one it is. Once everyone has played, the cards on the table <b>collapse</b>: each one settles into one of its two options, with equal chance.</p>
      <p>Only then do you find out who won the trick.</p>`),
  },
  {
    title: tr('Las cartas están entrelazadas', 'The cards are entangled'),
    art: `<div class="tut-row">${col(qcard(1, 'espada', 4, 'copa', 66), tr('en la mesa', 'on the table'))}<div class="tut-link">⊗</div>${col(qcard(1, 'espada', 4, 'copa', 66), tr('su gemela', 'its twin'))}</div>
          <div class="tut-row">${col(card(1, 'espada', 52), tr('sale esta', 'this one comes out'))}${arrow('⇒')}${col(card(4, 'copa', 52), tr('la otra es esta', 'the other is this'))}</div>`,
    body: tr(`
      <p>Cada par de opciones está en <b>dos cartas gemelas</b>. Si una colapsa en el 1 de espadas, la otra queda sí o sí como el 4 de copas.</p>
      <p>La gemela puede estar en tu mano, en la del rival o en el mazo. Por eso <b>cada baza te da información</b>: si colapsa una carta de la mesa, puede definirse una de las tuyas sin que la hayas jugado.</p>`, `
      <p>Each pair of options lives in <b>two twin cards</b>. If one collapses into the 1 of espadas, the other is bound to be the 4 of copas.</p>
      <p>The twin may be in your hand, in your opponent's or in the deck. That is why <b>every trick gives you information</b>: when a card on the table collapses, one of yours may be settled without you having played it.</p>`),
  },
  {
    title: tr('El envido se canta a ciegas', 'Envido is called blind'),
    art: `<div class="tut-row">${qcard(7, 'oro', 3, 'espada', 58)}${qcard(6, 'oro', 12, 'basto', 58)}${qcard(5, 'copa', 2, 'oro', 58)}</div>
          <div class="tut-row">${chip(tr('Envido medio 18.0', 'Avg. envido 18.0'))}${chip('P(≥28) 50%')}${chip(tr('Rango 3–33', 'Range 3–33'))}</div>`,
    body: tr(`
      <p>Como nadie conoce su tanto, <b>no se dice en voz alta</b>. Se canta y se responde como siempre, pero se cuenta <b>al final de la mano</b>, con todas las cartas ya colapsadas.</p>
      <p>Debajo de tu mano tenés la ayuda para decidir: tu envido promedio, la chance de tener 28 o más, y el mínimo y el máximo que te pueden salir.</p>`, `
      <p>Since nobody knows their tanto, <b>it is not said out loud</b>. Envido is called and answered as usual, but it is scored <b>at the end of the hand</b>, once every card has collapsed.</p>
      <p>Below your hand you get help to decide: your average envido, the chance of having 28 or more, and the lowest and highest you could end up with.</p>`),
  },
  {
    title: tr('La flor es una apuesta', 'Flor is a gamble'),
    art: `<div class="tut-row">${qcard(7, 'copa', 3, 'espada', 58)}${qcard(5, 'copa', 12, 'copa', 58)}${qcard(2, 'copa', 6, 'basto', 58)}</div>
          <div class="tut-row">${chip(tr('🌸 Flor (25% de tenerla)', '🌸 Flor (25% chance)'), 'flor')}</div>`,
    body: tr(`
      <p>Si juegan con flor, podés cantarla cuando alguna combinación te da <b>tres cartas del mismo palo</b>. El botón te muestra la chance.</p>
      <p>Si al final te sale, cobrás <b>3 puntos</b>. Si la cantaste y no salió, los 3 son <b>para el rival</b>.</p>`, `
      <p>If you play with flor, you can call it whenever some combination gives you <b>three cards of the same suit</b>. The button shows your chance.</p>
      <p>If you end up with it, you score <b>3 points</b>. If you called it and missed, the 3 go <b>to your opponent</b>.</p>`),
  },
  {
    title: tr('Modo opcional: estados preparados', 'Optional mode: prepared states'),
    art: `<div class="tut-row">${col(qcard(1, 'espada', 4, 'copa', 92, 0.7), tr('esta carta', 'this card'))}<div class="tut-link">⊗</div>${col(qcard(1, 'espada', 4, 'copa', 92, 0.3), tr('su gemela', 'its twin'))}</div>`,
    body: tr(`
      <p>Si lo activás en el menú, las dos opciones de cada carta <b>dejan de ser mitad y mitad</b>. Cada par se prepara al azar entre 25% y 75%, de a 5.</p>
      <p>Cada mitad muestra su chance. Las gemelas son <b>complementarias</b>: si una tiene 70% de ser el 1 de espadas, la otra tiene 30%.</p>
      <p>El envido promedio y la chance de flor ya tienen en cuenta esos porcentajes.</p>`, `
      <p>If you turn it on in the menu, the two options of each card <b>stop being fifty-fifty</b>. Each pair is prepared at random between 25% and 75%, in steps of 5.</p>
      <p>Each half shows its chance. Twins are <b>complementary</b>: if one has a 70% chance of being the 1 of espadas, the other has 30%.</p>
      <p>The average envido and the flor chance already take those percentages into account.</p>`),
  },
  {
    title: tr('Lo demás es truco de siempre', 'Everything else is classic truco'),
    art: `<div class="tut-row wrap">${chip('Truco · Retruco · Vale cuatro', 'gold')}${chip('El envido está primero', 'green')}${chip(tr('Irse al mazo', 'Al mazo (fold)'), 'red')}${chip(tr('De a 2, 4 o 6', '2, 4 or 6 players'))}</div>`,
    body: tr(`
      <p>La jerarquía de las cartas, las apuestas y los puntos son los del truco argentino.</p>
      <p>El <b>cartel sobre tu mano</b> te dice siempre qué se espera: si te toca jugar, si te cantaron algo o a quién se está esperando.</p>
      <p>De a 6 se juega además el <b>pica-pica</b>: una mano por medio, cada uno juega mano a mano contra el rival que tiene enfrente.</p>`, `
      <p>The card ranking, the bets and the points are those of Argentine truco. The calls are always in Spanish, as they are at the table.</p>
      <p>The <b>banner above your hand</b> always tells you what is expected: whether it is your turn, whether someone called something, or who everyone is waiting for.</p>
      <p>With 6 players there is also <b>pica-pica</b>: every other hand, each player plays one on one against the opponent sitting across.</p>`),
  },
];

const TRACKS = {
  knows: { slides: QUANTUM },
  new:   { slides: [...BASICS, ...QUANTUM] },
};

let track = 'knows';
let index = 0;

function render() {
  const slides = TRACKS[track].slides;
  const s = slides[index];
  const el = document.getElementById('help-slide');
  if (!el) return;
  el.innerHTML = `
    <div class="help-step">${tr(`${index + 1} de ${slides.length}`, `${index + 1} of ${slides.length}`)}</div>
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
  if (next) next.textContent = index === slides.length - 1 ? tr('¡A jugar!', "Let's play!") : tr('Siguiente →', 'Next →');
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
