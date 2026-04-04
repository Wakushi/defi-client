import { sql } from "kysely";

import type { GainsApiChain } from "@/types/gains-api";
import type { DuelTradeSideConfig } from "@/types/duel-trade";

import { getDb } from "./index";

export type ReadyTuple = [number, number];

export function parseReadyState(value: unknown): ReadyTuple {
  if (Array.isArray(value) && value.length >= 2) {
    const a = Number(value[0]) ? 1 : 0;
    const b = Number(value[1]) ? 1 : 0;
    return [a, b];
  }
  if (typeof value === "string") {
    try {
      const j = JSON.parse(value) as unknown;
      return parseReadyState(j);
    } catch {
      /* fall */
    }
  }
  return [0, 0];
}

export function parseDuelTradeConfig(value: unknown): DuelTradeSideConfig | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const pairIndex = Number(o.pairIndex);
  const leverageX = Number(o.leverageX);
  const long = Boolean(o.long);
  const tradeType =
    typeof o.tradeType === "number" && Number.isInteger(o.tradeType)
      ? o.tradeType
      : undefined;
  const referencePrice =
    typeof o.referencePrice === "number" && Number.isFinite(o.referencePrice) && o.referencePrice > 0
      ? o.referencePrice
      : undefined;
  const gc = o.gainsChain;
  let gainsChain: GainsApiChain | undefined;
  if (gc === "Testnet" || gc === "Arbitrum" || gc === "Base") {
    gainsChain = gc;
  }
  if (!Number.isFinite(pairIndex) || !Number.isFinite(leverageX)) return null;
  return { pairIndex, leverageX, long, tradeType, referencePrice, gainsChain };
}

export async function markParticipantTradeReady(params: {
  duelId: string;
  isCreator: boolean;
  config: DuelTradeSideConfig;
}) {
  return getDb()
    .transaction()
    .execute(async (trx) => {
      const duel = await trx
        .selectFrom("duels")
        .selectAll()
        .where("id", "=", params.duelId)
        .forUpdate()
        .executeTakeFirst();

      if (!duel) {
        return { ok: false as const, error: "not_found" as const };
      }

      const rs = parseReadyState(duel.ready_state);
      const idx = params.isCreator ? 0 : 1;
      if (rs[idx] === 1) {
        return {
          ok: true as const,
          readyState: rs,
          bothReady: rs[0] === 1 && rs[1] === 1,
          readyBothAtIso: duel.ready_both_at
            ? duel.ready_both_at.toISOString()
            : null,
          already: true as const,
        };
      }

      rs[idx] = 1;
      const bothNow = rs[0] === 1 && rs[1] === 1;
      const anchorDate: Date | null =
        bothNow && duel.ready_both_at === null ? new Date() : duel.ready_both_at;

      const configJson = JSON.stringify(params.config);
      const readyJson = JSON.stringify(rs);

      const baseSet = {
        ready_state: sql`(${sql.lit(readyJson)})::jsonb`,
        ready_both_at: anchorDate,
        updated_at: new Date(),
      };

      if (params.isCreator) {
        await trx
          .updateTable("duels")
          .set({
            ...baseSet,
            creator_trade_config: sql`(${sql.lit(configJson)})::jsonb`,
            ...(params.config.gainsChain
              ? { creator_chain: params.config.gainsChain }
              : {}),
          })
          .where("id", "=", params.duelId)
          .execute();
      } else {
        await trx
          .updateTable("duels")
          .set({
            ...baseSet,
            opponent_trade_config: sql`(${sql.lit(configJson)})::jsonb`,
            ...(params.config.gainsChain
              ? { opponent_chain: params.config.gainsChain }
              : {}),
          })
          .where("id", "=", params.duelId)
          .execute();
      }

      return {
        ok: true as const,
        readyState: rs,
        bothReady: bothNow,
        readyBothAtIso: anchorDate ? anchorDate.toISOString() : null,
        already: false as const,
      };
    });
}
