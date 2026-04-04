"use client";

import { type FormEvent, useState } from "react";
import { formatUnits } from "viem";

import { gameBtnPrimary, gameInput, gameLabel, gameMuted, gamePanel, gamePanelTopAccent, gameTitle } from "@/components/game-ui";
import type { TradeCollateralSelection } from "@/types/trade-collateral";

type Props = {
  sessionUsername?: string;
  collateralSelection: TradeCollateralSelection | null;
};

export function OpenTestTradeForm({ sessionUsername, collateralSelection }: Props) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!collateralSelection) return;
    setError(null);
    setTxHash(null);
    setApproveTxHash(null);
    setLoading(true);
    try {
      const res = await fetch("/api/trade/open-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          password,
          collateralAmountRaw: collateralSelection.collateralAmountRaw,
          tokenAddress: collateralSelection.tokenAddress,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        txHash?: string;
        approveTxHash?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Request failed.");
        return;
      }
      if (data.approveTxHash) setApproveTxHash(data.approveTxHash);
      if (data.txHash) setTxHash(data.txHash);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`${gamePanel} ${gamePanelTopAccent} mx-auto w-full max-w-md space-y-4 p-8`}>
      <div className="space-y-2">
        <p className={gameLabel}>Training mode</p>
        <h2 className={`${gameTitle} text-lg sm:text-xl`}>Gains — openTrade test</h2>
        <p className={gameMuted}>
          Dynamic MPC: password signs approve + openTrade. Collateral = “Amount for trade” block (
          <span className="font-[family-name:var(--font-share-tech)] text-[var(--game-cyan)]">
            {collateralSelection
              ? (() => {
                  try {
                    return `${formatUnits(BigInt(collateralSelection.collateralAmountRaw), collateralSelection.decimals)} ${collateralSelection.symbol}`;
                  } catch {
                    return `${collateralSelection.collateralAmountRaw} (${collateralSelection.symbol})`;
                  }
                })()
              : "— pick an amount above —"}
          </span>
          ).
          {sessionUsername ? (
            <>
              {" "}
              Player: <span className="font-semibold text-[var(--game-text)]">{sessionUsername}</span>.
            </>
          ) : null}
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          name="password"
          type="password"
          placeholder="Wallet password (same as sign-up)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={gameInput}
          autoComplete="current-password"
          required
        />
        <button type="submit" disabled={loading || !collateralSelection} className={gameBtnPrimary}>
          {loading ? "Sending…" : "Run test trade"}
        </button>
      </form>
      {error ? (
        <p className="rounded-sm border border-[var(--game-danger)]/50 bg-[rgba(255,68,102,0.12)] px-3 py-2 text-sm text-[var(--game-danger)]">
          {error}
        </p>
      ) : null}
      {approveTxHash ? (
        <p className="break-all font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
          Approve tx: {approveTxHash}
        </p>
      ) : null}
      {txHash ? (
        <p className="break-all font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
          openTrade tx: {txHash}
        </p>
      ) : null}
    </div>
  );
}
