import { type NextRequest, NextResponse } from "next/server";
import { formatUnits, parseUnits } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { insertDuel, listOpenDuelsForUser } from "@/lib/db/duels";
import { findUserById } from "@/lib/db/users";
import {
  initialDuelChainsForInsert,
  normalizeDuelPlayMode,
} from "@/lib/duel/play-mode";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const rows = await listOpenDuelsForUser(user.id);

  const duels = rows.map((d) => ({
    id: d.id,
    joinPath: `/duel/${d.id}`,
    stakeUsdc: d.stake_usdc,
    durationSeconds: d.duration_seconds,
    playMode: normalizeDuelPlayMode(d.play_mode),
    creatorPseudo: d.creator_pseudo,
    opponentPseudo: d.opponent_pseudo,
    waitingForOpponent: d.opponent_id === null,
    isLive: d.duel_live_at != null,
    updatedAt: d.updated_at.toISOString(),
  }));

  return NextResponse.json({ duels });
}

const MIN_DURATION_SEC = 60;
const MAX_DURATION_SEC = 7 * 24 * 60 * 60;
/** USDC = 6 décimales ; le joueur ne les configure pas. */
const USDC_DECIMALS = 6;

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
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
    return NextResponse.json({ error: "stakeUsdc is required (USDC amount)." }, { status: 400 });
  }

  let units: bigint;
  try {
    units = parseUnits(stakeRaw, USDC_DECIMALS);
  } catch {
    return NextResponse.json({ error: "Invalid USDC amount." }, { status: 400 });
  }

  if (units <= BigInt(0)) {
    return NextResponse.json({ error: "Stake must be strictly positive." }, { status: 400 });
  }

  const stakeUsdc = formatUnits(units, USDC_DECIMALS);

  if (Number.isNaN(durationSeconds)) {
    return NextResponse.json({ error: "durationSeconds is required (integer)." }, { status: 400 });
  }

  if (durationSeconds < MIN_DURATION_SEC || durationSeconds > MAX_DURATION_SEC) {
    return NextResponse.json(
      {
        error: `Duration must be between ${MIN_DURATION_SEC} s and ${MAX_DURATION_SEC} s.`,
      },
      { status: 400 },
    );
  }

  const playMode = normalizeDuelPlayMode(b.playMode);
  const { creatorChain, opponentChain } = initialDuelChainsForInsert(playMode);

  const { id } = await insertDuel({
    creatorId: user.id,
    stakeUsdc,
    durationSeconds,
    playMode,
    creatorChain,
    opponentChain,
  });

  return NextResponse.json({
    id,
    joinPath: `/duel/${id}`,
  });
}
