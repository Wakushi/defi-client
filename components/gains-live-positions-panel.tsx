"use client";

import { useCallback, useId, useMemo, useState } from "react";

import {
  gameBtnDanger,
  gameInput,
  gameLabel,
  gameMuted,
  gamePanel,
  gamePanelTopAccent,
} from "@/components/game-ui";
import {
  gainsPositionStreamKey,
  type GainsApiChain,
  type GainsPositionPnlTick,
  type GainsPositionUpdate,
} from "@/types/gains-api";

function isLong(p: GainsPositionUpdate): boolean {
  if (typeof p.long === "boolean") return p.long;
  if (typeof p.isLong === "boolean") return p.isLong;
  return false;
}

function liqPrice(p: GainsPositionUpdate): number | null {
  if (typeof p.liquidationPrice === "number" && Number.isFinite(p.liquidationPrice)) {
    return p.liquidationPrice;
  }
  if (typeof p.liqUsdDecimaled === "number" && Number.isFinite(p.liqUsdDecimaled)) {
    return p.liqUsdDecimaled;
  }
  return null;
}

function fmtUsd(n: number, maxFrac = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(n);
}

function fmtSignedPct(n: number): string {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(2)}%`;
}

type SparklineProps = {
  points: GainsPositionPnlTick[];
  positive: boolean;
  gradientId: string;
};

function PnlSparkline({ points, positive, gradientId }: SparklineProps) {
  const W = 100;
  const H = 36;
  const padX = 1;
  const padY = 3;

  const { lineD, areaD } = useMemo(() => {
    if (points.length < 2) {
      return { lineD: "", areaD: "" };
    }
    const pnls = points.map((p) => p.pnl);
    let minP = Math.min(...pnls);
    let maxP = Math.max(...pnls);
    if (minP === maxP) {
      minP -= 1;
      maxP += 1;
    }
    const innerW = W - 2 * padX;
    const innerH = H - 2 * padY;
    const coords = points.map((pt, i) => {
      const x = padX + (i / (points.length - 1)) * innerW;
      const y = padY + (1 - (pt.pnl - minP) / (maxP - minP)) * innerH;
      return { x, y };
    });
    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(" ");
    const first = coords[0];
    const last = coords[coords.length - 1];
    const area = `${line} L ${last.x.toFixed(2)} ${H - padY} L ${first.x.toFixed(2)} ${H - padY} Z`;
    return { lineD: line, areaD: area };
  }, [points]);

  const stroke = positive ? "var(--game-cyan)" : "var(--game-magenta)";

  if (points.length < 2) {
    return (
      <div
        className="flex h-[52px] items-center justify-center rounded-sm border border-[var(--game-cyan-dim)]/50 bg-[rgba(4,2,12,0.6)] text-[10px] uppercase tracking-wider text-[var(--game-text-muted)]"
        style={{ minHeight: 52 }}
      >
        Collecting ticks…
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-14 w-full overflow-visible"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradientId})`} />
      <path
        d={lineD}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
        className={
          positive
            ? "drop-shadow-[0_0_6px_rgba(65,245,240,0.35)]"
            : "drop-shadow-[0_0_6px_rgba(255,61,154,0.35)]"
        }
      />
    </svg>
  );
}

type CardProps = {
  pos: GainsPositionUpdate;
  history: GainsPositionPnlTick[];
  onCloseMarket: () => void;
  closing: boolean;
  canClose: boolean;
};

function PositionCard({ pos, history, onCloseMarket, closing, canClose }: CardProps) {
  const rawId = useId();
  const gradientId = `pnl-grad-${rawId.replace(/:/g, "")}`;
  const long = isLong(pos);
  const liq = liqPrice(pos);
  const pairLabel = pos.pair?.trim() || `Pair #${pos.pairIndex}`;
  const currentPx =
    typeof pos.currentPriceUsdDecimaled === "number" && Number.isFinite(pos.currentPriceUsdDecimaled)
      ? pos.currentPriceUsdDecimaled
      : null;
  const collateral =
    typeof pos.collateral === "number" && Number.isFinite(pos.collateral) ? pos.collateral : null;
  const pct =
    typeof pos.percentChange === "number" && Number.isFinite(pos.percentChange)
      ? pos.percentChange
      : null;
  const pnlPositive = pos.pnl >= 0;

  return (
    <article
      className={`relative overflow-hidden rounded-sm border-2 border-[var(--game-cyan-dim)] bg-[linear-gradient(165deg,rgba(65,245,240,0.08),rgba(4,2,12,0.92)_45%,rgba(255,61,154,0.05))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-75deg,transparent,transparent_14px,rgba(65,245,240,0.025)_14px,rgba(65,245,240,0.025)_15px)]" />
      <div className="relative flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className={`${gameLabel} !tracking-[0.18em]`}>Live position</p>
            <h3 className="font-[family-name:var(--font-orbitron)] text-base font-bold tracking-wide text-[var(--game-text)] sm:text-lg">
              {pairLabel}
            </h3>
            <p className="mt-0.5 font-[family-name:var(--font-share-tech)] text-[11px] text-[var(--game-text-muted)]">
              {pos.chain ? String(pos.chain) : "—"} · index {pos.index ?? 0}
              {pos.tradeType != null ? ` · type ${pos.tradeType}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <span
              className={`rounded-sm border px-2.5 py-1 font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-wider ${
                long
                  ? "border-[var(--game-cyan)]/60 bg-[rgba(65,245,240,0.12)] text-[var(--game-cyan)]"
                  : "border-[var(--game-magenta)]/60 bg-[rgba(255,61,154,0.12)] text-[var(--game-magenta)]"
              }`}
            >
              {long ? "Long" : "Short"}
            </span>
            <span className="rounded-sm border border-[var(--game-amber)]/50 bg-[rgba(255,200,74,0.1)] px-2.5 py-1 font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-wider text-[var(--game-amber)]">
              {pos.leverage}×
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className={gameLabel}>PnL</p>
            <p
              className={`font-[family-name:var(--font-share-tech)] text-lg font-semibold tabular-nums sm:text-xl ${
                pnlPositive ? "text-[var(--game-cyan)]" : "text-[var(--game-magenta)]"
              }`}
            >
              {pnlPositive ? "+" : ""}
              {fmtUsd(pos.pnl, 4)} USDC
            </p>
            {pct != null ? (
              <p className={`text-xs font-medium tabular-nums ${pct >= 0 ? "text-[var(--game-cyan)]/90" : "text-[var(--game-magenta)]/90"}`}>
                {fmtSignedPct(pct)} session
              </p>
            ) : null}
          </div>
          <div>
            <p className={gameLabel}>Entry</p>
            <p className="font-[family-name:var(--font-share-tech)] text-sm font-medium tabular-nums text-[var(--game-text)]">
              ${fmtUsd(pos.openPrice, 2)}
            </p>
          </div>
          <div>
            <p className={gameLabel}>Mark</p>
            <p className="font-[family-name:var(--font-share-tech)] text-sm font-medium tabular-nums text-[var(--game-text)]">
              {currentPx != null ? `$${fmtUsd(currentPx, 2)}` : "—"}
            </p>
          </div>
          <div>
            <p className={gameLabel}>Collateral</p>
            <p className="font-[family-name:var(--font-share-tech)] text-sm font-medium tabular-nums text-[var(--game-text)]">
              {collateral != null ? `${fmtUsd(collateral, 2)} USDC` : "—"}
            </p>
          </div>
        </div>

        {liq != null ? (
          <p className={`${gameMuted} font-[family-name:var(--font-share-tech)] text-[11px]`}>
            Liquidation ≈ <span className="text-[var(--game-amber)]">${fmtUsd(liq, 2)}</span>
          </p>
        ) : null}

        <div className="space-y-1.5 rounded-sm border border-[var(--game-cyan-dim)]/40 bg-[rgba(0,0,0,0.35)] px-3 py-2">
          <p className={`${gameLabel} !text-[9px]`}>PnL evolution (live)</p>
          <PnlSparkline points={history} positive={pnlPositive} gradientId={gradientId} />
        </div>

        <div className="border-t border-[var(--game-cyan-dim)]/30 pt-3">
          <p className={`${gameMuted} mb-2 text-[11px]`}>
            <code className="text-[var(--game-cyan)]">closeTradeMarket</code>(tradeIndex, expectedPrice) — index{" "}
            <span className="font-[family-name:var(--font-share-tech)] text-[var(--game-text)]">
              {pos.index ?? 0}
            </span>
            , prix mark{" "}
            {currentPx != null ? (
              <span className="font-[family-name:var(--font-share-tech)] text-[var(--game-text)]">
                ${fmtUsd(currentPx, 2)}
              </span>
            ) : (
              "—"
            )}{" "}
            → uint64 1e10
          </p>
          <button
            type="button"
            disabled={!canClose || closing}
            onClick={onCloseMarket}
            className={`${gameBtnDanger} py-2 text-xs`}
          >
            {closing ? "Closing…" : "Close market"}
          </button>
        </div>
      </div>
    </article>
  );
}

export type GainsLivePositionsPanelProps = {
  positions: GainsPositionUpdate[];
  pnlHistoryByKey: ReadonlyMap<string, GainsPositionPnlTick[]>;
  connectionState: "idle" | "connecting" | "open" | "closed" | "error";
  lastWsError: string | null;
  gainsWallet: string | null;
  gainsChain: GainsApiChain;
  /** UUID duel envoyé au WS `subscribe` (stream par match). */
  wsDuelId?: string;
  /** Pour fermeture on-chain si le backup Dynamic est chiffré (wallet ancien). */
  walletPassword?: string;
};

export function GainsLivePositionsPanel({
  positions,
  pnlHistoryByKey,
  connectionState,
  lastWsError,
  gainsWallet,
  gainsChain,
  wsDuelId = "",
  walletPassword = "",
}: GainsLivePositionsPanelProps) {
  const [localClosePassword, setLocalClosePassword] = useState("");
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [closeTx, setCloseTx] = useState<string | null>(null);
  const [closeErr, setCloseErr] = useState<string | null>(null);

  const signingPassword = walletPassword.trim() || localClosePassword.trim();

  const closePosition = useCallback(
    async (pos: GainsPositionUpdate) => {
      const key = gainsPositionStreamKey(pos);
      const mark =
        typeof pos.currentPriceUsdDecimaled === "number" &&
        Number.isFinite(pos.currentPriceUsdDecimaled)
          ? pos.currentPriceUsdDecimaled
          : null;
      if (mark == null) return;

      setCloseErr(null);
      setCloseTx(null);
      setClosingKey(key);
      try {
        const r = await fetch("/api/trade/close-market", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ...(signingPassword ? { password: signingPassword } : {}),
            tradeIndex: pos.index ?? 0,
            currentPriceUsdDecimaled: mark,
          }),
        });
        const data = (await r.json()) as { error?: string; txHash?: string };
        if (!r.ok) {
          setCloseErr(data.error ?? "Close failed.");
          return;
        }
        if (data.txHash) {
          setCloseTx(data.txHash);
        }
      } catch {
        setCloseErr("Network error.");
      } finally {
        setClosingKey(null);
      }
    },
    [signingPassword],
  );

  const cards = useMemo(() => {
    return positions.map((pos) => {
      const key = gainsPositionStreamKey(pos);
      return {
        pos,
        key,
        history: pnlHistoryByKey.get(key) ?? [],
      };
    });
  }, [positions, pnlHistoryByKey]);

  const markReady = (p: GainsPositionUpdate) =>
    typeof p.currentPriceUsdDecimaled === "number" && Number.isFinite(p.currentPriceUsdDecimaled);

  return (
    <div className={`${gamePanel} ${gamePanelTopAccent} relative space-y-4 p-4 text-xs`}>
      <div className="space-y-1">
        <p className={gameLabel}>Gains positions (WebSocket)</p>
        <p className={gameMuted}>
          Socket: {connectionState}
          {gainsWallet ? (
            <span className="text-[var(--game-text-muted)]"> · {gainsWallet.slice(0, 6)}…</span>
          ) : (
            <span className="text-[var(--game-amber)]"> · no wallet on session</span>
          )}
        </p>
      </div>
      {connectionState === "idle" && gainsWallet ? (
        <p className={gameMuted}>
          Set <code className="text-[var(--game-cyan)]">NEXT_PUBLIC_DUEL_DEFI_WS_URL</code> (e.g.{" "}
          <code className="break-all text-[10px] text-[var(--game-text-muted)]">
            ws://46.202.173.162:3001/ws/positions
          </code>
          ) to stream live positions.
        </p>
      ) : null}
      {lastWsError ? <p className="text-sm text-[var(--game-danger)]">{lastWsError}</p> : null}

      {positions.length > 0 && !walletPassword.trim() ? (
        <div className="space-y-2 rounded-sm border border-[var(--game-amber)]/35 bg-[rgba(255,200,74,0.06)] px-3 py-2">
          <p className={`${gameMuted} text-[11px]`}>
            Si la fermeture échoue (déchiffrement Dynamic), saisis le mot de passe wallet une fois ici ou dans le
            champ du dessus.
          </p>
          <label className="block space-y-1">
            <span className={`${gameLabel} !text-[9px]`}>Mot de passe Dynamic (secours)</span>
            <input
              type="password"
              value={localClosePassword}
              onChange={(e) => setLocalClosePassword(e.target.value)}
              placeholder="Optionnel"
              className={gameInput}
              autoComplete="current-password"
            />
          </label>
        </div>
      ) : null}

      {positions.length > 0 ? (
        <>
          {closeErr ? <p className="text-sm text-[var(--game-danger)]">{closeErr}</p> : null}
          {closeTx ? (
            <p className="break-all font-[family-name:var(--font-share-tech)] text-[11px] text-[var(--game-cyan)]">
              Close tx: {closeTx}
            </p>
          ) : null}
        </>
      ) : null}

      {positions.length > 0 ? (
        <ul className="space-y-4">
          {cards.map(({ pos, key, history }, i) => (
            <li key={`${key}-${i}`}>
              <PositionCard
                pos={pos}
                history={history}
                onCloseMarket={() => void closePosition(pos)}
                closing={closingKey === key}
                canClose={markReady(pos)}
              />
            </li>
          ))}
        </ul>
      ) : connectionState === "open" ? (
        <p className={gameMuted}>
          Waiting for position ticks
          {wsDuelId.trim() ? (
            <>
              {" "}
              (<code className="text-[var(--game-cyan)]">subscribe</code> duel{" "}
              <span className="font-[family-name:var(--font-share-tech)] text-[var(--game-text)]">
                {wsDuelId.slice(0, 8)}…
              </span>
              )
            </>
          ) : (
            <> ({gainsChain})</>
          )}
          …
        </p>
      ) : null}
    </div>
  );
}
