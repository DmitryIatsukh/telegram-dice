// src/routes/walletRoutes.js

const express = require('express')
const TonWeb = require('tonweb')
const { mnemonicToKeyPair } = require('tonweb-mnemonic')

const router = express.Router()

// ----- ENV -----
const APP_WALLET = process.env.APP_WALLET || '' // same as in frontend
const TONAPI_KEY = process.env.TONAPI_KEY || ''
const TONCENTER_URL =
  process.env.TONCENTER_URL || 'https://toncenter.com/api/v2/jsonRPC'
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || ''
const APP_WALLET_MNEMONIC = process.env.APP_WALLET_MNEMONIC || ''

// ----- TONWEB (for withdrawals) -----
const tonweb = new TonWeb(
  new TonWeb.HttpProvider(TONCENTER_URL, {
    apiKey: TONCENTER_API_KEY || undefined
  })
)

let appWalletInstance = null
let appWalletKeyPair = null

async function getAppWallet() {
  if (appWalletInstance && appWalletKeyPair) {
    return { wallet: appWalletInstance, keyPair: appWalletKeyPair }
  }

  if (!APP_WALLET_MNEMONIC) {
    throw new Error('APP_WALLET_MNEMONIC is not set')
  }

  const words = APP_WALLET_MNEMONIC.trim().split(/\s+/)
  if (words.length < 12) {
    throw new Error('APP_WALLET_MNEMONIC looks invalid')
  }

  const keyPair = await mnemonicToKeyPair(words)

  const WalletClass = tonweb.wallet.all['v4R2']
  const wallet = new WalletClass(tonweb.provider, {
    publicKey: keyPair.publicKey,
    wc: 0
  })

  appWalletInstance = wallet
  appWalletKeyPair = keyPair

  return { wallet, keyPair }
}

// Send TON from app wallet to user
async function sendTon(toAddress, amountNano) {
  const { wallet, keyPair } = await getAppWallet()

  const seqno = await wallet.methods.seqno().call()

  console.log('Sending TON withdraw', {
    toAddress,
    amountNano: amountNano.toString(),
    seqno
  })

  // TonWeb expects BN; convert BigInt -> BN
  const amountBN = new TonWeb.utils.BN(amountNano.toString())

  await wallet.methods
    .transfer({
      secretKey: keyPair.secretKey,
      toAddress,
      amount: amountBN,
      seqno,
      payload: '',
      sendMode: 3
    })
    .send()

  return { ok: true }
}

// ----- in-memory wallets -----

// Types (for reference only, not real TS here)
/*
type HistoryItem = {
  id: number
  type: 'bet' | 'deposit' | 'withdraw'
  amount: number
  currency: 'TON'
  result?: 'win' | 'lose'
  createdAt: string
  playerName?: string
  txHash?: string
}

type WalletState = {
  telegramId: string
  username: string
  balance: number
  history: HistoryItem[]
}
*/

const wallets = {} // Record<string, WalletState>

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

// ---- helpers to query TON API (for deposits) ----

async function fetchAppWalletTxs() {
  const url = `https://tonapi.io/v2/blockchain/accounts/${APP_WALLET}/transactions?limit=50`
  const headers = {}
  if (TONAPI_KEY) headers.Authorization = `Bearer ${TONAPI_KEY}`

  // Node 18+ has global fetch
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
 * Find an incoming tx to APP_WALLET with >= amountNano,
 * not older than maxAgeSec, and not already used (by tx hash).
 * (We ignore fromAddress for simplicity, because of wallet abstractions.)
 */
async function findMatchingDepositTx(
  fromAddress, // still passed, but ignored
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

    // wait up to ~30s for TON API to show tx
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

// ✅ REAL ON-CHAIN WITHDRAW
router.post('/withdraw', express.json(), async (req, res) => {
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

    if (amountNumber > wallet.balance) {
      return res
        .status(400)
        .json({ ok: false, error: 'Not enough balance to withdraw' })
    }

    const amountNano = BigInt(Math.round(amountNumber * 1e9))

    // send TON on-chain from app wallet to user's wallet
    await sendTon(walletAddress, amountNano)

    // update internal wallet
    wallet.balance -= amountNumber

    const historyItem = {
      id: Date.now(),
      type: 'withdraw',
      amount: amountNumber,
      currency: 'TON',
      createdAt: new Date().toISOString(),
      playerName: wallet.username,
      txHash: null // tonweb doesn't easily give hash; can be added later
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