"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  GameHudBar,
  GameLogo,
  gameBtnGhost,
  gameBtnPrimary,
  gameInput,
  gameLabel,
  gameLink,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
  gameSubtitle,
  gameTitle,
} from "@/components/game-ui";
import { usePlayMode } from "@/components/play-mode-context";
import { MIN_DUEL_STAKE_USDC } from "@/lib/duel/min-stake-usdc";

export default function NewDuelPage() {
  const { playMode } = usePlayMode();
  const [authChecked, setAuthChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [stakeUsdc, setStakeUsdc] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("15");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [joinPath, setJoinPath] = useState<string | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    const r = await fetch("/api/auth/me", { credentials: "include" });
    const data = (await r.json()) as { user: { id: string } | null };
    setLoggedIn(Boolean(data.user));
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (!clipboardNotice) return;
    const t = window.setTimeout(() => setClipboardNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [clipboardNotice]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setJoinUrl(null);
    setJoinPath(null);
    setLoading(true);
    try {
      const min = Number.parseInt(durationMinutes, 10);
      if (!Number.isFinite(min) || min < 1) {
        setError("Invalid duration (minutes ≥ 1).");
        return;
      }
      const stakeStr = stakeUsdc.trim().replace(",", ".");
      const stakeNum = Number.parseFloat(stakeStr);
      if (!Number.isFinite(stakeNum) || stakeNum < MIN_DUEL_STAKE_USDC) {
        setError(`Minimum stake is ${MIN_DUEL_STAKE_USDC} USDC per player.`);
        return;
      }
      const res = await fetch("/api/duels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          stakeUsdc: stakeUsdc.trim(),
          durationSeconds: min * 60,
          playMode,
        }),
      });
      const data = (await res.json()) as { error?: string; id?: string; joinPath?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create duel.");
        return;
      }
      if (data.joinPath && typeof window !== "undefined") {
        setJoinPath(data.joinPath);
        setJoinUrl(`${window.location.origin}${data.joinPath}`);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function copyUrl() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setClipboardNotice("Duel link copied to clipboard.");
    } catch {
      setClipboardNotice("Could not copy to clipboard.");
    }
  }

  if (!authChecked) {
    return (
      <>
        <GameHudBar>
          <GameLogo className="!text-sm" />
        </GameHudBar>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-16">
          <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-widest`}>
            Loading…
          </p>
        </main>
      </>
    );
  }

  if (!loggedIn) {
    return (
      <>
        <GameHudBar>
          <GameLogo className="!text-sm" />
        </GameHudBar>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-16">
          <p className={gameMuted}>Sign in to create an arena.</p>
          <Link href="/" className={gameLink}>
            Back to hub
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <GameHudBar>
        <Link href="/" className="shrink-0">
          <GameLogo className="!text-sm sm:!text-base" />
        </Link>
        <p className="font-[family-name:var(--font-orbitron)] text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--game-text-muted)]">
          Create
        </p>
      </GameHudBar>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 py-10 sm:py-14">
        <div className="space-y-2">
          <p className={gameSubtitle}>New match</p>
          <h1 className={gameTitle}>Create duel</h1>
          <p className={gameMuted}>
            Stake per player and trade duration. An invite link is generated for your opponent. The match is
            created in your current hub mode ({playMode === "duel" ? "Duel — Arbitrum mainnet" : "Friendly — testnet"}
            ).
          </p>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className={`${gamePanel} ${gamePanelTopAccent} space-y-4 p-6`}>
          <label className="block space-y-2">
            <span className={gameLabel}>Stake per player (USDC)</span>
            <input
              type="text"
              inputMode="decimal"
              value={stakeUsdc}
              onChange={(e) => setStakeUsdc(e.target.value)}
              placeholder={`min ${MIN_DUEL_STAKE_USDC} — e.g. 100 or 50.5`}
              className={gameInput}
              required
            />
            <p className={gameMuted}>
              At least {MIN_DUEL_STAKE_USDC} USDC (minimum position size for a trade).
            </p>
          </label>
          <label className="block space-y-2">
            <span className={gameLabel}>Trade duration (minutes)</span>
            <input
              type="number"
              min={1}
              max={10080}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className={gameInput}
              required
            />
          </label>
          {error ? (
            <p className="rounded-sm border border-[var(--game-danger)]/50 bg-[rgba(255,68,102,0.12)] px-3 py-2 text-sm text-[var(--game-danger)]">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={loading} className={gameBtnPrimary}>
            {loading ? "Creating…" : "Create arena & link"}
          </button>
        </form>

        {joinUrl ? (
          <div className={`${gamePanel} space-y-3 border-[var(--game-magenta-dim)] p-5`}>
            <p className="font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wider text-[var(--game-magenta)]">
              Invite link
            </p>
            <p className="break-all font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-cyan)]">
              {joinUrl}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void copyUrl()} className={`${gameBtnGhost} !w-auto`}>
                Copy
              </button>
              {joinPath ? (
                <Link href={joinPath} className={`${gameBtnGhost} !w-auto border-[var(--game-magenta-dim)] text-[var(--game-magenta)]`}>
                  Open lobby
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <Link href="/" className={`${gameLink} text-center`}>
          ← Back to hub
        </Link>
      </main>

      {clipboardNotice ? (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-[70] max-w-[min(90vw,20rem)] -translate-x-1/2 rounded-sm border border-[var(--game-cyan)]/50 bg-[rgba(4,2,12,0.92)] px-4 py-3 text-center shadow-[0_0_32px_rgba(65,245,240,0.2)] backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <p className="font-[family-name:var(--font-share-tech)] text-sm text-[var(--game-cyan)]">
            {clipboardNotice}
          </p>
        </div>
      ) : null}
    </>
  );
}
