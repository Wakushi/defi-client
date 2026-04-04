import { type NextRequest, NextResponse } from "next/server"

import { getSessionFromRequest } from "@/lib/auth/session"
import { findDuelById, markDuelClosedIfUnset } from "@/lib/db/duels"
import { findUserById } from "@/lib/db/users"

export const runtime = "nodejs"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: duelId } = await context.params
  if (!UUID_RE.test(duelId)) {
    return NextResponse.json({ error: "Invalid duel id." }, { status: 400 })
  }

  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }

  const user = await findUserById(session.userId)
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 })
  }

  const duel = await findDuelById(duelId)
  if (!duel) {
    return NextResponse.json({ error: "Duel not found." }, { status: 404 })
  }

  const isCreator = user.id === duel.creator_id
  const isOpponent = duel.opponent_id !== null && user.id === duel.opponent_id
  if (!isCreator && !isOpponent) {
    return NextResponse.json({ error: "You are not in this duel." }, { status: 403 })
  }

  await markDuelClosedIfUnset(duelId)
  const fresh = await findDuelById(duelId)
  const closedAt = fresh?.duel_closed_at

  return NextResponse.json({
    ok: true as const,
    duelClosedAt:
      closedAt instanceof Date
        ? closedAt.toISOString()
        : closedAt
          ? new Date(closedAt as string).toISOString()
          : null,
  })
}
