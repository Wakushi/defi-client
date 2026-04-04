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

  const fetchCollateralBalance = useCallback(async (): Promise<BalanceApi | null> => {
    try {
      const r = await fetch("/api/wallet/collateral-balance", { credentials: "include" });
      const data = (await r.json()) as BalanceApi & { error?: string };
      if (r.status === 401) {
        return { configured: false, error: "Session expired — sign in again." };
      }
      return {
        configured: Boolean(data.configured),
        balanceRaw: data.balanceRaw,
        decimals: data.decimals,
        formatted: data.formatted,
        error: data.error,
      };
    } catch {
      return { configured: false, error: "Network error." };
    }
  }, []);

  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalance(null);
    try {
      const b = await fetchCollateralBalance();
      if (b) setBalance(b);
    } finally {
      setBalanceLoading(false);
    }
  }, [fetchCollateralBalance]);

  const pollBalanceUntilStake = useCallback(
    async (stakeUsdc: string) => {
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
      try {
        for (let i = 0; i < BALANCE_POLL_MAX_ATTEMPTS; i++) {
          if (ctrl.signal.aborted) return;

          const b = await fetchCollateralBalance();
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
    [fetchCollateralBalance],
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
  }, [shouldLoadBalance, loadBalance]);

  const canAccept = useMemo(() => {
    if (!duel || !balance?.configured) return false;
    if (balance.balanceRaw === undefined || balance.balanceRaw === "") return false;
    try {
      const need = parseUnits(duel.stakeUsdc, 6);
      return BigInt(balance.balanceRaw) >= need;
    } catch {
      return false;
    }
  }, [duel, balance]);

  async function onClaimFaucet() {
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
        setClaimError(data.error ?? "Faucet échoué.");
        return;
      }
      const stake = duel?.stakeUsdc;
      if (!stake) return;
      balancePollInProgressRef.current = true;
      try {
        await pollBalanceUntilStake(stake);
      } finally {
        balancePollInProgressRef.current = false;
      }
    } catch {
      setClaimError("Erreur réseau.");
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
                  "Le serveur n’a pas le faucet USDC configuré (USDC_FAUCET_CONTRACT_ADDRESS, FAUCET_RPC_URL, FAUCET_CHAIN_ID). Envoie manuellement des USDC sur la chaîne faucet à l’adresse du wallet affichée après inscription, ou configure ces variables.",
                );
              } else if (info?.faucetStatus === "failed") {
                setFundingNotice(
                  `Le faucet automatique a échoué (souvent : pas de gas natif — définis PRIVATE_KEY_GAS_DISPATCHER sur le serveur, ou RPC/contrat incorrect). Détail : ${info.faucetError ?? "erreur inconnue"}`,
                );
              }

              const willPoll = info?.faucetStatus === "sent";
              if (willPoll) {
                balancePollInProgressRef.current = true;
              }
              try {
                const d = await loadDuel();
                if (willPoll && d?.stakeUsdc) {
                  await pollBalanceUntilStake(d.stakeUsdc);
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
          Send the link to your opponent: they sign in, then accept with a wallet that has at least{" "}
          {formatUsdcLabel(duel.stakeUsdc)} USDC on the faucet chain.
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

      {fundingNotice ? (
        <p className="rounded-sm border border-[var(--game-amber)]/50 bg-[rgba(255,200,74,0.1)] px-3 py-2 text-xs text-[var(--game-amber)]">
          {fundingNotice}
        </p>
      ) : null}

      {balanceCoversStake ? (
        <p className="rounded-sm border border-[var(--game-cyan)]/40 bg-[rgba(65,245,240,0.1)] px-3 py-2 text-sm font-medium text-[var(--game-cyan)]">
          Solde à jour : les USDC sont bien visibles sur la chaîne pour cette mise — tu peux entrer dans l’arène.
        </p>
      ) : null}

      {balanceLoading && !confirmingUsdc ? (
        <p className={`${gameMuted} font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider`}>
          Lecture du solde…
        </p>
      ) : null}

      {confirmingUsdc ? (
        <p
          className={`${gameMuted} rounded-sm border border-[var(--game-cyan)]/35 bg-[rgba(65,245,240,0.08)] px-3 py-2 font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-wider text-[var(--game-cyan)]`}
        >
          Synchronisation du solde USDC sur la chaîne — la transaction faucet est en cours de confirmation…
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
                <span className="text-[var(--game-text-muted)]">Your balance: </span>
                <span className="font-[family-name:var(--font-share-tech)] font-medium text-[var(--game-text)]">
                  {balance.formatted} USDC
                </span>
              </p>
              {!canAccept ? (
                <div className="space-y-3">
                  <p className="text-[var(--game-danger)]">
                    Solde insuffisant pour la mise. Tu peux redemander un envoi test depuis le serveur (même flux
                    qu’à l’inscription). Si ça échoue encore, vérifie{" "}
                    <code className="text-[var(--game-cyan)]">PRIVATE_KEY_GAS_DISPATCHER</code> (ETH sur la chaîne
                    faucet) et le message orange ci‑dessus.
                  </p>
                  <div className="rounded-sm border border-[var(--game-cyan-dim)]/40 bg-[rgba(4,2,12,0.5)] p-3 space-y-2">
                    {claimError ? (
                      <p className="text-xs text-[var(--game-danger)]">{claimError}</p>
                    ) : null}
                    <button
                      type="button"
                      disabled={claimLoading}
                      onClick={() => void onClaimFaucet()}
                      className={`${gameBtnGhost} w-full sm:w-auto`}
                    >
                      {claimLoading ? "Envoi…" : "Recevoir USDC test (faucet)"}
                    </button>
                  </div>
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
          Rafraîchir le solde
        </button>
      </div>
    </div>
  );
}
