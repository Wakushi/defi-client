"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { GainsLivePositionsPanel } from "@/components/gains-live-positions-panel"
import { GainsPairPicker } from "@/components/gains-pair-picker"
import {
  useGainsRealtime,
  type GainsDuelPnlOutcome,
} from "@/components/gains-realtime-context"
import { TokenPicker, extractNumericChainId, type SelectedToken } from "@/components/token-picker"
import {
  GameHudBar,
  GameLogo,
  GameVsBanner,
  gameBtnPrimary,
  gameInput,
  gameLabel,
  gameLink,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
  gameSubtitle,
  gameTitle,
} from "@/components/game-ui"
import { duelVsBannerForViewer } from "@/lib/duel/viewer-vs-order"
import {
  gainsPositionHistorySideKey,
  type GainsApiChain,
  type GainsTradingPair,
} from "@/types/gains-api"
import type { DuelTradeSideConfig } from "@/types/duel-trade"

const POLL_MS = 1000
const COUNTDOWN_TOTAL_MS = 3000

function useDuelWsCountdown(
  serverSeconds: number | null,
  duelTimerEnded: boolean,
) {
  const [tick, setTick] = useState<number | null>(null)
  useEffect(() => {
    if (duelTimerEnded) {
      setTick(0)
      return
    }
    if (serverSeconds === null) {
      setTick(null)
      return
    }
    if (Number.isFinite(serverSeconds)) {
      setTick(Math.max(0, serverSeconds))
    }
  }, [serverSeconds, duelTimerEnded])

  useEffect(() => {
    if (duelTimerEnded || tick === null || tick <= 0) return
    const id = setInterval(() => {
      setTick((t) => (t != null && t > 0 ? t - 1 : t))
    }, 1000)
    return () => clearInterval(id)
  }, [tick, duelTimerEnded])

  if (duelTimerEnded) return 0
  return tick
}

type DuelPayload = {
  id: string
  creatorPseudo: string
  opponentPseudo: string | null
  stakeUsdc: string
  durationSeconds: number
  duelFull: boolean
  viewer: { isCreator: boolean; isOpponent: boolean } | null
  playMode?: "friendly" | "duel"
  creatorChain?: GainsApiChain | null
  opponentChain?: GainsApiChain | null
  /** Chaîne Gains imposée pour le viewer (créateur / adversaire). */
  myExecGainsChain?: GainsApiChain | null
  readyState: [number, number]
  readyBothAt: string | null
  bothReady: boolean
  myReady: boolean
  myTradeConfig: DuelTradeSideConfig | null
  /** Horodatage ISO du premier `start` persisté (GET + POST /live). */
  duelLiveAt: string | null
  /** Fin de chrono persistée (POST /close). */
  duelClosedAt: string | null
  /** `execute-trade` déjà enregistré pour le viewer (reload sans re-signer). */
  myTradeOpened: boolean
  myOpenTradeTxHash: string | null
}

function formatUsdc(raw: string) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n)
}

function formatOutcomePct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const s = n >= 0 ? "+" : ""
  return `${s}${n.toFixed(2)} %`
}

function formatOutcomeUsdc(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const s = n >= 0 ? "+" : ""
  return `${s}${formatUsdc(String(n))} USDC`
}

/** Mappe le snapshot WS fin de duel vers les champs créateur / adversaire en base. */
function buildCloseOutcomeBody(
  viewer: { isCreator: boolean; isOpponent: boolean } | null,
  outcome: GainsDuelPnlOutcome | null,
): Record<string, number> {
  if (!viewer || !outcome) return {}
  const body: Record<string, number> = {}
  if (viewer.isCreator) {
    if (outcome.myPnlUsdc != null && Number.isFinite(outcome.myPnlUsdc)) {
      body.creatorPnlUsdc = outcome.myPnlUsdc
    }
    if (
      outcome.opponentPnlUsdc != null &&
      Number.isFinite(outcome.opponentPnlUsdc)
    ) {
      body.opponentPnlUsdc = outcome.opponentPnlUsdc
    }
    if (outcome.myPnlPct != null && Number.isFinite(outcome.myPnlPct)) {
      body.creatorPnlPct = outcome.myPnlPct
    }
    if (
      outcome.opponentPnlPct != null &&
      Number.isFinite(outcome.opponentPnlPct)
    ) {
      body.opponentPnlPct = outcome.opponentPnlPct
    }
  } else if (viewer.isOpponent) {
    if (outcome.myPnlUsdc != null && Number.isFinite(outcome.myPnlUsdc)) {
      body.opponentPnlUsdc = outcome.myPnlUsdc
    }
    if (
      outcome.opponentPnlUsdc != null &&
      Number.isFinite(outcome.opponentPnlUsdc)
    ) {
      body.creatorPnlUsdc = outcome.opponentPnlUsdc
    }
    if (outcome.myPnlPct != null && Number.isFinite(outcome.myPnlPct)) {
      body.opponentPnlPct = outcome.myPnlPct
    }
    if (
      outcome.opponentPnlPct != null &&
      Number.isFinite(outcome.opponentPnlPct)
    ) {
      body.creatorPnlPct = outcome.opponentPnlPct
    }
  }
  return body
}

export function DuelPrepareView() {
  const params = useParams()
  const duelId = typeof params.id === "string" ? params.id : ""

  const [duel, setDuel] = useState<DuelPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const [pairIndex, setPairIndex] = useState(0)
  const [gainsChain, setGainsChain] = useState<GainsApiChain>("Testnet")
  const [selectedPairLabel, setSelectedPairLabel] = useState("")
  /** Prix API au clic sur une paire — envoyé au contrat comme `openPrice` (évite slippage / revert). */
  const [selectedReferencePrice, setSelectedReferencePrice] = useState<
    number | null
  >(null)
  const [leverageX, setLeverageX] = useState(10)
  const [long, setLong] = useState(true)

  const {
    subscribePositions,
    positions,
    pnlHistoryByKey,
    myPositions,
    opponentPositions,
    pnlHistoryMy,
    pnlHistoryOpponent,
    duelRemainingSeconds,
    duelTimerEnded,
    duelPnlOutcome,
    duelStartSignalAt,
    takeDuelEndCloseTargets,
    connectionState,
    lastWsError,
    walletAddress: gainsWallet,
  } = useGainsRealtime()

  const [duelAutoCloseBusy, setDuelAutoCloseBusy] = useState(false)
  const [duelAutoCloseResult, setDuelAutoCloseResult] = useState<string | null>(
    null,
  )

  const duelCountdownDisplay = useDuelWsCountdown(
    duelRemainingSeconds,
    duelTimerEnded,
  )

  useEffect(() => {
    if (!duelTimerEnded) {
      setDuelAutoCloseBusy(false)
      setDuelAutoCloseResult(null)
    }
  }, [duelTimerEnded])

  useLayoutEffect(() => {
    if (!duelTimerEnded) return
    const batch = takeDuelEndCloseTargets()
    if (!batch?.length) return

    setDuelAutoCloseBusy(true)
    setDuelAutoCloseResult(null)

    void (async () => {
      const errs: string[] = []
      for (const pos of batch) {
        const mark = pos.currentPriceUsdDecimaled
        if (typeof mark !== "number" || !Number.isFinite(mark)) continue
        try {
          const r = await fetch("/api/trade/close-market", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              tradeIndex: pos.index ?? 0,
              currentPriceUsdDecimaled: mark,
              gainsChain:
                duel?.myExecGainsChain ??
                duel?.myTradeConfig?.gainsChain ??
                gainsChain,
            }),
          })
          const data = (await r.json()) as { error?: string }
          if (!r.ok) {
            errs.push(`#${pos.index ?? "?"}: ${data.error ?? "failed"}`)
          }
        } catch {
          errs.push(`#${pos.index ?? "?"}: network`)
        }
      }
      setDuelAutoCloseBusy(false)
      if (errs.length > 0) {
        setDuelAutoCloseResult(
          `Auto-close partial or failed — ${errs.join(" · ")}. You can retry manually from the cards.`,
        )
      } else {
        setDuelAutoCloseResult(
          "All your duel positions were closed at market.",
        )
      }
    })()
  }, [
    duelTimerEnded,
    takeDuelEndCloseTargets,
    duel?.myTradeConfig?.gainsChain,
    gainsChain,
  ])

  const [readyLoading, setReadyLoading] = useState(false)
  const [readyError, setReadyError] = useState<string | null>(null)
  const [selectedToken, setSelectedToken] = useState<SelectedToken | null>(null)
  const [swapBusy, setSwapBusy] = useState(false)
  const [swapResult, setSwapResult] = useState<string | null>(null)

  const [execLoading, setExecLoading] = useState(false)
  const [execError, setExecError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  /** Une seule auto-signature quand les deux sont prêts (pas liée à l’event WS `start`). */
  const autoSignStartedRef = useRef(false)
  const closePayloadKeySentRef = useRef("")
  const txHashRef = useRef(txHash)
  const onExecuteRef = useRef<() => Promise<void>>(async () => {})
  txHashRef.current = txHash

  const loadDuel = useCallback(async () => {
    if (!duelId) return
    setLoadError(null)
    try {
      const r = await fetch(`/api/duels/${duelId}`, { credentials: "include" })
      const data = (await r.json()) as DuelPayload & { error?: string }
      if (!r.ok) {
        setDuel(null)
        setLoadError(data.error ?? "Duel not found.")
        return
      }
      console.log("[COUNTDOWN-DEBUG] loadDuel response", {
        duelLiveAt: data.duelLiveAt,
        duelClosedAt: data.duelClosedAt,
        bothReady: data.bothReady,
        duelStartSignalAt,
        msSinceStart: duelStartSignalAt ? Date.now() - duelStartSignalAt : null,
      })
      setDuel(data)
      if (data.myExecGainsChain) {
        setGainsChain(data.myExecGainsChain)
      }
      if (data.myOpenTradeTxHash) {
        setTxHash(data.myOpenTradeTxHash)
      } else if (data.myTradeOpened) {
        setTxHash(null)
      }
      if (data.myTradeConfig) {
        setPairIndex(data.myTradeConfig.pairIndex)
        setLeverageX(data.myTradeConfig.leverageX)
        setLong(data.myTradeConfig.long)
        setSelectedPairLabel(`Pair #${data.myTradeConfig.pairIndex}`)
        setSelectedReferencePrice(
          typeof data.myTradeConfig.referencePrice === "number" &&
            Number.isFinite(data.myTradeConfig.referencePrice)
            ? data.myTradeConfig.referencePrice
            : null,
        )
      }
    } catch {
      setDuel(null)
      setLoadError("Network error.")
    } finally {
      setLoading(false)
    }
  }, [duelId])

  useEffect(() => {
    void loadDuel()
  }, [loadDuel])

  useEffect(() => {
    autoSignStartedRef.current = false
    closePayloadKeySentRef.current = ""
  }, [duelId])

  /** Persiste « duel live » côté serveur dès réception du WS `start` (reload sans ré-attendre). */
  useEffect(() => {
    if (duelStartSignalAt == null || !duelId) return
    console.log("[COUNTDOWN-DEBUG] /live POST triggered", {
      duelStartSignalAt,
      msSinceStart: Date.now() - duelStartSignalAt,
      duelId,
    })
    void fetch(`/api/duels/${duelId}/live`, {
      method: "POST",
      credentials: "include",
    }).then((r) => {
      console.log("[COUNTDOWN-DEBUG] /live POST response", {
        ok: r.ok,
        status: r.status,
        msSinceStart: duelStartSignalAt ? Date.now() - duelStartSignalAt : null,
      })
      if (r.ok) void loadDuel()
    })
  }, [duelStartSignalAt, duelId, loadDuel])

  /** Persiste la fin du chrono + PnL (requêtes idempotentes ; nouvelle clé si le WS remplit le outcome après coup). */
  useEffect(() => {
    if (!duelTimerEnded || !duelId) return
    const viewer = duel?.viewer
    const v =
      viewer && (viewer.isCreator || viewer.isOpponent) ? viewer : null
    const body = buildCloseOutcomeBody(v, duelPnlOutcome)
    const key = JSON.stringify(body)
    if (key === closePayloadKeySentRef.current) return
    closePayloadKeySentRef.current = key
    void fetch(`/api/duels/${duelId}/close`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => {
      if (r.ok) void loadDuel()
    })
  }, [duelTimerEnded, duelId, loadDuel, duelPnlOutcome, duel?.viewer])

  const participant =
    duel?.viewer && (duel.viewer.isCreator || duel.viewer.isOpponent)

  const gainsPickerChainOptions = useMemo((): GainsApiChain[] => {
    return duel?.playMode === "duel" ? ["Arbitrum", "Base"] : ["Testnet"]
  }, [duel?.playMode])

  /** Booléen dérivé : évite un tableau de deps dont la « forme » change (warning React / Fast Refresh). */
  const shouldPollDuel =
    Boolean(duel?.duelFull) && Boolean(participant) && !duel?.bothReady

  /** Tant que les deux ne sont pas « ready », on resynchronise l’état (l’autre joueur peut marquer prêt). Après `bothReady`, plus de poll — ouverture auto + WS. */
  useEffect(() => {
    if (!shouldPollDuel) return

    const id = setInterval(() => void loadDuel(), POLL_MS)
    return () => clearInterval(id)
  }, [shouldPollDuel, loadDuel])

  useEffect(() => {
    if (duelStartSignalAt != null) {
      console.log("[COUNTDOWN-DEBUG] duelStartSignalAt changed, setting nowTick", {
        duelStartSignalAt,
        nowTick,
      })
      setNowTick(Date.now())
    }
  }, [duelStartSignalAt])

  /** Compte à rebours 3-2-1 **uniquement** après `start` (affichage — indépendant de l’ouverture du trade). */
  const serverPastStartGateRaw = Boolean(duel?.duelLiveAt || duel?.duelClosedAt)
  /** On page reload (no local WS start signal), trust the server flag.
   *  But if we received the WS start in this session and the 3-2-1 countdown
   *  hasn’t finished yet, ignore the server flag so the overlay plays fully. */
  const localCountdownActive =
    duelStartSignalAt != null &&
    duel?.bothReady === true &&
    (Date.now() - duelStartSignalAt) < COUNTDOWN_TOTAL_MS
  const serverPastStartGate = serverPastStartGateRaw && !localCountdownActive

  useEffect(() => {
    console.log("[COUNTDOWN-DEBUG] countdown timer effect deps changed", {
      bothReady: duel?.bothReady,
      duelStartSignalAt,
      serverPastStartGate,
      duelLiveAt: duel?.duelLiveAt,
      duelClosedAt: duel?.duelClosedAt,
    })
    if (!duel?.bothReady || duelStartSignalAt == null || serverPastStartGate) {
      console.log("[COUNTDOWN-DEBUG] countdown timer effect BAILED", {
        reason: !duel?.bothReady
          ? "bothReady=false"
          : duelStartSignalAt == null
            ? "no duelStartSignalAt"
            : "serverPastStartGate=true",
      })
      return
    }
    const elapsed = Date.now() - duelStartSignalAt
    console.log("[COUNTDOWN-DEBUG] countdown timer starting interval", {
      elapsed,
      willBail: elapsed >= COUNTDOWN_TOTAL_MS,
    })
    if (elapsed >= COUNTDOWN_TOTAL_MS) return
    const id = setInterval(() => setNowTick(Date.now()), 100)
    return () => clearInterval(id)
  }, [duel?.bothReady, duelStartSignalAt, serverPastStartGate])

  useEffect(() => {
    if (!duel?.bothReady || !participant || !duelId) return
    subscribePositions(duelId)
  }, [duel?.bothReady, participant, duelId, subscribePositions])

  const hasLocalStart = duelStartSignalAt != null
  const prepElapsed =
    duel?.bothReady === true && hasLocalStart
      ? Math.max(0, nowTick - duelStartSignalAt)
      : 0

  const prepOverlayNum =
    duel?.bothReady === true &&
    !serverPastStartGate &&
    hasLocalStart &&
    prepElapsed < COUNTDOWN_TOTAL_MS
      ? Math.max(1, 3 - Math.floor(prepElapsed / 1000))
      : null

  /** Après la fin du 3-2-1 post-`start`, ou déjà « live » en base au reload. */
  const prepCountdownDone = Boolean(
    duel?.bothReady === true &&
    (serverPastStartGate ||
      (hasLocalStart && prepElapsed >= COUNTDOWN_TOTAL_MS)),
  )

  // Debug: log every render where countdown state changes
  useEffect(() => {
    console.log("[COUNTDOWN-DEBUG] render state", {
      prepOverlayNum,
      prepCountdownDone,
      prepElapsed,
      serverPastStartGate,
      hasLocalStart,
      bothReady: duel?.bothReady,
      duelLiveAt: duel?.duelLiveAt,
      duelClosedAt: duel?.duelClosedAt,
      duelStartSignalAt,
      nowTick,
    })
  })

  const waitingWsStart =
    duel?.bothReady === true &&
    !serverPastStartGate &&
    duelStartSignalAt == null

  useLayoutEffect(() => {
    if (
      !duel?.bothReady ||
      txHash ||
      duel?.myTradeOpened ||
      autoSignStartedRef.current
    )
      return
    autoSignStartedRef.current = true
    void onExecuteRef.current()
  }, [duel?.bothReady, duel?.myTradeOpened, txHash])

  async function onMarkReady() {
    if (!duelId) return
    setReadyError(null)
    setReadyLoading(true)
    setSwapResult(null)

    try {
      // If a non-USDC token is selected, swap to USDC first
      if (selectedToken && !selectedToken.isCollateral) {
        setSwapBusy(true)
        try {
          const swapRes = await fetch("/api/trade/swap-to-collateral", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              tokenIn: selectedToken.tokenAddress,
              stakeUsdc: duel?.stakeUsdc ?? "0",
              chainId: Number(extractNumericChainId(selectedToken.chainId) ?? "42161"),
            }),
          })
          const swapData = (await swapRes.json()) as {
            error?: string
            swapTxHash?: string
            noSwapNeeded?: boolean
          }
          if (!swapRes.ok) {
            setReadyError(`Swap failed: ${swapData.error ?? "Unknown error."}`)
            return
          }
          if (swapData.swapTxHash) {
            setSwapResult(`Swapped via tx ${swapData.swapTxHash}`)
          }
        } finally {
          setSwapBusy(false)
        }
      }

      // Now mark ready with trade config
      const res = await fetch(`/api/duels/${duelId}/trade-ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          pairIndex,
          leverageX,
          long,
          tradeType: 0,
          gainsChain,
          ...(selectedReferencePrice != null &&
          Number.isFinite(selectedReferencePrice)
            ? { referencePrice: selectedReferencePrice }
            : {}),
        } satisfies DuelTradeSideConfig),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setReadyError(data.error ?? "Failed.")
        return
      }
      await loadDuel()
    } catch {
      setReadyError("Network error.")
    } finally {
      setReadyLoading(false)
    }
  }

  const onExecute = useCallback(async () => {
    if (!duelId) return
    subscribePositions(duelId)
    setExecError(null)
    setExecLoading(true)
    try {
      const res = await fetch(`/api/duels/${duelId}/execute-trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      })
      const data = (await res.json()) as {
        error?: string
        txHash?: string
        already?: boolean
      }
      if (!res.ok) {
        setExecError(data.error ?? "Failed.")
        return
      }
      if (data.already) {
        if (data.txHash) setTxHash(data.txHash)
        await loadDuel()
        return
      }
      if (data.txHash) {
        setTxHash(data.txHash)
      }
      await loadDuel()
    } catch {
      setExecError("Network error.")
    } finally {
      setExecLoading(false)
    }
  }, [duelId, subscribePositions, loadDuel])

  onExecuteRef.current = onExecute

  function onRetrySign() {
    autoSignStartedRef.current = false
    void onExecute()
  }

  if (!duelId) {
    return (
      <>
        <GameHudBar>
          <GameLogo className="!text-sm" />
        </GameHudBar>
        <p className="p-8 text-sm text-[var(--game-danger)]">
          Missing duel id.
        </p>
      </>
    )
  }

  if (loading) {
    return (
      <>
        <GameHudBar>
          <Link href="/" className="shrink-0">
            <GameLogo className="!text-sm sm:!text-base" />
          </Link>
        </GameHudBar>
        <main className="mx-auto max-w-lg flex-1 px-4 py-16">
          <p
            className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-widest`}
          >
            Loading…
          </p>
        </main>
      </>
    )
  }

  if (loadError || !duel) {
    return (
      <>
        <GameHudBar>
          <Link href="/" className="shrink-0">
            <GameLogo className="!text-sm sm:!text-base" />
          </Link>
        </GameHudBar>
        <main className="mx-auto max-w-lg flex-1 space-y-4 px-4 py-16">
          <p className="text-sm text-[var(--game-danger)]">
            {loadError ?? "Not found."}
          </p>
          <Link href="/" className={gameLink}>
            Back to hub
          </Link>
        </main>
      </>
    )
  }

  if (!duel.duelFull) {
    return (
      <>
        <GameHudBar>
          <Link href="/" className="shrink-0">
            <GameLogo className="!text-sm sm:!text-base" />
          </Link>
        </GameHudBar>
        <main className="mx-auto max-w-lg flex-1 space-y-4 px-4 py-16">
          <p className={gameMuted}>This duel does not have two players yet.</p>
          <Link href={`/duel/${duelId}`} className={gameLink}>
            Back to lobby
          </Link>
        </main>
      </>
    )
  }

  if (!participant) {
    return (
      <>
        <GameHudBar>
          <Link href="/" className="shrink-0">
            <GameLogo className="!text-sm sm:!text-base" />
          </Link>
        </GameHudBar>
        <main className="mx-auto max-w-lg flex-1 space-y-4 px-4 py-16">
          <p className={gameMuted}>You are not in this duel.</p>
          <Link href="/" className={gameLink}>
            Back to hub
          </Link>
        </main>
      </>
    )
  }

  const duelVsSides = duelVsBannerForViewer(
    duel.creatorPseudo,
    duel.opponentPseudo,
    duel.viewer,
    "—",
  )

  const myTradePseudo =
    duel.viewer?.isCreator === true
      ? duel.creatorPseudo
      : (duel.opponentPseudo ?? "—")
  const opponentTradePseudo =
    duel.viewer?.isCreator === true
      ? (duel.opponentPseudo ?? "—")
      : duel.creatorPseudo

  return (
    <>
      <GameHudBar>
        <Link href="/" className="shrink-0">
          <GameLogo className="!text-sm sm:!text-base" />
        </Link>
        <p className="hidden font-[family-name:var(--font-orbitron)] text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--game-text-muted)] sm:block">
          Combat loadout
        </p>
      </GameHudBar>

      <main
        className={`mx-auto flex flex-1 flex-col gap-6 px-4 py-10 sm:py-14 ${duel.bothReady ? "max-w-6xl" : "max-w-lg"}`}
      >
        <div className="space-y-3">
          <p className={gameSubtitle}>Trade prep</p>
          <h1 className={`${gameTitle} !text-xl sm:!text-2xl`}>Gains setup</h1>
          <GameVsBanner
            left={duelVsSides.left}
            right={duelVsSides.right}
            leftTag={duelVsSides.leftTag}
            rightTag={duelVsSides.rightTag}
          />
          <p className={gameMuted}>
            Stake: {formatUsdc(duel.stakeUsdc)} USDC each · duration{" "}
            {Math.round(duel.durationSeconds / 60)} min
          </p>
        </div>

        <div
          className={`${gamePanel} ${gamePanelTopAccent} space-y-3 p-6 text-sm`}
        >
          <p className="font-[family-name:var(--font-share-tech)] text-[var(--game-cyan)]">
            Ready status [{duel.readyState[0]}, {duel.readyState[1]}]{" "}
            <span className="text-[var(--game-text-muted)]">
              · creator, opponent
            </span>
          </p>
          <p className={gameMuted}>
            Once both are ready, your position opens with{" "}
            <span className="font-semibold text-[var(--game-magenta)]">
              auto-sign
            </span>
            . On WebSocket{" "}
            <span className="font-semibold text-[var(--game-cyan)]">start</span>
            , a fullscreen{" "}
            <span className="font-semibold text-[var(--game-magenta)]">
              3 · 2 · 1
            </span>{" "}
            countdown — live positions and the duel timer only appear after that.
          </p>
        </div>

        {duel.bothReady ? (
          <div className="space-y-4">
            {prepCountdownDone ? (
              <>
                <div
                  className={`${gamePanel} ${gamePanelTopAccent} flex flex-wrap items-center justify-between gap-3 p-4`}
                >
                  <div>
                    <p className={gameLabel}>Time left (duel)</p>
                    <p
                      className={`font-[family-name:var(--font-orbitron)] text-2xl font-black tabular-nums tracking-wider sm:text-3xl ${
                        duelTimerEnded || duelCountdownDisplay === 0
                          ? "text-[var(--game-magenta)]"
                          : "text-[var(--game-cyan)]"
                      }`}
                    >
                      {duelCountdownDisplay === null && !duelTimerEnded ? (
                        <span className="text-[var(--game-text-muted)]">…</span>
                      ) : duelTimerEnded || duelCountdownDisplay === 0 ? (
                        "0 s"
                      ) : (
                        <>{duelCountdownDisplay} s</>
                      )}
                    </p>
                  </div>
                  <p className={`${gameMuted} max-w-md text-[11px]`}>
                    Positions update live. When the timer hits 0, your positions
                    are closed at market automatically (one transaction per trade).
                  </p>
                </div>

                {duelTimerEnded && duelPnlOutcome ? (
                  <div
                    className={`${gamePanel} ${gamePanelTopAccent} space-y-4 p-6 ${
                      duelPnlOutcome.winner === "you"
                        ? "border-[var(--game-cyan)]/70 shadow-[0_0_32px_rgba(65,245,240,0.15)]"
                        : duelPnlOutcome.winner === "opponent"
                          ? "border-[var(--game-magenta)]/60"
                          : ""
                    }`}
                  >
                    <p className={gameLabel}>Duel result</p>
                    <h2
                      className={`font-[family-name:var(--font-orbitron)] text-xl font-black uppercase tracking-wide sm:text-2xl ${
                        duelPnlOutcome.winner === "you"
                          ? "text-[var(--game-cyan)] [text-shadow:0_0_20px_rgba(65,245,240,0.45)]"
                          : duelPnlOutcome.winner === "opponent"
                            ? "text-[var(--game-magenta)] [text-shadow:0_0_18px_rgba(255,61,154,0.4)]"
                            : duelPnlOutcome.winner === "tie"
                              ? "text-[var(--game-amber)]"
                              : "text-[var(--game-text-muted)]"
                      }`}
                    >
                      {duelPnlOutcome.winner === "you"
                        ? "Win"
                        : duelPnlOutcome.winner === "opponent"
                          ? "Loss"
                          : duelPnlOutcome.winner === "tie"
                            ? "Tie"
                            : "Incomplete score"}
                    </h2>
                    <p className={`${gameMuted} text-[12px]`}>
                      Ranking by{" "}
                      <span className="font-semibold text-[var(--game-text)]">
                        PnL %
                      </span>{" "}
                      at the last tick ~1s (or last known % if the position closed
                      before the end).
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-sm border border-[var(--game-cyan-dim)]/50 bg-[rgba(0,0,0,0.35)] p-4">
                        <p className={gameLabel}>You</p>
                        <p className="truncate font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-[var(--game-text)]">
                          {myTradePseudo}
                        </p>
                        <p className="mt-2 font-[family-name:var(--font-orbitron)] text-lg font-bold tabular-nums text-[var(--game-cyan)]">
                          {formatOutcomePct(duelPnlOutcome.myPnlPct)}
                        </p>
                        <p className="mt-1 font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
                          PnL USDC :{" "}
                          {formatOutcomeUsdc(duelPnlOutcome.myPnlUsdc)}
                        </p>
                      </div>
                      <div className="rounded-sm border border-[var(--game-cyan-dim)]/50 bg-[rgba(0,0,0,0.35)] p-4">
                        <p className={gameLabel}>Opponent</p>
                        <p className="truncate font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-[var(--game-text)]">
                          {opponentTradePseudo}
                        </p>
                        <p className="mt-2 font-[family-name:var(--font-orbitron)] text-lg font-bold tabular-nums text-[var(--game-magenta)]">
                          {formatOutcomePct(duelPnlOutcome.opponentPnlPct)}
                        </p>
                        <p className="mt-1 font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
                          PnL USDC:{" "}
                          {formatOutcomeUsdc(duelPnlOutcome.opponentPnlUsdc)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {duelAutoCloseBusy || duelAutoCloseResult ? (
                  <div
                    className={`rounded-sm border px-4 py-3 text-sm ${
                      duelAutoCloseResult != null &&
                      (duelAutoCloseResult.includes("partial") ||
                        duelAutoCloseResult.includes("failed"))
                        ? "border-[var(--game-danger)]/50 bg-[rgba(255,80,80,0.08)] text-[var(--game-text)]"
                        : "border-[var(--game-cyan)]/40 bg-[rgba(65,245,240,0.08)] text-[var(--game-text)]"
                    }`}
                  >
                    {duelAutoCloseBusy ? (
                      <p className="font-[family-name:var(--font-share-tech)] text-[13px] text-[var(--game-text)]">
                        Auto-closing positions at market (one transaction per
                        trade)…
                      </p>
                    ) : duelAutoCloseResult ? (
                      <p className="font-[family-name:var(--font-share-tech)] text-[13px]">
                        {duelAutoCloseResult}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Gauche : ton trade · Droite : adversaire */}
                  <div className="min-w-0 space-y-2">
                    <div>
                      <p className={gameLabel}>Your trade</p>
                      <p className="truncate font-[family-name:var(--font-orbitron)] text-base font-bold uppercase tracking-wide text-[var(--game-text)] sm:text-lg">
                        {myTradePseudo}
                      </p>
                    </div>
                    <GainsLivePositionsPanel
                      panelTitle="Positions (live)"
                      positionCardLabel="Your position"
                      showConnectionMeta
                      positions={myPositions}
                      pnlHistoryByKey={pnlHistoryMy}
                      historyKeyForPosition={(p) =>
                        gainsPositionHistorySideKey("my", p)
                      }
                      connectionState={connectionState}
                      lastWsError={lastWsError}
                      gainsWallet={gainsWallet}
                      gainsChain={gainsChain}
                      wsDuelId={duelId}
                      duelEnded={duelTimerEnded}
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div>
                      <p className={gameLabel}>Opponent</p>
                      <p className="truncate font-[family-name:var(--font-orbitron)] text-base font-bold uppercase tracking-wide text-[var(--game-text)] sm:text-lg">
                        {opponentTradePseudo}
                      </p>
                    </div>
                    <GainsLivePositionsPanel
                      panelTitle="Positions (live)"
                      positionCardLabel="Opponent position"
                      readOnly
                      showConnectionMeta={false}
                      positions={opponentPositions}
                      pnlHistoryByKey={pnlHistoryOpponent}
                      historyKeyForPosition={(p) =>
                        gainsPositionHistorySideKey("opponent", p)
                      }
                      connectionState={connectionState}
                      lastWsError={lastWsError}
                      gainsWallet={gainsWallet}
                      gainsChain={gainsChain}
                      wsDuelId={duelId}
                      duelEnded={duelTimerEnded}
                    />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <GainsLivePositionsPanel
            positions={positions}
            pnlHistoryByKey={pnlHistoryByKey}
            connectionState={connectionState}
            lastWsError={lastWsError}
            gainsWallet={gainsWallet}
            gainsChain={gainsChain}
            wsDuelId={duelId}
          />
        )}

        {!duel.myReady && duel.playMode === "duel" ? (
          <TokenPicker
            stakeUsdc={duel.stakeUsdc}
            chainId={gainsChain === "Arbitrum" ? "42161" : "42161"}
            onSelect={setSelectedToken}
            selected={selectedToken}
          />
        ) : null}

        {!duel.myReady ? (
          <div className={`${gamePanel} space-y-4 p-6`}>
            <h2 className="font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase tracking-wider text-[var(--game-magenta)]">
              Your settings
            </h2>
            {duel.myExecGainsChain ? (
              <p className={`${gameMuted} text-xs`}>
                {duel.playMode === "duel" ? "Duel mode" : "Friendly mode"} — fixed chain for your trade:{" "}
                <span className="text-[var(--game-cyan)]">{duel.myExecGainsChain}</span>
                {duel.creatorChain != null && duel.opponentChain != null ? (
                  <>
                    {" "}
                    (host {duel.creatorChain} · guest {duel.opponentChain})
                  </>
                ) : null}
              </p>
            ) : duel.playMode === "duel" ? (
              <p className={`${gameMuted} text-xs`}>
                Duel mode — pick <span className="text-[var(--game-cyan)]">Arbitrum</span> or{" "}
                <span className="text-[var(--game-cyan)]">Base</span> for your trade; the chain is saved
                when you mark ready.
              </p>
            ) : null}
            <div className="space-y-2">
              <span className={gameLabel}>Trading pair</span>
              <p className={`${gameMuted} text-xs`}>
                Tap a row to set{" "}
                <span className="text-[var(--game-cyan)]">
                  pair + live price
                </span>{" "}
                for on-chain open (avoids stale demo price reverts).
              </p>
              <GainsPairPicker
                chain={gainsChain}
                chainOptions={gainsPickerChainOptions}
                chainSelectDisabled={Boolean(duel.myExecGainsChain)}
                onChainChange={(c) => {
                  setGainsChain(c)
                  setPairIndex(0)
                  setSelectedPairLabel("")
                  setSelectedReferencePrice(null)
                }}
                selectedPairIndex={pairIndex}
                onSelectPair={(p: GainsTradingPair) => {
                  setPairIndex(p.pairIndex)
                  setSelectedPairLabel(p.name)
                  setSelectedReferencePrice(
                    Number.isFinite(p.price) && p.price > 0 ? p.price : null,
                  )
                }}
              />
            </div>
            <label className="block space-y-2">
              <span className={gameLabel}>Leverage (×)</span>
              <input
                type="number"
                min={1}
                max={500}
                value={leverageX}
                onChange={(e) =>
                  setLeverageX(Number.parseInt(e.target.value, 10) || 1)
                }
                className={gameInput}
              />
            </label>
            <label className="flex cursor-pointer items-center gap-3 text-sm text-[var(--game-text)]">
              <input
                type="checkbox"
                checked={long}
                onChange={(e) => setLong(e.target.checked)}
                className="size-4 accent-[var(--game-cyan)]"
              />
              <span>Long (uncheck for short)</span>
            </label>
            {swapResult ? (
              <p className="text-xs text-[var(--game-cyan)]">{swapResult}</p>
            ) : null}
            {readyError ? (
              <p className="text-sm text-[var(--game-danger)]">{readyError}</p>
            ) : null}
            <button
              type="button"
              disabled={readyLoading}
              onClick={() => void onMarkReady()}
              className={gameBtnPrimary}
            >
              {swapBusy
                ? "Swapping…"
                : readyLoading
                  ? "Sending…"
                  : selectedToken && !selectedToken.isCollateral
                    ? `Swap ${selectedToken.symbol} → USDC & GO`
                    : "Mark ready — GO"}
            </button>
          </div>
        ) : (
          <div className="rounded-sm border-2 border-[var(--game-cyan)]/40 bg-[rgba(65,245,240,0.08)] px-4 py-4 text-sm">
            <p className="font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wider text-[var(--game-cyan)]">
              Ready locked in
            </p>
            <p className={`${gameMuted} mt-1`}>
              {selectedPairLabel || `Pair #${pairIndex}`} · {gainsChain} ·{" "}
              {leverageX}× · {long ? "Long" : "Short"}
              {selectedReferencePrice != null ? (
                <> · ref price {selectedReferencePrice}</>
              ) : null}
            </p>
          </div>
        )}

        {duel.myReady && !duel.bothReady ? (
          <p
            className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-[0.2em] text-[var(--game-amber)]`}
          >
            Waiting for opponent…
          </p>
        ) : null}

        {waitingWsStart ? (
          <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[rgba(4,2,12,0.88)] backdrop-blur-sm">
            <div
              className="mb-5 size-10 animate-spin rounded-full border-2 border-[var(--game-cyan-dim)] border-t-[var(--game-cyan)]"
              aria-hidden
            />
            <p className="font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-[0.35em] text-[var(--game-cyan)]">
              Waiting for server signal
            </p>
            <p
              className={`${gameMuted} mt-2 max-w-xs px-4 text-center text-[11px]`}
            >
              Both players are ready. WebSocket:{" "}
              <span className="font-semibold text-[var(--game-text)]">
                {connectionState}
              </span>
              {connectionState !== "open" ? (
                <>
                  {" "}
                  — open prep with a connected wallet to subscribe to the duel.
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        {duel.bothReady && prepOverlayNum !== null ? (
          <div className="game-countdown-overlay fixed inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
            <p className="mb-6 font-[family-name:var(--font-orbitron)] text-[10px] font-black uppercase tracking-[0.5em] text-[var(--game-magenta)] [text-shadow:0_0_16px_rgba(255,61,154,0.6)]">
              Engage
            </p>
            <p className="game-countdown-num tabular-nums">{prepOverlayNum}</p>
            <p className="mt-8 font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-[0.35em] text-[var(--game-text-muted)]">
              Duel sync
            </p>
          </div>
        ) : null}

        {duel.bothReady &&
        (execError ||
          (prepCountdownDone &&
            (txHash || execLoading || duel.myTradeOpened))) ? (
          <div
            className={`${gamePanel} ${gamePanelTopAccent} relative z-[45] space-y-4 p-6`}
          >
            <h2 className="font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-[var(--game-amber)]">
              Trade launch
            </h2>
            {execLoading && !txHash && !duel.myTradeOpened ? (
              <p className={gameMuted}>Signing…</p>
            ) : null}
            {duel.myTradeOpened && !txHash && !execError && !execLoading ? (
              <p className={gameMuted}>
                Position already open — resuming session (no new signature).
              </p>
            ) : null}
            {execError ? (
              <div className="space-y-3">
                <p className="text-sm text-[var(--game-danger)]">{execError}</p>
                {!duel.myTradeOpened ? (
                  <button
                    type="button"
                    disabled={execLoading}
                    onClick={() => void onRetrySign()}
                    className="w-full rounded-sm border-2 border-[var(--game-magenta)] bg-transparent py-2.5 text-sm font-bold uppercase tracking-wider text-[var(--game-magenta)] transition enabled:hover:bg-[rgba(255,61,154,0.12)] disabled:opacity-50"
                  >
                    Retry signing
                  </button>
                ) : null}
              </div>
            ) : null}
            {txHash ? (
              <p className="break-all font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-cyan)]">
                Tx: {txHash}
              </p>
            ) : null}
          </div>
        ) : null}

        <Link href={`/duel/${duelId}`} className={`${gameLink} text-center`}>
          ← Back to lobby
        </Link>
      </main>
    </>
  )
}
