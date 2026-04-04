/** Chaînes supportées par l’API Duel DeFi (REST + WebSocket). */
export type GainsApiChain = "Testnet" | "Arbitrum" | "Base"

export type GainsTradingPair = {
  pairIndex: number
  name: string
  from: string
  to: string
  groupIndex: number
  feeIndex: number
  spreadP: number
  price: number
  price24hAgo: number
  percentChange: number
  logo: string
}

/** Snapshot position — champs optionnels selon la version du serveur WebSocket. */
export type GainsPositionUpdate = {
  pairIndex: number
  leverage: number
  /** Ancien schéma */
  long?: boolean
  /** Schéma Duel DeFi WS (alias de `long`) */
  isLong?: boolean
  openPrice: number
  pnl: number
  liquidationPrice?: number
  liqUsdDecimaled?: number
  pair?: string
  tradeType?: number
  percentChange?: number
  index?: number
  currentPriceUsdDecimaled?: number
  collateral?: number
  chain?: GainsApiChain | string
}

/** Point PnL horodaté (historique WebSocket pour graphiques). */
export type GainsPositionPnlTick = { t: number; pnl: number }

export function gainsPositionStreamKey(p: GainsPositionUpdate): string {
  return `${p.pairIndex}-${p.index ?? 0}-${p.tradeType ?? 0}`
}

/** Entrée `users[]` dans le snapshot WebSocket duel (timer + positions par wallet). */
export type GainsDuelWsUserEntry = {
  wallet: string
  positions: GainsPositionUpdate[]
}

/** Payload `positions` côté serveur (duel + timer + positions par joueur). */
export type GainsDuelPositionsSnapshot = {
  duelId?: string
  remainingSeconds: number
  users: GainsDuelWsUserEntry[]
}

export function isGainsDuelPositionsSnapshot(
  data: unknown,
): data is GainsDuelPositionsSnapshot {
  if (!data || typeof data !== "object") return false
  const d = data as Record<string, unknown>
  if (
    typeof d.remainingSeconds !== "number" ||
    !Number.isFinite(d.remainingSeconds)
  )
    return false
  if (!Array.isArray(d.users)) return false
  for (const u of d.users) {
    if (!u || typeof u !== "object") return false
    const row = u as Record<string, unknown>
    if (typeof row.wallet !== "string" || !Array.isArray(row.positions))
      return false
  }
  return true
}

/** Clé PnL par côté (évite collision d’index entre deux wallets). */
export function gainsPositionHistorySideKey(
  side: "my" | "opponent",
  p: GainsPositionUpdate,
): string {
  return `${side}:${gainsPositionStreamKey(p)}`
}

/** PnL % pour comparer les joueurs (priorité `percentChange`, sinon pnl / collatéral). */
export function pnlPercentFromPosition(p: GainsPositionUpdate): number | null {
  if (typeof p.percentChange === "number" && Number.isFinite(p.percentChange)) {
    return p.percentChange
  }
  const c = p.collateral
  if (
    typeof c === "number" &&
    Number.isFinite(c) &&
    c > 0 &&
    typeof p.pnl === "number" &&
    Number.isFinite(p.pnl)
  ) {
    return (p.pnl / c) * 100
  }
  return null
}

/** Meilleur score parmi les positions ouvertes (duel : en général une position — sinon max des %). */
export function bestPnlScoreFromPositions(
  positions: GainsPositionUpdate[],
): { pct: number; pnlUsdc: number } | null {
  let best: { pct: number; pnlUsdc: number } | null = null
  for (const p of positions) {
    const pct = pnlPercentFromPosition(p)
    if (pct == null) continue
    if (!best || pct > best.pct) {
      best = {
        pct,
        pnlUsdc:
          typeof p.pnl === "number" && Number.isFinite(p.pnl) ? p.pnl : 0,
      }
    }
  }
  return best
}
