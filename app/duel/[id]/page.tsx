import Link from "next/link";
import { notFound } from "next/navigation";

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
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n);
}

export default async function DuelLobbyPage({ params }: Props) {
  const { id } = await params;
  const duel = await findDuelWithPseudos(id);
  if (!duel) notFound();

  const stakeLabel = formatUsdcDisplay(duel.stake_usdc);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 py-16">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
          Salon de duel
        </p>
        <h1 className="text-xl font-semibold tracking-tight">Partie en attente</h1>
        <p className="font-mono text-xs text-[color-mix(in_oklab,var(--foreground)50%,transparent)]">
          {duel.id}
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-6">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">Créateur</p>
            <p className="font-semibold">{duel.creator_pseudo}</p>
          </div>
          <div>
            <p className="text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">Adversaire</p>
            <p className="font-semibold">
              {duel.opponent_pseudo ?? "— (pas encore rejoint)"}
            </p>
          </div>
        </div>
        <div className="border-t border-[color-mix(in_oklab,var(--foreground)10%,transparent)] pt-4 space-y-2 text-sm">
          <p>
            <span className="text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
              Mise (chacun) :{" "}
            </span>
            <span className="font-mono font-medium">{stakeLabel} USDC</span>
          </p>
          <p>
            <span className="text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
              Temps pour trader :{" "}
            </span>
            <span className="font-medium">{formatDuration(duel.duration_seconds)}</span>
          </p>
        </div>
        <p className="text-xs text-[color-mix(in_oklab,var(--foreground)50%,transparent)]">
          Prochaine étape : bouton « Prêt », fermeture auto du trade à la fin du timer — à brancher.
        </p>
      </div>

      <Link
        href="/"
        className="text-center text-sm text-[color-mix(in_oklab,var(--foreground)55%,transparent)] underline-offset-4 hover:underline"
      >
        Retour à l’accueil
      </Link>
    </main>
  );
}
