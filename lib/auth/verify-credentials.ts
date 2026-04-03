import bcrypt from "bcryptjs";

import { findUserByPseudo } from "@/lib/db/users";

export async function verifyUserCredentials(pseudoRaw: string, password: string) {
  const pseudo = pseudoRaw.trim();
  if (!pseudo || !password) return null;

  const user = await findUserByPseudo(pseudo);
  if (!user) return null;

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;

  return user;
}
