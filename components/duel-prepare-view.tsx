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
import { useGainsRealtime } from "@/components/gains-realtime-context"
import { TokenPicker, extractNumericChainId, type SelectedToken } from "@/components/token-picker"
import {
  duelLiveSoberShell,
  GameHudBar,
  GameLogo,
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
import {
  chainIdFromGainsApiChain,
  extractPositionIdFromMobulaId,
  gainsPositionHistorySideKey,
  prettyPairFromMarketId,
  type GainsApiChain,
  type GainsTradingPair,
} from "@/types/gains-api"
import type { GainsDuelPnlOutcome } from "@/types/duel-pnl-outcome"
import type { DuelTradeSideConfig } from "@/types/duel-trade"

const POLL_MS = 1000
const COUNTDOWN_TOTAL_MS = 3000

/**
 * Compte à rebours local aligné sur `remainingSeconds` du WS.
 * La synchro props → state est reportée via `queueMicrotask` pour éviter un setState
 * synchrone dans le corps de l’effect (React Compiler / eslint).
 */
function useDuelWsCountdown(
  serverSeconds: number | null,
  duelTimerEnded: boolean,
) {
  const [tick, setTick] = useState<number | null>(null)

  useEffect(() => {
    const sync = () => {
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
    }
    queueMicrotask(sync)
  }, [serverSeconds, duelTimerEnded])

  useEffect(() => {
    if (duelTimerEnded || tick === null || tick <= 0) return
    const id = setInterval(() => {
      setTick((t) => (t != null && t > 0 ? t - 1 : t))
    }, POLL_MS)
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
  viewerAccountPseudo?: string | null
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
  /** Résultat persisté en base après fermeture (reload). */
  persistedPnlOutcome?: GainsDuelPnlOutcome | null
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
  /**
   * Horloge locale pour le 3-2-1 : `null` au premier rendu (SSR + 1er paint client) pour éviter
   * tout écart serveur/client (Date.now / useState(Date.now) → mismatch d’hydratation).
   */
  const [nowTick, setNowTick] = useState<number | null>(null)

  const [pairIndex, setPairIndex] = useState(0)
  const [gainsChain, setGainsChain] = useState<GainsApiChain>("Testnet")
  const [selectedPairLabel, setSelectedPairLabel] = useState("")
  /** Prix API au clic sur une paire — envoyé au contrat comme `openPrice` (évite slippage / revert). */
  const [selectedReferencePrice, setSelectedReferencePrice] = useState<
    number | null
  >(null)
  const [leverageX, setLeverageX] = useState(10)
  /** Saisie levier sans `type="number"` (pas de flèches) ; chiffres uniquement, clamp 1–500 au blur. */
  const [leverageDraft, setLeverageDraft] = useState("10")
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

  /**
   * Le WS renvoie TOUTES les positions ouvertes du wallet (pas juste celles de la duel).
   * On filtre par chain pour ne garder que celles de la duel — sinon des positions
   * pré-existantes sur une autre chaîne (ex: Arbitrum Sepolia) apparaissent à l'écran
   * et sont fermées automatiquement à la fin du timer.
   */
  const myDuelChainId = duel?.myExecGainsChain
    ? chainIdFromGainsApiChain(duel.myExecGainsChain)
    : null
  const opponentGainsChain: GainsApiChain | null =
    duel?.viewer?.isCreator
      ? duel?.opponentChain ?? null
      : duel?.creatorChain ?? null
  const opponentDuelChainId = opponentGainsChain
    ? chainIdFromGainsApiChain(opponentGainsChain)
    : null

  const filteredMyPositions = useMemo(
    () =>
      myDuelChainId
        ? myPositions.filter((p) => p.chainId === myDuelChainId)
        : myPositions,
    [myPositions, myDuelChainId],
  )
  const filteredOpponentPositions = useMemo(
    () =>
      opponentDuelChainId
        ? opponentPositions.filter((p) => p.chainId === opponentDuelChainId)
        : opponentPositions,
    [opponentPositions, opponentDuelChainId],
  )

  /** Trace résolution du chain scope — utile pour comprendre pourquoi une chaîne n'est pas filtrée. */
  const lastChainScopeRef = useRef<string>("")
  useEffect(() => {
    const sig = `${duelId}|${duel?.myExecGainsChain ?? ""}|${myDuelChainId ?? ""}|${opponentGainsChain ?? ""}|${opponentDuelChainId ?? ""}`
    if (sig === lastChainScopeRef.current) return
    lastChainScopeRef.current = sig
    console.log("[duel-view] chain scope resolved", {
      duelId,
      myExecGainsChain: duel?.myExecGainsChain ?? null,
      myDuelChainId,
      opponentGainsChain,
      opponentDuelChainId,
      viewerIsCreator: duel?.viewer?.isCreator ?? null,
      ...(myDuelChainId == null
        ? {
            warning:
              "myDuelChainId is null — WS positions will NOT be filtered (pre-existing positions on other chains may leak into the UI and auto-close).",
          }
        : {}),
    })
  }, [
    duelId,
    duel?.myExecGainsChain,
    duel?.viewer?.isCreator,
    myDuelChainId,
    opponentGainsChain,
    opponentDuelChainId,
  ])

  /** Trace filtre display MES positions — log uniquement si le résumé (total/kept/chainId) change. */
  const lastMyFilterSigRef = useRef<string>("")
  useEffect(() => {
    const sig = `${myPositions.length}:${filteredMyPositions.length}:${myDuelChainId ?? "none"}`
    if (sig === lastMyFilterSigRef.current) return
    lastMyFilterSigRef.current = sig
    const dropped = myDuelChainId
      ? myPositions.filter((p) => p.chainId !== myDuelChainId)
      : []
    console.log("[duel-view] my positions filter", {
      duelChainId: myDuelChainId,
      total: myPositions.length,
      kept: filteredMyPositions.length,
      dropped: dropped.length,
      droppedSample: dropped.slice(0, 5).map((p) => ({
        id: p.id,
        chainId: p.chainId,
        marketId: p.marketId,
      })),
    })
  }, [myPositions, filteredMyPositions, myDuelChainId])

  /** Trace filtre display positions ADVERSAIRE — même idée que ci-dessus. */
  const lastOppFilterSigRef = useRef<string>("")
  useEffect(() => {
    const sig = `${opponentPositions.length}:${filteredOpponentPositions.length}:${opponentDuelChainId ?? "none"}`
    if (sig === lastOppFilterSigRef.current) return
    lastOppFilterSigRef.current = sig
    const dropped = opponentDuelChainId
      ? opponentPositions.filter((p) => p.chainId !== opponentDuelChainId)
      : []
    console.log("[duel-view] opponent positions filter", {
      duelChainId: opponentDuelChainId,
      total: opponentPositions.length,
      kept: filteredOpponentPositions.length,
      dropped: dropped.length,
      droppedSample: dropped.slice(0, 5).map((p) => ({
        id: p.id,
        chainId: p.chainId,
        marketId: p.marketId,
      })),
    })
  }, [opponentPositions, filteredOpponentPositions, opponentDuelChainId])

  const duelEndedForUi = duelTimerEnded || Boolean(duel?.duelClosedAt)

  const duelCountdownDisplay = useDuelWsCountdown(
    duelRemainingSeconds,
    duelEndedForUi,
  )

  /**
   * Après reload, le WS renvoie souvent `remainingSeconds <= 0` sans historique local → un outcome
   * `{ winner: "unknown", … }` non null qui écrasait `persistedPnlOutcome` via `??`.
   * Tant que le duel est fermé en base, on affiche le résultat persisté.
   */
  const effectivePnlOutcome = useMemo((): GainsDuelPnlOutcome | null => {
    const fromWs = duelPnlOutcome
    const fromDb = duel?.persistedPnlOutcome ?? null
    if (duel?.duelClosedAt != null && fromDb != null) {
      return fromDb
    }
    return fromWs ?? fromDb
  }, [duelPnlOutcome, duel?.persistedPnlOutcome, duel?.duelClosedAt])

  useEffect(() => {
    if (!duelTimerEnded) {
      setDuelAutoCloseBusy(false)
      setDuelAutoCloseResult(null)
    }
  }, [duelTimerEnded])

  useLayoutEffect(() => {
    if (!duelTimerEnded) return
    const rawBatch = takeDuelEndCloseTargets()
    if (!rawBatch?.length) return

    /**
     * Ne fermer que les positions ouvertes pour cette duel (filtrage par chain).
     * Sans filtre, des positions pré-existantes sur une autre chaîne (ex: Arbitrum Sepolia
     * laissée ouverte avant la duel) seraient fermées par erreur.
     */
    const batch = myDuelChainId
      ? rawBatch.filter((p) => p.chainId === myDuelChainId)
      : rawBatch
    const skipped = rawBatch.length - batch.length
    if (skipped > 0) {
      console.warn("[duel-auto-close] filtered out non-duel-chain positions", {
        duelChainId: myDuelChainId,
        skipped,
        skippedIds: rawBatch
          .filter((p) => p.chainId !== myDuelChainId)
          .map((p) => p.id),
      })
    }
    if (!batch.length) {
      console.log("[duel-auto-close] nothing to close after chain filter", {
        duelChainId: myDuelChainId,
        rawCount: rawBatch.length,
      })
      return
    }

    setDuelAutoCloseBusy(true)
    setDuelAutoCloseResult(null)

    console.log("[duel-auto-close] starting", {
      duelId,
      count: batch.length,
      ids: batch.map((p) => p.id),
      duelChainId: myDuelChainId,
    })
    void (async () => {
      const errs: string[] = []
      for (const pos of batch) {
        if (!pos.marketId || !pos.chainId || !pos.exchange) {
          console.warn("[duel-auto-close] skip — missing required fields", {
            id: pos.id,
            marketId: pos.marketId,
            chainId: pos.chainId,
            exchange: pos.exchange,
          })
          continue
        }
        const label = prettyPairFromMarketId(pos.marketId)
        const positionId = extractPositionIdFromMobulaId(pos.id, pos.address)
        const body = {
          dex: pos.exchange,
          chainId: pos.chainId,
          marketId: pos.marketId,
          positionId,
          trigger: "duel-auto-close" as const,
        }
        console.log("[duel-auto-close] POST /api/perp-positions/close", { id: pos.id, ...body })
        const t0 = performance.now()
        try {
          const r = await fetch("/api/perp-positions/close", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          })
          const data = (await r.json()) as {
            error?: string
            txHash?: string
            rateLimited?: boolean
          }
          const durationMs = Math.round(performance.now() - t0)
          if (!r.ok) {
            if (data.rateLimited) {
              console.error("[duel-auto-close] DYNAMIC_RATE_LIMITED", {
                id: pos.id,
                status: r.status,
                error: data.error,
                durationMs,
              })
            } else {
              console.error("[duel-auto-close] failed", {
                id: pos.id,
                status: r.status,
                error: data.error,
                durationMs,
              })
            }
            errs.push(`${label}: ${data.error ?? "failed"}`)
          } else {
            console.log("[duel-auto-close] ok", {
              id: pos.id,
              txHash: data.txHash,
              durationMs,
            })
          }
        } catch (e) {
          console.error("[duel-auto-close] network error", {
            id: pos.id,
            error: e,
            durationMs: Math.round(performance.now() - t0),
          })
          errs.push(`${label}: network`)
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
  }, [duelTimerEnded, takeDuelEndCloseTargets, duelId, myDuelChainId])

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
        setLeverageDraft(String(data.myTradeConfig.leverageX))
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

  /** Derive gainsChain from the selected collateral token's chain. */
  useEffect(() => {
    if (duel?.myExecGainsChain) return // already locked by server
    if (duel?.playMode !== "duel") {
      setGainsChain("Testnet")
      return
    }
    if (!selectedToken) return
    const numeric = extractNumericChainId(selectedToken.chainId)
    if (numeric === "8453") setGainsChain("Base")
    else if (numeric === "42161") setGainsChain("Arbitrum")
  }, [selectedToken, duel?.playMode, duel?.myExecGainsChain])

  /** Booléen dérivé : évite un tableau de deps dont la « forme » change (warning React / Fast Refresh). */
  const shouldPollDuel =
    Boolean(duel?.duelFull) && Boolean(participant) && !duel?.bothReady

  /** Tant que les deux ne sont pas « ready », on resynchronise l’état (l’autre joueur peut marquer prêt). Après `bothReady`, plus de poll — ouverture auto + WS. */
  useEffect(() => {
    if (!shouldPollDuel) return

    const id = setInterval(() => void loadDuel(), POLL_MS)
    return () => clearInterval(id)
  }, [shouldPollDuel, loadDuel])

  useLayoutEffect(() => {
    setNowTick(Date.now())
  }, [])

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
    (nowTick === null || nowTick - duelStartSignalAt < COUNTDOWN_TOTAL_MS)
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
    subscribePositions(duelId, {
      my: myDuelChainId,
      opponent: opponentDuelChainId,
    })
  }, [
    duel?.bothReady,
    participant,
    duelId,
    subscribePositions,
    myDuelChainId,
    opponentDuelChainId,
  ])

  const hasLocalStart = duelStartSignalAt != null
  const prepElapsed =
    duel?.bothReady === true && hasLocalStart && nowTick != null
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
              chainId: Number(extractNumericChainId(selectedToken.chainId) ?? "0"),
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

      let lev = Number.parseInt(leverageDraft, 10)
      if (!Number.isFinite(lev) || lev < 1) lev = 1
      if (lev > 500) lev = 500
      setLeverageX(lev)
      setLeverageDraft(String(lev))

      // Now mark ready with trade config
      const res = await fetch(`/api/duels/${duelId}/trade-ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          pairIndex,
          leverageX: lev,
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
    subscribePositions(duelId, {
      my: myDuelChainId,
      opponent: opponentDuelChainId,
    })
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
  }, [duelId, subscribePositions, loadDuel, myDuelChainId, opponentDuelChainId])

  onExecuteRef.current = onExecute

  function onRetrySign() {
    autoSignStartedRef.current = false
    void onExecute()
  }

  if (!duelId) {
    return (
      <div className="flex w-full flex-none flex-col min-h-dvh">
        <div className="shrink-0">
          <GameHudBar>
            <GameLogo className="h-8 w-auto sm:h-9" />
          </GameHudBar>
        </div>
        <p className="p-8 text-sm text-[var(--game-danger)]">
          Missing duel id.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex w-full flex-none flex-col min-h-dvh">
        <div className="shrink-0">
          <GameHudBar>
            <Link href="/" className="shrink-0">
              <GameLogo className="h-9 w-auto sm:h-10" />
            </Link>
          </GameHudBar>
        </div>
        <main className="mx-auto max-w-lg flex-1 overflow-y-auto px-4 py-16">
          <p
            className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-widest`}
          >
            Loading…
          </p>
        </main>
      </div>
    )
  }

  if (loadError || !duel) {
    return (
      <div className="flex w-full flex-none flex-col min-h-dvh">
        <div className="shrink-0">
          <GameHudBar>
            <Link href="/" className="shrink-0">
              <GameLogo className="h-9 w-auto sm:h-10" />
            </Link>
          </GameHudBar>
        </div>
        <main className="mx-auto max-w-lg flex-1 space-y-4 overflow-y-auto px-4 py-16">
          <p className="text-sm text-[var(--game-danger)]">
            {loadError ?? "Not found."}
          </p>
          <Link href="/" className={gameLink}>
            Back to hub
          </Link>
        </main>
      </div>
    )
  }

  if (!duel.duelFull) {
    return (
      <div className="flex w-full flex-none flex-col min-h-dvh">
        <div className="shrink-0">
          <GameHudBar>
            <Link href="/" className="shrink-0">
              <GameLogo className="h-9 w-auto sm:h-10" />
            </Link>
          </GameHudBar>
        </div>
        <main className="mx-auto max-w-lg flex-1 space-y-4 overflow-y-auto px-4 py-16">
          <p className={gameMuted}>This duel does not have two players yet.</p>
          <Link href={`/duel/${duelId}`} className={gameLink}>
            Back to lobby
          </Link>
        </main>
      </div>
    )
  }

  if (!participant) {
    return (
      <div className="flex w-full flex-none flex-col min-h-dvh">
        <div className="shrink-0">
          <GameHudBar>
            <Link href="/" className="shrink-0">
              <GameLogo className="h-9 w-auto sm:h-10" />
            </Link>
          </GameHudBar>
        </div>
        <main className="mx-auto max-w-lg flex-1 space-y-4 overflow-y-auto px-4 py-16">
          <p className={gameMuted}>You are not in this duel.</p>
          <Link href="/" className={gameLink}>
            Back to hub
          </Link>
        </main>
      </div>
    )
  }

  const myTradePseudo =
    duel.viewer?.isCreator === true
      ? duel.creatorPseudo
      : (duel.opponentPseudo ?? "—")
  const opponentTradePseudo =
    duel.viewer?.isCreator === true
      ? (duel.opponentPseudo ?? "—")
      : duel.creatorPseudo

  /** Après le 3-2-1 (ou rechargement alors que le duel est déjà live en base). */
  const duelUiLive = prepCountdownDone
  /** Duel en cours : tout tient dans le viewport (prepare/page en h-dvh). */
  const fitLiveViewport = duelUiLive && duel.bothReady
  /** Grille positions : effets PnL + palette sobre (pas après résultat). */
  const duelLiveActive = prepCountdownDone && !duelEndedForUi

  return (
    <div
      className={`flex w-full flex-col ${fitLiveViewport ? "h-dvh max-h-dvh min-h-0 overflow-hidden" : "flex-none"}`}
    >
      <div className="shrink-0">
        <GameHudBar wide={duel.bothReady}>
          <Link href="/" className="shrink-0">
            <GameLogo className="h-9 w-auto sm:h-10" />
          </Link>
          <p className="hidden font-[family-name:var(--font-orbitron)] text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--game-text-muted)] sm:block">
            {duelUiLive ? "Live duel" : "Combat loadout"}
          </p>
        </GameHudBar>
      </div>

      <main
        className={`flex w-full flex-col ${fitLiveViewport ? "min-h-0 flex-1" : ""} ${duel.bothReady ? "" : "mx-auto max-w-lg"} ${
          fitLiveViewport
            ? "gap-1.5 overflow-hidden px-1 pb-0 pt-1 sm:gap-2 sm:px-2"
            : duel.bothReady
              ? "gap-6 px-3 py-6 sm:px-4 sm:py-8"
              : "gap-6 px-4 py-10 sm:py-14"
        }`}
      >
        {fitLiveViewport ? (
          <div className="flex shrink-0 items-end justify-between gap-2 border-b border-zinc-600/30 pb-1">
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-orbitron)] text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
                Live
              </p>
              <h1 className="font-[family-name:var(--font-orbitron)] text-base font-bold tracking-wide text-zinc-100 sm:text-lg">
                Duel live
              </h1>
            </div>
            <Link
              href={`/duel/${duelId}`}
              className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-zinc-400 underline decoration-zinc-600 underline-offset-4 transition hover:text-zinc-200"
            >
              ← Lobby
            </Link>
          </div>
        ) : (
          <div className="shrink-0 space-y-3">
            <p className={gameSubtitle}>{duelUiLive ? "Live" : "Trade prep"}</p>
            <h1 className={`${gameTitle} !text-xl sm:!text-2xl`}>
              {duelUiLive ? "Duel live" : "Gains setup"}
            </h1>
          </div>
        )}

        {!duelUiLive ? (
          <div
            className={`${gamePanel} ${gamePanelTopAccent} space-y-3 p-6 text-sm`}
          >
            <p className={gameLabel}>Ready</p>
            <ul className="space-y-2">
              <li className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-[family-name:var(--font-share-tech)] text-[var(--game-text)]">
                  {duel.creatorPseudo}
                </span>
                <span
                  className={
                    duel.readyState[0] === 1
                      ? "font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wider text-emerald-500/90"
                      : "font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wider text-[var(--game-text-muted)]"
                  }
                >
                  {duel.readyState[0] === 1 ? "Ready" : "Not ready"}
                </span>
              </li>
              <li className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-[family-name:var(--font-share-tech)] text-[var(--game-text)]">
                  {duel.opponentPseudo ?? "Opponent"}
                </span>
                <span
                  className={
                    duel.opponentPseudo == null
                      ? "font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wider text-[var(--game-text-muted)]"
                      : duel.readyState[1] === 1
                        ? "font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wider text-emerald-500/90"
                        : "font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wider text-[var(--game-text-muted)]"
                  }
                >
                  {duel.opponentPseudo == null
                    ? "—"
                    : duel.readyState[1] === 1
                      ? "Ready"
                      : "Not ready"}
                </span>
              </li>
            </ul>
          </div>
        ) : null}

        {duel.bothReady ? (
          <div
            className={
              prepCountdownDone
                ? "flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
                : "space-y-4"
            }
          >
            {prepCountdownDone ? (
              <>
                {duelEndedForUi && effectivePnlOutcome ? (
                  <div
                    className={`${duelLiveSoberShell} shrink-0 px-3 py-4 text-center sm:px-5 sm:py-5 md:py-6 ${
                      effectivePnlOutcome.winner === "you"
                        ? "border-emerald-800/50 shadow-[0_0_24px_rgba(16,185,129,0.08)]"
                        : effectivePnlOutcome.winner === "opponent"
                          ? "border-rose-800/50 shadow-[0_0_24px_rgba(244,63,94,0.08)]"
                          : effectivePnlOutcome.winner === "tie"
                            ? "border-zinc-600/50"
                            : ""
                    }`}
                  >
                    <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.22em] text-zinc-500 sm:text-[10px]">
                      Duel over · positions closed
                    </p>
                    <p
                      className={`font-[family-name:var(--font-orbitron)] font-black uppercase leading-[0.92] tracking-[0.08em] text-[clamp(2.75rem,12vmin,5.75rem)] sm:text-[clamp(3.25rem,14vmin,6.5rem)] md:text-[clamp(3.5rem,15vmin,7.25rem)] ${
                        effectivePnlOutcome.winner === "you"
                          ? "text-emerald-400/95"
                          : effectivePnlOutcome.winner === "opponent"
                            ? "text-rose-400/95"
                            : effectivePnlOutcome.winner === "tie"
                              ? "text-zinc-300"
                              : "text-zinc-500"
                      }`}
                    >
                      {effectivePnlOutcome.winner === "you"
                        ? "WIN"
                        : effectivePnlOutcome.winner === "opponent"
                          ? "LOSS"
                          : effectivePnlOutcome.winner === "tie"
                            ? "TIE"
                            : "INCOMPLETE"}
                    </p>
                    <p className={`${gameMuted} mx-auto mt-1 max-w-md text-[10px] leading-tight sm:text-[11px]`}>
                      All positions closed at market.
                    </p>
                  </div>
                ) : duelEndedForUi ? (
                  <div
                    className={`${duelLiveSoberShell} shrink-0 px-3 py-4 text-center sm:px-5 sm:py-5 md:py-6`}
                  >
                    <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.22em] text-zinc-500 sm:text-[10px]">
                      Duel over · positions closed
                    </p>
                    <p
                      className={`font-[family-name:var(--font-orbitron)] font-black tabular-nums leading-[0.92] tracking-tight text-[clamp(2.75rem,12vmin,5.75rem)] sm:text-[clamp(3.25rem,14vmin,6.5rem)] text-zinc-500`}
                    >
                      …
                    </p>
                    <p className={`${gameMuted} mx-auto mt-1 max-w-md text-[10px] leading-tight sm:text-[11px]`}>
                      Finalizing scores…
                    </p>
                  </div>
                ) : (
                  <div
                    className={`${duelLiveSoberShell} shrink-0 px-3 py-4 text-center sm:px-5 sm:py-5 md:py-6`}
                  >
                    <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.22em] text-indigo-400/85 sm:text-[10px]">
                      Time left (duel)
                    </p>
                    <p
                      className={`font-[family-name:var(--font-orbitron)] font-black tabular-nums leading-[0.92] tracking-tight text-[clamp(2.75rem,12vmin,5.75rem)] sm:text-[clamp(3.25rem,14vmin,6.5rem)] md:text-[clamp(3.5rem,15vmin,7.25rem)] ${
                        duelCountdownDisplay === 0
                          ? "text-rose-400/90 [text-shadow:0_0_24px_rgba(244,63,94,0.45)]"
                          : "text-zinc-100"
                      }`}
                    >
                      {duelCountdownDisplay === null ? (
                        <span className="text-zinc-600">…</span>
                      ) : duelCountdownDisplay === 0 ? (
                        "0 s"
                      ) : (
                        <>{duelCountdownDisplay} s</>
                      )}
                    </p>
                    <p className={`${gameMuted} mx-auto mt-1 max-w-md text-[10px] leading-tight sm:text-[11px]`}>
                      At 0s, positions close at market (one tx per trade).
                    </p>
                  </div>
                )}

                {duelAutoCloseBusy || duelAutoCloseResult ? (
                  <div
                    className={`shrink-0 rounded-sm border px-2.5 py-2 text-xs sm:px-3 sm:py-2.5 sm:text-sm ${
                      duelAutoCloseResult != null &&
                      (duelAutoCloseResult.includes("partial") ||
                        duelAutoCloseResult.includes("failed"))
                        ? "border-red-900/40 bg-red-950/25 text-zinc-200"
                        : "border-zinc-600/45 bg-zinc-900/50 text-zinc-200"
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

                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                  <div className="relative grid shrink-0 items-center gap-1.5 sm:gap-2 lg:grid-cols-[1fr_auto_1fr]">
                    <div
                      className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-px -translate-y-1/2 bg-gradient-to-r from-indigo-500/55 via-indigo-300/35 to-amber-400/50 opacity-85"
                      aria-hidden
                    />
                    <p className="relative z-10 truncate text-center font-[family-name:var(--font-orbitron)] text-base font-bold uppercase tracking-wide text-indigo-100 [text-shadow:0_0_16px_rgba(129,140,248,0.42)] sm:text-lg">
                      {myTradePseudo}
                    </p>
                    <p
                      className="duel-vs-mark relative z-10 bg-gradient-to-b from-indigo-200 via-indigo-400 to-amber-500 bg-clip-text text-center font-[family-name:var(--font-orbitron)] text-2xl font-black italic tabular-nums text-transparent sm:text-3xl lg:px-1"
                      aria-label="versus"
                    >
                      VS
                    </p>
                    <p className="relative z-10 truncate text-center font-[family-name:var(--font-orbitron)] text-base font-bold uppercase tracking-wide text-amber-100 [text-shadow:0_0_16px_rgba(251,191,36,0.4)] sm:text-lg">
                      {opponentTradePseudo}
                    </p>
                  </div>
                  {duelEndedForUi && effectivePnlOutcome ? (
                    <div
                      className={`${duelLiveSoberShell} min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:space-y-4 sm:p-5`}
                    >
                      <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-zinc-500 sm:text-[10px]">
                        Final stats
                      </p>
                      <p className={`${gameMuted} text-[11px] leading-snug sm:text-xs`}>
                        Ranked by{" "}
                        <span className="font-semibold text-[var(--game-text)]">PnL %</span> on the
                        last tick ~1s (or last known % if a position closed early).
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                        <div className="rounded-sm border border-zinc-600/40 border-l-indigo-500/65 bg-zinc-950/60 p-3 shadow-[inset_3px_0_0_0_rgba(129,140,248,0.4)] sm:p-4">
                          <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-indigo-400/95">
                            You
                          </p>
                          <p className="truncate font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-indigo-50 sm:text-base">
                            {myTradePseudo}
                          </p>
                          <p className="mt-2 font-[family-name:var(--font-orbitron)] text-2xl font-bold tabular-nums text-emerald-400/90 sm:text-3xl">
                            {formatOutcomePct(effectivePnlOutcome.myPnlPct)}
                          </p>
                          <p className="mt-1 font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)] sm:text-sm">
                            PnL USDC: {formatOutcomeUsdc(effectivePnlOutcome.myPnlUsdc)}
                          </p>
                        </div>
                        <div className="rounded-sm border border-zinc-600/40 border-l-amber-500/65 bg-zinc-950/60 p-3 shadow-[inset_3px_0_0_0_rgba(251,191,36,0.4)] sm:p-4">
                          <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-amber-400/95">
                            Opponent
                          </p>
                          <p className="truncate font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-amber-50 sm:text-base">
                            {opponentTradePseudo}
                          </p>
                          <p className="mt-2 font-[family-name:var(--font-orbitron)] text-2xl font-bold tabular-nums text-rose-400/90 sm:text-3xl">
                            {formatOutcomePct(effectivePnlOutcome.opponentPnlPct)}
                          </p>
                          <p className="mt-1 font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)] sm:text-sm">
                            PnL USDC:{" "}
                            {formatOutcomeUsdc(effectivePnlOutcome.opponentPnlUsdc)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : duelEndedForUi ? (
                    <div
                      className={`${duelLiveSoberShell} flex flex-1 items-center justify-center p-6 text-center`}
                    >
                      <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider`}>
                        Waiting for final PnL…
                      </p>
                    </div>
                  ) : (
                    <div className="grid h-full min-h-0 flex-1 gap-2 overflow-hidden lg:grid-cols-2 lg:items-stretch lg:gap-3">
                      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                        <GainsLivePositionsPanel
                          className="h-full min-h-0 flex-1"
                          compact
                          expandChart
                          liveDuelVisuals={duelLiveActive}
                          duelPlayerSide="my"
                          panelTitle="Positions (live)"
                          positionCardLabel="Your position"
                          showConnectionMeta={false}
                          positions={filteredMyPositions}
                          pnlHistoryByKey={pnlHistoryMy}
                          historyKeyForPosition={(p) =>
                            gainsPositionHistorySideKey("my", p)
                          }
                          connectionState={connectionState}
                          lastWsError={lastWsError}
                          gainsWallet={gainsWallet}
                          gainsChain={gainsChain}
                          wsDuelId={duelId}
                          duelEnded={duelEndedForUi}
                        />
                      </div>
                      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                        <GainsLivePositionsPanel
                          className="h-full min-h-0 flex-1"
                          compact
                          expandChart
                          liveDuelVisuals={duelLiveActive}
                          duelPlayerSide="opponent"
                          panelTitle="Positions (live)"
                          positionCardLabel="Opponent position"
                          readOnly
                          showConnectionMeta={false}
                          positions={filteredOpponentPositions}
                          pnlHistoryByKey={pnlHistoryOpponent}
                          historyKeyForPosition={(p) =>
                            gainsPositionHistorySideKey("opponent", p)
                          }
                          connectionState={connectionState}
                          lastWsError={lastWsError}
                          gainsWallet={gainsWallet}
                          gainsChain={gainsChain}
                          wsDuelId={duelId}
                          duelEnded={duelEndedForUi}
                        />
                      </div>
                    </div>
                  )}
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

        {!duelUiLive ? (
          <>
            {!duel.myReady && duel.playMode === "duel" ? (
              <TokenPicker
                stakeUsdc={duel.stakeUsdc}
                chainIds={
                  duel.myExecGainsChain === "Arbitrum"
                    ? ["42161"]
                    : duel.myExecGainsChain === "Base"
                      ? ["8453"]
                      : ["42161", "8453"]
                }
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
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={leverageDraft}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, "").slice(0, 3)
                      setLeverageDraft(d)
                      if (d === "") return
                      const n = Number.parseInt(d, 10)
                      if (Number.isFinite(n) && n >= 1 && n <= 500) setLeverageX(n)
                    }}
                    onBlur={() => {
                      let n = Number.parseInt(leverageDraft, 10)
                      if (!Number.isFinite(n) || n < 1) n = 1
                      if (n > 500) n = 500
                      setLeverageX(n)
                      setLeverageDraft(String(n))
                    }}
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
              <div className="rounded-sm border-2 border-[var(--game-cyan)]/40 bg-[rgba(129,140,248,0.08)] px-4 py-4 text-sm">
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
          </>
        ) : null}

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
            <p className="mb-6 font-[family-name:var(--font-orbitron)] text-[10px] font-black uppercase tracking-[0.5em] text-[var(--game-amber)] [text-shadow:0_0_20px_rgba(252,211,77,0.75),0_0_40px_rgba(251,191,36,0.45)]">
              Engage
            </p>
            <p className="game-countdown-num tabular-nums">{prepOverlayNum}</p>
            <p className="mt-8 font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-[0.35em] text-[var(--game-text-muted)]">
              Duel sync
            </p>
          </div>
        ) : null}

        {prepCountdownDone &&
        execLoading &&
        !txHash &&
        !duel.myTradeOpened &&
        !execError ? (
          <p
            className={`${gameMuted} shrink-0 text-center font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider`}
          >
            Signing trade…
          </p>
        ) : null}

        {prepCountdownDone && execError ? (
          <div
            className={`${gamePanel} relative z-[45] shrink-0 space-y-3 border-[var(--game-danger)]/40 p-4`}
          >
            <p className="text-sm text-[var(--game-danger)]">{execError}</p>
            {!duel.myTradeOpened ? (
              <button
                type="button"
                disabled={execLoading}
                onClick={() => void onRetrySign()}
                className="w-full rounded-sm border-2 border-[var(--game-magenta)] bg-transparent py-2.5 text-sm font-bold uppercase tracking-wider text-[var(--game-magenta)] transition enabled:hover:bg-[rgba(251,191,36,0.12)] disabled:opacity-50"
              >
                Retry signing
              </button>
            ) : null}
          </div>
        ) : null}

        {!fitLiveViewport ? (
          <Link href={`/duel/${duelId}`} className={`${gameLink} shrink-0 text-center`}>
            ← Back to lobby
          </Link>
        ) : null}
      </main>
    </div>
  )
}
