import { randomBytes } from "node:crypto";
import type { Shopper } from "@duoshop/sdk";
import { CART_COOKIE, SESSION_COOKIE } from "@duoshop/types";
import { cookies } from "next/headers";

export const apiUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
export const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
export const sessionCookie = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax",
} as const;

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

// Acheteur courant : session de compte et/ou panier visiteur.
export async function shopper(): Promise<Shopper> {
  const jar = await cookies();
  return {
    session: jar.get(SESSION_COOKIE)?.value ?? null,
    cart: jar.get(CART_COOKIE)?.value ?? null,
  };
}

// Actions serveur uniquement : pose le jeton de panier visiteur s'il manque (30 jours).
// Il est aussi posé pour un client connecté : si sa session expire, son panier reste utilisable.
export async function ensureShopper(): Promise<Shopper> {
  const current = await shopper();
  if (current.cart) return current;
  const cart = randomBytes(32).toString("base64url");
  (await cookies()).set(CART_COOKIE, cart, {
    ...sessionCookie,
    maxAge: 30 * 24 * 3600,
  });
  return { ...current, cart };
}
