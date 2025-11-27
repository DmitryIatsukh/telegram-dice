const express = require('express')
const router = express.Router()

// In-memory storage
let lobbies = []
let nextLobbyId = 1

// ===== helper: get random dice 1-6 =====
function rollDice() {
  return Math.floor(Math.random() * 6) + 1
}

// ===== helper: remove PIN from response =====
function viewLobby(lobby) {
  const { pin, ...rest } = lobby
  return rest
}

// ===== GET ALL LOBBIES =====
router.get('/', (req, res) => {
  res.json(lobbies.map(viewLobby))
})

// ===== CREATE A NEW LOBBY (creator auto-joins) =====
router.post('/create', (req, res) => {
  const { userId, name, isPrivate, pin } = req.body || {}

  if (!userId || !name) {
    return res.status(400).json({ error: 'userId and name are required' })
  }

  let privateFlag = !!isPrivate
  let pinValue = null

  if (privateFlag) {
    // require 4-digit pin for private lobby
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      return res
        .status(400)
        .json({ error: 'Private lobby requires 4-digit PIN' })
    }
    pinValue = pin
  }

  const lobby = {
    id: nextLobbyId++,
    players: [], // {id, name, isReady, roll}
    status: 'open', // 'open' | 'finished'
    creatorId: userId,
    creatorName: name,
    isPrivate: privateFlag,
    pin: pinValue,
    gameResult: null
  }

  // creator sits in lobby automatically
  lobby.players.push({
    id: userId,
    name,
    isReady: false,
    roll: null
  })

  lobbies.push(lobby)
  res.json(viewLobby(lobby))
})

// ===== JOIN A LOBBY =====
router.post('/:id/join', (req, res) => {
  const lobbyId = parseInt(req.params.id)
  const lobby = lobbies.find(l => l.id === lobbyId)

  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' })
  }

  if (lobby.status !== 'open') {
    return res.status(400).json({ error: 'Lobby is not open' })
  }

  const { userId, name, pin } = req.body || {}

  if (!userId || !name) {
    return res.status(400).json({ error: 'userId and name are required' })
  }

  // if private, check PIN
  if (lobby.isPrivate) {
    if (typeof pin !== 'string' || pin !== lobby.pin) {
      return res.status(400).json({ error: 'Wrong PIN for this lobby' })
    }
  }

  // limit to 4 players
  if (lobby.players.length >= 4) {
    return res.status(400).json({ error: 'Lobby is full (max 4 players)' })
  }

  // if already joined, just return lobby
  const existing = lobby.players.find(p => p.id === userId)
  if (existing) {
    return res.json(viewLobby(lobby))
  }

  lobby.players.push({
    id: userId,
    name,
    isReady: false,
    roll: null
  })

  res.json(viewLobby(lobby))
})

// ===== SET PLAYER READY (TOGGLE) =====
router.post('/:id/ready', (req, res) => {
  const lobbyId = parseInt(req.params.id)
  const lobby = lobbies.find(l => l.id === lobbyId)

  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' })
  }

  if (lobby.status !== 'open') {
    return res.status(400).json({ error: 'Lobby is not open' })
  }

  const { userId } = req.body || {}

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  const player = lobby.players.find(p => p.id === userId)

  if (!player) {
    return res.status(400).json({ error: 'Player not in lobby' })
  }

  // Toggle ready
  player.isReady = !player.isReady

  res.json(viewLobby(lobby))
})

// ===== START GAME (creator only) with rerolls =====
router.post('/:id/start', (req, res) => {
  const lobbyId = parseInt(req.params.id)
  const lobby = lobbies.find(l => l.id === lobbyId)

  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' })
  }

  if (lobby.status !== 'open') {
    return res.status(400).json({ error: 'Lobby already started or finished' })
  }

  const { userId } = req.body || {}
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  // Only creator can start
  if (lobby.creatorId !== userId) {
    return res.status(403).json({ error: 'Only creator can start the game' })
  }

  const readyPlayers = lobby.players.filter(p => p.isReady)

  if (readyPlayers.length < 2) {
    return res
      .status(400)
      .json({ error: 'At least 2 ready players are required to start' })
  }

  // reset rolls
  lobby.players.forEach(p => {
    p.roll = null
  })

  // ===== reroll logic until one winner =====
  let activePlayers = [...readyPlayers]
  let winner = null

  while (!winner) {
    // roll for all active players
    activePlayers.forEach(p => {
      p.roll = rollDice()
    })

    const highest = Math.max(...activePlayers.map(p => p.roll))
    const topPlayers = activePlayers.filter(p => p.roll === highest)

    if (topPlayers.length === 1) {
      winner = topPlayers[0]
    } else {
      // tie → reroll only tied players
      activePlayers = topPlayers
    }
  }

  const highest = winner.roll

  lobby.status = 'finished'
  lobby.gameResult = {
    winnerId: winner.id,
    winnerName: winner.name,
    highest,
    players: readyPlayers.map(p => ({
      id: p.id,
      name: p.name,
      roll: p.roll
    }))
  }

  res.json(viewLobby(lobby))
})

module.exports = router
