import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm"
import type { Address, TransactionSerializable } from "viem"

/** Signing surface used by the Mobula Perp V2 controller. EIP-191 for messages, EIP-1559 for txs. */
export interface PerpSigner {
  address: Address
  signMessage(message: string): Promise<string>
  signTransaction(tx: TransactionSerializable): Promise<`0x${string}`>
}

export function makePerpSignerFromDynamic(
  evmClient: DynamicEvmWalletClient,
  walletAddress: Address,
): PerpSigner {
  return {
    address: walletAddress,
    async signMessage(message) {
      const sig = await evmClient.signMessage({
        message,
        accountAddress: walletAddress,
      })
      return sig as string
    },
    async signTransaction(tx) {
      const serialized = await evmClient.signTransaction({
        senderAddress: walletAddress,
        transaction: tx,
      })
      return serialized as `0x${string}`
    },
  }
}
