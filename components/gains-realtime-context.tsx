"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { GainsDuelPnlOutcome } from "@/types/duel-pnl-outcome"
import {
  bestPnlScoreFromPositions,
  gainsPositionHistorySideKey,
  gainsPositionStreamKey,
  type GainsDuelPositionsSnapshot,
  type GainsPositionPnlTick,
  type GainsPositionUpdate,
  isGainsDuelPositionsSnapshot,
  positionPnlUsd,
} from "@/types/gains-api"

export type { GainsDuelPnlOutcome }

type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error"

const PNL_HISTORY_MAX = 90

/**
 * Ajoute les ticks pour les positions présentes ; **ne supprime pas** les clés absentes
 * (fermeture manuelle en cours de duel → dernière courbe / dernier tick conservés).
 */
function mergePnlHistory(
  prev: Map<string, GainsPositionPnlTick[]>,
  incoming: GainsPositionUpdate[],
  keyFn: (p: GainsPositionUpdate) => string,
  now: number,
): Map<string, GainsPositionPnlTick[]> {
  const next = new Map(prev)

  for (const pos of incoming) {
    const key = keyFn(pos)
    const old = next.get(key) ?? []
    const merged = [...old, { t: now, pnl: positionPnlUsd(pos) }]
    const trimmed =
      merged.length > PNL_HISTORY_MAX
        ? merged.slice(merged.length - PNL_HISTORY_MAX)
        : merged
    next.set(key, trimmed)
  }

  return next
}

type GainsRealtimeContextValue = {
  walletAddress: string | null
  connectionState: ConnectionState
  lastWsError: string | null
  /** @deprecated Utiliser myPositions — conservé pour compat ( = mes positions ). */
  positions: GainsPositionUpdate[]
  pnlHistoryByKey: ReadonlyMap<string, GainsPositionPnlTick[]>
  myPositions: GainsPositionUpdate[]
  opponentPositions: GainsPositionUpdate[]
  pnlHistoryMy: ReadonlyMap<string, GainsPositionPnlTick[]>
  pnlHistoryOpponent: ReadonlyMap<string, GainsPositionPnlTick[]>
  /** Dernier `remainingSeconds` reçu du serveur (synchro UI + décompte local possible). */
  duelRemainingSeconds: number | null
  /** `true` si le dernier snapshot avait `remainingSeconds <= 0` (fin du duel côté serveur). */
  duelTimerEnded: boolean
  /** Résultat PnL % (dernier tick à ~1 s + derniers % connus si fermeture anticipée). `null` hors fin de duel. */
  duelPnlOutcome: GainsDuelPnlOutcome | null
  /**
   * Horodatage local (`Date.now()`) du dernier `{ event: "start", data: { duelId } }` reçu pour l’abonnement courant.
   * Sert à lancer le compte à rebours 3-2-1 côté UI après « les deux prêts ».
   */
  duelStartSignalAt: number | null
  /**
   * À appeler une fois quand `duelTimerEnded` passe à true : renvoie une copie des **mes** positions
   * issues du dernier message à **1 s** restantes (souvent le dernier avec prix/index utiles), sinon du tick 0.
   */
  takeDuelEndCloseTargets: () => GainsPositionUpdate[] | null
  /**
   * `chainScope` filtre les positions reçues du WS **avant** tout calcul (scores PnL, batch close,
   * state React). Nécessaire car le WS renvoie TOUTES les positions du wallet, y compris celles
   * ouvertes sur une autre chaîne avant la duel — sans filtrage, un outcome PnL peut refléter
   * un trade testnet pré-existant au lieu du trade mainnet de la duel.
   */
  subscribePositions: (
    duelId: string,
    chainScope?: { my?: string | null; opponent?: string | null },
  ) => void
  unsubscribePositions: () => void
}

const defaultValue: GainsRealtimeContextValue = {
  walletAddress: null,
  connectionState: "idle",
  lastWsError: null,
  positions: [],
  pnlHistoryByKey: new Map(),
  myPositions: [],
  opponentPositions: [],
  pnlHistoryMy: new Map(),
  pnlHistoryOpponent: new Map(),
  duelRemainingSeconds: null,
  duelTimerEnded: false,
  duelPnlOutcome: null,
  duelStartSignalAt: null,
  takeDuelEndCloseTargets: () => null,
  subscribePositions: () => {},
  unsubscribePositions: () => {},
}

const GainsRealtimeContext =
  createContext<GainsRealtimeContextValue>(defaultValue)

const LOG = "[GainsWS]"

/**
 * Alerte shape-drift : on mémorise les empreintes de champs vues et on log bruyamment
 * la première fois qu'une empreinte change. Couvre le cas de cette session où le WS est
 * passé au shape Mobula V2 et toutes les lectures ont retourné undefined.
 */
const POSITION_SHAPE_FINGERPRINTS = new Set<string>()
/** Champs requis par l'UI / les helpers ; toute absence signale une nouvelle régression potentielle. */
const REQUIRED_POSITION_FIELDS = [
  "id",
  "marketId",
  "exchange",
  "chainId",
  "side",
  "entryPriceQuote",
  "unrealizedPnlUSD",
] as const

function logPositionShapeIfNew(
  pos: GainsPositionUpdate,
  context: "my" | "opponent",
) {
  const keys = Object.keys(pos).sort()
  const fingerprint = keys.join(",")
  if (POSITION_SHAPE_FINGERPRINTS.has(fingerprint)) return
  POSITION_SHAPE_FINGERPRINTS.add(fingerprint)
  const missing = REQUIRED_POSITION_FIELDS.filter(
    (k) => !(k in (pos as Record<string, unknown>)),
  )
  console.log(LOG, "position shape seen", {
    context,
    id: pos.id,
    fieldCount: keys.length,
    fields: keys,
    ...(missing.length ? { MISSING_REQUIRED: missing } : {}),
  })
  if (missing.length > 0) {
    console.warn(
      LOG,
      "WS position payload missing required fields — UI will show NaN/undefined.",
      { context, missing, id: pos.id },
    )
  }
}

function wsUrlFromEnv(): string | null {
  const u = process.env.NEXT_PUBLIC_DUEL_DEFI_WS_URL?.trim()
  return u || null
}

function normAddr(a: string): string {
  return a.trim().toLowerCase()
}

export function useGainsRealtime() {
  return useContext(GainsRealtimeContext)
}

export function GainsRealtimeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle")
  const [lastWsError, setLastWsError] = useState<string | null>(null)
  const [myPositions, setMyPositions] = useState<GainsPositionUpdate[]>([])
  const [opponentPositions, setOpponentPositions] = useState<
    GainsPositionUpdate[]
  >([])
  const [pnlHistoryMy, setPnlHistoryMy] = useState(
    () => new Map<string, GainsPositionPnlTick[]>(),
  )
  const [pnlHistoryOpponent, setPnlHistoryOpponent] = useState(
    () => new Map<string, GainsPositionPnlTick[]>(),
  )
  const [duelRemainingSeconds, setDuelRemainingSeconds] = useState<
    number | null
  >(null)
  const [duelTimerEnded, setDuelTimerEnded] = useState(false)
  const [duelPnlOutcome, setDuelPnlOutcome] =
    useState<GainsDuelPnlOutcome | null>(null)
  const [duelStartSignalAt, setDuelStartSignalAt] = useState<number | null>(
    null,
  )

  /** Legacy : même référence que mes positions pour l’historique combiné affiché ailleurs. */
  const [legacyPnlHistoryByKey, setLegacyPnlHistoryByKey] = useState(
    () => new Map<string, GainsPositionPnlTick[]>(),
  )

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptRef = useRef(0)
  const intentionalUnmountRef = useRef(false)
  const subscribedDuelIdRef = useRef<string | null>(null)
  /** Mes positions au tick « fin de duel » — consommées par `takeDuelEndCloseTargets`. */
  const duelEndCloseTargetsRef = useRef<GainsPositionUpdate[] | null>(null)
  /**
   * Dernier snapshot à remainingSeconds === 1 : le serveur n’envoie souvent plus les positions au tick 0,
   * on garde celles du message « 1 s » pour close-market.
   */
  const duelCloseTargetsAtOneSecondRef = useRef<GainsPositionUpdate[] | null>(
    null,
  )
  /** Dernier score PnL % connu par joueur (persiste si la position disparaît avant la fin). */
  const lastMyScoreRef = useRef<{ pct: number; pnlUsdc: number } | null>(null)
  const lastOpponentScoreRef = useRef<{ pct: number; pnlUsdc: number } | null>(
    null,
  )
  /** Snapshot comparatif au tick `remainingSeconds === 1` (souvent aligné sur le flux ~1 s). */
  const scoresAtOneSecondRef = useRef<{
    my: { pct: number; pnlUsdc: number } | null
    opponent: { pct: number; pnlUsdc: number } | null
  } | null>(null)
  /** Filtres de chain (ex: `"evm:42161"`) appliqués à chaque snapshot WS — voir `subscribePositions.chainScope`. */
  const myChainScopeRef = useRef<string | null>(null)
  const opponentChainScopeRef = useRef<string | null>(null)
  /** Trace le résumé filtrage précédent par snapshot — évite le spam d'un log par tick. */
  const lastScopeFilterLogRef = useRef<string>("")

  const takeDuelEndCloseTargets = useCallback(():
    | GainsPositionUpdate[]
    | null => {
    const v = duelEndCloseTargetsRef.current
    duelEndCloseTargetsRef.current = null
    return v
  }, [])

  const resetPositionState = useCallback(() => {
    duelEndCloseTargetsRef.current = null
    duelCloseTargetsAtOneSecondRef.current = null
    lastMyScoreRef.current = null
    lastOpponentScoreRef.current = null
    scoresAtOneSecondRef.current = null
    setDuelPnlOutcome(null)
    setMyPositions([])
    setOpponentPositions([])
    setPnlHistoryMy(new Map())
    setPnlHistoryOpponent(new Map())
    setLegacyPnlHistoryByKey(new Map())
    setDuelRemainingSeconds(null)
    setDuelTimerEnded(false)
    setDuelStartSignalAt(null)
  }, [])

  const applyDuelSnapshot = useCallback(
    (snap: GainsDuelPositionsSnapshot, sessionWallet: string) => {
      const me = normAddr(sessionWallet)
      const rawMine: GainsPositionUpdate[] = []
      const rawTheirs: GainsPositionUpdate[] = []

      for (const u of snap.users) {
        const w = normAddr(u.wallet)
        if (w === me) {
          rawMine.push(...u.positions)
        } else {
          rawTheirs.push(...u.positions)
        }
      }

      for (const p of rawMine) logPositionShapeIfNew(p, "my")
      for (const p of rawTheirs) logPositionShapeIfNew(p, "opponent")

      /**
       * Filtrage par chain AVANT toute autre lecture : scores PnL, state React, batch close, etc.
       * Sans ça, une position pré-existante sur une autre chaîne (ex: Arbitrum Sepolia) peut battre
       * le trade mainnet de la duel dans `bestPnlScoreFromPositions` → mauvais winner affiché.
       */
      const myScope = myChainScopeRef.current
      const oppScope = opponentChainScopeRef.current
      const mine = myScope
        ? rawMine.filter((p) => p.chainId === myScope)
        : rawMine
      const theirs = oppScope
        ? rawTheirs.filter((p) => p.chainId === oppScope)
        : rawTheirs
      const myDropped = rawMine.length - mine.length
      const oppDropped = rawTheirs.length - theirs.length
      if (myDropped > 0 || oppDropped > 0) {
        const sig = `${myDropped}:${oppDropped}:${myScope ?? ""}:${oppScope ?? ""}`
        if (sig !== lastScopeFilterLogRef.current) {
          lastScopeFilterLogRef.current = sig
          console.log(LOG, "snapshot scope filter applied", {
            myScope,
            oppScope,
            myTotal: rawMine.length,
            myKept: mine.length,
            myDropped,
            myDroppedIds: rawMine
              .filter((p) => p.chainId !== myScope)
              .map((p) => p.id),
            oppTotal: rawTheirs.length,
            oppKept: theirs.length,
            oppDropped,
            oppDroppedIds: rawTheirs
              .filter((p) => p.chainId !== oppScope)
              .map((p) => p.id),
          })
        }
      }

      console.log(LOG, "duel snapshot applied", {
        remainingSeconds: snap.remainingSeconds,
        myPositionsRaw: rawMine.length,
        myPositions: mine.length,
        opponentPositionsRaw: rawTheirs.length,
        opponentPositions: theirs.length,
        myScope,
        oppScope,
      })

      const now = Date.now()
      const ended = snap.remainingSeconds <= 0

      setDuelRemainingSeconds(snap.remainingSeconds)
      setDuelTimerEnded(ended)

      const myBest = bestPnlScoreFromPositions(mine)
      if (myBest) lastMyScoreRef.current = myBest
      const oppBest = bestPnlScoreFromPositions(theirs)
      if (oppBest) lastOpponentScoreRef.current = oppBest

      if (!ended && snap.remainingSeconds === 1) {
        duelCloseTargetsAtOneSecondRef.current =
          mine.length > 0 ? [...mine] : null
        scoresAtOneSecondRef.current = {
          my: myBest ?? lastMyScoreRef.current,
          opponent: oppBest ?? lastOpponentScoreRef.current,
        }
      }

      if (ended) {
        const at1 = scoresAtOneSecondRef.current
        scoresAtOneSecondRef.current = null

        const finalMy = at1?.my ?? lastMyScoreRef.current
        const finalOpp = at1?.opponent ?? lastOpponentScoreRef.current
        const myPct = finalMy?.pct ?? null
        const oppPct = finalOpp?.pct ?? null
        const myU = finalMy?.pnlUsdc ?? null
        const oppU = finalOpp?.pnlUsdc ?? null

        const hasAnyScore =
          (myPct != null && Number.isFinite(myPct)) ||
          (oppPct != null && Number.isFinite(oppPct)) ||
          (myU != null && Number.isFinite(myU)) ||
          (oppU != null && Number.isFinite(oppU))

        if (hasAnyScore) {
          let winner: GainsDuelPnlOutcome["winner"] = "unknown"
          if (myPct != null && oppPct != null) {
            winner =
              Math.abs(myPct - oppPct) < 1e-9
                ? "tie"
                : myPct > oppPct
                  ? "you"
                  : "opponent"
          } else if (myPct != null && oppPct == null) {
            winner = "you"
          } else if (myPct == null && oppPct != null) {
            winner = "opponent"
          }

          setDuelPnlOutcome({
            myPnlPct: myPct,
            opponentPnlPct: oppPct,
            myPnlUsdc: myU,
            opponentPnlUsdc: oppU,
            winner,
          })
        }
        /* Sinon (reconnexion / reload sans refs) : ne pas poser un outcome « unknown » qui masque la DB. */

        lastMyScoreRef.current = null
        lastOpponentScoreRef.current = null

        const fromOneSecond = duelCloseTargetsAtOneSecondRef.current
        duelCloseTargetsAtOneSecondRef.current = null
        duelEndCloseTargetsRef.current =
          fromOneSecond && fromOneSecond.length > 0
            ? [...fromOneSecond]
            : mine.length > 0
              ? [...mine]
              : null
        console.log(LOG, "duel end: captured auto-close batch", {
          source: fromOneSecond && fromOneSecond.length > 0 ? "t=1s snapshot" : "t=0 snapshot",
          count: duelEndCloseTargetsRef.current?.length ?? 0,
          ids: duelEndCloseTargetsRef.current?.map((p) => p.id) ?? [],
          chains: duelEndCloseTargetsRef.current?.map((p) => p.chainId) ?? [],
          markets: duelEndCloseTargetsRef.current?.map((p) => p.marketId) ?? [],
          warning:
            "This batch = ALL open positions for this wallet at t=1s. Pre-existing positions unrelated to the duel will also be closed.",
        })
        setMyPositions([])
        setOpponentPositions([])
        setPnlHistoryMy(new Map())
        setPnlHistoryOpponent(new Map())
        setLegacyPnlHistoryByKey(new Map())
        return
      }

      setMyPositions(mine)
      setOpponentPositions(theirs)
      setPnlHistoryMy((prev) =>
        mergePnlHistory(
          prev,
          mine,
          (p) => gainsPositionHistorySideKey("my", p),
          now,
        ),
      )
      setPnlHistoryOpponent((prev) =>
        mergePnlHistory(
          prev,
          theirs,
          (p) => gainsPositionHistorySideKey("opponent", p),
          now,
        ),
      )
      setLegacyPnlHistoryByKey((prev) =>
        mergePnlHistory(prev, mine, gainsPositionStreamKey, now),
      )
    },
    [],
  )

  const applyLegacyPositionsArray = useCallback(
    (batch: GainsPositionUpdate[]) => {
      for (const p of batch) logPositionShapeIfNew(p, "my")
      console.log(LOG, "legacy positions array applied", { count: batch.length })
      const now = Date.now()
      lastMyScoreRef.current = null
      lastOpponentScoreRef.current = null
      scoresAtOneSecondRef.current = null
      setDuelStartSignalAt(null)
      setDuelPnlOutcome(null)
      setMyPositions(batch)
      setOpponentPositions([])
      setDuelRemainingSeconds(null)
      setDuelTimerEnded(false)
      setPnlHistoryMy((prev) =>
        mergePnlHistory(
          prev,
          batch,
          (p) => gainsPositionHistorySideKey("my", p),
          now,
        ),
      )
      setPnlHistoryOpponent(new Map())
      setLegacyPnlHistoryByKey((prev) =>
        mergePnlHistory(prev, batch, gainsPositionStreamKey, now),
      )
    },
    [],
  )

  useEffect(() => {
    console.log(LOG, "session: fetching /api/auth/me (duel layout mounted)")
    let cancelled = false
    void fetch("/api/auth/me", { credentials: "include" })
      .then(
        (r) =>
          r.json() as Promise<{ user?: { walletAddress?: string | null } }>,
      )
      .then((d) => {
        if (cancelled) return
        const w = d.user?.walletAddress?.trim()
        const addr = w && w.startsWith("0x") ? w : null
        console.log(
          LOG,
          "session: /api/auth/me result",
          addr
            ? { wallet: `${addr.slice(0, 10)}…` }
            : { wallet: null, note: "no wallet or not logged in" },
        )
        setWalletAddress(addr)
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn(LOG, "session: /api/auth/me failed", e)
          setWalletAddress(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const url = wsUrlFromEnv()
    if (!url) {
      console.log(
        LOG,
        "socket: skip — set NEXT_PUBLIC_DUEL_DEFI_WS_URL (e.g. ws://host:3001/ws/positions)",
      )
      setConnectionState("idle")
      return
    }
    if (!walletAddress) {
      console.log(
        LOG,
        "socket: skip — no wallet yet (stay idle until /api/auth/me returns 0x…)",
      )
      setConnectionState("idle")
      return
    }

    console.log(LOG, "socket: will connect", {
      url,
      wallet: `${walletAddress.slice(0, 10)}…`,
    })

    intentionalUnmountRef.current = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const openSocket = () => {
      if (intentionalUnmountRef.current) {
        console.log(LOG, "socket: openSocket aborted (unmount in progress)")
        return
      }

      console.log(LOG, "socket: new WebSocket()", url)
      setConnectionState("connecting")
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        reconnectAttemptRef.current = 0
        setConnectionState("open")
        setLastWsError(null)
        console.log(
          LOG,
          "socket: onopen — connected, readyState=",
          ws.readyState,
        )
      }

      ws.onmessage = (ev) => {
        const raw = String(ev.data)
        console.log(
          LOG,
          "socket: onmessage raw",
          raw.slice(0, 500) + (raw.length > 500 ? "…" : ""),
        )
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>

          if (isGainsDuelPositionsSnapshot(parsed)) {
            console.log(LOG, "socket: duel snapshot (root)", {
              remainingSeconds: parsed.remainingSeconds,
              users: parsed.users.length,
            })
            applyDuelSnapshot(parsed, walletAddress)
            return
          }

          const event =
            typeof parsed.event === "string" ? parsed.event : undefined
          const data = parsed.data

          console.log(LOG, "socket: onmessage parsed", {
            event,
            hasData: data !== undefined,
          })

          // Serveur : `event: "duel"` ou `event: "positions"` + même forme `data`.
          if (event === "positions" || event === "duel") {
            if (isGainsDuelPositionsSnapshot(data)) {
              console.log(LOG, "socket: duel snapshot (wrapped)", {
                event,
                remainingSeconds: data.remainingSeconds,
                users: data.users.length,
              })
              applyDuelSnapshot(data, walletAddress)
              return
            }
            if (event === "positions" && Array.isArray(data)) {
              const batch = data as GainsPositionUpdate[]
              applyLegacyPositionsArray(batch)
              return
            }
          }

          if (event === "start") {
            const cur = subscribedDuelIdRef.current
            if (!cur) {
              console.log(
                LOG,
                "socket: start ignored — no active duel subscription",
              )
              return
            }
            const d =
              data && typeof data === "object"
                ? (data as Record<string, unknown>)
                : null
            const id = d && typeof d.duelId === "string" ? d.duelId.trim() : ""
            if (id && id !== cur) {
              console.log(LOG, "socket: start ignored — duelId mismatch", {
                got: id,
                subscribed: cur,
              })
              return
            }
            console.log(LOG, "socket: duel start signal", {
              duelId: cur,
              message:
                d && typeof d.message === "string" ? d.message : undefined,
            })
            setDuelStartSignalAt(Date.now())
            return
          }

          if (event === "error") {
            setLastWsError(
              typeof data === "string" ? data : "WebSocket positions error.",
            )
            return
          }
          if (event === "expired") {
            setLastWsError(
              typeof data === "string" ? data : "Subscription expired.",
            )
            intentionalUnmountRef.current = true
            console.log(LOG, "socket: expired from server, closing")
            ws.close()
          }
        } catch (e) {
          console.warn(LOG, "onmessage JSON parse error", e)
        }
      }

      ws.onerror = (ev) => {
        console.warn(LOG, "socket: onerror", ev)
        setLastWsError("WebSocket error.")
        setConnectionState("error")
      }

      ws.onclose = (ev) => {
        wsRef.current = null
        console.log(LOG, "socket: onclose", {
          code: ev.code,
          reason: ev.reason || "(no reason)",
          wasClean: ev.wasClean,
          intentionalUnmount: intentionalUnmountRef.current,
        })
        if (intentionalUnmountRef.current) {
          setConnectionState("closed")
          return
        }
        setConnectionState("closed")
        const attempt = reconnectAttemptRef.current + 1
        reconnectAttemptRef.current = attempt
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
        console.log(LOG, "socket: scheduling reconnect", {
          attempt,
          delayMs: delay,
        })
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          openSocket()
        }, delay)
      }
    }

    openSocket()

    return () => {
      console.log(
        LOG,
        "socket: cleanup (leave /duel or wallet changed) — unsubscribe + close",
      )
      intentionalUnmountRef.current = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }
      const w = wsRef.current
      if (w) {
        try {
          const duelId = subscribedDuelIdRef.current
          const payload = JSON.stringify(
            duelId
              ? { event: "unsubscribe", data: { duelId } }
              : { event: "unsubscribe", data: {} },
          )
          console.log(LOG, "socket: send on cleanup", payload)
          w.send(payload)
        } catch (e) {
          console.warn(LOG, "socket: unsubscribe send failed on cleanup", e)
        }
        w.close()
        wsRef.current = null
      }
      subscribedDuelIdRef.current = null
      myChainScopeRef.current = null
      opponentChainScopeRef.current = null
      lastScopeFilterLogRef.current = ""
    }
  }, [walletAddress, applyDuelSnapshot, applyLegacyPositionsArray])

  const subscribePositions = useCallback(
    (
      duelId: string,
      chainScope?: { my?: string | null; opponent?: string | null },
    ) => {
      const id = duelId.trim()
      if (!id) {
        console.log(LOG, "subscribe: skipped — empty duelId")
        return
      }
      if (!walletAddress) {
        console.log(LOG, "subscribe: skipped — no wallet")
        return
      }
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(LOG, "subscribe: skipped — socket not OPEN", {
          hasSocket: Boolean(ws),
          readyState: ws?.readyState,
        })
        setLastWsError("WebSocket not connected — try again in a moment.")
        return
      }
      /** Les scopes sont stockés avant l'envoi — le prochain snapshot WS les appliquera. */
      myChainScopeRef.current = chainScope?.my ?? null
      opponentChainScopeRef.current = chainScope?.opponent ?? null
      lastScopeFilterLogRef.current = ""
      const payload = {
        event: "subscribe",
        data: { duelId: id },
      }
      subscribedDuelIdRef.current = id
      console.log(LOG, "subscribe: sending", {
        ...payload,
        chainScope: {
          my: myChainScopeRef.current,
          opponent: opponentChainScopeRef.current,
        },
        ...(myChainScopeRef.current == null
          ? {
              warning:
                "No my-chain scope provided — WS positions will NOT be filtered. PnL outcome may reflect pre-existing positions on other chains.",
            }
          : {}),
      })
      resetPositionState()
      try {
        ws.send(JSON.stringify(payload))
      } catch (e) {
        console.warn(LOG, "subscribe: send failed", e)
        setLastWsError("Failed to send subscribe.")
      }
    },
    [walletAddress, resetPositionState],
  )

  const unsubscribePositions = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log(LOG, "unsubscribe: skipped — socket not OPEN")
      return
    }
    try {
      const duelId = subscribedDuelIdRef.current
      const body = JSON.stringify(
        duelId
          ? { event: "unsubscribe", data: { duelId } }
          : { event: "unsubscribe", data: {} },
      )
      console.log(LOG, "unsubscribe: sending", body)
      ws.send(body)
    } catch (e) {
      console.warn(LOG, "unsubscribe: send failed", e)
    }
    subscribedDuelIdRef.current = null
    myChainScopeRef.current = null
    opponentChainScopeRef.current = null
    lastScopeFilterLogRef.current = ""
    resetPositionState()
  }, [resetPositionState])

  const value = useMemo<GainsRealtimeContextValue>(
    () => ({
      walletAddress,
      connectionState,
      lastWsError,
      positions: myPositions,
      pnlHistoryByKey: legacyPnlHistoryByKey,
      myPositions,
      opponentPositions,
      pnlHistoryMy,
      pnlHistoryOpponent,
      duelRemainingSeconds,
      duelTimerEnded,
      duelPnlOutcome,
      duelStartSignalAt,
      takeDuelEndCloseTargets,
      subscribePositions,
      unsubscribePositions,
    }),
    [
      walletAddress,
      connectionState,
      lastWsError,
      myPositions,
      opponentPositions,
      legacyPnlHistoryByKey,
      pnlHistoryMy,
      pnlHistoryOpponent,
      duelRemainingSeconds,
      duelTimerEnded,
      duelPnlOutcome,
      duelStartSignalAt,
      takeDuelEndCloseTargets,
      subscribePositions,
      unsubscribePositions,
    ],
  )

  return (
    <GainsRealtimeContext.Provider value={value}>
      {children}
    </GainsRealtimeContext.Provider>
  )
}
