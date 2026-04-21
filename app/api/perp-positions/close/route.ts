import { type NextRequest, NextResponse } from "next/server"
import { type Chain, getAddress } from "viem"

import { getSessionFromRequest } from "@/lib/auth/session"
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client"
import { findUserById } from "@/lib/db/users"
import { getFaucetChain, isFaucetChainConfigured } from "@/lib/evm/faucet-chain"
import {
  getArbitrumOneChainFromEnv,
  getBaseChainFromEnv,
} from "@/lib/gns/gains-exec-context"
import { makePerpSignerFromDynamic } from "@/lib/mobula/dynamic-perp-signer"
import { PerpInteractionController } from "@/lib/mobula/perp-v2-client"
import { getMobulaApiKey, getMobulaBaseUrl } from "@/lib/mobula/perp-v2-env"
import {
  pickOrderTxHash,
  pickRejectionReason,
} from "@/lib/mobula/perp-v2-response"
import type { ClosePositionV2Params } from "@/lib/mobula/perp-v2-types"

export const runtime = "nodejs"

/** Compteur d'appels concurrents à /api/perp-positions/close — révèle les pics qui saturent Dynamic. */
let inFlight = 0
let seq = 0

function resolveEvmChain(chainIdNum: number): Chain | undefined {
  try {
    const arb = getArbitrumOneChainFromEnv()
    if (arb.id === chainIdNum) return arb
  } catch {}
  try {
    const base = getBaseChainFromEnv()
    if (base.id === chainIdNum) return base
  } catch {}
  if (isFaucetChainConfigured()) {
    const f = getFaucetChain()
    if (f.id === chainIdNum) return f
  }
  return undefined
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }

  const user = await findUserById(session.userId)
  if (!user || user.pseudo !== session.pseudo || !user.wallet_address) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const b =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {}

  const dex = b.dex
  const chainIdRaw = typeof b.chainId === "string" ? b.chainId.trim() : ""
  const marketId = typeof b.marketId === "string" ? b.marketId.trim() : ""
  const positionId =
    typeof b.positionId === "string" && b.positionId.trim()
      ? b.positionId.trim()
      : undefined
  const trigger =
    typeof b.trigger === "string" && b.trigger.trim()
      ? b.trigger.trim()
      : "unknown"

  if (dex !== "gains" && dex !== "lighter") {
    return NextResponse.json(
      { error: "dex must be 'gains' or 'lighter'." },
      { status: 400 },
    )
  }
  if (!chainIdRaw) {
    return NextResponse.json({ error: "chainId is required." }, { status: 400 })
  }
  if (!marketId) {
    return NextResponse.json(
      { error: "marketId is required." },
      { status: 400 },
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

  let walletAddress: `0x${string}`
  try {
    walletAddress = getAddress(user.wallet_address as `0x${string}`)
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet address." },
      { status: 500 },
    )
  }

  let mobulaApiKey: string
  try {
    mobulaApiKey = getMobulaApiKey()
  } catch (e) {
    const msg = e instanceof Error ? e.message : "MOBULA_API_KEY missing."
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const closeParams: ClosePositionV2Params = {
    dex,
    chainId: chainIdRaw,
    marketId,
    ...(positionId ? { positionId } : {}),
  }

  const reqId = ++seq
  inFlight += 1
  const startedAt = Date.now()
  console.log("[perp-positions/close] request", {
    reqId,
    trigger,
    inFlight,
    wallet: walletAddress,
    ...closeParams,
  })

  try {
    const evmClient = await authenticatedEvmClient({
      authToken,
      environmentId,
    })

    const controller = new PerpInteractionController({
      baseUrl: getMobulaBaseUrl(),
      apiKey: mobulaApiKey,
      signer: makePerpSignerFromDynamic(evmClient, walletAddress),
      resolveChain: dex === "gains" ? resolveEvmChain : undefined,
    })

    const result = await controller.closePosition(closeParams)

    if (!result.data.success) {
      const reason = pickRejectionReason(result)
      console.error("[perp-positions/close] rejected by Mobula", {
        reqId,
        trigger,
        reason,
        executionDetails: result.data.executionDetails,
      })
      return NextResponse.json(
        {
          error: reason
            ? `Mobula rejected the close: ${reason}`
            : "Mobula rejected the close.",
          executionDetails: result.data.executionDetails,
        },
        { status: 502 },
      )
    }

    const txHash = pickOrderTxHash(result)
    if (!txHash) {
      console.error("[perp-positions/close] success without txHash", {
        reqId,
        trigger,
        executionDetails: result.data.executionDetails,
      })
      return NextResponse.json(
        {
          error: "Mobula returned success but no tx hash.",
          executionDetails: result.data.executionDetails,
        },
        { status: 502 },
      )
    }

    console.log("[perp-positions/close] ok", {
      reqId,
      trigger,
      txHash,
      marketId,
      positionId,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({
      txHash,
      executionDetails: result.data.executionDetails,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    /** Dynamic 429 : signMessage rate-limited (trop de signatures en parallèle). */
    const rateLimited =
      /rate limited/i.test(msg) ||
      /429/.test(msg) ||
      /too many requests/i.test(msg)
    if (rateLimited) {
      console.error("[perp-positions/close] DYNAMIC_RATE_LIMITED", {
        reqId,
        trigger,
        ...closeParams,
        durationMs: Date.now() - startedAt,
        hint: "Dynamic signMessage returned 429. Too many concurrent sign calls — stagger or queue close operations.",
      })
    } else {
      console.error("[perp-positions/close] failed", {
        reqId,
        trigger,
        ...closeParams,
        durationMs: Date.now() - startedAt,
        error: msg,
      })
    }
    return NextResponse.json(
      { error: msg || "close-position failed.", rateLimited },
      { status: 502 },
    )
  } finally {
    inFlight -= 1
    console.log("[perp-positions/close] done", { reqId, inFlight })
  }
}
