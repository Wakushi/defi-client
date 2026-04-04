import { type NextRequest, NextResponse } from "next/server";
import { getAddress, parseUnits } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { readCollateralBalance } from "@/lib/evm/collateral-balance";
import { findDuelById, findDuelWithPseudos, setDuelOpponent } from "@/lib/db/duels";
import { findUserById } from "@/lib/db/users";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const USDC_DECIMALS = 6;

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: duelId } = await context.params;
  if (!UUID_RE.test(duelId)) {
    return NextResponse.json({ error: "Invalid duel id." }, { status: 400 });
  }

  const session = await getSessionFromRequest(_request);
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

  if (duel.creator_id === user.id) {
    return NextResponse.json(
      { error: "You are already the creator of this duel." },
      { status: 400 },
    );
  }

  if (duel.opponent_id !== null) {
    return NextResponse.json(
      { error: "This duel already has an opponent." },
      { status: 409 },
    );
  }

  if (!user.wallet_address) {
    return NextResponse.json(
      { error: "Account has no wallet — cannot verify balance." },
      { status: 400 },
    );
  }

  let wallet: `0x${string}`;
  try {
    wallet = getAddress(user.wallet_address.trim() as `0x${string}`);
  } catch {
    return NextResponse.json({ error: "Invalid wallet address." }, { status: 500 });
  }

  let stakeWei: bigint;
  try {
    stakeWei = parseUnits(duel.stake_usdc, USDC_DECIMALS);
  } catch {
    return NextResponse.json({ error: "Invalid duel stake in database." }, { status: 500 });
  }

  const bal = await readCollateralBalance(wallet);
  if (!bal) {
    return NextResponse.json(
      {
        error: "Could not read your USDC balance (RPC / GNS_COLLATERAL_TOKEN_ADDRESS).",
      },
      { status: 502 },
    );
  }

  if (bal.balanceRaw < stakeWei) {
    return NextResponse.json(
      {
        error: "Insufficient USDC balance to accept this stake.",
        balanceRaw: bal.balanceRaw.toString(),
        stakeRaw: stakeWei.toString(),
      },
      { status: 400 },
    );
  }

  const ok = await setDuelOpponent(duelId, user.id);
  if (!ok) {
    return NextResponse.json(
      { error: "Someone just accepted this duel. Refresh the page." },
      { status: 409 },
    );
  }

  const withPseudos = await findDuelWithPseudos(duelId);
  return NextResponse.json({
    ok: true,
    opponentPseudo: withPseudos?.opponent_pseudo ?? user.pseudo,
  });
}
