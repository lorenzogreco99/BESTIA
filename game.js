/* =========================================================================
   BESTIA - Motore di gioco (logica pura, niente DOM)

   Regole implementate:
   - Mazzo da 40 carte. Valore 1..10 (Donna=8, Cavallo=9, Re=10).
   - Prende la mano la carta più forte: conta PRIMA il seme (oro > coppe >
     spade > bastoni) e POI il valore. Quindi qualsiasi carta di oro batte
     qualsiasi carta di coppe; a parità di seme vince il valore più alto.
   - Nessuna briscola, nessun obbligo di rispondere al seme (RULES.followSuit).
   - Turni a carte calanti: 5, 4, 3, 2, 1, poi si ricomincia. Il mazziere ruota.
   - Appena distribuite, partendo dal mazziere, ognuno dichiara quante mani
     pensa di prendere. "Vietato pareggiare": l'ultimo non può far sì che la
     somma delle dichiarazioni sia uguale al numero di mani del turno.
   - Apre il mazziere; chi prende una mano apre la successiva.
   - Punteggio: si parte con 5 vite; a fine turno si perdono |dichiarate-prese|
     vite. A 0 vite si è eliminati. Vince l'ultimo rimasto.
   ========================================================================= */

const RULES = {
  startLives: 5,
  defaultPlayers: 3,           // usati se non specificati a createGame
  defaultStartCards: 5,        // carte del primo turno (poi si cala fino a 1)
  noTieRule: true,             // vietato pareggiare per l'ultimo dichiarante
  followSuit: false,           // nessun obbligo di seguire il seme
  blindLastCard: true,         // turno da 1 carta "alla cieca": vedi le altrui, non la tua
};

const BOT_NAMES = ['Anna', 'Marco', 'Lucia', 'Giulio', 'Sara'];

// Semi dal più forte al più debole (spareggio a parità di valore).
const SUITS = ['oro', 'coppe', 'spade', 'bastoni'];

const SUIT_INFO = {
  oro:     { letter: 'O', label: 'Oro',     color: '#d4a017', rank: 3 },
  coppe:   { letter: 'C', label: 'Coppe',   color: '#c0392b', rank: 2 },
  spade:   { letter: 'S', label: 'Spade',   color: '#2c3e50', rank: 1 },
  bastoni: { letter: 'B', label: 'Bastoni', color: '#1e8449', rank: 0 },
};

// code = come si mostra; value = forza numerica (1..10).
const RANK_INFO = [
  { code: '1',  name: 'Asso',    value: 1 },
  { code: '2',  name: 'Due',     value: 2 },
  { code: '3',  name: 'Tre',     value: 3 },
  { code: '4',  name: 'Quattro', value: 4 },
  { code: '5',  name: 'Cinque',  value: 5 },
  { code: '6',  name: 'Sei',     value: 6 },
  { code: '7',  name: 'Sette',   value: 7 },
  { code: 'Do', name: 'Donna',   value: 8 },
  { code: 'Ca', name: 'Cavallo', value: 9 },
  { code: 'Re', name: 'Re',      value: 10 },
];

/* ---------------------------- Utility carte ---------------------------- */

// Forza assoluta unica per ordinare le 40 carte: PRIMA il seme, poi il valore.
// (es. l'Asso di oro batte il Re di coppe, perché oro > coppe.)
function cardStrength(value, suit) {
  return SUIT_INFO[suit].rank * 100 + value;
}

// L'Asso di oro è un jolly: chi lo gioca sceglie se vale il MASSIMO (batte
// tutto) o il MINIMO (perde con tutto). Valori fuori scala rispetto a 1..310.
const ASSO_MAX = 9999, ASSO_MIN = -9999;
function isAssoOro(card) { return card.suit === 'oro' && card.value === 1; }

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const r of RANK_INFO) {
      deck.push({
        suit, code: r.code, name: r.name, value: r.value,
        strength: cardStrength(r.value, suit), id: suit + '-' + r.code,
      });
    }
  }
  return deck;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardLabel(c) {
  return c.code + SUIT_INFO[c.suit].letter;
}

function cardBeats(a, b) {
  return a.strength > b.strength;
}

// Vince la giocata con forza EFFETTIVA più alta (eff tiene conto del jolly).
function winningPlay(plays) {
  return plays.reduce((best, cur) => (cur.eff > best.eff ? cur : best));
}

/* ---------------------------- Creazione partita ---------------------------- */

function createGame(numPlayers, startCards, startLives) {
  numPlayers = numPlayers || RULES.defaultPlayers;
  startCards = startCards || RULES.defaultStartCards;
  startLives = startLives || RULES.startLives;
  // il primo turno non può superare il mazzo: carte * giocatori <= 40
  startCards = Math.max(1, Math.min(startCards, Math.floor(40 / numPlayers)));

  const names = ['Tu'];
  for (let i = 0; i < numPlayers - 1; i++) names.push(BOT_NAMES[i % BOT_NAMES.length]);

  const players = names.map((n, i) => ({
    id: i,
    name: n,
    isHuman: i === 0,
    lives: startLives,
    hand: [],
    bid: null,
    tricks: 0,
    lostThisRound: 0,
    status: 'active', // 'active' | 'out'
  }));

  // sequenza dei turni: dalle carte iniziali giù fino a 1, poi si ripete
  const roundSizes = [];
  for (let c = startCards; c >= 1; c--) roundSizes.push(c);

  return {
    players,
    n: players.length,
    roundSizes,
    dealer: Math.floor(Math.random() * players.length),
    firstRound: true,
    deck: [],
    cardsThisRound: 0,
    pot: 0, // non usato (lasciato per compatibilità UI)
    phase: 'ready', // ready -> bid -> play -> handover -> gameover
    turn: 0,
    bidCount: 0,
    trick: { plays: [], leader: null, winner: null },
    trickNumber: 0,
    trickComplete: false,
    roundComplete: false,
    lastResult: null,
    roundNumber: 0,
    winner: null,
    log: [],
  };
}

function log(state, msg) { state.log.push(msg); }

function activePlayers(state) {
  return state.players.filter(p => p.status === 'active');
}

function nextActiveFrom(state, from) {
  let i = (from + 1) % state.n;
  let guard = 0;
  while (state.players[i].status !== 'active') {
    i = (i + 1) % state.n;
    if (++guard > state.n) return from;
  }
  return i;
}

/* ---------------------------- Avvio turno ---------------------------- */

function startRound(state) {
  if (activePlayers(state).length <= 1) {
    endGame(state);
    return state;
  }

  if (!state.firstRound) state.dealer = nextActiveFrom(state, state.dealer);
  state.firstRound = false;

  state.roundNumber++;
  const seqIdx = (state.roundNumber - 1) % state.roundSizes.length;
  state.cardsThisRound = state.roundSizes[seqIdx];

  state.players.forEach(p => { p.hand = []; p.bid = null; p.tricks = 0; p.lostThisRound = 0; });

  // distribuzione (solo ai giocatori attivi)
  state.deck = shuffle(makeDeck());
  for (let k = 0; k < state.cardsThisRound; k++) {
    activePlayers(state).forEach(p => p.hand.push(state.deck.pop()));
  }
  // ordina le mani per seme e valore (solo visualizzazione)
  state.players.forEach(p => p.hand.sort((a, b) =>
    a.suit === b.suit ? b.value - a.value : SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)));

  // fase dichiarazioni: parte il mazziere
  state.phase = 'bid';
  state.turn = state.dealer;
  state.bidCount = 0;
  state.trick = { plays: [], leader: null, winner: null };
  state.trickNumber = 0;
  state.trickComplete = false;
  state.roundComplete = false;
  state.lastResult = null;

  log(state, `— Turno ${state.roundNumber} (${state.cardsThisRound} carte). ` +
    `Mazziere: ${state.players[state.dealer].name}.`);
  return state;
}

/* ---------------------------- Dichiarazioni ---------------------------- */

// valore vietato all'ultimo dichiarante (regola del "vietato pareggiare"),
// oppure null se non c'è vincolo per chi deve dichiarare ora.
function forbiddenBidValue(state) {
  if (!RULES.noTieRule) return null;
  const active = activePlayers(state);
  if (state.bidCount !== active.length - 1) return null; // non è l'ultimo
  const sumPrev = active.reduce((a, p) => a + (p.bid || 0), 0);
  const f = state.cardsThisRound - sumPrev;
  if (f < 0 || f > state.cardsThisRound) return null;
  return f;
}

function legalBids(state) {
  const f = forbiddenBidValue(state);
  const arr = [];
  for (let v = 0; v <= state.cardsThisRound; v++) if (v !== f) arr.push(v);
  return arr;
}

function bid(state, value) {
  const p = state.players[state.turn];
  p.bid = value;
  state.bidCount++;
  log(state, `${p.name} dichiara ${value}.`);
  if (state.bidCount >= activePlayers(state).length) {
    startPlay(state);
  } else {
    state.turn = nextActiveFrom(state, state.turn);
  }
  return state;
}

function startPlay(state) {
  state.phase = 'play';
  state.trickNumber = 1;
  state.trick = { plays: [], leader: state.dealer, winner: null };
  state.turn = state.dealer; // apre il mazziere
  log(state, `Si gioca! Apre ${state.players[state.dealer].name}.`);
}

/* ---------------------------- Gioco delle mani ---------------------------- */

function legalMoves(state, pid) {
  const hand = state.players[pid].hand;
  const all = hand.map((_, i) => i);
  if (!RULES.followSuit || state.trick.plays.length === 0) return all;
  const led = state.trick.plays[0].card.suit;
  const follow = all.filter(i => hand[i].suit === led);
  return follow.length ? follow : all;
}

// choice: 'max' | 'min' — usato solo se la carta è l'Asso di oro (non al buio).
function playCard(state, cardIndex, choice) {
  const p = state.players[state.turn];
  const card = p.hand.splice(cardIndex, 1)[0];
  let eff = card.strength;
  let assoMode = null;
  if (isAssoOro(card)) {
    if (isBlindRound(state)) {
      // al buio non vedi la carta: il jolly segue la tua dichiarazione
      // (dici 0 -> vale il minimo; dici 1 -> vale il massimo).
      assoMode = p.bid >= 1 ? 'max' : 'min';
    } else if (choice) {
      assoMode = choice;
    }
    if (assoMode) eff = assoMode === 'max' ? ASSO_MAX : ASSO_MIN;
  }
  state.trick.plays.push({ player: p.id, card, eff, assoMode });
  log(state, `${p.name} gioca ${cardLabel(card)}${assoMode ? ' [' + assoMode + ']' : ''}.`);

  const activeCount = activePlayers(state).length;
  if (state.trick.plays.length >= activeCount) {
    const win = winningPlay(state.trick.plays);
    state.trick.winner = win.player;
    state.players[win.player].tricks++;
    state.trickComplete = true;
    log(state, `Mano #${state.trickNumber} a ${state.players[win.player].name}.`);
    if (state.trickNumber >= state.cardsThisRound) state.roundComplete = true;
  } else {
    state.turn = nextActiveFrom(state, state.turn);
  }
  return state;
}

// Turno alla cieca: dopo le dichiarazioni tutti buttano insieme la loro
// unica carta (nessuna giocata a turno).
function playRevealAll(state) {
  let guard = 0;
  while (state.phase === 'play' && !state.trickComplete) {
    playCard(state, 0); // ogni giocatore ha una sola carta
    if (++guard > state.n) break;
  }
  return state;
}

function continueAfterTrick(state) {
  if (state.roundComplete) {
    resolveRound(state);
    return state;
  }
  const winner = state.trick.winner;
  state.trickNumber++;
  state.trick = { plays: [], leader: winner, winner: null };
  state.turn = winner;
  state.trickComplete = false;
  return state;
}

function resolveRound(state) {
  const results = [];
  activePlayers(state).forEach(p => {
    const diff = Math.abs(p.bid - p.tricks);
    p.lostThisRound = diff;
    p.lives -= diff;
    let eliminated = false;
    if (p.lives <= 0) { p.lives = 0; p.status = 'out'; eliminated = true; }
    results.push({ id: p.id, bid: p.bid, tricks: p.tricks, lost: diff, eliminated });
    log(state, `${p.name}: dette ${p.bid}, prese ${p.tricks}` +
      (diff ? ` → -${diff} vite (${p.lives})` : ` → indovinato! (${p.lives})`) +
      (eliminated ? ' · ELIMINATO 🐗' : ''));
  });
  state.lastResult = { type: 'round', results };

  if (activePlayers(state).length <= 1) {
    endGame(state);
  } else {
    state.phase = 'handover';
  }
  return state;
}

function endGame(state) {
  const left = activePlayers(state);
  state.winner = left.length ? left[0].id : null;
  state.phase = 'gameover';
  log(state, state.winner != null
    ? `🏆 Vince ${state.players[state.winner].name}!`
    : 'Tutti eliminati nello stesso turno!');
}

/* ---------------------------- Intelligenza dei bot ---------------------------- */

// stima quante mani prenderà una mano di carte
function estimateTricks(state, hand) {
  const fullDeck = makeDeck();
  const unseen = 40 - hand.length;
  const opponents = activePlayers(state).length - 1;
  let exp = 0;
  for (const c of hand) {
    if (isAssoOro(c)) { exp += 1; continue; } // jolly: vale una presa garantita (MAX)
    const globalWeaker = fullDeck.filter(d => d.strength < c.strength).length;
    const handWeaker = hand.filter(h => h.strength < c.strength).length;
    const weakerUnseen = globalWeaker - handWeaker;
    exp += Math.pow(weakerUnseen / unseen, opponents);
  }
  return exp;
}

// Turno "alla cieca": ognuno ha 1 carta e vede quelle degli altri, non la propria.
function isBlindRound(state) {
  return RULES.blindLastCard && state.cardsThisRound === 1;
}

// Dichiarazione del bot al buio: vede le carte avversarie, stima la propria.
function botBidBlind(state, pid) {
  const others = activePlayers(state).filter(p => p.id !== pid);
  const seen = others.map(p => p.hand[0]).filter(Boolean);
  const maxSeen = seen.reduce((m, c) => Math.max(m, c.strength), -1);
  const seenIds = new Set(seen.map(c => c.id));
  const unseen = makeDeck().filter(c => !seenIds.has(c.id)); // include la propria, ignota
  const stronger = unseen.filter(c => c.strength > maxSeen).length;
  const pWin = stronger / unseen.length;

  let b = pWin >= 0.5 ? 1 : 0;
  if (forbiddenBidValue(state) === b) b = b === 1 ? 0 : 1; // rispetta il "vietato pareggiare"
  return b;
}

function botBidDecision(state, pid) {
  if (isBlindRound(state)) return botBidBlind(state, pid);
  const p = state.players[pid];
  const est = estimateTricks(state, p.hand);
  let b = Math.max(0, Math.min(state.cardsThisRound, Math.round(est)));
  const f = forbiddenBidValue(state);
  if (f !== null && b === f) {
    // scegli il valore consentito più vicino alla stima
    const up = f + 1, down = f - 1;
    if (est >= f && up <= state.cardsThisRound) b = up;
    else if (down >= 0) b = down;
    else b = up <= state.cardsThisRound ? up : down;
  }
  return b;
}

// Restituisce { index, choice } dove choice ('max'|'min') vale solo per il jolly.
function botChoosePlay(state, pid) {
  const hand = state.players[pid].hand;
  const p = state.players[pid];

  if (isBlindRound(state)) return { index: 0 }; // 1 carta, nessuna scelta

  const idxs = hand.map((_, i) => i);
  const byStr = [...idxs].sort((a, b) => hand[a].strength - hand[b].strength); // crescente
  const lowest = byStr[0];
  const highest = byStr[byStr.length - 1];
  const assoIdx = hand.findIndex(isAssoOro);
  const hasAsso = assoIdx >= 0;

  const need = p.bid - p.tricks;       // mani ancora desiderate
  const tricksLeft = hand.length;      // mani rimaste (questa compresa)
  const leading = state.trick.plays.length === 0;
  const cur = leading ? -Infinity : winningPlay(state.trick.plays).eff;

  if (need <= 0) {
    // voglio PERDERE: il jolly lo scarico come MINIMO (perdita garantita)
    if (hasAsso) return { index: assoIdx, choice: 'min' };
    if (leading) return { index: lowest };
    const losers = byStr.filter(i => hand[i].strength < cur);
    return { index: losers.length ? losers[losers.length - 1] : lowest };
  }

  // voglio VINCERE mani (need > 0)
  if (leading) {
    if (need >= tricksLeft && hasAsso) return { index: assoIdx, choice: 'max' };
    return { index: highest };
  }
  const winners = byStr.filter(i => !isAssoOro(hand[i]) && hand[i].strength > cur);
  if (winners.length) return { index: winners[0] };       // vinco a basso costo
  if (hasAsso) return { index: assoIdx, choice: 'max' };  // garantisco col jolly
  return { index: lowest };                               // rinuncio, scarto la più bassa
}

/* ---------------------------- Esporta ---------------------------- */

const Bestia = {
  RULES, SUITS, SUIT_INFO, RANK_INFO,
  createGame, startRound, bid, playCard, playRevealAll, continueAfterTrick,
  legalMoves, legalBids, forbiddenBidValue,
  botBidDecision, botChoosePlay, estimateTricks,
  cardLabel, winningPlay, cardBeats, activePlayers, isBlindRound, isAssoOro,
};

// Funziona sia nel browser che in Node.js
if (typeof window !== 'undefined') window.Bestia = Bestia;
if (typeof module !== 'undefined') module.exports = Bestia;
