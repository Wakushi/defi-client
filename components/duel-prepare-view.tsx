"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GainsPairPicker } from "@/components/gains-pair-picker";
import { useGainsRealtime } from "@/components/gains-realtime-context";
import {
  GameHudBar,
  GameLogo,
  GameVsBanner,
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
import type { GainsApiChain, GainsTradingPair } from "@/types/gains-api";
import type { DuelTradeSideConfig } from "@/types/duel-trade";

const POLL_MS = 1000;
const COUNTDOWN_TOTAL_MS = 3000;

type DuelPayload = {
  id: string;
  creatorPseudo: string;
  opponentPseudo: string | null;
  stakeUsdc: string;
  durationSeconds: number;
  duelFull: boolean;
  viewer: { isCreator: boolean; isOpponent: boolean } | null;
  readyState: [number, number];
  readyBothAt: string | null;
  bothReady: boolean;
  myReady: boolean;
  myTradeConfig: DuelTradeSideConfig | null;
};

function formatUsdc(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n);
}

function countdownNumber(readyBothAtIso: string | null, nowMs: number): number | null {
  if (!readyBothAtIso) return null;
  const t0 = new Date(readyBothAtIso).getTime();
  const elapsed = Math.max(0, nowMs - t0);
  if (elapsed >= COUNTDOWN_TOTAL_MS) return null;
  const sec = Math.floor(elapsed / 1000);
  const n = 3 - sec;
  return n >= 1 ? n : 1;
}

export function DuelPrepareView() {
  const params = useParams();
  const duelId = typeof params.id === "string" ? params.id : "";

  const [duel, setDuel] = useState<DuelPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [pairIndex, setPairIndex] = useState(0);
  const [gainsChain, setGainsChain] = useState<GainsApiChain>("Testnet");
  const [selectedPairLabel, setSelectedPairLabel] = useState("");
  const [leverageX, setLeverageX] = useState(10);
  const [long, setLong] = useState(true);

  const {
    subscribePositions,
    positions,
    connectionState,
    lastWsError,
    walletAddress: gainsWallet,
  } = useGainsRealtime();
  const [readyLoading, setReadyLoading] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  /** Single auto attempt after countdown (avoids double submit). */
  const autoSignStartedRef = useRef(false);
  const passwordRef = useRef(password);
  const txHashRef = useRef(txHash);
  const onExecuteRef = useRef<() => Promise<void>>(async () => {});
  const scheduleSignTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Avoid rescheduling the same `readyBothAt` on every poll. */
  const scheduledForReadyBothAtRef = useRef<string | null>(null);

  passwordRef.current = password;
  txHashRef.current = txHash;

  const loadDuel = useCallback(async () => {
    if (!duelId) return;
    setLoadError(null);
    try {
      const r = await fetch(`/api/duels/${duelId}`, { credentials: "include" });
      const data = (await r.json()) as DuelPayload & { error?: string };
      if (!r.ok) {
        setDuel(null);
        setLoadError(data.error ?? "Duel not found.");
        return;
      }
      setDuel(data);
      if (data.myTradeConfig) {
        setPairIndex(data.myTradeConfig.pairIndex);
        setLeverageX(data.myTradeConfig.leverageX);
        setLong(data.myTradeConfig.long);
        setSelectedPairLabel(`Pair #${data.myTradeConfig.pairIndex}`);
      }

      // Same target instant for both clients: server `readyBothAt` + countdown, not next poll/React tick.
      const v = data.viewer;
      const canSign = Boolean(v && (v.isCreator || v.isOpponent));
      const anchor = data.readyBothAt;
      const alreadyScheduledForAnchor =
        anchor != null &&
        scheduledForReadyBothAtRef.current === anchor &&
        (scheduleSignTimeoutRef.current !== null || autoSignStartedRef.current);
      if (
        data.bothReady &&
        anchor &&
        canSign &&
        !txHashRef.current &&
        passwordRef.current.trim() &&
        !alreadyScheduledForAnchor
      ) {
        scheduledForReadyBothAtRef.current = anchor;
        if (scheduleSignTimeoutRef.current) {
          clearTimeout(scheduleSignTimeoutRef.current);
          scheduleSignTimeoutRef.current = null;
        }
        const fireAt = new Date(anchor).getTime() + COUNTDOWN_TOTAL_MS;
        const delay = Math.max(0, fireAt - Date.now());
        scheduleSignTimeoutRef.current = setTimeout(() => {
          scheduleSignTimeoutRef.current = null;
          if (txHashRef.current || autoSignStartedRef.current) return;
          if (!passwordRef.current.trim()) return;
          autoSignStartedRef.current = true;
          void onExecuteRef.current();
        }, delay);
      }
    } catch {
      setDuel(null);
      setLoadError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [duelId]);

  useEffect(() => {
    void loadDuel();
  }, [loadDuel]);

  useEffect(() => {
    return () => {
      if (scheduleSignTimeoutRef.current) {
        clearTimeout(scheduleSignTimeoutRef.current);
        scheduleSignTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    scheduledForReadyBothAtRef.current = null;
    autoSignStartedRef.current = false;
    if (scheduleSignTimeoutRef.current) {
      clearTimeout(scheduleSignTimeoutRef.current);
      scheduleSignTimeoutRef.current = null;
    }
  }, [duelId]);

  const participant =
    duel?.viewer && (duel.viewer.isCreator || duel.viewer.isOpponent);

  useEffect(() => {
    if (!duel?.duelFull || !participant) return;
    const id = setInterval(() => void loadDuel(), POLL_MS);
    return () => clearInterval(id);
  }, [duel?.duelFull, participant, loadDuel]);

  useEffect(() => {
    if (!duel?.bothReady || !duel.readyBothAt) return;
    const t0 = new Date(duel.readyBothAt).getTime();
    if (Date.now() - t0 >= COUNTDOWN_TOTAL_MS) return;
    const id = setInterval(() => setNowTick(Date.now()), 100);
    return () => clearInterval(id);
  }, [duel?.bothReady, duel?.readyBothAt]);

  useEffect(() => {
    if (!duel?.bothReady || !participant) return;
    subscribePositions(gainsChain);
  }, [duel?.bothReady, participant, gainsChain, subscribePositions]);

  const cd = useMemo(() => {
    if (!duel?.bothReady || !duel.readyBothAt) return null;
    return countdownNumber(duel.readyBothAt, nowTick);
  }, [duel?.bothReady, duel?.readyBothAt, nowTick]);

  const countdownFinished = useMemo(() => {
    if (!duel?.bothReady || !duel.readyBothAt) return false;
    return nowTick - new Date(duel.readyBothAt).getTime() >= COUNTDOWN_TOTAL_MS;
  }, [duel?.bothReady, duel?.readyBothAt, nowTick]);

  async function onMarkReady() {
    if (!duelId) return;
    if (!password.trim()) {
      setReadyError("Enter your wallet password before marking ready (it stays in your browser).");
      return;
    }
    setReadyError(null);
    setReadyLoading(true);
    try {
      const res = await fetch(`/api/duels/${duelId}/trade-ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          pairIndex,
          leverageX,
          long,
          tradeType: 0,
        } satisfies DuelTradeSideConfig),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setReadyError(data.error ?? "Failed.");
        return;
      }
      await loadDuel();
    } catch {
      setReadyError("Network error.");
    } finally {
      setReadyLoading(false);
    }
  }

  const onExecute = useCallback(async () => {
    if (!duelId || !password.trim()) return;
    subscribePositions(gainsChain);
    setExecError(null);
    setExecLoading(true);
    try {
      const res = await fetch(`/api/duels/${duelId}/execute-trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { error?: string; txHash?: string };
      if (!res.ok) {
        setExecError(data.error ?? "Failed.");
        return;
      }
      if (data.txHash) {
        setTxHash(data.txHash);
        setPassword("");
      }
    } catch {
      setExecError("Network error.");
    } finally {
      setExecLoading(false);
    }
  }, [duelId, password, gainsChain, subscribePositions]);

  onExecuteRef.current = onExecute;

  function onRetrySign() {
    autoSignStartedRef.current = false;
    void onExecute();
  }

  if (!duelId) {
    return (
      <>
        <GameHudBar>
          <GameLogo className="!text-sm" />
        </GameHudBar>
        <p className="p-8 text-sm text-[var(--game-danger)]">Missing duel id.</p>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <GameHudBar>
          <Link href="/" className="shrink-0">
            <GameLogo className="!text-sm sm:!text-base" />
          </Link>
        </GameHudBar>
        <main className="mx-auto max-w-lg flex-1 px-4 py-16">
          <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-widest`}>
            Loading…
          </p>
        </main>
      </>
    );
  }

  if (loadError || !duel) {
    return (
      <>
        <GameHudBar>
          <Link href="/" className="shrink-0">
            <GameLogo className="!text-sm sm:!text-base" />
          </Link>
        </GameHudBar>
        <main className="mx-auto max-w-lg flex-1 space-y-4 px-4 py-16">
          <p className="text-sm text-[var(--game-danger)]">{loadError ?? "Not found."}</p>
          <Link href="/" className={gameLink}>
            Back to hub
          </Link>
        </main>
      </>
    );
  }

  if (!duel.duelFull) {
    return (
      <>
        <GameHudBar>
          <Link href="/" className="shrink-0">
            <GameLogo className="!text-sm sm:!text-base" />
          </Link>
        </GameHudBar>
        <main className="mx-auto max-w-lg flex-1 space-y-4 px-4 py-16">
          <p className={gameMuted}>This duel does not have two players yet.</p>
          <Link href={`/duel/${duelId}`} className={gameLink}>
            Back to lobby
          </Link>
        </main>
      </>
    );
  }

  if (!participant) {
    return (
      <>
        <GameHudBar>
          <Link href="/" className="shrink-0">
            <GameLogo className="!text-sm sm:!text-base" />
          </Link>
        </GameHudBar>
        <main className="mx-auto max-w-lg flex-1 space-y-4 px-4 py-16">
          <p className={gameMuted}>You are not in this duel.</p>
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
        <p className="hidden font-[family-name:var(--font-orbitron)] text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--game-text-muted)] sm:block">
          Combat loadout
        </p>
      </GameHudBar>

      <main className="mx-auto flex max-w-lg flex-1 flex-col gap-6 px-4 py-10 sm:py-14">
        <div className="space-y-3">
          <p className={gameSubtitle}>Trade prep</p>
          <h1 className={`${gameTitle} !text-xl sm:!text-2xl`}>Gains setup</h1>
          <GameVsBanner
            left={duel.creatorPseudo}
            right={duel.opponentPseudo ?? "—"}
            leftTag="Creator"
            rightTag="Opponent"
          />
          <p className={gameMuted}>
            Stake: {formatUsdc(duel.stakeUsdc)} USDC each · duration {Math.round(duel.durationSeconds / 60)} min
          </p>
        </div>

        <div className={`${gamePanel} ${gamePanelTopAccent} space-y-3 p-6 text-sm`}>
          <p className="font-[family-name:var(--font-share-tech)] text-[var(--game-cyan)]">
            Ready status [{duel.readyState[0]}, {duel.readyState[1]}]{" "}
            <span className="text-[var(--game-text-muted)]">· creator, opponent</span>
          </p>
          <p className={gameMuted}>
            Enter your wallet password <span className="font-semibold text-[var(--game-text)]">before</span> marking
            ready. Countdown 3 → 1 then{" "}
            <span className="font-semibold text-[var(--game-magenta)]">auto-sign</span> on both sides.
          </p>
        </div>

        <div className={`${gamePanel} space-y-2 p-4 text-xs`}>
          <p className={gameLabel}>Gains positions (WebSocket)</p>
          <p className={gameMuted}>
            Socket: {connectionState}
            {gainsWallet ? (
              <span className="text-[var(--game-text-muted)]"> · {gainsWallet.slice(0, 6)}…</span>
            ) : (
              <span className="text-[var(--game-amber)]"> · no wallet on session</span>
            )}
          </p>
          {connectionState === "idle" && gainsWallet ? (
            <p className={gameMuted}>
              Set <code className="text-[var(--game-cyan)]">NEXT_PUBLIC_DUEL_DEFI_WS_URL</code> (e.g.{" "}
              <code className="break-all text-[10px] text-[var(--game-text-muted)]">
                ws://46.202.173.162:3001/ws/positions
              </code>
              ) to stream live positions.
            </p>
          ) : null}
          {lastWsError ? (
            <p className="text-[var(--game-danger)]">{lastWsError}</p>
          ) : null}
          {positions.length > 0 ? (
            <ul className="max-h-36 space-y-1 overflow-y-auto font-[family-name:var(--font-share-tech)] text-[var(--game-text)]">
              {positions.map((pos, i) => (
                <li key={`${pos.pairIndex}-${i}`} className="border-b border-[var(--game-cyan-dim)]/40 py-1">
                  Pair {pos.pairIndex} · {pos.long ? "long" : "short"} · {pos.leverage}× · entry{" "}
                  {pos.openPrice} · PnL {pos.pnl} · liq {pos.liquidationPrice}
                </li>
              ))}
            </ul>
          ) : connectionState === "open" ? (
            <p className={gameMuted}>Waiting for position ticks (subscribe sent for {gainsChain})…</p>
          ) : null}
        </div>

        {!duel.myReady ? (
          <div className={`${gamePanel} space-y-4 p-6`}>
            <h2 className="font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase tracking-wider text-[var(--game-magenta)]">
              Your settings
            </h2>
            <label className="block space-y-2">
              <span className={gameLabel}>Wallet password (Dynamic)</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Used to sign after countdown"
                className={gameInput}
                autoComplete="current-password"
              />
            </label>
            <div className="space-y-2">
              <span className={gameLabel}>Trading pair</span>
              <GainsPairPicker
                chain={gainsChain}
                onChainChange={(c) => {
                  setGainsChain(c);
                  setPairIndex(0);
                  setSelectedPairLabel("");
                }}
                selectedPairIndex={pairIndex}
                onSelectPair={(p: GainsTradingPair) => {
                  setPairIndex(p.pairIndex);
                  setSelectedPairLabel(p.name);
                }}
              />
            </div>
            <label className="block space-y-2">
              <span className={gameLabel}>Leverage (×)</span>
              <input
                type="number"
                min={1}
                max={500}
                value={leverageX}
                onChange={(e) => setLeverageX(Number.parseInt(e.target.value, 10) || 1)}
                className={gameInput}
              />
            </label>
            <label className="flex cursor-pointer items-center gap-3 text-sm text-[var(--game-text)]">
              <input
                type="checkbox"
                checked={long}
                onChange={(e) => setLong(e.target.checked)}
                className="size-4 accent-[var(--game-cyan)]"
              />
              <span>Long (uncheck for short)</span>
            </label>
            {readyError ? (
              <p className="text-sm text-[var(--game-danger)]">{readyError}</p>
            ) : null}
            <button
              type="button"
              disabled={readyLoading || !password.trim()}
              onClick={() => void onMarkReady()}
              className={gameBtnPrimary}
            >
              {readyLoading ? "Sending…" : "Mark ready — GO"}
            </button>
          </div>
        ) : (
          <div className="rounded-sm border-2 border-[var(--game-cyan)]/40 bg-[rgba(65,245,240,0.08)] px-4 py-4 text-sm">
            <p className="font-[family-name:var(--font-orbitron)] text-xs font-bold uppercase tracking-wider text-[var(--game-cyan)]">
              Ready locked in
            </p>
            <p className={`${gameMuted} mt-1`}>
              {selectedPairLabel || `Pair #${pairIndex}`} · {gainsChain} · {leverageX}× ·{" "}
              {long ? "Long" : "Short"} · password kept for auto-sign
            </p>
          </div>
        )}

        {duel.myReady && !duel.bothReady ? (
          <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-[0.2em] text-[var(--game-amber)]`}>
            Waiting for opponent…
          </p>
        ) : null}

        {duel.bothReady && cd !== null ? (
          <div className="game-countdown-overlay fixed inset-0 z-50 flex flex-col items-center justify-center">
            <p className="mb-6 font-[family-name:var(--font-orbitron)] text-[10px] font-black uppercase tracking-[0.5em] text-[var(--game-magenta)] [text-shadow:0_0_16px_rgba(255,61,154,0.6)]">
              Engage
            </p>
            <p className="game-countdown-num tabular-nums">{cd}</p>
            <p className="mt-8 font-[family-name:var(--font-orbitron)] text-[10px] font-bold uppercase tracking-[0.35em] text-[var(--game-text-muted)]">
              Positions will open
            </p>
          </div>
        ) : null}

        {duel.bothReady && countdownFinished ? (
          <div className={`${gamePanel} ${gamePanelTopAccent} space-y-4 p-6`}>
            <h2 className="font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-[var(--game-amber)]">
              Trade launch
            </h2>
            {execLoading && !txHash ? (
              <p className={gameMuted}>Signing in progress (password entered above)…</p>
            ) : null}
            {!execLoading && !txHash && !execError ? (
              <p className={gameMuted}>Auto-starting…</p>
            ) : null}
            {execError ? (
              <div className="space-y-3">
                <p className="text-sm text-[var(--game-danger)]">{execError}</p>
                <label className="block space-y-2">
                  <span className={gameLabel}>Corriger le mot de passe</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={gameInput}
                    autoComplete="current-password"
                  />
                </label>
                <button
                  type="button"
                  disabled={execLoading || !password.trim()}
                  onClick={() => void onRetrySign()}
                  className="w-full rounded-sm border-2 border-[var(--game-magenta)] bg-transparent py-2.5 text-sm font-bold uppercase tracking-wider text-[var(--game-magenta)] transition enabled:hover:bg-[rgba(255,61,154,0.12)] disabled:opacity-50"
                >
                  Retry signing
                </button>
              </div>
            ) : null}
            {txHash ? (
              <p className="break-all font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-cyan)]">
                Tx : {txHash}
              </p>
            ) : null}
          </div>
        ) : null}

        <Link href={`/duel/${duelId}`} className={`${gameLink} text-center`}>
          ← Back to lobby
        </Link>
      </main>
    </>
  );
}
