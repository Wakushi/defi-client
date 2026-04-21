import {
  createPublicClient,
  http,
  type Chain,
  type TransactionSerializable,
} from "viem"

import type { PerpSigner } from "@/lib/mobula/dynamic-perp-signer"
import type {
  ClosePositionV2Params,
  CreateOrderV2Params,
  EvmTxPayloadInner,
  PerpExecuteV2RequestBody,
  PerpExecuteV2Response,
  PerpPayloadResponse,
} from "@/lib/mobula/perp-v2-types"

const DEFAULT_MOBULA_URL = "https://api.mobula.io"

/**
 * Arbitrum-style rollups routinely under-estimate gas for heavy Gains calldata like `openTrade`,
 * producing `intrinsic gas too low` on broadcast. Mirror the buffer applied in `dynamic-sign-send.ts`:
 * 1.6× + 120k floor, +200k for heavy calldata, and a hard minimum of 8M for heavy calldata on rollups.
 */
function applyGasBuffer(estimatedGas: bigint, callData: `0x${string}`): bigint {
  if (estimatedGas <= BigInt(0)) return BigInt(1_500_000)
  let out = (estimatedGas * BigInt(160)) / BigInt(100)
  if (out < estimatedGas + BigInt(120_000)) {
    out = estimatedGas + BigInt(120_000)
  }
  const byteLen = Math.max(0, (callData.length - 2) / 2)
  if (byteLen >= 100) {
    out += BigInt(200_000)
    if (out < BigInt(8_000_000)) out = BigInt(8_000_000)
  }
  return out
}

export type PerpInteractionControllerDeps = {
  baseUrl?: string
  apiKey: string
  signer: PerpSigner
  /** Required when `transport === 'evm-tx'` (Gains). Given the payload chain id, return a viem `Chain`. */
  resolveChain?: (chainId: number) => Chain | undefined
}

function assertOk(res: Response, body: string): void {
  if (res.ok) return
  throw new Error(
    `Mobula ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 400)}` : ""}`,
  )
}

export class PerpInteractionController {
  private readonly baseUrl: string

  constructor(private readonly deps: PerpInteractionControllerDeps) {
    this.baseUrl = (deps.baseUrl ?? DEFAULT_MOBULA_URL).replace(/\/$/, "")
    console.log(
      `PerpInteractionController initialized with url ${this.baseUrl}`,
    )
  }

  async createOrder(
    params: CreateOrderV2Params,
  ): Promise<PerpExecuteV2Response> {
    return this.run({
      endpoint: "/api/2/perp/payloads/create-order",
      action: "create-order",
      params: params as unknown as Record<string, unknown>,
    })
  }

  async closePosition(
    params: ClosePositionV2Params,
  ): Promise<PerpExecuteV2Response> {
    return this.run({
      endpoint: "/api/2/perp/payloads/close-position",
      action: "close-position",
      params: params as unknown as Record<string, unknown>,
    })
  }

  private async run({
    endpoint,
    action,
    params,
  }: {
    endpoint: string
    action: "create-order" | "close-position"
    params: Record<string, unknown>
  }): Promise<PerpExecuteV2Response> {
    const timestamp = Date.now()

    const signature = await this.deps.signer.signMessage(
      `${endpoint.slice(1)}-${timestamp}`,
    )

    const payloadRes = await this.post<{ data: PerpPayloadResponse }>(
      endpoint,
      { ...params, timestamp, signature },
    )
    const payload = payloadRes.data

    let signedTx: string | undefined
    if (payload.transport === "evm-tx") {
      signedTx = await this.signEvmPayload(payload.payloadStr)
    }

    const executeTimestamp = Date.now()
    const executeSig = await this.deps.signer.signMessage(
      `api/2/perp/execute-v2-${executeTimestamp}-${payload.payloadStr}`,
    )

    const executeBody: PerpExecuteV2RequestBody = {
      action,
      dex: payload.dex,
      chainId: payload.chainId,
      marketId: payload.marketId,
      transport: payload.transport,
      payloadStr: payload.payloadStr,
      timestamp: executeTimestamp,
      signature: executeSig,
      ...(signedTx ? { signedTx } : {}),
    }

    return this.post<PerpExecuteV2Response>(
      "/api/2/perp/execute-v2",
      executeBody as unknown as Record<string, unknown>,
    )
  }

  private async signEvmPayload(payloadStr: string): Promise<`0x${string}`> {
    if (!this.deps.resolveChain) {
      throw new Error(
        "Mobula returned transport=evm-tx but no resolveChain was provided.",
      )
    }

    const parsed = JSON.parse(payloadStr) as EvmTxPayloadInner
    const txData = parsed.payload.data
    // `data.chainId` is optional; fall back to the outer envelope (always a string).
    const chainIdNum =
      typeof txData.chainId === "number" && txData.chainId > 0
        ? txData.chainId
        : Number(parsed.chainId)
    if (!Number.isInteger(chainIdNum) || chainIdNum <= 0) {
      throw new Error("Mobula payload is missing chainId.")
    }

    const chain = this.deps.resolveChain(chainIdNum)
    if (!chain) {
      throw new Error(`No chain configured for id ${chainIdNum}.`)
    }

    const publicClient = createPublicClient({
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
    })

    const nonce =
      txData.nonce ??
      (await publicClient.getTransactionCount({
        address: this.deps.signer.address,
      }))

    const feeData = await publicClient.estimateFeesPerGas().catch(async () => {
      const block = await publicClient.getBlock({ blockTag: "latest" })
      const base = block.baseFeePerGas ?? BigInt(100_000_000)
      const maxPriorityFeePerGas = BigInt(150_000_000)
      return {
        maxFeePerGas: base * BigInt(2) + maxPriorityFeePerGas,
        maxPriorityFeePerGas,
      }
    })

    const value = txData.value ? BigInt(txData.value) : BigInt(0)

    const callData = txData.callData as `0x${string}`
    const gasLimit = txData.gas
      ? BigInt(txData.gas)
      : applyGasBuffer(
          await publicClient
            .estimateGas({
              account: this.deps.signer.address,
              to: txData.to as `0x${string}`,
              data: callData,
              value,
            })
            .catch(() => BigInt(0)),
          callData,
        )

    const tx: TransactionSerializable = {
      type: "eip1559",
      chainId: chainIdNum,
      nonce,
      to: txData.to as `0x${string}`,
      data: callData,
      value,
      gas: gasLimit,
      maxFeePerGas: txData.maxFeePerGas
        ? BigInt(txData.maxFeePerGas)
        : feeData.maxFeePerGas,
      maxPriorityFeePerGas: txData.maxPriorityFeePerGas
        ? BigInt(txData.maxPriorityFeePerGas)
        : feeData.maxPriorityFeePerGas,
    }

    return this.deps.signer.signTransaction(tx)
  }

  private async post<T>(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.deps.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    assertOk(res, text)
    return text ? (JSON.parse(text) as T) : ({} as T)
  }
}
