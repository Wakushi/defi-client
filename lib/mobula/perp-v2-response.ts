import type {
  PerpExecuteV2ExecutionDetail,
  PerpExecuteV2Response,
} from "@/lib/mobula/perp-v2-types"

/** Pick the tx hash of the create-order / group-order detail, or the first one available. */
export function pickOrderTxHash(
  res: PerpExecuteV2Response,
): string | undefined {
  const details = res.data.executionDetails
  if (!Array.isArray(details) || details.length === 0) return undefined
  const ordered =
    details.find(
      (d) =>
        d.type === "TX_TYPE_CREATE_ORDER" ||
        d.type === "TX_TYPE_CREATE_GROUP_ORDER",
    ) ?? details[0]
  return ordered?.txHash
}

/** Return the first non-filled/non-open status, if any, to surface a meaningful failure reason. */
export function pickRejectionReason(
  res: PerpExecuteV2Response,
): string | undefined {
  if (res.data.success) return undefined
  const details = res.data.executionDetails as
    | PerpExecuteV2ExecutionDetail[]
    | undefined
  if (!Array.isArray(details)) return undefined
  for (const d of details) {
    if (!d.orderStatuses) continue
    for (const s of d.orderStatuses) {
      if (s.status && s.status !== "filled" && s.status !== "open") {
        return s.status
      }
    }
  }
  return undefined
}
