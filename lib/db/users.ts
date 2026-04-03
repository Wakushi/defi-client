import { getAddress } from "viem";

import { getDb } from "./index";

export async function findUserById(id: string) {
  return getDb()
    .selectFrom("users")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

/** Full user row when the username (`pseudo` column) exists. */
export async function findUserByPseudo(pseudo: string) {
  return getDb()
    .selectFrom("users")
    .selectAll()
    .where("pseudo", "=", pseudo)
    .executeTakeFirst();
}

/**
 * Resolve a user from their EVM address (`wallet_address` set at signup).
 * Input is normalized with viem `getAddress` so mixed-case input still matches DB.
 */
export async function findUserByWalletAddress(walletAddress: string) {
  let normalized: string;
  try {
    normalized = getAddress(walletAddress.trim() as `0x${string}`);
  } catch {
    return undefined;
  }
  return getDb()
    .selectFrom("users")
    .selectAll()
    .where("wallet_address", "=", normalized)
    .executeTakeFirst();
}

/** Insert a user without a wallet; DB defaults apply for id and timestamps. */
export async function saveUser(input: {
  pseudo: string;
  password_hash: string;
}) {
  return getDb()
    .insertInto("users")
    .values({
      pseudo: input.pseudo,
      password_hash: input.password_hash,
      wallet_address: null,
      encrypted_private_key: null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
}

export async function updateUserWalletAddress(
  userId: string,
  walletAddress: string,
) {
  await getDb()
    .updateTable("users")
    .set({
      wallet_address: walletAddress,
      updated_at: new Date(),
    })
    .where("id", "=", userId)
    .execute();
}

export async function deleteUserById(userId: string) {
  await getDb().deleteFrom("users").where("id", "=", userId).execute();
}
