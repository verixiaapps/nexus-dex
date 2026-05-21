// ─────────────────────────────────────────────────────────────────────
// Predict.jsx — Polymarket prediction markets via Solana + Safe wallets.
//
// ARCHITECTURE (v3 — Safe path, matches Polymarket's official reference
// examples privy-safe-builder-example, turnkey-safe-builder-example, etc):
//   • Each user has a Polymarket Safe wallet (Gnosis Safe proxy) on Polygon.
//     Address is deterministic from owner EOA via deriveSafe(). Same EOA
//     always gets same safe — meaning a user who has used polymarket.com
//     before will land in their existing safe with their existing balance.
//   • We derive the owner EOA from the user's Solana wallet signature.
//     EOA private key lives in sessionStorage only (non-custodial).
//   • All Polygon-side ops use Polymarket's official SDKs:
//     - @polymarket/clob-client-v2       (orders, CLOB API — V2, Safe sig type 2)
//     - @polymarket/builder-relayer-client (safe deploy, approvals batch)
//     - @polymarket/builder-signing-sdk   (HMAC BuilderConfig for relayer)
//     Backend exposes /api/poly/sign for HMAC headers; secrets stay server-side.
//     Order attribution via builderCode field per order.
//
// FLOW per new user (FIRST TRADE):
//   1. Phantom prompt #1: derivation message → EOA private key in sessionStorage
//   2. SILENT: derive safe address (deterministic from EOA via CREATE2)
//   3. SILENT: deploy safe via RelayClient.deploy() (gasless, ~30s)
//   4. SILENT: derive CLOB API creds via L1 EIP-712 (signed by EOA)
//   5. SILENT: batch-approve USDC.e + ERC-1155 contracts via RelayClient.execute()
//   6. Phantom prompt #2: signed Solana SPL tx (bridge USDC + 5% to our wallet)
//   7. Bridge converts USDC → pUSD into the user's safe (~30s)
//   8. SILENT: SDK signs order + posts to CLOB with builder code attribution
//
// FLOW per existing user (SUBSEQUENT TRADES):
//   Same but steps 1, 3, 4, 5 skip if cached. Result: ONE Phantom prompt
//   per trade (the Solana tx). Existing polymarket.com users skip 3+5.
//
// FEES:
//   • 5% on Solana deposits → our fee wallet, same atomic tx as bridge
//   • Sells: free
//   • Withdraws: free (Polymarket pays gas via relayer)
//
// NON-CUSTODIAL:
//   • EOA private key derived from user's Solana signature (browser only).
//   • Safe is owned 1-of-1 by user's EOA. We can't move funds.
//   • Our role: bridge fee skim on Solana + interface only.
// ─────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  VersionedTransaction, TransactionInstruction, TransactionMessage, PublicKey,
} from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// CLOB SDK + viem are loaded lazily (only when a trade actually fires),
// so they don't bloat the initial bundle and don't interfere with market
// browsing for non-trading users.

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

const VIP_WALLETS = new Set(['Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV']);

// 5% Solana-side fee, captured in the same atomic SPL tx as the bridge deposit.
const SERVICE_FEE_PCT    = 0.05;
const FEE_RECIPIENT_SOL  = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';

// Backend proxy (Express on Railway). Holds builder API creds.
const POLY_PROXY = '/api/poly';

// Public Polymarket APIs (no auth needed for these).
const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com';
const GAMMA_URL           = 'https://gamma-api.polymarket.com';
const DATA_API_URL        = 'https://data-api.polymarket.com';
const CRYPTO_TAG_ID       = 21;

// Solana constants
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS    = 6;
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID   = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SOL_RPC          = '/api/solana-rpc';

// Polygon contracts — verified against https://docs.polymarket.com/resources/contracts (May 2026)
const POLYGON_CHAIN_ID            = 137;
const SAFE_FACTORY                = '0xaacfeea03eb1561c4e67d661e40682bd20e3541b';
const CTF_EXCHANGE                = '0xE111180000d2663C0091e4f400237545B87B996B';  // CTF Exchange V2
const NEG_RISK_CTF_EXCHANGE       = '0xe2222d279d744050d28e00520010520000310F59';
const NEG_RISK_ADAPTER            = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CONDITIONAL_TOKENS_ADDRESS  = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_E_ADDRESS              = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const PUSD_ADDRESS                = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';

const RELAYER_URL = 'https://relayer-v2.polymarket.com/';

// Minimum deposit accepted by the bridge for Solana USDC.
const MIN_DEPOSIT_USD = 5;

// Geo block
const GEO_URL       = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_CACHE_KEY = 'verixia_geo_country_v1';
const GEO_CACHE_TTL = 12 * 60 * 60 * 1000;
const US_BLOCK      = new Set(['US']);

const DERIVATION_MSG = (pub) =>
  `Authorize Polymarket Account\n\nCreates your trading wallet on Polygon. Only you control it. No funds move with this signature.`;

// ═══════════════════════════════════════════════════════════════════
// DESIGN TOKENS (unchanged from v1)
// ═══════════════════════════════════════════════════════════════════

const C = {
  bg: '#03060f', card: '#080d1a', cardHi: '#0c1428',
  ink: '#e8ecf5', inkStr: '#f5fafe', muted: '#8a96b8', muted2: '#475670',
  border: 'rgba(151,252,228,.10)', borderHi: 'rgba(151,252,228,.30)',
  hl: '#97fce4', hl2: '#5ce9c8', hlDim: 'rgba(151,252,228,.10)',
  violet: '#a87fff',
  yes: '#00d4a3', yesDim: 'rgba(0,212,163,.12)',
  no: '#ff5f7a', noDim: 'rgba(255,95,122,.12)',
  amber: '#f5b53d',
  shadow: '0 8px 28px rgba(0,0,0,.45)',
  shadowLg: '0 18px 56px rgba(0,0,0,.55)',
};
const T = {
  body:    { fontFamily: 'DM Sans, system-ui, sans-serif' },
  display: { fontFamily: 'Syne, Inter, sans-serif' },
  mono:    { fontFamily: 'IBM Plex Mono, monospace' },
};

// ═══════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)   return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
}

function formatVol(n) {
  if (!n || n <= 0) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function timeUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Resolving';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d >= 30) return `${Math.floor(d / 30)}mo`;
  if (d >= 1)  return `${d}d ${h}h`;
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function formatEndDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'Resolving';
  const shortMonth = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  if (ms < 7 * 86400000) {
    const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
    let tz = '';
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      if (tzPart) tz = ' ' + tzPart.value;
    } catch {}
    return `Ends ${shortMonth} ${day}, ${time}${tz}`;
  }
  if (d.getFullYear() === new Date().getFullYear()) return `Ends ${shortMonth} ${day}`;
  return `Ends ${shortMonth} ${day}, ${d.getFullYear()}`;
}

function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}

let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
}

// ═══════════════════════════════════════════════════════════════════
// GEO
// ═══════════════════════════════════════════════════════════════════

async function detectCountry() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (raw) {
      const { country, ts } = JSON.parse(raw);
      if (country && Date.now() - ts < GEO_CACHE_TTL) return country;
    }
  } catch {}
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(GEO_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    const loc = (text.match(/loc=([A-Z]{2})/) || [])[1] || null;
    if (loc) {
      try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ country: loc, ts: Date.now() })); } catch {}
    }
    return loc;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// ETHERS (lazy loaded — only when needed for trading)
// ═══════════════════════════════════════════════════════════════════

let _ethersModule = null;
async function getEthers() {
  if (_ethersModule) return _ethersModule;
  _ethersModule = await import('ethers');
  return _ethersModule;
}
function getEthersNs(mod) {
  if (!mod) return null;
  if (mod.ethers?.Wallet) return mod.ethers;
  if (mod.Wallet)          return mod;
  if (mod.default?.Wallet) return mod.default;
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// SESSION STORAGE (EOA private key + L2 creds)
// Non-custodial: key derived deterministically from user's Solana sig,
// kept in sessionStorage only. We never see it.
// ═══════════════════════════════════════════════════════════════════

function getSessionEoa(solPub) {
  try {
    const raw = sessionStorage.getItem('verixia_poly_eoa_' + solPub);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setSessionEoa(solPub, address, privateKey) {
  try { sessionStorage.setItem('verixia_poly_eoa_' + solPub, JSON.stringify({ address, privateKey })); } catch {}
}
function getSessionCreds(eoaAddr) {
  try {
    const raw = sessionStorage.getItem('verixia_clob_creds_' + eoaAddr.toLowerCase());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setSessionCreds(eoaAddr, creds) {
  try { sessionStorage.setItem('verixia_clob_creds_' + eoaAddr.toLowerCase(), JSON.stringify(creds)); } catch {}
}
function getKnownSafe(solPub) {
  try { return localStorage.getItem('verixia_safe_' + solPub) || null; }
  catch { return null; }
}
function setKnownSafe(solPub, addr) {
  try { localStorage.setItem('verixia_safe_' + solPub, addr); } catch {}
}
function getSafeDeployed(solPub) {
  try { return localStorage.getItem('verixia_safe_deployed_' + solPub) === '1'; }
  catch { return false; }
}
function setSafeDeployed(solPub) {
  try { localStorage.setItem('verixia_safe_deployed_' + solPub, '1'); } catch {}
}
function getApprovalsSet(solPub) {
  try { return localStorage.getItem('verixia_safe_approvals_' + solPub) === '1'; }
  catch { return false; }
}
function setApprovalsSet(solPub) {
  try { localStorage.setItem('verixia_safe_approvals_' + solPub, '1'); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// EOA DERIVATION FROM SOLANA SIG
// One Solana signature → deterministic Ethereum private key.
// User can always regenerate the same EOA from the same Solana wallet.
// ═══════════════════════════════════════════════════════════════════

async function deriveEoa(signMessage, solPub) {
  const cached = getSessionEoa(solPub);
  if (cached) return cached;
  const encoded = new TextEncoder().encode(DERIVATION_MSG(solPub));
  const sig     = await signMessage(encoded);
  const hash    = await crypto.subtle.digest('SHA-256', sig);
  const pk      = '0x' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  const ethersNs = getEthersNs(await getEthers());
  const wallet  = new ethersNs.Wallet(pk);
  const result  = { address: wallet.address, privateKey: pk };
  setSessionEoa(solPub, wallet.address, pk);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// POLYMARKET SDK LOADING (lazy — only when trade fires)
//
// Polymarket V2 cutover was April 28, 2026. V1 SDK no longer works in
// production — must use clob-client-v2 for orders.
//
//   • @polymarket/clob-client-v2       — orders + L1 API creds (V2).
//                                        Constructor takes options object.
//                                        Accepts viem walletClient.
//                                        Supports signatureType 2 (Safe).
//   • @polymarket/builder-relayer-client — safe deploy + batched approvals.
//                                        Uses ethers v5 signer + HMAC BuilderConfig.
//   • @polymarket/builder-signing-sdk  — BuilderConfig with remoteBuilderConfig
//                                        points SDK to our /api/poly/sign so
//                                        the builder secret never reaches browser.
//   • viem                              — wallet client for the V2 SDK.
// ═══════════════════════════════════════════════════════════════════

let _clobSdk = null;
let _relayerSdk = null;
let _signingSdk = null;
let _viem = null;
let _viemAccounts = null;

async function loadSdks() {
  if (_clobSdk && _relayerSdk && _signingSdk && _viem && _viemAccounts) {
    return {
      clob: _clobSdk, relayer: _relayerSdk, signing: _signingSdk,
      viem: _viem, viemAccounts: _viemAccounts,
    };
  }
  const [clob, relayer, signing, viem, viemAccounts, deriveMod, configMod] = await Promise.all([
    import('@polymarket/clob-client-v2'),
    import('@polymarket/builder-relayer-client'),
    import('@polymarket/builder-signing-sdk'),
    import('viem'),
    import('viem/accounts'),
    // deriveSafe and getContractConfig live in subpath imports per reference example.
    import('@polymarket/builder-relayer-client/dist/builder/derive').catch(() => null),
    import('@polymarket/builder-relayer-client/dist/config').catch(() => null),
  ]);
  _clobSdk       = clob;
  _relayerSdk    = { ...relayer, _derive: deriveMod, _config: configMod };
  _signingSdk    = signing;
  _viem          = viem;
  _viemAccounts  = viemAccounts;
  return { clob, relayer: _relayerSdk, signing, viem, viemAccounts };
}

// BuilderConfig for the Relayer (HMAC via remote signing).
// Points the SDK at our /api/poly/sign endpoint; builder secret never
// touches the browser. ALSO used by the authenticated CLOB client for
// builder order attribution per Polymarket reference example.
function buildRelayerBuilderConfig(signing) {
  const { BuilderConfig } = signing;
  return new BuilderConfig({
    remoteBuilderConfig: { url: `${POLY_PROXY}/sign` },
  });
}

// Build an ethers v5 signer for builder-relayer-client (still ethers-based).
async function buildEthersSigner(eoaPrivateKey) {
  const ethersNs = getEthersNs(await getEthers());
  let provider = null;
  try {
    if (ethersNs.providers?.JsonRpcProvider) {
      provider = new ethersNs.providers.JsonRpcProvider('https://polygon-rpc.com', POLYGON_CHAIN_ID);
    } else if (ethersNs.JsonRpcProvider) {
      provider = new ethersNs.JsonRpcProvider('https://polygon-rpc.com');
    }
  } catch {}
  const pk = eoaPrivateKey.startsWith('0x') ? eoaPrivateKey : ('0x' + eoaPrivateKey);
  return new ethersNs.Wallet(pk, provider);
}

// Build a viem walletClient for clob-client-v2.
async function buildViemWalletClient(eoaPrivateKey) {
  const { viem, viemAccounts } = await loadSdks();
  const { createWalletClient, http } = viem;
  const { privateKeyToAccount } = viemAccounts;
  const pk = eoaPrivateKey.startsWith('0x') ? eoaPrivateKey : ('0x' + eoaPrivateKey);
  const account = privateKeyToAccount(pk);
  return createWalletClient({ account, transport: http('https://polygon-rpc.com') });
}

// ═══════════════════════════════════════════════════════════════════
// SAFE ADDRESS DERIVATION + DEPLOYMENT
// Same EOA → same safe address always (CREATE2). User who has used
// polymarket.com before with this EOA lands in their existing safe
// with their existing balance.
// ═══════════════════════════════════════════════════════════════════

async function deriveSafeAddress(eoaAddress) {
  const { relayer } = await loadSdks();
  const derive = relayer._derive;
  const cfg    = relayer._config;
  if (!derive?.deriveSafe || !cfg?.getContractConfig) {
    throw new Error('SDK derive helpers not available — check @polymarket/builder-relayer-client version');
  }
  const config = cfg.getContractConfig(POLYGON_CHAIN_ID);
  return derive.deriveSafe(eoaAddress, config.SafeContracts.SafeFactory);
}

async function buildRelayClient(eoaPrivateKey) {
  const { relayer, signing } = await loadSdks();
  const { RelayClient } = relayer;
  const signer = await buildEthersSigner(eoaPrivateKey);
  const builderConfig = buildRelayerBuilderConfig(signing);
  // 5th arg defaults to RelayerTxType.SAFE per SDK README.
  return new RelayClient(RELAYER_URL, POLYGON_CHAIN_ID, signer, builderConfig);
}

async function ensureSafeDeployed(eoa, solPub, onStatus) {
  // Determine safe address (deterministic).
  let safe = getKnownSafe(solPub);
  if (!safe) {
    safe = await deriveSafeAddress(eoa.address);
    setKnownSafe(solPub, safe);
  }

  // Skip deploy if we've already done it locally.
  if (getSafeDeployed(solPub)) return safe;

  const relayClient = await buildRelayClient(eoa.privateKey);

  // Check onchain whether it's already deployed (existing polymarket.com user).
  try {
    const deployed = await relayClient.getDeployed(safe);
    if (deployed) {
      setSafeDeployed(solPub);
      return safe;
    }
  } catch {
    // getDeployed may not exist in older SDK versions — fall through to deploy.
  }

  onStatus?.('Deploying Polymarket account...');
  const response = await relayClient.deploy();
  const result   = await response.wait();
  const proxyAddr = result?.proxyAddress || safe;
  setKnownSafe(solPub, proxyAddr);
  setSafeDeployed(solPub);
  return proxyAddr;
}

// ═══════════════════════════════════════════════════════════════════
// CLOB API CREDS (L1) — uses clob-client-v2 with viem walletClient
// V2 constructor takes options object. Temp client (no creds) derives.
// ═══════════════════════════════════════════════════════════════════

async function getOrDeriveClobCreds(eoa) {
  const cached = getSessionCreds(eoa.address);
  if (cached?.key && cached?.secret && cached?.passphrase) return cached;

  const { clob } = await loadSdks();
  const { ClobClient } = clob;
  const signer = await buildViemWalletClient(eoa.privateKey);

  // V2 constructor: options object, no creds for L1 derivation.
  const tempClient = new ClobClient({
    host:  POLYMARKET_CLOB_URL,
    chain: POLYGON_CHAIN_ID,
    signer,
  });

  let creds;
  try {
    creds = await tempClient.createOrDeriveApiKey();
  } catch {
    try { creds = await tempClient.deriveApiKey(); }
    catch { creds = await tempClient.createApiKey(); }
  }
  const normalized = {
    key:        creds.key || creds.apiKey,
    secret:     creds.secret,
    passphrase: creds.passphrase,
  };
  setSessionCreds(eoa.address, normalized);
  return normalized;
}

// ═══════════════════════════════════════════════════════════════════
// TOKEN APPROVALS (batched via RelayClient.execute)
// USDC.e (ERC-20)  → CTF, CTF Exchange, Neg Risk CTF Exchange, Neg Risk Adapter
// CTF tokens (ERC-1155) → CTF Exchange, Neg Risk CTF Exchange, Neg Risk Adapter
// ═══════════════════════════════════════════════════════════════════

const MAX_UINT256 = (1n << 256n) - 1n;

// approve(address,uint256) selector = 0x095ea7b3
function encodeErc20Approve(spender, amount) {
  const selector = '095ea7b3';
  const spenderPad = spender.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const amtHex     = BigInt(amount).toString(16).padStart(64, '0');
  return '0x' + selector + spenderPad + amtHex;
}
// setApprovalForAll(address,bool) selector = 0xa22cb465
function encodeErc1155SetApprovalForAll(operator, approved) {
  const selector = 'a22cb465';
  const op = operator.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const ap = (approved ? '1' : '0').padStart(64, '0');
  return '0x' + selector + op + ap;
}

function buildApprovalTxs() {
  // Order copied from Polymarket's official reference (safe-wallet-integration repo).
  return [
    // USDC.e ERC-20 approvals (4 spenders).
    { to: USDC_E_ADDRESS, value: '0', data: encodeErc20Approve(CONDITIONAL_TOKENS_ADDRESS, MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS, value: '0', data: encodeErc20Approve(CTF_EXCHANGE,               MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS, value: '0', data: encodeErc20Approve(NEG_RISK_CTF_EXCHANGE,      MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS, value: '0', data: encodeErc20Approve(NEG_RISK_ADAPTER,           MAX_UINT256.toString()) },
    // CTF ERC-1155 approvals (3 operators).
    { to: CONDITIONAL_TOKENS_ADDRESS, value: '0', data: encodeErc1155SetApprovalForAll(CTF_EXCHANGE,          true) },
    { to: CONDITIONAL_TOKENS_ADDRESS, value: '0', data: encodeErc1155SetApprovalForAll(NEG_RISK_CTF_EXCHANGE, true) },
    { to: CONDITIONAL_TOKENS_ADDRESS, value: '0', data: encodeErc1155SetApprovalForAll(NEG_RISK_ADAPTER,      true) },
  ];
}

async function ensureApprovals(eoa, solPub, onStatus) {
  if (getApprovalsSet(solPub)) return;
  onStatus?.('Approving Polymarket contracts...');
  const relayClient = await buildRelayClient(eoa.privateKey);
  const txs = buildApprovalTxs();
  // RelayClient.execute submits a single Safe multi-call → one signature from EOA.
  const response = await relayClient.execute(txs, 'Set Polymarket trading approvals');
  await response.wait();
  setApprovalsSet(solPub);
}

// ═══════════════════════════════════════════════════════════════════
// BRIDGE: get user's Solana deposit address for their safe
// ═══════════════════════════════════════════════════════════════════

async function fetchPolymarketDepositAddresses(safeAddr) {
  const r = await fetchWithTimeout(`${POLY_PROXY}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: safeAddr.toLowerCase() }),
  }, 10_000);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Bridge ${r.status}: ${t.slice(0, 160)}`);
  }
  const data = await r.json();
  const addrs = data?.address || data;
  if (!addrs?.svm) throw new Error('Polymarket did not return a Solana deposit address');
  return addrs;
}

// ═══════════════════════════════════════════════════════════════════
// SOLANA TX ASSEMBLY (Polymarket bridge + 5% fee, atomic)
// ═══════════════════════════════════════════════════════════════════

function createSplTransferInstruction(source, destination, owner, amountAtomic) {
  const data = new Uint8Array(9);
  data[0] = 3;
  const amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) data[1 + i] = Number((amt >> BigInt(i * 8)) & 0xffn);
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(source),      isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(destination), isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(owner),       isSigner: true,  isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}
function createAtaIfNeededInstruction(payer, ata, owner, mint) {
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true,  isWritable: true  },
      { pubkey: new PublicKey(ata),   isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(owner), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint),  isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ATA_PROGRAM_ID,
    data: new Uint8Array([1]),
  });
}
function deriveUsdcAta(ownerB58) {
  const owner = new PublicKey(ownerB58);
  const mint  = new PublicKey(USDC_SOLANA_MINT);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return ata.toBase58();
}
async function ataExists(ataAddress) {
  try {
    const res = await fetchWithTimeout(SOL_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
        params: [ataAddress, { encoding: 'base64', commitment: 'confirmed' }],
      }),
    }, 6_000);
    const json = await res.json();
    return !!json?.result?.value;
  } catch { return false; }
}
async function getRecentBlockhash() {
  const res = await fetchWithTimeout(SOL_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
    }),
  }, 6_000);
  const json = await res.json();
  const bh = json?.result?.value?.blockhash;
  if (!bh) throw new Error('Could not fetch recent blockhash');
  return bh;
}

async function buildBundledDepositTx({ userPubkey, polymarketSvmAddress, totalUsdcAtomic }) {
  const feeAtomic  = (totalUsdcAtomic * BigInt(Math.round(SERVICE_FEE_PCT * 10000))) / 10000n;
  const polyAtomic = totalUsdcAtomic - feeAtomic;
  if (polyAtomic <= 0n || feeAtomic <= 0n) throw new Error('Amount too small after fee split');

  const userAta      = deriveUsdcAta(userPubkey);
  const polyOwnerAta = deriveUsdcAta(polymarketSvmAddress);
  const feeOwnerAta  = deriveUsdcAta(FEE_RECIPIENT_SOL);

  const ixs = [];
  if (!(await ataExists(polyOwnerAta))) {
    ixs.push(createAtaIfNeededInstruction(userPubkey, polyOwnerAta, polymarketSvmAddress, USDC_SOLANA_MINT));
  }
  if (!(await ataExists(feeOwnerAta))) {
    ixs.push(createAtaIfNeededInstruction(userPubkey, feeOwnerAta, FEE_RECIPIENT_SOL, USDC_SOLANA_MINT));
  }
  ixs.push(createSplTransferInstruction(userAta, polyOwnerAta, userPubkey, polyAtomic));
  ixs.push(createSplTransferInstruction(userAta, feeOwnerAta,  userPubkey, feeAtomic));

  const blockhash = await getRecentBlockhash();
  const message = new TransactionMessage({
    payerKey:        new PublicKey(userPubkey),
    recentBlockhash: blockhash,
    instructions:    ixs,
  }).compileToV0Message();

  return { tx: new VersionedTransaction(message), feeAtomic, polyAtomic };
}

// ═══════════════════════════════════════════════════════════════════
// PRE-SIGN SIMULATION
// ═══════════════════════════════════════════════════════════════════

async function simulateBeforeSign(serializedB64) {
  try {
    const res = await fetchWithTimeout(SOL_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
        params: [serializedB64, {
          encoding: 'base64', commitment: 'processed',
          replaceRecentBlockhash: true, sigVerify: false,
        }],
      }),
    }, 10_000);
    const json = await res.json();
    if (json?.error) return { ok: false, message: json.error.message || 'Simulation RPC error' };
    const value = json?.result?.value;
    if (!value)    return { ok: true };
    if (value.err) {
      const logs = Array.isArray(value.logs) ? value.logs : [];
      const errLog = logs.find(l => /error|failed|insufficient/i.test(String(l)));
      if (errLog && /insufficient.*tokens|insufficient.*balance/i.test(errLog)) {
        return { ok: false, message: 'Not enough USDC' };
      }
      if (errLog && /insufficient.*lamports/i.test(errLog)) {
        return { ok: false, message: 'Not enough SOL for fees' };
      }
      return { ok: false, message: 'Trade would fail — try a different amount' };
    }
    return { ok: true };
  } catch {
    return { ok: true, warning: 'Pre-sim unavailable' };
  }
}

// ═══════════════════════════════════════════════════════════════════
// POLYMARKET BALANCE / POSITIONS (read-only, public APIs)
// ═══════════════════════════════════════════════════════════════════

// Fetch the safe's pUSD cash balance by reading the ERC-20 balanceOf() directly
// on Polygon via public RPC. No auth needed, no Data API quirks.
async function fetchPolymarketBalance(safeAddress) {
  try {
    const safe = safeAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    // balanceOf(address) selector = 0x70a08231
    const data = '0x70a08231' + safe;
    const r = await fetchWithTimeout('https://polygon-rpc.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: PUSD_ADDRESS, data }, 'latest'],
      }),
    }, 6_000);
    if (!r.ok) return 0n;
    const j = await r.json();
    const hex = j?.result;
    if (!hex || typeof hex !== 'string' || !hex.startsWith('0x')) return 0n;
    return BigInt(hex);   // pUSD has 6 decimals, same scale we use throughout
  } catch { return 0n; }
}

async function fetchPolymarketPositions(safeAddress, conditionId, clobTokenIds) {
  try {
    const url = `${DATA_API_URL}/positions?user=${safeAddress.toLowerCase()}&market=${conditionId}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 6_000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    const yesTokenId = clobTokenIds?.[0];
    const noTokenId  = clobTokenIds?.[1];
    let yesPos = null, noPos = null;
    for (const p of data) {
      const tid = String(p.asset || p.tokenId || p.token_id || '');
      if (yesTokenId && tid === String(yesTokenId)) yesPos = p;
      if (noTokenId  && tid === String(noTokenId))  noPos  = p;
    }
    const parseSize = (p) => p ? Number(p.size || p.shares || p.balance || 0) : 0;
    const parseAvg  = (p) => p ? Number(p.avgPrice || p.average_price || p.avg_price || 0) : 0;
    return {
      sharesYes:   parseSize(yesPos),
      sharesNo:    parseSize(noPos),
      avgPriceYes: parseAvg(yesPos),
      avgPriceNo:  parseAvg(noPos),
    };
  } catch { return null; }
}

async function fetchClobBestBid(tokenId) {
  try {
    const res = await fetchWithTimeout(`${POLYMARKET_CLOB_URL}/book?token_id=${tokenId}`, {}, 6_000);
    if (!res.ok) return 0;
    const data = await res.json();
    const bids = data?.bids || [];
    if (!bids.length) return 0;
    let best = 0;
    for (const b of bids) {
      const px = Number(b.price || b.p || 0);
      if (px > best) best = px;
    }
    return best;
  } catch { return 0; }
}

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATED CLOB CLIENT (V2 SDK, Safe wallet, signatureType 2)
//
// V2 constructor takes options object. funderAddress holds the funds
// (the Safe), signer signs orders (the user's EOA).
// SignatureTypeV2 enum: EOA=0, POLY_PROXY=1, POLY_GNOSIS_SAFE=2, POLY_1271=3.
// We use 2 because we deployed a Gnosis Safe for the user.
// ═══════════════════════════════════════════════════════════════════

async function buildAuthenticatedClobClient(eoa, safeAddress, creds) {
  const { clob } = await loadSdks();
  const { ClobClient } = clob;
  const signer = await buildViemWalletClient(eoa.privateKey);

  return new ClobClient({
    host:           POLYMARKET_CLOB_URL,
    chain:          POLYGON_CHAIN_ID,
    signer,
    creds,
    signatureType:  2,           // POLY_GNOSIS_SAFE
    funderAddress:  safeAddress, // Safe holds the pUSD
  });
}

// ═══════════════════════════════════════════════════════════════════
// CLOB BALANCE-ALLOWANCE UPDATE (after deposit lands)
// Tells CLOB matching engine to re-read on-chain balances.
// ═══════════════════════════════════════════════════════════════════

async function updateClobBalance(eoa, safeAddress, creds) {
  try {
    const client = await buildAuthenticatedClobClient(eoa, safeAddress, creds);
    if (typeof client.updateBalanceAllowance === 'function') {
      await client.updateBalanceAllowance({
        asset_type:     'COLLATERAL',
        signature_type: 2,
      });
    }
  } catch (e) {
    console.warn('[updateClobBalance]', e?.message || e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// ORDER PLACEMENT (via @polymarket/clob-client-v2)
// Buys and sells are FAK market orders — SDK reads orderbook and fills
// against existing depth at best available prices.
// builderCode is attached per-order for attribution (V2 architecture).
// ═══════════════════════════════════════════════════════════════════

async function getBuilderCode() {
  try {
    const r = await fetchWithTimeout(`${POLY_PROXY}/builder-code`, {}, 4_000);
    if (!r.ok) return null;
    const { builderCode } = await r.json();
    return builderCode || null;
  } catch { return null; }
}

async function postMarketBuy({
  eoa, safeAddress, creds, market, side, usdcSpend,
}) {
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  if (!tokenId) throw new Error('Token ID missing');

  const { clob } = await loadSdks();
  const Side      = clob.Side      || { BUY: 'BUY', SELL: 'SELL' };
  const OrderType = clob.OrderType || { FAK: 'FAK', FOK: 'FOK', GTC: 'GTC' };
  const builderCode = await getBuilderCode();
  const client = await buildAuthenticatedClobClient(eoa, safeAddress, creds);

  // V2 SDK: createAndPostMarketOrder takes (UserMarketOrder, options, orderType).
  // No price field — SDK calculates from orderbook for FAK.
  const marketOrder = {
    tokenID: String(tokenId),
    amount:  Number(usdcSpend),  // USDC notional for BUY
    side:    Side.BUY,
    ...(builderCode ? { builderCode } : {}),
  };
  const opts = {
    tickSize: market.tickSize || '0.01',
    negRisk:  !!market.negRisk,
  };

  if (typeof client.createAndPostMarketOrder !== 'function') {
    throw new Error('clob-client-v2 missing createAndPostMarketOrder — upgrade SDK');
  }
  const resp = await client.createAndPostMarketOrder(marketOrder, opts, OrderType.FAK);
  if (resp?.error || resp?.errorMsg) throw new Error(resp.error || resp.errorMsg);
  if (resp?.success === false)        throw new Error(resp?.errorMsg || 'Order rejected');
  return resp;
}

async function postMarketSell({
  eoa, safeAddress, creds, market, side, shares,
}) {
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  if (!tokenId) throw new Error('Token ID missing');

  const { clob } = await loadSdks();
  const Side      = clob.Side      || { BUY: 'BUY', SELL: 'SELL' };
  const OrderType = clob.OrderType || { FAK: 'FAK', FOK: 'FOK', GTC: 'GTC' };
  const builderCode = await getBuilderCode();
  const client = await buildAuthenticatedClobClient(eoa, safeAddress, creds);

  // For SELL market orders: amount = number of shares to sell.
  const marketOrder = {
    tokenID: String(tokenId),
    amount:  Number(shares),
    side:    Side.SELL,
    ...(builderCode ? { builderCode } : {}),
  };
  const opts = {
    tickSize: market.tickSize || '0.01',
    negRisk:  !!market.negRisk,
  };

  if (typeof client.createAndPostMarketOrder !== 'function') {
    throw new Error('clob-client-v2 missing createAndPostMarketOrder — upgrade SDK');
  }
  const resp = await client.createAndPostMarketOrder(marketOrder, opts, OrderType.FAK);
  if (resp?.error || resp?.errorMsg) throw new Error(resp.error || resp.errorMsg);
  if (resp?.success === false)        throw new Error(resp?.errorMsg || 'Order rejected');
  return resp;
}

// ═══════════════════════════════════════════════════════════════════
// BRIDGE POLLING
// ═══════════════════════════════════════════════════════════════════

async function pollUntilBridgeCompletes(svmDepositAddr, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetchWithTimeout(`${POLY_PROXY}/status/${encodeURIComponent(svmDepositAddr)}`, {}, 6_000);
      if (r.ok) {
        const d = await r.json();
        const txs = d?.transactions || [];
        if (txs.length > 0) {
          const latest = txs[txs.length - 1];
          if (latest.status === 'COMPLETED') return { ok: true };
          if (latest.status === 'FAILED')    return { ok: false, reason: 'Bridge failed' };
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 4_000));
  }
  return { ok: false, reason: 'Bridge timeout' };
}

// ═══════════════════════════════════════════════════════════════════
// PENDING TRADE PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

function savePending(payload) {
  try { localStorage.setItem('verixia_predict_pending', JSON.stringify({ ...payload, ts: Date.now() })); } catch {}
}
function loadPending() {
  try {
    const raw = localStorage.getItem('verixia_predict_pending');
    if (!raw) return null;
    const d = JSON.parse(raw);
    return Date.now() - d.ts < 60 * 60_000 ? d : null;
  } catch { return null; }
}
function clearPending() {
  try { localStorage.removeItem('verixia_predict_pending'); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// END-TO-END TRADE
// ═══════════════════════════════════════════════════════════════════

async function ensureSetup({ solPub, signMessage, onStatus }) {
  onStatus?.('Preparing Polymarket account...');
  const eoa = await deriveEoa(signMessage, solPub);

  // Step 1: derive + deploy safe (skips if already deployed onchain).
  const safeAddress = await ensureSafeDeployed(eoa, solPub, onStatus);

  // Step 2: derive CLOB API creds (cached after first call).
  const creds = await getOrDeriveClobCreds(eoa);

  // Step 3: token approvals (batched, one signature, cached after first call).
  await ensureApprovals(eoa, solPub, onStatus);

  return { eoa, safeAddress, creds };
}

async function executeTrade({
  market, side, usdAmount, walletPubkey, signTransaction, signMessage, onStatus,
}) {
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  const price   = side === 'yes' ? market.yesPrice : market.noPrice;
  if (!tokenId)                  throw new Error('Token ID missing');
  if (!(price > 0 && price < 1)) throw new Error('Invalid price');
  if (usdAmount < MIN_DEPOSIT_USD) throw new Error(`Minimum trade is $${MIN_DEPOSIT_USD}`);

  const totalAtomic = BigInt(Math.floor(usdAmount * 1e6));

  // 1. Setup (safe + creds + approvals) — silent after first time.
  const { eoa, safeAddress, creds } = await ensureSetup({ solPub: walletPubkey, signMessage, onStatus });

  // 2. Bridge addresses for the safe.
  onStatus?.('Getting bridge address...');
  const addrs = await fetchPolymarketDepositAddresses(safeAddress);
  const svmDepositAddr = addrs.svm;

  // 3. Build + simulate + sign Solana tx.
  onStatus?.('Building transaction...');
  const { tx, polyAtomic } = await buildBundledDepositTx({
    userPubkey: walletPubkey,
    polymarketSvmAddress: svmDepositAddr,
    totalUsdcAtomic: totalAtomic,
  });

  onStatus?.('Simulating...');
  const sim = await simulateBeforeSign(btoa(String.fromCharCode(...tx.serialize())));
  if (!sim.ok) throw new Error(sim.message || 'Pre-sim failed');

  onStatus?.('Confirm in your wallet...');
  const signed = await signTransaction(tx);

  // 4. Persist intent.
  savePending({
    safeAddress,
    tokenId: String(tokenId),
    side,
    sharePrice: price,
    polyAtomic: polyAtomic.toString(),
    svmDepositAddr,
    marketTitle: market.title,
    negRisk: !!market.negRisk,
  });

  // 5. Submit on Solana.
  onStatus?.('Submitting on Solana...');
  const submitRes = await fetchWithTimeout(SOL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'sendTransaction',
      params: [btoa(String.fromCharCode(...signed.serialize())), {
        encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 5,
      }],
    }),
  }, 20_000);
  const submitJson = await submitRes.json();
  if (submitJson.error) {
    clearPending();
    throw new Error(submitJson.error.message || 'Submit failed');
  }

  // 6. Wait for bridge.
  onStatus?.('Bridging to Polymarket (~30s)...');
  const landed = await pollUntilBridgeCompletes(svmDepositAddr);
  if (!landed.ok) return { bridging: true };

  // 7. Sync CLOB balance so it sees the new pUSD in the safe.
  await updateClobBalance(eoa, safeAddress, creds);

  // 8. Place market buy via SDK.
  onStatus?.('Placing order...');
  const result = await postMarketBuy({
    eoa, safeAddress, creds,
    market, side,
    usdcSpend: Number(polyAtomic) / 1e6,
  });

  clearPending();
  return { ok: true, result };
}

async function executeSell({
  market, side, shares, walletPubkey, signMessage, onStatus,
}) {
  if (!(shares > 0)) throw new Error('No shares to sell');
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  if (!tokenId) throw new Error('Token ID missing');

  const { eoa, safeAddress, creds } = await ensureSetup({ solPub: walletPubkey, signMessage, onStatus });

  onStatus?.('Placing sell...');
  const result = await postMarketSell({
    eoa, safeAddress, creds,
    market, side, shares,
  });
  return { ok: true, result };
}

async function executeWithdraw({ solPub, signMessage, onStatus, recipientSol }) {
  const { safeAddress } = await ensureSetup({ solPub, signMessage, onStatus });

  onStatus?.('Requesting withdrawal...');
  const r = await fetchWithTimeout(`${POLY_PROXY}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address:        safeAddress.toLowerCase(),
      toChainId:      '1151111081099710',  // Solana chain ID per Polymarket bridge API
      toTokenAddress: USDC_SOLANA_MINT,
      recipientAddr:  recipientSol,
    }),
  }, 15_000);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Withdraw ${r.status}: ${t.slice(0, 160)}`);
  }
  return await r.json();
}

// ═══════════════════════════════════════════════════════════════════
// MARKETS (Gamma — public)
// ═══════════════════════════════════════════════════════════════════

async function fetchCryptoMarkets() {
  const url = `${GAMMA_URL}/events?tag_id=${CRYPTO_TAG_ID}&related_tags=true&closed=false&order=volume24hr&ascending=false&limit=50`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Gamma ${res.status}`);
  return await res.json();
}

function normalizeEvent(ev) {
  const markets = Array.isArray(ev.markets) ? ev.markets : [];
  if (markets.length === 0) return null;
  const market = markets[0];
  let outcomePrices = [];
  try {
    outcomePrices = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : (market.outcomePrices || []);
  } catch {}
  let clobTokenIds = [];
  try {
    clobTokenIds = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : (market.clobTokenIds || []);
  } catch {}
  const yesPrice = Number(outcomePrices[0] || market.lastTradePrice || 0);
  const noPrice  = Number(outcomePrices[1] || (1 - yesPrice));
  const parentTitle   = ev.title || market.question || 'Untitled';
  const childQuestion = markets.length > 1 ? (market.question || market.groupItemTitle || null) : null;
  return {
    id: ev.id, slug: ev.slug, title: parentTitle, childQuestion,
    image:        ev.image || ev.icon || market.image || null,
    volume24h:    Number(ev.volume24hr || market.volume24hr || 0),
    volumeTotal:  Number(ev.volume || market.volume || 0),
    liquidity:    Number(ev.liquidity || market.liquidity || 0),
    endDate:      ev.endDate || market.endDate || null,
    yesPrice, noPrice,
    yesPct: Math.round(yesPrice * 100),
    noPct:  Math.round(noPrice * 100),
    marketCount: markets.length,
    conditionId: market.conditionId,
    clobTokenIds,
    negRisk: !!(market.negRisk || ev.negRisk),
    tickSize: String(market.orderPriceMinTickSize || market.minimum_tick_size || market.tickSize || '0.01'),
  };
}

// ═══════════════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════════════

function RegionBlock() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '36px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 18px', borderRadius: 14, background: C.hlDim, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display }}>Predict isn't available here</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Prediction markets are restricted in your region.
        </div>
      </div>
    </div>
  );
}

function ComingSoon() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '40px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display }}>Predict</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Coming soon. Trade crypto prediction markets from your Solana wallet.
        </div>
      </div>
    </div>
  );
}

function MarketSkeleton() {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: C.card, border: `1px solid ${C.border}`, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,.04)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 12, width: '85%', background: 'rgba(255,255,255,.06)', borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 10, width: '50%', background: 'rgba(255,255,255,.03)', borderRadius: 4 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, height: 42, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
        <div style={{ flex: 1, height: 42, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
      </div>
    </div>
  );
}

function MarketCard({ market, onTrade }) {
  const { title, childQuestion, image, yesPct, volume24h, endDate, marketCount } = market;
  const yesPrice = Number(market.yesPrice) || 0;
  const noPrice  = Number(market.noPrice)  || 0;
  const upsideFor = (px) => (px < 0.01 || px > 0.99) ? 0 : Math.min(9999, Math.round((1 / px - 1) * 100));
  const yesUpside = upsideFor(yesPrice);
  const noUpside  = upsideFor(noPrice);

  return (
    <div style={{ padding: 16, borderRadius: 16, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 10, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        {image && (
          <img src={image} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: '#0a1020' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.35, marginBottom: childQuestion ? 4 : 6, ...T.body }}>{title}</div>
          {childQuestion && (
            <div style={{ fontSize: 11, fontWeight: 600, color: C.hl, lineHeight: 1.35, marginBottom: 6, ...T.body }}>
              {childQuestion}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 10, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(volume24h)}</span>
            {formatEndDate(endDate) && (<><span style={{ opacity: .4 }}>·</span><span>{formatEndDate(endDate)}</span></>)}
            {marketCount > 1 && (<><span style={{ opacity: .4 }}>·</span><span>{marketCount} outcomes</span></>)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yesPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onTrade(market, 'yes')} style={{ flex: 1, padding: '10px', borderRadius: 11, background: C.yesDim, border: `1px solid rgba(0,212,163,.30)`, color: C.yes, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Yes · ${yesPrice.toFixed(2)}</span>
          {yesUpside > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{yesUpside}% upside</span>}
        </button>
        <button onClick={() => onTrade(market, 'no')} style={{ flex: 1, padding: '10px', borderRadius: 11, background: C.noDim, border: `1px solid rgba(255,95,122,.30)`, color: C.no, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>No · ${noPrice.toFixed(2)}</span>
          {noUpside > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{noUpside}% upside</span>}
        </button>
      </div>
    </div>
  );
}

function OrderDrawer({ market, side, onClose, walletPubkey, signTransaction, signMessage, refreshBalances }) {
  const [amount, setAmount]       = useState('10');
  const [status, setStatus]       = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');
  const [position, setPosition]   = useState(null);
  const [currentBids, setCurrentBids] = useState({ yes: 0, no: 0 });
  const [sellStatus, setSellStatus] = useState('idle');

  useBodyLock(true);

  // Poll positions while drawer is open (silent, no sigs).
  useEffect(() => {
    if (!market || !walletPubkey) return;
    const safeAddr = getKnownSafe(walletPubkey);
    if (!safeAddr || !market.conditionId || !market.clobTokenIds?.length) return;
    let alive = true;
    const tick = async () => {
      try {
        const [pos, yesBid, noBid] = await Promise.all([
          fetchPolymarketPositions(safeAddr, market.conditionId, market.clobTokenIds),
          fetchClobBestBid(market.clobTokenIds[0]),
          fetchClobBestBid(market.clobTokenIds[1]),
        ]);
        if (!alive) return;
        if (pos) setPosition(pos);
        setCurrentBids({ yes: yesBid, no: noBid });
      } catch {}
    };
    tick();
    const id = setInterval(tick, 8_000);
    return () => { alive = false; clearInterval(id); };
  }, [market, walletPubkey]);

  if (!market) return null;
  const price       = side === 'yes' ? market.yesPrice : market.noPrice;
  const usd         = Number(amount) || 0;
  const netUsd      = usd * (1 - SERVICE_FEE_PCT);
  const shares      = price > 0 ? netUsd / price : 0;
  const upside      = netUsd > 0 ? ((shares - netUsd) / netUsd) * 100 : 0;
  const sideColor   = side === 'yes' ? C.yes : C.no;
  const sideDim     = side === 'yes' ? C.yesDim : C.noDim;
  const isBusy      = status === 'working' || sellStatus === 'selling';
  const canExecute  = !isBusy && usd >= MIN_DEPOSIT_USD && walletPubkey && signMessage && signTransaction && market.clobTokenIds?.length >= 2;

  const heldShares    = side === 'yes' ? Number(position?.sharesYes || 0) : Number(position?.sharesNo || 0);
  const avgBought     = side === 'yes' ? Number(position?.avgPriceYes || 0) : Number(position?.avgPriceNo || 0);
  const currentBid    = side === 'yes' ? currentBids.yes : currentBids.no;
  const positionValue = heldShares * currentBid;
  const positionCost  = heldShares * avgBought;
  const positionPnl   = positionValue - positionCost;
  const positionPnlPct= positionCost > 0 ? (positionPnl / positionCost) * 100 : 0;
  const hasPosition   = heldShares > 0.01;

  const handleExecute = async () => {
    if (usd < MIN_DEPOSIT_USD) { setError(`Minimum trade is $${MIN_DEPOSIT_USD}`); return; }
    setStatus('working'); setError(''); setStatusMsg('');
    try {
      const result = await executeTrade({
        market, side, usdAmount: usd,
        walletPubkey, signTransaction, signMessage,
        onStatus: setStatusMsg,
      });
      if (result?.bridging) {
        setStatus('bridging'); setStatusMsg('Order will fire automatically when funds land.');
      } else {
        setStatus('success'); setStatusMsg('');
      }
      refreshBalances?.();
      setTimeout(() => onClose(), result?.bridging ? 4500 : 2500);
    } catch (e) {
      console.error('[predict trade]', e);
      const msg = e?.message || 'Trade failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setStatus('error'); setStatusMsg('');
      setTimeout(() => setStatus('idle'), 4500);
    }
  };

  const handleSellEarly = async () => {
    if (!hasPosition) return;
    setSellStatus('selling'); setError(''); setStatusMsg('');
    try {
      await executeSell({
        market, side, shares: heldShares,
        walletPubkey, signMessage, onStatus: setStatusMsg,
      });
      setSellStatus('sold'); setStatusMsg('');
      refreshBalances?.();
      setTimeout(() => onClose(), 2800);
    } catch (e) {
      const msg = e?.message || 'Sell failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setSellStatus('error'); setStatusMsg('');
      setTimeout(() => setSellStatus('idle'), 4500);
    }
  };

  return (
    <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: isBusy ? 'wait' : 'pointer' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)', boxShadow: C.shadowLg, maxHeight: '92dvh', overflowY: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{market.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <div style={{ padding: '4px 10px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 10, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{side.toUpperCase()}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
        </div>

        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 11, background: 'linear-gradient(135deg,rgba(151,252,228,.08),rgba(168,127,255,.06))', border: `1px solid ${C.borderHi}` }}>
          <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, letterSpacing: .4, marginBottom: 4, ...T.display }}>⚡ POLYMARKET, DIRECT FROM SOLANA</div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, ...T.body }}>
            Two signatures · ~30 seconds · Non-custodial · Free sells · Free withdraws
          </div>
        </div>

        {hasPosition && sellStatus !== 'sold' && (
          <div style={{ marginBottom: 14, padding: '14px', borderRadius: 12, background: positionPnl >= 0 ? 'rgba(0,212,163,.07)' : 'rgba(255,95,122,.07)', border: `1px solid ${positionPnl >= 0 ? 'rgba(0,212,163,.30)' : 'rgba(255,95,122,.30)'}` }}>
            <div style={{ fontSize: 10, color: positionPnl >= 0 ? C.yes : C.no, fontWeight: 800, letterSpacing: .8, marginBottom: 10, ...T.mono }}>
              YOUR POSITION · {side.toUpperCase()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, ...T.mono }}>
              <span style={{ color: C.muted }}>Shares</span>
              <span style={{ color: C.ink, fontWeight: 700 }}>{heldShares.toFixed(2)} @ ${avgBought.toFixed(3)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12, ...T.mono }}>
              <span style={{ color: C.muted }}>Value · P&amp;L</span>
              <span style={{ color: positionPnl >= 0 ? C.yes : C.no, fontWeight: 800 }}>
                {fmtUsd(positionValue, 2)} · {positionPnl >= 0 ? '+' : ''}{positionPnl.toFixed(2)} ({positionPnl >= 0 ? '+' : ''}{positionPnlPct.toFixed(1)}%)
              </span>
            </div>
            <button onClick={sellStatus === 'selling' ? undefined : handleSellEarly} disabled={sellStatus === 'selling' || currentBid <= 0}
              style={{ width: '100%', padding: '11px', borderRadius: 10,
                background: positionPnl >= 0 ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` : `linear-gradient(135deg, ${C.no}33, ${C.no}22)`,
                border: `1px solid ${positionPnl >= 0 ? C.yes : C.no}66`,
                color: positionPnl >= 0 ? C.yes : C.no, fontWeight: 800, fontSize: 13,
                cursor: (sellStatus === 'selling' || currentBid <= 0) ? 'not-allowed' : 'pointer',
                opacity: (sellStatus === 'selling' || currentBid <= 0) ? .55 : 1, ...T.body }}>
              {sellStatus === 'selling' ? 'Selling...' : currentBid <= 0 ? 'No bids — try later' : `Sell all · ${fmtUsd(positionValue, 2)} · Free`}
            </button>
          </div>
        )}

        {sellStatus === 'sold' && (
          <div style={{ marginBottom: 14, padding: '14px', borderRadius: 12, background: 'rgba(0,212,163,.18)', border: `1px solid ${C.yes}` }}>
            <div style={{ fontSize: 12, color: C.ink, ...T.body }}>✓ Sold. Proceeds in your Polymarket account.</div>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 20, color: C.muted, ...T.display }}>$</span>
            <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={isBusy} inputMode="decimal" placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 22, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 11, color: C.muted, ...T.mono }}>USDC</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {['10', '25', '100', '250'].map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={isBusy} style={{ flex: 1, padding: '7px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: isBusy ? 'not-allowed' : 'pointer', ...T.mono }}>${v}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12, ...T.mono, fontSize: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>Service fee (5%)</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>-{fmtUsd(usd * SERVICE_FEE_PCT, 2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>Into Polymarket</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>{fmtUsd(netUsd, 2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
            <span style={{ color: C.muted }}>Shares</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>{shares.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>If {side.toUpperCase()} wins</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>{fmtUsd(shares, 2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted }}>Upside</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>+{upside.toFixed(1)}%</span>
          </div>
        </div>

        {statusMsg && (
          <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite' }} />
            <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
          </div>
        )}
        {error && (
          <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 12, fontSize: 12, color: C.no, ...T.body }}>{error}</div>
        )}

        <button onClick={canExecute ? handleExecute : undefined} disabled={!canExecute} style={{
          width: '100%', padding: '14px', borderRadius: 13,
          background: status === 'success' || status === 'bridging'
            ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)`
            : `linear-gradient(135deg, ${sideColor}33, ${sideColor}22)`,
          border: `1px solid ${sideColor}66`, color: sideColor,
          fontWeight: 800, fontSize: 14,
          cursor: canExecute ? 'pointer' : 'not-allowed',
          opacity: canExecute ? 1 : .55, ...T.body, letterSpacing: .5,
        }}>
          {isBusy ? 'Processing...' :
           status === 'success' ? '✓ Order placed' :
           status === 'bridging' ? '✓ Bridging — order pending' :
           `Buy ${side.toUpperCase()} · ${fmtUsd(usd, 2)}`}
        </button>
        <div style={{ fontSize: 10, color: C.muted2, marginTop: 10, textAlign: 'center', lineHeight: 1.5, ...T.mono }}>
          Two signatures · Polymarket bridges + settles automatically · Non-custodial
        </div>
      </div>
    </div>
  );
}

function BringHomeBanner({ safeAddress, polyBalance, walletPubkey, signMessage, refreshBalances }) {
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');
  const [error, setError] = useState('');
  const [done, setDone]   = useState(false);

  const usd = Number(polyBalance) / 1e6;
  if (usd < 1 && !done && !busy) return null;

  const handleWithdraw = async () => {
    setBusy(true); setError(''); setMsg('Requesting withdrawal...');
    try {
      await executeWithdraw({
        solPub: walletPubkey, signMessage, onStatus: setMsg, recipientSol: walletPubkey,
      });
      setMsg(''); setDone(true);
      refreshBalances?.();
      setTimeout(() => setDone(false), 10_000);
    } catch (e) {
      console.error('[bring home]', e);
      setError(e?.message || 'Withdraw failed');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: 'linear-gradient(145deg,rgba(0,212,163,.16),rgba(151,252,228,.08))', border: `1px solid ${C.yes}` }}>
        <div style={{ fontSize: 12, color: C.yes, fontWeight: 800, marginBottom: 6, ...T.display }}>✓ WITHDRAW INITIATED</div>
        <div style={{ fontSize: 12, color: C.ink, ...T.body }}>USDC lands in your Solana wallet in ~30s. Free.</div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: 'linear-gradient(145deg,rgba(0,212,163,.10),rgba(151,252,228,.06))', border: `1px solid ${C.yes}55` }}>
      <div style={{ fontSize: 11, color: C.yes, fontWeight: 800, marginBottom: 8, ...T.display }}>FUNDS ON POLYMARKET</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 6, ...T.display }}>{fmtUsd(usd)}</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, ...T.body }}>
        Withdraw to Solana — free, ~30s.
      </div>
      {msg && (
        <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', borderRadius: 8, fontSize: 11, color: C.muted, ...T.body }}>{msg}</div>
      )}
      {error && (
        <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', borderRadius: 8, fontSize: 11, color: C.no, ...T.body }}>{error}</div>
      )}
      <button onClick={busy ? undefined : handleWithdraw} disabled={busy} style={{
        width: '100%', padding: '12px', borderRadius: 10,
        background: `linear-gradient(135deg, ${C.yes}, ${C.hl})`,
        color: C.bg, fontWeight: 800, fontSize: 14, border: 'none',
        cursor: busy ? 'wait' : 'pointer', opacity: busy ? .65 : 1, ...T.body,
      }}>{busy ? 'Processing...' : `Bring ${fmtUsd(usd)} home — free`}</button>
    </div>
  );
}

function Header() {
  return (
    <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: C.ink, letterSpacing: -1, ...T.display }}>Predict</h1>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>CRYPTO</div>
        </div>
        <div style={{ fontSize: 12, color: C.muted, ...T.mono, marginTop: 6 }}>Polymarket direct from Solana · Two sigs · ~30s</div>
      </div>
    </div>
  );
}

function PredictInner({ bypassGeo = false }) {
  const [country, setCountry]           = useState(null);
  const [geoChecked, setGeoChecked]     = useState(false);
  const [markets, setMarkets]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [search, setSearch]             = useState('');
  const [sortBy, setSortBy]             = useState('upside');
  const [orderMarket, setOrderMarket]   = useState(null);
  const [orderSide, setOrderSide]       = useState('yes');
  const [safeAddress, setSafeAddress] = useState(null);
  const [polyBalance, setPolyBalance]   = useState(0n);

  const { publicKey: solPk, signMessage, signTransaction } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  useEffect(() => {
    if (!walletPubkey) return;
    const addr = getKnownSafe(walletPubkey);
    if (addr) setSafeAddress(addr);
  }, [walletPubkey]);

  useEffect(() => {
    if (!safeAddress) return;
    let alive = true;
    const tick = async () => {
      try {
        const bal = await fetchPolymarketBalance(safeAddress);
        if (alive) setPolyBalance(bal);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [safeAddress]);

  const refreshBalances = useCallback(async () => {
    if (!safeAddress) return;
    try { setPolyBalance(await fetchPolymarketBalance(safeAddress)); } catch {}
  }, [safeAddress]);

  useEffect(() => {
    let alive = true;
    detectCountry().then(c => {
      if (!alive) return;
      setCountry(c); setGeoChecked(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!geoChecked) return;
    if (!bypassGeo && country && US_BLOCK.has(country)) return;
    let alive = true;
    const load = async () => {
      try {
        const events = await fetchCryptoMarkets();
        if (!alive) return;
        setMarkets((Array.isArray(events) ? events : []).map(normalizeEvent).filter(Boolean));
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Failed to load markets');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [geoChecked, country, bypassGeo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = q
      ? markets.filter(m => (m.title || '').toLowerCase().includes(q) || (m.childQuestion || '').toLowerCase().includes(q))
      : [...markets];
    if (sortBy === 'upside') {
      const bestUpside = (m) => {
        const yp = Number(m.yesPrice) || 0, np = Number(m.noPrice) || 0;
        const yU = (yp >= 0.01 && yp < 0.99) ? (1 / yp - 1) * 100 : 0;
        const nU = (np >= 0.01 && np < 0.99) ? (1 / np - 1) * 100 : 0;
        return Math.max(yU, nU);
      };
      result.sort((a, b) => bestUpside(b) - bestUpside(a));
    } else if (sortBy === 'ending') {
      const timeLeft = (m) => {
        if (!m.endDate) return Infinity;
        const ms = new Date(m.endDate).getTime() - Date.now();
        return ms > 0 ? ms : Infinity;
      };
      result.sort((a, b) => timeLeft(a) - timeLeft(b));
    } else {
      result.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    }
    return result;
  }, [markets, search, sortBy]);

  const openTrade = useCallback((market, side) => {
    setOrderMarket(market); setOrderSide(side);
  }, []);

  if (!bypassGeo && geoChecked && country && US_BLOCK.has(country)) return <RegionBlock />;

  if (!geoChecked || loading) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)' }}>
        <Header />
        {[1,2,3,4,5].map(i => <MarketSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <>
      <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } } @keyframes nexus-pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }`}</style>
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>
        <Header />

        {safeAddress && (
          <BringHomeBanner
            safeAddress={safeAddress}
            polyBalance={polyBalance}
            walletPubkey={walletPubkey}
            signMessage={signMessage}
            refreshBalances={refreshBalances}
          />
        )}

        <div style={{ marginBottom: 14, position: 'relative' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search crypto markets..."
            inputMode="search" enterKeyHint="search"
            style={{ width: '100%', padding: '11px 14px 11px 38px', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 12, color: C.ink, fontSize: 13, outline: 'none', ...T.body }} />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {[
            { id: 'upside', label: 'Highest upside' },
            { id: 'volume', label: 'Top volume' },
            { id: 'ending', label: 'Ending soon' },
          ].map(opt => {
            const active = sortBy === opt.id;
            return (
              <button key={opt.id} onClick={() => setSortBy(opt.id)} style={{
                padding: '7px 13px', borderRadius: 99, whiteSpace: 'nowrap',
                background: active ? C.hlDim : 'rgba(255,255,255,.03)',
                border: `1px solid ${active ? C.borderHi : C.border}`,
                color: active ? C.hl : C.muted,
                fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono,
              }}>{opt.label}</button>
            );
          })}
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(255,95,122,.07)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12, marginBottom: 12, ...T.body }}>{error}</div>
        )}
        {filtered.length === 0 && !error && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
            {search ? `No markets match "${search}"` : 'No active markets right now.'}
          </div>
        )}
        {filtered.map(m => <MarketCard key={m.id || m.slug} market={m} onTrade={openTrade} />)}

        <div style={{ marginTop: 20, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 11, color: C.muted, textAlign: 'center', ...T.mono }}>
          Polymarket direct from Solana · Two signatures · 5% entry fee · Free sells · Free withdraws · Non-custodial
        </div>
      </div>

      {orderMarket && (
        <OrderDrawer
          market={orderMarket} side={orderSide}
          onClose={() => { setOrderMarket(null); refreshBalances(); }}
          walletPubkey={walletPubkey}
          signTransaction={signTransaction}
          signMessage={signMessage}
          refreshBalances={refreshBalances}
        />
      )}
    </>
  );
}

export default function Predict(props) {
  const solWallet = useWallet();
  const nexus     = useNexusWallet();
  const address =
    (solWallet?.publicKey && solWallet.publicKey.toBase58 && solWallet.publicKey.toBase58()) ||
    nexus?.walletAddress || nexus?.privyEmbeddedSol || null;
  const isVip = !!address && VIP_WALLETS.has(address);
  return isVip ? <PredictInner {...props} bypassGeo /> : <ComingSoon />;
}
