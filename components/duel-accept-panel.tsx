"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseUnits } from "viem";

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
import { SignupForm } from "@/components/signup-form";
import { duelVsBannerForViewer } from "@/lib/duel/viewer-vs-order";
import type { GainsApiChain } from "@/types/gains-api";

type DuelApi = {
  id: string;
  creatorPseudo: string;
  opponentPseudo: string | null;
  stakeUsdc: string;
  durationSeconds: number;
  createdAt: string;
  duelFull: boolean;
  viewer: { isCreator: boolean; isOpponent: boolean } | null;
  playMode?: "friendly" | "duel";
  creatorChain?: string | null;
  opponentChain?: string | null;
  duelLiveAt?: string | null;
  duelClosedAt?: string | null;
  myTradeOpened?: boolean;
  myOpenTradeTxHash?: string | null;
};

function opponentCollateralGainsChain(d: DuelApi | null): GainsApiChain | undefined {
  const c = d?.opponentChain;
  if (c === "Testnet" || c === "Arbitrum" || c === "Base") return c;
  return undefined;
}

function chainLabelForStakeUi(chain?: string | null): string {
  if (chain === "Arbitrum") return "Arbitrum One";
  if (chain === "Testnet") return "Arbitrum Sepolia (testnet)";
  if (chain === "Base") return "Base";
  return "this duel’s chain";
}

function joinRequirementLabel(d: DuelApi): string {
  if (d.playMode === "duel") {
    return "your wallet (total estimated in USD, indexed by Mobula)";
  }
  return chainLabelForStakeUi(d.opponentChain);
}

function formatUsdEstimate(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1 ? 2 : 6,
  }).format(n);
}

const STAKE_USD_EPS = 1e-6;

type BalanceApi = {
  kind: "collateral" | "portfolio_usd";
  configured: boolean;
  balanceRaw?: string;
  totalUsd?: number;
  decimals?: number;
  formatted?: string;
  error?: string;
};

type Props = { duelId: string };

const LOBBY_POLL_MS = 1000;
/** Relectures du solde après tx faucet (mise en chaine). */
const BALANCE_POLL_INTERVAL_MS = 1500;
const BALANCE_POLL_MAX_ATTEMPTS = 45;

function formatUsdcLabel(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n);
}

export function DuelAcceptPanel({ duelId }: Props) {
  const router = useRouter();
  const prepRedirectedRef = useRef(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [duel, setDuel] = useState<DuelApi | null>(null);
  const [duelError, setDuelError] = useState<string | null>(null);
  const [duelLoading, setDuelLoading] = useState(true);
  const [balance, setBalance] = useState<BalanceApi | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  /** Après inscription : pourquoi le compte n’a peut‑être pas reçu d’USDC test automatiquement. */
  const [fundingNotice, setFundingNotice] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [confirmingUsdc, setConfirmingUsdc] = useState(false);
  /** Après polling : le RPC voit bien assez d’USDC pour la mise. */
  const [balanceCoversStake, setBalanceCoversStake] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Évite que le useEffect balance n’écrase le solde pendant le polling post-faucet. */
  const balancePollInProgressRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  const loadDuel = useCallback(async (opts?: { silent?: boolean }): Promise<DuelApi | null> => {
    const silent = opts?.silent === true;
    setDuelError(null);
    if (!silent) setDuelLoading(true);
    try {
      const r = await fetch(`/api/duels/${duelId}`, { credentials: "include" });
      const data = (await r.json()) as DuelApi & { error?: string };
      if (!r.ok) {
        setDuel(null);
        setDuelError(data.error ?? "Duel not found.");
        return null;
      }
      setDuel(data);
      return data;
    } catch {
      setDuel(null);
      setDuelError("Network error.");
      return null;
    } finally {
      if (!silent) setDuelLoading(false);
    }
  }, [duelId]);

  const fetchCollateralBalance = useCallback(
    async (gainsChain?: string): Promise<BalanceApi | null> => {
      try {
        const q =
          gainsChain === "Testnet" ||
          gainsChain === "Arbitrum" ||
          gainsChain === "Base"
            ? `?gainsChain=${encodeURIComponent(gainsChain)}`
            : "";
        const r = await fetch(`/api/wallet/collateral-balance${q}`, {
          credentials: "include",
        });
        const data = (await r.json()) as {
          configured?: boolean;
          balanceRaw?: string;
          decimals?: number;
          formatted?: string;
          error?: string;
        };
        if (r.status === 401) {
          return {
            kind: "collateral" as const,
            configured: false,
            error: "Session expired — sign in again.",
          };
        }
        return {
          kind: "collateral" as const,
          configured: Boolean(data.configured),
          balanceRaw: data.balanceRaw,
          decimals: data.decimals,
          formatted: data.formatted,
          error: data.error,
        };
      } catch {
        return { kind: "collateral" as const, configured: false, error: "Network error." };
      }
    },
    [],
  );

  const fetchPortfolioUsd = useCallback(async (): Promise<BalanceApi | null> => {
    try {
      const r = await fetch("/api/wallet/portfolio?playMode=duel", {
        credentials: "include",
      });
      const data = (await r.json()) as {
        totalWalletBalanceUsd?: number;
        error?: string;
      };
      if (r.status === 401) {
        return {
          kind: "portfolio_usd",
          configured: false,
          error: "Session expired — sign in again.",
        };
      }
      if (!r.ok) {
        return {
          kind: "portfolio_usd",
          configured: false,
          error: data.error ?? "Could not load portfolio.",
        };
      }
      const total = data.totalWalletBalanceUsd;
      if (typeof total !== "number" || !Number.isFinite(total)) {
        return {
          kind: "portfolio_usd",
          configured: false,
          error: "Portfolio response missing USD total.",
        };
      }
      return {
        kind: "portfolio_usd",
        configured: true,
        totalUsd: total,
        formatted: formatUsdEstimate(total),
      };
    } catch {
      return { kind: "portfolio_usd", configured: false, error: "Network error." };
    }
  }, []);

  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalance(null);
    try {
      if (duel?.playMode === "duel") {
        const b = await fetchPortfolioUsd();
        if (b) setBalance(b);
      } else {
        const b = await fetchCollateralBalance(opponentCollateralGainsChain(duel));
        if (b) setBalance(b);
      }
    } finally {
      setBalanceLoading(false);
    }
  }, [fetchCollateralBalance, fetchPortfolioUsd, duel]);

  const pollBalanceUntilStake = useCallback(
    async (stakeUsdc: string, contextDuel: DuelApi | null) => {
      const stakeN = Number(stakeUsdc);
      let need: bigint;
      try {
        need = parseUnits(stakeUsdc, 6);
      } catch {
        return;
      }

      pollAbortRef.current?.abort();
      const ctrl = new AbortController();
      pollAbortRef.current = ctrl;

      setConfirmingUsdc(true);
      setBalanceLoading(true);
      setBalanceCoversStake(false);
      const isDuel = contextDuel?.playMode === "duel";
      try {
        for (let i = 0; i < BALANCE_POLL_MAX_ATTEMPTS; i++) {
          if (ctrl.signal.aborted) return;

          if (isDuel) {
            const b = await fetchPortfolioUsd();
            if (b) setBalance(b);
            if (
              b?.configured &&
              b.totalUsd != null &&
              Number.isFinite(stakeN) &&
              b.totalUsd + STAKE_USD_EPS >= stakeN
            ) {
              setFundingNotice(null);
              setBalanceCoversStake(true);
              return;
            }
          } else {
            const b = await fetchCollateralBalance(
              opponentCollateralGainsChain(contextDuel),
            );
            if (b) setBalance(b);

            if (b?.configured && b.balanceRaw !== undefined && b.balanceRaw !== "") {
              try {
                if (BigInt(b.balanceRaw) >= need) {
                  setFundingNotice(null);
                  setBalanceCoversStake(true);
                  return;
                }
              } catch {
                /* ignore */
              }
            }
          }

          if (i >= BALANCE_POLL_MAX_ATTEMPTS - 1) break;

          try {
            await new Promise<void>((resolve, reject) => {
              const tid = setTimeout(resolve, BALANCE_POLL_INTERVAL_MS);
              ctrl.signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(tid);
                  reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            });
          } catch {
            return;
          }
        }
      } finally {
        setBalanceLoading(false);
        setConfirmingUsdc(false);
        if (pollAbortRef.current === ctrl) {
          pollAbortRef.current = null;
        }
      }
    },
    [fetchCollateralBalance, fetchPortfolioUsd],
  );

  useEffect(() => {
    prepRedirectedRef.current = false;
  }, [duelId]);

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, [duelId]);

  useEffect(() => {
    void loadDuel();
  }, [loadDuel]);

  const creatorWaitingOpponent =
    Boolean(duel?.viewer?.isCreator) && duel && !duel.duelFull;

  useEffect(() => {
    if (!creatorWaitingOpponent) return;
    const id = setInterval(() => void loadDuel({ silent: true }), LOBBY_POLL_MS);
    return () => clearInterval(id);
  }, [creatorWaitingOpponent, loadDuel]);

  useEffect(() => {
    if (!duel?.duelFull || prepRedirectedRef.current) return;
    const v = duel.viewer;
    if (!v?.isCreator && !v?.isOpponent) return;
    prepRedirectedRef.current = true;
    router.replace(`/duel/${duelId}/prepare`);
  }, [duel?.duelFull, duel?.viewer, duelId, router]);

  const shouldLoadBalance =
    duel?.viewer &&
    !duel.viewer.isCreator &&
    !duel.viewer.isOpponent &&
    !duel.duelFull;

  useEffect(() => {
    if (!shouldLoadBalance) return;
    if (balancePollInProgressRef.current) return;
    void loadBalance();
  }, [shouldLoadBalance, loadBalance, duel?.opponentChain, duel?.playMode]);

  // Fetch wallet address for display
  useEffect(() => {
    if (!shouldLoadBalance) return;
    void (async () => {
      try {
        const r = await fetch("/api/auth/me", { credentials: "include" });
        const data = (await r.json()) as { user?: { walletAddress?: string } };
        if (data.user?.walletAddress) setWalletAddress(data.user.walletAddress);
      } catch { /* ignore */ }
    })();
  }, [shouldLoadBalance]);


  const canAccept = useMemo(() => {
    if (!duel || !balance?.configured) return false;
    const stakeN = Number(duel.stakeUsdc);
    if (balance.kind === "portfolio_usd") {
      return (
        balance.totalUsd != null &&
        Number.isFinite(stakeN) &&
        balance.totalUsd + STAKE_USD_EPS >= stakeN
      );
    }
    if (balance.balanceRaw === undefined || balance.balanceRaw === "") return false;
    try {
      const need = parseUnits(duel.stakeUsdc, 6);
      return BigInt(balance.balanceRaw) >= need;
    } catch {
      return false;
    }
  }, [duel, balance]);

  // Auto-refresh balance every 10s while insufficient
  useEffect(() => {
    if (!shouldLoadBalance || canAccept || balancePollInProgressRef.current) return;
    const id = setInterval(() => void loadBalance(), 10_000);
    return () => clearInterval(id);
  }, [shouldLoadBalance, canAccept, loadBalance]);

  async function onClaimFaucet() {
    if (duel?.playMode === "duel") return;
    setClaimError(null);
    setFundingNotice(null);
    setBalanceCoversStake(false);
    setClaimLoading(true);
    try {
      const r = await fetch("/api/wallet/claim-faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setClaimError(data.error ?? "Faucet failed.");
        return;
      }
      const stake = duel?.stakeUsdc;
      if (!stake) return;
      balancePollInProgressRef.current = true;
      try {
        await pollBalanceUntilStake(stake, duel);
      } finally {
        balancePollInProgressRef.current = false;
      }
    } catch {
      setClaimError("Network error.");
    } finally {
      setClaimLoading(false);
    }
  }

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
      await loadDuel({ silent: true });
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
            Sign in or create an account. Stake:{" "}
            <span className="font-medium text-[var(--game-cyan)]">
              {formatUsdcLabel(duel.stakeUsdc)} USDC
            </span>{" "}
            per player.{" "}
            {duel.playMode === "duel" ? (
              <>
                Duel mode — we check that{" "}
                <span className="text-[var(--game-cyan)]">{joinRequirementLabel(duel)}</span> covers
                at least that amount in USD. Each player picks Arbitrum or Base during trade
                preparation.
              </>
            ) : (
              <>
                Friendly mode — you need USDC on{" "}
                <span className="text-[var(--game-cyan)]">{joinRequirementLabel(duel)}</span>. You can
                use the test faucet if your balance is too low.
              </>
            )}
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
          <LoginForm
            onSuccess={async () => {
              setFundingNotice(null);
              setBalanceCoversStake(false);
              await loadDuel();
              void loadBalance();
            }}
          />
        ) : (
          <SignupForm
            onSuccess={async (info) => {
              setFundingNotice(null);
              setBalanceCoversStake(false);
              if (info?.faucetStatus === "not_configured") {
                setFundingNotice(
                  "The server does not have the USDC faucet configured (USDC_FAUCET_CONTRACT_ADDRESS, FAUCET_RPC_URL, FAUCET_CHAIN_ID). Send test USDC manually on the faucet chain to the wallet address shown after signup, or set these variables.",
                );
              } else if (info?.faucetStatus === "failed") {
                setFundingNotice(
                  `Automatic faucet failed (often: no native gas — set PRIVATE_KEY_GAS_DISPATCHER on the server, or wrong RPC/contract). Detail: ${info.faucetError ?? "unknown error"}`,
                );
              }

              const willPoll = info?.faucetStatus === "sent";
              if (willPoll) {
                balancePollInProgressRef.current = true;
              }
              try {
                const d = await loadDuel();
                if (willPoll && d?.stakeUsdc && d.playMode !== "duel") {
                  await pollBalanceUntilStake(d.stakeUsdc, d);
                } else {
                  void loadBalance();
                }
              } finally {
                if (willPoll) {
                  balancePollInProgressRef.current = false;
                }
              }
            }}
          />
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
          Send the link to your opponent: they sign in, then accept. Stake:{" "}
          {formatUsdcLabel(duel.stakeUsdc)} USDC.{" "}
          {duel.playMode === "duel" ? (
            <>
              Duel mode — the guest needs estimated portfolio value ≥ this stake (USD, Mobula).
              Trade chains (Arbitrum / Base) are chosen at preparation.
            </>
          ) : (
            <>
              Friendly mode — they need testnet USDC on{" "}
              <span className="text-[var(--game-cyan)]">{joinRequirementLabel(duel)}</span>.
            </>
          )}
        </p>
        {!duel.duelFull ? (
          <p
            className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider text-[var(--game-amber)]`}
          >
            Waiting for opponent… (checking every second)
          </p>
        ) : (
          <p className={`${gameMuted} text-xs`}>Opening trade prep…</p>
        )}
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
        <p className={`${gameMuted} text-xs`}>Opening trade prep…</p>
      </div>
    );
  }

  if (duel.duelFull) {
    const lockedVs = duelVsBannerForViewer(
      duel.creatorPseudo,
      duel.opponentPseudo,
      duel.viewer,
      "?",
    );
    return (
      <div className={`${gamePanel} border-[var(--game-magenta-dim)] p-6`}>
        <p className={gameLabel}>Match locked</p>
        <p className="font-[family-name:var(--font-orbitron)] text-sm font-bold text-[var(--game-text)]">
          {lockedVs.left} <span className="text-[var(--game-amber)]">VS</span> {lockedVs.right}
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
          .{" "}
          {duel.playMode === "duel" ? (
            <>
              Duel mode — requirement: estimated portfolio total ≥ this stake (USD). Trade chain
              chosen later (Arbitrum or Base).
            </>
          ) : (
            <>
              Friendly mode — on{" "}
              <span className="text-[var(--game-cyan)]">{joinRequirementLabel(duel)}</span>.
            </>
          )}
        </p>
      </div>

      {fundingNotice ? (
        <p className="rounded-sm border border-[var(--game-amber)]/50 bg-[rgba(255,200,74,0.1)] px-3 py-2 text-xs text-[var(--game-amber)]">
          {fundingNotice}
        </p>
      ) : null}

      {balanceCoversStake ? (
        <p className="rounded-sm border border-[var(--game-cyan)]/40 bg-[rgba(65,245,240,0.1)] px-3 py-2 text-sm font-medium text-[var(--game-cyan)]">
          Balance updated: USDC is visible on-chain for this stake — you can enter the arena.
        </p>
      ) : null}

      {balanceLoading && !confirmingUsdc ? (
        <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider`}>
          Reading balance…
        </p>
      ) : null}

      {confirmingUsdc ? (
        <p
          className={`${gameMuted} rounded-sm border border-[var(--game-cyan)]/35 bg-[rgba(65,245,240,0.08)] px-3 py-2 font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider text-[var(--game-cyan)]`}
        >
          Syncing USDC balance on-chain — faucet transaction confirming…
        </p>
      ) : null}

      {balance && (!balanceLoading || confirmingUsdc) ? (
        <div className={`space-y-2 text-sm ${gameMuted}`}>
          {!balance.configured ? (
            <p className="rounded-sm border border-[var(--game-amber)]/40 bg-[rgba(255,200,74,0.1)] px-3 py-2 text-[var(--game-amber)]">
              {balance.error ??
                "Balance unavailable — check FAUCET_RPC_URL and GNS_COLLATERAL_TOKEN_ADDRESS."}
            </p>
          ) : (
            <>
              <p>
                <span className="text-[var(--game-text-muted)]">
                  {balance.kind === "portfolio_usd" ? "Estimated total: " : "Your balance: "}
                </span>
                <span className="font-[family-name:var(--font-share-tech)] font-medium text-[var(--game-text)]">
                  {balance.kind === "portfolio_usd"
                    ? (balance.formatted ?? "—")
                    : `${balance.formatted ?? "—"} USDC`}
                </span>
              </p>
              {!canAccept ? (
                <div className="space-y-3">
                  <p className="text-[var(--game-danger)]">
                    {duel.playMode === "duel" ? (
                      `Insufficient portfolio value: you need at least ${formatUsdcLabel(duel.stakeUsdc)} USD estimated (Mobula) to accept.`
                    ) : (
                      <>
                        Insufficient balance for the stake. You can request another test send from the server
                        (same flow as signup). If it still fails, check{" "}
                        <code className="text-[var(--game-cyan)]">PRIVATE_KEY_GAS_DISPATCHER</code> (ETH on the
                        faucet chain) and the orange message above.
                      </>
                    )}
                  </p>
                  {walletAddress ? (
                    <div className="rounded-sm border border-[var(--game-cyan-dim)]/40 bg-[rgba(4,2,12,0.5)] p-3 space-y-2">
                      <p className="text-xs text-[var(--game-text-muted)]">
                        Deposit tokens on Arbitrum to this wallet:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 break-all font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-cyan)]">
                          {walletAddress}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(walletAddress);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="shrink-0 rounded-sm border border-[var(--game-cyan-dim)]/50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--game-cyan)] transition hover:bg-[rgba(65,245,240,0.1)]"
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <p className="text-[10px] text-[var(--game-text-muted)]">
                        Balance refreshes automatically every 10s.
                      </p>
                    </div>
                  ) : null}
                  {duel.playMode !== "duel" ? (
                    <div className="space-y-2 rounded-sm border border-[var(--game-cyan-dim)]/40 bg-[rgba(4,2,12,0.5)] p-3">
                      {claimError ? (
                        <p className="text-xs text-[var(--game-danger)]">{claimError}</p>
                      ) : null}
                      <button
                        type="button"
                        disabled={claimLoading}
                        onClick={() => void onClaimFaucet()}
                        className={`${gameBtnGhost} w-full sm:w-auto`}
                      >
                        {claimLoading ? "Sending…" : "Get test USDC (faucet)"}
                      </button>
                    </div>
                  ) : null}
                </div>
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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={joinLoading || !canAccept || !balance?.configured}
          onClick={() => void onJoin()}
          className={gameBtnPrimary}
        >
          {joinLoading ? "Saving…" : "Enter the arena"}
        </button>
        <button
          type="button"
          disabled={balanceLoading || !balance?.configured}
          onClick={() => void loadBalance()}
          className={`${gameMuted} text-left text-xs underline decoration-[var(--game-cyan-dim)] underline-offset-2 sm:text-sm`}
        >
          Refresh balance
        </button>
      </div>
    </div>
  );
}
