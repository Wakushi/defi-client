import type { DuelPlayMode } from "@/types/play-mode"
import type { GainsApiChain } from "@/types/gains-api"

const CHAINS = new Set<GainsApiChain>(["Testnet", "Arbitrum", "Base"])

/**
 * Valeur en base quand le mode duel n’a pas encore de chaîne choisie (trade ready).
 * Permet de garder `creator_chain` / `opponent_chain` NOT NULL tant que la migration nullable n’est pas passée.
 */
export const DUEL_CHAIN_DB_UNSET = "unset" as const

export function normalizeDuelPlayMode(raw: unknown): DuelPlayMode {
  return raw === "duel" ? "duel" : "friendly"
}

export function parseStoredGainsChain(raw: unknown): GainsApiChain {
  if (raw === "Testnet" || raw === "Arbitrum" || raw === "Base") return raw
  return "Testnet"
}

/** Valeur DB absente, sentinelle `unset`, ou invalide — ex. mode duel avant trade ready. */
export function parseStoredGainsChainOptional(
  raw: unknown,
): GainsApiChain | null {
  if (raw === DUEL_CHAIN_DB_UNSET || raw === "" || raw == null) return null
  if (raw === "Testnet" || raw === "Arbitrum" || raw === "Base") return raw
  return null
}

/** Chaînes à l’insert : friendly = testnet ; duel = sentinelle `unset` (puis trade ready). */
export function initialDuelChainsForInsert(mode: DuelPlayMode): {
  creatorChain: string
  opponentChain: string
} {
  if (mode === "duel") {
    return {
      creatorChain: DUEL_CHAIN_DB_UNSET,
      opponentChain: DUEL_CHAIN_DB_UNSET,
    }
  }
  return { creatorChain: "Testnet", opponentChain: "Testnet" }
}

export function assertValidGainsChain(s: string): s is GainsApiChain {
  return CHAINS.has(s as GainsApiChain)
}
