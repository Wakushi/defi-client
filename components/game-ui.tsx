import type { ReactNode } from "react";

/** Game-style panel / terminal screen */
export const gamePanel =
  "relative overflow-hidden rounded-sm border-2 border-[var(--game-cyan-dim)] bg-[var(--game-bg-elevated)] shadow-[0_0_40px_rgba(65,245,240,0.07),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md";

export const gamePanelTopAccent =
  "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-gradient-to-r before:from-[var(--game-magenta)] before:via-[var(--game-cyan)] before:to-[var(--game-magenta)]";

export const gameInput =
  "w-full rounded-sm border border-[var(--game-cyan-dim)] bg-[rgba(4,2,12,0.9)] px-3 py-2.5 text-sm text-[var(--game-text)] shadow-[inset_0_2px_8px_rgba(0,0,0,0.5)] outline-none transition focus:border-[var(--game-cyan)] focus:shadow-[0_0_18px_rgba(65,245,240,0.22)]";

export const gameBtnPrimary =
  "inline-flex w-full items-center justify-center rounded-sm border-2 border-[var(--game-cyan)] bg-[linear-gradient(180deg,rgba(65,245,240,0.22),rgba(20,8,40,0.95))] px-4 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-[var(--game-cyan)] shadow-[0_0_24px_rgba(65,245,240,0.28)] transition enabled:hover:brightness-110 enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40";

export const gameBtnDanger =
  "inline-flex w-full items-center justify-center rounded-sm border-2 border-[var(--game-magenta)] bg-[linear-gradient(180deg,rgba(255,61,154,0.18),rgba(20,8,40,0.95))] px-4 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-[var(--game-magenta)] shadow-[0_0_22px_rgba(255,61,154,0.22)] transition enabled:hover:brightness-110 disabled:opacity-40";

export const gameBtnGhost =
  "inline-flex items-center justify-center rounded-sm border border-[var(--game-cyan-dim)] bg-transparent px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--game-text-muted)] transition hover:border-[var(--game-cyan)] hover:text-[var(--game-cyan)]";

export const gameLabel =
  "text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--game-magenta)]";

export const gameMuted = "text-sm text-[var(--game-text-muted)]";

export const gameTitle =
  "font-[family-name:var(--font-orbitron)] text-2xl font-bold uppercase tracking-wide text-[var(--game-text)] [text-shadow:0_0_24px_rgba(65,245,240,0.35)] sm:text-3xl";

export const gameSubtitle =
  "font-[family-name:var(--font-orbitron)] text-xs font-semibold uppercase tracking-[0.28em] text-[var(--game-cyan)]";

export const gameMono = "font-[family-name:var(--font-share-tech)] text-xs text-[var(--game-text-muted)]";

export const gameLink =
  "text-sm font-semibold text-[var(--game-cyan)] underline decoration-[var(--game-cyan-dim)] underline-offset-4 transition hover:decoration-[var(--game-cyan)] hover:[text-shadow:0_0_12px_rgba(65,245,240,0.5)]";

export const gameTabRow =
  "flex rounded-sm border border-[var(--game-cyan-dim)] bg-[rgba(4,2,12,0.6)] p-0.5";

export function gameTabActive(active: boolean) {
  return active
    ? "bg-[linear-gradient(180deg,rgba(65,245,240,0.2),rgba(65,245,240,0.06))] text-[var(--game-cyan)] shadow-[inset_0_0_12px_rgba(65,245,240,0.12)]"
    : "text-[var(--game-text-muted)] hover:text-[var(--game-text)]";
}

export function GameLogo({ className = "" }: { className?: string }) {
  return (
    <div
      className={`font-[family-name:var(--font-orbitron)] text-lg font-black tracking-[0.2em] sm:text-xl ${className}`}
    >
      <span className="text-[var(--game-cyan)] [text-shadow:0_0_20px_rgba(65,245,240,0.55)]">Dé</span>
      <span className="text-[var(--game-magenta)] [text-shadow:0_0_18px_rgba(255,61,154,0.55)]">Fi</span>
    </div>
  );
}

type VsProps = {
  left: string;
  right: string;
  leftTag?: string;
  rightTag?: string;
};

export function GameVsBanner({ left, right, leftTag = "P1", rightTag = "P2" }: VsProps) {
  return (
    <div className="relative overflow-hidden rounded-sm border-2 border-[var(--game-cyan-dim)] bg-[linear-gradient(90deg,rgba(255,61,154,0.12),transparent_45%,transparent_55%,rgba(65,245,240,0.12))] px-3 py-4 sm:px-5 sm:py-5">
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-60deg,transparent,transparent_8px,rgba(65,245,240,0.03)_8px,rgba(65,245,240,0.03)_9px)]" />
      <div className="relative flex items-center justify-between gap-2 sm:gap-4">
        <div className="min-w-0 flex-1 text-right">
          <p className="font-[family-name:var(--font-orbitron)] text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--game-magenta)]">
            {leftTag}
          </p>
          <p className="truncate font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-[var(--game-text)] sm:text-base">
            {left}
          </p>
        </div>
        <div className="shrink-0 font-[family-name:var(--font-orbitron)] text-2xl font-black italic text-[var(--game-amber)] [text-shadow:0_0_20px_rgba(255,200,74,0.45)] sm:text-4xl">
          VS
        </div>
        <div className="min-w-0 flex-1 text-left">
          <p className="font-[family-name:var(--font-orbitron)] text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--game-cyan)]">
            {rightTag}
          </p>
          <p className="truncate font-[family-name:var(--font-orbitron)] text-sm font-bold uppercase text-[var(--game-text)] sm:text-base">
            {right}
          </p>
        </div>
      </div>
    </div>
  );
}

export function GameHudBar({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-[var(--game-cyan-dim)] bg-[rgba(4,2,12,0.88)] px-4 py-3 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">{children}</div>
    </header>
  );
}

export function GameStatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-[var(--game-cyan-dim)] bg-[rgba(4,2,12,0.75)] px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--game-text-muted)]">{label}</p>
      <p className="font-[family-name:var(--font-share-tech)] text-sm text-[var(--game-cyan)]">{value}</p>
    </div>
  );
}
