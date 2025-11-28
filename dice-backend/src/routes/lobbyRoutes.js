const express = require('express');
const router = express.Router();

const { recordBetResult } = require('../walletStore');

// In-memory lobbies
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

  const lobby = {
    id: nextLobbyId++,
    players: [],            // players join via /:id/join
    status: 'open',
    creatorId: String(userId),
    creatorName: name,
    isPrivate: !!isPrivate,
    pin: isPrivate ? String(pin || '') : null,
    betAmount: Number(betAmount) > 0 ? Number(betAmount) : 0.1,
    gameResult: null
  };

  lobbies.push(lobby);
  res.json(lobby);
});

// POST /api/lobbies/:id/join
router.post('/:id/join', (req, res) => {
  const id = Number(req.params.id);
  const { userId, name, pin } = req.body;

  if (!userId || !name) {
    return res.status(400).json({ error: 'userId and name are required' });
  }

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  if (lobby.status !== 'open') {
    return res.status(400).json({ error: 'Lobby is not open' });
  }

  if (lobby.isPrivate) {
    if (!pin || String(pin) !== String(lobby.pin)) {
      return res.status(400).json({ error: 'Wrong PIN' });
    }
  }

  const userIdStr = String(userId);

  if (lobby.players.some(p => String(p.id) === userIdStr)) {
    // already in lobby – just return it
    return res.json(lobby);
  }

  lobby.players.push({
    id: userIdStr,
    name,
    isReady: false,
    roll: null
  });

  res.json(lobby);
});

// POST /api/lobbies/:id/leave
router.post('/:id/leave', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  const userIdStr = String(userId);

  // Creator cannot "leave" – must cancel instead
  if (userIdStr === String(lobby.creatorId)) {
    return res.status(400).json({ error: 'Creator cannot leave lobby' });
  }

  lobby.players = lobby.players.filter(p => String(p.id) !== userIdStr);

  res.json(lobby);
});

// POST /api/lobbies/:id/cancel (creator only)
router.post('/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  if (String(userId) !== String(lobby.creatorId)) {
    return res.status(403).json({ error: 'Only lobby creator can cancel lobby' });
  }

  lobby.status = 'cancelled';

  // Frontend already removes it from list, but we also keep our array clean
  lobbies = lobbies.filter(l => l.id !== id);

  return res.json({ ok: true });
});

// POST /api/lobbies/:id/toggle-ready
router.post('/:id/toggle-ready', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  const userIdStr = String(userId);

  // Creator is not a "player" in this sense – he just starts/cancels
  if (userIdStr === String(lobby.creatorId)) {
    return res.status(400).json({ error: 'Creator does not ready up' });
  }

  const player = lobby.players.find(p => String(p.id) === userIdStr);
  if (!player) {
    return res.status(400).json({ error: 'User not in lobby' });
  }

  player.isReady = !player.isReady;

  res.json(lobby);
});

// POST /api/lobbies/:id/start  (creator only, auto-reroll on ties)
router.post('/:id/start', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  if (String(userId) !== String(lobby.creatorId)) {
    return res.status(403).json({ error: 'Only lobby creator can start game' });
  }

  // Include creator as "ready"
const creatorIsPlayer = {
  id: lobby.creatorId,
  name: lobby.creatorName,
  isReady: true
};

// All players except creator
const nonCreatorPlayers = lobby.players.filter(p => p.id !== lobby.creatorId);

// Real ready players are creator + all ready users
const readyPlayers = [
  creatorIsPlayer,
  ...nonCreatorPlayers.filter(p => p.isReady)
];

// Require creator + at least 1 more
if (readyPlayers.length < 2) {
  return res.status(400).json({
    error: 'Need creator + at least 1 ready player to start'
  });
}


  const bet = lobby.betAmount || 0.1;

  // We keep a log of all rounds (for rerolls display)
  const rounds = [];

  // Contenders in current round: subset of ready players
  let contenders = readyPlayers.map(p => ({
    id: p.id,
    name: p.name
  }));

  let finalWinner = null;
  let finalHighest = 0;
  const finalRollsById = {}; // id -> roll in the deciding round

  while (true) {
    // Roll for each contender in this round
    contenders.forEach(p => {
      p.roll = rollDie();
    });

    // Save this round for UI (id, name, roll)
    rounds.push(
      contenders.map(p => ({
        id: p.id,
        name: p.name,
        roll: p.roll
      }))
    );

    const highest = Math.max(...contenders.map(p => p.roll));
    const highestPlayers = contenders.filter(p => p.roll === highest);

    if (highestPlayers.length === 1) {
      // Unique winner found
      finalWinner = highestPlayers[0];
      finalHighest = highest;
      highestPlayers.forEach(p => {
        finalRollsById[p.id] = p.roll;
      });
      break;
    }

    // Tie – next round with only the tied players
    contenders = highestPlayers.map(p => ({
      id: p.id,
      name: p.name
    }));
  }

  // Payout: winner gets all others' bets (we assume individual bet = lobby.betAmount)
  const n = readyPlayers.length;
  const winnerProfit = bet * (n - 1);

  readyPlayers.forEach(p => {
    if (String(p.id) === String(finalWinner.id)) {
      recordBetResult(p.id, p.name, winnerProfit, 'win');
    } else {
      // losers lose their bet
      recordBetResult(p.id, p.name, bet, 'lose');
    }
  });

  // Update lobby
  lobby.status = 'finished';
  lobby.gameResult = {
    winnerId: finalWinner.id,
    winnerName: finalWinner.name,
    highest: finalHighest,
    players: readyPlayers.map(p => ({
      id: p.id,
      name: p.name,
      // use the deciding round roll if we have it, otherwise 0
      roll:
        finalRollsById[String(p.id)] !== undefined
          ? finalRollsById[String(p.id)]
          : 0
    })),
    rounds
  };

  res.json(lobby);
});

module.exports = router;
