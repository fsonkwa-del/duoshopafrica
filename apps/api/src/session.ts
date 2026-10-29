import {
  asRuntime,
  type Database,
  hashSessionToken,
  issueSessionToken,
} from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import type { FastifyRequest } from "fastify";

// Valeurs proposées dans SECURITY.md (12 h absolue, 30 min d'inactivité), à valider.
export const SESSION_ABSOLUTE_MS = 12 * 3600_000;
export const SESSION_IDLE_MS = 30 * 60_000;
const TOUCH_EVERY_MS = 60_000;

export interface Principal {
  sessionId: string;
  userId: string;
  mfa: boolean;
}

export function readCookie(
  request: FastifyRequest,
  cookie: string,
): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === cookie) {
      const token = value.join("=");
      // Jetons émis : 32 octets base64url => 43 caractères ; tout le reste est rejeté sans requête DB.
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    }
  }
  return null;
}

export async function authenticate(
  db: Database,
  request: FastifyRequest,
): Promise<Principal | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const now = Date.now();
  return asRuntime(db, {}, async (tx) => {
    const session = await tx.session.findFirst({
      where: {
        tokenHash: hashSessionToken(token),
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
        lastSeenAt: { gt: new Date(now - SESSION_IDLE_MS) },
      },
      select: { id: true, userId: true, mfa: true, lastSeenAt: true },
    });
    if (!session) return null;
    if (now - session.lastSeenAt.getTime() > TOUCH_EVERY_MS)
      await tx.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    return { sessionId: session.id, userId: session.userId, mfa: session.mfa };
  });
}

export async function openSession(
  db: Database,
  userId: string,
  mfa: boolean,
): Promise<string> {
  const { token, tokenHash } = issueSessionToken();
  await asRuntime(db, {}, (tx) =>
    tx.session.create({
      data: {
        userId,
        tokenHash,
        mfa,
        expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
      },
    }),
  );
  return token;
}

export function cookieHeader(name: string, value: string, maxAgeS: number) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}`;
}
export const clearSessionCookie = cookieHeader(SESSION_COOKIE, "", 0);
