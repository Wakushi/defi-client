import type { DuelPlayMode } from "@/types/play-mode"

import { getDb } from "./index"
import { findUserById } from "./users"

export type DuelWinnerSide = "creator" | "opponent" | "tie"

export type DuelCloseOutcomePatch = {
  creatorPnlUsdc?: number | null
  opponentPnlUsdc?: number | null
  creatorPnlPct?: number | null
  opponentPnlPct?: number | null
}

function mergeUsdcPatch(
  incoming: unknown,
  existing: string | null | undefined,
): number | null {
  if (typeof incoming === "number" && Number.isFinite(incoming)) return incoming
  if (existing != null && String(existing).trim() !== "") {
    const n = Number(existing)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function mergePctPatch(
  incoming: unknown,
  existing: number | null | undefined,
): number | null {
  if (typeof incoming === "number" && Number.isFinite(incoming)) return incoming
  if (typeof existing === "number" && Number.isFinite(existing)) return existing
  return null
}

export function computeDuelWinnerSide(
  cPct: number | null,
  oPct: number | null,
  cUsdc: number | null,
  oUsdc: number | null,
): DuelWinnerSide | null {
  if (cPct != null && oPct != null) {
    if (Math.abs(cPct - oPct) < 1e-9) return "tie"
    return cPct > oPct ? "creator" : "opponent"
  }
  if (cUsdc != null && oUsdc != null) {
    if (Math.abs(cUsdc - oUsdc) < 1e-9) return "tie"
    return cUsdc > oUsdc ? "creator" : "opponent"
  }
  return null
}

export async function insertDuel(input: {
  creatorId: string
  stakeUsdc: string
  durationSeconds: number
  playMode: DuelPlayMode
  creatorChain: string
  opponentChain: string
}) {
  return getDb()
    .insertInto("duels")
    .values({
      creator_id: input.creatorId,
      opponent_id: null,
      stake_usdc: input.stakeUsdc,
      duration_seconds: input.durationSeconds,
      play_mode: input.playMode,
      creator_chain: input.creatorChain,
      opponent_chain: input.opponentChain,
    })
    .returning("id")
    .executeTakeFirstOrThrow()
}

export async function findDuelById(id: string) {
  return getDb()
    .selectFrom("duels")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst()
}

export async function findDuelWithPseudos(id: string) {
  const duel = await findDuelById(id)
  if (!duel) return null
  const creator = await findUserById(duel.creator_id)
  const opponent = duel.opponent_id
    ? await findUserById(duel.opponent_id)
    : null
  return {
    ...duel,
    creator_pseudo: creator?.pseudo ?? "?",
    opponent_pseudo: opponent?.pseudo ?? null,
  }
}

/** Duels non terminés (`duel_closed_at` null) où l’utilisateur est créateur ou adversaire. */
export async function listOpenDuelsForUser(userId: string) {
  const duels = await getDb()
    .selectFrom("duels")
    .selectAll()
    .where("duel_closed_at", "is", null)
    .where((eb) =>
      eb.or([eb("creator_id", "=", userId), eb("opponent_id", "=", userId)]),
    )
    .orderBy("updated_at", "desc")
    .execute()

  if (duels.length === 0) return []

  const userIds = new Set<string>()
  for (const d of duels) {
    userIds.add(d.creator_id)
    if (d.opponent_id) userIds.add(d.opponent_id)
  }

  const rows = await getDb()
    .selectFrom("users")
    .select(["id", "pseudo"])
    .where("id", "in", [...userIds])
    .execute()

  const pseudoById = new Map(rows.map((r) => [r.id, r.pseudo]))

  return duels.map((d) => ({
    ...d,
    creator_pseudo: pseudoById.get(d.creator_id) ?? "?",
    opponent_pseudo: d.opponent_id ? (pseudoById.get(d.opponent_id) ?? null) : null,
  }))
}

/** Duels terminés (`duel_closed_at` renseigné), les plus récents en premier. */
export async function listFinishedDuelsForUser(userId: string) {
  const duels = await getDb()
    .selectFrom("duels")
    .selectAll()
    .where("duel_closed_at", "is not", null)
    .where((eb) =>
      eb.or([eb("creator_id", "=", userId), eb("opponent_id", "=", userId)]),
    )
    .orderBy("duel_closed_at", "desc")
    .execute()

  if (duels.length === 0) return []

  const userIds = new Set<string>()
  for (const d of duels) {
    userIds.add(d.creator_id)
    if (d.opponent_id) userIds.add(d.opponent_id)
  }

  const rows = await getDb()
    .selectFrom("users")
    .select(["id", "pseudo"])
    .where("id", "in", [...userIds])
    .execute()

  const pseudoById = new Map(rows.map((r) => [r.id, r.pseudo]))

  return duels.map((d) => ({
    ...d,
    creator_pseudo: pseudoById.get(d.creator_id) ?? "?",
    opponent_pseudo: d.opponent_id ? (pseudoById.get(d.opponent_id) ?? null) : null,
  }))
}

/** Définit l’adversaire si la place est encore libre (une seule ligne mise à jour). */
export async function setDuelOpponent(duelId: string, opponentUserId: string) {
  const result = await getDb()
    .updateTable("duels")
    .set({
      opponent_id: opponentUserId,
      updated_at: new Date(),
    })
    .where("id", "=", duelId)
    .where("opponent_id", "is", null)
    .executeTakeFirst()

  const n = result.numUpdatedRows
  const count = typeof n === "bigint" ? Number(n) : Number(n)
  return count > 0
}

/** Idempotent : une seule valeur si plusieurs appels (ex. deux clients). */
export async function markDuelLiveIfUnset(duelId: string) {
  await getDb()
    .updateTable("duels")
    .set({ duel_live_at: new Date(), updated_at: new Date() })
    .where("id", "=", duelId)
    .where("duel_live_at", "is", null)
    .execute()
}

export async function markDuelClosedIfUnset(duelId: string) {
  await getDb()
    .updateTable("duels")
    .set({ duel_closed_at: new Date(), updated_at: new Date() })
    .where("id", "=", duelId)
    .where("duel_closed_at", "is", null)
    .execute()
}

/**
 * Ferme le duel si besoin et fusionne les PnL (plusieurs POST idempotents depuis les deux clients).
 */
export async function finalizeDuelClose(
  duelId: string,
  patch: DuelCloseOutcomePatch,
) {
  const duel = await findDuelById(duelId)
  if (!duel) return { ok: false as const, error: "not_found" as const }

  const closedAt = duel.duel_closed_at ?? new Date()

  const cU = mergeUsdcPatch(patch.creatorPnlUsdc, duel.creator_pnl_usdc)
  const oU = mergeUsdcPatch(patch.opponentPnlUsdc, duel.opponent_pnl_usdc)
  const cP = mergePctPatch(patch.creatorPnlPct, duel.creator_pnl_pct)
  const oP = mergePctPatch(patch.opponentPnlPct, duel.opponent_pnl_pct)

  const winner = computeDuelWinnerSide(cP, oP, cU, oU)

  await getDb()
    .updateTable("duels")
    .set({
      duel_closed_at: closedAt,
      updated_at: new Date(),
      creator_pnl_usdc: cU != null ? cU.toFixed(6) : null,
      opponent_pnl_usdc: oU != null ? oU.toFixed(6) : null,
      creator_pnl_pct: cP,
      opponent_pnl_pct: oP,
      duel_winner_side: winner,
    })
    .where("id", "=", duelId)
    .execute()

  return { ok: true as const }
}

/** Après open on-chain réussi — une entrée par joueur. */
export async function markParticipantOpenTradeRecorded(
  duelId: string,
  isCreator: boolean,
  txHash: string,
) {
  if (isCreator) {
    await getDb()
      .updateTable("duels")
      .set({
        creator_trade_opened_at: new Date(),
        creator_open_trade_tx_hash: txHash,
        updated_at: new Date(),
      })
      .where("id", "=", duelId)
      .execute()
    return
  }
  await getDb()
    .updateTable("duels")
    .set({
      opponent_trade_opened_at: new Date(),
      opponent_open_trade_tx_hash: txHash,
      updated_at: new Date(),
    })
    .where("id", "=", duelId)
    .execute()
}
