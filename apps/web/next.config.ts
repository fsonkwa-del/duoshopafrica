import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "@duoshop/ui",
    "@duoshop/config",
    "@duoshop/domain",
    "@duoshop/i18n",
    "@duoshop/sdk",
    "@duoshop/types",
  ],
  // Même origine en développement comme derrière le reverse proxy : cookies et Origin cohérents.
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
    return [{ source: "/v1/:path*", destination: `${api}/v1/:path*` }];
  },
  async redirects() {
    return [{ source: "/", destination: "/fr", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
