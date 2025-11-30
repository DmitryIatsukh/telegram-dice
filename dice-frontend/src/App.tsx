import React, { useEffect, useState } from 'react'
import {
  TonConnectUIProvider,
  TonConnectButton,
  useTonConnectUI,
  useTonWallet
} from '@tonconnect/ui-react'

const API = '/api'
const APP_WALLET = 'UQDRU4eufYrTa3Cqj-f2lOSUNJNT06V0RnANtOttEOUoEV8O'
const API_BASE = import.meta.env.VITE_BACKEND_URL || ''

type Player = {
  id: string
  name: string
  isReady: boolean
  roll: number | null
}

type GameResult = {
  winnerId: string
  winnerName: string
  highest: number
  players: { id: string; name: string; roll: number }[]
} | null

type LobbyGame = {
  round: number
  p1Roll: number | null
  p2Roll: number | null
  revealP1: boolean
  revealP2: boolean
  step: 'idle' | 'p1' | 'p2' | 'done'
  winnerTelegramId: string | null
}

type LobbyStatus = 'open' | 'countdown' | 'rolling' | 'finished'

type Lobby = {
  id: number
  players: Player[]
  status: LobbyStatus
  creatorId: string | null
  creatorName: string | null
  isPrivate: boolean
  betAmount?: number
  maxPlayers?: number
  gameResult: GameResult
  name?: string
  lobbyName?: string

  // new from backend:
  autoStartAt?: number
  game?: LobbyGame
}

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

type Page = 'lobbies' | 'profile' | 'game'

function App() {
  const TON_MANIFEST_URL =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname.includes('ngrok'))
      ? 'https://ton-connect.github.io/demo-dapp/tonconnect-manifest.json'
      : `${window.location.origin}/tonconnect-manifest.json`

  return (
    <TonConnectUIProvider manifestUrl={TON_MANIFEST_URL}>
      <DiceApp />
    </TonConnectUIProvider>
  )
}

// helper: dice roll is always between 1 and 6 for display
const normalizeRoll = (roll: number | null | undefined): number => {
  if (!roll || roll < 1) return 1
  if (roll > 6) return 6
  return roll
}

function DiceApp() {
  const [lobbies, setLobbies] = useState<Lobby[]>([])
  const [status, setStatus] = useState('Loading...')

  const [currentUser, setCurrentUser] = useState<{
    id: string
    name: string
    username?: string
    avatarUrl?: string
  } | null>(null)

  const [selectedLobbyId, setSelectedLobbyId] = useState<number | null>(null)

  // create / join
  const [createMode, setCreateMode] = useState<'public' | 'private'>('public')
const [newLobbySize, setNewLobbySize] = useState<2>(2 as 2)
  const [createPin, setCreatePin] = useState('')
  const [joinPin, setJoinPin] = useState('')


  const [myLobbyId, setMyLobbyId] = useState<number | null>(null)

  // popups
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)

  // create lobby: name
  const [lobbyName, setLobbyName] = useState('')

  // search filters
  const [searchText, setSearchText] = useState('')
  const [searchBetMinInput, setSearchBetMinInput] = useState('')
  const [searchSize, setSearchSize] = useState<'any' | 2 | 4>('any')

  // bet input as string
  const [newLobbyBetInput, setNewLobbyBetInput] = useState<string>('1')

  // wallet + history
  const [tonBalance, setTonBalance] = useState<number>(0)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // held bets per lobby (to lock funds)
  const [heldBets, setHeldBets] = useState<Record<number, number>>({})
  const totalHeld = Object.values(heldBets).reduce((sum, v) => sum + v, 0)
  const availableBalance = tonBalance - totalHeld

  const [currentPage, setCurrentPage] = useState<Page>('lobbies')
  const [depositAmount, setDepositAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')

  const [tonConnectUI] = useTonConnectUI()
  const wallet = useTonWallet()

  const [isDepositing, setIsDepositing] = useState(false)
  const [isWithdrawing, setIsWithdrawing] = useState(false)

  // Full-screen + Telegram theming
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp
    try {
      tg?.expand && tg.expand()
      tg?.setBackgroundColor && tg.setBackgroundColor('#000814')
      tg?.setHeaderColor && tg.setHeaderColor('secondary')
    } catch {
      // ignore
    }

    const root = document.documentElement
    const body = document.body

    root.style.margin = '0'
    body.style.margin = '0'
    root.style.height = '100%'
    body.style.height = '100%'
    root.style.backgroundColor = '#000814'
    body.style.background =
      'radial-gradient(circle at top, #0044cc 0%, #001b4d 40%, #000814 100%)'
  }, [])

  // viewport tweak
  useEffect(() => {
    const meta =
      document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (meta) {
      meta.setAttribute(
        'content',
        'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
      )
    }
  }, [])

  // ---- backend: lobbies ----
  
const loadLobbies = () => {
  fetch(`${API}/lobbies`)
    .then(res => res.json())
    .then((data: any[]) => {
      const mapped: Lobby[] = data.map(raw => {
        const id = Number(raw.id)

        const players: Player[] = (raw.players || []).map((p: any) => ({
          id: String(p.telegramId || p.id),
          name: p.username || p.name || 'Player',
          isReady: false,
          roll: null
        }))

        // creator: first player or explicit creatorId
        const creatorId = raw.creatorId
          ? String(raw.creatorId)
          : players[0]?.id || null
        const creatorName =
          raw.creatorName ||
          raw.players?.[0]?.username ||
          raw.players?.[0]?.name ||
          null

        // build simple gameResult when finished
        let gameResult: GameResult = null
        if (
          raw.status === 'finished' &&
          raw.game &&
          Array.isArray(raw.players) &&
          raw.players.length === 2
        ) {
          const g = raw.game
          const p1Raw = raw.players[0]
          const p2Raw = raw.players[1]
          const p1Id = String(p1Raw.telegramId || p1Raw.id)
          const p2Id = String(p2Raw.telegramId || p2Raw.id)

          const playersResult = [
            {
              id: p1Id,
              name: p1Raw.username || p1Raw.name || 'Player 1',
              roll: g.p1Roll ?? 0
            },
            {
              id: p2Id,
              name: p2Raw.username || p2Raw.name || 'Player 2',
              roll: g.p2Roll ?? 0
            }
          ]

          const winnerId = String(g.winnerTelegramId || '')
          const winnerPlayer =
            playersResult.find(p => p.id === winnerId) || playersResult[0]
          const highest = Math.max(
            g.p1Roll ?? 0,
            g.p2Roll ?? 0
          )

          gameResult = {
            winnerId,
            winnerName: winnerPlayer.name,
            highest,
            players: playersResult
          }
        }

        const backendName = raw.lobbyName || raw.name || ''

        const lobby: Lobby = {
          id,
          players,
          status: raw.status as LobbyStatus,
          creatorId,
          creatorName,
          isPrivate: false,
          betAmount: typeof raw.bet === 'number' ? raw.bet : 1,
          maxPlayers: raw.maxPlayers || 2,
          gameResult,
          name: backendName,
          lobbyName: backendName,
          autoStartAt: raw.autoStartAt,
          game: raw.game
        }

        return lobby
      })

      setLobbies(mapped)
      setStatus('Loaded')
    })
    .catch(() => setStatus('Cannot reach backend'))
}
  useEffect(() => {
    loadLobbies()
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      loadLobbies()
    }, 1500)
    return () => clearInterval(interval)
  }, [])

  // Auto-select lobby where I am a player/creator after reload
  useEffect(() => {
    if (!currentUser) return

    const myLobbies = lobbies.filter(
      l =>
        l.creatorId === currentUser.id ||
        l.players.some(p => p.id === currentUser.id)
    )

    if (selectedLobbyId == null && myLobbies.length > 0) {
      setSelectedLobbyId(myLobbies[0].id)
      setCurrentPage('game')
    }
  }, [lobbies, currentUser, selectedLobbyId])

  const fetchWalletState = async (telegramId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/wallet/state/${telegramId}`)
      if (!res.ok) return
      const data = await res.json()
      setTonBalance(data.balance || 0)
      setHistory((data.history || []) as HistoryItem[])
    } catch (e) {
      console.log('wallet state error', e)
    }
  }

  useEffect(() => {
    if (currentUser?.id) {
      fetchWalletState(currentUser.id)
    }
  }, [currentUser?.id])

  // detect user from Telegram WebApp
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp

    let user: any = tg?.initDataUnsafe?.user

    if (!user && tg?.initData) {
      try {
        const params = new URLSearchParams(tg.initData)
        const userParam = params.get('user')
        if (userParam) {
          user = JSON.parse(userParam)
        }
      } catch (err) {
        console.log('Error parsing user from initData:', err)
      }
    }

    if (user) {
      setCurrentUser({
        id: String(user.id),
        name:
          user.username ||
          (user.first_name && user.last_name
            ? `${user.first_name} ${user.last_name}`
            : user.first_name) ||
          'Player',
        username: user.username || undefined,
        avatarUrl: user.photo_url || undefined
      })

      tg?.ready && tg.ready()
    } else {
      setCurrentUser(null)
    }
  }, [])

  // Clean up holds when lobbies list changes
  useEffect(() => {
    setHeldBets(prev => {
      const copy = { ...prev }
      const activeOpenIds = new Set(
        lobbies.filter(l => l.status === 'open').map(l => l.id)
      )
      for (const key in copy) {
        const id = Number(key)
        if (!activeOpenIds.has(id)) {
          delete copy[id]
        }
      }
      return copy
    })
  }, [lobbies])

  // auto-detect the lobby I'm in (creator or player)
  useEffect(() => {
    if (!currentUser) {
      setMyLobbyId(null)
      return
    }

    const mine = lobbies.find(
      l =>
        l.creatorId === currentUser.id ||
        l.players.some(p => p.id === currentUser.id)
    )

    setMyLobbyId(mine ? mine.id : null)
  }, [lobbies, currentUser])

 
  // ---- lobby actions ----

  const createLobby = () => {
    if (!currentUser) return

    // do not allow creating second lobby if already in one
    const existing = lobbies.find(
      l =>
        l.creatorId === currentUser.id ||
        l.players.some(p => p.id === currentUser.id)
    )
    if (existing) {
      setErrorMessage(
        `You are already in lobby #${existing.id}. Leave it before creating another.`
      )
      return
    }

    const cleaned = newLobbyBetInput.trim()
    const numeric = cleaned === '' ? 0 : Number(cleaned.replace(',', '.'))
    const newLobbyBet = isNaN(numeric) ? 0 : numeric

    if (newLobbyBet <= 0) {
      setErrorMessage('Enter bet amount first')
      return
    }

    if (newLobbyBet < 0.1) {
      setErrorMessage('Minimum bet is 0.1 TON')
      return
    }

    if (newLobbyBet > availableBalance) {
      setErrorMessage(
        "You don't have enough available balance for this bet (some funds may be held in other lobbies)"
      )
      return
    }

    if (createMode === 'private' && !/^\d{4}$/.test(createPin)) {
      setErrorMessage('Private lobby needs a 4-digit PIN')
      return
    }

    const betToSend = newLobbyBet

    fetch(`${API}/lobbies`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    telegramId: currentUser.id,
    username: currentUser.username || currentUser.name,
    avatarUrl: currentUser.avatarUrl,
    bet: betToSend
  })
})
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          console.log('createLobby error', res.status, err)
          setErrorMessage(
            err.error || `Error creating lobby (code ${res.status})`
          )
          return null
        }
        return res.json()
      })
      .then((lobby: Lobby | null) => {
        if (!lobby) return

        const finalName =
          lobbyName.trim() || lobby.lobbyName || `#${lobby.id}`

        const lobbyWithName: Lobby = {
          ...lobby,
          lobbyName: finalName
        }

        // ensure this lobby is in our state exactly once
        setLobbies(prev => {
          const filtered = prev.filter(l => l.id !== lobbyWithName.id)
          return [...filtered, lobbyWithName]
        })

        setSelectedLobbyId(lobbyWithName.id)
        setMyLobbyId(lobbyWithName.id)
        setCreatePin('')
        setLobbyName('')
        setCurrentPage('game')
        setIsCreateModalOpen(false)

        // join my own lobby
        setTimeout(() => {
          joinLobby(
            lobbyWithName.id,
            createMode === 'private' ? createPin : undefined
          )
        }, 150)
      })
  }

  const joinLobby = (id: number, pin?: string) => {
    if (!currentUser) return

    // already in some lobby? disallow joining another
    const existing = lobbies.find(
      l =>
        l.players.some(p => p.id === currentUser.id) ||
        l.creatorId === currentUser.id
    )
    if (existing && existing.id !== id) {
      setErrorMessage(
        `You are already in lobby #${existing.id}. Leave it before joining another.`
      )
      return
    }

    const lobby = lobbies.find(l => l.id === id)
    const lobbyBet = lobby?.betAmount ?? 0.1

    if (availableBalance < lobbyBet) {
      setErrorMessage(
        `You need at least ${lobbyBet.toFixed(
          2
        )} TON available to join (some funds may be held in other lobbies).`
      )
      return
    }

    fetch(`${API}/lobbies/${id}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    telegramId: currentUser.id,
    username: currentUser.name,
    avatarUrl: currentUser.avatarUrl
  })
})
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setErrorMessage(err.error || 'Cannot join lobby')
          return null
        }
        return res.json()
      })
      .then((lobbyJoined: Lobby | null) => {
        if (!lobbyJoined) return

        setLobbies(prev =>
          prev.map(l => (l.id === lobbyJoined.id ? lobbyJoined : l))
        )
        setJoinPin('')
        setSelectedLobbyId(lobbyJoined.id)
        setMyLobbyId(lobbyJoined.id)
        setCurrentPage('game')

        // hold my bet in this lobby
        const meNow = lobbyJoined.players.find(p => p.id === currentUser.id)
        if (meNow && !heldBets[lobbyJoined.id]) {
          const bet =
            typeof lobbyJoined.betAmount === 'number' &&
            lobbyJoined.betAmount > 0
              ? lobbyJoined.betAmount
              : lobbyBet

          setHeldBets(prev => ({
            ...prev,
            [lobbyJoined.id]: bet
          }))
        }
      })
  }

  const leaveLobby = (id: number) => {
    if (!currentUser) return

    fetch(`${API}/lobbies/${id}/leave`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ telegramId: currentUser.id })
})
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setErrorMessage(err.error || 'Cannot leave lobby')
          return null
        }
        return res.json()
      })
      .then((lobby: Lobby | null) => {
        if (!lobby) return
        setLobbies(prev => prev.map(l => (l.id === lobby.id ? lobby : l)))

        const stillIn = lobby.players.some(p => p.id === currentUser.id)
        if (!stillIn) {
          setHeldBets(prev => {
            const copy = { ...prev }
            delete copy[id]
            return copy
          })
          setMyLobbyId(null)
        }
      })
  }

  const cancelLobby = (id: number) => {
    if (!currentUser) return

    fetch(`${API}/lobbies/${id}/cancel`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ telegramId: currentUser.id })
})
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setErrorMessage(err.error || 'Cannot cancel lobby')
          return
        }
        setLobbies(prev => prev.filter(l => l.id !== id))
        setSelectedLobbyId(null)
        setMyLobbyId(prev => (prev === id ? null : prev))

        setHeldBets(prev => {
          const copy = { ...prev }
          delete copy[id]
          return copy
        })
      })
  }

  const selectedLobby =
    selectedLobbyId != null
      ? lobbies.find(l => l.id === selectedLobbyId) || null
      : null

  const meInSelectedLobby =
    currentUser && selectedLobby
      ? selectedLobby.players.find(p => p.id === currentUser.id)
      : undefined

  const isMeInLobby = !!meInSelectedLobby
  const isMeCreator =
    !!currentUser &&
    !!selectedLobby &&
    currentUser.id === selectedLobby.creatorId

  // TonConnect: deposit / withdraw
  const handleDeposit = async () => {
  if (!currentUser || !tonConnectUI) {
    setErrorMessage('Connect Telegram and TON wallet first.')
    return
  }

  if (!wallet?.account?.address) {
    setErrorMessage('TON wallet not connected.')
    return
  }

  if (!depositAmount || Number(depositAmount) <= 0) {
    setErrorMessage('Enter deposit amount first.')
    return
  }

  const amountNumber = Number(depositAmount)
  const fromAddress = wallet.account.address // the user wallet address (raw)

  try {
    setErrorMessage(null)
    setIsDepositing(true)

    // 1) Send tx via TonConnect
    const nanoAmount = BigInt(Math.floor(amountNumber * 1e9))

    await tonConnectUI.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 300,
      messages: [
        {
          address: APP_WALLET,
          amount: nanoAmount.toString()
        }
      ]
    })

    // 2) Ask backend to VALIDATE on chain
    //    Backend will look for a tx FROM fromAddress TO APP_WALLET with this amount
    const res = await fetch(`${API_BASE}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: currentUser.id,
        username: currentUser.username || currentUser.name,
        amount: amountNumber,
        walletAddress: fromAddress
      })
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      throw new Error(
        data.error ||
          'Deposit transaction not found on-chain yet. Try again in a few seconds.'
      )
    }

    // 3) Update local balance & history from backend
    setTonBalance(data.balance || 0)
    setHistory((data.history || []) as HistoryItem[])
    setDepositAmount('')
  } catch (err: any) {
    console.error('Deposit error:', err)
    setErrorMessage(err?.message || 'Deposit failed')
  } finally {
    setIsDepositing(false)
  }
}
  const handleWithdraw = async () => {
  if (!currentUser) {
    setErrorMessage('Telegram user not detected.')
    return
  }

  if (!wallet || !wallet.account?.address) {
    setErrorMessage('Connect your TON wallet first.')
    return
  }

  // validate input BEFORE sending to backend
  const amountNumber = Number(withdrawAmount)
  if (!withdrawAmount || !Number.isFinite(amountNumber) || amountNumber <= 0) {
    setErrorMessage('Enter a valid withdraw amount.')
    return
  }

  if (amountNumber > availableBalance) {
    setErrorMessage(
      `You can withdraw at most ${availableBalance.toFixed(
        2
      )} TON (the rest is held in active lobbies).`
    )
    return
  }

  try {
    setErrorMessage(null)
    setIsWithdrawing(true)

    const res = await fetch(`${API_BASE}/api/wallet/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: currentUser.id,
        username: currentUser.username || currentUser.name,
        amount: amountNumber,                     // already valid number
        walletAddress: wallet.account.address     // <-- real address
      })
    })

    const data = await res.json()
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Withdraw failed on server')
    }

    setTonBalance(data.balance || 0)
    setHistory((data.history || []) as HistoryItem[])
    setWithdrawAmount('')
  } catch (err: any) {
    console.error('Withdraw error:', err)
    setErrorMessage(err?.message || 'Withdraw failed')
  } finally {
    setIsWithdrawing(false)
  }
}

  // sync wallet to backend whenever balance/history change
  useEffect(() => {
    if (!currentUser) return

    ;(async () => {
      try {
        await fetch(`${API_BASE}/api/wallet/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegramId: currentUser.id,
            username: currentUser.username || currentUser.name,
            balance: tonBalance,
            history
          })
        })
      } catch (e) {
        console.log('wallet sync error', e)
      }
    })()
  }, [currentUser, tonBalance, history])

  // ---------------- LOADING SCREEN ----------------
  const spinnerStyles = `
@keyframes dice-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`

  if (status === 'Loading...') {
    return (
      <>
        <style>{spinnerStyles}</style>
        <div
          style={{
            fontFamily: 'sans-serif',
            minHeight: '100vh',
            background:
              'radial-gradient(circle at top, #0044cc 0%, #001b4d 40%, #000814 100%)',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            textAlign: 'center'
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              textShadow: '0 0 12px #ff0080cc'
            }}
          >
            The Dice
          </div>
          <div
            style={{
              width: 70,
              height: 70,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 30% 30%, #ffffff 0%, #ffe4f2 35%, #f472b6 70%, #7c2d89 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 20px rgba(255,0,128,0.9)',
              animation: 'dice-spin 1.1s linear infinite'
            }}
          >
            <span style={{ fontSize: 36 }}>🎲</span>
          </div>
          <div style={{ fontSize: 13, color: '#d1d5db' }}>
            Loading your lucky table...
          </div>
        </div>
      </>
    )
  }

  // helper: creator vs others row with avatar for current user
  const renderLobbyVsRow = (lobby: Lobby) => {
    const creatorName = lobby.creatorName || 'Creator'
    const creatorPlayer: { id: string; name: string } = {
      id: lobby.creatorId || 'creator',
      name: creatorName
    }

    const otherPlayers = lobby.players
      .filter(p => p.id !== lobby.creatorId)
      .slice(0, 3)

    const all = [creatorPlayer, ...otherPlayers]
    if (all.length === 0) return null

    return (
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap'
        }}
      >
        {all.map((p, idx) => {
          const isMe = currentUser && p.id === currentUser.id
          const avatarUrl = isMe ? currentUser!.avatarUrl : undefined
          const initial = p.name.charAt(0).toUpperCase()

          return (
            <React.Fragment key={p.id + '-' + idx}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: 60
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    overflow: 'hidden'
                  }}
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={p.name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                  ) : (
                    <span>{initial}</span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    marginTop: 3,
                    textAlign: 'center',
                    color: '#e5e7eb',
                    maxWidth: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {p.name}
                </div>
              </div>
              {idx < all.length - 1 && (
                <span style={{ fontSize: 11, opacity: 0.7 }}>vs</span>
              )}
            </React.Fragment>
          )
        })}
      </div>
    )
  }

  // ---- profile page ----
  const renderProfilePage = () => {
    if (!currentUser) {
      return (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 16, marginBottom: 10 }}>
            Telegram user not detected
          </div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            Open this app through your bot’s WebApp button.
          </div>
          <div style={{ marginTop: 20 }}>
            <TonConnectButton />
          </div>
        </div>
      )
    }

    const initial = currentUser.name.charAt(0).toUpperCase()
    const shortAddress =
      wallet?.account?.address && wallet.account.address.length > 12
        ? wallet.account.address.slice(0, 6) +
          '...' +
          wallet.account.address.slice(-4)
        : wallet?.account?.address

    return (
      <div style={{ padding: 10, paddingBottom: 40 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 20
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              overflow: 'hidden',
              background:
                'radial-gradient(circle at 30% 30%, #ffe53b 0%, #ff0080 45%, #2d1b55 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 12px rgba(255,0,128,0.9)'
            }}
          >
            {currentUser.avatarUrl ? (
              <img
                src={currentUser.avatarUrl}
                alt='Avatar'
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 26, fontWeight: 'bold' }}>{initial}</span>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#b197fc' }}>
              {currentUser.username
                ? '@' + currentUser.username
                : currentUser.name}
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                textShadow: '0 0 8px rgba(255,255,255,0.3)'
              }}
            >
              {currentUser.name}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#a5b4fc' }}>
              {wallet ? (
                <>
                  ✅ Wallet connected:{' '}
                  <span style={{ fontFamily: 'monospace' }}>{shortAddress}</span>
                </>
              ) : (
                'Connect your TON wallet to deposit/withdraw.'
              )}
            </div>
          </div>
          <div style={{ transform: 'scale(0.9)' }}>
            <TonConnectButton />
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            background:
              'linear-gradient(135deg, rgba(0,25,70,0.92), rgba(0,18,60,0.97))',
            borderRadius: 16,
            padding: 16,
            border: '1px solid rgba(0,150,255,0.25)',
            marginBottom: 22,
            boxShadow: '0 0 18px rgba(0,100,255,0.45)'
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700 }}>🎲 Dice Balance</div>
            <div
              style={{
                fontSize: 11,
                color: '#b197fc',
                textTransform: 'uppercase',
                letterSpacing: '0.12em'
              }}
            >
              TON CASINO
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              flexWrap: 'wrap'
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  color: '#b3b3ff',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background:
                      'radial-gradient(circle at 30% 30%, #40cfff 0%, #007bff 60%, #003366 100%)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    boxShadow: '0 0 8px rgba(64,207,255,0.7)'
                  }}
                >
                  T
                </span>
                TON balance
              </div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  textShadow: '0 0 12px rgba(64,207,255,0.8)'
                }}
              >
                {availableBalance.toFixed(2)}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#9ca3af',
                  marginTop: 2
                }}
              >
                Total: {tonBalance.toFixed(2)} TON · Held: {totalHeld.toFixed(2)}{' '}
                TON
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, marginBottom: 4, color: '#c7d2fe' }}>
                  💰 Deposit (TonConnect)
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    alignItems: 'center'
                  }}
                >
                  <input
                    placeholder='Amount'
                    value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                    style={{
                      flex: '1 1 130px',
                      minWidth: 130,
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid #555',
                      background: '#050511',
                      color: '#fff',
                      fontSize: 12
                    }}
                  />
                  <button
                    onClick={handleDeposit}
                    disabled={isDepositing}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: 'none',
                      background:
                        'linear-gradient(135deg, #00d65c 0%, #25ff9a 50%, #eaffd0 100%)',
                      color: '#0c1b16',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: isDepositing ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap',
                      opacity: isDepositing ? 0.6 : 1,
                      width: 'auto',
                      textAlign: 'center'
                    }}
                  >
                    {isDepositing ? 'Processing…' : '💸 Deposit'}
                  </button>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: '#fed7aa' }}>
                  🏧 Withdraw (internal for now)
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    alignItems: 'center'
                  }}
                >
                  <input
                    placeholder='Amount'
                    value={withdrawAmount}
                    onChange={e => setWithdrawAmount(e.target.value)}
                    style={{
                      flex: '1 1 130px',
                      minWidth: 130,
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid #555',
                      background: '#050511',
                      color: '#fff',
                      fontSize: 12
                    }}
                  />
                  <button
                    onClick={handleWithdraw}
                    disabled={isWithdrawing}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: 'none',
                      background:
                        'linear-gradient(135deg, #f97316 0%, #fb7185 50%, #fee2e2 100%)',
                      color: '#111827',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: isWithdrawing ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap',
                      opacity: isWithdrawing ? 0.6 : 1,
                      width: 'auto',
                      textAlign: 'center'
                    }}
                  >
                    {isWithdrawing ? 'Processing…' : '📤 Withdraw'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af' }}>
            Deposit sends real TON to app wallet via TonConnect. Withdraw is
            internal until backend payout is implemented.
          </div>
        </div>

        <div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              marginBottom: 10
            }}
          >
            📜 Balance history
          </div>
          {history.length === 0 && (
            <div style={{ fontSize: 14, color: '#888' }}>No history yet</div>
          )}
          <div
            style={{
              maxHeight: 260,
              overflowY: 'auto',
              paddingRight: 4
            }}
          >
            {history.map(item => {
              let label = ''
              let color = '#fff'
              let icon = '💰'
              let sign = ''

              if (item.type === 'deposit') {
                sign = '+'
                label = 'Deposit'
                color = '#00ff9d'
                icon = '💸'
              } else if (item.type === 'withdraw') {
                sign = '-'
                label = 'Withdraw'
                color = '#ffe66b'
                icon = '📤'
              } else if (item.type === 'bet') {
                sign =
                  item.result === 'win'
                    ? '+'
                    : item.result === 'lose'
                    ? '-'
                    : ''
                label =
                  item.result === 'win'
                    ? 'Bet — Win'
                    : item.result === 'lose'
                    ? 'Bet — Lose'
                    : 'Bet'
                color =
                  item.result === 'win'
                    ? '#00ff9d'
                    : item.result === 'lose'
                    ? '#ff4d6a'
                    : '#ffffff'
                icon = item.result === 'win' ? '🎉' : '🎲'
              }

              return (
                <div
                  key={item.id}
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(0,25,60,0.9), rgba(0,15,40,0.95))',
                    borderRadius: 10,
                    padding: 10,
                    border: '1px solid rgba(0,150,255,0.2)',
                    marginBottom: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: '0 0 12px rgba(0,100,255,0.35)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background:
                          item.type === 'bet'
                                                        ? 'radial-gradient(circle at 30% 30%, #4dafff 0%, #005eff 60%, #00122b 100%)'
                            : item.type === 'deposit'
                            ? 'radial-gradient(circle at 30% 30%, #a8ff78 0%, #78ffd6 60%, #1b4332 100%)'
                            : 'radial-gradient(circle at 30% 30%, #f6d365 0%, #fda085 60%, #4a1c40 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                        boxShadow: '0 0 10px rgba(0,0,0,0.7)'
                      }}
                    >
                      {icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, color }}>{label}</div>
                      <div style={{ fontSize: 11, color: '#aaa' }}>
                        {item.createdAt}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#fff'
                      }}
                    >
                      {sign} {item.amount.toFixed(2)} {item.currency}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ---- single game / lobby page ----
    const renderGamePage = () => {
    const lobbyForGame: Lobby | null = selectedLobby

    if (!lobbyForGame) {
      return (
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 14 }}>
            You are not in any lobby yet. Go to the Lobbies tab and join or
            create one.
          </p>
        </div>
      )
    }

    const gameFinished = lobbyForGame.status === 'finished'
    const selectedGameResult = lobbyForGame.gameResult

    // server-driven countdown (from backend autoStartAt)
    let countdownSeconds: number | null = null
    if (
      lobbyForGame.status === 'countdown' &&
      typeof lobbyForGame.autoStartAt === 'number'
    ) {
      countdownSeconds = Math.max(
        0,
        Math.ceil((lobbyForGame.autoStartAt - Date.now()) / 1000)
      )
    }

    const gameLobbyTitle = (lobbyForGame.lobbyName || '').trim()
    const gameLabel = gameLobbyTitle
      ? `Lobby: ${gameLobbyTitle}`
      : `Lobby: #${lobbyForGame.id}`

    const isMyLobby = myLobbyId === lobbyForGame.id
    const isActionLocked =
      lobbyForGame.status === 'countdown' || lobbyForGame.status === 'rolling'

    return (
      <div
        style={{
          padding: 16,
          paddingBottom: 40
        }}
      >
        {/* Lobby title + id */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 8,
            justifyContent: 'space-between',
            gap: 8
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {gameLabel}{' '}
            {lobbyForGame.isPrivate && (
              <span
                style={{
                  fontSize: 11,
                  background:
                    'linear-gradient(135deg, #ff4d6a 0%, #ff9a9e 100%)',
                  padding: '2px 8px',
                  borderRadius: 999,
                  marginLeft: 6,
                  color: '#111'
                }}
              >
                Private
              </span>
            )}
          </h3>
          <span
            style={{
              fontSize: 11,
              opacity: 0.9,
              padding: '2px 6px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.25)'
            }}
          >
            #{lobbyForGame.id}
          </span>
        </div>

        <p style={{ fontSize: 13, color: '#ccc' }}>
          Status: {lobbyForGame.status}
        </p>
        <p style={{ fontSize: 13, color: '#ccc' }}>
          Creator: {lobbyForGame.creatorName || 'not set'}
        </p>
        <p style={{ fontSize: 13, color: '#ccc' }}>
          Bet: {(lobbyForGame.betAmount ?? 1).toFixed(2)} TON
        </p>
        <p style={{ marginTop: 10, fontSize: 13 }}>
          Players:{' '}
          {[
            `${lobbyForGame.creatorName} (creator)`,
            ...lobbyForGame.players
              .filter(p => p.id !== lobbyForGame.creatorId)
              .map(p => p.name)
          ].join(', ')}
        </p>

        {/* Row with avatars vs */}
        {renderLobbyVsRow(lobbyForGame)}

        {/* private lobby PIN input */}
        {lobbyForGame.isPrivate && (
          <div style={{ marginTop: 10 }}>
            <span style={{ fontSize: 14 }}>PIN: </span>
            <input
              type='password'
              value={joinPin}
              maxLength={4}
              onChange={e => setJoinPin(e.target.value.replace(/\D/g, ''))}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid #555',
                background: '#050511',
                color: '#fff',
                width: 80
              }}
            />
          </div>
        )}

        {/* join / leave / cancel buttons */}
        {!gameFinished && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginTop: 12
            }}
          >
            {!isMeCreator && (
              <button
                disabled={isActionLocked}
                onClick={() =>
                  isMeInLobby
                    ? leaveLobby(lobbyForGame.id)
                    : joinLobby(
                        lobbyForGame.id,
                        lobbyForGame.isPrivate ? joinPin : undefined
                      )
                }
                style={{
                  padding: '8px 16px',
                  minWidth: 120,
                  borderRadius: 999,
                  border: 'none',
                  cursor: isActionLocked ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  background: isMeInLobby
                    ? 'linear-gradient(135deg, #f97316 0%, #fb7185 50%, #fee2e2 100%)'
                    : 'linear-gradient(135deg, #00d4ff 0%, #0074ff 60%, #4a00e0 100%)',
                  color: isMeInLobby ? '#111827' : '#fff',
                  boxShadow: '0 0 12px rgba(0,0,0,0.4)',
                  textAlign: 'center',
                  opacity: isActionLocked ? 0.6 : 1
                }}
              >
                {isMeInLobby ? 'Leave lobby' : 'Join lobby'}
              </button>
            )}

            {isMeCreator && (
              <button
                disabled={isActionLocked}
                onClick={() => cancelLobby(lobbyForGame.id)}
                style={{
                  padding: '8px 16px',
                  minWidth: 120,
                  borderRadius: 999,
                  border: 'none',
                  cursor: isActionLocked ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  background:
                    'linear-gradient(135deg, #ff4d6a 0%, #ff0000 40%, #8b0000 100%)',
                  color: '#fff',
                  boxShadow: '0 0 12px rgba(0,0,0,0.4)',
                  textAlign: 'center',
                  opacity: isActionLocked ? 0.6 : 1
                }}
              >
                Cancel lobby
              </button>
            )}
          </div>
        )}

        {/* server-driven countdown */}
        {countdownSeconds !== null &&
          lobbyForGame.status === 'countdown' &&
          isMyLobby && (
            <p
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginTop: 10,
                textAlign: 'center',
                color: '#facc15'
              }}
            >
              Game starts in {countdownSeconds}s
            </p>
          )}

        {lobbyForGame.status === 'rolling' && (
          <p
            style={{
              fontSize: 16,
              fontWeight: 600,
              marginTop: 10,
              textAlign: 'center',
              color: '#a5b4fc'
            }}
          >
            Rolling the dice…
          </p>
        )}

        {/* game result / rolling block */}
        {selectedGameResult && (
          <div style={{ marginTop: 14 }}>
            <h4>Game Result:</h4>
            <p>
              Winner: {selectedGameResult.winnerName} (roll{' '}
              {selectedGameResult.highest})
            </p>

            <ul>
              {selectedGameResult.players.map(player => (
                <li key={player.id}>
                  {player.name}: rolled {normalizeRoll(player.roll)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  // ---- FILTERS for lobbies ----
  const isSearchEmpty =
    !searchText.trim() && !searchBetMinInput.trim() && searchSize === 'any'

  const matchesFilters = (lobby: Lobby) => {
    const q = searchText.trim().toLowerCase()
    if (q) {
      const displayName = (lobby.lobbyName || lobby.name || '').toLowerCase()
      const creatorMatch = (lobby.creatorName || '').toLowerCase().includes(q)
      const playersMatch = lobby.players.some(p =>
        p.name.toLowerCase().includes(q)
      )
      const idMatch = lobby.id.toString().includes(q)

      if (
        !displayName.includes(q) &&
        !creatorMatch &&
        !playersMatch &&
        !idMatch
      ) {
        return false
      }
    }

    if (searchBetMinInput.trim()) {
      const maxBet = Number(searchBetMinInput.replace(',', '.'))
      if (!isNaN(maxBet) && maxBet > 0) {
        const bet = lobby.betAmount ?? 0
        if (bet > maxBet) return false
      }
    }

    if (searchSize !== 'any') {
      const size = lobby.maxPlayers ?? lobby.players.length
      if (size !== searchSize) return false
    }

    return true
  }

  const visibleLobbies = lobbies.filter(matchesFilters)

  const totalActiveLobbies = lobbies.filter(l => l.status === 'open').length
  const filteredActiveLobbies = lobbies.filter(
    l => l.status === 'open' && matchesFilters(l)
  ).length

  const lobbiesCountToShow = isSearchEmpty
    ? totalActiveLobbies
    : filteredActiveLobbies

  // ---- lobbies page ----
  const renderLobbiesPage = () => (
    <>
      <div
        style={{
          margin: '10px 0 14px',
          padding: 10,
          background: 'rgba(0,20,60,0.85)',
          borderRadius: 12,
          border: '1px solid rgba(0,120,255,0.2)',
          boxShadow: '0 0 18px rgba(0,80,255,0.25)'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            marginBottom: 4
          }}
        >
          <button
            onClick={() => setIsSearchModalOpen(true)}
            style={{
              flex: 1,
              padding: '9px 0',
              background:
                'linear-gradient(135deg, #4bbaff 0%, #5bc9ff 50%, #84d8ff 100%)',
              color: '#000',
              border: 'none',
              borderRadius: 999,
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 14,
              boxShadow: '0 0 12px rgba(80,180,255,0.7)'
            }}
          >
            🔎 Search
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            style={{
              flex: 1,
              padding: '9px 0',
              background:
                'linear-gradient(135deg, #ff0080 0%, #ff8c00 50%, #ffe53b 100%)',
              color: '#111',
              border: 'none',
              borderRadius: 999,
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 14,
              boxShadow: '0 0 14px rgba(255,0,128,0.8)'
            }}
          >
            ➕ Create
          </button>
        </div>

        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: '#e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>{lobbiesCountToShow} lobbies</span>
          <button
            onClick={loadLobbies}
            style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.25)',
              background: 'rgba(255,255,255,0.03)',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      <h2 style={{ marginTop: 4, marginBottom: 8 }}>Lobbies:</h2>

      {visibleLobbies.length === 0 && <p>No lobbies match your search</p>}

      {visibleLobbies.map(lobby => {
        const title = (lobby.lobbyName || '').trim()
        const label = title ? `Lobby: ${title}` : `Lobby: #${lobby.id}`

        return (
          <div
            key={lobby.id}
            style={{
              padding: 12,
              marginBottom: 10,
              background:
                'linear-gradient(135deg, rgba(0,30,80,0.9), rgba(0,15,40,0.95))',
              borderRadius: 10,
              border: '1px solid rgba(0,120,255,0.25)',
              boxShadow: '0 0 14px rgba(0,80,255,0.4)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
                gap: 8
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 700
                  }}
                >
                  {label}{' '}
                  {lobby.isPrivate && (
                    <span
                      style={{
                        fontSize: 11,
                        background:
                          'linear-gradient(135deg, #ff4d6a 0%, #ff9a9e 100%)',
                        padding: '2px 8px',
                        borderRadius: 999,
                        marginLeft: 6,
                        color: '#111',
                        fontWeight: 600
                      }}
                    >
                      Private
                    </span>
                  )}
                </h3>
              </div>
              <span
                style={{
                  fontSize: 11,
                  opacity: 0.9,
                  padding: '2px 6px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.25)'
                }}
              >
                #{lobby.id}
              </span>
            </div>

            <p style={{ fontSize: 13, color: '#ccc' }}>Status: {lobby.status}</p>
            <p style={{ fontSize: 13, color: '#ccc' }}>
              Creator: {lobby.creatorName || 'not set yet (no players)'}
            </p>
            <p style={{ fontSize: 13, color: '#ccc' }}>
              Players: {lobby.players.length}
              {lobby.maxPlayers ? ` / ${lobby.maxPlayers}` : ''}
            </p>
            <p style={{ fontSize: 13, color: '#ccc' }}>
              Bet: {(lobby.betAmount ?? 1).toFixed(2)} TON
            </p>

            {renderLobbyVsRow(lobby)}

            {lobby.status === 'finished' && lobby.gameResult && (
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <div style={{ color: '#bbf7d0' }}>
                  Winner:{' '}
                  <span style={{ fontWeight: 700 }}>
                    {lobby.gameResult.winnerName}
                  </span>{' '}
                  (roll {lobby.gameResult.highest})
                </div>

                {currentUser &&
                  (() => {
                    const me = lobby.gameResult!.players.find(
                      p => p.id === currentUser.id
                    )
                    if (!me) return null
                    const didWin =
                      lobby.gameResult!.winnerId === currentUser.id
                    return (
                      <div
                        style={{
                          marginTop: 2,
                          color: didWin ? '#22c55e' : '#f97316'
                        }}
                      >
                        You {didWin ? 'won' : 'lost'} with roll{' '}
                        {normalizeRoll(me.roll)}
                      </div>
                    )
                  })()}
              </div>
            )}

            <button
              onClick={() => {
                setSelectedLobbyId(lobby.id)
                setCurrentPage('game')
              }}
              style={{
                padding: '7px 16px',
                background:
                  'linear-gradient(135deg, #00d4ff 0%, #0074ff 60%, #4a00e0 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: 999,
                cursor: 'pointer',
                marginTop: 8,
                fontSize: 13,
                fontWeight: 600,
                boxShadow: '0 0 12px rgba(0,116,255,0.8)'
              }}
            >
              {lobby.status === 'finished' ? 'View result' : 'Open Lobby'}
            </button>
          </div>
        )
      })}
    </>
  )

  // ---- banner: global wins ----
  const finishedLobbies = lobbies.filter(
    l =>
      l.status === 'finished' &&
      l.gameResult &&
      Array.isArray(l.gameResult.players) &&
      l.gameResult.players.length > 1
  )

  const lastFinishedLobby =
    finishedLobbies.length > 0
      ? finishedLobbies[finishedLobbies.length - 1]
      : null

  const lastGlobalWin = lastFinishedLobby
    ? {
        winnerName: lastFinishedLobby.gameResult!.winnerName,
        amount:
          (lastFinishedLobby.betAmount ?? 1) *
          (lastFinishedLobby.gameResult!.players.length - 1)
      }
    : null

  const biggestGlobalWin = finishedLobbies.reduce<
    { winnerName: string; amount: number } | null
  >((max, lobby) => {
    const gr = lobby.gameResult!
    const amount = (lobby.betAmount ?? 1) * (gr.players.length - 1)
    if (!max || amount > max.amount) {
      return { winnerName: gr.winnerName, amount }
    }
    return max
  }, null)

  // ---- main frame ----
  return (
    <div
      style={{
        fontFamily: 'sans-serif',
        minHeight: '100vh',
        width: '100%',
        boxSizing: 'border-box',
        background:
          'radial-gradient(circle at top, #0044cc 0%, #001b4d 40%, #000814 100%)',
        color: '#fff',
        padding: 16,
        paddingBottom: 100,
        position: 'relative'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 10
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            textShadow: '0 0 10px rgba(255,0,128,0.8)'
          }}
        >
          THE DICE 🎲
        </div>
      </div>

      {(lastGlobalWin || biggestGlobalWin) && (
        <div
          style={{
            marginBottom: 14,
            padding: 10,
            borderRadius: 14,
            background:
              'linear-gradient(135deg, rgba(0,40,100,0.95), rgba(60,10,90,0.98))',
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            boxShadow: '0 0 18px rgba(255,0,128,0.4)',
            fontSize: 12
          }}
        >
          {lastGlobalWin && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ opacity: 0.8 }}>Last win:</span>
              <span>
                🎉 <b>{lastGlobalWin.winnerName}</b> won{' '}
                <b>{lastGlobalWin.amount.toFixed(2)} TON</b>
              </span>
            </div>
          )}

          {biggestGlobalWin && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ opacity: 0.8 }}>Biggest win:</span>
              <span>
                👑 <b>{biggestGlobalWin.winnerName}</b> won{' '}
                <b>{biggestGlobalWin.amount.toFixed(2)} TON</b>
              </span>
            </div>
          )}
        </div>
      )}

      {currentPage === 'lobbies' && renderLobbiesPage()}
      {currentPage === 'profile' && renderProfilePage()}
      {currentPage === 'game' && renderGamePage()}

      {/* CREATE LOBBY POPUP */}
      {isCreateModalOpen && (
        <div
          onClick={() => setIsCreateModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9998
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'linear-gradient(135deg, #020617, #0b1120)',
              padding: 16,
              borderRadius: 16,
              width: '90%',
              maxWidth: 360,
              boxSizing: 'border-box',
              margin: '0 16px',
              border: '1px solid rgba(96,165,250,0.6)',
              boxShadow: '0 0 24px rgba(56,189,248,0.8)',
              color: '#fff',
              fontSize: 13
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                marginBottom: 10
              }}
            >
              Create lobby
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 2 }}>Lobby name</div>
              <input
                placeholder='My lucky table'
                value={lobbyName}
                onChange={e => setLobbyName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid #555',
                  background: '#020617',
                  color: '#fff',
                  fontSize: 12,
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 2 }}>Bet amount (TON)</div>
              <input
                type='number'
                step={0.1}
                placeholder='0.1 eg'
                value={newLobbyBetInput}
                onChange={e => setNewLobbyBetInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid #555',
                  background: '#020617',
                  color: '#fff',
                  fontSize: 12,
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 2 }}>Lobby size</div>
              <label style={{ marginRight: 10, fontSize: 12 }}>
                <input
                  type='radio'
                  checked={newLobbySize === 2}
                  onChange={() => setNewLobbySize(2)}
                  style={{ marginRight: 4 }}
                />
                2 players
              </label>
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 2 }}>Visibility</div>
              <label style={{ marginRight: 10, fontSize: 12 }}>
                <input
                  type='radio'
                  checked={createMode === 'public'}
                  onChange={() => setCreateMode('public')}
                  style={{ marginRight: 4 }}
                />
                Public
              </label>
              <label style={{ fontSize: 12 }}>
                <input
                  type='radio'
                  checked={createMode === 'private'}
                  onChange={() => setCreateMode('private')}
                  style={{ marginRight: 4 }}
                />
                Private
              </label>
            </div>

            {createMode === 'private' && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ marginBottom: 2 }}>PIN (4 digits)</div>
                <input
                  type='password'
                  value={createPin}
                  maxLength={4}
                  onChange={e =>
                    setCreatePin(e.target.value.replace(/\D/g, ''))
                  }
                  style={{
                    width: '100%',
                    padding: '5px 8px',
                    borderRadius: 6,
                    border: '1px solid #555',
                    background: '#020617',
                    color: '#fff',
                    fontSize: 12,
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 6
              }}
            >
              <button
                onClick={() => setIsCreateModalOpen(false)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'rgba(148,163,184,0.3)',
                  color: '#e5e7eb',
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={createLobby}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: 'none',
                  background:
                    'linear-gradient(135deg, #22c55e 0%, #a3e635 100%)',
                  color: '#022c22',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEARCH POPUP */}
      {isSearchModalOpen && (
        <div
          onClick={() => setIsSearchModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9998
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'linear-gradient(135deg, #020617, #0b1120)',
              padding: 16,
              borderRadius: 16,
              width: '90%',
              maxWidth: 360,
              boxSizing: 'border-box',
              margin: '0 16px',
              border: '1px solid rgba(96,165,250,0.6)',
              boxShadow: '0 0 24px rgba(56,189,248,0.8)',
              color: '#fff',
              fontSize: 13
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                marginBottom: 10
              }}
            >
              Search lobbies
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 2 }}>
                Text (lobby name / creator / players)
              </div>
              <input
                placeholder='Type something...'
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid #555',
                  background: '#020617',
                  color: '#fff',
                  fontSize: 12,
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 2 }}>Max bet amount (TON)</div>
              <input
                type='number'
                step={0.1}
                placeholder='0.1'
                value={searchBetMinInput}
                onChange={e => setSearchBetMinInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid #555',
                  background: '#020617',
                  color: '#fff',
                  fontSize: 12,
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ marginBottom: 2 }}>Lobby size</div>
              <label style={{ marginRight: 10, fontSize: 12 }}>
                <input
                  type='radio'
                  checked={searchSize === 'any'}
                  onChange={() => setSearchSize('any')}
                  style={{ marginRight: 4 }}
                />
                Any
              </label>
              <label style={{ marginRight: 10, fontSize: 12 }}>
                <input
                  type='radio'
                  checked={searchSize === 2}
                  onChange={() => setSearchSize(2)}
                  style={{ marginRight: 4 }}
                />
                2 players
              </label>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                marginTop: 6
              }}
            >
              <button
                onClick={() => {
                  setSearchText('')
                  setSearchBetMinInput('')
                  setSearchSize('any')
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'rgba(148,163,184,0.3)',
                  color: '#e5e7eb',
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Clear
              </button>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setIsSearchModalOpen(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: 'none',
                  background:
                    'linear-gradient(135deg, #4bbaff 0%, #5bc9ff 50%, #84d8ff 100%)',
                  color: '#022c22',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* bottom nav */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '4px 0 calc(env(safe-area-inset-bottom, 0px) + 8px)',
          background:
            'linear-gradient(135deg, rgba(0,40,100,0.96), rgba(0,15,60,0.96))',
          borderTop: '1px solid rgba(0,140,255,0.35)',
          display: 'flex',
          justifyContent: 'center',
          zIndex: 20
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 480,
            display: 'flex',
            gap: 8,
            padding: 4,
            borderRadius: 0
          }}
        >
          <button
            onClick={() => setCurrentPage('lobbies')}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              background:
                currentPage === 'lobbies'
                  ? 'linear-gradient(135deg, #4bbaff 0%, #5bc9ff 50%, #84d8ff 100%)'
                  : 'transparent',
              color: currentPage === 'lobbies' ? '#000' : '#fff',
              textAlign: 'center',
              boxShadow:
                currentPage === 'lobbies'
                  ? '0 0 10px rgba(80,180,255,0.6)'
                  : 'none',
              whiteSpace: 'nowrap'
            }}
          >
            Lobbies
          </button>

          <button
            onClick={() => setCurrentPage('game')}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              background:
                currentPage === 'game'
                  ? 'linear-gradient(135deg, #4bbaff 0%, #5bc9ff 50%, #84d8ff 100%)'
                  : 'transparent',
              color: currentPage === 'game' ? '#000' : '#fff',
              textAlign: 'center',
              boxShadow:
                currentPage === 'game'
                  ? '0 0 10px rgba(80,180,255,0.6)'
                  : 'none',
              whiteSpace: 'nowrap'
            }}
          >
            Game
          </button>

          <button
            onClick={() => setCurrentPage('profile')}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              background:
                currentPage === 'profile'
                  ? 'linear-gradient(135deg, #4bbaff 0%, #5bc9ff 50%, #84d8ff 100%)'
                  : 'transparent',
              color: currentPage === 'profile' ? '#000' : '#fff',
              textAlign: 'center',
              boxShadow:
                currentPage === 'profile'
                  ? '0 0 10px rgba(80,180,255,0.6)'
                  : 'none',
              whiteSpace: 'nowrap'
            }}
          >
            Profile
          </button>
        </div>
      </div>

      {errorMessage && (
        <div
          onClick={() => setErrorMessage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'pointer'
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #22001f, #000826)',
              padding: 22,
              borderRadius: 16,
              minWidth: 240,
              maxWidth: 300,
              textAlign: 'center',
              border: '1px solid rgba(255,0,128,0.6)',
              boxShadow: '0 0 28px rgba(255,0,128,0.9)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '0.5px'
            }}
          >
            {errorMessage}
            <div style={{ marginTop: 14, fontSize: 11, opacity: 0.8 }}>
              Tap anywhere to close
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App