import { useEffect, useState } from 'react'
import {
  TonConnectUIProvider,
  TonConnectButton,
  useTonConnectUI,
  useTonWallet
} from '@tonconnect/ui-react'

const API = '/api'
const APP_WALLET = 'UQDRU4eufYrTa3Cqj-f2lOSUNJNT06V0RnANtOttEOUoEV8O'
const API_BASE =
  import.meta.env.VITE_BACKEND_URL || ""; // adjust port if needed


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

type Lobby = {
  id: number
  players: Player[]
  status: 'open' | 'finished'
  creatorId: string | null
  creatorName: string | null
  isPrivate: boolean
  betAmount?: number      // 👈 NEW
  gameResult: GameResult
}

type HistoryItem = {
  id: number
  type: 'bet' | 'deposit' | 'withdraw'
  amount: number
  currency: 'TON'
  result?: 'win' | 'lose'
  createdAt: string
  playerName?: string
}

type Page = 'lobbies' | 'profile'

function App() {
  const TON_MANIFEST_URL =
  window.location.hostname === "localhost" ||
  window.location.hostname.includes("ngrok")
    ? "https://ton-connect.github.io/demo-dapp/tonconnect-manifest.json"
    : `${window.location.origin}/tonconnect-manifest.json`;
  return (
    <TonConnectUIProvider manifestUrl={TON_MANIFEST_URL}>
      <DiceApp />
    </TonConnectUIProvider>
  )
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

  const [createMode, setCreateMode] = useState<'public' | 'private'>('public')
  const [createPin, setCreatePin] = useState('')
  const [joinPin, setJoinPin] = useState('')
// --- bet amount when creating a new lobby ---

const [newLobbyBet, setNewLobbyBet] = useState<number>(1)
  const [tonBalance, setTonBalance] = useState<number>(100.0)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

    const [userBets, setUserBets] = useState<Record<number, number>>({})
  // to avoid applying the same game result multiple times
  const [processedResults, setProcessedResults] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<Page>('lobbies')
  const [depositAmount, setDepositAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')

  const [tonConnectUI] = useTonConnectUI()
  const wallet = useTonWallet()

const [isDepositing, setIsDepositing] = useState(false);
const [isWithdrawing, setIsWithdrawing] = useState(false);


// --- TON CONNECT EVENT HANDLER ---

  // ---- make background full-screen + Telegram theming ----
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp
    try {
      tg?.expand && tg.expand()
      tg?.setBackgroundColor && tg.setBackgroundColor('#000814')
      // 'secondary' usually blends nicely with dark BG
      tg?.setHeaderColor && tg.setHeaderColor('secondary')
    } catch {
      // ignore if not in Telegram
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

  // ---- backend: lobbies ----

  const loadLobbies = () => {
    fetch(`${API}/lobbies`)
      .then(res => res.json())
      .then((data: Lobby[]) => {
        setLobbies(data)
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
  const fetchWalletState = async (telegramId: string) => {
  try {
    const res = await fetch(`${API_BASE}/api/wallet/state/${telegramId}`);
    if (!res.ok) return;
        const data = await res.json()
    setTonBalance(data.balance || 0)
    setHistory((data.history || []) as HistoryItem[])
  } catch (e) {
    console.log("wallet state error", e);
  }
};
useEffect(() => {
  if (currentUser?.id) {
    fetchWalletState(currentUser.id);
  }
}, [currentUser?.id]);


  // ---- detect user from Telegram WebApp ----

  


  // ---- decide when app is "ready" (for loading screen) ----
    useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;

    console.log("TG WebApp object:", tg);
    console.log("TG initData:", tg?.initData);
    console.log("TG initDataUnsafe:", tg?.initDataUnsafe);
    console.log("TG unsafe user:", tg?.initDataUnsafe?.user);

    let user: any = tg?.initDataUnsafe?.user;

    // 🔁 Fallback: some clients only pass user in the raw initData string
    if (!user && tg?.initData) {
      try {
        const params = new URLSearchParams(tg.initData);
        const userParam = params.get("user");
        if (userParam) {
          user = JSON.parse(userParam);
          console.log("Parsed user from initData:", user);
        }
      } catch (err) {
        console.log("Error parsing user from initData:", err);
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
          "Player",
        username: user.username || null,
        avatarUrl: user.photo_url || null
      });

      tg?.ready && tg.ready();
    } else {
      // No user found – we keep null, Profile will show the helper message
      setCurrentUser(null);
    }
  }, []);
// ---- apply game results to balance (with 5% house rake) ----
useEffect(() => {
  if (!currentUser) return;
  if (!lobbies || lobbies.length === 0) return;

 const newProcessed: Set<string> = new Set(processedResults);
  let totalDelta = 0;
  const newHistory: HistoryItem[] = [];

  for (const lobby of lobbies) {
    const gr = lobby.gameResult;
    if (!gr) continue;

    // Unique ID for this game result
    const key =
      lobby.id +
      ':' +
      gr.winnerId +
      ':' +
      gr.highest +
      ':' +
      gr.players.map(p => `${p.id}:${p.roll}`).join('|');

    if (newProcessed.has(key)) continue;

    const players = gr.players;
    const nPlayers = players.length;

    // Skip if user not in this match
    if (!players.some(p => p.id === currentUser.id)) {
      newProcessed.add(key);
      continue;
    }

    const baseBet =
      typeof lobby.betAmount === 'number' && lobby.betAmount > 0
        ? lobby.betAmount
        : 0.1;

    const pot = baseBet * nPlayers;
    const houseFee = pot * 0.05; // 5%
    const payoutAfterRake = pot - houseFee;

    const isWinner = gr.winnerId === currentUser.id;

    let deltaForUser = 0;
    let displayAmount = 0;

    if (isWinner) {
      // Balance change = net profit after rake
      deltaForUser = payoutAfterRake - baseBet; // e.g. +0.9
      displayAmount = payoutAfterRake; // show full 1.9 as win
    } else {
      deltaForUser = -baseBet;
      displayAmount = baseBet; // show 1.0 as loss
    }

    if (deltaForUser !== 0) {
      totalDelta += deltaForUser;

      const now = new Date();
      const createdAt =
        now.getFullYear() +
        '-' +
        String(now.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(now.getDate()).padStart(2, '0') +
        ' ' +
        String(now.getHours()).padStart(2, '0') +
        ':' +
        String(now.getMinutes()).padStart(2, '0');

      newHistory.push({
        id: Date.now() + Math.random(),
        type: 'bet',
        amount: displayAmount,
        currency: 'TON',
        result: isWinner ? 'win' : 'lose',
        createdAt,
        playerName: currentUser.name
      });
    }

    newProcessed.add(key);
  }

  if (totalDelta !== 0 || newHistory.length > 0) {
    setTonBalance(prev => prev + totalDelta);
    setHistory(prev => [...newHistory, ...prev].slice(0, 30));
    setProcessedResults(newProcessed); // <-- now correct type
  }
}, [lobbies, currentUser, processedResults]);
    // ---- lobby actions ----

  const createLobby = () => {
  if (!currentUser) return
  if (newLobbyBet <= 0) {
    setErrorMessage('Bet must be greater than 0')
    return
  }

  if (newLobbyBet > tonBalance) {
    setErrorMessage("You don't have enough balance for this bet")
    return
  }

  if (createMode === 'private' && !/^\d{4}$/.test(createPin)) {
    setErrorMessage('Private lobby needs a 4-digit PIN')
    return
  }
// Enforce minimum bet 0.1 TON logically (not in the input)
  const betToSend = newLobbyBet >= 0.1 ? newLobbyBet : 0.1
  fetch(`${API}/lobbies/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: currentUser.id,
      name: currentUser.username || currentUser.name,
      isPrivate: createMode === 'private',
      pin: createMode === 'private' ? createPin : undefined,
      betAmount: betToSend,           // 👈 NEW
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setErrorMessage(err.error || 'Error creating lobby')
        return null
      }
      return res.json()
    })
    .then((lobby: Lobby | null) => {
      if (!lobby) return
      setLobbies((prev) => [...prev, lobby])
      setSelectedLobbyId(lobby.id)
      setCreatePin('')
      setCurrentPage('lobbies')
    })
}

  const joinLobby = (id: number, pin?: string) => {
  if (!currentUser) return

  // 🔎 find this lobby and its bet
  const lobby = lobbies.find(l => l.id === id)
  const lobbyBet = lobby?.betAmount ?? 0.1

  // 💰 check balance vs bet
  if (tonBalance < lobbyBet) {
    setErrorMessage(
      `You need at least ${lobbyBet.toFixed(2)} TON to join this lobby.`
    )
    return
  }

  // Optional: auto-set your bet to the lobby's bet
  setUserBets(prev => ({
    ...prev,
    [id]: lobbyBet
  }))

  fetch(`${API}/lobbies/${id}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: currentUser.id,
      name: currentUser.name,
      pin
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
    .then((lobby: Lobby | null) => {
      if (!lobby) return
      setLobbies(prev => prev.map(l => (l.id === lobby.id ? lobby : l)))
      setJoinPin('')
    })
}

  const toggleReady = (id: number) => {
  if (!currentUser) return

  // get this lobby + user’s bet for it
const lobby = lobbies.find(l => l.id === id)
if (!lobby) {
  setErrorMessage('Lobby not found')
  return
}

const userBet = userBets[id] ?? 0

  // minimum bet: lobby base bet (if exists) OR 0.1
  const minBet =
    lobby.betAmount != null && lobby.betAmount > 0 ? lobby.betAmount : 0.1

  if (userBet < minBet) {
    setErrorMessage(
      `Set your bet (at least ${minBet.toFixed(2)} TON) before readying up`
    )
    return
  }

  // cannot bet more than current balance
  if (userBet > tonBalance) {
    setErrorMessage('Not enough balance for this bet.')
    return
  }

  fetch(`${API}/lobbies/${id}/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: currentUser.id })
  })
    .then(res => res.json())
    .then((lobby: Lobby) =>
      setLobbies(prev => prev.map(l => (l.id === lobby.id ? lobby : l)))
    )
}

    const startGame = (id: number) => {
    if (!currentUser) return
    fetch(`${API}/lobbies/${id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setErrorMessage(err.error || 'Cannot start game')
          return null
        }
        return res.json()
      })
      .then((lobby: Lobby | null) => {
        if (!lobby) return
        setLobbies(prev => prev.map(l => (l.id === lobby.id ? lobby : l)))

        // 🔄 refresh wallet (balance + history) after game
        if (currentUser?.id) {
          fetchWalletState(currentUser.id)
        }
      })
  }

    const selectedLobby =
    selectedLobbyId != null
      ? lobbies.find(l => l.id === selectedLobbyId) || null
      : null

  const closePopup = () => {
    setSelectedLobbyId(null)
    setJoinPin('')
  }

  // ---- TonConnect: deposit / withdraw ----

  // --- DEPOSIT via TonConnect + backend ---
const handleDeposit = async () => {
  if (!currentUser || !tonConnectUI) {
    setErrorMessage("Connect Telegram and TON wallet first.");
    return;
  }

  if (!depositAmount || Number(depositAmount) <= 0) {
    setErrorMessage("Enter deposit amount first.");
    return;
  }

  const amountNumber = Number(depositAmount);

  try {
    setErrorMessage(null);
    setIsDepositing(true);

    // 1) Send real TON from user's wallet to app wallet
    const nanoAmount = BigInt(Math.floor(amountNumber * 1e9)); // 1 TON = 1e9 nanoTON

    await tonConnectUI.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      messages: [
        {
          address: APP_WALLET,
 // you already defined this earlier
          amount: nanoAmount.toString(),
        },
      ],
    });

    // 2) Notify backend & update internal balance
    const res = await fetch(`${API_BASE}/api/wallet/deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegramId: currentUser.id,
        username: currentUser.username || currentUser.name,
        amount: amountNumber,
        txHash: null, // TonConnect v2 doesn't give hash easily; we store null for now
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Deposit failed on server");
    }

    const data = await res.json();
    setTonBalance(data.balance || 0)
    setHistory((data.history || []) as HistoryItem[])

    setDepositAmount("");
  } catch (err: any) {
    console.error("Deposit error:", err);
    setErrorMessage(err?.message || "Deposit failed");
  } finally {
    setIsDepositing(false);
  }
};


  // --- WITHDRAW request (internal) ---
const handleWithdraw = async () => {
  if (!currentUser) {
    setErrorMessage("Telegram user not detected.");
    return;
  }

  if (!withdrawAmount || Number(withdrawAmount) <= 0) {
    setErrorMessage("Enter withdraw amount first.");
    return;
  }

  const amountNumber = Number(withdrawAmount);

  try {
    setErrorMessage(null);
    setIsWithdrawing(true);

    const res = await fetch(`${API_BASE}/api/wallet/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegramId: currentUser.id,
        username: currentUser.username || currentUser.name,
        amount: amountNumber,
        walletAddress: null, // no TonConnect required yet
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Withdraw failed on server");
    }

    setTonBalance(data.balance || 0)
    setHistory((data.history || []) as HistoryItem[])
    setWithdrawAmount('')

    setErrorMessage("Withdraw request created ✅. TON will be sent soon.");
  } catch (err: any) {
    console.error("Withdraw error:", err);
    setErrorMessage(err?.message || "Withdraw failed");
  } finally {
    setIsWithdrawing(false);
  }
};

  // ---- apply finished game results to balance + history and sync wallet ----
  useEffect(() => {
    if (!currentUser) return

    // use a Set internally, but store array in state for React
    const already = new Set<number>(processedResults)
    let changed = false
    let deltaTotal = 0
    const newHistoryItems: HistoryItem[] = []

    lobbies.forEach(lobby => {
      // only finished games with a result, and not processed yet
      if (lobby.status !== 'finished') return
      if (!lobby.gameResult) return
      if (already.has(lobby.id)) return

      const betBase =
        userBets[lobby.id] ??
        (typeof lobby.betAmount === 'number' ? lobby.betAmount : 0)

      if (!betBase || betBase <= 0) return

      const isWin = lobby.gameResult.winnerId === currentUser.id
      const delta = isWin ? betBase : -betBase

      deltaTotal += delta
      changed = true
      already.add(lobby.id)

      newHistoryItems.push({
        id: Date.now() + lobby.id + Math.random(),
        type: 'bet',
        amount: Math.abs(delta),
        currency: 'TON',
        result: isWin ? 'win' : 'lose',
        createdAt: new Date().toLocaleString(),
        playerName: currentUser.name
      })
    })

    if (!changed) return

    // 1) update local balance + history
    const updatedBalance = tonBalance + deltaTotal
    const updatedHistory = [...newHistoryItems, ...history].slice(0, 50)

    setTonBalance(updatedBalance)
    setHistory(updatedHistory)
    setProcessedResults(new Set(already));

    // 2) sync wallet to backend (so reload keeps same balance)
    ;(async () => {
      try {
        await fetch(`${API_BASE}/api/wallet/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegramId: currentUser.id,
            username: currentUser.username || currentUser.name,
            balance: updatedBalance,
            history: updatedHistory
          })
        })
      } catch (e) {
        console.log('wallet sync error', e)
      }
    })()
  }, [lobbies, currentUser, userBets, processedResults, tonBalance, history])

  // ---- derived: last win & biggest win ----

  const winHistory = history.filter(h => h.type === 'bet' && h.result === 'win')
  const lastWin: HistoryItem | null = winHistory.length > 0 ? winHistory[0] : null
  const biggestWin: HistoryItem | null =
    winHistory.length > 0
      ? winHistory.reduce((max, item) => (item.amount > max.amount ? item : max), winHistory[0])
      : null

  // ---- loading screen ----

  // ---------------- LOADING SCREEN (ONLY backend, not user) ----------------
const spinnerStyles = `
@keyframes dice-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;

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
  );
}

const initial = currentUser.name.charAt(0).toUpperCase();
const shortAddress =
  wallet?.account?.address && wallet.account.address.length > 12
    ? wallet.account.address.slice(0, 6) +
      '...' +
      wallet.account.address.slice(-4)
    : wallet?.account?.address;


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
            {currentUser!.avatarUrl ? (
              <img
                src={currentUser!.avatarUrl}
                alt="Avatar"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 26, fontWeight: 'bold' }}>{initial}</span>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#b197fc' }}>
              {currentUser!.username
                ? '@' + currentUser!.username
                : currentUser!.name}
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                textShadow: '0 0 8px rgba(255,255,255,0.3)'
              }}
            >
              {currentUser!.name}
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
            {/* LEFT: balance number */}
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
                {tonBalance.toFixed(2)}
              </div>
            </div>

            {/* RIGHT: deposit + withdraw rows */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* DEPOSIT ROW */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, marginBottom: 4, color: '#c7d2fe' }}>
                  💰 Deposit (TonConnect)
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'nowrap',
                    alignItems: 'center'
                  }}
                >
                  <input
                    placeholder="Amount"
                    value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: 0,
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
                      width: 120,
                      textAlign: 'center'
                    }}
                  >
                    {isDepositing ? 'Processing…' : '💸 Deposit'}
                  </button>
                </div>
              </div>

              {/* WITHDRAW ROW */}
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: '#fed7aa' }}>
                  🏧 Withdraw (internal for now)
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'nowrap',
                    alignItems: 'center'
                  }}
                >
                  <input
                    placeholder="Amount"
                    value={withdrawAmount}
                    onChange={e => setWithdrawAmount(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: 0,
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
                      width: 120,
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
            Deposit sends real TON to app wallet via TonConnect. Withdraw is internal
            until backend payout is implemented.
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
                    border: '1px solid rgba(0,150,255,0.20)',
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

  // ---- lobbies page ----

  const renderLobbiesPage = () => (
    <>
      <div
        style={{
          margin: '10px 0 20px',
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
            gap: 12,
            alignItems: 'center',
            marginBottom: 8
          }}
        >
          <span style={{ fontSize: 13, color: '#ccc' }}>Lobby type:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <input
              type="radio"
              checked={createMode === 'public'}
              onChange={() => setCreateMode('public')}
            />
            Public
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <input
              type="radio"
              checked={createMode === 'private'}
              onChange={() => setCreateMode('private')}
            />
            Private
          </label>
        </div>

        {createMode === 'private' && (
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>PIN (4 digits): </span>
            <input
              type="password"
              value={createPin}
              maxLength={4}
              onChange={e => setCreatePin(e.target.value.replace(/\D/g, ''))}
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
        {/* Bet amount for new lobby */}
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13 }}>Bet amount (TON): </span>
         <input
  type="number"
  step={0.1}
  placeholder="0.1 eg"
  value={newLobbyBet === 0 ? '' : newLobbyBet}
  onChange={e => {
    const v = e.target.value
    if (v === '') {
      // allow user to clear the field completely
      setNewLobbyBet(0)
    } else {
      setNewLobbyBet(Number(v))
    }
  }}
  style={{
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #555',
    background: '#050511',
    color: '#fff',
    width: 100
  }}
/>
        </div>
        <button
          onClick={createLobby}
          style={{
            padding: '9px 18px',
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
          Create Lobby
        </button>

        <button
          onClick={loadLobbies}
          style={{
            padding: '8px 14px',
            marginLeft: 10,
            background: 'rgba(255,255,255,0.04)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 999,
            cursor: 'pointer',
            fontSize: 13
          }}
        >
          Refresh now
        </button>
      </div>

      <h2 style={{ marginTop: 10, marginBottom: 8 }}>Lobbies:</h2>

      {lobbies.length === 0 && <p>No lobbies yet</p>}

      {lobbies.map(lobby => (
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
          <h3 style={{ marginBottom: 4 }}>
            Lobby #{lobby.id}{' '}
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
          <p style={{ fontSize: 13, color: '#ccc' }}>Status: {lobby.status}</p>
          <p style={{ fontSize: 13, color: '#ccc' }}>
            Creator: {lobby.creatorName || 'not set yet (no players)'}
          </p>
                  <p style={{ fontSize: 13, color: '#ccc' }}>Players: {lobby.players.length}</p>
<p style={{ fontSize: 13, color: '#ccc' }}>
  Base bet:{' '}
  {lobby.betAmount != null ? `${lobby.betAmount.toFixed(2)} TON` : '—'}
</p>
<p style={{ fontSize: 13, color: '#ccc' }}>
  Bet per player:{' '}
  {typeof lobby.betAmount === 'number'
    ? `${lobby.betAmount.toFixed(2)} TON`
    : '—'}
</p>
          <p style={{ fontSize: 13, color: '#ccc' }}>
            Bet: { (lobby.betAmount ?? 1).toFixed(2) } TON
          </p>
    {lobby.status === 'finished' && lobby.gameResult && (
      <div style={{ marginTop: 6, fontSize: 12 }}>
        <div style={{ color: '#bbf7d0' }}>
          Winner:{' '}
          <span style={{ fontWeight: 700 }}>
            {lobby.gameResult.winnerName}
          </span>{' '}
          (roll {lobby.gameResult.highest})
        </div>

        {currentUser && (
          (() => {
            const me = lobby.gameResult!.players.find(
              p => p.id === currentUser.id
            )
            if (!me) return null
            const didWin = lobby.gameResult!.winnerId === currentUser.id
            return (
              <div
                style={{
                  marginTop: 2,
                  color: didWin ? '#22c55e' : '#f97316'
                }}
              >
                You {didWin ? 'won' : 'lost'} with roll {me.roll}
              </div>
            )
          })()
        )}
      </div>
    )}
          <button
            onClick={() => setSelectedLobbyId(lobby.id)}
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
      ))}
    </>
  )

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
      {/* Top header with app title + tab bar */}
            {/* Top title */}
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

      {/* Top banner: last win & biggest win */}
      <div
        style={{
          marginBottom: 14,
          padding: 10,
          borderRadius: 14,
          background:
            'linear-gradient(135deg, rgba(0,45,120,0.95), rgba(6,78,59,0.95))',
          border: '1px solid rgba(56,189,248,0.4)',
          boxShadow: '0 0 18px rgba(56,189,248,0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 12
        }}
      >
        {lastWin || biggestWin ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>Last win</div>
                {lastWin ? (
                  <div>
                    <span style={{ fontWeight: 700 }}>
                      {lastWin.playerName || currentUser?.name || 'You'}
                    </span>{' '}
                    <span style={{ color: '#bbf7d0', fontWeight: 600 }}>
                      +{lastWin.amount.toFixed(2)} TON
                    </span>
                  </div>
                ) : (
                  <div style={{ opacity: 0.7 }}>No wins yet</div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, opacity: 0.8 }}>Biggest win</div>
                {biggestWin ? (
                  <div>
                    <span style={{ fontWeight: 700 }}>
                      {biggestWin.playerName || currentUser?.name || 'You'}
                    </span>{' '}
                    <span style={{ color: '#facc15', fontWeight: 600 }}>
                      +{biggestWin.amount.toFixed(2)} TON
                    </span>
                  </div>
                ) : (
                  <div style={{ opacity: 0.7 }}>No wins yet</div>
                )}
              </div>
            </div>
            <div style={{ fontSize: 10, opacity: 0.8 }}>
              Stats are based on your recent games in this session.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12 }}>
            No wins yet – roll the dice in any lobby to set your first record 🎲
          </div>
        )}
      </div>

      {currentPage === 'lobbies' ? renderLobbiesPage() : renderProfilePage()}

      {/* Lobby popup */}
      {selectedLobby && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10
          }}
        >
          <div
            style={{
              background:
                'linear-gradient(145deg, rgba(0,25,70,0.96), rgba(0,18,50,0.96))',
            borderRadius: 16,
            padding: 20,
            width: '90%',
            maxWidth: 400,
            border: '1px solid rgba(0,150,255,0.25)',
            boxShadow: '0 0 25px rgba(0,0,0,0.9)'
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <h3>
              Lobby #{selectedLobby.id}{' '}
              {selectedLobby.isPrivate && (
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
            <button
              onClick={closePopup}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: 18,
                cursor: 'pointer'
              }}
            >
              ✕
            </button>
          </div>

         <p style={{ fontSize: 13, color: '#ccc' }}>
  Status: {selectedLobby.status}
</p>
<p style={{ fontSize: 13, color: '#ccc' }}>
  Creator: {selectedLobby.creatorName || 'not set'}
</p>
<p style={{ fontSize: 13, color: '#ccc' }}>
  Bet: {(selectedLobby.betAmount ?? 1).toFixed(2)} TON
</p>
<p style={{ marginTop: 10, fontSize: 13 }}>
  Players:{' '}
  {selectedLobby.players.length === 0
    ? 'none'
    : selectedLobby.players
        .map(p => `${p.name} (${p.isReady ? 'ready' : 'not ready'})`)
        .join(', ')}
</p>
<p style={{ fontSize: 13, color: '#ccc', marginTop: 6 }}>
  Bet per player:{' '}
  {typeof selectedLobby.betAmount === 'number'
    ? `${selectedLobby.betAmount.toFixed(2)} TON`
    : '—'}
</p>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              marginTop: 12,
              alignItems: 'center'
            }}
          >
            {selectedLobby.isPrivate && (
              <div>
                <span style={{ fontSize: 14 }}>PIN: </span>
                <input
                  type="password"
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13 }}>Your bet (TON):</span>
              <input
                type="text"
                value={
  userBets[selectedLobby.id] !== undefined
    ? userBets[selectedLobby.id].toString()
    : selectedLobby.betAmount != null
    ? selectedLobby.betAmount.toString()
    : ''
}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9.]/g, '')
                  const parsed = parseFloat(raw)
                  setUserBets(prev => ({
                    ...prev,
                    [selectedLobby.id]: isNaN(parsed) ? 0 : parsed
                  }))
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #555',
                  background: '#050511',
                  color: '#fff',
                  width: 100
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                {[0.1, 0.5, 1].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() =>
                      setUserBets(prev => {
                        const current = prev[selectedLobby.id] || 0
                        const updated = Math.round((current + val) * 100) / 100
                        return { ...prev, [selectedLobby.id]: updated }
                      })
                    }
                    style={{
                      padding: '2px 6px',
                      borderRadius: 999,
                      border: 'none',
                      background:
                        'linear-gradient(135deg, #ff0080 0%, #ff8c00 60%, #ffe53b 100%)',
                      color: '#111',
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3
                    }}
                  >
                    <span>🎰</span>
                    <span>+{val}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* JOIN BUTTON — show only if current user is NOT the creator */}
{currentUser!.id !== selectedLobby.creatorId && (
  <button
    onClick={() =>
      joinLobby(
        selectedLobby.id,
        selectedLobby.isPrivate ? joinPin : undefined
      )
    }
    style={{
      padding: '8px 16px',
      background:
        'linear-gradient(135deg, #00d4ff 0%, #0074ff 60%, #4a00e0 100%)',
      color: '#fff',
      border: 'none',
      borderRadius: 999,
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 600
    }}
  >
    Join Lobby
  </button>
)}

{/* READY BUTTON — everyone sees it */}
<button
  onClick={() => toggleReady(selectedLobby.id)}
  style={{
    padding: '8px 16px',
    background:
      'linear-gradient(135deg, #ffe53b 0%, #ff8c00 50%, #ff0080 100%)',
    color: '#111',
    border: 'none',
    borderRadius: 999,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600
  }}
>
  Ready / Unready
</button>

{/* START BUTTON — ONLY SHOW IF CREATOR */}
{currentUser!.id === selectedLobby.creatorId && (
  <button
    onClick={() => startGame(selectedLobby.id)}
    style={{
      padding: '8px 16px',
      background:
        'linear-gradient(135deg, #ff4d6a 0%, #ff0000 40%, #8b0000 100%)',
      color: '#fff',
      border: 'none',
      borderRadius: 999,
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 600,
      boxShadow: '0 0 12px rgba(255,77,106,0.8)'
    }}
  >
    Start Game
  </button>
)}
</div>

          {selectedLobby.gameResult && (
            <div style={{ marginTop: 14 }}>
              <h4>Game Result:</h4>
              <p>
                Winner: {selectedLobby.gameResult.winnerName} (roll{' '}
                {selectedLobby.gameResult.highest})
              </p>
              <ul>
                {selectedLobby.gameResult.players.map(p => (
                  <li key={p.id}>
                    {p.name}: rolled {p.roll}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

      </div>
      )}
{/* Bottom toolbar */}
<div
  style={{
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    padding: '2px 0 calc(env(safe-area-inset-bottom, 0px) + 4px)',
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
      width: '86%',
      maxWidth: 380,
      display: 'flex',
      gap: 8,
      padding: 4,
      borderRadius: 999,
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
      {/* Error overlay */}
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
