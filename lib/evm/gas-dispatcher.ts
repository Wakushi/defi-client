import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getFaucetChain, isFaucetChainConfigured } from "@/lib/evm/faucet-chain";

const DEFAULT_AMOUNT_ETH = "0.002";

function normalizePrivateKey(raw: string): `0x${string}` {
  const s = raw.trim();
  return (s.startsWith("0x") ? s : `0x${s}`) as `0x${string}`;
}

export function isGasDispatcherConfigured(): boolean {
  const pk = process.env.PRIVATE_KEY_GAS_DISPATCHER?.trim();
  if (!pk) return false;
  const hex = pk.startsWith("0x") ? pk.slice(2) : pk;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return false;
  return isFaucetChainConfigured();
}

/**
 * Sends native currency (ETH on Arbitrum Sepolia, etc.) from the hot wallet to the user.
 * Waits for inclusion before returning so a follow-up `getFreeDai` can pay gas.
 */
export async function fundUserGasFromDispatcher(
  to: `0x${string}`,
): Promise<`0x${string}`> {
  const rawPk = process.env.PRIVATE_KEY_GAS_DISPATCHER;
  if (!rawPk) {
    throw new Error("PRIVATE_KEY_GAS_DISPATCHER is not set");
  }

  const chain = getFaucetChain();
  const transport = http(chain.rpcUrls.default.http[0]);
  const account = privateKeyToAccount(normalizePrivateKey(rawPk));
  const walletClient = createWalletClient({
    account,
    chain,
    transport,
  });

  const amountEth =
    process.env.GAS_DISPATCH_AMOUNT_ETH?.trim() || DEFAULT_AMOUNT_ETH;
  const value = parseEther(amountEth);

  const hash = await walletClient.sendTransaction({
    to,
    value,
  });

  const publicClient = createPublicClient({ chain, transport });
  await publicClient.waitForTransactionReceipt({ hash });

  return hash;
}
