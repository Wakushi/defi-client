import { getDb } from "./index"
import { findUserById } from "./users"

export async function insertDuel(input: {
  creatorId: string
  stakeUsdc: string
  durationSeconds: number
}) {
  return getDb()
    .insertInto("duels")
    .values({
      creator_id: input.creatorId,
      opponent_id: null,
      stake_usdc: input.stakeUsdc,
      duration_seconds: input.durationSeconds,
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
