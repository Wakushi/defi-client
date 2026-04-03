"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";

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
  return new Intl.NumberFormat("fr-FR", {
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
        setDuelError(data.error ?? "Duel introuvable.");
        return;
      }
      setDuel(data);
    } catch {
      setDuel(null);
      setDuelError("Erreur réseau.");
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
        setBalance({ configured: false, error: "Session expirée : reconnecte-toi." });
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
      setBalance({ configured: false, error: "Erreur réseau." });
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
        setJoinError(data.error ?? "Impossible d’accepter le duel.");
        return;
      }
      await loadDuel();
    } catch {
      setJoinError("Erreur réseau.");
    } finally {
      setJoinLoading(false);
    }
  }

  if (duelLoading) {
    return (
      <p className="text-sm text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
        Chargement…
      </p>
    );
  }

  if (duelError || !duel) {
    return (
      <p className="rounded-lg bg-red-500/12 px-3 py-2 text-sm text-red-600 dark:text-red-400">
        {duelError ?? "Duel introuvable."}
      </p>
    );
  }

  if (!duel.viewer) {
    return (
      <div className="space-y-4 rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Rejoindre le duel</h2>
          <p className="text-sm text-[color-mix(in_oklab,var(--foreground)65%,transparent)]">
            Connecte-toi ou crée un compte. Ensuite tu verras ton solde USDC sur le wallet du compte : il
            doit couvrir la mise ({formatUsdcLabel(duel.stakeUsdc)} USDC) pour accepter.
          </p>
        </div>
        <div className="flex rounded-xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] p-1">
          <button
            type="button"
            onClick={() => setAuthMode("login")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              authMode === "login"
                ? "bg-[color-mix(in_oklab,var(--foreground)10%,transparent)] text-foreground"
                : "text-[color-mix(in_oklab,var(--foreground)55%,transparent)]"
            }`}
          >
            Connexion
          </button>
          <button
            type="button"
            onClick={() => setAuthMode("signup")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              authMode === "signup"
                ? "bg-[color-mix(in_oklab,var(--foreground)10%,transparent)] text-foreground"
                : "text-[color-mix(in_oklab,var(--foreground)55%,transparent)]"
            }`}
          >
            Créer un compte
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
      <div className="rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-6 text-sm text-[color-mix(in_oklab,var(--foreground)72%,transparent)]">
        <p className="font-medium text-foreground">Tu es l’hôte de ce duel</p>
        <p className="mt-2">
          Envoie le lien à ton adversaire : il devra se connecter, puis accepter avec un wallet qui a
          au moins {formatUsdcLabel(duel.stakeUsdc)} USDC sur la chaîne du faucet.
        </p>
        {duel.duelFull ? (
          <Link
            href={`/duel/${duelId}/prepare`}
            className="mt-4 inline-flex rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Configurer mon trade
          </Link>
        ) : null}
      </div>
    );
  }

  if (duel.viewer.isOpponent) {
    return (
      <div className="rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-6 text-sm text-[color-mix(in_oklab,var(--foreground)72%,transparent)]">
        <p className="font-medium text-foreground">Tu participes à ce duel</p>
        <p className="mt-2">
          Tu es enregistré comme adversaire de <span className="font-medium">{duel.creatorPseudo}</span>
          . Configure ton trade puis marque-toi prêt en même temps que l’hôte.
        </p>
        <Link
          href={`/duel/${duelId}/prepare`}
          className="mt-4 inline-flex rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          Configurer mon trade
        </Link>
      </div>
    );
  }

  if (duel.duelFull) {
    return (
      <div className="rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-6 text-sm text-[color-mix(in_oklab,var(--foreground)72%,transparent)]">
        <p className="font-medium text-foreground">Duel complet</p>
        <p className="mt-2">
          {duel.creatorPseudo} vs {duel.opponentPseudo ?? "?"}. Tu ne peux pas rejoindre cette partie.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Accepter le duel</h2>
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)65%,transparent)]">
          Mise requise (chacun) :{" "}
          <span className="font-mono font-medium text-foreground">
            {formatUsdcLabel(duel.stakeUsdc)} USDC
          </span>
        </p>
      </div>

      {balanceLoading ? (
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
          Lecture du solde sur ton wallet…
        </p>
      ) : null}

      {!balanceLoading && balance ? (
        <div className="space-y-2 text-sm">
          {!balance.configured ? (
            <p className="rounded-lg bg-amber-500/12 px-3 py-2 text-amber-800 dark:text-amber-200">
              {balance.error ??
                "Solde indisponible : vérifie FAUCET_RPC_URL et GNS_COLLATERAL_TOKEN_ADDRESS."}
            </p>
          ) : (
            <>
              <p>
                <span className="text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
                  Ton solde (wallet du compte) :{" "}
                </span>
                <span className="font-mono font-medium text-foreground">
                  {balance.formatted} USDC
                </span>
              </p>
              {!canAccept ? (
                <p className="text-red-600 dark:text-red-400">
                  Solde insuffisant pour couvrir la mise. Utilise le faucet (getFreeDai) ou transfère
                  des USDC sur ce wallet.
                </p>
              ) : (
                <p className="text-[color-mix(in_oklab,var(--foreground)65%,transparent)]">
                  Tu peux accepter : ton solde couvre la mise.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}

      {joinError ? (
        <p className="rounded-lg bg-red-500/12 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {joinError}
        </p>
      ) : null}

      <button
        type="button"
        disabled={joinLoading || !canAccept || !balance?.configured}
        onClick={() => void onJoin()}
        className="w-full rounded-xl bg-foreground py-2.5 text-sm font-medium text-background disabled:opacity-50"
      >
        {joinLoading ? "Enregistrement…" : "Accepter le duel"}
      </button>
    </div>
  );
}
