/* =========================================================================
   BESTIA - Server multiplayer (Node.js + Socket.io)
   Gestisce stanze, stato di gioco e turni bot.
   ========================================================================= */

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const Bestia  = require('./game.js');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// Servire i file statici (index.html, style.css, ui.js, game.js, carte/)
app.use(express.static(path.join(__dirname)));

// rooms: Map<codice, { code, setup, state, players, solo, autoPlayTimer, handoverTimer }>
// players[i]: { socketId, name, playerIndex }
const rooms = new Map();

/* ---- Utility ---- */
function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// Invia allo stato filtrato: nasconde le carte degli avversari (tranne nel turno alla cieca)
function stateForPlayer(state, playerIndex) {
  const blind = Bestia.isBlindRound(state) && (state.phase === 'bid' || state.phase === 'play');
  return {
    ...state,
    players: state.players.map((p, i) => {
      const copy = { ...p, hand: [...p.hand] };
      if (i === playerIndex) {
        // turno alla cieca: non vedo la mia carta
        if (blind) copy.hand = p.hand.map(() => null);
        return copy;
      }
      // avversari: visibili solo nel turno alla cieca
      if (!blind) copy.hand = p.hand.map(() => null);
      return copy;
    }),
  };
}

function emitStateToAll(room) {
  room.players.forEach(rp => {
    if (rp.socketId) {
      io.to(rp.socketId).emit('stateUpdate', stateForPlayer(room.state, rp.playerIndex));
    }
  });
  // Stampa gli ultimi log di gioco in console
  const state = room.state;
  if (state?.log?.length) {
    const last = state.log[state.log.length - 1];
    console.log(`[${room.code}] ${last}`);
  }
}

// Gestisce turni bot e avanzamento automatico tra le fasi
function driveRoom(room) {
  const state = room.state;
  if (!state) return;

  // Auto-avanzamento da handover → prossimo turno dopo 3s
  if (state.phase === 'handover') {
    if (room.handoverTimer) return;
    console.log(`[${room.code}] handover → prossimo turno in 3s`);
    room.handoverTimer = setTimeout(() => {
      room.handoverTimer = null;
      if (!room.state) { console.log(`[${room.code}] handover timer: room.state nullo`); return; }
      if (room.state.phase !== 'handover') { console.log(`[${room.code}] handover timer: fase cambiata (${room.state.phase})`); return; }
      try {
        Bestia.startRound(room.state);
        console.log(`[${room.code}] startRound ok → fase: ${room.state.phase}`);
        emitStateToAll(room);
        driveRoom(room);
      } catch(e) {
        console.error(`[${room.code}] ERRORE in startRound:`, e);
      }
    }, 3000);
    return;
  }
  if (room.handoverTimer) { clearTimeout(room.handoverTimer); room.handoverTimer = null; }

  if (state.phase === 'bid') {
    const p = state.players[state.turn];
    if (!p.isHuman) {
      setTimeout(() => {
        if (!room.state) return;
        Bestia.bid(state, Bestia.botBidDecision(state, p.id));
        emitStateToAll(room);
        driveRoom(room);
      }, 700);
      return;
    }

    // Turno umano: imposta timer auto-bid 30s
    const turnPlayer = state.turn;
    if (room.autoPlayTimer) { clearTimeout(room.autoPlayTimer); room.autoPlayTimer = null; }
    const deadline = Date.now() + 30000;
    const rp = room.players.find(r => r.playerIndex === turnPlayer);
    if (rp?.socketId) {
      io.to(rp.socketId).emit('turnStart', { deadline });
    }
    room.autoPlayTimer = setTimeout(() => {
      room.autoPlayTimer = null;
      if (!room.state || room.state.phase !== 'bid' || room.state.turn !== turnPlayer) return;
      const legal = Bestia.legalBids(room.state);
      const autoBid = legal.includes(0) ? 0 : legal[0];
      console.log(`[${room.code}] ⏱ AUTO-BID: ${room.state.players[turnPlayer].name} → ${autoBid}`);
      Bestia.bid(room.state, autoBid);
      emitStateToAll(room);
      driveRoom(room);
    }, 30000);
    return;
  }

  if (state.phase === 'play') {
    if (state.trickComplete) {
      if (room.autoPlayTimer) { clearTimeout(room.autoPlayTimer); room.autoPlayTimer = null; }
      setTimeout(() => {
        if (!room.state) return;
        Bestia.continueAfterTrick(state);
        emitStateToAll(room);
        driveRoom(room);
      }, 1500);
      return;
    }
    if (Bestia.isBlindRound(state) && state.trick.plays.length === 0) {
      if (room.autoPlayTimer) { clearTimeout(room.autoPlayTimer); room.autoPlayTimer = null; }
      Bestia.playRevealAll(state);
      emitStateToAll(room);
      driveRoom(room);
      return;
    }
    const p = state.players[state.turn];
    if (!p.isHuman) {
      if (room.autoPlayTimer) { clearTimeout(room.autoPlayTimer); room.autoPlayTimer = null; }
      setTimeout(() => {
        if (!room.state) return;
        const play = Bestia.botChoosePlay(state, p.id);
        Bestia.playCard(state, play.index, play.choice);
        emitStateToAll(room);
        driveRoom(room);
      }, 850);
      return;
    }

    // Turno umano: imposta timer auto-play 30s
    const turnPlayer = state.turn;
    if (room.autoPlayTimer) { clearTimeout(room.autoPlayTimer); room.autoPlayTimer = null; }
    const deadline = Date.now() + 30000;
    const rp = room.players.find(r => r.playerIndex === turnPlayer);
    if (rp?.socketId) {
      io.to(rp.socketId).emit('turnStart', { deadline });
    }
    room.autoPlayTimer = setTimeout(() => {
      room.autoPlayTimer = null;
      if (!room.state || room.state.phase !== 'play' || room.state.turn !== turnPlayer || room.state.trickComplete) return;
      const legal = Bestia.legalMoves(room.state, turnPlayer);
      const hand = room.state.players[turnPlayer].hand;
      const lowest = legal.reduce((best, i) => hand[i].strength < hand[best].strength ? i : best, legal[0]);
      console.log(`[${room.code}] ⏱ AUTO-PLAY: ${room.state.players[turnPlayer].name} supera i 30s`);
      Bestia.playCard(room.state, lowest);
      emitStateToAll(room);
      driveRoom(room);
    }, 30000);
    return;
  }
  // gameover: nulla da fare
}

function emitLobbyUpdate(room) {
  room.players.forEach(rp => {
    if (rp.socketId) {
      io.to(rp.socketId).emit('lobbyUpdate', {
        players: room.players.map(p => p.name),
        setup:   room.setup,
        isHost:  rp.playerIndex === 0,
      });
    }
  });
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  const rp = room.players.find(p => p.socketId === socket.id);
  if (!rp) return;
  rp.socketId = null;

  if (!room.state) {
    // Partita non ancora iniziata: rimuovi il giocatore dalla stanza
    room.players = room.players.filter(p => p.socketId !== null);
    // Riassegna playerIndex sequenzialmente
    room.players.forEach((p, i) => { p.playerIndex = i; });
    if (room.players.length === 0) {
      rooms.delete(code);
    } else {
      emitLobbyUpdate(room);
    }
  } else {
    // Partita in corso: notifica gli altri
    io.to(code).emit('playerDisconnected', { name: rp.name });
  }
  socket.data.roomCode = null;
  socket.data.playerIndex = null;
}

/* ---- Connessioni ---- */
io.on('connection', (socket) => {
  socket.data.roomCode    = null;
  socket.data.playerIndex = null;

  // Crea una nuova stanza (partita solo o multiplayer)
  socket.on('createRoom', ({ name, setup, solo }) => {
    if (!name || !name.trim()) { socket.emit('error', 'Inserisci un nome valido.'); return; }
    const code = randomCode();
    const room = {
      code,
      setup,
      state: null,
      players: [{ socketId: socket.id, name, playerIndex: 0 }],
      solo: !!solo,
      autoPlayTimer: null,
      handoverTimer: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode    = code;
    socket.data.playerIndex = 0;

    if (solo) {
      // Avvia subito con bot
      console.log(`[${code}] Nuova partita solo — ${name} (${setup.players} giocatori, ${setup.startCards} carte, ${setup.lives} vite)`);
      const state = Bestia.createGame(setup.players, setup.startCards, setup.lives);
      state.players[0].name    = name;
      state.players[0].isHuman = true;
      room.state = state;
      Bestia.startRound(state);
      emitStateToAll(room);
      driveRoom(room);
    } else {
      console.log(`[${code}] Stanza creata da ${name}`);
      socket.emit('roomCreated', { code, playerIndex: 0 });
      emitLobbyUpdate(room);
    }
  });

  // Unisciti a una stanza esistente
  socket.on('joinRoom', ({ name, code }) => {
    const upper = code.toUpperCase();
    const room  = rooms.get(upper);
    if (!room)           { socket.emit('error', 'Stanza non trovata');    return; }
    if (room.state)      { socket.emit('error', 'Partita già iniziata');  return; }
    if (room.solo)       { socket.emit('error', 'Stanza non disponibile'); return; }
    if (room.players.length >= room.setup.players) {
      socket.emit('error', 'Stanza piena'); return;
    }
    if (!name || !name.trim()) { socket.emit('error', 'Inserisci un nome valido.'); return; }
    if (room.players.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      socket.emit('error', 'Nome già in uso in questa stanza.'); return;
    }

    const playerIndex = room.players.length;
    room.players.push({ socketId: socket.id, name, playerIndex });
    socket.join(upper);
    socket.data.roomCode    = upper;
    socket.data.playerIndex = playerIndex;

    console.log(`[${upper}] ${name} si è unito (${room.players.length}/${room.setup.players})`);
    socket.emit('roomJoined', { code: upper, playerIndex });
    emitLobbyUpdate(room);
  });

  // L'host avvia la partita
  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.playerIndex !== 0 || room.state) return;

    const state = Bestia.createGame(room.setup.players, room.setup.startCards, room.setup.lives);
    // Assegna i nomi dei giocatori umani connessi
    room.players.forEach((rp, i) => {
      state.players[i].name    = rp.name;
      state.players[i].isHuman = true;
    });
    room.state = state;
    console.log(`[${room.code}] Partita avviata — giocatori: ${room.players.map(p => p.name).join(', ')}`);
    Bestia.startRound(state);
    emitStateToAll(room);
    driveRoom(room);
  });

  // Dichiarazione
  socket.on('bid', (value) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room?.state) return;
    const { state } = room;
    const pi = socket.data.playerIndex;
    if (state.phase !== 'bid' || state.turn !== pi) return;
    if (!Bestia.legalBids(state).includes(value)) return;
    console.log(`[${room.code}] ${state.players[pi].name} dichiara ${value}`);
    Bestia.bid(state, value);
    emitStateToAll(room);
    driveRoom(room);
  });

  // Gioca una carta
  socket.on('playCard', ({ index, assoChoice }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room?.state) return;
    const { state } = room;
    const pi = socket.data.playerIndex;
    if (state.phase !== 'play' || state.turn !== pi || state.trickComplete) return;
    if (!Bestia.legalMoves(state, pi).includes(index)) return;
    if (room.autoPlayTimer) { clearTimeout(room.autoPlayTimer); room.autoPlayTimer = null; }
    const card = state.players[pi].hand[index];
    console.log(`[${room.code}] ${state.players[pi].name} gioca ${card ? Bestia.cardLabel(card) : '?'}${assoChoice ? ' (' + assoChoice + ')' : ''}`);
    Bestia.playCard(state, index, assoChoice || undefined);
    emitStateToAll(room);
    driveRoom(room);
  });

  // Avanza al turno successivo (solo host)
  socket.on('nextRound', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room?.state) return;
    const { state } = room;
    if (state.phase !== 'handover') return;
    if (socket.data.playerIndex !== 0) return;
    Bestia.startRound(state);
    emitStateToAll(room);
    driveRoom(room);
  });

  // Torna al menu
  socket.on('backToMenu', () => leaveRoom(socket));

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    const rp = room?.players.find(p => p.socketId === socket.id);
    if (rp) console.log(`[${code}] ${rp.name} disconnesso`);
    leaveRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅  Server Bestia avviato → http://localhost:${PORT}`);
});
