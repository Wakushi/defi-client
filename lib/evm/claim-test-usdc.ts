import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";

import {
  fundUserGasFromDispatcher,
  isGasDispatcherConfigured,
} from "@/lib/evm/gas-dispatcher";
import {
  isGetFreeDaiConfigured,
  sendGetFreeDaiTransaction,
} from "@/lib/evm/get-free-dai";

/**
 * Envoie du gas (si configuré) puis appelle getFreeDai() pour le wallet — même logique qu’à l’inscription.
 * @throws si le faucet n’est pas configuré ou si gas / tx échoue
 */
export async function claimTestUsdcForWallet(params: {
  evmClient: DynamicEvmWalletClient;
  walletAddress: `0x${string}`;
}): Promise<{
  gasFundTxHash?: `0x${string}`;
  faucetTxHash: `0x${string}`;
}> {
  if (!isGetFreeDaiConfigured()) {
    throw new Error(
      "Faucet non configuré : USDC_FAUCET_CONTRACT_ADDRESS, FAUCET_RPC_URL, FAUCET_CHAIN_ID.",
    );
  }

  let gasFundTxHash: `0x${string}` | undefined;
  if (isGasDispatcherConfigured()) {
    gasFundTxHash = await fundUserGasFromDispatcher(params.walletAddress);
  }

  const faucetTxHash = await sendGetFreeDaiTransaction({
    evmClient: params.evmClient,
    walletAddress: params.walletAddress,
  });

  return { gasFundTxHash, faucetTxHash };
}
