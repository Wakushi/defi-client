import { NextRequest, NextResponse } from "next/server";
import { formatUnits, getAddress, type Address } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { findUserById } from "@/lib/db/users";
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client";
import { getUniswapMainnetChain, isUniswapMainnetRpcConfigured } from "@/lib/evm/mainnet-uniswap-chain";
import { demoEthAmountWei, demoUsdcAmountRaw } from "@/lib/uniswap/demo-amounts";
import { executeUniswapClassicSwapFlow } from "@/lib/uniswap/execute-classic-swap";
import { getMainnetUsdcAddress } from "@/lib/uniswap/mainnet-tokens";
import {
  getUniswapTradeApiKey,
  UNISWAP_NATIVE_TOKEN,
} from "@/lib/uniswap/trade-gateway";

export const runtime = "nodejs";

const MAINNET_CHAIN_ID = 1;

function configReady(): boolean {
  try {
    getUniswapTradeApiKey();
  } catch {
    return false;
  }
  return isUniswapMainnetRpcConfigured();
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }

  const ethWei = demoEthAmountWei();
  const usdcRaw = demoUsdcAmountRaw();
  let ethLabel: string;
  let usdcLabel: string;
  try {
    ethLabel = `${formatUnits(BigInt(ethWei), 18)} ETH`;
    usdcLabel = `${formatUnits(BigInt(usdcRaw), 6)} USDC`;
  } catch {
    ethLabel = "ETH (voir UNISWAP_MAINNET_DEMO_ETH_WEI)";
    usdcLabel = "USDC (voir UNISWAP_MAINNET_DEMO_USDC_RAW)";
  }

  return NextResponse.json({
    ready: configReady(),
    chainId: MAINNET_CHAIN_ID,
    warnings: [
      !configReady()
        ? "Configurer UNISWAP_TRADE_API_KEY et MAINNET_RPC_URL sur le serveur."
        : null,
      "Swaps réels sur Ethereum mainnet : frais en ETH. Wallet Dynamic = même adresse sur toutes les chaînes.",
    ].filter(Boolean),
    demos: {
      eth_to_usdc: {
        label: `${ethLabel} → USDC`,
        amountWei: ethWei,
      },
      usdc_to_eth: {
        label: `${usdcLabel} → ETH`,
        amountRaw: usdcRaw,
      },
    },
  });
}

export async function POST(request: NextRequest) {
  if (!configReady()) {
    return NextResponse.json(
      {
        error:
          "Uniswap mainnet demo indisponible : définir UNISWAP_TRADE_API_KEY et MAINNET_RPC_URL.",
      },
      { status: 503 },
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const b =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const direction = b.direction === "usdc_to_eth" ? "usdc_to_eth" : "eth_to_usdc";

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Session invalide." }, { status: 401 });
  }

  if (!user.wallet_address) {
    return NextResponse.json({ error: "Aucun wallet sur ce compte." }, { status: 400 });
  }

  let walletAddress: Address;
  try {
    walletAddress = getAddress(user.wallet_address as Address);
  } catch {
    return NextResponse.json({ error: "Adresse wallet invalide." }, { status: 500 });
  }

  const authToken = process.env.DYNAMIC_AUTH_TOKEN;
  const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
  if (!authToken || !environmentId) {
    return NextResponse.json({ error: "Configuration Dynamic serveur manquante." }, { status: 500 });
  }

  let chain;
  try {
    chain = getUniswapMainnetChain();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "MAINNET_RPC_URL manquant.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  let usdc: Address;
  try {
    usdc = getMainnetUsdcAddress();
  } catch {
    return NextResponse.json({ error: "Adresse USDC mainnet invalide." }, { status: 500 });
  }

  const ethWei = demoEthAmountWei();
  const usdcRaw = demoUsdcAmountRaw();

  const tokenIn =
    direction === "eth_to_usdc" ? UNISWAP_NATIVE_TOKEN : usdc;
  const tokenOut =
    direction === "eth_to_usdc" ? usdc : UNISWAP_NATIVE_TOKEN;
  const amountStr = direction === "eth_to_usdc" ? ethWei : usdcRaw;

  try {
    const evmClient = await authenticatedEvmClient({ authToken, environmentId });
    const result = await executeUniswapClassicSwapFlow({
      chain,
      chainId: MAINNET_CHAIN_ID,
      tokenIn,
      tokenOut,
      amountStr,
      walletAddress,
      evmClient,
      slippageTolerance: 0.5,
    });

    return NextResponse.json({
      direction,
      ...result,
    });
  } catch (e) {
    console.error("[uniswap-mainnet-demo]", e);
    const msg = e instanceof Error ? e.message : "Swap échoué.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
