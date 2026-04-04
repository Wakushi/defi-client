import { type NextRequest, NextResponse } from "next/server";
import { getAddress, type Address } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { findUserById } from "@/lib/db/users";
import { getFaucetChain, isFaucetChainConfigured } from "@/lib/evm/faucet-chain";
import { readFaucetChainCollateralBalance } from "@/lib/evm/read-faucet-collateral-balance";
import { fetchMobulaWalletPortfolio } from "@/lib/mobula/fetch-wallet-portfolio";
import type { MobulaPortfolioPayload } from "@/types/mobula-portfolio";

export const runtime = "nodejs";

/** Mode hub : `friendly` = uniquement collatéral testnet (pas Mobula multi-chain). */
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
    return NextResponse.json(
      { error: "No wallet address on file." },
      { status: 400 },
    );
  }

  let wallet: Address;
  try {
    wallet = getAddress(user.wallet_address.trim() as `0x${string}`);
  } catch {
    return NextResponse.json({ error: "Invalid wallet address in database." }, { status: 500 });
  }

  let gainsCollateralTokenAddress: string | undefined;
  const collateralEnv = process.env.GNS_COLLATERAL_TOKEN_ADDRESS?.trim();
  if (collateralEnv?.startsWith("0x")) {
    try {
      gainsCollateralTokenAddress = getAddress(collateralEnv as `0x${string}`);
    } catch {
      gainsCollateralTokenAddress = undefined;
    }
  }

  const hubPlayMode = request.nextUrl.searchParams.get("playMode");
  const friendlyHub = hubPlayMode !== "duel";

  const faucetMeta: Pick<
    MobulaPortfolioPayload,
    "faucetChainId" | "gainsCollateralTokenAddress"
  > = {
    ...(isFaucetChainConfigured() ? { faucetChainId: getFaucetChain().id } : {}),
    ...(gainsCollateralTokenAddress
      ? { gainsCollateralTokenAddress }
      : {}),
  };

  if (friendlyHub) {
    const position = await readFaucetChainCollateralBalance(wallet);
    if (!position) {
      return NextResponse.json(
        {
          error:
            "Mode friendly : impossible de lire le collatéral sur la chaîne testnet (FAUCET_* / GNS_COLLATERAL).",
        },
        { status: 502 },
      );
    }
    const body: MobulaPortfolioPayload = {
      wallet,
      totalWalletBalanceUsd: position.estimatedUsd,
      positions: [position],
      usedOnchainFallback: true,
      mobulaSkippedReason: "friendly_hub_testnet_only",
      hubPlayMode: "friendly",
      ...faucetMeta,
    };
    return NextResponse.json(body);
  }

  try {
    /** Pas de repli testnet : le mode duel n’utilise que le mainnet (Mobula filtré). */
    const data = await fetchMobulaWalletPortfolio({ wallet, mainnetOnly: true });
    return NextResponse.json({
      ...data,
      usedOnchainFallback: false,
      hubPlayMode: "duel",
      ...faucetMeta,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Mobula error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
