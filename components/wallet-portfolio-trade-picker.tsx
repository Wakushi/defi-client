"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";

import {
  gameBtnGhost,
  gameInput,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
  gameTitle,
} from "@/components/game-ui";
import type { MobulaPortfolioPayload, MobulaPortfolioPosition } from "@/types/mobula-portfolio";
import type { TradeCollateralSelection } from "@/types/trade-collateral";

type Props = {
  walletAddress: string;
  onCollateralForTradeChange?: (value: TradeCollateralSelection | null) => void;
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

export function WalletPortfolioTradePicker({
  walletAddress,
  onCollateralForTradeChange,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<MobulaPortfolioPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/portfolio", { credentials: "include" });
      const data = (await res.json()) as MobulaPortfolioPayload & {
        error?: string;
      };
      if (!res.ok) {
        setPayload(null);
        setError(data.error ?? "Failed to load portfolio.");
        return;
      }
      setPayload(data);
      setSelectedId((prev) => {
        if (prev && data.positions.some((p) => p.id === prev)) return prev;
        return data.positions[0]?.id ?? null;
      });
    } catch {
      setPayload(null);
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, walletAddress]);

  const selected = useMemo(
    () => payload?.positions.find((p) => p.id === selectedId) ?? null,
    [payload, selectedId],
  );

  const amountNum = useMemo(() => {
    const t = amount.trim().replace(",", ".");
    if (t === "") return NaN;
    return Number(t);
  }, [amount]);

  const amountOk =
    selected &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    amountNum <= selected.balance * (1 + 1e-9);

  useEffect(() => {
    if (!onCollateralForTradeChange) return;
    if (!amountOk || !selected) {
      onCollateralForTradeChange(null);
      return;
    }
    const dec = selected.decimals ?? 18;
    try {
      const normalized = amount.trim().replace(",", ".");
      const raw = parseUnits(normalized, dec);
      if (raw <= BigInt(0)) {
        onCollateralForTradeChange(null);
        return;
      }
      onCollateralForTradeChange({
        collateralAmountRaw: raw.toString(),
        tokenAddress: selected.tokenAddress,
        decimals: dec,
        symbol: selected.symbol,
      });
    } catch {
      onCollateralForTradeChange(null);
    }
  }, [amountOk, selected, amount, onCollateralForTradeChange]);

  return (
    <div className={`${gamePanel} ${gamePanelTopAccent} mx-auto w-full max-w-md space-y-4 p-8`}>
      <div className="space-y-2">
        <p className={gameLabel}>Inventory</p>
        <h2 className={`${gameTitle} text-lg sm:text-xl`}>
          {payload?.usedOnchainFallback ? "Trade collateral (testnet)" : "Trade collateral (Mobula)"}
        </h2>
        {payload?.usedOnchainFallback ? (
          <p className={gameMuted}>
            <span className="font-semibold text-[var(--game-text)]">USDC / collateral</span> balance read on the
            faucet chain (
            <span className="font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-cyan)]">
              {walletAddress.slice(0, 10)}…
            </span>
            , same token as <span className="font-[family-name:var(--font-share-tech)]">GNS_COLLATERAL_TOKEN_ADDRESS</span>{" "}
            after <span className="font-[family-name:var(--font-share-tech)]">getFreeDai</span>). Mobula does not cover this
            wallet on Arbitrum Sepolia, so this balance is read on-chain here.
          </p>
        ) : (
          <>
            <p className={gameMuted}>
              Balance indexed by Mobula on configured chains (
              <span className="font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-cyan)]">
                {walletAddress.slice(0, 10)}…
              </span>
              ). A USDC swap (Uniswap) can use the asset and amount you pick below.
            </p>
            <p className="text-xs text-[var(--game-text-muted)]">
              On mainnet, set <span className="font-[family-name:var(--font-share-tech)]">MOBULA_BLOCKCHAINS</span> and{" "}
              <span className="font-[family-name:var(--font-share-tech)]">MOBULA_API_KEY</span> to tune chains. On Arbitrum
              Sepolia, if Mobula returns nothing, faucet USDC is shown via RPC (see above when applicable).
            </p>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className={gameMuted}>
          {payload ? (
            <>
              Estimated total:{" "}
              <span className="font-[family-name:var(--font-share-tech)] font-semibold text-[var(--game-cyan)]">
                {formatUsd(payload.totalWalletBalanceUsd)}
              </span>
            </>
          ) : (
            "—"
          )}
        </p>
        <button type="button" onClick={() => void load()} disabled={loading} className={`${gameBtnGhost} !w-auto shrink-0`}>
          Refresh
        </button>
      </div>

      {loading ? (
        <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider`}>
          Loading portfolio…
        </p>
      ) : null}

      {error ? (
        <p className="rounded-sm border border-[var(--game-danger)]/50 bg-[rgba(255,68,102,0.12)] px-3 py-2 text-sm text-[var(--game-danger)]">
          {error}
        </p>
      ) : null}

      {!loading && !error && payload && payload.positions.length === 0 ? (
        <p className={gameMuted}>
          No assets: Mobula returned nothing and on-chain collateral read failed, or{" "}
          <span className="font-mono">GNS_COLLATERAL_TOKEN_ADDRESS</span> /{" "}
          <span className="font-mono">FAUCET_RPC_URL</span> are not set. Check{" "}
          <span className="font-mono">MOBULA_BLOCKCHAINS</span> on mainnet too.
        </p>
      ) : null}

      {!loading && payload && payload.positions.length > 0 ? (
        <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {payload.positions.map((p: MobulaPortfolioPosition) => {
            const checked = p.id === selectedId;
            return (
              <li key={p.id}>
                <label
                  className={`flex cursor-pointer gap-3 rounded-sm border-2 p-3 transition ${
                    checked
                      ? "border-[var(--game-cyan)] bg-[rgba(65,245,240,0.08)] shadow-[0_0_16px_rgba(65,245,240,0.12)]"
                      : "border-[var(--game-cyan-dim)] hover:border-[var(--game-cyan)]/50 hover:bg-[rgba(65,245,240,0.04)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="mobula-asset"
                    className="mt-1"
                    checked={checked}
                    onChange={() => {
                      setSelectedId(p.id);
                      setAmount("");
                    }}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      {p.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.logo}
                          alt=""
                          className="size-7 shrink-0 rounded-full"
                          width={28}
                          height={28}
                        />
                      ) : (
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--game-cyan-dim)] bg-[rgba(4,2,12,0.8)] text-xs font-bold text-[var(--game-cyan)]">
                          {p.symbol.slice(0, 2)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--game-text)]">{p.name}</p>
                        <p className="text-xs text-[var(--game-text-muted)]">
                          {p.symbol}
                          {p.chainLabel ? ` · ${p.chainLabel}` : ` · ${p.chainId}`}
                        </p>
                      </div>
                    </div>
                    <p className="font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]">
                      {formatTokenAmount(p.balance, p.symbol)}
                      {p.estimatedUsd > 0 ? ` · ${formatUsd(p.estimatedUsd)}` : null}
                    </p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      {selected ? (
        <div className="space-y-2 border-t border-[var(--game-cyan-dim)] pt-4">
          <label className="block space-y-2">
            <span className={gameLabel}>Amount for trade</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder={`Max ${selected.balance}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={gameInput}
            />
          </label>
          <button
            type="button"
            onClick={() => setAmount(String(selected.balance))}
            className="text-xs font-semibold uppercase tracking-wide text-[var(--game-magenta)] underline-offset-2 hover:underline"
          >
            Use max balance
          </button>
          {Number.isFinite(amountNum) && amountNum > selected.balance ? (
            <p className="text-xs text-[var(--game-danger)]">
              Amount exceeds balance ({formatTokenAmount(selected.balance, selected.symbol)}).
            </p>
          ) : null}
          {amountOk ? (
            <div className="rounded-sm border border-[var(--game-cyan-dim)] bg-[rgba(65,245,240,0.06)] px-3 py-2 text-xs text-[var(--game-text-muted)]">
              <p className="font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-wider text-[var(--game-cyan)]">
                Selection (preview)
              </p>
              <p className="mt-1 font-[family-name:var(--font-share-tech)] text-[var(--game-text)]">
                {formatTokenAmount(amountNum, selected.symbol)} on {selected.chainLabel ?? selected.chainId}{" "}
                — contract {selected.tokenAddress}
              </p>
              <p className="mt-1 text-[var(--game-text-muted)]">
                {payload?.usedOnchainFallback
                  ? "This amount is used as collateral in “Open test trade” (Gains openTrade)."
                  : "Used as collateral if the token is GNS_COLLATERAL; otherwise swap to USDC on Uniswap first."}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
