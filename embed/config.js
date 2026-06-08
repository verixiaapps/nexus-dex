/* /embed/config.js  —  static runtime config for the SEO pages (GitHub Pages).
 * 
 * The SEO pages are served by GitHub Pages (verixiaapps.com), which has no
 * server, so the dynamic GET /embed/config.js route in server.js never runs
 * there. This static file fills that gap: it sets window.__VERIXIA_CONFIG__,
 * which the inline swap app reads for apiBase / rpc / wcProjectId.
 * 
 * Load it BEFORE the inline swap app:
 *     <script src="/embed/config.js"></script>
 *
 * Commit at /embed/config.js so GitHub Pages serves it verbatim.
 */
window.__VERIXIA_CONFIG__ = {
  // All /api/jupiter/* calls go here (Railway origin running server.js), since
  // the SEO pages' own origin has no API. CORS for verixiaapps.com is granted
  // via the ALLOWED_ORIGINS env var on Railway.
  apiBase: "https://swap.verixiaapps.com",

  // Solana RPC used directly by new Connection(RPC_URL) in the inline app.
  // Public mainnet-beta works out of the box; replace with your Helius URL
  // (https://mainnet.helius-rpc.com/?api-key=...) for higher rate limits.
  rpc: "https://api.mainnet-beta.solana.com",

  // WalletConnect projectId from cloud.reown.com. Leave "" to keep injected
  // wallets (Phantom/Solflare/Backpack) working with WalletConnect QR off.
  wcProjectId: ""
};
