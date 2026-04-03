import { type NextRequest, NextResponse } from "next/server";
import { getAddress, type Address } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { findUserById } from "@/lib/db/users";
import { readFaucetChainCollateralBalance } from "@/lib/evm/read-faucet-collateral-balance";
import { fetchMobulaWalletPortfolio } from "@/lib/mobula/fetch-wallet-portfolio";
import type { MobulaPortfolioPayload } from "@/types/mobula-portfolio";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Session invalide." }, { status: 401 });
  }

  if (!user.wallet_address) {
    return NextResponse.json(
      { error: "Aucune adresse wallet enregistrée." },
      { status: 400 },
    );
  }

  let wallet: Address;
  try {
    wallet = getAddress(user.wallet_address.trim() as `0x${string}`);
  } catch {
    return NextResponse.json({ error: "Adresse wallet invalide en base." }, { status: 500 });
  }

  async function onchainFallback(reason: "mobula_error" | "mobula_empty") {
    const position = await readFaucetChainCollateralBalance(wallet);
    if (!position) return null;
    const body: MobulaPortfolioPayload = {
      wallet,
      totalWalletBalanceUsd: position.estimatedUsd,
      positions: [position],
      usedOnchainFallback: true,
      mobulaSkippedReason: reason,
    };
    return NextResponse.json(body);
  }

  try {
    const data = await fetchMobulaWalletPortfolio({ wallet });
    if (data.positions.length === 0) {
      const fb = await onchainFallback("mobula_empty");
      if (fb) return fb;
    }
    return NextResponse.json({ ...data, usedOnchainFallback: false });
  } catch (e) {
    const fb = await onchainFallback("mobula_error");
    if (fb) return fb;
    const message = e instanceof Error ? e.message : "Erreur Mobula.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
