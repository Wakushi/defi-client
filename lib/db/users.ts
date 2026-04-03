import { getDb } from "./index";

/** Full user row when the username (`pseudo` column) exists. */
export async function findUserByPseudo(pseudo: string) {
  return getDb()
    .selectFrom("users")
    .selectAll()
    .where("pseudo", "=", pseudo)
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
