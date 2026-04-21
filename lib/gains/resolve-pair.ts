import { getDuelDefiApiBaseUrl } from "@/lib/duel-defi/api-base"
import { normalizeTradingPair } from "@/lib/gains/normalize-trading-pair"
import type { GainsApiChain, GainsTradingPair } from "@/types/gains-api"

/** Fetch Gains pairs for a chain and resolve one by pairIndex. Returns null when upstream fails. */
export async function resolveGainsPair(
  pairIndex: number,
  chain: GainsApiChain,
): Promise<GainsTradingPair | null> {
  const url = `${getDuelDefiApiBaseUrl()}/gains/pairs?chain=${encodeURIComponent(chain)}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return null
  }
  if (!Array.isArray(data)) return null
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue
    const n = normalizeTradingPair(raw as Record<string, unknown>)
    if (n && n.pairIndex === pairIndex) return n
  }
  return null
}
