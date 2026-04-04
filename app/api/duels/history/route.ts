import { type NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { listFinishedDuelsForUser } from "@/lib/db/duels";
import { findUserById } from "@/lib/db/users";
import { normalizeDuelPlayMode } from "@/lib/duel/play-mode";

export const runtime = "nodejs";

const OUTCOMES = new Set(["all", "win", "loss", "tie", "unknown"]);

type MappedDuel = {
  id: string;
  joinPath: string;
  closedAt: string;
  stakeUsdc: string;
  playMode: ReturnType<typeof normalizeDuelPlayMode>;
  creatorPseudo: string;
  opponentPseudo: string | null;
  creatorPnlUsdc: number | null;
  opponentPnlUsdc: number | null;
  creatorPnlPct: number | null;
  opponentPnlPct: number | null;
  yourPnlUsdc: number | null;
  yourPnlPct: number | null;
  rivalPnlUsdc: number | null;
  rivalPnlPct: number | null;
  winnerSide: string | null;
  yourResult: "win" | "loss" | "tie" | "unknown";
};

function aggregateStats(rows: MappedDuel[]) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let unknown = 0;
  for (const d of rows) {
    if (d.yourResult === "win") wins += 1;
    else if (d.yourResult === "loss") losses += 1;
    else if (d.yourResult === "tie") ties += 1;
    else unknown += 1;
  }
  const decisive = wins + losses;
  const winRatePct =
    decisive > 0 ? Math.round((wins / decisive) * 1000) / 10 : null;
  return {
    total: rows.length,
    wins,
    losses,
    ties,
    unknown,
    winRatePct,
  };
}

function pseudoMatchesRow(row: MappedDuel, needle: string): boolean {
  const q = needle.toLowerCase();
  if (row.creatorPseudo.toLowerCase().includes(q)) return true;
  if (row.opponentPseudo && row.opponentPseudo.toLowerCase().includes(q)) return true;
  return false;
}

function viewerResult(
  userId: string,
  row: {
    creator_id: string;
    opponent_id: string | null;
    duel_winner_side: string | null;
  },
): "win" | "loss" | "tie" | "unknown" {
  const w = row.duel_winner_side;
  if (w === "tie") return "tie";
  if (w !== "creator" && w !== "opponent") return "unknown";
  if (userId === row.creator_id) return w === "creator" ? "win" : "loss";
  if (row.opponent_id && userId === row.opponent_id) {
    return w === "opponent" ? "win" : "loss";
  }
  return "unknown";
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const rows = await listFinishedDuelsForUser(user.id);

  const mapped: MappedDuel[] = rows.map((d) => {
    const cU =
      d.creator_pnl_usdc != null && String(d.creator_pnl_usdc).trim() !== ""
        ? Number(d.creator_pnl_usdc)
        : null;
    const oU =
      d.opponent_pnl_usdc != null && String(d.opponent_pnl_usdc).trim() !== ""
        ? Number(d.opponent_pnl_usdc)
        : null;
    const cP =
      typeof d.creator_pnl_pct === "number" && Number.isFinite(d.creator_pnl_pct)
        ? d.creator_pnl_pct
        : null;
    const oP =
      typeof d.opponent_pnl_pct === "number" && Number.isFinite(d.opponent_pnl_pct)
        ? d.opponent_pnl_pct
        : null;
    const youAreCreator = user.id === d.creator_id;
    return {
      id: d.id,
      joinPath: `/duel/${d.id}`,
      closedAt:
        d.duel_closed_at instanceof Date
          ? d.duel_closed_at.toISOString()
          : String(d.duel_closed_at),
      stakeUsdc: d.stake_usdc,
      playMode: normalizeDuelPlayMode(d.play_mode),
      creatorPseudo: d.creator_pseudo,
      opponentPseudo: d.opponent_pseudo,
      creatorPnlUsdc: cU,
      opponentPnlUsdc: oU,
      creatorPnlPct: cP,
      opponentPnlPct: oP,
      yourPnlUsdc: youAreCreator ? cU : oU,
      yourPnlPct: youAreCreator ? cP : oP,
      rivalPnlUsdc: youAreCreator ? oU : cU,
      rivalPnlPct: youAreCreator ? oP : cP,
      winnerSide: d.duel_winner_side,
      yourResult: viewerResult(user.id, d),
    };
  });

  const url = req.nextUrl.searchParams;
  const pseudoRaw = url.get("pseudo")?.trim() ?? "";
  const outcomeRaw = url.get("outcome")?.trim().toLowerCase() ?? "all";
  const outcome = OUTCOMES.has(outcomeRaw) ? outcomeRaw : "all";

  const afterPseudo =
    pseudoRaw.length > 0
      ? mapped.filter((d) => pseudoMatchesRow(d, pseudoRaw))
      : mapped;

  const stats = aggregateStats(afterPseudo);

  const duels =
    outcome === "all"
      ? afterPseudo
      : afterPseudo.filter((d) => d.yourResult === outcome);

  return NextResponse.json({
    duels,
    stats,
    viewerPseudo: user.pseudo,
    filters: {
      pseudo: pseudoRaw.length > 0 ? pseudoRaw : null,
      outcome,
    },
  });
}
