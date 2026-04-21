import { type NextRequest, NextResponse } from "next/server"
import { getAddress } from "viem"

import { getSessionFromRequest } from "@/lib/auth/session"
import { findUserById } from "@/lib/db/users"
import { getDuelDefiApiBaseUrl } from "@/lib/duel-defi/api-base"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }

  const user = await findUserById(session.userId)
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 })
  }

  if (!user.wallet_address) {
    return NextResponse.json(
      { error: "No wallet address on this account." },
      { status: 400 },
    )
  }

  let wallet: string
  try {
    wallet = getAddress(user.wallet_address as `0x${string}`)
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet address." },
      { status: 500 },
    )
  }

  const base = getDuelDefiApiBaseUrl()
  const url = `${base}/perp-positions/open/${wallet}`
  console.log("[perp-positions/open] GET", { url, wallet })

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[perp-positions/open] upstream not ok", {
        status: res.status,
        statusText: res.statusText,
        body: text.slice(0, 400),
      })
      return NextResponse.json(
        { error: `Upstream ${res.status}`, detail: text.slice(0, 200) },
        { status: 502 },
      )
    }
    const data = await res.json()

    return NextResponse.json(data)
  } catch (e) {
    console.error("[perp-positions/open] fetch failed", e)
    return NextResponse.json(
      { error: "Failed to fetch positions." },
      { status: 502 },
    )
  }
}
