import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  type Address,
} from "viem";

import { erc20Abi } from "@/constants/erc20";
import { getFaucetChain, isFaucetChainConfigured } from "@/lib/evm/faucet-chain";
import type { MobulaPortfolioPosition } from "@/types/mobula-portfolio";

/** Libellés pour les chaînes de test courantes (FAUCET_CHAIN_ID). */
const CHAIN_DISPLAY: Record<number, string> = {
  421614: "Arbitrum Sepolia",
  11155111: "Sepolia",
  84532: "Base Sepolia",
  43113: "Avalanche Fuji",
};

function collateralTokenAddress(): Address | null {
  const raw = process.env.GNS_COLLATERAL_TOKEN_ADDRESS?.trim();
  if (!raw?.startsWith("0x")) return null;
  try {
    return getAddress(raw as Address);
  } catch {
    return null;
  }
}

/**
 * Solde ERC-20 du collatéral Gains sur la chaîne `FAUCET_*` (ex. USDC reçu via le faucet `getFreeDai`).
 * Mobula n’indexe pas Arbitrum Sepolia pour le wallet : on lit directement le RPC.
 */
export async function readFaucetChainCollateralBalance(
  wallet: Address,
): Promise<MobulaPortfolioPosition | null> {
  const token = collateralTokenAddress();
  if (!token || !isFaucetChainConfigured()) return null;

  const chain = getFaucetChain();
  const publicClient = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });

  let balance: bigint;
  let decimals: number;
  try {
    [balance, decimals] = await Promise.all([
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet],
      }),
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "decimals",
      }).then((d) => Number(d)),
    ]);
  } catch {
    return null;
  }

  let symbol = "USDC";
  try {
    const s = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "symbol",
    });
    if (typeof s === "string" && s.length > 0 && s.length < 64) symbol = s;
  } catch {
    /* jetons exotiques (bytes32, etc.) : défaut USDC */
  }

  const human = parseFloat(formatUnits(balance, decimals));
  const chainLabel = CHAIN_DISPLAY[chain.id] ?? `Chain ${chain.id}`;

  return {
    id: `onchain-${chain.id}-${token.toLowerCase()}`,
    symbol,
    name: `${symbol} (collatéral testnet)`,
    logo: null,
    chainId: String(chain.id),
    chainLabel,
    tokenAddress: token,
    balance: human,
    balanceRaw: balance.toString(),
    decimals,
    priceUsd: 1,
    estimatedUsd: Number.isFinite(human) ? human : 0,
  };
}
