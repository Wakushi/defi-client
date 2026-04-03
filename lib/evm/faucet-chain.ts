import { defineChain } from "viem";

export function isFaucetChainConfigured(): boolean {
  const id = Number(process.env.FAUCET_CHAIN_ID);
  return Boolean(
    process.env.FAUCET_RPC_URL && Number.isInteger(id) && id > 0,
  );
}

export function getFaucetChain() {
  const id = Number(process.env.FAUCET_CHAIN_ID);
  const url = process.env.FAUCET_RPC_URL;
  if (!url || !Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid FAUCET_CHAIN_ID or FAUCET_RPC_URL");
  }
  return defineChain({
    id,
    name: "Faucet chain",
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: { default: { http: [url] } },
  });
}
