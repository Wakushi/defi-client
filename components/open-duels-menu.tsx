"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { gameBtnGhost, gameLabel, gameMuted } from "@/components/game-ui";

type OpenDuelRow = {
  id: string;
  joinPath: string;
  stakeUsdc: string;
  playMode: "duel" | "friendly";
  creatorPseudo: string;
  opponentPseudo: string | null;
  waitingForOpponent: boolean;
  isLive: boolean;
  updatedAt: string;
};

export function OpenDuelsMenu() {
  const [duels, setDuels] = useState<OpenDuelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/duels", { credentials: "include" });
      const data = (await r.json()) as { duels?: OpenDuelRow[]; error?: string };
      if (!r.ok) {
        setDuels([]);
        setError(data.error ?? "Failed to load duels.");
        return;
      }
      setDuels(Array.isArray(data.duels) ? data.duels : []);
    } catch {
      setDuels([]);
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-6 border-t border-[var(--game-cyan-dim)]/50 pt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className={gameLabel}>Active duels</p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={`${gameBtnGhost} !w-auto shrink-0`}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="rounded-sm border border-[var(--game-danger)]/50 bg-[rgba(255,68,102,0.12)] px-3 py-2 text-sm text-[var(--game-danger)]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider`}>
          Loading…
        </p>
      ) : null}

      {!loading && !error && duels.length === 0 ? (
        <p className={gameMuted}>No active duels.</p>
      ) : null}

      {!loading && duels.length > 0 ? (
        <ul className="space-y-3">
          {duels.map((d) => {
            const status = d.waitingForOpponent
              ? "Waiting for opponent"
              : d.isLive
                ? "Live"
                : "Lobby";
            return (
              <li
                key={d.id}
                className="flex flex-col gap-2 rounded-sm border border-[var(--game-cyan-dim)] bg-[rgba(4,2,12,0.5)] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-[family-name:var(--font-orbitron)] text-xs font-bold text-[var(--game-text)]">
                    {d.creatorPseudo}{" "}
                    <span className="text-[var(--game-text-muted)]">vs</span>{" "}
                    {d.opponentPseudo ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--game-text-muted)]">
                    {d.stakeUsdc} USDC · {d.playMode === "duel" ? "Duel" : "Friendly"} · {status}
                  </p>
                </div>
                <Link
                  href={d.joinPath}
                  className={`${gameBtnGhost} !w-full shrink-0 border-[var(--game-cyan-dim)] text-[var(--game-cyan)] sm:!w-auto`}
                >
                  Open duel
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
