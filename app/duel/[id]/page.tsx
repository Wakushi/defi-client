import Link from "next/link";
import { notFound } from "next/navigation";

import { DuelAcceptPanel } from "@/components/duel-accept-panel";
import {
  GameHudBar,
  GameLogo,
  GameStatPill,
  GameVsBanner,
  gameLink,
  gameMuted,
  gameSubtitle,
  gameTitle,
} from "@/components/game-ui";
import { findDuelWithPseudos } from "@/lib/db/duels";

type Props = {
  params: Promise<{ id: string }>;
};

function formatDuration(totalSec: number) {
  if (totalSec < 3600) {
    return `${Math.round(totalSec / 60)} min`;
  }
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

function formatUsdcDisplay(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n);
}

export default async function DuelLobbyPage({ params }: Props) {
  const { id } = await params;
  const duel = await findDuelWithPseudos(id);
  if (!duel) notFound();

  const stakeLabel = formatUsdcDisplay(duel.stake_usdc);
  const opp = duel.opponent_pseudo ?? "Waiting…";

  return (
    <>
      <GameHudBar>
        <Link href="/" className="shrink-0">
          <GameLogo className="!text-sm sm:!text-base" />
        </Link>
        <p className="hidden font-[family-name:var(--font-orbitron)] text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--game-text-muted)] sm:block">
          Match lobby
        </p>
      </GameHudBar>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-4 py-10 sm:py-14">
        <div className="space-y-3">
          <p className={gameSubtitle}>Match ID</p>
          <h1 className={`${gameTitle} !text-2xl sm:!text-3xl`}>Arena open</h1>
          <p className={`${gameMuted} font-[family-name:var(--font-share-tech)] text-xs`}>{duel.id}</p>
        </div>

        <GameVsBanner
          left={duel.creator_pseudo}
          right={opp}
          leftTag="Creator"
          rightTag="Opponent"
        />

        <div className="grid grid-cols-2 gap-3">
          <GameStatPill label="Stake / player" value={`${stakeLabel} USDC`} />
          <GameStatPill label="Trade time" value={formatDuration(duel.duration_seconds)} />
        </div>

        <div className="rounded-sm border-2 border-[var(--game-cyan-dim)] bg-[var(--game-bg-elevated)] p-5 backdrop-blur-md">
          <p className={`${gameMuted} text-xs leading-relaxed`}>
            Both players join the lobby, then go to{" "}
            <span className="font-semibold text-[var(--game-cyan)]">trade prep</span> to open positions in
            sync.
          </p>
        </div>

        <DuelAcceptPanel duelId={duel.id} />

        <Link href="/" className={`${gameLink} text-center`}>
          ← Back to hub
        </Link>
      </main>
    </>
  );
}
