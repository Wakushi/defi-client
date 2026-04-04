import { type NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { markParticipantTradeReady } from "@/lib/db/duel-ready";
import { findDuelById } from "@/lib/db/duels";
import {
  normalizeDuelPlayMode,
  parseStoredGainsChain,
} from "@/lib/duel/play-mode";
import { findUserById } from "@/lib/db/users";
import type { GainsApiChain } from "@/types/gains-api";
import type { DuelTradeSideConfig } from "@/types/duel-trade";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBodyConfig(body: unknown): DuelTradeSideConfig | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const pairIndex = Number(o.pairIndex);
  const leverageX = Number(o.leverageX);
  const long = Boolean(o.long);
  const tradeType =
    typeof o.tradeType === "number" && Number.isInteger(o.tradeType)
      ? o.tradeType
      : undefined;
  const referencePrice =
    typeof o.referencePrice === "number" &&
    Number.isFinite(o.referencePrice) &&
    o.referencePrice > 0
      ? o.referencePrice
      : undefined;
  if (!Number.isFinite(pairIndex) || pairIndex < 0 || pairIndex > 65535) {
    return null;
  }
  if (!Number.isFinite(leverageX) || leverageX < 1 || leverageX > 500) {
    return null;
  }
  const gc = o.gainsChain;
  let gainsChain: GainsApiChain | undefined;
  if (gc === "Testnet" || gc === "Arbitrum" || gc === "Base") {
    gainsChain = gc;
  }
  return { pairIndex, leverageX, long, tradeType, referencePrice, gainsChain };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: duelId } = await context.params;
  if (!UUID_RE.test(duelId)) {
    return NextResponse.json({ error: "Invalid duel id." }, { status: 400 });
  }

  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const duel = await findDuelById(duelId);
  if (!duel) {
    return NextResponse.json({ error: "Duel not found." }, { status: 404 });
  }

  if (duel.opponent_id === null) {
    return NextResponse.json(
      { error: "This duel has no opponent yet." },
      { status: 400 },
    );
  }

  const isCreator = user.id === duel.creator_id;
  const isOpponent = user.id === duel.opponent_id;
  if (!isCreator && !isOpponent) {
    return NextResponse.json({ error: "You are not in this duel." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseBodyConfig(body);
  if (!parsed) {
    return NextResponse.json(
      { error: "pairIndex (0–65535), leverageX (1–500), and long are required." },
      { status: 400 },
    );
  }

  const playMode = normalizeDuelPlayMode(duel.play_mode);
  let config: DuelTradeSideConfig;
  if (playMode === "duel") {
    const gc = parsed.gainsChain;
    if (gc !== "Arbitrum" && gc !== "Base") {
      return NextResponse.json(
        {
          error:
            "En mode duel, choisis une chaîne d’exécution : gainsChain = Arbitrum ou Base.",
        },
        { status: 400 },
      );
    }
    config = { ...parsed, gainsChain: gc };
  } else {
    const forcedChain = parseStoredGainsChain(
      isCreator ? duel.creator_chain : duel.opponent_chain,
    );
    config = { ...parsed, gainsChain: forcedChain };
  }

  const result = await markParticipantTradeReady({
    duelId,
    isCreator,
    config,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Duel not found." }, { status: 404 });
  }

  return NextResponse.json({
    readyState: result.readyState,
    bothReady: result.bothReady,
    readyBothAt: result.readyBothAtIso,
    already: result.already,
  });
}
