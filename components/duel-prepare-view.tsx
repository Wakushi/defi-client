"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  return new Intl.NumberFormat("fr-FR", {
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
  const [leverageX, setLeverageX] = useState(10);
  const [long, setLong] = useState(true);
  const [readyLoading, setReadyLoading] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  /** Une seule tentative auto à la fin du compte à rebours (évite double envoi). */
  const autoSignStartedRef = useRef(false);

  const loadDuel = useCallback(async () => {
    if (!duelId) return;
    setLoadError(null);
    try {
      const r = await fetch(`/api/duels/${duelId}`, { credentials: "include" });
      const data = (await r.json()) as DuelPayload & { error?: string };
      if (!r.ok) {
        setDuel(null);
        setLoadError(data.error ?? "Duel introuvable.");
        return;
      }
      setDuel(data);
      if (data.myTradeConfig) {
        setPairIndex(data.myTradeConfig.pairIndex);
        setLeverageX(data.myTradeConfig.leverageX);
        setLong(data.myTradeConfig.long);
      }
    } catch {
      setDuel(null);
      setLoadError("Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }, [duelId]);

  useEffect(() => {
    void loadDuel();
  }, [loadDuel]);

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
      setReadyError("Entre ton mot de passe wallet avant de marquer prêt (il reste dans ton navigateur).");
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
        setReadyError(data.error ?? "Échec.");
        return;
      }
      await loadDuel();
    } catch {
      setReadyError("Erreur réseau.");
    } finally {
      setReadyLoading(false);
    }
  }

  const onExecute = useCallback(async () => {
    if (!duelId || !password.trim()) return;
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
        setExecError(data.error ?? "Échec.");
        return;
      }
      if (data.txHash) {
        setTxHash(data.txHash);
        setPassword("");
      }
    } catch {
      setExecError("Erreur réseau.");
    } finally {
      setExecLoading(false);
    }
  }, [duelId, password]);

  useEffect(() => {
    if (!countdownFinished) return;
    if (!password.trim() || !duelId) return;
    if (txHash) return;
    if (execLoading) return;
    if (autoSignStartedRef.current) return;
    autoSignStartedRef.current = true;
    void onExecute();
  }, [countdownFinished, password, duelId, txHash, execLoading, onExecute]);

  function onRetrySign() {
    autoSignStartedRef.current = false;
    void onExecute();
  }

  if (!duelId) {
    return <p className="p-8 text-sm">Identifiant manquant.</p>;
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">Chargement…</p>
      </main>
    );
  }

  if (loadError || !duel) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 space-y-4">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError ?? "Introuvable."}</p>
        <Link href="/" className="text-sm underline">
          Accueil
        </Link>
      </main>
    );
  }

  if (!duel.duelFull) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 space-y-4">
        <p className="text-sm">Le duel n’a pas encore deux joueurs.</p>
        <Link href={`/duel/${duelId}`} className="text-sm underline">
          Retour au salon
        </Link>
      </main>
    );
  }

  if (!participant) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 space-y-4">
        <p className="text-sm">Tu ne participes pas à ce duel.</p>
        <Link href="/" className="text-sm underline">
          Accueil
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-16">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
          Préparation du trade
        </p>
        <h1 className="text-xl font-semibold tracking-tight">
          {duel.creatorPseudo} vs {duel.opponentPseudo}
        </h1>
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)65%,transparent)]">
          Mise : {formatUsdc(duel.stakeUsdc)} USDC chacun · durée prévue {Math.round(duel.durationSeconds / 60)} min
        </p>
      </div>

      <div className="rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-6 space-y-3 text-sm">
        <p>
          Statut prêt :{" "}
          <span className="font-mono">
            [{duel.readyState[0]}, {duel.readyState[1]}]
          </span>{" "}
          (créateur, adversaire)
        </p>
        <p className="text-[color-mix(in_oklab,var(--foreground)60%,transparent)]">
          Entre ton mot de passe wallet <span className="font-medium text-foreground">avant</span> de te
          marquer prêt : il ne quitte pas ton navigateur. Quand les deux sont prêts, compte à rebours 3 →
          1 puis <span className="font-medium text-foreground">signature automatique</span> des deux côtés
          au même moment (chaque joueur sur son écran).
        </p>
      </div>

      {!duel.myReady ? (
        <div className="space-y-4 rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-6">
          <h2 className="font-semibold">Tes paramètres Gains</h2>
          <label className="block space-y-1">
            <span className="text-xs uppercase text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
              Mot de passe wallet (Dynamic)
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Pour signer à la fin du compte à rebours"
              className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)15%,transparent)] bg-background px-3 py-2 text-sm"
              autoComplete="current-password"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
              Pair index
            </span>
            <input
              type="number"
              min={0}
              max={65535}
              value={pairIndex}
              onChange={(e) => setPairIndex(Number.parseInt(e.target.value, 10) || 0)}
              className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)15%,transparent)] bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
              Levier (×)
            </span>
            <input
              type="number"
              min={1}
              max={500}
              value={leverageX}
              onChange={(e) => setLeverageX(Number.parseInt(e.target.value, 10) || 1)}
              className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)15%,transparent)] bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={long}
              onChange={(e) => setLong(e.target.checked)}
            />
            <span>Long (décoche pour short)</span>
          </label>
          {readyError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{readyError}</p>
          ) : null}
          <button
            type="button"
            disabled={readyLoading || !password.trim()}
            onClick={() => void onMarkReady()}
            className="w-full rounded-xl bg-foreground py-2.5 text-sm font-medium text-background disabled:opacity-50"
          >
            {readyLoading ? "Envoi…" : "J’ai fini — marquer prêt"}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-[color-mix(in_oklab,var(--foreground)15%,transparent)] bg-[color-mix(in_oklab,var(--foreground)6%,transparent)] px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Tu es marqué prêt.</p>
          <p className="mt-1 text-[color-mix(in_oklab,var(--foreground)65%,transparent)]">
            Pair {pairIndex} · {leverageX}× · {long ? "Long" : "Short"} · mot de passe conservé pour la
            signature auto
          </p>
        </div>
      )}

      {duel.myReady && !duel.bothReady ? (
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)65%,transparent)]">
          En attente de l’autre joueur…
        </p>
      ) : null}

      {duel.bothReady && cd !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <p className="text-7xl font-bold tabular-nums text-white">{cd}</p>
        </div>
      ) : null}

      {duel.bothReady && countdownFinished ? (
        <div className="space-y-4 rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-6">
          <h2 className="font-semibold">Lancement du trade</h2>
          {execLoading && !txHash ? (
            <p className="text-sm text-[color-mix(in_oklab,var(--foreground)72%,transparent)]">
              Signature en cours avec le mot de passe saisi à l’étape précédente…
            </p>
          ) : null}
          {!execLoading && !txHash && !execError ? (
            <p className="text-sm text-[color-mix(in_oklab,var(--foreground)72%,transparent)]">
              Démarrage automatique…
            </p>
          ) : null}
          {execError ? (
            <div className="space-y-3">
              <p className="text-sm text-red-600 dark:text-red-400">{execError}</p>
              <label className="block space-y-1">
                <span className="text-xs uppercase text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
                  Corriger le mot de passe si besoin
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)15%,transparent)] bg-background px-3 py-2 text-sm"
                  autoComplete="current-password"
                />
              </label>
              <button
                type="button"
                disabled={execLoading || !password.trim()}
                onClick={() => void onRetrySign()}
                className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)18%,transparent)] py-2.5 text-sm font-medium disabled:opacity-50"
              >
                Réessayer la signature
              </button>
            </div>
          ) : null}
          {txHash ? (
            <p className="break-all font-mono text-xs text-[color-mix(in_oklab,var(--foreground)72%,transparent)]">
              Tx : {txHash}
            </p>
          ) : null}
        </div>
      ) : null}

      <Link
        href={`/duel/${duelId}`}
        className="text-center text-sm text-[color-mix(in_oklab,var(--foreground)55%,transparent)] underline-offset-4 hover:underline"
      >
        Retour au salon
      </Link>
    </main>
  );
}
