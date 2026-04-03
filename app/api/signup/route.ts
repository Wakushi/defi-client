import { NextResponse } from "next/server";

import { registerUserWithWallet } from "@/lib/register-user";

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

  try {
    const result = await registerUserWithWallet(pseudo, password);
    if (!result.ok) {
      const status =
        result.code === "PSEUDO_TAKEN"
          ? 409
          : result.code === "VALIDATION"
            ? 400
            : result.code === "INTERNAL"
              ? 500
              : 502;
      return NextResponse.json({ error: result.message }, { status });
    }

    return NextResponse.json({
      id: result.id,
      username: result.pseudo,
      walletAddress: result.walletAddress,
      ...(result.gasFundTxHash
        ? { gasFundTxHash: result.gasFundTxHash }
        : {}),
      ...(result.faucetTxHash
        ? { faucetTxHash: result.faucetTxHash }
        : {}),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Server error. Please try again later." },
      { status: 500 },
    );
  }
}
