import { NextResponse } from "next/server";

import { attachSessionCookie } from "@/lib/auth/session";
import { verifyUserCredentials } from "@/lib/auth/verify-credentials";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const pseudo =
    typeof body === "object" &&
    body !== null &&
    "pseudo" in body &&
    typeof (body as { pseudo: unknown }).pseudo === "string"
      ? (body as { pseudo: string }).pseudo
      : "";
  const password =
    typeof body === "object" &&
    body !== null &&
    "password" in body &&
    typeof (body as { password: unknown }).password === "string"
      ? (body as { password: string }).password
      : "";

  if (!pseudo || !password) {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  const user = await verifyUserCredentials(pseudo, password);
  if (!user) {
    return NextResponse.json(
      { error: "Invalid username or password." },
      { status: 401 },
    );
  }

  const res = NextResponse.json({
    user: {
      id: user.id,
      username: user.pseudo,
      walletAddress: user.wallet_address,
    },
  });
  await attachSessionCookie(res, user.id, user.pseudo);
  return res;
}
