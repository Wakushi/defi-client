import { NextRequest, NextResponse } from "next/server"
import { createPublicClient, getAddress, http, parseUnits } from "viem"

import { erc20Abi } from "@/constants/erc20"
import { getSessionFromRequest } from "@/lib/auth/session"
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client"
import { parseDuelTradeConfig, parseReadyState } from "@/lib/db/duel-ready"
import { findDuelById, markParticipantOpenTradeRecorded } from "@/lib/db/duels"
import { findUserById } from "@/lib/db/users"
import {
  gainsUiChainToExecSurface,
  getGainsExecRuntime,
  isGainsExecSurfaceConfigured,
} from "@/lib/gns/gains-exec-context"
import { approveCollateralIfNeeded } from "@/lib/gns/approve-collateral-if-needed"
import { resolveGainsPair } from "@/lib/gains/resolve-pair"
import { makePerpSignerFromDynamic } from "@/lib/mobula/dynamic-perp-signer"
import { PerpInteractionController } from "@/lib/mobula/perp-v2-client"
import { getMobulaApiKey, getMobulaBaseUrl } from "@/lib/mobula/perp-v2-env"
import {
  pickOrderTxHash,
  pickRejectionReason,
} from "@/lib/mobula/perp-v2-response"
import type { CreateOrderV2Params } from "@/lib/mobula/perp-v2-types"

export const runtime = "nodejs"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const USDC_DECIMALS = 6

/** Mobula slippage is in percent (e.g. 1 = 1%) — not Gains 1e3 units. */
const DEFAULT_MAX_SLIPPAGE_P = 3

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
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

  let collateralWei: bigint
  let collateralUsdc: number
  try {
    collateralWei = parseUnits(duel.stake_usdc, USDC_DECIMALS)
    collateralUsdc = Number(duel.stake_usdc)
    if (!Number.isFinite(collateralUsdc) || collateralUsdc <= 0) {
      throw new Error("non-positive USDC stake")
    }
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

  const execSurface = gainsUiChainToExecSurface(sideConfig.gainsChain)
  if (!isGainsExecSurfaceConfigured(execSurface)) {
    const msg =
      execSurface === "arbitrum"
        ? "Arbitrum One non configuré : définis ARBITRUM_RPC_URL (optionnel ARBITRUM_CHAIN_ID=42161, GNS_ARBITRUM_DIAMOND_ADDRESS, GNS_ARBITRUM_COLLATERAL_TOKEN_ADDRESS)."
        : "FAUCET_RPC_URL et FAUCET_CHAIN_ID sont requis pour le testnet."
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  let execRt: ReturnType<typeof getGainsExecRuntime>
  try {
    execRt = getGainsExecRuntime(execSurface)
  } catch (e) {
    const m = e instanceof Error ? e.message : "Invalid chain configuration."
    return NextResponse.json({ error: m }, { status: 500 })
  }

  const publicClient = createPublicClient({
    chain: execRt.chain,
    transport: http(execRt.chain.rpcUrls.default.http[0]),
  })

  let onChainBalance: bigint
  try {
    onChainBalance = await publicClient.readContract({
      address: execRt.collateral,
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

  const pair = await resolveGainsPair(
    sideConfig.pairIndex,
    sideConfig.gainsChain ?? "Arbitrum",
  )
  if (!pair || !pair.from) {
    return NextResponse.json(
      { error: `Could not resolve pair ${sideConfig.pairIndex}.` },
      { status: 502 },
    )
  }

  const maxSlippageP =
    Number(process.env.MOBULA_MAX_SLIPPAGE_P) || DEFAULT_MAX_SLIPPAGE_P

  const orderParams: CreateOrderV2Params = {
    baseToken: pair.from,
    quote: "USD",
    leverage: sideConfig.leverageX,
    long: Boolean(sideConfig.long),
    reduceOnly: false,
    collateralAmount: collateralUsdc,
    orderType: "market",
    maxSlippageP,
    marginMode: 1,
    chainIds: [`evm:${execRt.chain.id}`],
    ...(process.env.GNS_REFERRER_ADDRESS?.startsWith("0x")
      ? { referrer: process.env.GNS_REFERRER_ADDRESS }
      : {}),
  }

  console.log("[duel-exec] createOrder params", {
    duelId,
    wallet: walletAddress,
    ...orderParams,
  })

  const minAllowance = collateralWei + BigInt(1)

  let mobulaApiKey: string
  try {
    mobulaApiKey = getMobulaApiKey()
  } catch (e) {
    const msg = e instanceof Error ? e.message : "MOBULA_API_KEY missing."
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  try {
    const evmClient = await authenticatedEvmClient({
      authToken,
      environmentId,
    })

    const approveTxHash = await approveCollateralIfNeeded({
      evmClient,
      walletAddress,
      minAmount: minAllowance,
      rpcChain: execRt.chain,
      collateralToken: execRt.collateral,
      spender: execRt.diamond,
    })

    const controller = new PerpInteractionController({
      baseUrl: getMobulaBaseUrl(),
      apiKey: mobulaApiKey,
      signer: makePerpSignerFromDynamic(evmClient, walletAddress),
      resolveChain: (chainId) =>
        chainId === execRt.chain.id ? execRt.chain : undefined,
    })

    const result = await controller.createOrder(orderParams)

    if (!result.data.success) {
      const reason = pickRejectionReason(result)
      console.error("[duel-exec] createOrder rejected", {
        duelId,
        reason,
        executionDetails: result.data.executionDetails,
      })
      return NextResponse.json(
        {
          error: reason
            ? `Mobula rejected the order: ${reason}`
            : "Mobula rejected the order.",
          executionDetails: result.data.executionDetails,
          ...(approveTxHash ? { approveTxHash } : {}),
        },
        { status: 502 },
      )
    }

    const txHash = pickOrderTxHash(result)
    if (!txHash) {
      return NextResponse.json(
        {
          error: "Mobula returned success but no tx hash in executionDetails.",
          executionDetails: result.data.executionDetails,
        },
        { status: 502 },
      )
    }

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
      executionDetails: result.data.executionDetails,
    })
  } catch (e) {
    console.error("[duel execute] openTrade via Mobula failed:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "openTrade failed." },
      { status: 502 },
    )
  }
}
