import {
  createPublicClient,
  formatUnits,
  http,
  type Address,
} from "viem";

import { erc20Abi } from "@/constants/erc20";
import { readFaucetChainCollateralBalance } from "@/lib/evm/read-faucet-collateral-balance";
import {
  gainsUiChainToExecSurface,
  getGainsExecRuntime,
} from "@/lib/gns/gains-exec-context";
import type { GainsApiChain } from "@/types/gains-api";

/** Solde USDC / collatéral sur la chaîne faucet (même jeton que le trade testnet). */
export async function readCollateralBalance(wallet: Address) {
  const pos = await readFaucetChainCollateralBalance(wallet);
  if (!pos) return null;
  const decimals = pos.decimals ?? 6;
  let balanceRaw: bigint;
  try {
    balanceRaw = BigInt(pos.balanceRaw);
  } catch {
    return null;
  }
  return {
    balanceRaw,
    decimals,
    formatted: formatUnits(balanceRaw, decimals),
  };
}

/**
 * Solde du jeton collatéral Gains sur la chaîne correspondant au libellé UI
 * (`Testnet` = FAUCET / Sepolia, `Arbitrum` = Arbitrum One si configuré).
 */
export async function readCollateralBalanceForGainsChain(
  wallet: Address,
  gainsChain: GainsApiChain | undefined,
) {
  const surface = gainsUiChainToExecSurface(gainsChain)
  if (surface === "testnet") {
    return readCollateralBalance(wallet)
  }
  try {
    const rt = getGainsExecRuntime(surface)
    const publicClient = createPublicClient({
      chain: rt.chain,
      transport: http(rt.chain.rpcUrls.default.http[0]),
    })
    const decimals = 6
    const raw = await publicClient.readContract({
      address: rt.collateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    })
    return {
      balanceRaw: raw,
      decimals,
      formatted: formatUnits(raw, decimals),
    }
  } catch {
    return null
  }
}
