"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  gainsPositionStreamKey,
  type GainsPositionPnlTick,
  type GainsPositionUpdate,
} from "@/types/gains-api";

type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

const PNL_HISTORY_MAX = 90;

function mergePnlHistory(
  prev: Map<string, GainsPositionPnlTick[]>,
  incoming: GainsPositionUpdate[],
  now: number,
): Map<string, GainsPositionPnlTick[]> {
  const next = new Map(prev);
  const activeKeys = new Set<string>();

  for (const pos of incoming) {
    const key = gainsPositionStreamKey(pos);
    activeKeys.add(key);
    const old = next.get(key) ?? [];
    const merged = [...old, { t: now, pnl: pos.pnl }];
    const trimmed =
      merged.length > PNL_HISTORY_MAX ? merged.slice(merged.length - PNL_HISTORY_MAX) : merged;
    next.set(key, trimmed);
  }

  for (const k of next.keys()) {
    if (!activeKeys.has(k)) {
      next.delete(k);
    }
  }

  return next;
}

type GainsRealtimeContextValue = {
  walletAddress: string | null;
  connectionState: ConnectionState;
  lastWsError: string | null;
  positions: GainsPositionUpdate[];
  /** Historique PnL par position (clé stable) — mis à jour dans le handler WebSocket. */
  pnlHistoryByKey: ReadonlyMap<string, GainsPositionPnlTick[]>;
  subscribePositions: (duelId: string) => void;
  unsubscribePositions: () => void;
};

const defaultValue: GainsRealtimeContextValue = {
  walletAddress: null,
  connectionState: "idle",
  lastWsError: null,
  positions: [],
  pnlHistoryByKey: new Map(),
  subscribePositions: () => {},
  unsubscribePositions: () => {},
};

const GainsRealtimeContext = createContext<GainsRealtimeContextValue>(defaultValue);

const LOG = "[GainsWS]";

function wsUrlFromEnv(): string | null {
  const u = process.env.NEXT_PUBLIC_DUEL_DEFI_WS_URL?.trim();
  return u || null;
}

export function useGainsRealtime() {
  return useContext(GainsRealtimeContext);
}

export function GainsRealtimeProvider({ children }: { children: React.ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [lastWsError, setLastWsError] = useState<string | null>(null);
  const [positions, setPositions] = useState<GainsPositionUpdate[]>([]);
  const [pnlHistoryByKey, setPnlHistoryByKey] = useState(
    () => new Map<string, GainsPositionPnlTick[]>(),
  );

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalUnmountRef = useRef(false);
  /** Dernier duel souscrit (pour unsubscribe / cleanup alignés sur le serveur). */
  const subscribedDuelIdRef = useRef<string | null>(null);

  useEffect(() => {
    console.log(LOG, "session: fetching /api/auth/me (duel layout mounted)");
    let cancelled = false;
    void fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json() as Promise<{ user?: { walletAddress?: string | null } }>)
      .then((d) => {
        if (cancelled) return;
        const w = d.user?.walletAddress?.trim();
        const addr = w && w.startsWith("0x") ? w : null;
        console.log(
          LOG,
          "session: /api/auth/me result",
          addr ? { wallet: `${addr.slice(0, 10)}…` } : { wallet: null, note: "no wallet or not logged in" },
        );
        setWalletAddress(addr);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn(LOG, "session: /api/auth/me failed", e);
          setWalletAddress(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const url = wsUrlFromEnv();
    if (!url) {
      console.log(
        LOG,
        "socket: skip — set NEXT_PUBLIC_DUEL_DEFI_WS_URL (e.g. ws://host:3001/ws/positions)",
      );
      setConnectionState("idle");
      return;
    }
    if (!walletAddress) {
      console.log(LOG, "socket: skip — no wallet yet (stay idle until /api/auth/me returns 0x…)");
      setConnectionState("idle");
      return;
    }

    console.log(LOG, "socket: will connect", { url, wallet: `${walletAddress.slice(0, 10)}…` });

    intentionalUnmountRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const openSocket = () => {
      if (intentionalUnmountRef.current) {
        console.log(LOG, "socket: openSocket aborted (unmount in progress)");
        return;
      }

      console.log(LOG, "socket: new WebSocket()", url);
      setConnectionState("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionState("open");
        setLastWsError(null);
        console.log(LOG, "socket: onopen — connected, readyState=", ws.readyState);
      };

      ws.onmessage = (ev) => {
        const raw = String(ev.data);
        console.log(LOG, "socket: onmessage raw", raw.slice(0, 500) + (raw.length > 500 ? "…" : ""));
        try {
          const msg = JSON.parse(raw) as {
            event?: string;
            data?: unknown;
          };
          console.log(LOG, "socket: onmessage parsed", { event: msg.event, data: msg.data });
          if (msg.event === "positions" && Array.isArray(msg.data)) {
            const batch = msg.data as GainsPositionUpdate[];
            const now = Date.now();
            setPositions(batch);
            setPnlHistoryByKey((prev) => mergePnlHistory(prev, batch, now));
            return;
          }
          if (msg.event === "error") {
            setLastWsError(
              typeof msg.data === "string" ? msg.data : "WebSocket positions error.",
            );
            return;
          }
          if (msg.event === "expired") {
            setLastWsError(
              typeof msg.data === "string" ? msg.data : "Subscription expired.",
            );
            intentionalUnmountRef.current = true;
            console.log(LOG, "socket: expired from server, closing");
            ws.close();
          }
        } catch (e) {
          console.warn(LOG, "socket: onmessage JSON parse error", e);
        }
      };

      ws.onerror = (ev) => {
        console.warn(LOG, "socket: onerror", ev);
        setLastWsError("WebSocket error.");
        setConnectionState("error");
      };

      ws.onclose = (ev) => {
        wsRef.current = null;
        console.log(LOG, "socket: onclose", {
          code: ev.code,
          reason: ev.reason || "(no reason)",
          wasClean: ev.wasClean,
          intentionalUnmount: intentionalUnmountRef.current,
        });
        if (intentionalUnmountRef.current) {
          setConnectionState("closed");
          return;
        }
        setConnectionState("closed");
        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        console.log(LOG, "socket: scheduling reconnect", { attempt, delayMs: delay });
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          openSocket();
        }, delay);
      };
    };

    openSocket();

    return () => {
      console.log(LOG, "socket: cleanup (leave /duel or wallet changed) — unsubscribe + close");
      intentionalUnmountRef.current = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      const w = wsRef.current;
      if (w) {
        try {
          const duelId = subscribedDuelIdRef.current;
          const payload = JSON.stringify(
            duelId ? { event: "unsubscribe", data: { duelId } } : { event: "unsubscribe", data: {} },
          );
          console.log(LOG, "socket: send on cleanup", payload);
          w.send(payload);
        } catch (e) {
          console.warn(LOG, "socket: unsubscribe send failed on cleanup", e);
        }
        w.close();
        wsRef.current = null;
      }
      subscribedDuelIdRef.current = null;
    };
  }, [walletAddress]);

  const subscribePositions = useCallback(
    (duelId: string) => {
      const id = duelId.trim();
      if (!id) {
        console.log(LOG, "subscribe: skipped — empty duelId");
        return;
      }
      if (!walletAddress) {
        console.log(LOG, "subscribe: skipped — no wallet");
        return;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(LOG, "subscribe: skipped — socket not OPEN", {
          hasSocket: Boolean(ws),
          readyState: ws?.readyState,
        });
        setLastWsError("WebSocket not connected — try again in a moment.");
        return;
      }
      const payload = {
        event: "subscribe",
        data: { duelId: id },
      };
      subscribedDuelIdRef.current = id;
      console.log(LOG, "subscribe: sending", payload);
      setPositions([]);
      setPnlHistoryByKey(new Map());
      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        console.warn(LOG, "subscribe: send failed", e);
        setLastWsError("Failed to send subscribe.");
      }
    },
    [walletAddress],
  );

  const unsubscribePositions = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log(LOG, "unsubscribe: skipped — socket not OPEN");
      return;
    }
    try {
      const duelId = subscribedDuelIdRef.current;
      const body = JSON.stringify(
        duelId ? { event: "unsubscribe", data: { duelId } } : { event: "unsubscribe", data: {} },
      );
      console.log(LOG, "unsubscribe: sending", body);
      ws.send(body);
    } catch (e) {
      console.warn(LOG, "unsubscribe: send failed", e);
    }
    subscribedDuelIdRef.current = null;
    setPositions([]);
    setPnlHistoryByKey(new Map());
  }, []);

  const value = useMemo<GainsRealtimeContextValue>(
    () => ({
      walletAddress,
      connectionState,
      lastWsError,
      positions,
      pnlHistoryByKey,
      subscribePositions,
      unsubscribePositions,
    }),
    [
      walletAddress,
      connectionState,
      lastWsError,
      positions,
      pnlHistoryByKey,
      subscribePositions,
      unsubscribePositions,
    ],
  );

  return (
    <GainsRealtimeContext.Provider value={value}>{children}</GainsRealtimeContext.Provider>
  );
}
