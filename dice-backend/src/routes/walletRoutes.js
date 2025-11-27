// dice-backend/src/routes/walletRoutes.js
const express = require("express");
const router = express.Router();

// Very simple in-memory store (good for dev; later you can swap to DB)
const users = new Map(); // key: telegramId string -> { balance: number, username: string }
const history = []; // array of { telegramId, type, amount, txHash, status, createdAt }

/**
 * Helper – get or create user record
 */
function getOrCreateUser(telegramId, username) {
  if (!users.has(telegramId)) {
    users.set(telegramId, {
      balance: 0,
      username: username || "Player",
    });
  }
  return users.get(telegramId);
}

/**
 * GET /api/wallet/state/:telegramId
 * Returns current balance + history for this user
 */
router.get("/state/:telegramId", (req, res) => {
  const { telegramId } = req.params;
  const user = users.get(telegramId) || { balance: 0, username: "Player" };
  const userHistory = history.filter((h) => h.telegramId === telegramId);
  res.json({ balance: user.balance, username: user.username, history: userHistory });
});

/**
 * POST /api/wallet/deposit
 * Body: { telegramId, username, amount, txHash }
 * We trust TonConnect that tx was sent – no on-chain check (for now).
 */
router.post("/deposit", (req, res) => {
  try {
    const { telegramId, username, amount, txHash } = req.body;

    if (!telegramId || !amount) {
      return res.status(400).json({ error: "telegramId and amount are required" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const user = getOrCreateUser(String(telegramId), username);

    user.balance += numericAmount;

    const record = {
      telegramId: String(telegramId),
      type: "deposit",
      amount: numericAmount,
      txHash: txHash || null,
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };
    history.push(record);

    res.json({
      ok: true,
      balance: user.balance,
      history: history.filter((h) => h.telegramId === String(telegramId)),
    });
  } catch (err) {
    console.error("Deposit error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/wallet/withdraw
 * Body: { telegramId, username, amount, walletAddress }
 * This ONLY updates internal balance + creates 'pending' request;
 * you will send TON manually from your wallet for now.
 */
router.post("/withdraw", (req, res) => {
  try {
    const { telegramId, username, amount, walletAddress } = req.body;

    if (!telegramId || !amount) {
      return res.status(400).json({ error: "telegramId and amount are required" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const user = getOrCreateUser(String(telegramId), username);

    if (user.balance < numericAmount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    user.balance -= numericAmount;

    const record = {
      telegramId: String(telegramId),
      type: "withdraw",
      amount: numericAmount,
      txHash: null,
      toAddress: walletAddress || null,
      status: "pending", // you can flip to 'sent' when you actually transfer
      createdAt: new Date().toISOString(),
    };
    history.push(record);

    res.json({
      ok: true,
      balance: user.balance,
      history: history.filter((h) => h.telegramId === String(telegramId)),
    });
  } catch (err) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
