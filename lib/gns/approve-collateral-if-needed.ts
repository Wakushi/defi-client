import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  maxUint256,
  type Address,
} from "viem";

import { erc20Abi } from "@/constants/erc20";
import { CONTRACT_GAINS_ARBITRUM_SEPOLIA } from "@/constants/gnsTrade";
import { dynamicSignAndSendTransaction } from "@/lib/evm/dynamic-sign-send";
import { getFaucetChain } from "@/lib/evm/faucet-chain";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function getGnsCollateralTokenAddress(): Address {
  const raw = process.env.GNS_COLLATERAL_TOKEN_ADDRESS?.trim();
  if (!raw?.startsWith("0x")) {
    throw new Error(
      "Set GNS_COLLATERAL_TOKEN_ADDRESS (e.g. USDC on Arbitrum Sepolia for collateralIndex 3).",
    );
  }
  return getAddress(raw as Address);
}

/** Spender that pulls collateral — defaults to Gains diamond / trading contract. */
export function getGnsDiamondAddress(): Address {
  const raw = process.env.GNS_DIAMOND_ADDRESS?.trim();
  if (raw?.startsWith("0x")) {
    return getAddress(raw as Address);
  }
  return getAddress(CONTRACT_GAINS_ARBITRUM_SEPOLIA);
}

/**
 * If current allowance is below minAmount, approve maxUint256 for the diamond (Dynamic MPC).
 */
export async function approveCollateralIfNeeded(params: {
  evmClient: DynamicEvmWalletClient;
  walletAddress: Address;
  password: string;
  minAmount: bigint;
}): Promise<`0x${string}` | undefined> {
  const token = getGnsCollateralTokenAddress();
  const spender = getGnsDiamondAddress();

  const chain = getFaucetChain();
  const publicClient = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });

  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [params.walletAddress, spender],
  });

  if (allowance >= params.minAmount) {
    return undefined;
  }

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, maxUint256],
  });

  const hash = await dynamicSignAndSendTransaction({
    evmClient: params.evmClient,
    walletAddress: params.walletAddress,
    password: params.password,
    to: token,
    data,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  await sleep(2000);

  return hash;
}
