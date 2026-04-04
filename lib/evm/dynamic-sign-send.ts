import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm"
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  getAddress,
  http,
  parseTransaction,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionSerializable,
} from "viem"

import { getFaucetChain } from "@/lib/evm/faucet-chain"
import type { UniswapApiTx } from "@/lib/uniswap/trade-gateway"

function formatSimulationRevert(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    )
    if (reverted instanceof ContractFunctionRevertedError) {
      if (reverted.reason) return reverted.reason
      if (reverted.signature)
        return `revert data (raw signature): ${reverted.signature}`
    }
    return error.details || error.shortMessage || error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Marge sur `estimateGas` : sur Arbitrum (et gros calldata type `openTrade`), le RPC peut
 * sous-estimer → `intrinsic gas too low` à l’`eth_sendRawTransaction`.
 */
function calldataByteLength(data: Hex): number {
  return Math.max(0, (data.length - 2) / 2)
}

function applyGasBuffer(estimatedGas: bigint, data: Hex): bigint {
  if (estimatedGas <= BigInt(0)) {
    throw new Error("estimateGas a renvoyé 0 — abandon avant signature.")
  }
  let out = (estimatedGas * BigInt(160)) / BigInt(100)
  if (out < estimatedGas + BigInt(120_000)) {
    out = estimatedGas + BigInt(120_000)
  }
  const byteLen = calldataByteLength(data)
  if (byteLen >= 100) {
    out += BigInt(200_000)
  }
  // Rollup (Arbitrum) : le nœud peut exiger une limite bien au-dessus de `estimateGas` (L1 data / intrinsic).
  const rawMin = process.env.FAUCET_CONTRACT_CALL_GAS_MIN?.trim()
  const minHeavy =
    rawMin && /^\d+$/.test(rawMin) ? BigInt(rawMin) : BigInt(8_000_000)
  if (byteLen >= 100 && out < minHeavy) {
    out = minHeavy
  }
  return out
}

/** Toujours en EIP-1559 : le fallback `legacy` produisait des txs mal tolérées par le rollup (intrinsic gas). */
async function getEip1559Fees(publicClient: PublicClient): Promise<{
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}> {
  try {
    const fees = await publicClient.estimateFeesPerGas()
    return {
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    }
  } catch {
    const block = await publicClient.getBlock({ blockTag: "latest" })
    const base = block.baseFeePerGas ?? BigInt(100_000_000)
    const maxPriorityFeePerGas = BigInt(150_000_000)
    const maxFeePerGas = base * BigInt(2) + maxPriorityFeePerGas
    return { maxFeePerGas, maxPriorityFeePerGas }
  }
}

/**
 * Aperçu `eth_call` — ne bloque pas si le revert vient du contrat (ex. Gains `openTrade` + oracle sur rollup).
 * On enchaîne avec `estimateGas` qui reflète souvent mieux l’exécution réelle.
 */
async function tryPreviewCallBeforeGas(
  publicClient: PublicClient,
  params: {
    account: Address
    to: Address
    data: Hex
    value?: bigint
  },
): Promise<void> {
  try {
    await publicClient.call({
      account: params.account,
      to: params.to,
      data: params.data,
      value: params.value ?? BigInt(0),
    })
  } catch (e) {
    console.warn(
      "[dynamicSignAndSend] eth_call preview reverted (ignored, using estimateGas):",
      formatSimulationRevert(e),
    )
  }
}

/** Build, sign with Dynamic MPC, broadcast raw tx (chaîne = `chain` ou FAUCET_* par défaut). */
export async function dynamicSignAndSendTransaction(params: {
  evmClient: DynamicEvmWalletClient
  walletAddress: Address
  to: Address
  data: Hex
  chain?: Chain
  /** Wei envoyés avec la tx (ETH natif ou autre valeur). */
  value?: bigint
}): Promise<`0x${string}`> {
  const chain = params.chain ?? getFaucetChain()
  const value = params.value ?? BigInt(0)
  const transport = http(chain.rpcUrls.default.http[0])
  const publicClient = createPublicClient({ chain, transport })

  const nonce = await publicClient.getTransactionCount({
    address: params.walletAddress,
  })

  await tryPreviewCallBeforeGas(publicClient, {
    account: params.walletAddress,
    to: params.to,
    data: params.data,
    value,
  })

  const estimated = await publicClient.estimateGas({
    account: params.walletAddress,
    to: params.to,
    data: params.data,
    value,
  })
  const gas = applyGasBuffer(estimated, params.data)
  const fees = await getEip1559Fees(publicClient)

  const tx: TransactionSerializable = {
    type: "eip1559",
    chainId: chain.id,
    nonce,
    to: params.to,
    data: params.data,
    value,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  }

  const serializedSigned = await params.evmClient.signTransaction({
    senderAddress: params.walletAddress,
    transaction: tx,
  })

  try {
    const parsed = parseTransaction(serializedSigned)
    const g =
      "gas" in parsed && parsed.gas != null
        ? (parsed.gas as bigint).toString()
        : "absent"
    console.log("[dynamicSignAndSend] après signature", {
      type: parsed.type,
      gasSigned: g,
      gasAttendu: gas.toString(),
      calldataBytes: calldataByteLength(params.data),
    })
  } catch {
    /* ignore */
  }

  return publicClient.sendRawTransaction({
    serializedTransaction: serializedSigned,
  })
}

/** Signe et envoie une `TransactionRequest` renvoyée par l’API Uniswap (avec `value` optionnel). */
export async function dynamicSignAndSendUniswapTx(params: {
  evmClient: DynamicEvmWalletClient
  walletAddress: Address
  tx: UniswapApiTx
  /** Réseau RPC utilisé pour nonce, gas et diffusion (doit correspondre à `tx.chainId`). */
  chain: Chain
}): Promise<`0x${string}`> {
  const { chain } = params
  if (Number(params.tx.chainId) !== chain.id) {
    throw new Error(
      `Uniswap transaction targets chain ${params.tx.chainId}; RPC client is for chain ${chain.id}.`,
    )
  }
  if (getAddress(params.tx.from) !== params.walletAddress) {
    throw new Error(
      'Transaction "from" field does not match the wallet.',
    )
  }

  const data = params.tx.data as Hex
  if (!data || data === "0x") {
    throw new Error("Invalid transaction: empty data field.")
  }

  const to = getAddress(params.tx.to as Address)
  const value = BigInt(params.tx.value ?? "0")

  const transport = http(chain.rpcUrls.default.http[0])
  const publicClient = createPublicClient({ chain, transport })

  let gas: bigint
  if (params.tx.gasLimit) {
    gas = BigInt(params.tx.gasLimit)
  } else {
    await tryPreviewCallBeforeGas(publicClient, {
      account: params.walletAddress,
      to,
      data,
      value,
    })
    const estimated = await publicClient.estimateGas({
      account: params.walletAddress,
      to,
      data,
      value,
    })
    gas = applyGasBuffer(estimated, data)
  }

  const nonce = await publicClient.getTransactionCount({
    address: params.walletAddress,
  })

  let serializable: TransactionSerializable

  if (params.tx.maxFeePerGas && params.tx.maxPriorityFeePerGas) {
    serializable = {
      type: "eip1559",
      chainId: chain.id,
      nonce,
      to,
      data,
      value,
      gas,
      maxFeePerGas: BigInt(params.tx.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(params.tx.maxPriorityFeePerGas),
    }
  } else if (params.tx.gasPrice) {
    serializable = {
      type: "legacy",
      chainId: chain.id,
      nonce,
      to,
      data,
      value,
      gas,
      gasPrice: BigInt(params.tx.gasPrice),
    }
  } else {
    const fees = await getEip1559Fees(publicClient)
    serializable = {
      type: "eip1559",
      chainId: chain.id,
      nonce,
      to,
      data,
      value,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    }
  }

  const serializedSigned = await params.evmClient.signTransaction({
    senderAddress: params.walletAddress,
    transaction: serializable,
  })

  return publicClient.sendRawTransaction({
    serializedTransaction: serializedSigned,
  })
}
