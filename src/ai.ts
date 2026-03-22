// @ts-nocheck
// Refactor of the original single-file Quantum Truco source.
// This file owns all AI state and decisions.

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

let _aiTurnToken = 0;
let _aiPending = false;
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
  if (G.phase === 'collapsing' || G.phase === 'baza_end' || G.phase === 'hand_end') { G.aiThinking = false; return; }
  const diff = aiGetDiff();
  if      (G.phase === 'chant') aiChantTurn(diff);
  else if (G.phase === 'play')  aiPlayTurn(diff);
  else G.aiThinking = false;
}

// ── Bluff detection (gaucho digital) ────────────────────────────
// Tracks opponent betting patterns to estimate bluff probability.
// _humanBluffHistory: array of {calledAt: bet.level, hadPower: bool}
// We infer "had power" based on whether they won the baza they sang on.

let _humanBluffHistory = [];   // {calledTruco: bool, calledEnvido: bool, bazaLost: bool}[]
let _humanEnvidoHistory = [];  // {called: bool, envidoScore: number|null}[]
let _humanTrucoHistory  = [];  // {called: bool, bazaPower: 'high'|'mid'|'low'|null}[]

// Called at end of each hand to record human behavior
export function aiRecordHand() {
  if (!G || G.aiSeat === null) return;
  if (G.aiMode === 'ai_legend') legendUpdateModel();
  const humanSeat = 1 - G.aiSeat;
  const humanTeam = teamOf(humanSeat);
  const aiTeam    = teamOf(G.aiSeat);

  // Did human sing truco? Did they win the hand?
  const humanSangTruco  = G.bet.level > 0 && G.bet.lastRaiserTeam === humanTeam;
  const humanSangEnvido = G.chant.envido.callerTeam === humanTeam;
  const aiWonTricks     = G.trickWinners.filter(w => w === aiTeam).length;
  const humanLostBaza1  = G.trickWinners[0] !== undefined && G.trickWinners[0] !== humanTeam;

  if (humanSangTruco) {
    _humanTrucoHistory.push({ called: true, bazaLost: humanLostBaza1 });
  }
  if (humanSangEnvido && G.chant.envido.resolved) {
    _humanEnvidoHistory.push({ called: true, accepted: G.chant.envido.accepted });
  }

  // Keep only last 8 hands
  if (_humanTrucoHistory.length > 8)  _humanTrucoHistory.shift();
  if (_humanEnvidoHistory.length > 8) _humanEnvidoHistory.shift();
}

// Returns 0..1 — how likely is it that the human is bluffing right now?
// Higher = more likely bluff.
function aiEstimateBluffProb(type) {
  if (type === 'truco') {
    if (_humanTrucoHistory.length < 2) return 0.20; // not enough data, assume some bluff
    // Bluff proxy: they sang truco but lost the first baza
    const bluffLike = _humanTrucoHistory.filter(h => h.bazaLost).length;
    return bluffLike / _humanTrucoHistory.length;
  }
  if (type === 'envido') {
    if (_humanEnvidoHistory.length < 2) return 0.15;
    // Bluff proxy: they sang envido but rejected (didn't reveal high score)
    const suspicious = _humanEnvidoHistory.filter(h => h.called && !h.accepted).length;
    return suspicious / _humanEnvidoHistory.length;
  }
  return 0.20;
}

// Should gaucho bluff right now? Returns true with calibrated probability.
// Conditions: only bluff if hand state makes it credible.
function aiShouldBluffTruco(hand, tw, tl) {
  const pows = hand.filter(qc=>qc&&qc.options).map(qc=>aiExpectedPower(qc));
  const maxPow = pows.length ? Math.max(...pows) : 0;
  // Only bluff if: we're behind or mid-game, and hand is mediocre (bluffing with great hand = no bluff)
  if (maxPow >= 11) return false; // real hand, not a bluff
  if (tl >= 1 && tw === 0 && maxPow >= 6) return Math.random() < 0.40; // behind, credible bluff
  if (tl === 0 && tw === 0 && maxPow >= 5) return Math.random() < 0.22; // opening bluff
  return false;
}

function aiShouldBluffEnvido(metric) {
  // Bluff envido only with mediocre hand (if great, it's not a bluff)
  if (metric.mu >= 24) return false;
  if (metric.mu >= 15) return Math.random() < 0.28;
  return false;
}

// ── Respond to pending chants ────────────────────────────────────

export function aiHandlePendingChant() {
  G.aiThinking = false;
  if (!G || !G.pendingChant) return;
  const pc   = G.pendingChant;
  if (pc.responderSeat !== G.aiSeat) return;
  const diff = aiGetDiff();

  if (pc.type === 'truco') {
    const { level, raiserTeam } = pc.data;
    const nxt    = TRUCO_LEVELS[level];
    const p      = G.players[G.aiSeat];
    const maxPow = Math.max(...p.hand.filter(qc=>qc&&qc.options).map(qc=>aiExpectedPower(qc)), 0);
    const roll   = Math.random();
    const tw     = G.trickWinners.filter(w=>w===p.team).length;
    const tl     = G.trickWinners.filter(w=>w!==p.team&&w!==-1).length;
    let accept;

    if (diff === 'legend') {
      // Full expected-utility decision tree
      const dec = legendTrucoDecision(level, p.hand);
      if (dec === 'raise' && level < 3 && TRUCO_LEVELS[level + 1]) {
        uiLog(`[IA] Duende sube a ${TRUCO_LEVELS[level+1].name}`, 'important');
        raiseTruco();
        return;
      }
      accept = (dec === 'accept');
      uiLog(`[IA] Duende ${accept ? 'acepta' : 'rechaza'} ${nxt.name}`, 'important');
      respondTruco(accept);
      return;
    }
    if (diff === 'medium') {
      accept = maxPow >= 10 || (maxPow >= 7 && roll < 0.60) || roll < 0.10;
    } else if (diff === 'hard') {
      accept = maxPow >= 11 || (maxPow >= 8 && tw >= 1) || (maxPow >= 9 && roll < 0.65) || roll < 0.08;
    } else {
      // expert: factor in bluff probability of the caller
      const bluffP = aiEstimateBluffProb('truco');
      const threshold = 9 - bluffP * 3;
      accept = maxPow >= threshold || (maxPow >= threshold - 2 && tw >= 1) || roll < 0.06;
    }

    // Raise instead of flat accept/reject?
    if (level < 3 && TRUCO_LEVELS[level + 1]) {
      const raiseThreshold = diff === 'expert' ? 0.35 : diff === 'hard' ? 0.40 : 0.50;
      if (!accept && aiDecideSingTruco(p.hand, diff) && roll < raiseThreshold) {
        uiLog(`[IA] Sube a ${TRUCO_LEVELS[level+1].name}`, 'important');
        raiseTruco();
        return;
      }
      if (diff === 'expert' && !accept && aiEstimateBluffProb('truco') > 0.45 && roll < 0.50 && level < 3) {
        uiLog(`[IA] Contra-bluff: sube a ${TRUCO_LEVELS[level+1].name}`, 'important');
        raiseTruco();
        return;
      }
    }

    uiLog(`[IA] ${accept ? 'Acepta' : 'Rechaza'} ${nxt.name}`, 'important');
    respondTruco(accept);

  } else if (pc.type === 'envido') {
    const env    = G.chant.envido;
    const metric = G.players[G.aiSeat].metric;
    const raises = envidoCanRaise(env.calls[env.calls.length - 1]);
    const roll   = Math.random();
    let decision = 'reject';

    if (diff === 'legend') {
      const pWin = legendEnvidoWinProb(metric);
      const foldRate = _opModel.folds / Math.max(_opModel.handsPlayed, 1);
      // Lower calling bar if opponent folds often
      const callBar = Math.max(0.38, 0.52 - foldRate * 0.20);
      if (pWin >= callBar) {
        // Raise aggressively if we likely win and opponent has been aggressive
        if (pWin >= 0.72 && raises.length && roll < 0.70) decision = raises[raises.length - 1];
        else if (pWin >= 0.58 && raises.length && roll < 0.45) decision = raises[0];
        else decision = 'accept';
      }
      uiLog(`[IA] Duende envido: ${decision} (pWin=${pWin.toFixed(2)})`, 'important');
      respondEnvido(decision);
      return;
    }
    if (diff === 'medium') {
      if (metric.mu >= 25)      decision = (metric.mu >= 28 && roll < 0.45 && raises.length) ? raises[0] : 'accept';
      else if (metric.mu >= 21) decision = roll < 0.55 ? 'accept' : 'reject';
      else                      decision = roll < 0.12 ? 'accept' : 'reject';
    } else if (diff === 'hard') {
      const pWin = aiEstimateEnvidoWinProb(metric);
      if (pWin >= 0.52) decision = (pWin >= 0.68 && roll < 0.45 && raises.length) ? raises[0] : 'accept';
    } else {
      // expert: factor in human bluff tendency for envido
      const bluffP   = aiEstimateBluffProb('envido');
      const pWin     = aiEstimateEnvidoWinProb(metric);
      const callBar  = 0.50 - bluffP * 0.15;
      if (pWin >= callBar) {
        decision = (pWin >= 0.70 && raises.length && roll < 0.55) ? raises[0] : 'accept';
      }
      if (decision === 'accept' && bluffP > 0.40 && metric.mu >= 22 && raises.length && roll < 0.45) {
        decision = raises[raises.length - 1];
      }
    }

    uiLog(`[IA] Envido: ${decision}`, 'important');
    respondEnvido(decision);

  } else if (pc.type === 'flor') {
    const { stage } = pc.data;
    if (stage === 'initial') {
      const hasFlorChance = G.players[G.aiSeat].florMetric.pFlor > 0;
      uiLog(`[IA] Flor: ${hasFlorChance ? 'Sí' : 'No'}`, 'important');
      respondFlor(hasFlorChance ? 'yes' : 'no');
    } else if (stage === 'contraflor') {
      // Expert is more aggressive with contraflor
      const roll = Math.random();
      const threshold = diff === 'legend' ? 0.70 : diff === 'expert' ? 0.50 : diff === 'hard' ? 0.30 : 0.20;
      const action = roll < threshold ? 'contraflor' : 'simple';
      uiLog(`[IA] Contraflor: ${action}`, 'important');
      respondFlor(action);
    } else if (stage === 'resp_contraflor') {
      const florMu = G.players[G.aiSeat].florMetric.mu || 0;
      const threshold = diff === 'legend' ? (florMu >= 25 ? 0.85 : 0.60)
                        : diff === 'expert' ? (florMu >= 28 ? 0.70 : 0.40)
                        : diff === 'hard' ? 0.45 : 0.35;
      const action = Math.random() < threshold ? 'accept' : 'reject';
      uiLog(`[IA] Resp contraflor: ${action}`, 'important');
      respondFlor(action);
    }
  }
}

// ── Chant turn (AI takes initiative) ────────────────────────────

function aiChantTurn(diff) {
  const p  = G.players[G.aiSeat];
  const tw = G.trickWinners.filter(w => w === p.team).length;
  const tl = G.trickWinners.filter(w => w !== p.team && w !== -1).length;

  // 1. Envido (baza 0 only, no prior calls)
  if (G.trickIdx === 0 && !G.chant.envido.resolved && !G.chant.florBlockedEnvido && G.chant.envido.calls.length === 0) {
    const call = diff === 'legend' ? legendEnvidoCall(p.metric) : aiDecideEnvidoCall(p.metric, diff);
    if (call) {
      uiLog(`[IA] Canta ${call}`, 'important');
      G.aiThinking = false;
      initiateEnvido(call);
      return;
    }
  }

  // 2. Truco (including expert bluff)
  if (canTeamRaiseNow(G.bet, p.team)) {
    const nxt = TRUCO_LEVELS[G.bet.level + 1];
    if (nxt) {
      let shouldSing;
      if (diff === 'legend') {
        const dec = legendTrucoDecision(1, p.hand); // level 1 = initiating truco
        shouldSing = (dec === 'accept' || dec === 'raise');
      } else if (diff === 'expert') {
        shouldSing = aiDecideSingTruco(p.hand, diff) || aiShouldBluffTruco(p.hand, tw, tl);
      } else {
        shouldSing = aiDecideSingTruco(p.hand, diff);
      }
      if (shouldSing) {
        uiLog(`[IA] Canta ${nxt.name}`, 'important');
        G.aiThinking = false;
        singTruco();
        return;
      }
    }
  }

  // 3. Nothing to sing → play
  G.aiThinking = false;
  G.phase = 'play';
  aiPlayTurn(diff);
}

function aiDecideEnvidoCall(metric, diff) {
  const r = Math.random();

  if (diff === 'medium') {
    if (r < 0.15) return 'envido'; // occasional random bluff
    if (metric.mu >= 28 || metric.p28 >= 0.65) return 'falta envido';
    if (metric.mu >= 26 || metric.p28 >= 0.45) return 'real envido';
    if (metric.mu >= 23) return 'envido';
    return null;

  } else if (diff === 'hard') {
    const pWin = aiEstimateEnvidoWinProb(metric);
    if (pWin >= 0.80) return 'falta envido';
    if (pWin >= 0.65) return 'real envido';
    if (pWin >= 0.52 || (metric.mu >= 20 && r < 0.18)) return 'envido';
    return null;

  } else {
    // expert: sharp thresholds + calibrated bluff
    const pWin = aiEstimateEnvidoWinProb(metric);
    if (pWin >= 0.78) return 'falta envido';
    if (pWin >= 0.62) return 'real envido';
    if (pWin >= 0.50) return 'envido';
    // Strategic bluff envido: low-scoring hand, opponent hasn't called yet
    if (aiShouldBluffEnvido(metric)) return 'envido';
    return null;
  }
}

function aiDecideSingTruco(hand, diff) {
  const pows = hand.filter(qc=>qc&&qc.options).map(qc=>aiExpectedPower(qc));
  if (!pows.length) return false;
  const maxPow = Math.max(...pows);
  const r = Math.random();
  const tw = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;

  if (diff === 'medium') {
    return maxPow >= 10 || (maxPow >= 8 && r < 0.55) || r < 0.12;
  } else if (diff === 'hard') {
    return maxPow >= 11 || (maxPow >= 9 && tw >= 1) || (tl >= 1 && maxPow >= 7 && r < 0.35) || r < 0.08;
  } else if (diff === 'expert') {
    if (maxPow >= 12) return true;
    if (maxPow >= 10 && tl === 0) return true;
    if (maxPow >= 9  && tw >= 1)  return true;
    if (tl >= 1 && maxPow >= 8)   return r < 0.25;
    return r < 0.05;
  } else {
    // legend: only called as fallback; main decision via legendTrucoDecision
    if (maxPow >= 12) return true;
    if (maxPow >= 10) return true;
    return r < 0.03;
  }
}

// ── Card play ────────────────────────────────────────────────────

function aiPlayTurn(diff) {
  const hand  = G.players[G.aiSeat].hand;
  const valid = hand.filter(qc => qc && qc.options && qc.options[0] && qc.options[1]);
  if (!valid.length) { G.aiThinking = false; return; }

  // Sing truco before playing?
  if (canTeamRaiseNow(G.bet, G.players[G.aiSeat].team)) {
    const nxt = TRUCO_LEVELS[G.bet.level + 1];
    if (nxt) {
      const tw = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
      const tl = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
      let shouldSing;
      if (diff === 'legend') {
        const dec = legendTrucoDecision(1, valid);
        shouldSing = (dec === 'accept' || dec === 'raise');
      } else if (diff === 'expert') {
        shouldSing = aiDecideSingTruco(valid, diff) || aiShouldBluffTruco(valid, tw, tl);
      } else {
        shouldSing = aiDecideSingTruco(valid, diff);
      }
      if (shouldSing) {
        uiLog(`[IA] Canta ${nxt.name}`, 'important');
        G.aiThinking = false;
        singTruco();
        return;
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
  const sorted = valid.map(qc => ({qc, ep:aiExpectedPower(qc)})).sort((a,b)=>a.ep-b.ep);
  let chosen;
  if (G.trickIdx === 0)         chosen = sorted[Math.floor(sorted.length/2)].qc;
  else if (tw >= 1 && tl === 0) chosen = sorted[0].qc;
  else if (tl >= 1 && tw === 0) chosen = sorted[sorted.length-1].qc;
  else                          chosen = sorted[sorted.length-1].qc;
  return hand.indexOf(chosen);
}

function aiChooseCardHard(valid, hand) {
  const tw     = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl     = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
  const scored = valid.map(qc => ({qc, ep:aiExpectedPower(qc), pw:aiEstimateBazaWinProb(qc)}));
  let chosen;
  if (G.trickIdx === 0) {
    chosen = scored.sort((a,b)=>Math.abs(a.pw-0.52)-Math.abs(b.pw-0.52))[0].qc;
  } else if (tw >= 1 && tl === 0) {
    const viable = scored.filter(s=>s.pw>=0.45).sort((a,b)=>a.ep-b.ep);
    chosen = (viable.length ? viable[0] : scored.sort((a,b)=>a.ep-b.ep)[0]).qc;
  } else {
    chosen = scored.sort((a,b)=>b.pw-a.pw)[0].qc;
  }
  return hand.indexOf(chosen);
}

function aiChooseCardExpert(valid, hand) {
  // Expert strategy (200 samples Monte Carlo + game-state aware)
  const tw     = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl     = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
  const scored = valid.map(qc => ({
    qc,
    ep:  aiExpectedPower(qc),
    pw:  aiEstimateBazaWinProb(qc, 200)
  }));

  let chosen;

  if (G.trickIdx === 0) {
    // Baza 1: play closest to 50% — save best cards, don't expose
    chosen = scored.sort((a,b)=>Math.abs(a.pw-0.50)-Math.abs(b.pw-0.50))[0].qc;
  } else if (tw >= 2 || (tw === 1 && tl === 0)) {
    // Winning — play cheapest card that still has >40% to take this baza
    const viable = scored.filter(s=>s.pw>=0.40).sort((a,b)=>a.ep-b.ep);
    chosen = (viable.length ? viable[0] : scored.sort((a,b)=>a.ep-b.ep)[0]).qc;
  } else if (tl >= 1 && tw === 0) {
    // Must win this baza — play strongest
    chosen = scored.sort((a,b)=>b.pw-a.pw)[0].qc;
  } else {
    // Tied (1-1 or 0-0 in baza 3): optimal win probability
    chosen = scored.sort((a,b)=>b.pw-a.pw)[0].qc;
  }
  return hand.indexOf(chosen);
}

// ── Probability helpers ──────────────────────────────────────────

function aiExpectedPower(qc) {
  if (!qc || !qc.options || !qc.options[0] || !qc.options[1]) return 0;
  return (trucoPower(qc.options[0]) + trucoPower(qc.options[1])) / 2;
}

function aiEstimateBazaWinProb(qc, samples = 80) {
  if (!qc || !qc.options) return 0.5;
  const myPow = aiExpectedPower(qc);
  let wins = 0;
  for (let i=0; i<samples; i++) {
    const r = Math.random();
    const o = r<0.40 ? 1+Math.floor(Math.random()*4) : r<0.75 ? 5+Math.floor(Math.random()*5) : 10+Math.floor(Math.random()*5);
    wins += myPow > o ? 1 : myPow === o ? 0.5 : 0;
  }
  return wins / samples;
}

function aiEstimateEnvidoWinProb(metric) {
  const hand = G.players[G.aiSeat].hand.filter(qc => qc && qc.options);
  if (!hand.length) return 0.5;
  const worlds = enumerateWorlds(hand);
  const myExp  = worlds.map(w=>envidoScore(w)).reduce((a,b)=>a+b,0) / worlds.length;
  let wins = 0;
  for (let i=0; i<200; i++) {
    const r = Math.random();
    const o = r<0.35 ? 5+Math.floor(Math.random()*8) : r<0.65 ? 20+Math.floor(Math.random()*8) : 27+Math.floor(Math.random()*7);
    wins += myExp > o ? 1 : myExp === o ? 0.5 : 0;
  }
  return wins / 200;
}


// ═══════════════════════════════════════════════════════════════
// EL DUENDE — nivel legendario
// Modelo bayesiano de oponente + árbol de utilidad esperada
// ═══════════════════════════════════════════════════════════════

// Opponent model: prior on human hand strength, updated each hand.
// Tracks:   { trucoBluffRate, envidoBluffRate, aggressionLevel,
//             avgEnvidoMu, folds, calls, raises, handsPlayed }
let _opModel = {
  trucoBluffRate:  0.20,  // P(human sang truco | weak hand)
  envidoBluffRate: 0.15,
  aggressionLevel: 0.50,  // 0=passive, 1=hyper-aggressive
  avgEnvidoMu:     20,
  folds: 0, calls: 0, raises: 0, handsPlayed: 0,
  envidoSamples: []        // [{sang, mu_est}] — built over time
};

// Called by aiRecordHand when diff===legend
function legendUpdateModel() {
  if (!G || G.aiSeat === null) return;
  const humanSeat = 1 - G.aiSeat;
  const humanTeam = teamOf(humanSeat);

  _opModel.handsPlayed++;

  // Aggression: how often did human initiate bets?
  const initiated = (G.bet.level > 0 && G.bet.lastRaiserTeam === humanTeam ? 1 : 0)
                  + (G.chant.envido.callerTeam === humanTeam ? 1 : 0);
  _opModel.aggressionLevel = _opModel.aggressionLevel * 0.85 + (initiated / 2) * 0.15;

  // Truco bluff rate: sang truco, lost first baza = likely bluff
  if (G.bet.level > 0 && G.bet.lastRaiserTeam === humanTeam) {
    const bazaLost = G.trickWinners[0] !== undefined && G.trickWinners[0] !== humanTeam;
    _opModel.trucoBluffRate = _opModel.trucoBluffRate * 0.80 + (bazaLost ? 0.20 : 0);
  }

  // Envido model: if envido resolved and we saw the score, update estimate
  if (G.chant.envido.resolved && G.chant.envido.callerTeam === humanTeam) {
    // We don't directly see the score in state, but if they raised to falta it's high
    const calls = G.chant.envido.calls || [];
    const topCall = calls[calls.length - 1];
    const impliedMu = topCall === 'falta envido' ? 29
                    : topCall === 'real envido'  ? 25
                    : topCall === 'envido'        ? 20 : 15;
    _opModel.avgEnvidoMu = _opModel.avgEnvidoMu * 0.75 + impliedMu * 0.25;
    _opModel.envidoSamples.push(impliedMu);
    if (_opModel.envidoSamples.length > 10) _opModel.envidoSamples.shift();
  }

  // Fold rate for truco
  if (G.bet.level > 0) {
    const humanFolded = G.trickWinners.length < 3 && G.handScore[teamOf(G.aiSeat)] > 0;
    if (humanFolded) _opModel.folds++;
    else _opModel.calls++;
  }
}

// Bayesian estimate of human's current envido score distribution
// Returns {mean, sd} representing a Gaussian approximation
function legendEstimateHumanEnvidoDist() {
  const samples = _opModel.envidoSamples;
  if (!samples.length) return { mean: _opModel.avgEnvidoMu, sd: 8 };
  const mean = samples.reduce((a,b)=>a+b,0) / samples.length;
  const variance = samples.map(x=>(x-mean)**2).reduce((a,b)=>a+b,0) / samples.length;
  return { mean, sd: Math.max(Math.sqrt(variance), 3) };
}

// Full MC envido win probability using bayesian opponent model
function legendEnvidoWinProb(metric) {
  const hand = G.players[G.aiSeat].hand.filter(qc => qc && qc.options);
  if (!hand.length) return 0.5;
  const worlds = enumerateWorlds(hand);
  const myExp  = worlds.map(w=>envidoScore(w)).reduce((a,b)=>a+b,0) / worlds.length;
  const dist   = legendEstimateHumanEnvidoDist();
  // Gaussian opponent model: N(dist.mean, dist.sd)
  let wins = 0;
  for (let i=0; i<300; i++) {
    // Box-Muller
    const u = Math.random(), v = Math.random();
    const z = Math.sqrt(-2*Math.log(u+1e-9)) * Math.cos(2*Math.PI*v);
    const oScore = Math.max(0, Math.min(33, dist.mean + z * dist.sd));
    wins += myExp > oScore ? 1 : myExp === Math.round(oScore) ? 0.5 : 0;
  }
  return wins / 300;
}

// Full MC baza win prob using full quantum enumeration (not just expected power)
function legendBazaWinProb(qc) {
  if (!qc || !qc.options) return 0.5;
  const opts = qc.options;
  // Average over both quantum options
  const p0 = trucoPower(opts[0]);
  const p1 = trucoPower(opts[1]);
  let wins = 0;
  // Opponent has 3 cards; their quantum cards also have 2 options each
  // We sample uniformly from plausible opponent power distribution
  for (let i=0; i<300; i++) {
    const myPow = Math.random() < 0.5 ? p0 : p1;
    // Opponent model: skewed toward their historical aggression
    const r = Math.random();
    const aggFactor = _opModel.aggressionLevel;
    // If opponent is aggressive, more high cards; if passive, more low
    const oPow = r < 0.35 - aggFactor*0.15 ? 1+Math.floor(Math.random()*4)
               : r < 0.70 - aggFactor*0.10 ? 5+Math.floor(Math.random()*5)
               : 10+Math.floor(Math.random()*5);
    wins += myPow > oPow ? 1 : myPow === oPow ? 0.5 : 0;
  }
  return wins / 300;
}

// Decision-tree expected utility for truco response
// Returns expected point gain if we accept vs reject
function legendTrucoUtility(accept, level, hand, tw, tl) {
  const nxt     = TRUCO_LEVELS[level];
  const prev    = TRUCO_LEVELS[level - 1];
  const ptAccept = nxt ? nxt.pts : 3;
  const ptReject = prev ? prev.pts : 1;

  if (!accept) return ptReject * 0.95; // near-certain points from rejection

  // If we accept: P(win hand) * pts_accept - P(lose hand) * pts_accept
  const pows   = hand.filter(qc=>qc&&qc.options).map(qc=>legendBazaWinProb(qc));
  const pBaza  = pows.length ? Math.max(...pows) : 0.5;
  // Hand win probability: rough heuristic from baza win probs and current score
  const pHandWin = tw >= 1 ? pBaza * 0.7 + 0.3 : pBaza;
  return pHandWin * ptAccept - (1 - pHandWin) * ptAccept;
}

// Decide whether to call, fold, raise on truco (legend)
// Returns: 'accept' | 'reject' | 'raise'
function legendTrucoDecision(level, hand) {
  const tw = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;

  // Adjust for human bluff rate: if they bluff a lot, lower resistance
  const bluffAdj    = _opModel.trucoBluffRate;
  const uAccept     = legendTrucoUtility(true,  level, hand, tw, tl) * (1 + bluffAdj * 0.5);
  const uReject     = legendTrucoUtility(false, level, hand, tw, tl);
  const canRaise    = level < 3 && TRUCO_LEVELS[level + 1];
  const pows        = hand.filter(qc=>qc&&qc.options).map(qc=>aiExpectedPower(qc));
  const maxPow      = pows.length ? Math.max(...pows) : 0;

  // Raise if: raising has higher EV than flat call AND we have cards OR human often folds
  const uRaise = canRaise
    ? uAccept * (maxPow >= 10 ? 1.4 : 0.9) * (1 + _opModel.folds / Math.max(_opModel.handsPlayed, 1) * 0.6)
    : -999;

  if (uRaise > uAccept && uRaise > uReject) return 'raise';
  if (uAccept > uReject) return 'accept';
  return 'reject';
}

// Legend: what to sing for envido
function legendEnvidoCall(metric) {
  const pWin = legendEnvidoWinProb(metric);
  const aggr = _opModel.aggressionLevel;

  // Scale call based on expected win probability and opponent model
  if (pWin >= 0.80) return 'falta envido';
  if (pWin >= 0.65) return 'real envido';
  if (pWin >= 0.52) return 'envido';

  // Opponent model bluff: if human folds envido often, bluff more
  const foldRate = _opModel.folds / Math.max(_opModel.handsPlayed, 1);
  if (foldRate > 0.40 && metric.mu >= 14 && Math.random() < 0.35) return 'envido';
  if (aggr > 0.60 && metric.mu >= 17 && Math.random() < 0.25) return 'envido';
  return null;
}

// Legend card choice: full minimax over 3 bazas with quantum enumeration
function aiChooseCardLegend(valid, hand) {
  const tw     = G.trickWinners.filter(w => w === G.players[G.aiSeat].team).length;
  const tl     = G.trickWinners.filter(w => w !== G.players[G.aiSeat].team && w !== -1).length;
  const scored = valid.map(qc => ({
    qc,
    ep:  aiExpectedPower(qc),
    pw:  legendBazaWinProb(qc)
  }));

  // 3-baza expected-value lookahead
  // State: (bazasWon, bazasLost, cardsLeft) → value
  // Use: choose card that maximizes P(winning the hand)
  function handWinProb(ownWins, oppWins, remaining) {
    if (ownWins >= 2) return 1.0;
    if (oppWins >= 2) return 0.0;
    if (remaining === 0) return ownWins > oppWins ? 1.0 : ownWins === oppWins ? 0.5 : 0.0;
    return 0.5; // simplified: tie positions
  }

  let bestScore = -Infinity, chosen = scored[0].qc;

  for (const s of scored) {
    // If we play this card:
    const pWin  = s.pw;
    const pLose = 1 - pWin;
    const remaining = 3 - G.trickIdx - 1;

    // EV of playing this card
    let ev = 0;
    if (G.trickIdx === 0) {
      // After baza 1: if we win, we're ahead with 2 cards left
      // Try to play card closest to optimal information value
      // Ideal: win baza 1 to pressure, but save best for baza 3
      const winAhead  = handWinProb(tw+1, tl,   remaining);
      const loseBehind = handWinProb(tw,   tl+1, remaining);
      ev = pWin * winAhead + pLose * loseBehind;
      // Penalty for using a very strong card in baza 1 (save it)
      ev -= s.ep > 12 ? 0.15 : 0;
    } else if (G.trickIdx === 1) {
      // Baza 2: critical — win if possible, use min necessary
      const winAhead   = handWinProb(tw+1, tl,   remaining);
      const loseBehind = handWinProb(tw,   tl+1, remaining);
      ev = pWin * winAhead + pLose * loseBehind;
      // Prefer cheaper card if win prob is similar (save strong card for baza 3)
      if (tw === 1 && tl === 0) ev -= s.ep * 0.02;
    } else {
      // Baza 3: play best card available, no savings
      ev = pWin;
    }

    if (ev > bestScore) {
      bestScore = ev;
      chosen = s.qc;
    }
  }

  return hand.indexOf(chosen);
}


export function resetAIState() {
  _aiPending = false;
  _aiTurnToken = 0;
  _humanTrucoHistory = [];
  _humanEnvidoHistory = [];
  _humanBluffHistory = [];
  _opModel = {
    trucoBluffRate:0.20,
    envidoBluffRate:0.15,
    aggressionLevel:0.50,
    avgEnvidoMu:20,
    folds:0,
    calls:0,
    raises:0,
    handsPlayed:0,
    envidoSamples:[],
  };
}
