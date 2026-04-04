"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";

import {
  gameBtnPrimary,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
  gameTabActive,
  gameTabRow,
  gameTitle,
} from "@/components/game-ui";
import { LoginForm } from "@/components/login-form";
import { SignupForm } from "@/components/signup-form";

type DuelApi = {
  id: string;
  creatorPseudo: string;
  opponentPseudo: string | null;
  stakeUsdc: string;
  durationSeconds: number;
  createdAt: string;
  duelFull: boolean;
  viewer: { isCreator: boolean; isOpponent: boolean } | null;
};

type BalanceApi = {
  configured: boolean;
  balanceRaw?: string;
  decimals?: number;
  formatted?: string;
  error?: string;
};

type Props = { duelId: string };

function formatUsdcLabel(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n);
}

export function DuelAcceptPanel({ duelId }: Props) {
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [duel, setDuel] = useState<DuelApi | null>(null);
  const [duelError, setDuelError] = useState<string | null>(null);
  const [duelLoading, setDuelLoading] = useState(true);
  const [balance, setBalance] = useState<BalanceApi | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const loadDuel = useCallback(async () => {
    setDuelError(null);
    setDuelLoading(true);
    try {
      const r = await fetch(`/api/duels/${duelId}`, { credentials: "include" });
      const data = (await r.json()) as DuelApi & { error?: string };
      if (!r.ok) {
        setDuel(null);
        setDuelError(data.error ?? "Duel not found.");
        return;
      }
      setDuel(data);
    } catch {
      setDuel(null);
      setDuelError("Network error.");
    } finally {
      setDuelLoading(false);
    }
  }, [duelId]);

  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalance(null);
    try {
      const r = await fetch("/api/wallet/collateral-balance", { credentials: "include" });
      const data = (await r.json()) as BalanceApi & { error?: string };
      if (r.status === 401) {
        setBalance({ configured: false, error: "Session expired — sign in again." });
        return;
      }
      setBalance({
        configured: Boolean(data.configured),
        balanceRaw: data.balanceRaw,
        decimals: data.decimals,
        formatted: data.formatted,
        error: data.error,
      });
    } catch {
      setBalance({ configured: false, error: "Network error." });
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDuel();
  }, [loadDuel]);

  const shouldLoadBalance =
    duel?.viewer &&
    !duel.viewer.isCreator &&
    !duel.viewer.isOpponent &&
    !duel.duelFull;

  useEffect(() => {
    if (!shouldLoadBalance) return;
    void loadBalance();
  }, [shouldLoadBalance, loadBalance]);

  const canAccept = useMemo(() => {
    if (!duel || !balance?.configured || !balance.balanceRaw) return false;
    try {
      const need = parseUnits(duel.stakeUsdc, 6);
      return BigInt(balance.balanceRaw) >= need;
    } catch {
      return false;
    }
  }, [duel, balance]);

  async function onJoin() {
    setJoinError(null);
    setJoinLoading(true);
    try {
      const r = await fetch(`/api/duels/${duelId}/join`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setJoinError(data.error ?? "Could not accept duel.");
        return;
      }
      await loadDuel();
    } catch {
      setJoinError("Network error.");
    } finally {
      setJoinLoading(false);
    }
  }

  if (duelLoading) {
    return (
      <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-widest`}>
        Loading…
      </p>
    );
  }

  if (duelError || !duel) {
    return (
      <p className="rounded-sm border border-[var(--game-danger)]/50 bg-[rgba(255,68,102,0.12)] px-3 py-2 text-sm text-[var(--game-danger)]">
        {duelError ?? "Duel not found."}
      </p>
    );
  }

  if (!duel.viewer) {
    return (
      <div className={`${gamePanel} ${gamePanelTopAccent} space-y-4 p-6`}>
        <div className="space-y-2">
          <p className={gameLabel}>Guest</p>
          <h2 className={`${gameTitle} text-lg sm:text-xl`}>Join the arena</h2>
          <p className={gameMuted}>
            Sign in or create an account. You will see your account wallet USDC balance; it must cover the
            stake ({formatUsdcLabel(duel.stakeUsdc)} USDC) to accept.
          </p>
        </div>
        <div className={gameTabRow}>
          <button
            type="button"
            onClick={() => setAuthMode("login")}
            className={`flex-1 rounded-sm py-2.5 text-xs font-bold uppercase tracking-wider transition ${gameTabActive(authMode === "login")}`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => setAuthMode("signup")}
            className={`flex-1 rounded-sm py-2.5 text-xs font-bold uppercase tracking-wider transition ${gameTabActive(authMode === "signup")}`}
          >
            Sign up
          </button>
        </div>
        {authMode === "login" ? (
          <LoginForm onSuccess={() => void loadDuel()} />
        ) : (
          <SignupForm onSuccess={() => void loadDuel()} />
        )}
      </div>
    );
  }

  if (duel.viewer.isCreator) {
    return (
      <div className={`${gamePanel} ${gamePanelTopAccent} space-y-3 p-6`}>
        <p className={gameLabel}>Host</p>
        <p className="font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-[var(--game-text)]">
          You run this arena
        </p>
        <p className={gameMuted}>
          Send the link to your opponent: they sign in, then accept with a wallet that has at least{" "}
          {formatUsdcLabel(duel.stakeUsdc)} USDC on the faucet chain.
        </p>
        {duel.duelFull ? (
          <Link href={`/duel/${duelId}/prepare`} className={`${gameBtnPrimary} mt-2 !w-auto px-5`}>
            Set up my trade
          </Link>
        ) : null}
      </div>
    );
  }

  if (duel.viewer.isOpponent) {
    return (
      <div className={`${gamePanel} ${gamePanelTopAccent} space-y-3 p-6`}>
        <p className={gameLabel}>Fighter</p>
        <p className="font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-[var(--game-text)]">
          You are in this match
        </p>
        <p className={gameMuted}>
          Opponent: <span className="font-semibold text-[var(--game-cyan)]">{duel.creatorPseudo}</span>. Set up
          your trade and mark ready together with the host.
        </p>
        <Link href={`/duel/${duelId}/prepare`} className={`${gameBtnPrimary} mt-2 !w-auto px-5`}>
          Set up my trade
        </Link>
      </div>
    );
  }

  if (duel.duelFull) {
    return (
      <div className={`${gamePanel} border-[var(--game-magenta-dim)] p-6`}>
        <p className={gameLabel}>Match locked</p>
        <p className="font-[family-name:var(--font-orbitron)] text-sm font-bold text-[var(--game-text)]">
          {duel.creatorPseudo} <span className="text-[var(--game-amber)]">VS</span>{" "}
          {duel.opponentPseudo ?? "?"}
        </p>
        <p className={`${gameMuted} mt-2`}>You cannot join this match.</p>
      </div>
    );
  }

  return (
    <div className={`${gamePanel} ${gamePanelTopAccent} space-y-4 p-6`}>
      <div className="space-y-2">
        <p className={gameLabel}>Final step</p>
        <h2 className={`${gameTitle} text-lg sm:text-xl`}>Accept duel</h2>
        <p className={gameMuted}>
          Required stake (each):{" "}
          <span className="font-[family-name:var(--font-share-tech)] font-medium text-[var(--game-cyan)]">
            {formatUsdcLabel(duel.stakeUsdc)} USDC
          </span>
        </p>
      </div>

      {balanceLoading ? (
        <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider`}>
          Reading balance…
        </p>
      ) : null}

      {!balanceLoading && balance ? (
        <div className={`space-y-2 text-sm ${gameMuted}`}>
          {!balance.configured ? (
            <p className="rounded-sm border border-[var(--game-amber)]/40 bg-[rgba(255,200,74,0.1)] px-3 py-2 text-[var(--game-amber)]">
              {balance.error ??
                "Balance unavailable — check FAUCET_RPC_URL and GNS_COLLATERAL_TOKEN_ADDRESS."}
            </p>
          ) : (
            <>
              <p>
                <span className="text-[var(--game-text-muted)]">Your balance: </span>
                <span className="font-[family-name:var(--font-share-tech)] font-medium text-[var(--game-text)]">
                  {balance.formatted} USDC
                </span>
              </p>
              {!canAccept ? (
                <p className="text-[var(--game-danger)]">
                  Not enough balance for the stake. Use the faucet (getFreeDai) or send USDC to this wallet.
                </p>
              ) : (
                <p className="text-[var(--game-cyan)]">Ready to enter — balance OK.</p>
              )}
            </>
          )}
        </div>
      ) : null}

      {joinError ? (
        <p className="rounded-sm border border-[var(--game-danger)]/50 bg-[rgba(255,68,102,0.12)] px-3 py-2 text-sm text-[var(--game-danger)]">
          {joinError}
        </p>
      ) : null}

      <button
        type="button"
        disabled={joinLoading || !canAccept || !balance?.configured}
        onClick={() => void onJoin()}
        className={gameBtnPrimary}
      >
        {joinLoading ? "Saving…" : "Enter the arena"}
      </button>
    </div>
  );
}
