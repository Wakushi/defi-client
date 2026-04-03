import { ThresholdSignatureScheme } from "@dynamic-labs-wallet/core";
import bcrypt from "bcryptjs";

import {
  deleteUserById,
  findUserByPseudo,
  saveUser,
  updateUserWalletAddress,
} from "@/lib/db/users";
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client";

const PSEUDO_RE = /^[a-zA-Z0-9_-]{2,32}$/;

export type RegisterResult =
  | { ok: true; id: string; pseudo: string; walletAddress: string }
  | {
      ok: false;
      code: "PSEUDO_TAKEN" | "VALIDATION" | "WALLET_FAILED" | "INTERNAL";
      message: string;
    };

function isPgUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: string }).code === "23505"
  );
}

export async function registerUserWithWallet(
  pseudoRaw: string,
  password: string,
): Promise<RegisterResult> {
  const pseudo = pseudoRaw.trim();

  if (!PSEUDO_RE.test(pseudo)) {
    return {
      ok: false,
      code: "VALIDATION",
      message:
        "Username must be 2–32 characters: letters, digits, _ or - only.",
    };
  }

  if (password.length < 8) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "Password must be at least 8 characters.",
    };
  }

  const existing = await findUserByPseudo(pseudo);
  if (existing) {
    return {
      ok: false,
      code: "PSEUDO_TAKEN",
      message: "That username is already taken.",
    };
  }

  const password_hash = await bcrypt.hash(password, 12);

  let userId: string;
  try {
    const row = await saveUser({ pseudo, password_hash });
    userId = row.id;
  } catch (e) {
    if (isPgUniqueViolation(e)) {
      return {
        ok: false,
        code: "PSEUDO_TAKEN",
        message: "That username is already taken.",
      };
    }
    throw e;
  }

  const authToken = process.env.DYNAMIC_AUTH_TOKEN;
  const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
  if (!authToken || !environmentId) {
    await deleteUserById(userId);
    return {
      ok: false,
      code: "INTERNAL",
      message: "Server configuration is incomplete.",
    };
  }

  try {
    const client = await authenticatedEvmClient({
      authToken,
      environmentId,
    });
    const wallet = await client.createWalletAccount({
      thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
      password,
      onError: (err: Error) => {
        console.error("[Dynamic] createWalletAccount:", err);
      },
      backUpToClientShareService: true,
    });

    await updateUserWalletAddress(userId, wallet.accountAddress);

    return {
      ok: true,
      id: userId,
      pseudo,
      walletAddress: wallet.accountAddress,
    };
  } catch (e) {
    console.error(e);
    await deleteUserById(userId);
    return {
      ok: false,
      code: "WALLET_FAILED",
      message:
        "Could not create the wallet right now. Please try again later.",
    };
  }
}
