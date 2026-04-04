import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import type { Address, SignTypedDataParameters } from "viem";

export async function dynamicSignTypedData(params: {
  evmClient: DynamicEvmWalletClient;
  walletAddress: Address;
  typedData: SignTypedDataParameters;
}): Promise<`0x${string}`> {
  return params.evmClient.signTypedData({
    accountAddress: params.walletAddress,
    typedData: params.typedData,
  });
}
