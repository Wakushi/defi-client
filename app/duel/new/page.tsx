"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function NewDuelPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [stakeUsdc, setStakeUsdc] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("15");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [joinPath, setJoinPath] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    const r = await fetch("/api/auth/me", { credentials: "include" });
    const data = (await r.json()) as { user: { id: string } | null };
    setLoggedIn(Boolean(data.user));
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setJoinUrl(null);
    setJoinPath(null);
    setLoading(true);
    try {
      const min = Number.parseInt(durationMinutes, 10);
      if (!Number.isFinite(min) || min < 1) {
        setError("Durée invalide (minutes ≥ 1).");
        return;
      }
      const res = await fetch("/api/duels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          stakeUsdc: stakeUsdc.trim(),
          durationSeconds: min * 60,
        }),
      });
      const data = (await res.json()) as { error?: string; id?: string; joinPath?: string };
      if (!res.ok) {
        setError(data.error ?? "Création impossible.");
        return;
      }
      if (data.joinPath && typeof window !== "undefined") {
        setJoinPath(data.joinPath);
        setJoinUrl(`${window.location.origin}${data.joinPath}`);
      }
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  async function copyUrl() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch {
      /* ignore */
    }
  }

  if (!authChecked) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
          Chargement…
        </p>
      </main>
    );
  }

  if (!loggedIn) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)72%,transparent)]">
          Connecte-toi pour créer un duel.
        </p>
        <Link
          href="/"
          className="text-center text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          Retour à l’accueil
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-16">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Nouveau duel</h1>
        <p className="text-sm text-[color-mix(in_oklab,var(--foreground)65%,transparent)]">
          Définis la mise (chaque joueur) et le temps imparti pour le trade. Un lien sera généré
          pour inviter l’adversaire.
        </p>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
            Mise par joueur (USDC)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={stakeUsdc}
            onChange={(e) => setStakeUsdc(e.target.value)}
            placeholder="ex. 100 ou 50,5"
            className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)15%,transparent)] bg-background px-3 py-2 text-sm"
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
            Durée du trade (minutes)
          </span>
          <input
            type="number"
            min={1}
            max={10080}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            className="w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)15%,transparent)] bg-background px-3 py-2 text-sm"
            required
          />
        </label>
        {error ? (
          <p className="rounded-lg bg-red-500/12 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-foreground py-2.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {loading ? "Enregistrement…" : "Créer le duel et obtenir le lien"}
        </button>
      </form>

      {joinUrl ? (
        <div className="space-y-2 rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-4">
          <p className="text-sm font-medium">Lien à envoyer à l’adversaire</p>
          <p className="break-all font-mono text-xs text-[color-mix(in_oklab,var(--foreground)72%,transparent)]">
            {joinUrl}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyUrl()}
              className="rounded-lg border border-[color-mix(in_oklab,var(--foreground)18%,transparent)] px-3 py-1.5 text-xs font-medium"
            >
              Copier
            </button>
            {joinPath ? (
              <Link
                href={joinPath}
                className="inline-flex items-center rounded-lg border border-[color-mix(in_oklab,var(--foreground)18%,transparent)] px-3 py-1.5 text-xs font-medium"
              >
                Ouvrir le salon
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <Link
        href="/"
        className="text-center text-sm text-[color-mix(in_oklab,var(--foreground)55%,transparent)] underline-offset-4 hover:underline"
      >
        Retour à l’accueil
      </Link>
    </main>
  );
}
