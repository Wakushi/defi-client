"use client";

import { useEffect, useState } from "react";

import { GameVsBanner } from "@/components/game-ui";
import {
  duelVsBannerForViewer,
  type DuelVsBannerSides,
} from "@/lib/duel/viewer-vs-order";

type ApiDuel = {
  creatorPseudo: string;
  opponentPseudo: string | null;
  viewer: { isCreator: boolean; isOpponent: boolean } | null;
  viewerAccountPseudo?: string | null;
};

type Props = {
  duelId: string;
  initial: DuelVsBannerSides;
};

/**
 * La bannière du lobby doit refléter la session du navigateur (créateur vs invité).
 * Le SSR seul peut être décalé (cache, cookie non lu) ; on resynchronise au montage.
 */
export function DuelLobbyVsBanner({ duelId, initial }: Props) {
  const [vs, setVs] = useState<DuelVsBannerSides>(initial);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/duels/${duelId}`, { credentials: "include" });
        if (!r.ok || cancelled) return;
        const d = (await r.json()) as ApiDuel & { error?: string };
        if (d.error || cancelled) return;
        setVs(
          duelVsBannerForViewer(
            d.creatorPseudo,
            d.opponentPseudo,
            d.viewer,
            "Waiting…",
            d.viewerAccountPseudo ?? null,
          ),
        );
      } catch {
        /* garde initial */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [duelId]);

  return (
    <GameVsBanner
      left={vs.left}
      right={vs.right}
      leftTag={vs.leftTag}
      rightTag={vs.rightTag}
    />
  );
}
