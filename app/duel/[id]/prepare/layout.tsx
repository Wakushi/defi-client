import { DuelGainsRealtimeLayout } from "@/components/duel-gains-realtime-layout";

/**
 * WebSocket / PnL uniquement pour la préparation du trade — évite d’envelopper le lobby
 * `/duel/[id]` (RSC + DB) dans un boundary client, ce qui cassait Turbopack (`require is not defined`).
 */
export default function DuelPrepareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DuelGainsRealtimeLayout>{children}</DuelGainsRealtimeLayout>;
}
