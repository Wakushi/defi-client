import { defineChain, getAddress, type Address, type Chain } from "viem"

import { CONTRACT_GAINS_ARBITRUM_ONE } from "@/constants/gnsTrade"
import { getFaucetChain, isFaucetChainConfigured } from "@/lib/evm/faucet-chain"
import {
  getGnsCollateralTokenAddress,
  getGnsDiamondAddress,
} from "@/lib/gns/approve-collateral-if-needed"
import type { GainsApiChain } from "@/types/gains-api"

export type GainsExecSurface = "testnet" | "arbitrum"

/** USDC natif Arbitrum One (surcharge `GNS_ARBITRUM_COLLATERAL_TOKEN_ADDRESS`). */
const DEFAULT_ARB1_USDC =
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const

/** « Base » n’a pas encore de bundle RPC dédié : même exécution que le testnet / faucet. */
export function gainsUiChainToExecSurface(
  c: GainsApiChain | undefined,
): GainsExecSurface {
  if (c === "Arbitrum") return "arbitrum"
  return "testnet"
}

export function isGainsExecSurfaceConfigured(surface: GainsExecSurface): boolean {
  if (surface === "testnet") return isFaucetChainConfigured()
  const url = process.env.ARBITRUM_RPC_URL?.trim()
  if (!url) return false
  const id = Number(process.env.ARBITRUM_CHAIN_ID || 42161)
  return Number.isInteger(id) && id > 0
}

export function getArbitrumOneChainFromEnv(): Chain {
  const url = process.env.ARBITRUM_RPC_URL?.trim()
  const id = Number(process.env.ARBITRUM_CHAIN_ID || 42161)
  if (!url || !Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid ARBITRUM_RPC_URL or ARBITRUM_CHAIN_ID")
  }
  return defineChain({
    id,
    name: "Arbitrum One",
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: { default: { http: [url] } },
  })
}

export type GainsExecRuntime = {
  chain: Chain
  diamond: Address
  collateral: Address
  collateralIndex: number
}

export function getGainsExecRuntime(surface: GainsExecSurface): GainsExecRuntime {
  if (surface === "testnet") {
    const chain = getFaucetChain()
    const idx = Number(process.env.GNS_COLLATERAL_INDEX ?? 3)
    return {
      chain,
      diamond: getGnsDiamondAddress(),
      collateral: getGnsCollateralTokenAddress(),
      collateralIndex: Number.isInteger(idx) && idx >= 0 ? idx : 3,
    }
  }

  const chain = getArbitrumOneChainFromEnv()
  const dRaw = process.env.GNS_ARBITRUM_DIAMOND_ADDRESS?.trim()
  const diamond = getAddress(
    (dRaw?.startsWith("0x") ? dRaw : CONTRACT_GAINS_ARBITRUM_ONE) as Address,
  )
  const cRaw = process.env.GNS_ARBITRUM_COLLATERAL_TOKEN_ADDRESS?.trim()
  const collateral = getAddress(
    (cRaw?.startsWith("0x") ? cRaw : DEFAULT_ARB1_USDC) as Address,
  )
  const idx = Number(process.env.GNS_ARBITRUM_COLLATERAL_INDEX ?? 3)
  return {
    chain,
    diamond,
    collateral,
    collateralIndex: Number.isInteger(idx) && idx >= 0 ? idx : 3,
  }
}
