// Test del motore: simula tante partite complete e verifica gli invarianti.
const fs = require('fs');
global.window = {};
eval(fs.readFileSync(__dirname + '/game.js', 'utf8'));
const B = global.window.Bestia;

const GAMES = 2000;
let totRounds = 0, finished = 0, maxRounds = 0;

for (let g = 0; g < GAMES; g++) {
  // varia giocatori (2..6) e carte iniziali per stressare le combinazioni
  const numPlayers = 2 + (g % 5);
  const startCards = 1 + (g % 8);
  let state = B.createGame(numPlayers, startCards);
  let guardGame = 0;

  while (state.phase !== 'gameover') {
    B.startRound(state);
    if (state.phase === 'gameover') break;
    totRounds++;

    // dichiarazioni
    while (state.phase === 'bid') {
      const pid = state.turn;
      const choice = B.botBidDecision(state, pid);
      const legal = B.legalBids(state);
      if (!legal.includes(choice)) throw new Error(`Bid illegale ${choice} (legali: ${legal})`);
      B.bid(state, choice);
    }

    // verifica "vietato pareggiare": somma dichiarazioni != carte del turno
    const active = B.activePlayers(state);
    const sumBids = active.reduce((a, p) => a + p.bid, 0);
    if (sumBids === state.cardsThisRound) {
      throw new Error(`Vietato pareggiare violato: somma ${sumBids} == ${state.cardsThisRound}`);
    }

    // gioco
    let guard = 0;
    while (state.phase === 'play') {
      if (state.trickComplete) { B.continueAfterTrick(state); continue; }
      const pid = state.turn;
      const play = B.botChoosePlay(state, pid);
      const legal = B.legalMoves(state, pid);
      if (!legal.includes(play.index)) throw new Error('Mossa di gioco illegale!');
      B.playCard(state, play.index, play.choice);
      if (++guard > 200) throw new Error('Loop infinito nel gioco!');
    }

    // le prese del turno devono sommare al numero di carte distribuite
    const sumTricks = active.reduce((a, p) => a + p.tricks, 0);
    if (sumTricks !== state.cardsThisRound) {
      throw new Error(`Prese ${sumTricks} != ${state.cardsThisRound}`);
    }

    if (++guardGame > 1000) throw new Error('Partita che non finisce!');
  }

  if (state.winner != null) finished++;
  maxRounds = Math.max(maxRounds, state.roundNumber);
}

console.log('OK — nessun crash, nessuna mossa/dichiarazione illegale.');
console.log(`Partite: ${GAMES} | con vincitore: ${finished} | pareggi (tutti out): ${GAMES - finished}`);
console.log(`Turni medi a partita: ${(totRounds / GAMES).toFixed(1)} | max turni in una partita: ${maxRounds}`);
