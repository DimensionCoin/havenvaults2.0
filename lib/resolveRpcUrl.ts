// lib/resolveRpcUrl.ts
/**
 * Resolves the RPC URL for client-side use.
 * When NEXT_PUBLIC_SOLANA_RPC is a relative path like "/api/rpc",
 * @solana/web3.js Connection requires an absolute URL.
 *
 * During SSR (no `window`), falls back to the public Solana RPC so the
 * Connection constructor doesn't throw. The actual RPC calls only happen
 * client-side where window.location.origin is available.
 */
export function resolveRpcUrl(raw: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (typeof window !== "undefined") {
    const normalized = raw.startsWith("/") ? raw : `/${raw}`;
    return `${window.location.origin}${normalized}`;
  }
  return "https://api.mainnet-beta.solana.com";
}
