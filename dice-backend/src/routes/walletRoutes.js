const express = require("express");

// require fetch for Node 18+ (global fetch exists)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const router = express.Router();

const APP_WALLET = process.env.APP_WALLET || "";
const TONAPI_KEY = process.env.TONAPI_KEY || "";

// In-memory wallets
const wallets = {};

// =========================
// GET WALLET OR CREATE NEW
// =========================
function getWallet(telegramId, username) {
  if (!wallets[telegramId]) {
    wallets[telegramId] = {
      telegramId,
      username: username || "Player",
      balance: 0,
      history: [],
    };
  } else if (username) {
    wallets[telegramId].username = username;
  }
  return wallets[telegramId];
}

// =========================
// TON API – FETCH TX LIST
// =========================
async function fetchAppWalletTxs() {
  const url = `https://tonapi.io/v2/blockchain/accounts/${APP_WALLET}/transactions?limit=50`;

  const headers = {};
  if (TONAPI_KEY) headers.Authorization = `Bearer ${TONAPI_KEY}`;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("TONAPI ERROR:", res.status, text);
    throw new Error("Cannot fetch TON blockchain data");
  }

  const data = await res.json();
  return data.transactions || data.items || [];
}

// =========================
// FIND MATCHING DEPOSIT TX
// =========================
async function findMatchingDepositTx(amountNano, usedHashes) {
  const txs = await fetchAppWalletTxs();
  const now = Math.floor(Date.now() / 1000);
  const minTime = now - 600; // 10 minutes

  for (const tx of txs) {
    const utime = tx.utime || tx.now || 0;
    if (utime < minTime) continue;

    const hash = tx.hash || tx.transaction_id?.hash;
    if (!hash || usedHashes.has(hash)) continue;

    const inMsg = tx.in_msg || tx.in_message || tx.in_msg_msg;
    if (!inMsg) continue;

    const valueStr = String(inMsg.value || inMsg.amount || "0");

    let valueNano;
    try {
      valueNano = BigInt(valueStr);
    } catch {
      continue;
    }

    if (valueNano >= amountNano) {
      console.log("MATCHED TX:", hash);
      return { hash, utime, valueNano };
    }
  }

  return null;
}

// =========================
// ROUTE: GET STATE
// =========================
router.get("/state/:telegramId", (req, res) => {
  const { telegramId } = req.params;
  const wallet = wallets[telegramId];

  if (!wallet) return res.json({ balance: 0, history: [] });

  return res.json(wallet);
});

// =========================
// ROUTE: SYNC (FRONTEND USES)
// =========================
router.post("/sync", express.json(), (req, res) => {
  const { telegramId, username, balance, history } = req.body;

  if (!telegramId)
    return res.status(400).json({ error: "Missing telegramId" });

  const wallet = getWallet(telegramId, username);
  wallet.balance = Number(balance) || 0;
  wallet.history = Array.isArray(history) ? history : [];

  return res.json({ ok: true });
});

// =========================
// ROUTE: DEPOSIT
// =========================
router.post("/deposit", express.json(), async (req, res) => {
  try {
    const { telegramId, username, amount } = req.body;

    if (!telegramId || !amount)
      return res.status(400).json({
        ok: false,
        error: "Missing telegramId or amount",
      });

    const amountNumber = Number(amount);
    if (isNaN(amountNumber) || amountNumber <= 0)
      return res.status(400).json({ ok: false, error: "Bad amount" });

    const wallet = getWallet(telegramId, username);
    const usedHashes = new Set(
      wallet.history.map((h) => h.txHash).filter(Boolean)
    );

    const targetNano = BigInt(Math.round(amountNumber * 1e9));

    let found = null;

    for (let i = 0; i < 6; i++) {
      found = await findMatchingDepositTx(targetNano, usedHashes);
      if (found) break;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    if (!found) {
      return res.status(409).json({
        ok: false,
        error:
          "Deposit transaction not found on-chain. Please try again in a few seconds.",
      });
    }

    wallet.balance += amountNumber;

    wallet.history.unshift({
      id: Date.now(),
      type: "deposit",
      amount: amountNumber,
      currency: "TON",
      txHash: found.hash,
      createdAt: new Date().toISOString(),
      playerName: wallet.username,
    });

    res.json({ ok: true, balance: wallet.balance, history: wallet.history });
  } catch (err) {
    console.error("DEPOSIT ERROR:", err);
    res.status(500).json({ ok: false, error: "Internal deposit error" });
  }
});

// =========================
// ROUTE: WITHDRAW (manual for now)
// =========================
router.post("/withdraw", express.json(), async (req, res) => {
  try {
    const { telegramId, amount } = req.body;

    if (!telegramId || !amount)
      return res
        .status(400)
        .json({ ok: false, error: "Missing telegramId or amount" });

    const amountNumber = Number(amount);
    if (isNaN(amountNumber) || amountNumber <= 0)
      return res.status(400).json({ ok: false, error: "Invalid amount" });

    const wallet = wallets[telegramId];
    if (!wallet) return res.status(404).json({ ok: false, error: "Wallet not found" });

    if (wallet.balance < amountNumber)
      return res.status(400).json({ ok: false, error: "Insufficient balance" });

    wallet.balance -= amountNumber;

    wallet.history.unshift({
      id: Date.now(),
      type: "withdraw",
      amount: amountNumber,
      currency: "TON",
      createdAt: new Date().toISOString(),
      playerName: wallet.username,
    });

    return res.json({
      ok: true,
      balance: wallet.balance,
      history: wallet.history,
    });
  } catch (err) {
    console.log("WITHDRAW ERROR:", err);
    res.status(500).json({ ok: false, error: "Internal withdraw error" });
  }
});

module.exports = router;