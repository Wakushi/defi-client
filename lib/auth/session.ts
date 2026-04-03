import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "defiduel_session";

function getSecretKey() {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "SESSION_SECRET is required (min 32 characters). Generate a random string for .env.local",
    );
  }
  return new TextEncoder().encode(raw);
}

function sessionMaxAgeSec() {
  const n = Number(process.env.SESSION_MAX_AGE_SEC);
  if (Number.isInteger(n) && n > 0) return n;
  return 60 * 60 * 24 * 7;
}

export async function signSessionToken(userId: string, pseudo: string) {
  return new SignJWT({ pseudo })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${sessionMaxAgeSec()}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, getSecretKey());
  if (!payload.sub || typeof payload.pseudo !== "string") {
    throw new Error("Invalid session payload");
  }
  return { userId: payload.sub, pseudo: payload.pseudo };
}

export function baseSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: sessionMaxAgeSec(),
  };
}

export async function attachSessionCookie(
  res: NextResponse,
  userId: string,
  pseudo: string,
) {
  const token = await signSessionToken(userId, pseudo);
  res.cookies.set(SESSION_COOKIE_NAME, token, baseSessionCookieOptions());
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionFromRequest(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}
