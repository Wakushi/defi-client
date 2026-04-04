/** @dynamic-labs-wallet/* 0.0.x ships broken .d.ts (missing ./src/index). Minimal shims for compilation. */

declare module "@dynamic-labs-wallet/core" {
  export enum ThresholdSignatureScheme {
    TWO_OF_TWO = "TWO_OF_TWO",
    TWO_OF_THREE = "TWO_OF_THREE",
    THREE_OF_FIVE = "THREE_OF_FIVE",
  }
}

declare module "@dynamic-labs-wallet/node-evm" {
  export class DynamicEvmWalletClient {
    constructor(options: {
      environmentId: string;
      enableMPCAccelerator?: boolean;
    });
    authenticateApiToken(authToken: string): Promise<void>;
    createWalletAccount(options: {
      thresholdSignatureScheme: import("@dynamic-labs-wallet/core").ThresholdSignatureScheme;
      onError?: (error: Error) => void;
      backUpToClientShareService?: boolean;
    }): Promise<{ accountAddress: string }>;
    signMessage(options: {
      accountAddress: string;
      message: string;
    }): Promise<string>;
    signTransaction(options: {
      senderAddress: string;
      transaction: import("viem").TransactionSerializable;
    }): Promise<`0x${string}`>;
    signTypedData(options: {
      accountAddress: string;
      typedData: import("viem").SignTypedDataParameters;
    }): Promise<`0x${string}`>;
  }
}
