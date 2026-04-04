"use client";

import { useEffect } from "react";

import { GainsRealtimeProvider } from "@/components/gains-realtime-context";

export function DuelGainsRealtimeLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    console.log(
      "[GainsWS]",
      "layout: /duel/* page mounted — GainsRealtimeProvider is active (WebSocket only after wallet + NEXT_PUBLIC_DUEL_DEFI_WS_URL)",
    );
  }, []);

  return <GainsRealtimeProvider>{children}</GainsRealtimeProvider>;
}
