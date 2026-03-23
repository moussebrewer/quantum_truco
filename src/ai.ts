// @ts-nocheck
// AI engine — calibrated v2
// Pibe / Citadino / Gaucho Digital / El Duende
// Power dist: p25=6.5, p50=7.0, p75=9.0, p90=10.0
// Envido mu:  p25=14.5, p50=16.5, p75=19.8, p90=22.9

import {
  G,
  teamOf,
  TRUCO_LEVELS,
  envidoCanRaise,
  canTeamRaiseNow,
  raiseTruco,
  respondTruco,
  respondEnvido,
  respondFlor,
  singTruco,
  singFlor,
  initiateEnvido,
  onCardClick,
  uiLog,
  trucoPower,
  enumerateWorlds,
  envidoScore,
} from './game';

// ── Scheduling ───────────────────────────────────────────────────

let _aiTurnToken = 0;
let _aiPending   = false;

export function aiNewToken() { return ++_aiTurnToken; }
export function aiValidToken(t) { return G && t === _aiTurnToken; }

export function aiSchedule(fn, delay) {
  if (_aiPending) return;
  _aiPending = true;
  const token = aiNewToken();
  if (G) G.aiThinking = true;
  setTimeout(() => {
    _aiPending = false;
    if (!aiValidToken(token)) { if (G) G.aiThinking = false; return; }
    fn();
  }, delay);
}

export function aiThink() { return 750 + Math.random() * 450; }

export function aiResume() {
  if (!G || G.aiSeat === null || _aiPending) return;
  if (G.activeSeat !== G.aiSeat) return;
  if (G.pendingChant) return;
  if (G.phase !== 'chant' && G.phase !== 'play') return;
  aiSchedule(() => aiTakeTurn(), aiThink());
}

function aiGetDiff() {
  if (G.aiMode === 'ai_legend') return 'legend';
  if (G.aiMode === 'ai_expert') return 'expert';
  if (G.aiMode === 'ai_hard')   return 'hard';
  return 'medium';
}

export function aiTakeTurn() {
  _aiPending = false;
  if (!G || G.aiSeat === null) { if (G) G.aiThinking = false; return; }
  if (G.pendingChant && G.pendingChant.responderSeat === G.aiSeat) {
    aiHandlePendingChant();
    return;
  }
  if (G.activeSeat !== G.aiSeat) { if (G) G.aiThinking = false; return; }
  if (G.phase === 'collapsing' || G.phase === 'baza_end' || G.phase === 'hand_end') {
    G.aiThinking = false; return;
  }
  const diff = aiGetDiff();
  if      (G.phase === 'chant') aiChantTurn(diff);
  else if (G.phase === 'play')  aiPlayTurn(diff);
  else G.aiThinking = false;
}

// ── Bluff history (Gaucho + Duende) ──────────────────────────────

let _humanBluffHistory  = [];
let _humanEnvidoHistory = [];
let _humanTrucoHistory  = [];

export function aiRecordHand() {
  if (!G || G.aiSeat === null) return;
  if (G.aiMode === 'ai_legend') legendUpdateModel();

  const humanSeat = 1 - G.aiSeat;
  const humanTeam = teamOf(humanSeat);

  const humanSangTruco  = G.bet.level > 0 && G.bet.lastRaiserTeam === humanTeam;
  const humanSangEnvido = G.chant.envido.callerTeam === humanTeam;
  const humanLostBaza1  = G.trickWinners[0] !== undefined && G.trickWinners[0] !== humanTeam;

  if (humanSangTruco)
    _humanTrucoHistory.push({ called: true, bazaLost: humanLostBaza1 });
  if (humanSangEnvido && G.chant.envido.resolved)
    _humanEnvidoHistory.push({ called: true, accepted: G.chant.envido.accepted });

  if (_humanTrucoHistory.length  > 8) _humanTrucoHistory.shift();
  if (_humanEnvidoHistory.length > 8) _humanEnvidoHistory.shift();
}

function aiEstimateBluffProb(type) {
  if (type === 'truco') {
    if (_humanTrucoHistory.length < 2) return 0.20;
    return _humanTrucoHistory.filter(h => h.bazaLost).length / _humanTrucoHistory.length;
  }
  if (type === 'envido') {
    if (_humanEnvidoHistory.length < 2) return 0.15;
    return _humanEnvidoHistory.filter(h => h.called && !h.accepted).length / _humanEnvidoHistory.length;
  }
  return 0.20;
}

// ── Bluff helpers ─────────────────────────────────────────────────

function aiShouldBluffTruco(hand, tw, tl) {
  const pows   = hand.filter(qc => qc && qc.options).map(qc => aiExpectedPower(qc));
  const maxPow = pows.length ? Math.max(...pows) : 0;
  if (maxPow >= 10) return false;
  if (maxPow < 5.0) return false;
  if (tl >= 1 && tw === 0 && maxPow >= 6.0) return Math.random() < 0.22;
  if (tl === 0 && tw === 0 && maxPow >= 7.0) return Math.random() < 0.08;
  return false;
}

function aiShouldBluffEnvido(metric) {
  if (metric.mu >= 20) return false;
  if (metric.mu >= 15) return Math.random() < 0.18;
  return Math.random() < 0.08;
}

// ── Respond to pending chants ─────────────────────────────────────

export function aiHandlePendingChant() {
  G.aiThinking = false;
  if (!G || !G.pendingChant) return;
  const pc   = G.pendingChant;
  if (pc.responderSeat !== G.aiSeat) return;
  const diff = aiGetDiff();

  if (pc.type === 'truco') {
    const { level } = pc.data;
    const nxt  = TRUCO_LEVELS[level];
    const p    = G.players[G.aiSeat];
    const roll = Math.random();
    const tw   = G.trickWinners.filter(w => w === p.team).length;
    const tl   = G.trickWinners.filter(w => w !== p.team && w !== -1).length;

    if (diff === 'legend') {
      const dec = legendTrucoDecision(level, p.hand, true);
      if (dec === 'raise' && level < 3 && TRUCO_LEVELS[level + 1]) {
        uiLog(`[IA] Duende sube a ${TRUCO_LEVELS[level+1].name}`, 'important');
        raiseTruco(); return;
      }
      const accept = dec !== 'reject';
      uiLog(`[IA] Duende ${accept ? 'acepta' : 'rechaza'} ${nxt.name}`, 'important');
      respondTruco(accept); return;
    }

    const pWinHand = aiEstimateHandWinProb(p.hand, tw, tl);
    const aiTeam   = p.team;
    const oppScore = G.scores[1 - aiTeam];
    const nxtPts   = nxt.pts;
    const rejPts   = TRUCO_LEVELS[level - 1].pts;
    const loseEndsGame     = (oppScore + nxtPts) >= G.target;
    const losePutsOppClose = (oppScore + nxtPts) >= G.target - 2;
    const rejectEndsGame   = (oppScore + rejPts) >= G.target;

    const breakEven  = (nxtPts - rejPts) / (2 * nxtPts);
    const safetyBase = diff === 'medium' ? 0.22 : diff === 'hard' ? 0.14 : 0.08;
    const levelScale = [0, 1.0, 1.3, 1.7][level] || 1.0;
    const trickBonus = tw >= 1 ? 0.6 : tl >= 1 ? 1.2 : 1.0;
    const scoreMult  = loseEndsGame ? 1.8 : losePutsOppClose ? 1.3 : 1.0;
    const bluffDisc  = diff === 'expert' ? aiEstimateBluffProb('truco') * 0.15 : 0;
    const threshold  = Math.max(0.10, breakEven + safetyBase * levelScale * trickBonus * scoreMult - bluffDisc);

    if (loseEndsGame && pWinHand < 0.38 && !rejectEndsGame) {
      uiLog(`[IA] Rechaza ${nxt.name} — riesgo de cierre`, 'important');
      respondTruco(false); return;
    }

    let accept = pWinHand >= threshold || roll < (diff === 'medium' ? 0.04 : 0.06);

    if (accept && level < 3 && TRUCO_LEVELS[level + 1]) {
      const bluffP    = diff === 'expert' ? aiEstimateBluffProb('truco') : 0;
      const raiseProb = diff === 'expert' ? Math.min(0.20, 0.08 + bluffP * 0.24)
                      : diff === 'hard'   ? 0.09 : 0.04;
      if (pWinHand >= 0.62 && roll < raiseProb) {
        uiLog(`[IA] Sube a ${TRUCO_LEVELS[level+1].name}`, 'important');
        raiseTruco(); return;
      }
      if (diff === 'expert' && bluffP > 0.45 && pWinHand >= 0.48 && roll < 0.16) {
        uiLog(`[IA] Contra-bluff a ${TRUCO_LEVELS[level+1].name}`, 'important');
        raiseTruco(); return;
      }
    }

    uiLog(`[IA] ${accept ? 'Acepta' : 'Rechaza'} ${nxt.name} (p=${pWinHand.toFixed(2)} thr=${threshold.toFixed(2)})`, 'important');
    respondTruco(accept);

  } else if (pc.type === 'envido') {
    const env    = G.chant.envido;
    const metric = G.players[G.aiSeat].metric;
    const raises = envidoCanRaise(env.calls[env.calls.length - 1]);
    const roll   = Math.random();
    let decision = 'reject';

    if (diff === 'legend') {
      const pWin     = legendEnvidoWinProb(metric);
      const foldRate = _opModel.folds / Math.max(_opModel.handsPlayed, 1);
      const callBar  = Math.max(0.30, 0.36 - foldRate * 0.12);
      if (pWin >= callBar) {
        if (pWin >= 0.54 && raises.length && roll < 0.40) decision = raises[0];
        else decision = 'accept';
      }
      uiLog(`[IA] Duende envido: ${decision} (pWin=${pWin.toFixed(2)})`, 'important');
      respondEnvido(decision); return;
    }

    if (diff === 'medium') {
      if (metric.mu >= 21)      decision = (metric.mu >= 25 && roll < 0.42 && raises.length) ? raises[0] : 'accept';
      else if (metric.mu >= 17) decision = roll < 0.62 ? 'accept' : 'reject';
      else if (metric.mu >= 13) decision = roll < 0.30 ? 'accept' : 'reject';
      else                      decision = roll < 0.12 ? 'accept' : 'reject';
    } else if (diff === 'hard') {
      const pWin = aiEstimateEnvidoWinProb(metric);
      if (pWin >= 0.36)     decision = (pWin >= 0.48 && roll < 0.40 && raises.length) ? raises[0] : 'accept';
      else if (roll < 0.15) decision = 'accept';
    } else {
      const bluffP  = aiEstimateBluffProb('envido');
      const pWin    = aiEstimateEnvidoWinProb(metric);
      const callBar = Math.max(0.30, 0.36 - bluffP * 0.12);
      if (pWin >= callBar) {
        decision = (pWin >= 0.48 && raises.length && roll < 0.38) ? raises[0] : 'accept';
      }
      if (decision === 'accept' && bluffP > 0.42 && raises.length && roll < 0.25) {
        decision = raises[raises.length - 1];
      }
    }

    uiLog(`[IA] Envido: ${decision}`, 'important');
    respondEnvido(decision);

  } else if (pc.type === 'flor') {
    const { stage } = pc.data;
    if (stage === 'initial') {
      respondFlor(G.players[G.aiSeat].florMetric.pFlor > 0 ? 'yes' : 'no');
    } else if (stage === 'contraflor') {
      const t = diff === 'legend' ? 0.55 : diff === 'expert' ? 0.40 : diff === 'hard' ? 0.28 : 0.18;
      respondFlor(Math.random() < t ? 'contraflor' : 'simple');
    } else if (stage === 'resp_contraflor') {
      const florMu = G.players[G.aiSeat].florMetric.mu || 0;
      const t = diff === 'legend' ? (florMu >= 22 ? 0.72 : 0.50)
              : diff === 'expert' ? (florMu >= 25 ? 0.60 : 0.38)
              : diff === 'hard'   ? 0.42 : 0.32;
      respondFlor(Math.random() < t ? 'accept' : 'reject');
    }
  }
}

// ── AI takes initiative ───────────────────────────────────────────

function aiChantTurn(diff) {
  const p  = G.players[G.aiSeat];
  const tw = G.trickWinners.filter(w => w === p.team).length;
  const tl = G.trickWinners.filter(w => w !== p.team && w !== -1).length;

  // 1. Envido
  if (G.trickIdx === 0 && !G.chant.envido.resolved
      && !G.chant.florBlockedEnvido && G.chant.envido.calls.length === 0) {
    const call = diff === 'legend'
      ? legendEnvidoCall(p.metric)
      : aiDecideEnvidoCall(p.metric, diff);
    if (call) {
      uiLog(`[IA] Canta ${call}`, 'important');
      G.aiThinking = false;
      initiateEnvido(call); return;
    }
  }

  // 2. Truco
  if (canTeamRaiseNow(G.bet, p.team)) {
    const nxt = TRUCO_LEVELS[G.bet.level + 1];
    if (nxt) {
      let shouldSing;
      if (diff === 'legend') {
        shouldSing = legendTrucoDecision(1, p.hand, false) !== 'reject';
      } else if (diff === 'expert' || diff === 'hard') {
        shouldSing = aiDecideSingTruco(p.hand, diff) || aiShouldBluffTruco(p.hand, tw, tl);
      } else {
        shouldSing = aiDecideSingTruco(p.hand, diff);
      }
      if (shouldSing) {
        uiLog(`[IA] Canta ${nxt.name}`, 'important');
        G.aiThinking = false;
        singTruco(); return;
      }
    }
  }

  // 3. Play
  G.aiThinking = false;
  G.phase = 'play';
  aiPlayTurn(diff);
}

function aiDecideEnvidoCall(metric, diff) {
  const r = Math.random();
  if (diff === 'medium') {
    if (metric.mu >= 25 || metric.p28 >= 0.55) return 'falta envido';
    if (metric.mu >= 21 || metric.p28 >= 0.38) return 'real envido';
    if (metric.mu >= 18) return 'envido';
    if (r < 0.07) return 'envido';
    return null;
  } else if (diff === 'hard') {
    const pWin = aiEstimateEnvidoWinProb(metric);
    if (pWin >= 0.52) return metric.p28 >= 0.40 ? 'falta envido' : 'real envido';
    if (pWin >= 0.40) return 'envido';
    if (metric.mu >= 17 && r < 0.12) return 'envido';
    return null;
  } else {
    const pWin = aiEstimateEnvidoWinProb(metric);
    if (pWin >= 0.52) return metric.p28 >= 0.38 ? 'falta envido' : 'real envido';
    if (pWin >= 0.38) return 'envido';
    if (aiShouldBluffEnvido(metric) && r < 0.50) return 'envido';
    return null;
  }
}

function aiDecideSingTruco(hand, diff) {
  const pows   = hand.filter(qc => qc && qc.options).map(qc => aiExpectedPower(qc));
  if (!pows.length) return false;
  const maxPow = Math.max(...pows);
  const r      = Math.random();
  const tw     = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl     = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;

  if (diff === 'medium') {
    return maxPow >= 9.0 || (maxPow >= 7.5 && r < 0.38) || r < 0.05;
  } else if (diff === 'hard') {
    return maxPow >= 8.5 || (maxPow >= 7.5 && r < 0.50) || (tl >= 1 && maxPow >= 7.0 && r < 0.40) || r < 0.07;
  } else if (diff === 'expert') {
    if (maxPow >= 9.0)             return true;
    if (maxPow >= 7.5)             return r < 0.65;
    if (maxPow >= 7.0 && tw >= 1)  return r < 0.60;
    if (tl >= 1 && maxPow >= 6.5)  return r < 0.45;
    return r < 0.10;
  } else {
    return maxPow >= 9.5 || r < 0.08;
  }
}

// ── Card play ─────────────────────────────────────────────────────

function aiPlayTurn(diff) {
  const hand  = G.players[G.aiSeat].hand;
  const valid = hand.filter(qc => qc && qc.options && qc.options[0] && qc.options[1]);
  if (!valid.length) { G.aiThinking = false; return; }

  if (canTeamRaiseNow(G.bet, G.players[G.aiSeat].team)) {
    const nxt = TRUCO_LEVELS[G.bet.level + 1];
    if (nxt) {
      const tw = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
      const tl = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
      let shouldSing;
      if (diff === 'legend') {
        shouldSing = legendTrucoDecision(1, valid, false) !== 'reject';
      } else if (diff === 'expert' || diff === 'hard') {
        shouldSing = aiDecideSingTruco(valid, diff) || aiShouldBluffTruco(valid, tw, tl);
      } else {
        shouldSing = aiDecideSingTruco(valid, diff);
      }
      if (shouldSing) {
        uiLog(`[IA] Canta ${nxt.name}`, 'important');
        G.aiThinking = false;
        singTruco(); return;
      }
    }
  }

  let idx;
  if      (diff === 'medium') idx = aiChooseCardMedium(valid, hand);
  else if (diff === 'hard')   idx = aiChooseCardHard(valid, hand);
  else if (diff === 'expert') idx = aiChooseCardExpert(valid, hand);
  else                        idx = aiChooseCardLegend(valid, hand);

  uiLog(`[IA] Juega carta`, '');
  G.aiThinking = false;
  onCardClick(idx);
}

function aiChooseCardMedium(valid, hand) {
  const tw     = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl     = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
  const sorted = valid.map(qc => ({ qc, ep: aiExpectedPower(qc) })).sort((a, b) => a.ep - b.ep);
  let chosen;
  if (G.trickIdx === 0)         chosen = sorted[Math.floor(sorted.length / 2)].qc;
  else if (tw >= 1 && tl === 0) chosen = sorted[0].qc;
  else                          chosen = sorted[sorted.length - 1].qc;
  return hand.indexOf(chosen);
}

function aiChooseCardHard(valid, hand) {
  const tw     = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl     = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
  const scored = valid.map(qc => ({ qc, ep: aiExpectedPower(qc), pw: aiEstimateBazaWinProb(qc) }));
  let chosen;
  if (G.trickIdx === 0) {
    chosen = scored.sort((a, b) => Math.abs(a.pw - 0.52) - Math.abs(b.pw - 0.52))[0].qc;
  } else if (tw >= 1 && tl === 0) {
    const viable = scored.filter(s => s.pw >= 0.45).sort((a, b) => a.ep - b.ep);
    chosen = (viable.length ? viable[0] : scored.sort((a, b) => a.ep - b.ep)[0]).qc;
  } else {
    chosen = scored.sort((a, b) => b.pw - a.pw)[0].qc;
  }
  return hand.indexOf(chosen);
}

function aiChooseCardExpert(valid, hand) {
  const tw     = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl     = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
  const scored = valid.map(qc => ({ qc, ep: aiExpectedPower(qc), pw: aiEstimateBazaWinProb(qc, 200) }));
  let chosen;
  if (G.trickIdx === 0) {
    chosen = scored.sort((a, b) => Math.abs(a.pw - 0.50) - Math.abs(b.pw - 0.50))[0].qc;
  } else if (tw >= 2 || (tw === 1 && tl === 0)) {
    const viable = scored.filter(s => s.pw >= 0.40).sort((a, b) => a.ep - b.ep);
    chosen = (viable.length ? viable[0] : scored.sort((a, b) => a.ep - b.ep)[0]).qc;
  } else {
    chosen = scored.sort((a, b) => b.pw - a.pw)[0].qc;
  }
  return hand.indexOf(chosen);
}

// ── Probability helpers ───────────────────────────────────────────

function aiExpectedPower(qc) {
  if (!qc || !qc.options || !qc.options[0] || !qc.options[1]) return 0;
  return (trucoPower(qc.options[0]) + trucoPower(qc.options[1])) / 2;
}

function aiEstimateBazaWinProb(qc, samples = 80) {
  if (!qc || !qc.options) return 0.5;
  const myPow = aiExpectedPower(qc);
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const r = Math.random();
    const o = r < 0.40 ? 1 + Math.floor(Math.random() * 4)
            : r < 0.75 ? 5 + Math.floor(Math.random() * 5)
            :            10 + Math.floor(Math.random() * 5);
    wins += myPow > o ? 1 : myPow === o ? 0.5 : 0;
  }
  return wins / samples;
}

// Multi-baza hand win probability — accounts for trick state.
function aiEstimateHandWinProb(hand, tw, tl) {
  const validCards = hand.filter(qc => qc && qc.options);
  if (!validCards.length) return 0.5;
  const bazaProbs = validCards.map(qc => aiEstimateBazaWinProb(qc, 120));
  const bestBaza  = Math.max(...bazaProbs);
  const avgBaza   = bazaProbs.reduce((a, b) => a + b, 0) / bazaProbs.length;

  if (tw >= 2) return 0.97;
  if (tl >= 2) return 0.03;
  if (tw === 1 && tl === 0) return 1 - Math.pow(1 - bestBaza, 2) * 0.85;
  if (tw === 0 && tl === 1) return Math.pow(bestBaza, 2) * 1.05;
  if (tw === 1 && tl === 1) return bestBaza;

  const pWinFrom10 = 1 - Math.pow(1 - avgBaza, 2) * 0.85;
  const pWinFrom01 = Math.pow(avgBaza, 2) * 1.05;
  return bestBaza * pWinFrom10 + (1 - bestBaza) * pWinFrom01;
}

function aiEstimateEnvidoWinProb(metric) {
  const hand = G.players[G.aiSeat].hand.filter(qc => qc && qc.options);
  if (!hand.length) return 0.5;
  const worlds = enumerateWorlds(hand);
  const myExp  = worlds.map(w => envidoScore(w)).reduce((a, b) => a + b, 0) / worlds.length;
  let wins = 0;
  for (let i = 0; i < 200; i++) {
    const r = Math.random();
    const o = r < 0.35 ? 5 + Math.floor(Math.random() * 8)
            : r < 0.65 ? 20 + Math.floor(Math.random() * 8)
            :             27 + Math.floor(Math.random() * 7);
    wins += myExp > o ? 1 : myExp === o ? 0.5 : 0;
  }
  return wins / 200;
}

// ═══════════════════════════════════════════════════════════════════
// EL DUENDE — Bayesian opponent model + expected-utility tree
// ═══════════════════════════════════════════════════════════════════

let _opModel = {
  trucoBluffRate:  0.20,
  envidoBluffRate: 0.15,
  aggressionLevel: 0.50,
  avgEnvidoMu:     20,
  folds: 0, calls: 0, raises: 0, handsPlayed: 0,
  envidoSamples: [],
};

function legendUpdateModel() {
  if (!G || G.aiSeat === null) return;
  const humanTeam = teamOf(1 - G.aiSeat);
  _opModel.handsPlayed++;

  const initiated = (G.bet.level > 0 && G.bet.lastRaiserTeam === humanTeam ? 1 : 0)
                  + (G.chant.envido.callerTeam === humanTeam ? 1 : 0);
  _opModel.aggressionLevel = _opModel.aggressionLevel * 0.85 + (initiated / 2) * 0.15;

  if (G.bet.level > 0 && G.bet.lastRaiserTeam === humanTeam) {
    const bazaLost = G.trickWinners[0] !== undefined && G.trickWinners[0] !== humanTeam;
    _opModel.trucoBluffRate = _opModel.trucoBluffRate * 0.80 + (bazaLost ? 0.20 : 0);
  }

  if (G.chant.envido.resolved && G.chant.envido.callerTeam === humanTeam) {
    const calls    = G.chant.envido.calls || [];
    const topCall  = calls[calls.length - 1];
    const impliedMu = topCall === 'falta envido' ? 29
                    : topCall === 'real envido'   ? 25
                    : topCall === 'envido'         ? 20 : 15;
    _opModel.avgEnvidoMu = _opModel.avgEnvidoMu * 0.75 + impliedMu * 0.25;
    _opModel.envidoSamples.push(impliedMu);
    if (_opModel.envidoSamples.length > 10) _opModel.envidoSamples.shift();
  }

  if (G.bet.level > 0) {
    const humanFolded = G.trickWinners.length < 3 && G.handScore[teamOf(G.aiSeat)] > 0;
    if (humanFolded) _opModel.folds++;
    else             _opModel.calls++;
  }
}

function legendEstimateHumanEnvidoDist() {
  const samples = _opModel.envidoSamples;
  if (!samples.length) return { mean: _opModel.avgEnvidoMu, sd: 8 };
  const mean     = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / samples.length;
  return { mean, sd: Math.max(Math.sqrt(variance), 3) };
}

function legendEnvidoWinProb(metric) {
  const hand = G.players[G.aiSeat].hand.filter(qc => qc && qc.options);
  if (!hand.length) return 0.5;
  const worlds = enumerateWorlds(hand);
  const myExp  = worlds.map(w => envidoScore(w)).reduce((a, b) => a + b, 0) / worlds.length;
  const dist   = legendEstimateHumanEnvidoDist();
  let wins = 0;
  for (let i = 0; i < 300; i++) {
    const u = Math.random(), v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u + 1e-9)) * Math.cos(2 * Math.PI * v);
    const oScore = Math.max(0, Math.min(33, dist.mean + z * dist.sd));
    wins += myExp > oScore ? 1 : myExp === Math.round(oScore) ? 0.5 : 0;
  }
  return wins / 300;
}

function legendBazaWinProb(qc) {
  if (!qc || !qc.options) return 0.5;
  const p0  = trucoPower(qc.options[0]);
  const p1  = trucoPower(qc.options[1]);
  const agg = _opModel.aggressionLevel;
  let wins  = 0;
  for (let i = 0; i < 300; i++) {
    const myPow = Math.random() < 0.5 ? p0 : p1;
    const r     = Math.random();
    const oPow  = r < 0.35 - agg * 0.15 ? 1 + Math.floor(Math.random() * 4)
                : r < 0.70 - agg * 0.10 ? 5 + Math.floor(Math.random() * 5)
                :                          10 + Math.floor(Math.random() * 5);
    wins += myPow > oPow ? 1 : myPow === oPow ? 0.5 : 0;
  }
  return wins / 300;
}

function legendTrucoDecision(level, hand, isResponding) {
  const tw = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
  const pHandWin = aiEstimateHandWinProb(hand, tw, tl);

  const nxt      = TRUCO_LEVELS[level];
  const prev     = TRUCO_LEVELS[level > 0 ? level - 1 : 0];
  const ptAccept = nxt  ? nxt.pts  : 4;
  const ptReject = prev ? prev.pts : 1;
  const maxEP    = hand.filter(qc => qc && qc.options).map(qc => aiExpectedPower(qc));
  const maxPow   = maxEP.length ? Math.max(...maxEP) : 0;
  const canRaise = level < 3 && TRUCO_LEVELS[level + 1];
  const bluffRate = _opModel.trucoBluffRate;
  const r         = Math.random();

  const aiTeam   = G.players[G.aiSeat].team;
  const oppScore = G.scores[1 - aiTeam];
  const loseEndsGame      = (oppScore + ptAccept) >= G.target;
  const losePutsOppClose  = (oppScore + ptAccept) >= G.target - 2;
  const rejectEndsGame    = (oppScore + ptReject) >= G.target;

  if (isResponding) {
    const breakEven   = (ptAccept - ptReject) / (2 * ptAccept);
    const levelMargin = [0, 0.04, 0.07, 0.10][level] || 0.10;
    const scoreMult   = loseEndsGame ? 1.8 : losePutsOppClose ? 1.3 : 1.0;
    const bluffDisc   = bluffRate * 0.12;
    const threshold   = Math.max(0.10, breakEven + levelMargin * scoreMult - bluffDisc);

    if (loseEndsGame && pHandWin < 0.38 && !rejectEndsGame) return 'reject';
    if (pHandWin < threshold) return 'reject';

    const foldRate = Math.min(0.55, _opModel.folds / Math.max(_opModel.handsPlayed, 1) + 0.10);
    const uRaise   = canRaise && maxPow >= 8.5
      ? foldRate * ptAccept + (1 - foldRate) * (2 * pHandWin - 1) * TRUCO_LEVELS[level + 1].pts
      : -999;
    const uAccept  = (2 * pHandWin - 1) * ptAccept;
    if (canRaise && uRaise > uAccept && r < 0.18) return 'raise';
    return 'accept';

  } else {
    const pOppFold = Math.min(0.55, _opModel.folds / Math.max(_opModel.handsPlayed, 1) + 0.22);
    const evSing   = pOppFold * ptReject + (1 - pOppFold) * (2 * pHandWin - 1) * ptAccept;

    if (loseEndsGame && pHandWin < 0.42 && !rejectEndsGame) return 'reject';

    if (evSing > 0.25) {
      if (canRaise && maxPow >= 9 && pHandWin >= 0.58 && r < 0.22) return 'raise';
      return 'accept';
    }
    if (pHandWin >= 0.40 && tl >= 1 && r < 0.32) return 'accept';
    if (pHandWin >= 0.38 && r < 0.15)             return 'accept';
    return 'reject';
  }
}

function legendEnvidoCall(metric) {
  const pWin     = legendEnvidoWinProb(metric);
  const foldRate = _opModel.folds / Math.max(_opModel.handsPlayed, 1);
  const r        = Math.random();
  if (pWin >= 0.70) return 'falta envido';
  if (pWin >= 0.54) return 'real envido';
  if (pWin >= 0.42) return 'envido';
  if (foldRate > 0.35 && metric.mu >= 13 && r < 0.28) return 'envido';
  if (metric.mu >= 15 && r < 0.12) return 'envido';
  return null;
}

function aiChooseCardLegend(valid, hand) {
  const tw     = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl     = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
  const scored = valid.map(qc => ({ qc, ep: aiExpectedPower(qc), pw: legendBazaWinProb(qc) }));

  function hwp(ownWins, oppWins, rem) {
    if (ownWins >= 2) return 1.0;
    if (oppWins >= 2) return 0.0;
    if (rem === 0) return ownWins > oppWins ? 1.0 : ownWins === oppWins ? 0.5 : 0.0;
    return 0.5;
  }

  let best = -Infinity, chosen = scored[0].qc;
  for (const s of scored) {
    const rem = 3 - G.trickIdx - 1;
    let ev    = 0;
    if (G.trickIdx === 0) {
      ev = s.pw * hwp(tw+1, tl, rem) + (1-s.pw) * hwp(tw, tl+1, rem);
      ev -= s.ep > 12 ? 0.15 : 0;
    } else if (G.trickIdx === 1) {
      ev = s.pw * hwp(tw+1, tl, rem) + (1-s.pw) * hwp(tw, tl+1, rem);
      if (tw === 1 && tl === 0) ev -= s.ep * 0.02;
    } else {
      ev = s.pw;
    }
    if (ev > best) { best = ev; chosen = s.qc; }
  }
  return hand.indexOf(chosen);
}

// ── Reset ─────────────────────────────────────────────────────────

// Lightweight reset between hands: invalidates stale timeouts without
// clearing opponent model or bluff history.
export function resetAITurn() {
  _aiPending = false;
  aiNewToken(); // invalidates any setTimeout callbacks from previous hand
  if (G) G.aiThinking = false;
}

export function resetAIState() {
  _aiPending          = false;
  _aiTurnToken        = 0;
  _humanTrucoHistory  = [];
  _humanEnvidoHistory = [];
  _humanBluffHistory  = [];
  _opModel = {
    trucoBluffRate:  0.20,
    envidoBluffRate: 0.15,
    aggressionLevel: 0.50,
    avgEnvidoMu:     20,
    folds: 0, calls: 0, raises: 0, handsPlayed: 0,
    envidoSamples: [],
  };
}
