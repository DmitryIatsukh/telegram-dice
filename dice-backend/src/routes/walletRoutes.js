// src/routes/walletRoutes.js

const express = require('express')
const TonWeb = require('tonweb')
const tonMnemonic = require('tonweb-mnemonic')

const router = express.Router()

const APP_WALLET = process.env.APP_WALLET || ''          // same as in frontend
const TONAPI_KEY = process.env.TONAPI_KEY || ''          // for tonapi.io deposits
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || process.env.TONAPI_KEY || ''
const TON_MNEMONIC = process.env.TON_MNEMONIC || ''      // 24-word seed of server wallet

// ---------- in-memory wallet state ----------
// (you already had this)
const wallets = {}   // Record<string, WalletState>

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

// ---------- TON helpers ----------

// HTTP provider for TONCENTER (for sending TXs)
const tonApiEndpoint =
  process.env.TONCENTER_ENDPOINT ||
  'https://toncenter.com/api/v2/jsonRPC'

const provider = new TonWeb.HttpProvider(tonApiEndpoint, {
  apiKey: TONCENTER_API_KEY || undefined
})

const tonweb = new TonWeb(provider)

/**
 * Build server wallet object from mnemonic
 */
async function getServerWallet() {
  if (!TON_MNEMONIC) {
    throw new Error('TON_MNEMONIC env not set')
  }

  const words = TON_MNEMONIC.trim().split(/\s+/)
  if (words.length !== 24) {
    throw new Error('TON_MNEMONIC must contain 24 words')
  }

  const seed = await tonMnemonic.mnemonicToSeed(words)
  const keyPair = TonWeb.utils.keyPairFromSeed(seed)
  const WalletClass = tonweb.wallet.all.v4R2

  const wallet = new WalletClass(tonweb.provider, {
    publicKey: keyPair.publicKey,
    wc: 0
  })

  const walletAddress = await wallet.getAddress()
  const walletAddressStr = walletAddress.toString(true, true, true)

  // optional warning if APP_WALLET doesn’t match mnemonic wallet
  if (APP_WALLET && APP_WALLET !== walletAddressStr) {
    console.warn('APP_WALLET != mnemonic wallet address', {
      APP_WALLET,
      mnemonicWallet: walletAddressStr
    })
  }

  return { wallet, keyPair, walletAddressStr }
}

// ---- helpers to query TON API (deposits) ----

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
  return (data.transactions || data.items || [])
}

/**
 * Find an incoming tx TO APP_WALLET with >= amountNano,
 * not older than maxAgeSec, and not already used (by tx hash).
 */
async function findMatchingDepositTx(
  fromAddress,          // currently unused
  amountNano,
  maxAgeSec,
  usedHashes
) {
  const now = Math.floor(Date.now() / 1000)
  const minTime = now - maxAgeSec

  const txs = await fetchAppWalletTxs()

  for (const tx of txs) {
    const utime = tx.utime || tx.now || 0
    if (utime < minTime) continue

    const hash = tx.hash || (tx.transaction_id && tx.transaction_id.hash)
    if (!hash || usedHashes.has(hash)) continue

    const inMsg = tx.in_msg || tx.in_msg_msg || tx.in_message
    if (!inMsg) continue

    const valueStr = String(inMsg.value || inMsg.amount || '0')

    let valueNano
    try {
      valueNano = BigInt(valueStr)
    } catch {
      continue
    }

    // ✅ Only require: recent, not used, and amount >= requested
    if (valueNano >= amountNano) {
      console.log('MATCHED DEPOSIT TX', {
        hash,
        utime,
        valueNano: valueNano.toString()
      })
      return { hash, utime, valueNano }
    }
  }

  return null
}
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

// sync from frontend
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

    if (!telegramId || !walletAddress || amount === undefined || amount === null) {
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

    const maxTries = 6
    const delayMs = 5000
    let found = null

    for (let i = 0; i < maxTries; i++) {
      try {
        found = await findMatchingDepositTx(
          walletAddress,
          targetNano,
          10 * 60,
          usedHashes
        )
      } catch (e) {
        console.error('findMatchingDepositTx error:', e)
      }

      if (found) break
      if (i < maxTries - 1) {
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

// ✅ AUTO-WITHDRAW: send TON from app wallet to user wallet
router.post('/withdraw', express.json(), async (req, res) => {
  try {
    const { telegramId, username, amount, walletAddress } = req.body || {}

    if (!telegramId || !walletAddress || amount === undefined || amount === null) {
      return res
        .status(400)
        .json({ ok: false, error: 'Missing telegramId, walletAddress or amount' })
    }

    const amountNumber = Number(amount)
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res.status(400).json({ ok: false, error: 'Bad amount' })
    }

    const wallet = getWallet(telegramId, username)

    if (amountNumber > wallet.balance) {
      return res
        .status(400)
        .json({ ok: false, error: 'Insufficient balance' })
    }

    // make sure server wallet is configured
    const { wallet: serverWallet, keyPair } = await getServerWallet()

    const nanoAmount = TonWeb.utils.toNano(amountNumber.toString())

    const seqno = await serverWallet.methods.seqno().call()

    await serverWallet.methods
      .transfer({
        secretKey: keyPair.secretKey,
        toAddress: walletAddress,
        amount: nanoAmount,
        seqno,
        payload: 'Dice withdraw',
        sendMode: 3
      })
      .send()

    // update local balance AFTER sending
    wallet.balance -= amountNumber

    const historyItem = {
      id: Date.now(),
      type: 'withdraw',
      amount: amountNumber,
      currency: 'TON',
      createdAt: new Date().toISOString(),
      playerName: wallet.username
    }

    wallet.history = [historyItem, ...wallet.history]

    return res.json({
      ok: true,
      balance: wallet.balance,
      history: wallet.history
    })
  } catch (err) {
    console.error('withdraw error:', err)
    return res
      .status(500)
      .json({ ok: false, error: 'Internal server error during withdraw' })
  }
})

module.exports = router