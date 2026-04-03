import { type NextRequest, NextResponse } from "next/server";

import { findDuelWithPseudos } from "@/lib/db/duels";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Identifiant de duel invalide." }, { status: 400 });
  }

  const duel = await findDuelWithPseudos(id);
  if (!duel) {
    return NextResponse.json({ error: "Duel introuvable." }, { status: 404 });
  }

  return NextResponse.json({
    id: duel.id,
    creatorPseudo: duel.creator_pseudo,
    opponentPseudo: duel.opponent_pseudo,
    stakeUsdc: duel.stake_usdc,
    durationSeconds: duel.duration_seconds,
    createdAt: duel.created_at.toISOString(),
  });
}
