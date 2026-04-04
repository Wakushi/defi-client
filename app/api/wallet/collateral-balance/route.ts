import { type NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import {
  readCollateralBalance,
  readCollateralBalanceForGainsChain,
} from "@/lib/evm/collateral-balance";
import type { GainsApiChain } from "@/types/gains-api";
import { findUserById } from "@/lib/db/users";

export const runtime = "nodejs";

function parseGainsChainParam(raw: string | null): GainsApiChain | null {
  if (raw === "Testnet" || raw === "Arbitrum" || raw === "Base") return raw;
  return null;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  if (!user.wallet_address) {
    return NextResponse.json({
      configured: false,
      error: "No wallet linked to this account.",
    });
  }

  let wallet: `0x${string}`;
  try {
    wallet = getAddress(user.wallet_address.trim() as `0x${string}`);
  } catch {
    return NextResponse.json({ error: "Invalid wallet address." }, { status: 500 });
  }

  const gainsChain = parseGainsChainParam(
    request.nextUrl.searchParams.get("gainsChain"),
  );
  const bal = gainsChain
    ? await readCollateralBalanceForGainsChain(wallet, gainsChain)
    : await readCollateralBalance(wallet);
  if (!bal) {
    return NextResponse.json({
      configured: false,
      error: "Could not read balance (FAUCET_RPC_URL, GNS_COLLATERAL_TOKEN_ADDRESS, etc.).",
    });
  }

  return NextResponse.json({
    configured: true,
    balanceRaw: bal.balanceRaw.toString(),
    decimals: bal.decimals,
    formatted: bal.formatted,
  });
}
