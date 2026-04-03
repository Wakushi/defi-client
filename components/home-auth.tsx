"use client";

import { useCallback, useEffect, useState } from "react";

import { LoginForm } from "@/components/login-form";
import { OpenTestTradeForm } from "@/components/open-test-trade";
import { SignupForm } from "@/components/signup-form";

type MeUser = {
  id: string;
  username: string;
  walletAddress: string | null;
};

export function HomeAuth() {
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signup" | "login">("signup");

  const refresh = useCallback(async () => {
    const r = await fetch("/api/auth/me", { credentials: "include" });
    const data = (await r.json()) as { user: MeUser | null };
    setUser(data.user ?? null);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }

  if (loading) {
    return (
      <p className="text-sm text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
        Loading…
      </p>
    );
  }

  if (user) {
    return (
      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="space-y-3 rounded-2xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] bg-[color-mix(in_oklab,var(--foreground)4%,transparent)] p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
                Signed in
              </p>
              <p className="text-lg font-semibold tracking-tight">{user.username}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="shrink-0 rounded-lg border border-[color-mix(in_oklab,var(--foreground)18%,transparent)] px-3 py-1.5 text-sm font-medium hover:bg-[color-mix(in_oklab,var(--foreground)8%,transparent)]"
            >
              Log out
            </button>
          </div>
          {user.walletAddress ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-[color-mix(in_oklab,var(--foreground)55%,transparent)]">
                Wallet
              </p>
              <p className="break-all font-mono text-sm">{user.walletAddress}</p>
            </div>
          ) : null}
        </div>
        <OpenTestTradeForm sessionUsername={user.username} />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex rounded-xl border border-[color-mix(in_oklab,var(--foreground)12%,transparent)] p-1">
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
            mode === "signup"
              ? "bg-[color-mix(in_oklab,var(--foreground)10%,transparent)] text-foreground"
              : "text-[color-mix(in_oklab,var(--foreground)55%,transparent)]"
          }`}
        >
          Sign up
        </button>
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
            mode === "login"
              ? "bg-[color-mix(in_oklab,var(--foreground)10%,transparent)] text-foreground"
              : "text-[color-mix(in_oklab,var(--foreground)55%,transparent)]"
          }`}
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
