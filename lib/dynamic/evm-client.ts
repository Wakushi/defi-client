import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";

export async function authenticatedEvmClient({
  authToken,
  environmentId,
}: {
  authToken: string;
  environmentId: string;
}) {
  const client = new DynamicEvmWalletClient({
    environmentId,
    // true only on AWS Nitro Enclave–compatible infrastructure (e.g. prod AWS).
    enableMPCAccelerator: false,
  });
  await client.authenticateApiToken(authToken);
  return client;
}
