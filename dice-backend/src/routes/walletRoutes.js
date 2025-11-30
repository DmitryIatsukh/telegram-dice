import express from 'express'

const router = express.Router()

const APP_WALLET = process.env.APP_WALLET || '' // same as in frontend
const TONAPI_KEY = process.env.TONAPI_KEY || ''

// In-memory "DB" of wallets
// key: telegramId -> { telegramId, username, balance, history[] }
const wallets = {}

// Get or create wallet
function getWallet(telegramId, username) {
  if (!wallets[telegramId]) {
    wallets[telegramId] = {
      telegramId,
      username: username || 'Player',
      balance: 0,
      history: []
    }
  } else if (username) {
    wallets[telegramId].username = username
  }
  return wallets[telegramId]
}

// ---- helpers to query TON API ----

async function fetchAppWalletTxs() {
  const url = `https://tonapi.io/v2/blockchain/accounts/${APP_WALLET}/transactions?limit=50`
  const headers = {}
  if (TONAPI_KEY) headers.Authorization = `Bearer ${TONAPI_KEY}`

  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('TONAPI error', res.status, text)
    throw new Error('Cannot fetch TON blockchain data')
  }
  const data = await res.json()
  // tonapi returns { transactions: [...] } or { items: [...] } depending on version
  return (data.transactions || data.items || [])
}

/**
 * Find an incoming tx FROM fromAddress TO APP_WALLET with >= amountNano,
 * not older than maxAgeSec, and not already used (by tx hash).
 */
async function findMatchingDepositTx(fromAddress, amountNano, maxAgeSec, usedHashes) {
  const now = Math.floor(Date.now() / 1000)
  const minTime = now - maxAgeSec

  const txs = await fetchAppWalletTxs()

  for (const tx of txs) {
    const utime = tx.utime || tx.now || 0
    if (utime < minTime) continue

    const hash = tx.hash || (tx.transaction_id && tx.transaction_id.hash)
    if (!hash || usedHashes.has(hash)) continue

    // different tonapi versions name this differently; we try a couple
    const inMsg = tx.in_msg || tx.in_msg_msg || tx.in_msg_value
    if (!inMsg) continue

    const src = inMsg.source || inMsg.src || ''
    const dst = inMsg.destination || inMsg.dst || ''
    const valueStr = String(inMsg.value || inMsg.amount || '0')

    if (!src || !dst) continue
    if (dst !== APP_WALLET) continue
    if (src !== fromAddress) continue

    let valueNano
    try {
      valueNano = BigInt(valueStr)
    } catch {
      continue
    }

    if (valueNano >= amountNano) {
      return { hash, utime, valueNano }
    }
  }

  return null
}

// -------- ROUTES --------

// current state
router.get('/state/:telegramId', (req, res) => {
  const { telegramId } = req.params
  const wallet = wallets[telegramId]
  if (!wallet) {
    return res.json({ balance: 0, history: [] })
  }
  return res.json(wallet)
})

// sync from frontend (you already use this)
router.post('/sync', express.json(), (req, res) => {
  const { telegramId, username, balance, history } = req.body || {}
  if (!telegramId) {
    return res.status(400).json({ error: 'Missing telegramId' })
  }
  const wallet = getWallet(telegramId, username)
  wallet.balance = Number(balance) || 0
  wallet.history = Array.isArray(history) ? history : []
  return res.json({ ok: true })
})

// ✅ DEPOSIT WITH ON-CHAIN VALIDATION
router.post('/deposit', express.json(), async (req, res) => {
  try {
    const { telegramId, username, amount, walletAddress } = req.body || {}

    if (!telegramId || !walletAddress || !amount) {
      return res
        .status(400)
        .json({ ok: false, error: 'Missing telegramId, walletAddress or amount' })
    }

    const amountNumber = Number(amount)
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res.status(400).json({ ok: false, error: 'Bad amount' })
    }

    const wallet = getWallet(telegramId, username)
    const usedHashes = new Set(
      wallet.history.map(h => h.txHash).filter(Boolean)
    )

    const targetNano = BigInt(Math.round(amountNumber * 1e9))

    // wait up to ~30s (6 tries * 5s) for TON API to show tx
    const maxTries = 6
    const delayMs = 5000
    let found = null

    for (let i = 0; i < maxTries; i++) {
      try {
        found = await findMatchingDepositTx(
          walletAddress,
          targetNano,
          10 * 60, // 10 minutes window
          usedHashes
        )
      } catch (e) {
        console.error('findMatchingDepositTx error:', e)
      }

      if (found) break
      if (i < maxTries - 1) {
        // wait a bit and retry
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }

    if (!found) {
      return res.status(409).json({
        ok: false,
        error:
          'Deposit transaction not found on-chain yet. Please wait a few seconds and try again.'
      })
    }

    // credit balance
    wallet.balance += amountNumber

    const historyItem = {
      id: Date.now(),
      type: 'deposit',
      amount: amountNumber,
      currency: 'TON',
      createdAt: new Date().toISOString(),
      playerName: wallet.username,
      txHash: found.hash
    }

    wallet.history = [historyItem, ...wallet.history]

    return res.json({
      ok: true,
      balance: wallet.balance,
      history: wallet.history
    })
  } catch (err) {
    console.error('deposit error:', err)
    return res
      .status(500)
      .json({ ok: false, error: 'Internal server error during deposit' })
  }
})

// your existing /withdraw route should also be here, unchanged

export default router