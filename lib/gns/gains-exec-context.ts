import { defineChain, getAddress, type Address, type Chain } from "viem"

import { CONTRACT_GAINS_ARBITRUM_ONE, CONTRACT_GAINS_BASE } from "@/constants/gnsTrade"
import { getFaucetChain, isFaucetChainConfigured } from "@/lib/evm/faucet-chain"
import {
  getGnsCollateralTokenAddress,
  getGnsDiamondAddress,
} from "@/lib/gns/approve-collateral-if-needed"
import type { GainsApiChain } from "@/types/gains-api"

export type GainsExecSurface = "testnet" | "arbitrum" | "base"

/** USDC natif Arbitrum One (surcharge `GNS_ARBITRUM_COLLATERAL_TOKEN_ADDRESS`). */
const DEFAULT_ARB1_USDC =
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const

/** USDC natif Base (surcharge `GNS_BASE_COLLATERAL_TOKEN_ADDRESS`). */
const DEFAULT_BASE_USDC =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const

export function gainsUiChainToExecSurface(
  c: GainsApiChain | undefined,
): GainsExecSurface {
  if (c === "Arbitrum") return "arbitrum"
  if (c === "Base") return "base"
  return "testnet"
}

export function isGainsExecSurfaceConfigured(surface: GainsExecSurface): boolean {
  if (surface === "testnet") return isFaucetChainConfigured()
  if (surface === "base") {
    const url = process.env.BASE_RPC_URL?.trim()
    if (!url) return false
    const id = Number(process.env.BASE_CHAIN_ID || 8453)
    return Number.isInteger(id) && id > 0
  }
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

export function getBaseChainFromEnv(): Chain {
  const url = process.env.BASE_RPC_URL?.trim()
  const id = Number(process.env.BASE_CHAIN_ID || 8453)
  if (!url || !Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid BASE_RPC_URL or BASE_CHAIN_ID")
  }
  return defineChain({
    id,
    name: "Base",
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

  if (surface === "base") {
    const chain = getBaseChainFromEnv()
    const dRaw = process.env.GNS_BASE_DIAMOND_ADDRESS?.trim()
    const diamond = getAddress(
      (dRaw?.startsWith("0x") ? dRaw : CONTRACT_GAINS_BASE) as Address,
    )
    const cRaw = process.env.GNS_BASE_COLLATERAL_TOKEN_ADDRESS?.trim()
    const collateral = getAddress(
      (cRaw?.startsWith("0x") ? cRaw : DEFAULT_BASE_USDC) as Address,
    )
    const idx = Number(process.env.GNS_BASE_COLLATERAL_INDEX ?? 1)
    return {
      chain,
      diamond,
      collateral,
      collateralIndex: Number.isInteger(idx) && idx >= 0 ? idx : 1,
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
