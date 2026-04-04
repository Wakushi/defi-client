"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  GameHudBar,
  GameLogo,
  gameBtnGhost,
  gameInput,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
  gameSubtitle,
  gameTabActive,
  gameTabRow,
  gameTitle,
} from "@/components/game-ui";

type HistoryRow = {
  id: string;
  joinPath: string;
  closedAt: string;
  stakeUsdc: string;
  playMode: "duel" | "friendly";
  creatorPseudo: string;
  opponentPseudo: string | null;
  yourPnlUsdc: number | null;
  yourPnlPct: number | null;
  rivalPnlUsdc: number | null;
  rivalPnlPct: number | null;
  yourResult: "win" | "loss" | "tie" | "unknown";
};

type OutcomeFilter = "all" | "win" | "loss" | "tie" | "unknown";

type HistoryStats = {
  total: number;
  wins: number;
  losses: number;
  ties: number;
  unknown: number;
  winRatePct: number | null;
};

function formatUsdc(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(n)}`;
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(2)} %`;
}

function borderForResult(r: HistoryRow["yourResult"]): string {
  switch (r) {
    case "win":
      return "border-2 border-emerald-500/70 shadow-[0_0_24px_rgba(52,211,153,0.15)]";
    case "loss":
      return "border-2 border-red-500/65 shadow-[0_0_24px_rgba(248,113,113,0.12)]";
    case "tie":
      return "border-2 border-amber-500/60 shadow-[0_0_20px_rgba(251,191,36,0.12)]";
    default:
      return "border-2 border-[var(--game-cyan-dim)]";
  }
}

function resultLabel(r: HistoryRow["yourResult"]): string {
  switch (r) {
    case "win":
      return "WIN";
    case "loss":
      return "LOSS";
    case "tie":
      return "TIE";
    default:
      return "Result pending";
  }
}

export default function DuelHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [viewerPseudo, setViewerPseudo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [pseudoDraft, setPseudoDraft] = useState("");
  const [pseudoQuery, setPseudoQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (outcome !== "all") q.set("outcome", outcome);
      if (pseudoQuery.trim()) q.set("pseudo", pseudoQuery.trim());
      const qs = q.toString();
      const r = await fetch(
        `/api/duels/history${qs ? `?${qs}` : ""}`,
        { credentials: "include" },
      );
      const data = (await r.json()) as {
        duels?: HistoryRow[];
        stats?: HistoryStats;
        viewerPseudo?: string;
        error?: string;
      };
      if (!r.ok) {
        setRows([]);
        setStats(null);
        setViewerPseudo(null);
        setError(data.error ?? "Failed to load history.");
        return;
      }
      setRows(Array.isArray(data.duels) ? data.duels : []);
      setStats(
        data.stats && typeof data.stats.total === "number" ? data.stats : null,
      );
      setViewerPseudo(
        typeof data.viewerPseudo === "string" ? data.viewerPseudo : null,
      );
    } catch {
      setRows([]);
      setStats(null);
      setViewerPseudo(null);
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [outcome, pseudoQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyPseudoSearch() {
    setPseudoQuery(pseudoDraft.trim());
  }

  return (
    <>
      <GameHudBar>
        <Link href="/" className="shrink-0">
          <GameLogo className="!text-sm sm:!text-base" />
        </Link>
        <p className="font-[family-name:var(--font-orbitron)] text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--game-text-muted)]">
          History
        </p>
      </GameHudBar>

      <main className="flex w-full max-w-none flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
        <div className="w-full max-w-4xl">
          <p className={gameSubtitle}>Past matches</p>
          <h1 className={gameTitle}>Duel history</h1>
          <p className={`${gameMuted} mt-2`}>
            Filter by result, or search a pseudo to see every finished duel involving that name (you or
            rival). Stats below count all matches after the pseudo filter; the list also applies the
            result tab.
          </p>
        </div>

        <div
          className={`${gamePanel} ${gamePanelTopAccent} flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-5`}
        >
          <div>
            <span className={gameLabel}>Result</span>
            <div className={`${gameTabRow} mt-2 flex-wrap`}>
              {(
                [
                  ["all", "All"],
                  ["win", "Wins"],
                  ["loss", "Losses"],
                  ["tie", "Ties"],
                  ["unknown", "Pending"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOutcome(key)}
                  className={`rounded-sm px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition sm:text-xs ${gameTabActive(outcome === key)}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
            <label className="min-w-0 flex-1 space-y-2">
              <span className={gameLabel}>Pseudo (you or opponent)</span>
              <input
                type="search"
                value={pseudoDraft}
                onChange={(e) => setPseudoDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyPseudoSearch();
                }}
                placeholder="e.g. alice"
                className={gameInput}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPseudoSearch()}
                className={`${gameBtnGhost} border-[var(--game-cyan-dim)] text-[var(--game-cyan)]`}
              >
                Search
              </button>
              <button
                type="button"
                onClick={() => {
                  setPseudoDraft("");
                  setPseudoQuery("");
                }}
                className={gameBtnGhost}
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {stats != null && !loading && (stats.total > 0 || pseudoQuery.length > 0) ? (
          <div
            className={`${gamePanel} w-full border-[var(--game-cyan-dim)]/60 bg-[rgba(4,2,12,0.55)] p-4 sm:p-5`}
          >
            <p className="font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--game-magenta)]">
              Stats{pseudoQuery ? ` · “${pseudoQuery}”` : " · all duels"}
            </p>
            {viewerPseudo ? (
              <p className="mt-1 text-xs text-[var(--game-text-muted)]">
                Logged in as <span className="text-[var(--game-cyan)]">{viewerPseudo}</span>
              </p>
            ) : null}
            <dl className="mt-4 grid gap-3 font-[family-name:var(--font-share-tech)] text-sm text-[var(--game-text)] sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-sm border border-[var(--game-cyan-dim)]/40 bg-[rgba(65,245,240,0.06)] px-3 py-2">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--game-text-muted)]">
                  Duels (after pseudo filter)
                </dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-[var(--game-cyan)]">
                  {stats.total}
                </dd>
              </div>
              <div className="rounded-sm border border-emerald-500/30 bg-[rgba(52,211,153,0.08)] px-3 py-2">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/90">
                  Wins
                </dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-emerald-300">{stats.wins}</dd>
              </div>
              <div className="rounded-sm border border-red-500/30 bg-[rgba(248,113,113,0.08)] px-3 py-2">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-red-400/90">
                  Losses
                </dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-red-300">{stats.losses}</dd>
              </div>
              <div className="rounded-sm border border-amber-500/35 bg-[rgba(251,191,36,0.07)] px-3 py-2">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-amber-400/90">
                  Win rate
                </dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-amber-200">
                  {stats.winRatePct != null ? `${stats.winRatePct}%` : "—"}
                  <span className="ml-1 text-[10px] font-normal normal-case text-[var(--game-text-muted)]">
                    (wins / wins+losses)
                  </span>
                </dd>
              </div>
            </dl>
            {(stats.ties > 0 || stats.unknown > 0) && (
              <p className="mt-3 text-xs text-[var(--game-text-muted)]">
                Also: {stats.ties} tie{stats.ties !== 1 ? "s" : ""}
                {stats.unknown > 0
                  ? ` · ${stats.unknown} pending result${stats.unknown !== 1 ? "s" : ""}`
                  : ""}
                .
              </p>
            )}
          </div>
        ) : null}

        <div className="flex w-full flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={`${gameBtnGhost} !w-auto`}
          >
            {loading ? "…" : "Refresh"}
          </button>
          <Link href="/" className={`${gameBtnGhost} !w-auto`}>
            Hub
          </Link>
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

        {!loading && !error && rows.length === 0 ? (
          <p className={gameMuted}>
            {(() => {
              if (stats && pseudoQuery && stats.total === 0) {
                return `No finished duels involving “${pseudoQuery}”.`;
              }
              if (stats && stats.total > 0 && outcome !== "all") {
                const o =
                  outcome === "unknown"
                    ? "pending result"
                    : outcome === "win"
                      ? "win"
                      : outcome === "loss"
                        ? "loss"
                        : "tie";
                return `No “${o}” in this list (try tab “All”, or widen the pseudo search).`;
              }
              return "No finished duels yet.";
            })()}
          </p>
        ) : null}

        {!loading && rows.length > 0 ? (
          <ul className="grid w-full gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17.5rem),1fr))]">
            {rows.map((d) => (
              <li
                key={d.id}
                className={`flex h-full min-h-0 min-w-0 flex-col rounded-sm bg-[rgba(4,2,12,0.65)] p-4 ${borderForResult(d.yourResult)}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wide text-[var(--game-text)]">
                      {d.creatorPseudo}{" "}
                      <span className="text-[var(--game-text-muted)]">vs</span>{" "}
                      {d.opponentPseudo ?? "—"}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--game-text-muted)]">
                      {d.playMode === "duel" ? "Duel" : "Friendly"} · stake {d.stakeUsdc} USDC ·{" "}
                      {new Date(d.closedAt).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-[family-name:var(--font-orbitron)] text-[10px] font-black uppercase tracking-[0.2em] ${
                      d.yourResult === "win"
                        ? "text-emerald-400"
                        : d.yourResult === "loss"
                          ? "text-red-400"
                          : d.yourResult === "tie"
                            ? "text-amber-400"
                            : "text-[var(--game-text-muted)]"
                    }`}
                  >
                    {resultLabel(d.yourResult)}
                  </span>
                </div>
                <div className="mt-3 grid flex-1 grid-cols-2 gap-x-3 gap-y-2 font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-cyan)]">
                  <p className="min-w-0">
                    <span className="text-[var(--game-text-muted)]">You · PnL USDC</span>
                    <br />
                    <span className="break-all">{formatUsdc(d.yourPnlUsdc)}</span>
                  </p>
                  <p className="min-w-0">
                    <span className="text-[var(--game-text-muted)]">You · PnL %</span>
                    <br />
                    {formatPct(d.yourPnlPct)}
                  </p>
                  <p className="min-w-0">
                    <span className="text-[var(--game-text-muted)]">Rival · PnL USDC</span>
                    <br />
                    <span className="break-all">{formatUsdc(d.rivalPnlUsdc)}</span>
                  </p>
                  <p className="min-w-0">
                    <span className="text-[var(--game-text-muted)]">Rival · PnL %</span>
                    <br />
                    {formatPct(d.rivalPnlPct)}
                  </p>
                </div>
                <Link
                  href={d.joinPath}
                  className={`${gameBtnGhost} mt-auto w-full shrink-0 border-[var(--game-cyan-dim)] text-[var(--game-cyan)]`}
                >
                  Open duel page
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </>
  );
}
