/* =========================================================================
   BESTIA - Interfaccia (rendering + gestione turni) — versione multiplayer
   Comunica col server via Socket.io. Il server esegue la logica di game.js.
   ========================================================================= */

let state = null;
const setup = { players: 3, startCards: 5, lives: 5 };
let pendingAssoIndex = null;
let myPlayerIndex    = 0;
let isHost           = false;

const socket = io();

const $ = id => document.getElementById(id);

const setupEl        = $('setup');
const waitingEl      = $('waiting');
const gameEl         = $('game');
const setupPlayersEl = $('setup-players');
const setupCardsEl   = $('setup-cards');
const setupLivesEl   = $('setup-lives');
const setupNoteEl    = $('setup-note');
const infoEl         = $('info');
const opponentsEl    = $('opponents');
const roundinfoEl    = $('roundinfo');
const trickEl        = $('trick');
const trickPopupEl   = $('trick-popup');
const myinfoEl       = $('myinfo');
const myhandEl       = $('myhand');
const actionsEl      = $('actions');
const logEl          = $('log');
const bannerEl       = $('banner');

/* ---- Utility schermo ---- */
function showScreen(el) {
  [setupEl, waitingEl, gameEl].forEach(e => e?.classList.add('hidden'));
  el?.classList.remove('hidden');
}

/* ---- Rilevamento immagini carte ---- */
let USE_IMAGES = false;
let IMG_EXT = 'png';
(function detectImages() {
  const exts = ['png', 'jpg', 'jpeg', 'svg'];
  let i = 0;
  (function tryNext() {
    if (i >= exts.length) { USE_IMAGES = false; return; }
    const test = new Image();
    test.onload = () => { USE_IMAGES = true; IMG_EXT = exts[i]; if (state) render(); };
    test.onerror = () => { i++; tryNext(); };
    test.src = 'carte/oro_10.' + exts[i];
  })();
})();

function textCard(suit, code) {
  const s = Bestia.SUIT_INFO[suit];
  return `<div class="card" style="color:${s.color}">` +
    `<span class="rank">${code}</span><span class="suit">${s.letter}</span></div>`;
}
function onCardImgError(img) {
  const tmp = document.createElement('span');
  tmp.innerHTML = textCard(img.dataset.suit, img.dataset.code);
  img.replaceWith(tmp.firstChild);
}
function onCardBackError(img) {
  const d = document.createElement('div');
  d.className = 'card back';
  d.textContent = '?';
  img.replaceWith(d);
}
function oppBackHTML() {
  if (!USE_IMAGES) return '<span class="cardback"></span>';
  return `<img class="cardback-img" src="carte/retro.${IMG_EXT}" alt="" onerror="onOppBackError(this)">`;
}
function onOppBackError(img) {
  const s = document.createElement('span');
  s.className = 'cardback';
  img.replaceWith(s);
}

/* ---- Setup ---- */
const MIN_PLAYERS = 2, MAX_PLAYERS = 6;
const MIN_LIVES = 3, MAX_LIVES = 8;
function maxCards(players) { return Math.min(5, Math.floor(40 / players)); }

function makeStepper(container, getValue, setValue, min, max) {
  container.innerHTML = '';
  const btn = (label, delta) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'stepbtn';
    b.onclick = () => {
      const next = Math.min(max, Math.max(min, getValue() + delta));
      setValue(next);
      renderSetup();
    };
    return b;
  };
  const val = document.createElement('span');
  val.className = 'stepval';
  val.textContent = getValue();
  container.appendChild(btn('−', -1));
  container.appendChild(val);
  container.appendChild(btn('+', +1));
}

function renderSetup() {
  makeStepper(setupPlayersEl,
    () => setup.players,
    v => { setup.players = v; setup.startCards = Math.min(setup.startCards, maxCards(v)); },
    MIN_PLAYERS, MAX_PLAYERS);

  makeStepper(setupCardsEl,
    () => setup.startCards,
    v => { setup.startCards = v; },
    1, maxCards(setup.players));

  makeStepper(setupLivesEl,
    () => setup.lives,
    v => { setup.lives = v; },
    MIN_LIVES, MAX_LIVES);

  setupNoteEl.textContent =
    `Tu + ${setup.players - 1} avversari · ${setup.lives} vite · ` +
    `si parte da ${setup.startCards} cart${setup.startCards === 1 ? 'a' : 'e'} e si cala fino a 1.`;
}

function getPlayerName() {
  return ($('player-name')?.value || '').trim();
}

function showSetupNote(msg) {
  setupNoteEl.textContent = msg;
  setupNoteEl.style.color = '#e74c3c';
}

/* ---- Handler pulsanti setup ---- */
$('setup-start').onclick = () => {
  const name = getPlayerName();
  if (!name) { showSetupNote('Inserisci il tuo nome per giocare.'); return; }
  setupNoteEl.textContent = '';
  socket.emit('createRoom', { name, setup, solo: true });
};
$('setup-create').onclick = () => {
  const name = getPlayerName();
  if (!name) { showSetupNote('Inserisci il tuo nome per creare una stanza.'); return; }
  setupNoteEl.textContent = '';
  socket.emit('createRoom', { name, setup, solo: false });
};
$('btn-join').onclick = () => {
  const code = ($('room-code-input')?.value || '').trim().toUpperCase();
  if (!code) return;
  const name = getPlayerName();
  if (!name) { showSetupNote('Inserisci il tuo nome per unirti.'); return; }
  setupNoteEl.textContent = '';
  socket.emit('joinRoom', { name, code });
};
$('btn-start-room').onclick = () => socket.emit('startGame');
$('btn-leave').onclick = () => {
  socket.emit('backToMenu');
  showScreen(setupEl);
  renderSetup();
};

/* ---- Socket events ---- */
socket.on('connect', () => {
  showScreen(setupEl);
  renderSetup();
});

socket.on('roomCreated', ({ code }) => {
  myPlayerIndex = 0;
  isHost = true;
  $('room-code-display').textContent = code;
  showScreen(waitingEl);
});

socket.on('roomJoined', ({ code, playerIndex }) => {
  myPlayerIndex = playerIndex;
  isHost = false;
  $('room-code-display').textContent = code;
  showScreen(waitingEl);
});

socket.on('lobbyUpdate', ({ players, setup: roomSetup, isHost: h }) => {
  isHost = h;
  if (roomSetup) Object.assign(setup, roomSetup);
  $('waiting-setup').textContent =
    `${setup.players} giocatori · ${setup.startCards} carte · ${setup.lives} vite`;
  $('waiting-players').innerHTML = players
    .map((n, i) => `<div class="waiting-player">${i === 0 ? '👑' : '👤'} <b>${n}</b></div>`)
    .join('');
  $('btn-start-room').classList.toggle('hidden', !isHost);
  $('waiting-note').textContent = isHost
    ? `${players.length} / ${setup.players} giocatori connessi — premi "Inizia partita" quando siete pronti.`
    : `${players.length} / ${setup.players} — in attesa che l'host avvii la partita…`;
});

socket.on('stateUpdate', (newState) => {
  state = newState;
  if (state.phase !== 'play' || state.turn !== myPlayerIndex || state.trickComplete) {
    stopCountdown();
  }
  showScreen(gameEl);
  render();
});

socket.on('error', (msg) => {
  alert('Errore: ' + msg);
});

/* ---- Countdown auto-play ---- */
let countdownDeadline = null;
let countdownInterval = null;
let lastCountNum = null;
const countdownEl = document.getElementById('countdown-popup');

function startCountdown(deadline) {
  countdownDeadline = deadline;
  lastCountNum = null;
  clearInterval(countdownInterval);
  countdownInterval = setInterval(tickCountdown, 250);
}

function stopCountdown() {
  countdownDeadline = null;
  clearInterval(countdownInterval);
  countdownInterval = null;
  lastCountNum = null;
  if (countdownEl) { countdownEl.classList.remove('show'); countdownEl.textContent = ''; }
}

function tickCountdown() {
  if (!countdownDeadline) return;
  const rem = Math.ceil((countdownDeadline - Date.now()) / 1000);
  if (rem <= 0) { stopCountdown(); return; }
  if (rem <= 5) {
    if (rem !== lastCountNum) {
      lastCountNum = rem;
      countdownEl.textContent = rem;
      countdownEl.classList.remove('show');
      void countdownEl.offsetWidth; // force reflow
      countdownEl.classList.add('show');
    }
  }
}

socket.on('turnStart', ({ deadline }) => {
  startCountdown(deadline);
});

socket.on('playerDisconnected', ({ name }) => {
  bannerEl.textContent = `⚠ ${name} si è disconnesso`;
  bannerEl.classList.add('show');
  setTimeout(() => {
    if (bannerEl.textContent.startsWith('⚠')) bannerEl.classList.remove('show');
  }, 3000);
});

/* ---- Rendering ---- */
function cardHTML(c) {
  if (!c) return oppBackHTML();
  if (!USE_IMAGES) return textCard(c.suit, c.code);
  const s = Bestia.SUIT_INFO[c.suit];
  return `<img class="card-img" src="carte/${c.suit}_${c.value}.${IMG_EXT}" ` +
    `alt="${c.code}${s.letter}" data-suit="${c.suit}" data-code="${c.code}" ` +
    `onerror="onCardImgError(this)">`;
}
function cardBackHTML() {
  if (!USE_IMAGES) return '<div class="card back">?</div>';
  return `<img class="card-img back-img" src="carte/retro.${IMG_EXT}" alt="?" onerror="onCardBackError(this)">`;
}

function isBlind() {
  return Bestia.isBlindRound(state) && (state.phase === 'bid' || state.phase === 'play');
}
function bidLabel(p) {
  if (p.status === 'out') return '🐗 fuori';
  if (state.phase === 'bid' || state.phase === 'ready') {
    return p.bid == null ? 'dice: …' : `dice: ${p.bid}`;
  }
  return `${p.tricks}/${p.bid}`;
}
function livesHTML(p) {
  return '❤'.repeat(p.lives) + (p.lives === 0 ? '—' : '');
}

function render() {
  const blind = isBlind();

  infoEl.innerHTML =
    `Turno #${state.roundNumber} · <b>${state.cardsThisRound || '?'}</b> carte ` +
    (blind ? '· <b>alla cieca 👁</b> ' : '') +
    `&nbsp;|&nbsp; Mazziere: ${state.players[state.dealer]?.name || '—'}`;

  // Avversari
  opponentsEl.innerHTML = '';
  state.players.forEach(p => {
    if (p.id === myPlayerIndex) return;
    const active = state.turn === p.id && (state.phase === 'bid' || state.phase === 'play');
    const div = document.createElement('div');
    div.className = 'player' + (active ? ' active' : '') + (p.status === 'out' ? ' eliminated' : '');
    const handHTML = p.hand.map(c => c ? cardHTML(c) : oppBackHTML()).join('');
    const revealed = blind && p.hand.some(c => c);
    div.innerHTML =
      `<div class="pname">${p.name}</div>` +
      `<div class="plives">${livesHTML(p)}</div>` +
      `<div class="pstatus">${bidLabel(p)}</div>` +
      `<div class="phand${revealed ? ' revealed' : ''}">${handHTML}</div>`;
    opponentsEl.appendChild(div);
  });

  
  trickEl.innerHTML = state.trick.plays.map(pl => {
    const isWinner = state.trickComplete && state.trick.winner === pl.player;
    const badge = pl.assoMode
      ? `<div class="assobadge">${pl.assoMode === 'max' ? 'MAX' : 'MIN'}</div>` : '';
    return `<div class="trickcard${isWinner ? ' winner' : ''}">` +
      `<div class="who">${state.players[pl.player].name}</div>${cardHTML(pl.card)}${badge}</div>`;
  }).join('');

  if (state.trickComplete && state.trick.winner != null) {
    const w = state.players[state.trick.winner];
    trickPopupEl.textContent = `${w.name}  ${w.tricks} / ${w.bid ?? '?'}`;
    trickPopupEl.classList.add('show');
  } else {
    trickPopupEl.classList.remove('show');
  }

  const me = state.players[myPlayerIndex];
  myinfoEl.innerHTML = `<b>${me.name}</b> · vite: ${livesHTML(me) || '—'} · ${bidLabel(me)}`;

  const canPlay = state.phase === 'play' && state.turn === myPlayerIndex
    && !state.trickComplete && pendingAssoIndex === null;
  const legal = canPlay ? Bestia.legalMoves(state, myPlayerIndex) : [];
  myhandEl.innerHTML = '';
  me.hand.forEach((c, i) => {
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    slot.innerHTML = c ? cardHTML(c) : cardBackHTML();
    if (canPlay) {
      if (legal.includes(i)) { slot.classList.add('playable'); slot.onclick = () => onPlay(i); }
      else slot.classList.add('disabled');
    }
    myhandEl.appendChild(slot);
  });

  renderActions();
  renderBanner();

  logEl.innerHTML = state.log.slice(-14).map(l => `<div>${l}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

function renderActions() {
  actionsEl.innerHTML = '';

  if (pendingAssoIndex !== null) {
    const lab = document.createElement('span');
    lab.className = 'bidlabel';
    lab.textContent = "L'asso d'oro vale:";
    actionsEl.appendChild(lab);
    addButton('MAX', () => playAsso('max'), 'bidbtn');
    addButton('MIN', () => playAsso('min'), 'bidbtn secondary');
    return;
  }

  if (state.phase === 'bid' && state.turn === myPlayerIndex) {
    const legal = Bestia.legalBids(state);
    const lab = document.createElement('span');
    lab.className = 'bidlabel';
    lab.textContent = 'Quante mani prendi?';
    actionsEl.appendChild(lab);
    for (let v = 0; v <= state.cardsThisRound; v++) {
      const ok = legal.includes(v);
      const b = addButton(String(v), () => socket.emit('bid', v), 'bidbtn');
      if (!ok) { b.disabled = true; b.title = 'Vietato pareggiare'; b.classList.add('forbidden'); }
    }
  } else if (state.phase === 'handover' && myPlayerIndex === 0) {
    // auto-avanzamento gestito dal server
  } else if (state.phase === 'gameover') {
    addButton('Nuova partita', () => {
      socket.emit('backToMenu');
      showScreen(setupEl);
      renderSetup();
    });
  }
}

function addButton(label, onclick, cls = '') {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = cls;
  b.onclick = onclick;
  actionsEl.appendChild(b);
  return b;
}

function renderBanner() {
  bannerEl.classList.remove('show');
  if (pendingAssoIndex !== null) {
    bannerEl.textContent = "Asso d'oro: vale il massimo (batte tutto) o il minimo (perde con tutto)?";
    bannerEl.classList.add('show');
    return;
  }
  if (state.phase === 'gameover') {
    bannerEl.textContent = state.winner != null
      ? `🏆 Ha vinto ${state.players[state.winner].name}!` : 'Tutti eliminati!';
    bannerEl.classList.add('show');
  } else if (state.phase === 'handover' && state.lastResult) {
    const r = state.lastResult.results;
    bannerEl.textContent = 'Fine turno — ' +
      r.map(x => `${state.players[x.id].name}: ${x.lost === 0 ? 'ok' : '-' + x.lost}`).join('  ·  ');
    bannerEl.classList.add('show');
  } else if (state.phase === 'bid' && state.turn === myPlayerIndex) {
    bannerEl.textContent = isBlind()
      ? '👁 Alla cieca: guarda le carte degli altri e dichiara senza vedere la tua.'
      : 'Tocca a te dichiarare.';
    bannerEl.classList.add('show');
  } else if (state.phase === 'play' && state.turn === myPlayerIndex && !state.trickComplete) {
    bannerEl.textContent = isBlind() ? 'Gioca la tua carta coperta.' : 'Tocca a te: gioca una carta.';
    bannerEl.classList.add('show');
  }
}

/* ---- Azioni umano ---- */
function onPlay(i) {
  if (state.phase !== 'play' || state.turn !== myPlayerIndex || state.trickComplete) return;
  if (pendingAssoIndex !== null) return;
  const me = state.players[myPlayerIndex];
  if (!Bestia.legalMoves(state, myPlayerIndex).includes(i)) return;
  if (!isBlind() && me.hand[i] && Bestia.isAssoOro(me.hand[i])) {
    pendingAssoIndex = i;
    render();
    return;
  }
  socket.emit('playCard', { index: i });
  pendingAssoIndex = null;
}

function playAsso(choice) {
  const i = pendingAssoIndex;
  pendingAssoIndex = null;
  socket.emit('playCard', { index: i, assoChoice: choice });
}
