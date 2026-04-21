/** POST /api/2/perp/payloads/create-order body (without timestamp/signature). */
export interface CreateOrderV2Params {
  baseToken: string
  quote: string
  leverage: number
  long: boolean
  reduceOnly: boolean
  collateralAmount: number
  orderType?: "market" | "limit" | "stop_limit"
  openPrice?: number
  tp?: number
  sl?: number
  amountRaw?: number
  maxSlippageP?: number
  marginMode?: 0 | 1
  referrer?: string
  marketId?: string
  chainIds?: string[]
  dexes?: ("gains" | "lighter")[]
}

/** POST /api/2/perp/payloads/close-position body (without timestamp/signature). */
export interface ClosePositionV2Params {
  dex: "lighter" | "gains"
  chainId: string
  marketId: string
  positionId?: string
  closePercentage?: number
  amountRaw?: number
  params?: Record<string, unknown>
}

export interface PerpPayloadResponse {
  action: "create-order" | "close-position"
  dex: string
  chainId: string
  transport: "offchain-api" | "evm-tx"
  marketId?: string
  payloadStr: string
}

export interface EvmTxPayloadInner {
  action: string
  dex: string
  chainId: string
  marketId: string
  transport: "evm-tx"
  payload: {
    type: "evm"
    orderType: "market" | "limit" | "stop_limit"
    tp?: number
    sl?: number
    data: {
      from?: string
      to: string
      callData: string
      value?: string
      chainId?: number
      nonce?: number
      gas?: string
      gasPrice?: string
      maxFeePerGas?: string
      maxPriorityFeePerGas?: string
    }
  }
}

export interface PerpExecuteV2RequestBody {
  action: string
  dex: string
  chainId: string
  marketId?: string
  transport: "offchain-api" | "evm-tx"
  payloadStr: string
  timestamp: number
  signature: string
  signedTx?: string
}

export interface PerpExecuteV2ExecutionDetail {
  txHash: string
  type: string
  status: string
  orderStatuses?: { orderId: string; status: string; type: string }[]
}

export interface PerpExecuteV2Response {
  data: {
    success: boolean
    executionDetails: PerpExecuteV2ExecutionDetail[]
    processId?: string
  }
}
