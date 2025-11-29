const express = require('express');
const router = express.Router();

const { recordBetResult } = require('../walletStore');

// In-memory lobbies
let lobbies = [];
let nextLobbyId = 1;

function rollDice() {
  const r = Math.floor(Math.random() * 6) + 1
  return r // 1..6 only
}

/**
 * GET /api/lobbies
 * (mounted as app.use('/api/lobbies', router))
 */
router.get('/', (req, res) => {
  res.json(lobbies);
});

/**
 * POST /api/lobbies/create
 * body: { userId, name, isPrivate, pin, betAmount, maxPlayers }
 */
router.post('/create', (req, res) => {
  try {
    const {
      userId,
      name,
      isPrivate,
      pin,
      betAmount,
      maxPlayers,
    } = req.body || {};

    if (!userId || !name) {
      return res.status(400).json({ error: 'Missing userId or name' });
    }

    if (isPrivate && (!pin || String(pin).length !== 4)) {
      return res.status(400).json({ error: 'PIN must be 4 digits' });
    }

    const finalBet =
      typeof betAmount === 'number' && betAmount > 0 ? betAmount : 1;

    // only 2 or 4 are allowed, default 4
    const finalMaxPlayers = maxPlayers === 2 ? 2 : 4;

    const newLobby = {
      id: nextLobbyId++,
      players: [],                // creator will join from frontend
      status: 'open',
      creatorId: null,
      creatorName: null,
      isPrivate: !!isPrivate,
      pin: isPrivate ? String(pin || '') : null,
      betAmount: finalBet,
      maxPlayers: finalMaxPlayers,
      gameResult: null,
    };

    lobbies.push(newLobby);
    return res.json(newLobby);
  } catch (err) {
    console.error('create lobby error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/lobbies/:id/join
 */
router.post('/:id/join', (req, res) => {
  const id = Number(req.params.id);
  const { userId, name, pin } = req.body || {};

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

  // lobby full?
  const effectiveMaxPlayers = lobby.maxPlayers || 4;
  if (lobby.players.length >= effectiveMaxPlayers) {
    return res.status(400).json({ error: 'Lobby is full' });
  }

  if (lobby.isPrivate) {
    if (!pin || String(pin) !== String(lobby.pin)) {
      return res.status(400).json({ error: 'Wrong PIN' });
    }
  }

  const userIdStr = String(userId);

  // already joined? just return lobby
  if (lobby.players.some(p => String(p.id) === userIdStr)) {
    return res.json(lobby);
  }

  // if no creator yet, first joined user becomes creator
  if (!lobby.creatorId) {
    lobby.creatorId = userIdStr;
    lobby.creatorName = name;
  }

  lobby.players.push({
    id: userIdStr,
    name,
    isReady: false,
    roll: null,
  });

  return res.json(lobby);
});

/**
 * POST /api/lobbies/:id/leave
 */
router.post('/:id/leave', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  const userIdStr = String(userId);

  // Creator cannot leave, only cancel
  if (userIdStr === String(lobby.creatorId)) {
    return res.status(400).json({ error: 'Creator cannot leave lobby' });
  }

  lobby.players = lobby.players.filter(p => String(p.id) !== userIdStr);

  return res.json(lobby);
});

/**
 * POST /api/lobbies/:id/cancel  (creator only)
 */
router.post('/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body || {};

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
  lobbies = lobbies.filter(l => l.id !== id);

  return res.json({ ok: true });
});

/**
 * POST /api/lobbies/:id/toggle-ready
 */
router.post('/:id/toggle-ready', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  const userIdStr = String(userId);

  // Creator doesn’t ready up
  if (userIdStr === String(lobby.creatorId)) {
    return res.status(400).json({ error: 'Creator does not ready up' });
  }

  const player = lobby.players.find(p => String(p.id) === userIdStr);
  if (!player) {
    return res.status(400).json({ error: 'User not in lobby' });
  }

  player.isReady = !player.isReady;
  return res.json(lobby);
});

// POST /api/lobbies/:id/start  (creator only, all players auto-ready)
router.post('/:id/start', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body || {};

  const lobby = lobbies.find(l => l.id === id);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  if (String(userId) !== String(lobby.creatorId)) {
    return res
      .status(403)
      .json({ error: 'Only lobby creator can start game' });
  }

  // Everyone in the game: creator + all joined players
  const readyPlayers = [
    {
      id: String(lobby.creatorId),
      name: lobby.creatorName,
    },
    ...lobby.players
      .filter(p => String(p.id) !== String(lobby.creatorId))
      .map(p => ({ id: String(p.id), name: p.name })),
  ];

  // Need at least 2 players
  if (readyPlayers.length < 2) {
    return res.status(400).json({
      error: 'Need at least 2 players (creator + someone else) to start',
    });
  }

  const bet = lobby.betAmount || 0.1;

  // We keep a log of all rounds (for rerolls display)
  const rounds = [];

  // Contenders in current round: all ready players
  let contenders = readyPlayers.map(p => ({
    id: String(p.id),
    name: p.name,
  }));

  let finalWinner = null;
  let finalHighest = 0;

  // each player's last roll in the **last round they played**
  const finalRollsById = {}; // { [id]: number }

  while (true) {
    // Roll for each contender in this round
    contenders.forEach(p => {
      const r = rollDice(); // 1..6
      p.roll = r;
      // remember this as the latest roll for this player
      finalRollsById[p.id] = r;
    });

    // Save this round for UI
    rounds.push(
      contenders.map(p => ({
        id: p.id,
        name: p.name,
        roll: p.roll,
      })),
    );

    // Find highest roll **among contenders in this round**
    const highest = Math.max(...contenders.map(p => p.roll));
    const highestPlayers = contenders.filter(p => p.roll === highest);

    if (highestPlayers.length === 1) {
      // unique winner found
      finalWinner = highestPlayers[0];
      finalHighest = highest;
      break;
    }

    // tie -> next round only with tied players (without .roll)
    contenders = highestPlayers.map(p => ({
      id: p.id,
      name: p.name,
    }));
  }

  // Payout:
  // pot = bet * number of players
  // rake = 5% of pot
  // winner net profit = pot - rake - own bet
  const n = readyPlayers.length;
  const pot = bet * n;
  const rake = pot * 0.05;
  const winnerNetProfit = pot - rake - bet;

  readyPlayers.forEach(p => {
    if (String(p.id) === String(finalWinner.id)) {
      // winner gets net PROFIT (extra over his own bet)
      recordBetResult(p.id, p.name, winnerNetProfit, 'win');
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
      // use the last roll we have for that player; fallback to 1 (never 0)
      roll: finalRollsById[String(p.id)] ?? 1,
    })),
    rounds,
  };

  res.json(lobby);
});

module.exports = router;
