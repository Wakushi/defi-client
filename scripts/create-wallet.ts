import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import { ThresholdSignatureScheme } from "@dynamic-labs-wallet/core";

import { authenticatedEvmClient } from "@/lib/dynamic/evm-client";

const root = process.cwd();
loadEnv({ path: resolve(root, ".env"), quiet: true });
loadEnv({ path: resolve(root, ".env.local"), quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const evmClient = await authenticatedEvmClient({
    authToken: requireEnv("DYNAMIC_AUTH_TOKEN"),
    environmentId: requireEnv("DYNAMIC_ENVIRONMENT_ID"),
  });

  const wallet = await evmClient.createWalletAccount({
    thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
    onError: (error: Error) => {
      console.error("Wallet creation error:", error);
    },
    backUpToClientShareService: true,
  });

  console.log("Wallet created:", wallet.accountAddress);

  const signature = await evmClient.signMessage({
    accountAddress: wallet.accountAddress,
    message: "Hello from Dynamic!",
  });

  console.log("Message signed:", signature);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
