const UNISWAP_TRADE_BASE = "https://trade-api.gateway.uniswap.org/v1";

/** Routages exécutables via POST /swap (pas UniswapX / ordres hors chaîne). */
export const UNISWAP_ROUTING_USES_POST_SWAP = new Set([
  "CLASSIC",
  "WRAP",
  "UNWRAP",
  "BRIDGE",
  "CHAINED",
]);

export const UNISWAP_NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export function getUniswapTradeApiKey(): string {
  const k = process.env.UNISWAP_TRADE_API_KEY?.trim();
  if (!k) {
    throw new Error("UNISWAP_TRADE_API_KEY is not set.");
  }
  return k;
}

export type UniswapApiTx = {
  to: string;
  from: string;
  data: string;
  value: string;
  chainId: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
};

export type UniswapPermitData = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  values: Record<string, unknown>;
};

export type UniswapQuoteResponse = {
  requestId: string;
  routing: string;
  quote: unknown;
  permitData: UniswapPermitData | null;
  permitTransaction?: UniswapApiTx | null;
};

export type UniswapApprovalResponse = {
  requestId?: string;
  cancel?: UniswapApiTx | null;
  approval?: UniswapApiTx | null;
};

export type UniswapSwapResponse = {
  swap: UniswapApiTx;
};

function parseUniswapError(json: unknown): string {
  if (typeof json !== "object" || json === null) return "Unknown Uniswap error.";
  const o = json as { message?: unknown; error?: unknown };
  if (typeof o.message === "string" && o.message.length > 0) return o.message;
  if (typeof o.error === "string" && o.error.length > 0) return o.error;
  return "Unknown Uniswap error.";
}

export async function uniswapPostJson<T>(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${UNISWAP_TRADE_BASE}${path}`, {
    method: "POST",
    headers: {
      "x-api-key": getUniswapTradeApiKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => (null))) as unknown;
  console.log(`[uniswap-api] ${path} status=${res.status}`, JSON.stringify(json, null, 2)?.slice(0, 2000));
  if (!res.ok) {
    throw new Error(`Uniswap ${path} ${res.status}: ${parseUniswapError(json)}`);
  }
  return json as T;
}

export function isValidUniswapTx(tx: UniswapApiTx | null | undefined): boolean {
  if (!tx?.data) return false;
  const d = tx.data.trim().toLowerCase();
  return d.length > 2 && d !== "0x";
}
