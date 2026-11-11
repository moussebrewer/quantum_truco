// @ts-nocheck
// Dibujo de las cartas (SVG). Dos formas:
//  - buildCardSVG:   carta definida (un número y un palo)
//  - buildEntangled: carta cuántica, partida en diagonal en sus dos opciones
// Prioridad: que número y palo se lean de un vistazo, también en tamaño chico.

const W = 130, H = 200, R = 9;

const PALOS = {
  oro:    { label: 'Oro',    ink: '#7a5200', accent: '#e8b830', dark: '#8a5c08', bg1: '#fffaf0', bg2: '#f7e9c4', half: '#f6e3ae' },
  copa:   { label: 'Copa',   ink: '#8a0f24', accent: '#e23a55', dark: '#880020', bg1: '#fff6f7', bg2: '#f8d9de', half: '#f6ccd3' },
  espada: { label: 'Espada', ink: '#0b4370', accent: '#2f8fd2', dark: '#063a6a', bg1: '#f5f9fd', bg2: '#d5e5f4', half: '#c6dcf1' },
  basto:  { label: 'Basto',  ink: '#1f5a12', accent: '#4ea82c', dark: '#185010', bg1: '#f6fbf2', bg2: '#d8ecca', half: '#cbe6ba' },
};

const INDEX_FONT = "'Space Mono', 'Consolas', monospace";
const SKIN = '#f3d6b8';
const GOLD = '#e0b23a';
const GOLD_DARK = '#8a6410';

let uidCounter = 0;
function nextUid() {
  uidCounter = (uidCounter + 1) % 1e9;
  return `qc${uidCounter}`;
}

// ─────────────────────────────────────────────────────────────
// Palos. Cada función dibuja el símbolo centrado en (cx, cy) con "radio" r.
// ─────────────────────────────────────────────────────────────
function symOro(cx, cy, r, p) {
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.accent}" stroke="${p.dark}" stroke-width="${r * 0.12}"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="none" stroke="${p.dark}" stroke-width="${r * 0.08}" opacity="0.65"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.2}" fill="${p.dark}" opacity="0.6"/>
    <path d="M${cx - r * 0.55},${cy - r * 0.55} A${r * 0.78},${r * 0.78} 0 0 1 ${cx + r * 0.2},${cy - r * 0.75}"
      fill="none" stroke="rgba(255,255,255,.55)" stroke-width="${r * 0.1}" stroke-linecap="round"/>
  </g>`;
}
function symCopa(cx, cy, r, p) {
  const h = r * 1.6;
  return `<g>
    <path d="M${cx - r * 0.85},${cy - h * 0.45} Q${cx - r},${cy + h * 0.1} ${cx - r * 0.35},${cy + h * 0.35} L${cx - r * 0.2},${cy + h * 0.45} L${cx + r * 0.2},${cy + h * 0.45} L${cx + r * 0.35},${cy + h * 0.35} Q${cx + r},${cy + h * 0.1} ${cx + r * 0.85},${cy - h * 0.45} Z"
      fill="${p.accent}" stroke="${p.dark}" stroke-width="${Math.max(0.7, r * 0.09)}" stroke-linejoin="round"/>
    <ellipse cx="${cx}" cy="${cy - h * 0.45}" rx="${r * 0.85}" ry="${r * 0.18}" fill="${p.dark}" opacity="0.55"/>
    <line x1="${cx}" y1="${cy + h * 0.45}" x2="${cx}" y2="${cy + h * 0.6}" stroke="${p.dark}" stroke-width="${r * 0.22}"/>
    <line x1="${cx - r * 0.55}" y1="${cy + h * 0.6}" x2="${cx + r * 0.55}" y2="${cy + h * 0.6}" stroke="${p.dark}" stroke-width="${r * 0.2}" stroke-linecap="round"/>
    <path d="M${cx - r * 0.55},${cy - h * 0.25} Q${cx - r * 0.6},${cy + h * 0.05} ${cx - r * 0.3},${cy + h * 0.22}"
      fill="none" stroke="rgba(255,255,255,.5)" stroke-width="${r * 0.1}" stroke-linecap="round"/>
  </g>`;
}
function symEspada(cx, cy, r, p) {
  const h = r * 3.2;
  return `<g>
    <polygon points="${cx},${cy - h * 0.72} ${cx - r * 0.2},${cy - h * 0.56} ${cx - r * 0.36},${cy + h * 0.18} ${cx + r * 0.36},${cy + h * 0.18} ${cx + r * 0.2},${cy - h * 0.56}"
      fill="${p.accent}" stroke="${p.dark}" stroke-width="${Math.max(0.6, r * 0.07)}" stroke-linejoin="round"/>
    <line x1="${cx}" y1="${cy - h * 0.66}" x2="${cx}" y2="${cy + h * 0.12}" stroke="rgba(255,255,255,.5)" stroke-width="${r * 0.07}" stroke-linecap="round"/>
    <path d="M${cx - r * 1.25},${cy + h * 0.2} L${cx + r * 1.25},${cy + h * 0.2} L${cx + r * 1.1},${cy + h * 0.27} L${cx - r * 1.1},${cy + h * 0.27} Z"
      fill="${GOLD}" stroke="${p.dark}" stroke-width="${Math.max(0.6, r * 0.07)}" stroke-linejoin="round"/>
    <rect x="${cx - r * 0.2}" y="${cy + h * 0.27}" width="${r * 0.4}" height="${h * 0.27}" rx="${r * 0.05}" fill="${p.dark}"/>
    <ellipse cx="${cx}" cy="${cy + h * 0.57}" rx="${r * 0.36}" ry="${r * 0.2}" fill="${GOLD}" stroke="${p.dark}" stroke-width="${Math.max(0.6, r * 0.07)}"/>
  </g>`;
}
function symBasto(cx, cy, r, p) {
  const h = r * 2.9;
  return `<g>
    <path d="M${cx},${cy - h * 0.72}
      Q${cx + r * 0.55},${cy - h * 0.65} ${cx + r * 0.62},${cy - h * 0.45}
      Q${cx + r * 0.7},${cy - h * 0.22} ${cx + r * 0.52},${cy - h * 0.05}
      Q${cx + r * 0.38},${cy + h * 0.1} ${cx + r * 0.28},${cy + h * 0.28}
      Q${cx + r * 0.22},${cy + h * 0.42} ${cx + r * 0.18},${cy + h * 0.6}
      L${cx - r * 0.18},${cy + h * 0.6}
      Q${cx - r * 0.22},${cy + h * 0.42} ${cx - r * 0.28},${cy + h * 0.28}
      Q${cx - r * 0.38},${cy + h * 0.1} ${cx - r * 0.52},${cy - h * 0.05}
      Q${cx - r * 0.7},${cy - h * 0.22} ${cx - r * 0.62},${cy - h * 0.45}
      Q${cx - r * 0.55},${cy - h * 0.65} ${cx},${cy - h * 0.72} Z"
      fill="${p.accent}" stroke="${p.dark}" stroke-width="${Math.max(0.7, r * 0.09)}" stroke-linejoin="round"/>
    <ellipse cx="${cx - r * 0.3}" cy="${cy - h * 0.3}" rx="${r * 0.16}" ry="${r * 0.11}" fill="${p.dark}" opacity="0.45"/>
    <ellipse cx="${cx + r * 0.28}" cy="${cy - h * 0.08}" rx="${r * 0.14}" ry="${r * 0.09}" fill="${p.dark}" opacity="0.4"/>
    <path d="M${cx - r * 0.05},${cy - h * 0.55} Q${cx - r * 0.12},${cy} ${cx - r * 0.04},${cy + h * 0.45}"
      fill="none" stroke="rgba(255,255,255,.4)" stroke-width="${r * 0.08}" stroke-linecap="round"/>
    <line x1="${cx - r * 0.2}" y1="${cy + h * 0.4}" x2="${cx + r * 0.2}" y2="${cy + h * 0.4}" stroke="${p.dark}" stroke-width="${r * 0.12}" stroke-linecap="round" opacity="0.7"/>
    <line x1="${cx - r * 0.19}" y1="${cy + h * 0.5}" x2="${cx + r * 0.19}" y2="${cy + h * 0.5}" stroke="${p.dark}" stroke-width="${r * 0.12}" stroke-linecap="round" opacity="0.7"/>
  </g>`;
}
const SYM = { oro: symOro, copa: symCopa, espada: symEspada, basto: symBasto };

// Proporciones de cada símbolo respecto de su "radio": alto total y
// corrimiento del centro visual, para poder pedirlo por tamaño.
const SUIT_BOX = {
  oro:    { hPerR: 2.0,  yShift: 0 },
  copa:   { hPerR: 1.76, yShift: -0.12 },
  espada: { hPerR: 4.3,  yShift: 0.19 },
  basto:  { hPerR: 3.83, yShift: 0.17 },
};

// Espadas y bastos son altos y finos; oros y copas, anchos. Para que los
// cuatro palos pesen parecido a la vista, cada uno lleva su propia escala.
const SUIT_SCALE = { oro: 0.92, copa: 0.82, espada: 1.45, basto: 1.4 };

// Símbolo del palo centrado en (cx, cy). `size` es el tamaño nominal: el
// alto de un símbolo "cuadrado"; cada palo lo ajusta con SUIT_SCALE.
function suitIcon(palo, cx, cy, size) {
  const box = SUIT_BOX[palo];
  const r = (size * SUIT_SCALE[palo]) / box.hPerR;
  return SYM[palo](cx, cy + box.yShift * r, r, PALOS[palo]);
}

// ─────────────────────────────────────────────────────────────
// Figuras (10 sota, 11 caballo, 12 rey). Ilustraciones vectoriales propias,
// dibujadas en una caja de 100×120 y ubicadas con escala.
// ─────────────────────────────────────────────────────────────
function figSota(p) {
  return `
    <path d="M22,120 Q23,86 38,76 L62,76 Q77,86 78,120 Z" fill="${p.accent}" stroke="${p.dark}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M40,77 L50,92 L60,77 Z" fill="#fbf4e4" stroke="${p.dark}" stroke-width="1.6" stroke-linejoin="round"/>
    <rect x="27" y="100" width="46" height="6" rx="2" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width="1"/>
    <path d="M33,58 Q30,74 40,78 L60,78 Q70,74 67,58 Z" fill="#6b4423"/>
    <circle cx="50" cy="56" r="15" fill="${SKIN}" stroke="${p.dark}" stroke-width="2"/>
    <circle cx="44.5" cy="56" r="1.7" fill="#2a1a10"/><circle cx="55.5" cy="56" r="1.7" fill="#2a1a10"/>
    <path d="M45,63 Q50,66.5 55,63" fill="none" stroke="#7a3b2a" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M30,48 Q32,28 54,28 Q72,29 71,46 Q52,38 30,48 Z" fill="${p.dark}" stroke="${p.dark}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M66,36 Q80,26 84,8 Q72,16 64,30 Z" fill="${p.accent}" stroke="${p.dark}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="64" cy="35" r="3" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width="1"/>`;
}
function figCaballo(p) {
  return `
    <path d="M30,118 L76,118 Q80,98 71,82 Q85,62 77,40 Q70,22 52,17 L49,5 L41,17 Q27,24 21,42 Q14,58 18,68 Q23,75 31,69 Q37,61 46,60 Q41,76 35,90 Q30,102 30,118 Z"
      fill="${p.accent}" stroke="${p.dark}" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M52,17 Q70,24 76,42 Q82,62 71,82" fill="none" stroke="${p.dark}" stroke-width="7" stroke-linecap="round" opacity="0.85"/>
    <path d="M58,24 L66,30 M64,34 L73,40 M68,46 L77,52 M69,58 L78,64 M68,70 L76,76" stroke="${p.accent}" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
    <circle cx="38" cy="38" r="3.4" fill="#fff" stroke="${p.dark}" stroke-width="1.4"/>
    <circle cx="37.4" cy="38.4" r="1.6" fill="#1a1208"/>
    <ellipse cx="22" cy="62" rx="1.8" ry="2.6" fill="${p.dark}"/>
    <path d="M20,50 Q34,43 47,52" fill="none" stroke="${GOLD}" stroke-width="3" stroke-linecap="round"/>
    <path d="M40,22 Q44,46 47,52" fill="none" stroke="${GOLD}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="47" cy="52" r="3" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width="1"/>`;
}
function figRey(p) {
  return `
    <path d="M16,120 Q17,84 36,74 L64,74 Q83,84 84,120 Z" fill="${p.accent}" stroke="${p.dark}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M32,76 Q50,98 68,76 L64,70 Q50,84 36,70 Z" fill="#fbf4e4" stroke="${p.dark}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="42" cy="80" r="1.3" fill="#1a1208"/><circle cx="50" cy="86" r="1.3" fill="#1a1208"/><circle cx="58" cy="80" r="1.3" fill="#1a1208"/>
    <circle cx="50" cy="52" r="15.5" fill="${SKIN}" stroke="${p.dark}" stroke-width="2"/>
    <path d="M35,53 Q36,76 50,80 Q64,76 65,53 Q58,62 50,62 Q42,62 35,53 Z" fill="#efe8da" stroke="${p.dark}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="44.5" cy="50" r="1.7" fill="#2a1a10"/><circle cx="55.5" cy="50" r="1.7" fill="#2a1a10"/>
    <path d="M31,40 L27,16 L39,28 L50,10 L61,28 L73,16 L69,40 Z" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="31" y="36" width="38" height="6" rx="1.5" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width="1.4"/>
    <circle cx="50" cy="10" r="3" fill="${p.accent}" stroke="${GOLD_DARK}" stroke-width="1"/>
    <circle cx="27" cy="16" r="2.4" fill="${p.accent}" stroke="${GOLD_DARK}" stroke-width="1"/>
    <circle cx="73" cy="16" r="2.4" fill="${p.accent}" stroke="${GOLD_DARK}" stroke-width="1"/>
    <circle cx="50" cy="39" r="2" fill="${p.accent}"/>`;
}
const FIGURES = { 10: figSota, 11: figCaballo, 12: figRey };
const FIGURE_NAMES = { 10: 'SOTA', 11: 'CABALLO', 12: 'REY' };

// Figura centrada en (cx, cy) con alto `size` (la caja original es 100×120).
function figure(num, palo, cx, cy, size) {
  const s = size / 120;
  return `<g transform="translate(${cx - 50 * s},${cy - 60 * s}) scale(${s})">${FIGURES[num](PALOS[palo])}</g>`;
}

// ─────────────────────────────────────────────────────────────
// Carta definida
// ─────────────────────────────────────────────────────────────
function pipLayout(num) {
  const CX = W / 2, top = 46, bottom = H - 46;
  const row = f => top + f * (bottom - top);
  const c1 = CX - 21, c2 = CX, c3 = CX + 21;
  const layouts = {
    2: [[c2, row(0.12), 34], [c2, row(0.88), 34]],
    3: [[c2, row(0.02), 30], [c2, row(0.5), 30], [c2, row(0.98), 30]],
    4: [[c1, row(0.14), 30], [c3, row(0.14), 30], [c1, row(0.86), 30], [c3, row(0.86), 30]],
    5: [[c1, row(0.1), 28], [c3, row(0.1), 28], [c2, row(0.5), 28], [c1, row(0.9), 28], [c3, row(0.9), 28]],
    6: [[c1, row(0.04), 27], [c3, row(0.04), 27], [c1, row(0.5), 27], [c3, row(0.5), 27], [c1, row(0.96), 27], [c3, row(0.96), 27]],
    7: [[c1, row(0.0), 25], [c3, row(0.0), 25], [c2, row(0.25), 25], [c1, row(0.5), 25], [c3, row(0.5), 25], [c1, row(1.0), 25], [c3, row(1.0), 25]],
  };
  return layouts[num] || [];
}

// Índice de esquina: número grande y, debajo, el palo.
function cornerIndex(num, palo) {
  const p = PALOS[palo];
  const idx = `
    <text x="${num >= 10 ? 5 : 8}" y="27" font-family="${INDEX_FONT}" font-size="${num >= 10 ? 21 : 24}" font-weight="700"
      letter-spacing="${num >= 10 ? -2 : 0}" fill="${p.ink}">${num}</text>
    ${suitIcon(palo, 16, 41, 17)}`;
  return `${idx}<g transform="rotate(180,${W / 2},${H / 2})">${idx}</g>`;
}

function cardFace(num, palo, uid) {
  const p = PALOS[palo];
  let center = '';
  if (num >= 10) {
    center = `
      ${figure(num, palo, W / 2, 88, 92)}
      ${suitIcon(palo, W / 2, 150, 26)}
      <text x="${W / 2}" y="178" text-anchor="middle" font-family="Cinzel,serif" font-size="8.5" font-weight="700"
        letter-spacing="2.2" fill="${p.ink}" opacity="0.75">${FIGURE_NAMES[num]}</text>`;
  } else if (num === 1) {
    center = `
      <circle cx="${W / 2}" cy="${H / 2}" r="43" fill="none" stroke="${p.accent}" stroke-width="1.2" opacity="0.5"/>
      <circle cx="${W / 2}" cy="${H / 2}" r="48" fill="none" stroke="${p.accent}" stroke-width="0.6" opacity="0.4" stroke-dasharray="2 4"/>
      ${suitIcon(palo, W / 2, H / 2, 74)}`;
  } else {
    center = pipLayout(num).map(([cx, cy, size]) => suitIcon(palo, cx, cy, size)).join('');
  }

  return `
  <defs>
    <linearGradient id="bg_${uid}" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="${R}" fill="url(#bg_${uid})"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${R - 1}" fill="none" stroke="${p.dark}" stroke-width="1.6" opacity="0.7"/>
  <rect x="5.5" y="5.5" width="${W - 11}" height="${H - 11}" rx="${R - 4}" fill="none" stroke="${p.accent}" stroke-width="0.8" opacity="0.55"/>
  ${center}
  ${cornerIndex(num, palo)}`;
}

export function buildCardSVG(num, palo, _id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${num} de ${PALOS[palo].label}">${cardFace(num, palo, nextUid())}</svg>`;
}

// ─────────────────────────────────────────────────────────────
// Carta cuántica: dos opciones, partida en diagonal.
// Cada mitad muestra solo lo necesario para leerla: el número bien grande
// en su esquina, el palo grande al lado y, si es figura, la figura.
// Las dos mitades se leen derechas (ninguna va invertida).
// ─────────────────────────────────────────────────────────────
function halfContent(num, palo, side) {
  const p = PALOS[palo];
  const isFig = num >= 10;
  const numSize = 38;
  if (side === 'A') {
    // Triángulo superior izquierdo
    return `
      <text x="${isFig ? 6 : 10}" y="41" font-family="${INDEX_FONT}" font-size="${numSize}" font-weight="700"
        letter-spacing="${isFig ? -4 : 0}" fill="${p.ink}">${num}</text>
      ${isFig ? figure(num, palo, 84, 33, 56) : ''}
      ${suitIcon(palo, isFig ? 26 : 30, isFig ? 82 : 86, isFig ? 42 : 50)}`;
  }
  // Triángulo inferior derecho
  return `
    <text x="${W - (isFig ? 6 : 10)}" y="${H - 13}" text-anchor="end" font-family="${INDEX_FONT}" font-size="${numSize}" font-weight="700"
      letter-spacing="${isFig ? -4 : 0}" fill="${p.ink}">${num}</text>
    ${isFig ? figure(num, palo, 49, H - 33, 56) : ''}
    ${suitIcon(palo, isFig ? W - 26 : W - 30, isFig ? H - 84 : H - 88, isFig ? 42 : 50)}`;
}

export function buildEntangled(numA, paloA, numB, paloB, flip) {
  // flip intercambia qué opción va arriba a la izquierda.
  const top = flip ? { num: numB, palo: paloB } : { num: numA, palo: paloA };
  const bot = flip ? { num: numA, palo: paloA } : { num: numB, palo: paloB };
  const pT = PALOS[top.palo], pB = PALOS[bot.palo];
  const uid = nextUid();

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
    aria-label="${top.num} de ${pT.label} o ${bot.num} de ${pB.label}">
  <defs>
    <clipPath id="card_${uid}"><rect width="${W}" height="${H}" rx="${R}"/></clipPath>
    <clipPath id="a_${uid}"><path d="M0,0 L${W},0 L0,${H} Z"/></clipPath>
    <clipPath id="b_${uid}"><path d="M${W},0 L${W},${H} L0,${H} Z"/></clipPath>
    <linearGradient id="ga_${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${pT.bg1}"/><stop offset="0.5" stop-color="${pT.half}"/>
    </linearGradient>
    <linearGradient id="gb_${uid}" x1="1" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="${pB.bg1}"/><stop offset="0.5" stop-color="${pB.half}"/>
    </linearGradient>
    <linearGradient id="seam_${uid}" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pT.accent}"/><stop offset="1" stop-color="${pB.accent}"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#card_${uid})">
    <g clip-path="url(#a_${uid})">
      <rect width="${W}" height="${H}" fill="url(#ga_${uid})"/>
      ${halfContent(top.num, top.palo, 'A')}
    </g>
    <g clip-path="url(#b_${uid})">
      <rect width="${W}" height="${H}" fill="url(#gb_${uid})"/>
      ${halfContent(bot.num, bot.palo, 'B')}
    </g>
    <!-- Costura cuántica -->
    <line x1="${W}" y1="0" x2="0" y2="${H}" stroke="#0a0f1e" stroke-width="5"/>
    <line x1="${W}" y1="0" x2="0" y2="${H}" stroke="url(#seam_${uid})" stroke-width="2"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="9.5" fill="#0a0f1e" stroke="url(#seam_${uid})" stroke-width="1.6"/>
    <path d="M${W / 2 - 4.2},${H / 2 - 4.2} L${W / 2 + 4.2},${H / 2 + 4.2} M${W / 2 + 4.2},${H / 2 - 4.2} L${W / 2 - 4.2},${H / 2 + 4.2}"
      stroke="#7fd8ff" stroke-width="1.5" stroke-linecap="round"/>
  </g>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${R - 1}" fill="none" stroke="#0a0f1e" stroke-width="1.8" opacity="0.75"/>
  </svg>`;
}
