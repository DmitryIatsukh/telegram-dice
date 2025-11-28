const express = require('express');
const router = express.Router();

const { recordBetResult } = require('../walletStore');

let lobbies = [];
let nextLobbyId = 1;

function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

// GET /api/lobbies
router.get('/', (req, res) => {
  res.json(lobbies);
});

// POST /api/lobbies/create
router.post('/create', (req, res) => {
  const { userId, name, isPrivate, pin, betAmount } = req.body;

  if (!userId || !name) {
    return res.status(400).json({ error: 'userId and name are required' });
  }

  const numericBet = Number(betAmount);
  const finalBet = numericBet > 0 ? numericBet : 0.1;

  const lobby = {
    id: nextLobbyId++,
    status: 'open',
    creatorId: String(userId),
    creatorName: name,
    isPrivate: !!isPrivate,
    pin: isPrivate ? String(pin || '') : null,
    betAmount: finalBet,
    gameResult: null,

    // 👇 creator is already a player and already READY
    players: [
      {
        id: String(userId),
        name,
        isReady: true,
        roll: null
      }
    ]
  };

  lobbies.push(lobby);
  res.json(lobby);
});

// POST /api/lobbies/:id/join
router.post('/:id/join', (req, res) => {
  const id = Number(req.params.id);
  const { userId, name, pin } = req.body;

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

  if (lobby.status !== 'open') {
    return res.status(400).json({ error: 'Lobby is not open' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  if (lobby.isPrivate) {
    if (!pin || String(pin) !== String(lobby.pin)) {
      return res.status(403).json({ error: 'Wrong PIN for private lobby' });
    }
  }

  const userIdStr = String(userId);

  let player = lobby.players.find(p => p.id === userIdStr);
  if (!player) {
    player = {
      id: userIdStr,
      name: name || 'Player',
      isReady: false,
      roll: null,
    };
    lobby.players.push(player);
  } else {
    // update name if changed
    if (name && player.name !== name) player.name = name;
  }

  // if creatorId not set for some reason, set it to first joiner
  if (!lobby.creatorId) {
    lobby.creatorId = player.id;
    lobby.creatorName = player.name;
  }

  res.json(lobby);
});
// POST /api/lobbies/:id/leave
router.post('/:id/leave', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  if (lobby.status !== 'open') {
    return res.status(400).json({ error: 'Lobby is not open' });
  }

  if (String(userId) === lobby.creatorId) {
    return res
      .status(400)
      .json({ error: 'Creator must cancel the lobby instead of leaving' });
  }

  const before = lobby.players.length;
  lobby.players = lobby.players.filter(p => p.id !== String(userId));

  if (lobby.players.length === before) {
    return res.status(400).json({ error: 'User not in lobby' });
  }

  res.json(lobby);
});

// POST /api/lobbies/:id/ready  (toggle ready)
router.post('/:id/ready', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

  const userIdStr = String(userId);
  const player = lobby.players.find(p => p.id === userIdStr);
  if (!player) {
    return res.status(400).json({ error: 'Player not in this lobby' });
  }

  player.isReady = !player.isReady;
  res.json(lobby);
});
router.post('/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  if (String(userId) !== lobby.creatorId) {
    return res.status(403).json({ error: 'Only creator can cancel lobby' });
  }

  if (lobby.status !== 'open') {
    return res.status(400).json({ error: 'Lobby is not open' });
  }

  // remove lobby completely
  lobbies = lobbies.filter(l => l.id !== id);

  return res.json({ ok: true });
});


// POST /api/lobbies/:id/start
router.post('/:id/start', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

  if (String(userId) !== String(lobby.creatorId)) {
    return res.status(403).json({ error: 'Only lobby creator can start game' });
  }

  const readyPlayers = lobby.players.filter(p => p.isReady);
  if (readyPlayers.length < 2) {
    return res
      .status(400)
      .json({ error: 'Need at least 2 ready players to start' });
  }

  // 1) Roll dice
  readyPlayers.forEach(p => {
    p.roll = rollDie();
  });

  const highest = Math.max(...readyPlayers.map(p => p.roll));
  const winners = readyPlayers.filter(p => p.roll === highest);

  // For now, if tie – first winner in list takes pot
  const winner = winners[0];

  const bet = lobby.betAmount || 0.1;
  const n = readyPlayers.length;
  const winnerProfit = bet * (n - 1);

  // 2) Apply payouts to wallets
  readyPlayers.forEach(p => {
    if (p.id === winner.id) {
      // winner: gets profit (others' bets). We assume bet itself was not pre-deducted.
      recordBetResult(p.id, p.name, winnerProfit, 'win');
    } else {
      // losers: lose their bet
      recordBetResult(p.id, p.name, bet, 'lose');
    }
  });

  // 3) Save result on lobby
  lobby.gameResult = {
    winnerId: winner.id,
    winnerName: winner.name,
    highest,
    players: readyPlayers.map(p => ({
      id: p.id,
      name: p.name,
      roll: p.roll,
    })),
  };

  lobby.status = 'finished';

  res.json(lobby);
});

module.exports = router;
