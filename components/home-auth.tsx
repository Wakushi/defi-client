"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  gameBtnGhost,
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
import { OpenTestTradeForm } from "@/components/open-test-trade";
import { WalletPortfolioTradePicker } from "@/components/wallet-portfolio-trade-picker";
import { SignupForm } from "@/components/signup-form";
import type { TradeCollateralSelection } from "@/types/trade-collateral";

type MeUser = {
  id: string;
  username: string;
  walletAddress: string | null;
};

export function HomeAuth() {
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [tradeCollateral, setTradeCollateral] = useState<TradeCollateralSelection | null>(null);

  const prevWalletRef = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/auth/me", { credentials: "include" });
    const data = (await r.json()) as { user: MeUser | null };
    setUser(data.user ?? null);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- initial /api/auth/me load */
  useEffect(() => {
    let cancelled = false;
    void refresh().finally(() => {
      if (!cancelled) queueMicrotask(() => setLoading(false));
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const walletKey = user?.walletAddress ?? null;
  useEffect(() => {
    if (prevWalletRef.current !== undefined && prevWalletRef.current !== walletKey) {
      queueMicrotask(() => setTradeCollateral(null));
    }
    prevWalletRef.current = walletKey;
  }, [walletKey]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }

  if (loading) {
    return (
      <p className={`${gameMuted} text-center font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-widest`}>
        Loading…
      </p>
    );
  }

  if (user) {
    return (
      <div className="flex w-full max-w-md flex-col gap-8">
        <div className={`${gamePanel} ${gamePanelTopAccent} space-y-4 p-8`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={gameLabel}>Signed in</p>
              <p className={`${gameTitle} mt-1 text-xl sm:text-2xl`}>{user.username}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-start">
              <Link href="/duel/new" className={`${gameBtnPrimary} !w-auto px-4 py-2 text-xs`}>
                New duel
              </Link>
              <button type="button" onClick={() => void logout()} className={`${gameBtnGhost} !w-auto`}>
                Log out
              </button>
            </div>
          </div>
          {user.walletAddress ? (
            <div className="space-y-1 border-t border-[var(--game-cyan-dim)] pt-4">
              <p className={gameLabel}>Wallet</p>
              <p className="break-all font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-cyan)]">
                {user.walletAddress}
              </p>
            </div>
          ) : null}
        </div>
        {user.walletAddress ? (
          <WalletPortfolioTradePicker
            walletAddress={user.walletAddress}
            onCollateralForTradeChange={setTradeCollateral}
          />
        ) : null}
        <OpenTestTradeForm
          sessionUsername={user.username}
          collateralSelection={user.walletAddress ? tradeCollateral : null}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className={gameTabRow}>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 rounded-sm py-2.5 text-xs font-bold uppercase tracking-wider transition ${gameTabActive(mode === "signup")}`}
        >
          Sign up
        </button>
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded-sm py-2.5 text-xs font-bold uppercase tracking-wider transition ${gameTabActive(mode === "login")}`}
        >
          Log in
        </button>
      </div>
      {mode === "signup" ? (
        <SignupForm onSuccess={() => void refresh()} />
      ) : (
        <LoginForm onSuccess={() => void refresh()} />
      )}
    </div>
  );
}
