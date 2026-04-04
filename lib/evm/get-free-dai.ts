import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  type TransactionSerializable,
} from "viem";

import { getFaucetChain } from "@/lib/evm/faucet-chain";

/** Same ABI as your thirdweb `getContract` snippet — faucet USDC / test token. */
export const getFreeDaiAbi = [
  {
    inputs: [],
    name: "getFreeDai",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export function isGetFreeDaiConfigured(): boolean {
  return Boolean(
    process.env.USDC_FAUCET_CONTRACT_ADDRESS?.startsWith("0x") &&
      process.env.FAUCET_RPC_URL &&
      process.env.FAUCET_CHAIN_ID,
  );
}

/**
 * Signs with Dynamic MPC and broadcasts via RPC.
 * Fund the user with {@link fundUserGasFromDispatcher} first if they start with 0 balance.
 */
export async function sendGetFreeDaiTransaction(params: {
  evmClient: DynamicEvmWalletClient;
  walletAddress: `0x${string}`;
}): Promise<`0x${string}`> {
  const contract = process.env.USDC_FAUCET_CONTRACT_ADDRESS as `0x${string}`;
  const chain = getFaucetChain();
  const publicClient = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });

  const data = encodeFunctionData({
    abi: getFreeDaiAbi,
    functionName: "getFreeDai",
    args: [],
  });

  const nonce = await publicClient.getTransactionCount({
    address: params.walletAddress,
  });

  const gas = await publicClient.estimateGas({
    account: params.walletAddress,
    to: contract,
    data,
  });

  let tx: TransactionSerializable;

  try {
    const fees = await publicClient.estimateFeesPerGas();
    tx = {
      type: "eip1559",
      chainId: chain.id,
      nonce,
      to: contract,
      data,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  } catch {
    const gasPrice = await publicClient.getGasPrice();
    tx = {
      type: "legacy",
      chainId: chain.id,
      nonce,
      to: contract,
      data,
      gas,
      gasPrice,
    };
  }

  const serializedSigned = await params.evmClient.signTransaction({
    senderAddress: params.walletAddress,
    transaction: tx,
  });

  return publicClient.sendRawTransaction({
    serializedTransaction: serializedSigned,
  });
}
