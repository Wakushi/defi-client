import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createPublicClient, getAddress, http, parseUnits } from "viem";

import { erc20Abi } from "@/constants/erc20";
import { getSessionFromRequest } from "@/lib/auth/session";
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client";
import { parseDuelTradeConfig, parseReadyState } from "@/lib/db/duel-ready";
import { findDuelById } from "@/lib/db/duels";
import { findUserById } from "@/lib/db/users";
import { getFaucetChain, isFaucetChainConfigured } from "@/lib/evm/faucet-chain";
import {
  approveCollateralIfNeeded,
  getGnsCollateralTokenAddress,
} from "@/lib/gns/approve-collateral-if-needed";
import { buildGnsTradeFromDuelConfig } from "@/lib/gns/build-duel-trade";
import { serializeTradeForJson } from "@/lib/gns/serialize-trade-for-json";
import { sendGnsOpenTrade } from "@/lib/gns/send-open-trade";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const USDC_DECIMALS = 6;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isFaucetChainConfigured()) {
    return NextResponse.json(
      { error: "FAUCET_RPC_URL et FAUCET_CHAIN_ID requis." },
      { status: 500 },
    );
  }

  const { id: duelId } = await context.params;
  if (!UUID_RE.test(duelId)) {
    return NextResponse.json({ error: "Identifiant de duel invalide." }, { status: 400 });
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

  const password =
    typeof body === "object" &&
    body !== null &&
    "password" in body &&
    typeof (body as { password: unknown }).password === "string"
      ? (body as { password: string }).password
      : "";

  if (!password) {
    return NextResponse.json({ error: "Mot de passe requis pour signer." }, { status: 400 });
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Session invalide." }, { status: 401 });
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }

  const duel = await findDuelById(duelId);
  if (!duel) {
    return NextResponse.json({ error: "Duel introuvable." }, { status: 404 });
  }

  const rs = parseReadyState(duel.ready_state);
  if (rs[0] !== 1 || rs[1] !== 1) {
    return NextResponse.json(
      { error: "Les deux joueurs doivent être marqués prêts." },
      { status: 400 },
    );
  }

  const isCreator = user.id === duel.creator_id;
  const isOpponent = user.id === duel.opponent_id;
  if (!isCreator && !isOpponent) {
    return NextResponse.json({ error: "Tu ne participes pas à ce duel." }, { status: 403 });
  }

  const rawConfig = isCreator ? duel.creator_trade_config : duel.opponent_trade_config;
  const sideConfig = parseDuelTradeConfig(rawConfig);
  if (!sideConfig) {
    return NextResponse.json(
      { error: "Config de trade introuvable : repasse par « Prêt »." },
      { status: 400 },
    );
  }

  if (!user.wallet_address) {
    return NextResponse.json({ error: "Aucun wallet sur le compte." }, { status: 400 });
  }

  let walletAddress: `0x${string}`;
  try {
    walletAddress = getAddress(user.wallet_address as `0x${string}`);
  } catch {
    return NextResponse.json({ error: "Adresse wallet invalide." }, { status: 500 });
  }

  let expectedCollateral: `0x${string}`;
  try {
    expectedCollateral = getGnsCollateralTokenAddress();
  } catch {
    return NextResponse.json(
      { error: "GNS_COLLATERAL_TOKEN_ADDRESS manquant." },
      { status: 500 },
    );
  }

  let collateralWei: bigint;
  try {
    collateralWei = parseUnits(duel.stake_usdc, USDC_DECIMALS);
  } catch {
    return NextResponse.json({ error: "Mise USDC du duel invalide." }, { status: 500 });
  }

  const authToken = process.env.DYNAMIC_AUTH_TOKEN;
  const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
  if (!authToken || !environmentId) {
    return NextResponse.json({ error: "Dynamic server env missing." }, { status: 500 });
  }

  const chain = getFaucetChain();
  const publicClient = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });

  let onChainBalance: bigint;
  try {
    onChainBalance = await publicClient.readContract({
      address: expectedCollateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    });
  } catch (e) {
    console.error("[duel execute] balanceOf failed:", e);
    return NextResponse.json(
      { error: "Impossible de lire le solde collatéral." },
      { status: 502 },
    );
  }

  if (onChainBalance < collateralWei) {
    return NextResponse.json({ error: "Solde insuffisant pour la mise du duel." }, { status: 400 });
  }

  let trade: ReturnType<typeof buildGnsTradeFromDuelConfig>;
  try {
    trade = buildGnsTradeFromDuelConfig(walletAddress, collateralWei, sideConfig);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Trade invalide.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const minAllowance = trade.collateralAmount + BigInt(1);

  try {
    const evmClient = await authenticatedEvmClient({
      authToken,
      environmentId,
    });

    const approveTxHash = await approveCollateralIfNeeded({
      evmClient,
      walletAddress,
      password,
      minAmount: minAllowance,
    });

    const txHash = await sendGnsOpenTrade({
      evmClient,
      walletAddress,
      password,
      trade,
    });

    return NextResponse.json({
      txHash,
      ...(approveTxHash ? { approveTxHash } : {}),
      trade: serializeTradeForJson(trade),
    });
  } catch (e) {
    console.error("[duel execute] openTrade failed:", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "openTrade a échoué.",
      },
      { status: 502 },
    );
  }
}
