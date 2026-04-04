import { HomeAuth } from "@/components/home-auth"
import { GameLogo } from "@/components/game-ui"

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
      <div className="mb-8 flex flex-col items-center gap-2">
        <GameLogo />
        <p className="font-[family-name:var(--font-orbitron)] text-[10px] font-semibold uppercase tracking-[0.35em] text-[var(--game-text-muted)]">
          Arena · Wallet · Gains
        </p>
      </div>
      <HomeAuth />
    </main>
  )
}
