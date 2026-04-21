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

/**
 * Snapshot position renvoyé par le WS duel (format Mobula Perp V2).
 * Champs optionnels absents quand la position n’a pas de tick « live » (ex: premier message Lighter).
 */
export type GainsPositionUpdate = {
  id: string
  marketId: string
  exchange: "gains" | "lighter" | string
  chainId: string
  side: "BUY" | "SELL" | string
  currentLeverage: number
  entryPriceQuote: number
  currentPriceQuote?: number
  liquidationPriceQuote?: number
  collateral?: number
  amountUSD?: number
  amountRaw?: string
  unrealizedPnlUSD?: number
  unrealizedPnlPercent?: number
  realizedPnlUSD?: number
  realizedPnlPercent?: number
  address?: string
  openDate?: string
  lastUpdate?: string
  tp?: unknown[]
  sl?: unknown[]
  feesOpeningUSD?: number
  feesClosingUSD?: number
  feesFundingUSD?: number
  collateralAsset?: string
}

/** Point PnL horodaté (historique WebSocket pour graphiques). */
export type GainsPositionPnlTick = { t: number; pnl: number }

/** Identifiant unique Mobula : `id` est globalement unique par position. */
export function gainsPositionStreamKey(p: GainsPositionUpdate): string {
  return p.id
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

/** Clé PnL par côté (évite collision d’id entre deux wallets). */
export function gainsPositionHistorySideKey(
  side: "my" | "opponent",
  p: GainsPositionUpdate,
): string {
  return `${side}:${gainsPositionStreamKey(p)}`
}

/** PnL USD (unrealized) ou 0 si absent. */
export function positionPnlUsd(p: GainsPositionUpdate): number {
  return typeof p.unrealizedPnlUSD === "number" &&
    Number.isFinite(p.unrealizedPnlUSD)
    ? p.unrealizedPnlUSD
    : 0
}

/** PnL % pour comparer les joueurs (priorité `unrealizedPnlPercent`, sinon pnl / collatéral). */
export function pnlPercentFromPosition(p: GainsPositionUpdate): number | null {
  if (
    typeof p.unrealizedPnlPercent === "number" &&
    Number.isFinite(p.unrealizedPnlPercent)
  ) {
    return p.unrealizedPnlPercent
  }
  const c = p.collateral
  const pnl = p.unrealizedPnlUSD
  if (
    typeof c === "number" &&
    Number.isFinite(c) &&
    c > 0 &&
    typeof pnl === "number" &&
    Number.isFinite(pnl)
  ) {
    return (pnl / c) * 100
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
      best = { pct, pnlUsdc: positionPnlUsd(p) }
    }
  }
  return best
}

/** `"gains-bnb-usd-usdc"` → `"BNB/USD"` ; `"lighter-dash-usd"` → `"DASH/USD"` ; fallback : ID en majuscules. */
export function prettyPairFromMarketId(marketId: string): string {
  const parts = marketId.split("-").filter(Boolean)
  if (parts.length >= 3) {
    return `${parts[1].toUpperCase()}/${parts[2].toUpperCase()}`
  }
  if (parts.length === 2) {
    return parts[1].toUpperCase()
  }
  return marketId.toUpperCase()
}

/** `"evm:42161"` → `42161` ; renvoie `null` si non numérique. */
export function numericChainId(chainId: string): number | null {
  const raw = chainId.includes(":") ? chainId.split(":")[1] : chainId
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Libellé chaîne lisible à partir du `chainId` Mobula (`evm:42161` etc.). */
export function prettyChainFromChainId(chainId: string): string {
  const id = numericChainId(chainId)
  if (id === 42161) return "Arbitrum"
  if (id === 421614) return "Arbitrum Sepolia"
  if (id === 8453) return "Base"
  if (id === 84532) return "Base Sepolia"
  return chainId
}

/**
 * `GainsApiChain` → chainId Mobula (`evm:<id>`).
 * Sert à filtrer les positions WS pour ne garder que celles de la chaîne de la duel
 * (pré-existantes sur une autre chaîne ≠ positions de la duel).
 */
export function chainIdFromGainsApiChain(chain: GainsApiChain): string {
  if (chain === "Arbitrum") return "evm:42161"
  if (chain === "Base") return "evm:8453"
  return "evm:421614"
}

/** Mobula id : `pos-<market>-<wallet>-<suffix>` — extrait `<suffix>` (positionId V2). */
export function extractPositionIdFromMobulaId(
  id: string,
  walletAddress: string | undefined | null,
): string {
  if (!walletAddress) return id
  const addrLower = walletAddress.toLowerCase()
  const idx = id.toLowerCase().lastIndexOf(addrLower)
  if (idx < 0) return id
  return id.slice(idx + addrLower.length).replace(/^-/, "") || id
}
