// @ts-nocheck
// Idioma de la interfaz: español o inglés.
// Los cantos del truco (Truco, Envido, Quiero, Flor…) van siempre en
// español, en los dos idiomas: son parte del juego.
//
// Uso: tr('texto en español', 'English text'). El idioma se elige una vez
// al cargar la página; cambiarlo la recarga.

const KEY = 'qt-lang';

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {}
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'es';
  return String(nav).toLowerCase().startsWith('es') ? 'es' : 'en';
}

// En el servidor (sin ventana) todo se genera en español; el cliente
// traduce lo que muestra.
export const lang = typeof window === 'undefined' ? 'es' : detect();

export function tr(es, en) {
  return lang === 'en' && en !== undefined ? en : es;
}

export function setLang(next) {
  if (next !== 'es' && next !== 'en') return;
  try { localStorage.setItem(KEY, next); } catch {}
  if (next !== lang) window.location.reload();
}

// Nombres que genera el motor ("Jugador 3") en el idioma de la interfaz.
export function trName(name) {
  if (lang !== 'en' || !name) return name;
  return String(name).replace(/^Jugador (\d+)$/, 'Player $1');
}

// ─────────────────────────────────────────────────────────────
// Textos que llegan ya armados en español (el log de la partida, los
// estados de sala y los errores del servidor). Se traducen por patrones
// al mostrarlos, así sirve igual para partidas locales y online.
// ─────────────────────────────────────────────────────────────
const team = (n) => `Team ${n === '0' ? 'A' : 'B'}`;

const EXACT = {
  'La sala no existe.': 'That room does not exist.',
  'La sala ya está llena.': 'That room is full.',
  'La sala ya existe.': 'That room already exists.',
  'Código de sala inválido.': 'Invalid room code.',
  'Acción inválida para este turno.': 'Invalid action for this turn.',
  'Revancha pedida. Esperando a los demás…': 'Rematch requested. Waiting for the others…',
  'Flor contra flor. Se liquida al final de la mano.': 'Flor against flor. Settled at the end of the hand.',
};

const PATTERNS = [
  [/^(.+) acepta\. Envido vale (\d+) pts\.$/, (m) => `${m[1]} accepts. The envido is worth ${m[2]} pts.`],
  [/^(.+) acepta (.+)\. Vale (\d+) pts\.$/, (m) => `${m[1]} accepts ${m[2]}. Worth ${m[3]} pts.`],
  [/^(.+) rechaza\. Eq (\d) cobra (\d+) pts\.$/, (m) => `${m[1]} declines. ${team(m[2])} gets ${m[3]} pts.`],
  [/^(.+) sube a (.+)!$/, (m) => `${m[1]} raises to ${m[2]}!`],
  [/^(.+) sube: (.+)\.$/, (m) => `${m[1]} raises: ${m[2]}.`],
  [/^Ahora hay que responder el (.+)\.$/, (m) => `Now the ${m[1]} has to be answered.`],
  [/^(.+) responde con flor: el envido no corre\.$/, (m) => `${m[1]} answers with flor: the envido is off.`],
  [/^(.+) también canta Flor\.$/, (m) => `${m[1]} also calls Flor.`],
  [/^(.+) no canta flor\. Se liquida al final de la mano\.$/, (m) => `${m[1]} does not call flor. Settled at the end of the hand.`],
  [/^(.+) querida\. Se liquida al final de la mano\.$/, (m) => `${m[1]} accepted. Settled at the end of the hand.`],
  [/^(.+) no quiere la contraflor\. Eq (\d) cobra (\d+) pts\.$/, (m) => `${m[1]} declines the contraflor. ${team(m[2])} gets ${m[3]} pts.`],
  [/^(.+) canta (.+)\.$/, (m) => `${m[1]} calls ${m[2]}.`],
  [/^(.+) juega carta cuántica: (.+)$/, (m) => `${m[1]} plays a quantum card: ${m[2]}`],
  [/^⊗ Colapsa: (.+)$/, (m) => `⊗ Collapses: ${m[1]}`],
  [/^(.+) al mazo\. (.+) cobra (\d+) pts\.$/, (m) => `${m[1]} folds (al mazo). ${m[2]} gets ${m[3]} pts.`],
  [/^Baza (\d+): Equipo (\d) · (.+)$/, (m) => `Trick ${m[1]}: ${team(m[2])} · ${m[3]}`],
  [/^Baza (\d+): PARDA — sale el mano \((.+)\)$/, (m) => `Trick ${m[1]}: TIE (parda), the mano leads (${m[2]})`],
  [/^Truco: Eq (\d) gana (\d+) pts\.$/, (m) => `Truco: ${team(m[1])} wins ${m[2]} pts.`],
  [/^Envido: (.+) gana (\d+) pts\. \[(.+)\]$/, (m) => `Envido: ${m[1]} wins ${m[2]} pts. [${m[3]}]`],
  [/^=== Mano (\d+): (.+) → Total (.+) ===$/, (m) => `=== Hand ${m[1]}: ${m[2]} → Total ${m[3]} ===`],
  [/^Mano de pica-pica: (.+)\.$/, (m) => `Pica-pica hand: ${m[1].replace(/ contra /g, ' vs ')}.`],
  [/^Pica-pica: (.+) contra (.+)\.$/, (m) => `Pica-pica: ${m[1]} vs ${m[2]}.`],
  // Flor al final de la mano
  [/^(.+): (\d+) contra (\d+)\. (.+) cobra (\d+)\.$/, (m) => `${m[1]}: ${m[2]} against ${m[3]}. ${m[4]} gets ${m[5]}.`],
  [/^(.+): (.+) la tenía \((\d+)\) y cobra (\d+)\.$/, (m) => `${m[1]}: ${m[2]} had it (${m[3]}) and gets ${m[4]}.`],
  [/^(.+) cantó flor y no le salió: (.+) cobra 3\.$/, (m) => `${m[1]} called flor and missed: ${m[2]} gets 3.`],
  [/^(.+): a nadie le salió la flor\. No hay puntos\.$/, (m) => `${m[1]}: nobody got the flor. No points.`],
  // Resumen de mano
  [/^Mano (\d+) · (.+)$/, (m) => `Hand ${m[1]} · ${m[2]}`],
  [/^Pica-pica \(mano (\d+)\) · (.+)$/, (m) => `Pica-pica (hand ${m[1]}) · ${m[2]}`],
  // Estados de sala
  [/^Sala (\w+) · esperando rival$/, (m) => `Room ${m[1]} · waiting for opponent`],
  [/^Sala (\w+) · esperando jugadores \((\d+)\/(\d+)\)$/, (m) => `Room ${m[1]} · waiting for players (${m[2]}/${m[3]})`],
  [/^Sala (\w+) · rival desconectado$/, (m) => `Room ${m[1]} · opponent disconnected`],
  [/^Sala (\w+) · un jugador desconectado$/, (m) => `Room ${m[1]} · one player disconnected`],
  [/^Sala (\w+) · (\d+) jugadores desconectados$/, (m) => `Room ${m[1]} · ${m[2]} players disconnected`],
  [/^Sala (\w+) · revancha pedida \((.+)\)$/, (m) => `Room ${m[1]} · rematch requested (${m[2]})`],
  [/^Sala (\w+) · piden revancha \((.+)\)$/, (m) => `Room ${m[1]} · rematch wanted (${m[2]})`],
  [/^Sala (\w+) · (.+)$/, (m) => `Room ${m[1]} · ${m[2]}`],
];

// Motivos cortos que anota la IA en el log ("[IA] Canta envido").
const AI_EXACT = {
  'Quiere': 'Accepts', 'No quiere': 'Declines', 'Decide': 'Decides',
  'Contesta con flor': 'Answers with flor', 'Sube el envido': 'Raises the envido',
  'También canta flor': 'Also calls flor', 'No se suma a la flor': 'Does not join the flor',
  'Sin flor': 'No flor', 'Se la juega': 'Goes for it',
};
function trAi(why) {
  if (AI_EXACT[why]) return AI_EXACT[why];
  let m;
  if ((m = /^Canta (.+)$/.exec(why))) return `Calls ${m[1]}`;
  if ((m = /^Sube a (.+)$/.exec(why))) return `Raises to ${m[1]}`;
  if ((m = /^Se agranda: (.+)$/.exec(why))) return `Steps up: ${m[1]}`;
  return why;
}

export function trText(text) {
  if (lang !== 'en' || typeof text !== 'string' || !text) return text;
  if (text.startsWith('[IA] ')) return `[AI] ${trAi(text.slice(5))}`;
  let out = EXACT[text];
  if (out === undefined) {
    out = text;
    for (const [re, fn] of PATTERNS) {
      const m = re.exec(text);
      if (m) { out = fn(m); break; }
    }
  }
  return out
    .replace(/\bJugador (\d+)\b/g, 'Player $1')
    .replace(/\bEquipo ([AB])\b/g, 'Team $1')
    .replace(/^\[IA\]/, '[AI]');
}
