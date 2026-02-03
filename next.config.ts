import type { NextConfig } from "next";

const cspDirectives = [
  "default-src 'self'",
  // Next.js requires unsafe-inline + unsafe-eval for its runtime
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // Images: self + coingecko (token logos) + cloudinary (avatars) + data/blob URIs
  "img-src 'self' data: blob: https://coin-images.coingecko.com https://assets.coingecko.com https://www.coingecko.com https://res.cloudinary.com",
  // API connections: self + Privy auth + Convex realtime + CoinGecko prices + Jupiter + Solana RPC
  "connect-src 'self' https://*.privy.io https://*.convex.cloud wss://*.convex.cloud https://api.coingecko.com https://pro-api.coingecko.com https://*.jup.ag https://*.helius-rpc.com https://api.helius.xyz https://api.mainnet-beta.solana.com https://api.cdp.coinbase.com https://*.walletconnect.com wss://*.walletconnect.org https://*.walletconnect.org",
  // Privy auth modal + onramp providers
  "frame-src https://*.privy.io https://*.moonpay.com https://*.coinbase.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "coin-images.coingecko.com",
        pathname: "/**",
      },
      // optional but recommended (future-proofing)
      {
        protocol: "https",
        hostname: "assets.coingecko.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.coingecko.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
