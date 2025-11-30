// src/routes/lobbyRoutes.js
const express = require("express");
const router = express.Router();

const lobbies = {}; // id -> lobby
let nextLobbyId = 1;

/*
Lobby shape:

{
  id: number,
  status: 'open' | 'countdown' | 'rolling' | 'finished',
  bet: number,
  creatorId: string,
  players: [
    { telegramId, username, avatarUrl }
  ],
  maxPlayers: 2,
  autoStartAt?: number, // ms timestamp
  game: {
    round: number,
    p1Roll: number | null,
    p2Roll: number | null,
    revealP1: boolean,
    revealP2: boolean,
    step: 'idle' | 'p1' | 'p2' | 'done',
    nextStepAt: number | null, // ms timestamp
    winnerTelegramId: string | null
  }
}
*/

function createEmptyGame() {
  return {
    round: 1,
    p1Roll: null,
    p2Roll: null,
    revealP1: false,
    revealP2: false,
    step: "idle",
    nextStepAt: null,
    winnerTelegramId: null,
  };
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

// ------- GAME STATE MACHINE (server side) -------

function advanceGame(lobby) {
  const now = Date.now();

  // 1) auto start after countdown
  if (lobby.status === "countdown" && now >= lobby.autoStartAt) {
    // if game not started yet, prepare rolls and start P1 step
    if (lobby.game.step === "idle") {
      lobby.game.p1Roll = rollDie();
      lobby.game.p2Roll = rollDie();
      lobby.game.revealP1 = false;
      lobby.game.revealP2 = false;
      lobby.game.step = "p1";
      lobby.game.nextStepAt = now + 3000; // 3s invisible wait for P1 roll
      lobby.status = "rolling";
    }
  }

  // 2) handle rolling steps
  if (lobby.status === "rolling" && lobby.game.nextStepAt && now >= lobby.game.nextStepAt) {
    if (lobby.game.step === "p1") {
      // reveal player 1 roll
      lobby.game.revealP1 = true;
      lobby.game.step = "p2";
      lobby.game.nextStepAt = now + 3000; // wait 3s for P2
    } else if (lobby.game.step === "p2") {
      // reveal player 2 roll
      lobby.game.revealP2 = true;

      const p1 = lobby.game.p1Roll;
      const p2 = lobby.game.p2Roll;

      if (p1 === p2) {
        // tie -> reroll, same logic again
        lobby.game.round += 1;
        lobby.game.p1Roll = rollDie();
        lobby.game.p2Roll = rollDie();
        lobby.game.revealP1 = false;
        lobby.game.revealP2 = false;
        lobby.game.step = "p1";
        lobby.game.nextStepAt = now + 3000;
        // status stays 'rolling'
      } else {
        // winner
        const p1Player = lobby.players[0];
        const p2Player = lobby.players[1];
        lobby.game.winnerTelegramId = p1 > p2 ? p1Player.telegramId : p2Player.telegramId;
        lobby.game.step = "done";
        lobby.game.nextStepAt = null;
        lobby.status = "finished";
      }
    }
  }
}

// Call this before returning lobby(s) to clients
function touchLobby(lobby) {
  // only progress logic when 2 players are inside
  if (lobby.players.length === 2) {
    advanceGame(lobby);
  }
}

// ------- ROUTES --------

// list lobbies (for search tab)
router.get("/", (req, res) => {
  const list = Object.values(lobbies);
  list.forEach(touchLobby);
  res.json(list);
});

// single lobby details (used by game screen)
router.get("/:id", (req, res) => {
  const lobby = lobbies[req.params.id];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });

  touchLobby(lobby);
  res.json(lobby);
});

// create lobby – always 1vs1
router.post("/", express.json(), (req, res) => {
  const { telegramId, username, bet } = req.body || {};
  if (!telegramId) {
    return res.status(400).json({ error: "Missing telegramId" });
  }

  const id = String(nextLobbyId++);
  const lobby = {
    id,
    status: "open",
    bet: Number(bet) || 1,
    creatorId: telegramId,
    players: [
      {
        telegramId,
        username: username || "Player",
        avatarUrl: req.body.avatarUrl || null,
      },
    ],
    maxPlayers: 2,
    autoStartAt: null,
    game: createEmptyGame(),
  };

  lobbies[id] = lobby;
  res.json(lobby);
});

// join lobby – once second player joins, start 10s countdown
router.post("/:id/join", express.json(), (req, res) => {
  const lobby = lobbies[req.params.id];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });

  const { telegramId, username, avatarUrl } = req.body || {};
  if (!telegramId) {
    return res.status(400).json({ error: "Missing telegramId" });
  }

  // already full (1vs1 only)
  if (lobby.players.length >= 2) {
    return res.status(400).json({ error: "Lobby is full" });
  }

  // don't add duplicate
  if (!lobby.players.find((p) => p.telegramId === telegramId)) {
    lobby.players.push({
      telegramId,
      username: username || "Player",
      avatarUrl: avatarUrl || null,
    });
  }

  // start 10s countdown when second player joins
  if (lobby.players.length === 2 && lobby.status === "open") {
    lobby.status = "countdown";
    lobby.autoStartAt = Date.now() + 10_000; // 10 seconds
    lobby.game = createEmptyGame(); // reset game state
  }

  touchLobby(lobby);
  res.json(lobby);
});

// leave lobby (any player)
router.post("/:id/leave", express.json(), (req, res) => {
  const lobby = lobbies[req.params.id];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });

  const { telegramId } = req.body || {};
  if (!telegramId) {
    return res.status(400).json({ error: "Missing telegramId" });
  }

  lobby.players = lobby.players.filter((p) => p.telegramId !== telegramId);

  // if someone left during countdown / rolling -> revert to open or delete
  if (lobby.players.length === 0) {
    delete lobbies[req.params.id];
  } else {
    lobby.status = "open";
    lobby.autoStartAt = null;
    lobby.game = createEmptyGame();
  }

  res.json({ ok: true });
});

// cancel lobby (creator)
router.post("/:id/cancel", express.json(), (req, res) => {
  const lobby = lobbies[req.params.id];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });

  const { telegramId } = req.body || {};
  if (telegramId && telegramId !== lobby.creatorId) {
    return res.status(403).json({ error: "Only creator can cancel lobby" });
  }

  delete lobbies[req.params.id];
  res.json({ ok: true });
});

module.exports = router;