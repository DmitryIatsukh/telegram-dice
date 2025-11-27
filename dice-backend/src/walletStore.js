// dice-backend/src/walletStore.js
const wallets = new Map();

function nowString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function getOrCreateWallet(telegramId, username) {
  const id = String(telegramId);
  let wallet = wallets.get(id);
  if (!wallet) {
    wallet = {
      telegramId: id,
      username: username || null,
      balance: 0,
      history: [],
    };
    wallets.set(id, wallet);
  } else if (username && wallet.username !== username) {
    wallet.username = username;
  }
  return wallet;
}

function pushHistory(wallet, item) {
  wallet.history.unshift({
    id: Date.now() + Math.random(),
    ...item,
  });
  // keep last 100
  wallet.history = wallet.history.slice(0, 100);
}

function recordDeposit(telegramId, username, amount) {
  const wallet = getOrCreateWallet(telegramId, username);
  wallet.balance += amount;
  pushHistory(wallet, {
    type: 'deposit',
    amount,
    currency: 'TON',
    createdAt: nowString(),
  });
  return wallet;
}

function recordWithdraw(telegramId, username, amount) {
  const wallet = getOrCreateWallet(telegramId, username);
  wallet.balance -= amount;
  pushHistory(wallet, {
    type: 'withdraw',
    amount,
    currency: 'TON',
    createdAt: nowString(),
  });
  return wallet;
}

// amount = profit for winner, lost stake for losers
// result: 'win' or 'lose'
function recordBetResult(telegramId, username, amount, result) {
  const wallet = getOrCreateWallet(telegramId, username);

  if (result === 'win') {
    wallet.balance += amount;      // profit
  } else {
    wallet.balance -= amount;      // lost stake
  }

  pushHistory(wallet, {
    type: 'bet',
    amount,
    currency: 'TON',
    result,
    createdAt: nowString(),
    playerName: username || null,
  });

  return wallet;
}

module.exports = {
  wallets,
  getOrCreateWallet,
  recordDeposit,
  recordWithdraw,
  recordBetResult,
};