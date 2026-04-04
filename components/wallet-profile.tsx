"use client";

import { useCallback, useEffect, useState } from "react";

import {
  gameBtnGhost,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
} from "@/components/game-ui";
import { usePlayMode } from "@/components/play-mode-context";
import { WalletWithdrawModal } from "@/components/wallet-withdraw-modal";
import type { MobulaPortfolioPayload, MobulaPortfolioPosition } from "@/types/mobula-portfolio";

type Props = {
  walletAddress: string;
};

function formatUsd(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1 ? 2 : 6,
  }).format(n);
}

function formatTokenAmount(n: number, symbol: string) {
  const maxFrac = n >= 1 ? 6 : 12;
  const s = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFrac,
  }).format(n);
  return `${s} ${symbol}`;
}

function shortAddress(addr: string) {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletProfile({ walletAddress }: Props) {
  const { playMode } = usePlayMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<MobulaPortfolioPayload | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/wallet/portfolio?playMode=${encodeURIComponent(playMode)}`,
        { credentials: "include" },
      );
      const data = (await res.json()) as MobulaPortfolioPayload & { error?: string };
      if (!res.ok) {
        setPayload(null);
        setError(data.error ?? "Failed to load portfolio.");
        return;
      }
      setPayload(data);
    } catch {
      setPayload(null);
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [playMode]);

  useEffect(() => {
    void load();
  }, [load, walletAddress, playMode]);

  useEffect(() => {
    if (!clipboardNotice) return;
    const t = window.setTimeout(() => setClipboardNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [clipboardNotice]);

  const copyWalletForDeposit = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(walletAddress.trim());
      setClipboardNotice("Wallet address copied to clipboard.");
    } catch {
      setClipboardNotice("Could not copy to clipboard.");
    }
  }, [walletAddress]);

  const canWithdraw =
    Boolean(payload && payload.positions.length > 0 && !loading && !error);

  return (
    <div className={`${gamePanel} ${gamePanelTopAccent} relative overflow-hidden`}>
      <div className="border-b border-[var(--game-cyan-dim)] bg-[linear-gradient(135deg,rgba(65,245,240,0.08),rgba(255,61,154,0.06))] px-6 py-6 sm:px-8 sm:py-8">
        <p className={gameLabel}>Wallet</p>
        <p className="mt-1 font-[family-name:var(--font-share-tech)] text-sm text-[var(--game-cyan)]">
          {shortAddress(walletAddress)}
        </p>
        <p className="mt-4 font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-[0.35em] text-[var(--game-text-muted)]">
          Estimated total
        </p>
        <p className="mt-1 font-[family-name:var(--font-orbitron)] text-3xl font-black tabular-nums tracking-tight text-[var(--game-text)] [text-shadow:0_0_28px_rgba(65,245,240,0.25)] sm:text-4xl">
          {loading ? "…" : payload ? formatUsd(payload.totalWalletBalanceUsd) : "—"}
        </p>
        {payload?.mobulaSkippedReason === "friendly_hub_testnet_only" ? (
          <p className={`${gameMuted} mt-2 text-xs`}>
            Friendly mode — balance limited to testnet collateral (Arbitrum Sepolia).
          </p>
        ) : payload?.hubPlayMode === "duel" && payload.usedOnchainFallback ? (
          <p className={`${gameMuted} mt-2 text-xs`}>
            Duel mode — on-chain fallback (Mobula unavailable or empty).
          </p>
        ) : payload?.hubPlayMode === "duel" ? (
          <p className={`${gameMuted} mt-2 text-xs`}>Duel mode — portfolio indexed via Mobula.</p>
        ) : payload?.usedOnchainFallback ? (
          <p className={`${gameMuted} mt-2 text-xs`}>On-chain collateral on faucet chain (testnet).</p>
        ) : (
          <p className={`${gameMuted} mt-2 text-xs`}>Indexed via Mobula where configured.</p>
        )}
      </div>

      <div className="space-y-4 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--game-magenta)]">
            Holdings
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyWalletForDeposit()}
              className={`${gameBtnGhost} !w-auto shrink-0 border-[var(--game-cyan-dim)] text-[var(--game-cyan)]`}
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => setWithdrawOpen(true)}
              disabled={!canWithdraw}
              className={`${gameBtnGhost} !w-auto shrink-0 border-[var(--game-magenta-dim)] text-[var(--game-magenta)]`}
            >
              Withdraw
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className={`${gameBtnGhost} !w-auto shrink-0`}
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider`}>
            Syncing…
          </p>
        ) : null}

        {error ? (
          <p className="rounded-sm border border-[var(--game-danger)]/50 bg-[rgba(255,68,102,0.12)] px-3 py-2 text-sm text-[var(--game-danger)]">
            {error}
          </p>
        ) : null}

        {!loading && !error && payload && payload.positions.length === 0 ? (
          <p className={gameMuted}>
            No balances found. Check faucet / Mobula config if this looks wrong.
          </p>
        ) : null}

        {!loading && payload && payload.positions.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {payload.positions.map((p: MobulaPortfolioPosition) => (
              <li
                key={p.id}
                className="flex gap-3 rounded-sm border-2 border-[var(--game-cyan-dim)] bg-[rgba(4,2,12,0.6)] p-4 transition hover:border-[var(--game-cyan)]/45 hover:shadow-[0_0_20px_rgba(65,245,240,0.08)]"
              >
                {p.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.logo}
                    alt=""
                    className="size-11 shrink-0 rounded-full ring-2 ring-[var(--game-cyan-dim)]"
                    width={44}
                    height={44}
                  />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-[var(--game-cyan-dim)] bg-[rgba(65,245,240,0.08)] text-sm font-black text-[var(--game-cyan)]">
                    {p.symbol.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wide text-[var(--game-text)]">
                    {p.symbol}
                  </p>
                  <p className="truncate text-xs text-[var(--game-text-muted)]">{p.name}</p>
                  <p className="mt-2 font-[family-name:var(--font-share-tech)] text-sm text-[var(--game-cyan)]">
                    {formatTokenAmount(p.balance, p.symbol)}
                  </p>
                  {p.estimatedUsd > 0 ? (
                    <p className="mt-0.5 text-xs text-[var(--game-text-muted)]">{formatUsd(p.estimatedUsd)}</p>
                  ) : null}
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--game-text-muted)]">
                    {p.chainLabel ?? `Chain ${p.chainId}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <WalletWithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        positions={payload?.positions ?? []}
        onSuccess={() => void load()}
      />

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
    </div>
  );
}
