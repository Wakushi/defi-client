import { NextRequest, NextResponse } from "next/server"
import { createPublicClient, getAddress, http, parseUnits } from "viem"

import { erc20Abi } from "@/constants/erc20"
import { getSessionFromRequest } from "@/lib/auth/session"
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client"
import { parseDuelTradeConfig, parseReadyState } from "@/lib/db/duel-ready"
import { findDuelById, markParticipantOpenTradeRecorded } from "@/lib/db/duels"
import { findUserById } from "@/lib/db/users"
import { getFaucetChain, isFaucetChainConfigured } from "@/lib/evm/faucet-chain"
import {
  approveCollateralIfNeeded,
  getGnsCollateralTokenAddress,
} from "@/lib/gns/approve-collateral-if-needed"
import { buildGnsTradeFromDuelConfig } from "@/lib/gns/build-duel-trade"
import { serializeTradeForJson } from "@/lib/gns/serialize-trade-for-json"
import { sendGnsOpenTrade } from "@/lib/gns/send-open-trade"

export const runtime = "nodejs"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const USDC_DECIMALS = 6

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isFaucetChainConfigured()) {
    return NextResponse.json(
      { error: "FAUCET_RPC_URL and FAUCET_CHAIN_ID are required." },
      { status: 500 },
    )
  }

  const { id: duelId } = await context.params
  if (!UUID_RE.test(duelId)) {
    return NextResponse.json({ error: "Invalid duel id." }, { status: 400 })
  }

  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }

  const user = await findUserById(session.userId)
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 })
  }

  const duel = await findDuelById(duelId)
  if (!duel) {
    return NextResponse.json({ error: "Duel not found." }, { status: 404 })
  }

  const rs = parseReadyState(duel.ready_state)
  if (rs[0] !== 1 || rs[1] !== 1) {
    return NextResponse.json(
      { error: "Both players must be marked ready." },
      { status: 400 },
    )
  }

  const isCreator = user.id === duel.creator_id
  const isOpponent = user.id === duel.opponent_id
  if (!isCreator && !isOpponent) {
    return NextResponse.json(
      { error: "You are not in this duel." },
      { status: 403 },
    )
  }

  const alreadyOpenedAt = isCreator
    ? duel.creator_trade_opened_at
    : duel.opponent_trade_opened_at
  const storedOpenTx = isCreator
    ? duel.creator_open_trade_tx_hash
    : duel.opponent_open_trade_tx_hash
  if (alreadyOpenedAt != null) {
    return NextResponse.json({
      already: true as const,
      ...(storedOpenTx ? { txHash: storedOpenTx } : {}),
    })
  }

  const rawConfig = isCreator
    ? duel.creator_trade_config
    : duel.opponent_trade_config
  const sideConfig = parseDuelTradeConfig(rawConfig)
  if (!sideConfig) {
    return NextResponse.json(
      { error: "Trade config missing — go through Ready again." },
      { status: 400 },
    )
  }

  if (!user.wallet_address) {
    return NextResponse.json(
      { error: "No wallet on this account." },
      { status: 400 },
    )
  }

  let walletAddress: `0x${string}`
  try {
    walletAddress = getAddress(user.wallet_address as `0x${string}`)
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet address." },
      { status: 500 },
    )
  }

  let expectedCollateral: `0x${string}`
  try {
    expectedCollateral = getGnsCollateralTokenAddress()
  } catch {
    return NextResponse.json(
      { error: "GNS_COLLATERAL_TOKEN_ADDRESS is missing." },
      { status: 500 },
    )
  }

  let collateralWei: bigint
  try {
    collateralWei = parseUnits(duel.stake_usdc, USDC_DECIMALS)
  } catch {
    return NextResponse.json(
      { error: "Invalid duel USDC stake." },
      { status: 500 },
    )
  }

  const authToken = process.env.DYNAMIC_AUTH_TOKEN
  const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID
  if (!authToken || !environmentId) {
    return NextResponse.json(
      { error: "Dynamic server env missing." },
      { status: 500 },
    )
  }

  const chain = getFaucetChain()
  const publicClient = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  })

  let onChainBalance: bigint
  try {
    onChainBalance = await publicClient.readContract({
      address: expectedCollateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    })
  } catch (e) {
    console.error("[duel execute] balanceOf failed:", e)
    return NextResponse.json(
      { error: "Could not read collateral balance." },
      { status: 502 },
    )
  }

  if (onChainBalance < collateralWei) {
    return NextResponse.json(
      { error: "Insufficient balance for duel stake." },
      { status: 400 },
    )
  }

  let trade: ReturnType<typeof buildGnsTradeFromDuelConfig>
  try {
    trade = buildGnsTradeFromDuelConfig(
      walletAddress,
      collateralWei,
      sideConfig,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid trade."
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const minAllowance = trade.collateralAmount + BigInt(1)

  try {
    const evmClient = await authenticatedEvmClient({
      authToken,
      environmentId,
    })

    const approveTxHash = await approveCollateralIfNeeded({
      evmClient,
      walletAddress,
      minAmount: minAllowance,
    })

    const txHash = await sendGnsOpenTrade({
      evmClient,
      walletAddress,
      trade,
    })

    try {
      await markParticipantOpenTradeRecorded(duelId, isCreator, txHash)
    } catch (e) {
      console.error("[duel execute] failed to record open trade:", e)
      return NextResponse.json(
        {
          error:
            "Trade was sent but the duel record could not be updated. Save this tx hash.",
          txHash,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      txHash,
      ...(approveTxHash ? { approveTxHash } : {}),
      trade: serializeTradeForJson(trade),
    })
  } catch (e) {
    console.error("[duel execute] openTrade failed:", e)
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "openTrade failed.",
      },
      { status: 502 },
    )
  }
}
