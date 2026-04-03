import { getDb } from "./index";
import { findUserById } from "./users";

export async function insertDuel(input: {
  creatorId: string;
  stakeUsdc: string;
  durationSeconds: number;
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
    .executeTakeFirstOrThrow();
}

export async function findDuelById(id: string) {
  return getDb()
    .selectFrom("duels")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function findDuelWithPseudos(id: string) {
  const duel = await findDuelById(id);
  if (!duel) return null;
  const creator = await findUserById(duel.creator_id);
  const opponent = duel.opponent_id
    ? await findUserById(duel.opponent_id)
    : null;
  return {
    ...duel,
    creator_pseudo: creator?.pseudo ?? "?",
    opponent_pseudo: opponent?.pseudo ?? null,
  };
}
