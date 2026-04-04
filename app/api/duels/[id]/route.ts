import { type NextRequest, NextResponse } from "next/server"

import { getSessionFromRequest } from "@/lib/auth/session"
import { parseDuelTradeConfig, parseReadyState } from "@/lib/db/duel-ready"
import { findDuelWithPseudos } from "@/lib/db/duels"
import { findUserById } from "@/lib/db/users"
import {
  normalizeDuelPlayMode,
  parseStoredGainsChainOptional,
} from "@/lib/duel/play-mode"
import type { GainsApiChain } from "@/types/gains-api"

export const runtime = "nodejs"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid duel id." }, { status: 400 })
  }

  const duel = await findDuelWithPseudos(id)
  if (!duel) {
    return NextResponse.json({ error: "Duel not found." }, { status: 404 })
  }

  let viewer: { isCreator: boolean; isOpponent: boolean } | null = null
  let viewerAccountPseudo: string | null = null
  const session = await getSessionFromRequest(request)
  if (session) {
    const user = await findUserById(session.userId)
    if (user && user.pseudo === session.pseudo) {
      viewerAccountPseudo = user.pseudo
      viewer = {
        isCreator: user.id === duel.creator_id,
        isOpponent: duel.opponent_id !== null && user.id === duel.opponent_id,
      }
    }
  }

  const readyState = parseReadyState(duel.ready_state)
  let myTradeConfig = null
  let myReady = false
  if (viewer?.isCreator) {
    myTradeConfig = parseDuelTradeConfig(duel.creator_trade_config)
    myReady = readyState[0] === 1
  } else if (viewer?.isOpponent) {
    myTradeConfig = parseDuelTradeConfig(duel.opponent_trade_config)
    myReady = readyState[1] === 1
  }

  const readyBothAt =
    duel.ready_both_at instanceof Date
      ? duel.ready_both_at.toISOString()
      : duel.ready_both_at
        ? new Date(duel.ready_both_at as string).toISOString()
        : null

  const duelLiveAt =
    duel.duel_live_at instanceof Date
      ? duel.duel_live_at.toISOString()
      : duel.duel_live_at
        ? new Date(duel.duel_live_at as string).toISOString()
        : null

  const duelClosedAt =
    duel.duel_closed_at instanceof Date
      ? duel.duel_closed_at.toISOString()
      : duel.duel_closed_at
        ? new Date(duel.duel_closed_at as string).toISOString()
        : null

  let myTradeOpened = false
  let myOpenTradeTxHash: string | null = null
  if (viewer?.isCreator) {
    myTradeOpened = duel.creator_trade_opened_at != null
    myOpenTradeTxHash = duel.creator_open_trade_tx_hash ?? null
  } else if (viewer?.isOpponent) {
    myTradeOpened = duel.opponent_trade_opened_at != null
    myOpenTradeTxHash = duel.opponent_open_trade_tx_hash ?? null
  }

  const playMode = normalizeDuelPlayMode(duel.play_mode)
  const creatorChain = parseStoredGainsChainOptional(duel.creator_chain)
  const opponentChain = parseStoredGainsChainOptional(duel.opponent_chain)
  let myExecGainsChain: GainsApiChain | null = null
  if (viewer?.isCreator) {
    myExecGainsChain =
      creatorChain ?? myTradeConfig?.gainsChain ?? null
  } else if (viewer?.isOpponent) {
    myExecGainsChain =
      opponentChain ?? myTradeConfig?.gainsChain ?? null
  }

  return NextResponse.json({
    id: duel.id,
    creatorPseudo: duel.creator_pseudo,
    opponentPseudo: duel.opponent_pseudo,
    stakeUsdc: duel.stake_usdc,
    durationSeconds: duel.duration_seconds,
    createdAt: duel.created_at.toISOString(),
    duelFull: duel.opponent_id !== null,
    viewer,
    viewerAccountPseudo,
    readyState,
    readyBothAt,
    bothReady: readyState[0] === 1 && readyState[1] === 1,
    myReady,
    myTradeConfig,
    duelLiveAt,
    duelClosedAt,
    myTradeOpened,
    myOpenTradeTxHash,
    playMode,
    creatorChain,
    opponentChain,
    myExecGainsChain,
  })
}
