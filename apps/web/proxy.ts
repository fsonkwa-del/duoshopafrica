import { type NextRequest, NextResponse } from "next/server";

// Content Security Policy à nonce par requête (guide Next 16 « Content Security Policy »).
// - Scripts : uniquement ceux portant le nonce (Next l'applique pendant le rendu dynamique).
// - Styles : 'unsafe-inline' conservé pour les variables de marque posées en attribut style.
// - Images et envois de photos : origines du stockage objet lues dans l'environnement.
// - HTTPS seulement : upgrade-insecure-requests (casserait le développement local en HTTP).
const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
};

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const https = (process.env.WEB_ORIGIN ?? "").startsWith("https://");
  const media = origin(process.env.MEDIA_PUBLIC_BASE_URL);
  const storage = origin(
    process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT,
  );
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${media ? ` ${media}` : ""}`,
    "font-src 'self'",
    `connect-src 'self'${storage ? ` ${storage}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  if (https)
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  return response;
}

export const config = {
  matcher: [
    {
      // Pages seulement : ni fichiers statiques, ni API réécrite (/v1), ni préchargements.
      source: "/((?!v1/|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
