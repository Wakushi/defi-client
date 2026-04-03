import { type NextRequest, NextResponse } from "next/server";
import { formatUnits, parseUnits } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { insertDuel } from "@/lib/db/duels";
import { findUserById } from "@/lib/db/users";

export const runtime = "nodejs";

const MIN_DURATION_SEC = 60;
const MAX_DURATION_SEC = 7 * 24 * 60 * 60;
/** USDC = 6 décimales ; le joueur ne les configure pas. */
const USDC_DECIMALS = 6;

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Session invalide." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const stakeRaw =
    typeof b.stakeUsdc === "string" ? b.stakeUsdc.trim().replace(",", ".") : "";

  const durationSecondsRaw = b.durationSeconds;
  const durationSeconds =
    typeof durationSecondsRaw === "number" && Number.isInteger(durationSecondsRaw)
      ? durationSecondsRaw
      : typeof durationSecondsRaw === "string"
        ? Number.parseInt(durationSecondsRaw, 10)
        : NaN;

  if (!stakeRaw) {
    return NextResponse.json({ error: "stakeUsdc est requis (montant en USDC)." }, { status: 400 });
  }

  let units: bigint;
  try {
    units = parseUnits(stakeRaw, USDC_DECIMALS);
  } catch {
    return NextResponse.json({ error: "Montant USDC invalide." }, { status: 400 });
  }

  if (units <= BigInt(0)) {
    return NextResponse.json({ error: "La mise doit être strictement positive." }, { status: 400 });
  }

  const stakeUsdc = formatUnits(units, USDC_DECIMALS);

  if (Number.isNaN(durationSeconds)) {
    return NextResponse.json({ error: "durationSeconds est requis (entier)." }, { status: 400 });
  }

  if (durationSeconds < MIN_DURATION_SEC || durationSeconds > MAX_DURATION_SEC) {
    return NextResponse.json(
      {
        error: `Durée entre ${MIN_DURATION_SEC} s et ${MAX_DURATION_SEC} s.`,
      },
      { status: 400 },
    );
  }

  const { id } = await insertDuel({
    creatorId: user.id,
    stakeUsdc,
    durationSeconds,
  });

  return NextResponse.json({
    id,
    joinPath: `/duel/${id}`,
  });
}
