const express = require('express');
const router = express.Router();

const {
  wallets,
  getOrCreateWallet,
  recordDeposit,
  recordWithdraw,
} = require('../walletStore');

// GET /api/wallet/state/:telegramId
router.get('/state/:telegramId', (req, res) => {
  const telegramId = String(req.params.telegramId);
  const wallet = wallets.get(telegramId) || { balance: 0, history: [] };
  res.json({
    balance: wallet.balance,
    history: wallet.history,
  });
});

// POST /api/wallet/deposit
router.post('/deposit', (req, res) => {
  const { telegramId, username, amount } = req.body;
  const amt = Number(amount);

  if (!telegramId || !Number.isFinite(amt) || amt <= 0) {
    return res
      .status(400)
      .json({ error: 'telegramId and positive amount are required' });
  }

  const wallet = recordDeposit(telegramId, username, amt);
  res.json({ ok: true, balance: wallet.balance, history: wallet.history });
});

// POST /api/wallet/withdraw
router.post('/withdraw', (req, res) => {
  const { telegramId, username, amount } = req.body;
  const amt = Number(amount);

  if (!telegramId || !Number.isFinite(amt) || amt <= 0) {
    return res
      .status(400)
      .json({ ok: false, error: 'telegramId and positive amount are required' });
  }

  const wallet = getOrCreateWallet(telegramId, username);
  if (wallet.balance < amt) {
    return res
      .status(400)
      .json({ ok: false, error: 'Not enough balance for withdraw' });
  }

  recordWithdraw(telegramId, username, amt);
  res.json({ ok: true, balance: wallet.balance, history: wallet.history });
});
router.post('/sync', (req, res) => {
  const { telegramId, username, balance, history } = req.body;

  if (!telegramId || typeof balance !== 'number') {
    return res
      .status(400)
      .json({ error: 'telegramId and numeric balance are required' });
  }

  let wallet = wallets.get(telegramId);
  if (!wallet) {
    wallet = {
      telegramId,
      username: username || null,
      balance: 0,
      history: []
    };
  }

  wallet.balance = balance;

  if (Array.isArray(history)) {
    wallet.history = history;
  }

  wallets.set(telegramId, wallet);

  return res.json({
    ok: true,
    balance: wallet.balance,
    history: wallet.history
  });
});

module.exports = router;