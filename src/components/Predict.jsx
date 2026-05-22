// Predict.jsx

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

const CLOB_URL = 'https://clob.polymarket.com';
const RELAYER_URL = 'https://relayer-v2.polymarket.com';
const GAMMA_URL = 'https://gamma-api.polymarket.com';
const DATA_API_URL = 'https://data-api.polymarket.com';

const POLYGON_RPCS = [
  'https://polygon.llamarpc.com',
  'https://polygon-bor-rpc.publicnode.com',
  'https://rpc.ankr.com/polygon',
  'https://polygon-rpc.com',
];

const POLYGON_CHAIN_ID = 137;

const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CONDITIONAL_TOKENS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

const BUILDER_CODE =
  '0x6e656750ed8970d584732af619cb7a4d493e18bc9cbf4fd866eb9594f92569fa';

const USDC_SOLANA_MINT =
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const SOL_NATIVE_MINT =
  'So11111111111111111111111111111111111111112';

const SOL_RPC = '/api/solana-rpc';

const TOKEN_PROGRAM_ID =
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const ATA_PROGRAM_ID =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

const BRIDGE_DEPOSIT = '/api/poly/deposit';
const BRIDGE_STATUS = '/api/poly/status';
const BRIDGE_WITHDRAW = '/api/poly/withdraw';

const OKX_SWAP_PATH = '/api/okx/dex/aggregator/swap';
const OKX_SWAP_INSTRUCTION_PATH = '/api/okx/dex/aggregator/swap-instruction';
const OKX_SOL_CHAIN = '501';

// Slippage as a percent string. "15" = 15% — high so swaps always route through.
const OKX_SLIPPAGE = '15';

const FEE_WALLET_SOL =
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';

const USDC_FEE_PCT = 5;
const CRYPTO_TAG_ID = 21;
const MIN_TRADE_USD = 5;
const MIN_DEPOSIT_USD = 5;

const HORIZONS = [
  {
    id: 'hourly',
    label: 'Hourly',
    slug: '15-min-crypto',
    maxMs: 2 * 60 * 60_000,
  },
  {
    id: 'daily',
    label: 'Daily',
    slug: 'daily-crypto',
    maxMs: 36 * 60 * 60_000,
  },
  {
    id: 'weekly',
    label: 'Weekly',
    slug: 'weekly-crypto',
    maxMs: 8 * 24 * 60 * 60_000,
  },
  {
    id: 'monthly',
    label: 'Monthly',
    slug: 'monthly-crypto',
    maxMs: 45 * 24 * 60 * 60_000,
  },
  {
    id: 'all',
    label: 'All',
    slug: null,
    maxMs: Infinity,
  },
];

const DBG_MAX = 400;

const _dbgListeners = new Set();

function _emit(e) {
  for (const fn of _dbgListeners) {
    try {
      fn(e);
    } catch {}
  }
}

function _redact(v) {
  if (typeof v !== 'object' || v == null) return v;

  const out = Array.isArray(v) ? [] : {};

  for (const k of Object.keys(v)) {
    if (/secret|passphrase|private|seed|mnemonic|api[_-]?key/i.test(k)) {
      out[k] = '***';
    } else {
      out[k] = v[k];
    }
  }

  return out;
}

function dbg(scope, msg, data) {
  const entry = {
    ts: Date.now(),
    scope,
    msg,
    data: data === undefined ? undefined : _redact(data),
  };

  try {
    if (typeof window !== 'undefined') {
      window.__predictDebug = window.__predictDebug || [];
      window.__predictDebug.push(entry);

      if (window.__predictDebug.length > DBG_MAX) {
        window.__predictDebug.shift();
      }
    }
  } catch {}

  try {
    console.log(
      `[predict:${scope}]`,
      msg,
      entry.data !== undefined ? entry.data : ''
    );
  } catch {}

  _emit(entry);
}

function dbgErr(scope, msg, err) {
  dbg(scope, 'ERROR: ' + msg, {
    name: err?.name,
    message: err?.message || String(err),
    code: err?.code,
    status: err?.status || err?.response?.status,
    body: err?.body || err?.response?.data || err?.data,
  });
}

function dbgClear() {
  try {
    if (typeof window !== 'undefined') {
      window.__predictDebug = [];
    }
  } catch {}

  _emit({
    ts: Date.now(),
    scope: 'debug',
    msg: '— cleared —',
  });
}

function useDbgLog() {
  const [, force] = useState(0);
  const ref = useRef([]);

  useEffect(() => {
    try {
      if (
        typeof window !== 'undefined' &&
        Array.isArray(window.__predictDebug)
      ) {
        ref.current = [...window.__predictDebug];
      }
    } catch {}

    const fn = (entry) => {
      if (entry.msg === '— cleared —') {
        ref.current = [];
      } else {
        ref.current = [...ref.current, entry];

        if (ref.current.length > DBG_MAX) {
          ref.current = ref.current.slice(-DBG_MAX);
        }
      }

      force((x) => x + 1);
    };

    _dbgListeners.add(fn);

    return () => {
      _dbgListeners.delete(fn);
    };
  }, []);

  return ref.current;
}

const C = {
  bg: '#03060f',
  card: '#080d1a',
  cardHi: '#0c1428',
  ink: '#e8ecf5',
  muted: '#8a96b8',
  muted2: '#475670',
  border: 'rgba(151,252,228,.10)',
  borderHi: 'rgba(151,252,228,.30)',
  hl: '#97fce4',
  hl2: '#5ce9c8',
  hlDim: 'rgba(151,252,228,.10)',
  violet: '#a87fff',
  yes: '#00d4a3',
  yesDim: 'rgba(0,212,163,.12)',
  no: '#ff5f7a',
  noDim: 'rgba(255,95,122,.12)',
  amber: '#f5b53d',
  shadow: '0 8px 28px rgba(0,0,0,.45)',
  shadowLg: '0 18px 56px rgba(0,0,0,.55)',
};

const T = {
  body: {
    fontFamily: 'DM Sans, system-ui, sans-serif',
  },

  display: {
    fontFamily: 'Syne, Inter, sans-serif',
  },

  mono: {
    fontFamily: 'IBM Plex Mono, monospace',
  },
};

async function jfetch(url, opts = {}, ms = 12000) {
  const c = new AbortController();

  const id = setTimeout(() => c.abort(), ms);

  const t0 = Date.now();

  try {
    const r = await fetch(url, {
      ...opts,
      signal: c.signal,
    });

    const dur = Date.now() - t0;

    if (!r.ok) {
      let body = '';

      try {
        body = await r.text();
      } catch {}

      dbg(
        'http',
        `${opts.method || 'GET'} ${url} → ${r.status}`,
        {
          dur,
          body: body.slice(0, 500),
        }
      );

      const err = new Error(
        `HTTP ${r.status}: ${
          body.slice(0, 300) || r.statusText
        }`
      );

      err.status = r.status;
      err.body = body;

      throw err;
    }

    dbg(
      'http',
      `${opts.method || 'GET'} ${url} → ${r.status}`,
      { dur }
    );

    return r;
  } finally {
    clearTimeout(id);
  }
}

function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) {
    return '$0.00';
  }

  n = Number(n);

  if (n >= 1e9) {
    return '$' + (n / 1e9).toFixed(2) + 'B';
  }

  if (n >= 1e6) {
    return '$' + (n / 1e6).toFixed(2) + 'M';
  }

  if (n >= 1e3) {
    return '$' + n.toLocaleString('en-US', {
      maximumFractionDigits: d,
    });
  }

  if (n >= 1) {
    return '$' + n.toFixed(d);
  }

  return '$' + n.toFixed(4);
}

function formatVol(n) {
  if (!n || n <= 0) return '$0';

  if (n >= 1e9) {
    return `$${(n / 1e9).toFixed(2)}B`;
  }

  if (n >= 1e6) {
    return `$${(n / 1e6).toFixed(2)}M`;
  }

  if (n >= 1e3) {
    return `$${(n / 1e3).toFixed(1)}K`;
  }

  return `$${n.toFixed(0)}`;
}

function formatEndDate(iso) {
  if (!iso) return null;

  const d = new Date(iso);

  if (!Number.isFinite(d.getTime())) {
    return null;
  }

  const ms = d.getTime() - Date.now();

  if (ms <= 0) {
    return 'Closed';
  }

  const mo = d.toLocaleString('en-US', {
    month: 'short',
  });

  const day = d.getDate();

  if (ms < 60 * 60_000) {
    return `Ends in ${Math.floor(ms / 60_000)}m`;
  }

  if (ms < 24 * 60 * 60_000) {
    const h = Math.floor(ms / 3_600_000);

    const mm = Math.floor(
      (ms % 3_600_000) / 60_000
    );

    return `Ends in ${h}h ${mm}m`;
  }

  return `Ends ${mo} ${day}`;
}

function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');

  const p = s.split('.');

  return p.length <= 2
    ? s
    : p[0] + '.' + p.slice(1).join('');
}

let _bodyLockCount = 0;

function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return;
    }

    if (_bodyLockCount === 0) {
      document.body.style.overflow = 'hidden';
    }

    _bodyLockCount++;

    return () => {
      _bodyLockCount = Math.max(
        0,
        _bodyLockCount - 1
      );

      if (_bodyLockCount === 0) {
        document.body.style.overflow = '';
      }
    };
  }, [open]);
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement('textarea');

    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';

    document.body.appendChild(ta);

    ta.select();

    const ok = document.execCommand('copy');

    document.body.removeChild(ta);

    return ok;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes) {
  let binary = '';

  const chunkSize = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize)
    );
  }

  return btoa(binary);
}

const SCHEMA_VERSION = 3;

const SCHEMA_KEY = 'pm_schema_v';

(function migrateSchema() {
  try {
    const current = parseInt(
      localStorage.getItem(SCHEMA_KEY) || '0',
      10
    );

    if (current === SCHEMA_VERSION) {
      return;
    }

    const toDel = [];

    for (
      let i = 0;
      i < localStorage.length;
      i++
    ) {
      const k = localStorage.key(i);

      if (
        k &&
        k.startsWith('pm_') &&
        k !== SCHEMA_KEY
      ) {
        toDel.push(k);
      }
    }

    toDel.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });

    localStorage.setItem(
      SCHEMA_KEY,
      String(SCHEMA_VERSION)
    );

    dbg(
      'migrate',
      `cache schema ${current} → ${SCHEMA_VERSION}, purged ${toDel.length} keys`
    );
  } catch (e) {
    dbgErr('migrate', 'failed', e);
  }
})();

const LS = {
  safe: (evm) =>
    'pm_safe_' + evm.toLowerCase(),

  deployed: (evm) =>
    'pm_safe_dep_' + evm.toLowerCase(),

  approvals: (evm) =>
    'pm_safe_appr_' + evm.toLowerCase(),

  bridgeAddr: (evm) =>
    'pm_br_addrs_' + evm.toLowerCase(),
};

const SS = {
  creds: (evm) =>
    'pm_creds_' + evm.toLowerCase(),
};

function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

function lsDel(k) {
  try {
    localStorage.removeItem(k);
  } catch {}
}

function lsGetJson(k) {
  try {
    const r = localStorage.getItem(k);

    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}

function lsSetJson(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

function ssGetJson(k) {
  try {
    const r = sessionStorage.getItem(k);

    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}

function ssSetJson(k, v) {
  try {
    sessionStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

function ssDel(k) {
  try {
    sessionStorage.removeItem(k);
  } catch {}
}

function wipeUserCache(evm) {
  if (!evm) return;

  lsDel(LS.safe(evm));
  lsDel(LS.deployed(evm));
  lsDel(LS.approvals(evm));
  lsDel(LS.bridgeAddr(evm));

  ssDel(SS.creds(evm));

  dbg('cache', 'wiped for ' + evm);
}

let _sdks = null;

async function loadSdks() {
  if (_sdks) return _sdks;

  dbg('sdk', 'loading');

  const [
    clob,
    relayer,
    signing,
    derive,
    config,
    viem,
    viemChains,
  ] = await Promise.all([
    import('@polymarket/clob-client'),

    import(
      '@polymarket/builder-relayer-client'
    ),

    import(
      '@polymarket/builder-signing-sdk'
    ),

    import(
      '@polymarket/builder-relayer-client/dist/builder/derive'
    ),

    import(
      '@polymarket/builder-relayer-client/dist/config'
    ),

    import('viem'),

    import('viem/chains'),
  ]);

  _sdks = {
    clob,
    relayer,
    signing,
    derive,
    config,
    viem,
    viemChains,
  };

  dbg('sdk', 'loaded', {
    clob: !!clob?.ClobClient,
    relay: !!relayer?.RelayClient,
    signing: !!signing?.BuilderConfig,
    derive: !!derive?.deriveSafe,
    viem: !!viem?.createWalletClient,
    polygon: !!viemChains?.polygon,
  });

  return _sdks;
}

async function buildSigner(
  getEvmProvider,
  evmAddress
) {
  const { viem, viemChains } =
    await loadSdks();

  const provider = await getEvmProvider();

  if (!provider) {
    throw new Error(
      'Privy EVM provider unavailable — sign in first'
    );
  }

  if (!evmAddress) {
    throw new Error('No EOA address');
  }

  const walletClient =
    viem.createWalletClient({
      account: evmAddress,
      chain: viemChains.polygon,
      transport: viem.custom(provider),
    });

  dbg('signer', 'viem walletClient built', {
    account: evmAddress,
  });

  return walletClient;
}

async function buildRelayClient(
  getEvmProvider,
  evmAddress
) {
  const { relayer, signing } =
    await loadSdks();

  if (!relayer?.RelayClient) {
    throw new Error('RelayClient missing');
  }

  if (!signing?.BuilderConfig) {
    throw new Error('BuilderConfig missing');
  }

  const signer = await buildSigner(
    getEvmProvider,
    evmAddress
  );

  const origin =
    (
      typeof window !== 'undefined' &&
      window.location?.origin
    ) || '';

  const builderConfig =
    new signing.BuilderConfig({
      remoteBuilderConfig: {
        url: origin + '/api/poly/sign',
      },
    });

  return new relayer.RelayClient(
    RELAYER_URL + '/',
    POLYGON_CHAIN_ID,
    signer,
    builderConfig
  );
}

async function deriveSafeAddress(eoa) {
  const { derive, config } = await loadSdks();

  if (!derive?.deriveSafe) {
    throw new Error('deriveSafe missing');
  }

  if (!config?.getContractConfig) {
    throw new Error('getContractConfig missing');
  }

  const cfg = config.getContractConfig(POLYGON_CHAIN_ID);

  const factory =
    cfg?.SafeContracts?.SafeFactory ||
    cfg?.SafeFactory;

  if (!factory) {
    throw new Error('Safe factory missing from config');
  }

  const safe = derive.deriveSafe(eoa, factory);

  dbg('safe', 'derived', {
    eoa,
    safe,
  });

  return safe;
}

async function ensureSafeDeployed(
  evm,
  getEvmProvider,
  onStatus
) {
  let safe = lsGet(LS.safe(evm));

  if (!safe) {
    safe = await deriveSafeAddress(evm);
    lsSet(LS.safe(evm), safe);
  }

  if (lsGet(LS.deployed(evm)) === '1') {
    return safe;
  }

  const relay = await buildRelayClient(
    getEvmProvider,
    evm
  );

  try {
    if (typeof relay.getDeployed === 'function') {
      const deployed = await relay.getDeployed(safe);

      if (deployed) {
        lsSet(LS.deployed(evm), '1');
        dbg('safe', 'already deployed');
        return safe;
      }
    }
  } catch (e) {
    dbgErr('safe', 'getDeployed failed', e);
  }

  onStatus?.('Setting up trading account…');

  const resp = await relay.deploy();
  const res = await resp.wait();

  const final = res?.proxyAddress || safe;

  lsSet(LS.safe(evm), final);
  lsSet(LS.deployed(evm), '1');

  dbg('safe', 'deployed', {
    safe: final,
  });

  return final;
}

const MAX_UINT256 = (1n << 256n) - 1n;

function encErc20Approve(spender, amount) {
  return (
    '0x095ea7b3' +
    spender
      .replace(/^0x/, '')
      .toLowerCase()
      .padStart(64, '0') +
    BigInt(amount).toString(16).padStart(64, '0')
  );
}

function encErc1155SetApprovalForAll(
  operator,
  approved
) {
  return (
    '0xa22cb465' +
    operator
      .replace(/^0x/, '')
      .toLowerCase()
      .padStart(64, '0') +
    (approved ? '1' : '0').padStart(64, '0')
  );
}

function buildApprovalTxs() {
  return [
    {
      to: USDC_E_ADDRESS,
      value: '0',
      data: encErc20Approve(
        CTF_EXCHANGE,
        MAX_UINT256.toString()
      ),
    },
    {
      to: USDC_E_ADDRESS,
      value: '0',
      data: encErc20Approve(
        NEG_RISK_CTF_EXCHANGE,
        MAX_UINT256.toString()
      ),
    },
    {
      to: USDC_E_ADDRESS,
      value: '0',
      data: encErc20Approve(
        NEG_RISK_ADAPTER,
        MAX_UINT256.toString()
      ),
    },
    {
      to: USDC_E_ADDRESS,
      value: '0',
      data: encErc20Approve(
        CONDITIONAL_TOKENS,
        MAX_UINT256.toString()
      ),
    },
    {
      to: CONDITIONAL_TOKENS,
      value: '0',
      data: encErc1155SetApprovalForAll(
        CTF_EXCHANGE,
        true
      ),
    },
    {
      to: CONDITIONAL_TOKENS,
      value: '0',
      data: encErc1155SetApprovalForAll(
        NEG_RISK_CTF_EXCHANGE,
        true
      ),
    },
    {
      to: CONDITIONAL_TOKENS,
      value: '0',
      data: encErc1155SetApprovalForAll(
        NEG_RISK_ADAPTER,
        true
      ),
    },
  ];
}

async function ensureApprovals(
  evm,
  getEvmProvider,
  safeAddress,
  onStatus
) {
  if (lsGet(LS.approvals(evm)) === '1') {
    return;
  }

  onStatus?.('Approving contracts…');

  const relay = await buildRelayClient(
    getEvmProvider,
    evm
  );

  if (typeof relay.execute !== 'function') {
    throw new Error('relay.execute missing');
  }

  const txs = buildApprovalTxs();

  const resp = await relay.execute(
    txs,
    'Polymarket trading approvals'
  );

  await resp.wait();

  lsSet(LS.approvals(evm), '1');

  dbg('approvals', 'done', {
    txs: txs.length,
    safeAddress,
  });
}

async function getOrDeriveCreds(
  evm,
  getEvmProvider
) {
  const cached = ssGetJson(SS.creds(evm));

  if (
    cached?.key &&
    cached?.secret &&
    cached?.passphrase
  ) {
    return cached;
  }

  const { clob } = await loadSdks();

  const signer = await buildSigner(
    getEvmProvider,
    evm
  );

  const temp = new clob.ClobClient(
    CLOB_URL,
    POLYGON_CHAIN_ID,
    signer
  );

  let creds;

  try {
    creds = await temp.createOrDeriveApiKey();
  } catch (e) {
    dbgErr(
      'creds',
      'createOrDeriveApiKey failed, trying deriveApiKey',
      e
    );

    try {
      creds = await temp.deriveApiKey();
    } catch (e2) {
      dbgErr(
        'creds',
        'deriveApiKey failed, trying createApiKey',
        e2
      );

      creds = await temp.createApiKey();
    }
  }

  const norm = {
    key: creds.key || creds.apiKey,
    secret: creds.secret,
    passphrase: creds.passphrase,
  };

  if (
    !norm.key ||
    !norm.secret ||
    !norm.passphrase
  ) {
    throw new Error('Incomplete creds');
  }

  ssSetJson(SS.creds(evm), norm);

  dbg('creds', 'stored session creds');

  return norm;
}

async function buildClobClient(
  getEvmProvider,
  evmAddress,
  safeAddress,
  creds
) {
  const { clob, signing } = await loadSdks();

  const signer = await buildSigner(
    getEvmProvider,
    evmAddress
  );

  const origin =
    (
      typeof window !== 'undefined' &&
      window.location?.origin
    ) || '';

  const builderConfig =
    new signing.BuilderConfig({
      remoteBuilderConfig: {
        url: origin + '/api/poly/sign',
      },
    });

  return new clob.ClobClient(
    CLOB_URL,
    POLYGON_CHAIN_ID,
    signer,
    creds,
    2,
    safeAddress,
    undefined,
    false,
    builderConfig
  );
}

async function ensureSetup(
  evm,
  getEvmProvider,
  onStatus
) {
  dbg('setup', 'start', {
    evm,
  });

  const safe = await ensureSafeDeployed(
    evm,
    getEvmProvider,
    onStatus
  );

  const creds = await getOrDeriveCreds(
    evm,
    getEvmProvider
  );

  await ensureApprovals(
    evm,
    getEvmProvider,
    safe,
    onStatus
  );

  dbg('setup', 'done', {
    safe,
  });

  return {
    safeAddress: safe,
    creds,
  };
}

async function rpc(method, params, ms = 8000) {
  let lastErr;

  for (const url of POLYGON_RPCS) {
    try {
      const r = await jfetch(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params,
          }),
        },
        ms
      );

      const j = await r.json();

      if (j.error) {
        lastErr = new Error(
          `RPC ${method}: ${j.error.message}`
        );

        continue;
      }

      return j.result;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('All Polygon RPCs failed');
}

async function ethCallBalance(token, holder) {
  try {
    const addr = holder
      .toLowerCase()
      .replace(/^0x/, '')
      .padStart(64, '0');

    const data = '0x70a08231' + addr;

    const hex = await rpc('eth_call', [
      {
        to: token,
        data,
      },
      'latest',
    ]);

    if (!hex || !hex.startsWith('0x')) {
      return 0n;
    }

    return BigInt(hex);
  } catch {
    return 0n;
  }
}

async function fetchSafeBalance(safe) {
  if (!safe) return 0n;

  return await ethCallBalance(USDC_E_ADDRESS, safe);
}

function deriveSolanaAta(
  ownerB58,
  mint = USDC_SOLANA_MINT
) {
  const TOKEN = new PublicKey(TOKEN_PROGRAM_ID);
  const ATA = new PublicKey(ATA_PROGRAM_ID);
  const owner = new PublicKey(ownerB58);
  const mintK = new PublicKey(mint);

  const [ata] = PublicKey.findProgramAddressSync(
    [
      owner.toBuffer(),
      TOKEN.toBuffer(),
      mintK.toBuffer(),
    ],
    ATA
  );

  return ata.toBase58();
}

async function fetchSolanaUsdcBalance(ownerB58) {
  try {
    const ata = deriveSolanaAta(
      ownerB58,
      USDC_SOLANA_MINT
    );

    const r = await jfetch(
      SOL_RPC,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountBalance',
          params: [
            ata,
            {
              commitment: 'confirmed',
            },
          ],
        }),
      },
      6000
    );

    const j = await r.json();

    return j?.result?.value?.amount
      ? BigInt(j.result.value.amount)
      : 0n;
  } catch {
    return 0n;
  }
}

async function fetchSolanaSolBalance(ownerB58) {
  try {
    const r = await jfetch(
      SOL_RPC,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [
            ownerB58,
            {
              commitment: 'confirmed',
            },
          ],
        }),
      },
      6000
    );

    const j = await r.json();

    return j?.result?.value
      ? BigInt(j.result.value)
      : 0n;
  } catch {
    return 0n;
  }
}

async function fetchBridgeAddresses(safe) {
  const r = await jfetch(
    BRIDGE_DEPOSIT,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address: safe,
      }),
    },
    15000
  );

  const j = await r.json();

  dbg('bridge', 'addresses', j);

  const a =
    j.address && typeof j.address === 'object'
      ? j.address
      : j;

  return {
    evm:
      a.evm ||
      a.evmAddress ||
      a.evm_address ||
      null,

    svm:
      a.svm ||
      a.svmAddress ||
      a.svm_address ||
      null,
  };
}

async function getBridgeAddressesCached(evm, safe) {
  const cached = lsGetJson(LS.bridgeAddr(evm));

  const cacheValid =
    cached &&
    typeof cached.svm === 'string' &&
    cached.svm.length >= 32 &&
    typeof cached.evm === 'string' &&
    cached.evm.startsWith('0x');

  if (cacheValid) return cached;

  if (cached) {
    dbg('bridge', 'purging bad cache', cached);
    lsDel(LS.bridgeAddr(evm));
  }

  const addrs = await fetchBridgeAddresses(safe);

  if (addrs.svm && addrs.evm) {
    lsSetJson(LS.bridgeAddr(evm), addrs);
  }

  return addrs;
}

async function fetchBridgeStatus(statusAddress) {
  try {
    const r = await jfetch(
      `${BRIDGE_STATUS}/${encodeURIComponent(statusAddress)}`,
      {},
      8000
    );

    return await r.json();
  } catch {
    return null;
  }
}

async function waitForBridge(statusAddress, sig) {
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    try {
      const s = await fetchBridgeStatus(statusAddress);

      const arr = Array.isArray(s?.deposits)
        ? s.deposits
        : Array.isArray(s)
          ? s
          : [];

      const hit = arr.find((d) => {
        const status = String(
          d.status ||
          d.state ||
          d.bridgeStatus ||
          ''
        ).toUpperCase();

        return (
          d.txHash === sig ||
          d.sourceTxHash === sig ||
          d.sigSrc === sig ||
          status === 'COMPLETED' ||
          status === 'CONFIRMED' ||
          status === 'SUCCESS'
        );
      });

      if (hit) {
        dbg('bridge', 'completed', hit);
        return true;
      }
    } catch {}

    await new Promise((r) => setTimeout(r, 2000));
  }

  dbg('bridge', 'wait timed out; balance poller will continue');

  return false;
}

async function submitSolTx(signedTx) {
  const raw = signedTx.serialize();

  const b64 = bytesToBase64(new Uint8Array(raw));

  const r = await jfetch(
    SOL_RPC,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [
          b64,
          {
            encoding: 'base64',
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 5,
          },
        ],
      }),
    },
    20000
  );

  const j = await r.json();

  if (j.error) {
    throw new Error(j.error.message || 'Solana submit failed');
  }

  return j.result;
}

// Build a TransactionInstruction from OKX's instruction format.
// Mirrors deserializeOkxIx() from the working SwapWidget.
async function deserializeOkxIx(ix) {
  try {
    if (!ix || !ix.programId || !Array.isArray(ix.accounts) || !ix.data) {
      return null;
    }

    const web3 = await import('@solana/web3.js');
    const { TransactionInstruction, PublicKey: PK } = web3;

    return new TransactionInstruction({
      programId: new PK(ix.programId),
      keys: ix.accounts.map((a) => ({
        pubkey: new PK(a.pubkey || a.publicKey || a.address),
        isSigner: !!a.isSigner,
        isWritable: !!a.isWritable,
      })),
      data: Uint8Array.from(atob(ix.data), (c) => c.charCodeAt(0)),
    });
  } catch (e) {
    dbgErr('okx-ix', 'failed to deserialize', e);
    return null;
  }
}

// Build a VersionedTransaction from OKX's swap-instruction response.
// Mirrors buildOkxSolTx() from the working SwapWidget.
async function buildOkxSolTxFromInstructions({ userPubkey, swapData }) {
  const web3 = await import('@solana/web3.js');
  const {
    Connection,
    PublicKey: PK,
    VersionedTransaction: VTx,
    TransactionMessage,
    AddressLookupTableAccount,
  } = web3;

  const origin =
    (typeof window !== 'undefined' && window.location?.origin) || '';
  const conn = new Connection(origin + SOL_RPC, 'confirmed');

  // Some OKX responses include a pre-built tx blob — try that first.
  if (swapData?.tx?.data) {
    try {
      const bytes = Uint8Array.from(atob(swapData.tx.data), (c) =>
        c.charCodeAt(0)
      );
      const tx = VTx.deserialize(bytes);
      dbg('okx-build', 'used pre-built tx blob');
      return tx;
    } catch (e) {
      dbg('okx-build', 'pre-built tx blob failed, falling back to instructions');
    }
  }

  const rawIxs = swapData?.instructionLists || [];
  const ixs = (
    await Promise.all(rawIxs.map(deserializeOkxIx))
  ).filter(Boolean);

  if (!ixs.length) {
    throw new Error('OKX returned no usable instructions');
  }

  // Fetch ALTs in parallel.
  const ltAddrs = Array.isArray(swapData.addressLookupTableAccount)
    ? swapData.addressLookupTableAccount
    : [];

  const lts = (
    await Promise.all(
      ltAddrs.map(async (a) => {
        try {
          const key = new PK(a);
          const acct = await conn.getAccountInfo(key);
          if (!acct) return null;
          return new AddressLookupTableAccount({
            key,
            state: AddressLookupTableAccount.deserialize(acct.data),
          });
        } catch (e) {
          dbgErr('okx-lt', 'failed to load ALT ' + a, e);
          return null;
        }
      })
    )
  ).filter(Boolean);

  const { blockhash } = await conn.getLatestBlockhash('finalized');

  const msg = new TransactionMessage({
    payerKey: userPubkey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(lts);

  dbg('okx-build', 'built v0 tx', {
    ixCount: ixs.length,
    ltCount: lts.length,
  });

  return new VTx(msg);
}

async function depositFromSol({
  ownerB58,
  evm,
  safe,
  solAtomic,
  sendFn,
  connection,
  onStatus,
}) {
  onStatus?.('Getting deposit address…');

  const addrs = await getBridgeAddressesCached(evm, safe);

  if (!addrs.svm) {
    throw new Error('No svm deposit address');
  }

  onStatus?.('Quoting swap (5% fee included)…');

  // Use /swap-instruction (same endpoint as the working SwapWidget).
  // Output goes directly to the Polymarket bridge SVM address.
  // NOTE: server.js automatically injects feePercent + toTokenReferrerWalletAddress
  // for all Solana swaps via injectOkxFee(). Do NOT send fee params from here
  // or they'll be overwritten / cause double config.
  const params = new URLSearchParams({
    chainIndex: OKX_SOL_CHAIN,
    amount: String(solAtomic),
    fromTokenAddress: SOL_NATIVE_MINT,
    toTokenAddress: USDC_SOLANA_MINT,
    userWalletAddress: ownerB58,
    swapReceiverAddress: addrs.svm,
    slippagePercent: OKX_SLIPPAGE,
  });

  const r = await jfetch(
    `${OKX_SWAP_INSTRUCTION_PATH}?${params}`,
    {},
    15000
  );

  const j = await r.json();

  if (j.code && j.code !== '0') {
    throw new Error('OKX swap: ' + (j.msg || j.code));
  }

  const swapData = Array.isArray(j.data) ? j.data[0] : j.data;

  if (!swapData) {
    throw new Error('OKX returned no swap data');
  }

  dbg('deposit-sol', 'okx response', {
    hasInstructions: !!swapData.instructionLists?.length,
    instructionCount: swapData.instructionLists?.length || 0,
    altCount: swapData.addressLookupTableAccount?.length || 0,
    hasPreBuiltTx: !!swapData.tx?.data,
  });

  const userPubkey = new PublicKey(ownerB58);

  const tx = await buildOkxSolTxFromInstructions({
    userPubkey,
    swapData,
  });

  onStatus?.('Confirm in your wallet…');

  // Send via wallet-adapter sendTransaction (SwapWidget pattern).
  // This signs AND submits with skipPreflight:false, so the RPC runs
  // a preflight simulation before broadcast -- doomed txs fail fast.
  const sig = await sendFn(tx, connection);

  dbg('deposit-sol', 'submitted', { sig });

  onStatus?.('Bridging to USDC.e (~30s)…');

  // Fire-and-forget confirmation (matches SwapWidget). We don't await this
  // because the bridge poller below tells us when the actual deposit lands.
  try {
    const latest = await connection.getLatestBlockhash('confirmed');
    connection
      .confirmTransaction(
        {
          signature: sig,
          blockhash: tx.message.recentBlockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        'confirmed'
      )
      .catch(() => {});
  } catch (e) {
    dbg('deposit-sol', 'confirm setup failed (non-fatal)', { err: e?.message });
  }

  await waitForBridge(addrs.svm, sig);

  return { sig };
}

async function buildUsdcSplitTx({
  ownerB58,
  bridgeSvm,
  totalAtomic,
}) {
  const web3 = await import('@solana/web3.js');
  const spl = await import('@solana/spl-token');

  const {
    Connection,
    PublicKey: PK,
    Transaction,
    ComputeBudgetProgram,
  } = web3;

  const {
    createTransferCheckedInstruction,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress,
    getAccount,
  } = spl;

  const origin =
    (
      typeof window !== 'undefined' &&
      window.location?.origin
    ) || '';

  const conn = new Connection(
    origin + SOL_RPC,
    'confirmed'
  );

  const owner = new PK(ownerB58);
  const bridge = new PK(bridgeSvm);
  const fee = new PK(FEE_WALLET_SOL);
  const mint = new PK(USDC_SOLANA_MINT);

  const total = BigInt(totalAtomic);

  const feeAmt =
    (total * BigInt(USDC_FEE_PCT * 100)) / 10000n;

  const sendAmt = total - feeAmt;

  if (sendAmt <= 0n) {
    throw new Error('Deposit amount too small after fee');
  }

  const fromAta = await getAssociatedTokenAddress(
    mint,
    owner
  );

  const bridgeAta = await getAssociatedTokenAddress(
    mint,
    bridge
  );

  const feeAta = await getAssociatedTokenAddress(
    mint,
    fee
  );

  const ixs = [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 50000,
    }),
  ];

  try {
    await getAccount(conn, bridgeAta);
  } catch {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        owner,
        bridgeAta,
        bridge,
        mint
      )
    );
  }

  try {
    await getAccount(conn, feeAta);
  } catch {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        owner,
        feeAta,
        fee,
        mint
      )
    );
  }

  ixs.push(
    createTransferCheckedInstruction(
      fromAta,
      mint,
      bridgeAta,
      owner,
      sendAmt,
      6
    )
  );

  ixs.push(
    createTransferCheckedInstruction(
      fromAta,
      mint,
      feeAta,
      owner,
      feeAmt,
      6
    )
  );

  const { blockhash } =
    await conn.getLatestBlockhash('confirmed');

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: owner,
  });

  for (const ix of ixs) {
    tx.add(ix);
  }

  return {
    tx,
    sendAmt,
    feeAmt,
  };
}

async function depositFromUsdc({
  ownerB58,
  evm,
  safe,
  usdcAtomic,
  sendFn,
  connection,
  onStatus,
}) {
  onStatus?.('Getting deposit address…');

  const addrs = await getBridgeAddressesCached(evm, safe);

  if (!addrs.svm) {
    throw new Error('No svm deposit address');
  }

  onStatus?.('Building transfer (95% bridge + 5% fee)…');

  const { tx, sendAmt, feeAmt } =
    await buildUsdcSplitTx({
      ownerB58,
      bridgeSvm: addrs.svm,
      totalAtomic: usdcAtomic,
    });

  dbg('deposit-usdc', 'amounts', {
    sendAmt: sendAmt.toString(),
    feeAmt: feeAmt.toString(),
    bridgeSvm: addrs.svm,
  });

  onStatus?.('Confirm in your wallet…');

  // sendFn signs + submits with skipPreflight:false so the RPC runs
  // a preflight simulation before broadcast (SwapWidget pattern).
  const sig = await sendFn(tx, connection);

  dbg('deposit-usdc', 'submitted', { sig });

  onStatus?.('Bridging to USDC.e (~30s)…');

  await waitForBridge(addrs.svm, sig);

  return { sig };
}

async function requestWithdraw({
  safe,
  solanaAddress,
  amountAtomic,
  onStatus,
}) {
  onStatus?.('Initiating withdrawal…');

  const body = {
    from: safe,
    to: solanaAddress,
    chain: 'solana',
    asset: 'USDC',
    amount: amountAtomic.toString(),
  };

  const r = await jfetch(
    BRIDGE_WITHDRAW,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    20000
  );

  const j = await r.json();

  if (j?.error) {
    throw new Error(j.error);
  }

  dbg('withdraw', 'submitted', j);

  return j;
}

async function fetchMarketsByTagSlug(slug) {
  const url =
    `${GAMMA_URL}/events?tag_slug=${encodeURIComponent(slug)}` +
    '&closed=false&order=volume24hr&ascending=false&limit=60';

  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!r.ok) {
    return [];
  }

  return await r.json();
}

async function fetchMarketsByTagId(tagId) {
  const url =
    `${GAMMA_URL}/events?tag_id=${tagId}` +
    '&related_tags=true&closed=false&order=volume24hr&ascending=false&limit=80';

  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!r.ok) {
    throw new Error(`Gamma ${r.status}`);
  }

  return await r.json();
}

function normalizeEvent(ev) {
  const ms = Array.isArray(ev.markets)
    ? ev.markets
    : [];

  if (ms.length === 0) {
    return null;
  }

  const m = ms[0];

  let outcomePrices = [];

  try {
    outcomePrices =
      typeof m.outcomePrices === 'string'
        ? JSON.parse(m.outcomePrices)
        : m.outcomePrices || [];
  } catch {}

  let clobTokenIds = [];

  try {
    clobTokenIds =
      typeof m.clobTokenIds === 'string'
        ? JSON.parse(m.clobTokenIds)
        : m.clobTokenIds || [];
  } catch {}

  const yesPrice = Number(
    outcomePrices[0] || m.lastTradePrice || 0
  );

  const noPrice = Number(
    outcomePrices[1] || 1 - yesPrice
  );

  return {
    id: ev.id,
    slug: ev.slug,
    title: ev.title || m.question || 'Untitled',
    childQuestion:
      ms.length > 1
        ? m.question || m.groupItemTitle || null
        : null,
    image: ev.image || ev.icon || m.image || null,
    volume24h: Number(ev.volume24hr || m.volume24hr || 0),
    liquidity: Number(ev.liquidity || m.liquidity || 0),
    endDate: ev.endDate || m.endDate || null,
    yesPrice,
    noPrice,
    yesPct: Math.round(yesPrice * 100),
    noPct: Math.round(noPrice * 100),
    marketCount: ms.length,
    conditionId: m.conditionId,
    clobTokenIds,
    negRisk: !!(m.negRisk || ev.negRisk),
    tickSize: String(
      m.orderPriceMinTickSize ||
      m.minimum_tick_size ||
      m.tickSize ||
      '0.01'
    ),
  };
}

function isTradableMarket(m, h) {
  if (!m || !m.clobTokenIds || m.clobTokenIds.length < 2 || !m.conditionId) return false;
  const y = Number(m.yesPrice) || 0;
  if (y <= 0.02 || y >= 0.98) return false;
  if (!m.endDate) return false;
  const ms = new Date(m.endDate).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return false;
  if (h && Number.isFinite(h.maxMs) && ms > h.maxMs) return false;
  if ((Number(m.volume24h) || 0) < 500) return false;
  if ((Number(m.liquidity) || 0) < 100) return false;
  return true;
}

async function placeMarketOrder({ getEvmProvider, evmAddress, safeAddress, creds, market, side, amountUsd, isBuy }) {
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  if (!tokenId) throw new Error('Token ID missing');

  const { clob } = await loadSdks();
  const Side = clob.Side || { BUY: 'BUY', SELL: 'SELL' };
  const OrderType = clob.OrderType || { FOK: 'FOK', FAK: 'FAK', GTC: 'GTC' };
  const client = await buildClobClient(getEvmProvider, evmAddress, safeAddress, creds);
  const price = side === 'yes' ? Number(market.yesPrice) : Number(market.noPrice);

  if (!Number.isFinite(price) || price <= 0 || price >= 1) {
    throw new Error('Invalid market price');
  }

  const orderArgs = {
    tokenID: String(tokenId),
    price,
    size: isBuy ? amountUsd / price : amountUsd,
    side: isBuy ? Side.BUY : Side.SELL,
    feeRateBps: 0,
    expiration: 0,
    taker: '0x0000000000000000000000000000000000000000',
    builderCode: BUILDER_CODE,
  };

  const opts = {
    tickSize: market.tickSize || '0.01',
    negRisk: !!market.negRisk,
  };

  dbg('order', 'submitting', {
    side,
    isBuy,
    amount: amountUsd,
    price,
    safeAddress,
    builderCode: BUILDER_CODE,
  });

  const type = OrderType.FAK || OrderType.FOK || OrderType.GTC;
  const resp = await client.createAndPostOrder(orderArgs, opts, type);

  if (resp?.error || resp?.errorMsg) throw new Error(resp.error || resp.errorMsg);
  if (resp?.success === false) throw new Error(resp?.errorMsg || 'Order rejected');

  dbg('order', 'placed', resp);
  return resp;
}

async function fetchPositions(safe, conditionId, clobTokenIds) {
  try {
    const r = await fetch(`${DATA_API_URL}/positions?user=${safe.toLowerCase()}&market=${conditionId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data)) return null;

    const [yesTid, noTid] = clobTokenIds || [];
    let yPos = null;
    let nPos = null;

    for (const p of data) {
      const tid = String(p.asset || p.tokenId || p.token_id || '');
      if (yesTid && tid === String(yesTid)) yPos = p;
      if (noTid && tid === String(noTid)) nPos = p;
    }

    const sz = p => p ? Number(p.size || p.shares || p.balance || 0) : 0;
    const av = p => p ? Number(p.avgPrice || p.average_price || p.avg_price || 0) : 0;

    return {
      sharesYes: sz(yPos),
      sharesNo: sz(nPos),
      avgPriceYes: av(yPos),
      avgPriceNo: av(nPos),
    };
  } catch {
    return null;
  }
}

async function fetchBestBid(tokenId) {
  try {
    const r = await fetch(`${CLOB_URL}/book?token_id=${tokenId}`);
    if (!r.ok) return 0;
    const d = await r.json();
    const bids = d?.bids || [];
    let best = 0;
    for (const b of bids) {
      const p = Number(b.price || b.p || 0);
      if (p > best) best = p;
    }
    return best;
  } catch {
    return 0;
  }
}

function MarketSkeleton() {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: C.card, border: `1px solid ${C.border}`, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
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
  const yp = Number(market.yesPrice) || 0;
  const np = Number(market.noPrice) || 0;
  const upside = p => (p < 0.02 || p > 0.98) ? 0 : Math.min(9999, Math.round((1 / p - 1) * 100));
  const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis' };

  return (
    <div style={{ padding: 14, borderRadius: 16, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 10, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        {image && <img src={image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: 38, height: 38, borderRadius: 9, objectFit: 'cover', flexShrink: 0, background: '#0a1020' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: childQuestion ? 3 : 5, ...T.body, ...clamp2 }}>{title}</div>
          {childQuestion && <div style={{ fontSize: 10.5, fontWeight: 600, color: C.hl, marginBottom: 5, ...T.body, ...clamp2 }}>{childQuestion}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 9.5, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(volume24h)}</span>
            {formatEndDate(endDate) && <><span style={{ opacity: .4 }}>·</span><span>{formatEndDate(endDate)}</span></>}
            {marketCount > 1 && <><span style={{ opacity: .4 }}>·</span><span>{marketCount} outcomes</span></>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 44 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yesPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onTrade(market, 'yes')} style={{ flex: 1, padding: 10, borderRadius: 11, background: C.yesDim, border: '1px solid rgba(0,212,163,.30)', color: C.yes, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Yes · ${yp.toFixed(2)}</span>
          {upside(yp) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(yp)}% upside</span>}
        </button>
        <button onClick={() => onTrade(market, 'no')} style={{ flex: 1, padding: 10, borderRadius: 11, background: C.noDim, border: '1px solid rgba(255,95,122,.30)', color: C.no, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>No · ${np.toFixed(2)}</span>
          {upside(np) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(np)}% upside</span>}
        </button>
      </div>
    </div>
  );
}

function DebugPanel({ open, onToggle }) {
  const log = useDbgLog();
  const ref = useRef(null);

  useEffect(() => {
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log.length, open]);

  const copy = () => {
    try {
      const t = log.map(e => `${new Date(e.ts).toISOString().slice(11, 23)} [${e.scope}] ${e.msg}${e.data ? ' ' + JSON.stringify(e.data) : ''}`).join('\n');
      navigator.clipboard?.writeText(t);
    } catch {}
  };

  return (
    <div style={{ marginBottom: 12, borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '9px 12px', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 800, letterSpacing: 1.2, ...T.mono }}>DEBUG · {log.length} {open ? '▾' : '▸'}</span>
        {open && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={(e) => { e.stopPropagation(); copy(); }} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, fontWeight: 700, ...T.mono }}>COPY</button>
            <button onClick={(e) => { e.stopPropagation(); dbgClear(); }} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, fontWeight: 700, ...T.mono }}>CLEAR</button>
          </div>
        )}
      </div>
      {open && (
        <div ref={ref} style={{ maxHeight: 220, overflowY: 'auto', padding: '8px 12px', background: 'rgba(0,0,0,.25)', borderTop: `1px solid ${C.border}`, ...T.mono, fontSize: 10, lineHeight: 1.5 }}>
          {log.length === 0 ? <div style={{ color: C.muted2, fontStyle: 'italic' }}>No entries yet.</div> : log.map((e, i) => {
            const isErr = String(e.msg).startsWith('ERROR');
            return (
              <div key={i} style={{ color: isErr ? C.no : C.ink, marginBottom: 2, wordBreak: 'break-word' }}>
                <span style={{ color: C.muted2 }}>{new Date(e.ts).toISOString().slice(11, 23)}</span>{' '}
                <span style={{ color: C.hl, fontWeight: 700 }}>[{e.scope}]</span> {e.msg}
                {e.data !== undefined && <span style={{ color: C.muted, fontSize: 9 }}> {JSON.stringify(e.data).slice(0, 220)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusLine({ msg }) {
  return (
    <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite' }} />
      <span style={{ fontSize: 11, color: C.ink, fontWeight: 600 }}>{msg}</span>
    </div>
  );
}

function ErrorLine({ msg }) {
  return <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 10, fontSize: 11, color: C.no }}>{msg}</div>;
}

function PrimaryButton({ onClick, disabled, label }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{ width: '100%', padding: 12, borderRadius: 11, background: `linear-gradient(135deg, ${C.hl}, ${C.hl2})`, color: C.bg, fontWeight: 800, fontSize: 14, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1, ...T.body }}>
      {label}
    </button>
  );
}

function FundingSheet({ open, onClose, evmAddress, safeAddress, tradingBalance, fundingPubkey, solBalance, usdcBalance, sendSolanaTx, solConnection, onReset, refreshAll }) {
  const [tab, setTab] = useState('usdc');
  const [amount, setAmount] = useState('25');
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [dbgOpen, setDbgOpen] = useState(false);
  const [withdrawSolAddr, setWithdrawSolAddr] = useState('');

  useBodyLock(open);

  useEffect(() => {
    if (!open) {
      setStatus('idle');
      setStatusMsg('');
      setError('');
    }
    if (open && fundingPubkey && !withdrawSolAddr) setWithdrawSolAddr(fundingPubkey);
  }, [open, fundingPubkey, withdrawSolAddr]);

  if (!open) return null;

  const usdcUsd = Number(usdcBalance) / 1e6;
  const tradeUsd = Number(tradingBalance) / 1e6;
  const usd = Number(amount) || 0;
  const busy = status === 'working';

  const handleDepositUsdc = async () => {
    if (!fundingPubkey || !safeAddress) return;
    if (usd < MIN_DEPOSIT_USD) { setError(`Min $${MIN_DEPOSIT_USD}`); return; }
    if (usd > usdcUsd) { setError(`Max ${fmtUsd(usdcUsd, 2)}`); return; }

    setStatus('working');
    setError('');
    setStatusMsg('');

    try {
      const usdcAtomic = BigInt(Math.floor(usd * 1e6));
      await depositFromUsdc({ ownerB58: fundingPubkey, evm: evmAddress, safe: safeAddress, usdcAtomic, sendFn: sendSolanaTx, connection: solConnection, onStatus: setStatusMsg });
      setStatus('done');
      setTimeout(() => { refreshAll?.(); setStatus('idle'); setStatusMsg(''); }, 4000);
    } catch (e) {
      const m = e?.message || 'Deposit failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error');
      setStatusMsg('');
      setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const handleDepositSol = async () => {
    if (!fundingPubkey || !safeAddress) return;
    const solAmt = Number(amount);
    if (!(solAmt > 0)) { setError('Invalid amount'); return; }
    const solBal = Number(solBalance) / 1e9;
    if (solAmt > solBal - 0.005) { setError('Insufficient SOL (leave 0.005 for fees)'); return; }

    setStatus('working');
    setError('');
    setStatusMsg('');

    try {
      const solAtomic = BigInt(Math.floor(solAmt * 1e9));
      await depositFromSol({ ownerB58: fundingPubkey, evm: evmAddress, safe: safeAddress, solAtomic, sendFn: sendSolanaTx, connection: solConnection, onStatus: setStatusMsg });
      setStatus('done');
      setTimeout(() => { refreshAll?.(); setStatus('idle'); setStatusMsg(''); }, 4000);
    } catch (e) {
      const m = e?.message || 'Deposit failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error');
      setStatusMsg('');
      setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const handleWithdraw = async () => {
    if (!safeAddress) return;
    if (!withdrawSolAddr || withdrawSolAddr.length < 32) { setError('Invalid Solana address'); return; }
    if (usd < 1) { setError('Min $1'); return; }
    if (usd > tradeUsd) { setError(`Max ${fmtUsd(tradeUsd, 2)}`); return; }

    setStatus('working');
    setError('');
    setStatusMsg('');

    try {
      const amountAtomic = BigInt(Math.floor(usd * 1e6));
      await requestWithdraw({ safe: safeAddress, solanaAddress: withdrawSolAddr, amountAtomic, onStatus: setStatusMsg });
      setStatus('done');
      setStatusMsg('Withdrawal submitted — funds arrive in 2-5 min');
      setTimeout(() => { refreshAll?.(); setStatus('idle'); setStatusMsg(''); }, 6000);
    } catch (e) {
      const m = e?.message || 'Withdraw failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error');
      setStatusMsg('');
      setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const handleCopy = async () => {
    if (!safeAddress) return;
    const ok = await copyToClipboard(safeAddress);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)', boxShadow: C.shadowLg, maxHeight: '92dvh', overflowY: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 4, ...T.display }}>Account</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, ...T.body }}>Balance: <span style={{ color: C.hl, fontWeight: 700 }}>{fmtUsd(tradeUsd, 2)}</span></div>

        <DebugPanel open={dbgOpen} onToggle={() => setDbgOpen(o => !o)} />

        <div style={{ display: 'flex', gap: 4, marginBottom: 14, padding: 3, background: 'rgba(255,255,255,.03)', borderRadius: 10 }}>
          {[
            { id: 'usdc', label: 'USDC' },
            { id: 'sol', label: 'SOL' },
            { id: 'addr', label: 'Address' },
            { id: 'wd', label: 'Withdraw' },
          ].map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setAmount(t.id === 'sol' ? '0.1' : t.id === 'wd' ? String(Math.floor(tradeUsd)) : '25'); setError(''); }} disabled={t.id === 'sol' && !fundingPubkey} style={{ flex: 1, padding: '8px 4px', borderRadius: 8, background: tab === t.id ? C.hlDim : 'transparent', border: `1px solid ${tab === t.id ? C.borderHi : 'transparent'}`, color: tab === t.id ? C.hl : C.muted, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'usdc' && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, ...T.display }}>DEPOSIT USDC (SOLANA)</div>
              <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>{fmtUsd(usdcUsd, 2)} available</div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
              <span style={{ fontSize: 18, color: C.muted, ...T.display }}>$</span>
              <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 20, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>USDC</span>
            </div>

            <div style={{ fontSize: 10, color: C.muted2, marginBottom: 10, ...T.mono }}>5% fee · You receive {fmtUsd(usd * 0.95, 2)} for trading</div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {['10', '25', '100', '250'].map(v => (
                <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
              ))}
              <button onClick={() => setAmount(String(Math.floor(usdcUsd * 100) / 100))} disabled={busy || usdcUsd <= 0} style={{ flex: 1, padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
            </div>

            {statusMsg && <StatusLine msg={statusMsg} />}
            {error && <ErrorLine msg={error} />}
            {status === 'done' && <div style={{ marginBottom: 8, padding: 8, background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 10, fontSize: 11, color: C.yes, fontWeight: 700 }}>✓ Deposit submitted</div>}
            <PrimaryButton onClick={handleDepositUsdc} disabled={busy || !fundingPubkey} label={busy ? 'Depositing…' : `Deposit ${fmtUsd(usd, 2)}`} />
          </div>
        )}

        {tab === 'sol' && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, ...T.display }}>DEPOSIT SOL</div>
              <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>{(Number(solBalance) / 1e9).toFixed(4)} SOL available</div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
              <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 20, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>SOL</span>
            </div>

            <div style={{ fontSize: 10, color: C.muted2, marginBottom: 10, ...T.mono }}>Auto-swap to USDC · 5% fee included</div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {['0.1', '0.5', '1', '5'].map(v => (
                <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>{v}</button>
              ))}
              <button onClick={() => setAmount(String(Math.max(0, Number(solBalance) / 1e9 - 0.005).toFixed(4)))} disabled={busy} style={{ flex: 1, padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
            </div>

            {statusMsg && <StatusLine msg={statusMsg} />}
            {error && <ErrorLine msg={error} />}
            {status === 'done' && <div style={{ marginBottom: 8, padding: 8, background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 10, fontSize: 11, color: C.yes, fontWeight: 700 }}>✓ Deposit submitted</div>}
            <PrimaryButton onClick={handleDepositSol} disabled={busy || !fundingPubkey} label={busy ? 'Depositing…' : `Deposit ${amount} SOL`} />
          </div>
        )}

        {tab === 'addr' && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, marginBottom: 8, ...T.display }}>YOUR POLYGON TRADING ADDRESS</div>
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, ...T.mono, fontSize: 11, color: C.ink, wordBreak: 'break-all', marginBottom: 10 }}>{safeAddress || 'Setting up…'}</div>
            <button onClick={handleCopy} disabled={!safeAddress} style={{ width: '100%', padding: 10, borderRadius: 10, background: copied ? C.yesDim : C.hlDim, border: `1px solid ${copied ? C.yes + '55' : C.borderHi}`, color: copied ? C.yes : C.hl, fontSize: 12, fontWeight: 700, cursor: safeAddress ? 'pointer' : 'not-allowed', ...T.mono }}>{copied ? '✓ Copied' : 'Copy address'}</button>
            <div style={{ fontSize: 10, color: C.muted2, marginTop: 8, ...T.mono }}>⚠ Send USDC.e on Polygon ONLY. Wrong token/network = lost funds.</div>
          </div>
        )}

        {tab === 'wd' && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, ...T.display }}>WITHDRAW TO SOLANA</div>
              <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>{fmtUsd(tradeUsd, 2)} available</div>
            </div>

            <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.muted2, marginBottom: 2, ...T.mono }}>SOLANA ADDRESS</div>
              <input value={withdrawSolAddr} onChange={(e) => { setWithdrawSolAddr(e.target.value.trim()); setError(''); }} disabled={busy} placeholder="Solana address…" style={{ width: '100%', background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 11, ...T.mono }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 10 }}>
              <span style={{ fontSize: 18, color: C.muted, ...T.display }}>$</span>
              <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 20, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>USDC</span>
            </div>

            <button onClick={() => setAmount(String(Math.floor(tradeUsd * 100) / 100))} disabled={busy || tradeUsd <= 0} style={{ width: '100%', padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginBottom: 10, ...T.mono }}>Max</button>

            {statusMsg && <StatusLine msg={statusMsg} />}
            {error && <ErrorLine msg={error} />}
            {status === 'done' && <div style={{ marginBottom: 8, padding: 8, background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 10, fontSize: 11, color: C.yes, fontWeight: 700 }}>{statusMsg || '✓ Withdrawal submitted'}</div>}
            <PrimaryButton onClick={handleWithdraw} disabled={busy} label={busy ? 'Withdrawing…' : `Withdraw ${fmtUsd(usd, 2)}`} />
          </div>
        )}

        <button onClick={onReset} style={{ width: '100%', padding: 10, borderRadius: 10, background: 'rgba(255,95,122,.05)', border: `1px solid ${C.no}33`, color: C.no, fontSize: 11, fontWeight: 600, cursor: 'pointer', marginTop: 6, ...T.mono }}>↻ Reset trading account (if stuck)</button>
      </div>
    </div>
  );
}

function OrderDrawer({ market, side, onClose, evmAddress, getEvmProvider, safeAddress, tradingBalance, onNeedFunds, refreshAll }) {
  const [amount, setAmount] = useState('10');
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [pos, setPos] = useState(null);
  const [bids, setBids] = useState({ yes: 0, no: 0 });
  const [sellStatus, setSellStatus] = useState('idle');
  const [dbgOpen, setDbgOpen] = useState(false);

  useBodyLock(!!market);

  useEffect(() => {
    if (!market || !safeAddress) return;
    let alive = true;

    const tick = async () => {
      try {
        const [p, yb, nb] = await Promise.all([
          fetchPositions(safeAddress, market.conditionId, market.clobTokenIds),
          fetchBestBid(market.clobTokenIds[0]),
          fetchBestBid(market.clobTokenIds[1]),
        ]);
        if (!alive) return;
        if (p) setPos(p);
        setBids({ yes: yb, no: nb });
      } catch {}
    };

    tick();
    const id = setInterval(tick, 8000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [market, safeAddress]);

  if (!market) return null;

  const price = side === 'yes' ? market.yesPrice : market.noPrice;
  const usd = Number(amount) || 0;
  const shares = price > 0 ? usd / price : 0;
  const upside = usd > 0 ? ((shares - usd) / usd) * 100 : 0;
  const sideColor = side === 'yes' ? C.yes : C.no;
  const sideDim = side === 'yes' ? C.yesDim : C.noDim;
  const tradeUsd = Number(tradingBalance) / 1e6;
  const needsFunds = usd > tradeUsd;
  const busy = status === 'working' || sellStatus === 'selling';
  const canBuy = !busy && usd >= MIN_TRADE_USD && evmAddress && safeAddress && !needsFunds && market.clobTokenIds?.length >= 2;
  const held = side === 'yes' ? Number(pos?.sharesYes || 0) : Number(pos?.sharesNo || 0);
  const avgPx = side === 'yes' ? Number(pos?.avgPriceYes || 0) : Number(pos?.avgPriceNo || 0);
  const bid = side === 'yes' ? bids.yes : bids.no;
  const value = held * bid;
  const cost = held * avgPx;
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const hasPos = held > 0.01;

  const handleBuy = async () => {
    if (needsFunds) {
      onNeedFunds?.();
      return;
    }
    if (usd < MIN_TRADE_USD) {
      setError(`Min $${MIN_TRADE_USD}`);
      return;
    }

    setStatus('working');
    setError('');
    setStatusMsg('');

    try {
      const setup = await ensureSetup(evmAddress, getEvmProvider, setStatusMsg);
      setStatusMsg('Placing order…');
      await placeMarketOrder({ getEvmProvider, evmAddress, safeAddress: setup.safeAddress, creds: setup.creds, market, side, amountUsd: usd, isBuy: true });
      setStatus('success');
      setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      const m = e?.message || 'Trade failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error');
      setStatusMsg('');
      setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 4500);
    }
  };

  const handleSell = async () => {
    if (!hasPos) return;

    setSellStatus('selling');
    setError('');
    setStatusMsg('');

    try {
      const setup = await ensureSetup(evmAddress, getEvmProvider, setStatusMsg);
      setStatusMsg('Selling…');
      await placeMarketOrder({ getEvmProvider, evmAddress, safeAddress: setup.safeAddress, creds: setup.creds, market, side, amountUsd: held, isBuy: false });
      setSellStatus('sold');
      setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      const m = e?.message || 'Sell failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setSellStatus('error');
      setStatusMsg('');
      setDbgOpen(true);
      setTimeout(() => setSellStatus('idle'), 4500);
    }
  };

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, boxShadow: C.shadowLg, maxHeight: '92dvh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px 0', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{market.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ padding: '4px 10px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 10, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{side.toUpperCase()}</div>
            <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
            <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted, ...T.mono }}>Bal {fmtUsd(tradeUsd, 2)}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px' }}>
          <DebugPanel open={dbgOpen} onToggle={() => setDbgOpen(o => !o)} />

          {hasPos && sellStatus !== 'sold' && (
            <div style={{ marginBottom: 14, padding: 14, borderRadius: 12, background: pnl >= 0 ? 'rgba(0,212,163,.07)' : 'rgba(255,95,122,.07)', border: `1px solid ${pnl >= 0 ? 'rgba(0,212,163,.30)' : 'rgba(255,95,122,.30)'}` }}>
              <div style={{ fontSize: 10, color: pnl >= 0 ? C.yes : C.no, fontWeight: 800, marginBottom: 10, ...T.mono }}>YOUR POSITION · {side.toUpperCase()}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, ...T.mono }}><span style={{ color: C.muted }}>Shares</span><span style={{ color: C.ink, fontWeight: 700 }}>{held.toFixed(2)} @ ${avgPx.toFixed(3)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12, ...T.mono }}><span style={{ color: C.muted }}>Value · P&amp;L</span><span style={{ color: pnl >= 0 ? C.yes : C.no, fontWeight: 800 }}>{fmtUsd(value, 2)} · {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</span></div>
              <button onClick={sellStatus === 'selling' ? undefined : handleSell} disabled={sellStatus === 'selling' || bid <= 0} style={{ width: '100%', padding: 11, borderRadius: 10, background: pnl >= 0 ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` : `linear-gradient(135deg, ${C.no}33, ${C.no}22)`, border: `1px solid ${pnl >= 0 ? C.yes : C.no}66`, color: pnl >= 0 ? C.yes : C.no, fontWeight: 800, fontSize: 13, cursor: (sellStatus === 'selling' || bid <= 0) ? 'not-allowed' : 'pointer', opacity: (sellStatus === 'selling' || bid <= 0) ? .55 : 1, ...T.body }}>
                {sellStatus === 'selling' ? 'Selling…' : bid <= 0 ? 'No bids' : `Sell all · ${fmtUsd(value, 2)}`}
              </button>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 20, color: C.muted, ...T.display }}>$</span>
              <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 22, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 11, color: C.muted, ...T.mono }}>USDC</span>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {['5', '10', '25', '100'].map(v => (
                <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
              ))}
              <button onClick={() => setAmount(String(Math.floor(tradeUsd * 100) / 100))} disabled={busy || tradeUsd <= 0} style={{ flex: 1, padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12, ...T.mono, fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: C.muted }}>Shares</span><span style={{ color: C.ink, fontWeight: 600 }}>{shares.toFixed(2)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: C.muted }}>If {side.toUpperCase()} wins</span><span style={{ color: sideColor, fontWeight: 700 }}>{fmtUsd(shares, 2)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: C.muted }}>Upside</span><span style={{ color: sideColor, fontWeight: 700 }}>+{upside.toFixed(1)}%</span></div>
          </div>

          {statusMsg && <StatusLine msg={statusMsg} />}
          {error && <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 12, fontSize: 12, color: C.no }}>{error}<div style={{ marginTop: 6, fontSize: 10, color: C.muted, ...T.mono }}>See Debug panel above for details.</div></div>}
        </div>

        <div style={{ padding: '12px 18px calc(env(safe-area-inset-bottom) + 14px)', borderTop: `1px solid ${C.border}`, background: C.card, flexShrink: 0 }}>
          <button onClick={canBuy ? handleBuy : needsFunds ? onNeedFunds : undefined} disabled={busy || (!canBuy && !needsFunds)} style={{ width: '100%', padding: 14, borderRadius: 13, background: status === 'success' ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` : needsFunds ? `linear-gradient(135deg, ${C.amber}33, ${C.amber}22)` : `linear-gradient(135deg, ${sideColor}33, ${sideColor}22)`, border: `1px solid ${needsFunds ? C.amber : sideColor}66`, color: needsFunds ? C.amber : sideColor, fontWeight: 800, fontSize: 14, cursor: (canBuy || needsFunds) ? 'pointer' : 'not-allowed', opacity: (canBuy || needsFunds) ? 1 : .55, ...T.body }}>
            {busy ? 'Placing order…' : status === 'success' ? '✓ Order placed' : needsFunds ? `Fund · need ${fmtUsd(usd - tradeUsd, 2)} more` : `Buy ${side.toUpperCase()} · ${fmtUsd(usd, 2)}`}
          </button>
        </div>
      </div>
    </div>
  );
}


function Header({ tradingBalance, onOpenFund, canFund, signedIn, onSignIn, signingIn }) {
  const usd = Number(tradingBalance) / 1e6;
  return (
    <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: C.ink, letterSpacing: -1, ...T.display }}>Predict</h1>
            <div style={{ fontSize: 11, color: C.muted, ...T.mono, marginTop: 4 }}>Crypto prediction markets · 5% deposit · 0% trading</div>
          </div>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>CRYPTO</div>
        </div>
        {signedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 14, background: 'rgba(151,252,228,.05)', border: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1.2, ...T.mono, marginBottom: 2 }}>BALANCE</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, ...T.display, lineHeight: 1 }}>{fmtUsd(usd, 2)}</div>
            </div>
            <button onClick={canFund ? onOpenFund : undefined} disabled={!canFund} style={{ padding: '10px 18px', borderRadius: 11, background: canFund ? `linear-gradient(135deg, ${C.hl}, ${C.hl2})` : 'rgba(255,255,255,.04)', color: canFund ? C.bg : C.muted2, fontWeight: 800, fontSize: 13, border: 'none', cursor: canFund ? 'pointer' : 'not-allowed', opacity: canFund ? 1 : .55, ...T.body, whiteSpace: 'nowrap' }}>
              Manage
            </button>
          </div>
        ) : (
          <button onClick={onSignIn} disabled={signingIn} style={{ width: '100%', padding: '14px', borderRadius: 12, background: `linear-gradient(135deg, ${C.violet}, ${C.hl})`, color: C.bg, fontWeight: 800, fontSize: 14, border: 'none', cursor: signingIn ? 'wait' : 'pointer', opacity: signingIn ? .7 : 1, ...T.body }}>
            {signingIn ? 'Signing in…' : 'Sign in to trade'}
          </button>
        )}
      </div>
    </div>
  );
}
function PredictInner() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [horizonId, setHorizonId] = useState('daily');
  const [sortBy, setSortBy] = useState('volume');
  const [orderMarket, setOrderMarket] = useState(null);
  const [orderSide, setOrderSide] = useState('yes');
  const [fundOpen, setFundOpen] = useState(false);
  const [safeAddress, setSafeAddress] = useState(null);
  const [safeDeriving, setSafeDeriving] = useState(false);
  const [safeError, setSafeError] = useState(null);
  const [tradingBalance, setTradingBalance] = useState(0n);
  const [solBalance, setSolBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [autoPrompted, setAutoPrompted] = useState(false);
  const { publicKey: extSolPk, sendTransaction: extSendTx } = useWallet();
  const { connection } = useConnection();
  const {
    privyAuthenticated,
    privyEmbeddedSol,
    privyEmbeddedEvm,
    activeWalletKind,
    getEvmAddress,
    getEvmProvider,
    loginPrivy,
    privyReady,
  } = useNexusWallet();
  const evmAddress = useMemo(() => {
    if (!privyAuthenticated) return null;
    return getEvmAddress?.() || privyEmbeddedEvm?.address || null;
  }, [privyAuthenticated, getEvmAddress, privyEmbeddedEvm]);
  useEffect(() => {
    if (!privyReady || privyAuthenticated || autoPrompted) return;
    setAutoPrompted(true);
    try { loginPrivy?.(); } catch (e) { dbgErr('auth', 'auto loginPrivy failed', e); }
  }, [privyReady, privyAuthenticated, autoPrompted, loginPrivy]);
  const fundingPubkey = useMemo(() => {
    if (extSolPk) return extSolPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [extSolPk, privyEmbeddedSol]);

  // Mirrors SwapWidget's sendTx() exactly. Uses wallet-adapter
  // sendTransaction (Phantom/Solflare/Backpack) or Privy embedded wallet.
  // skipPreflight:false ensures RPC preflight SIMULATION runs before the
  // tx is broadcast -- a doomed tx fails fast without burning fees.
  const sendSolanaTx = useCallback(async (tx) => {
    const opts = {
      skipPreflight: false,
      preflightCommitment: 'processed',
      maxRetries: 3,
    };

    if (activeWalletKind === 'privy' && privyEmbeddedSol) {
      if (typeof privyEmbeddedSol.sendTransaction === 'function') {
        return privyEmbeddedSol.sendTransaction(tx, connection, opts);
      }
      if (typeof privyEmbeddedSol.signTransaction === 'function') {
        const signed = await privyEmbeddedSol.signTransaction(tx);
        return connection.sendRawTransaction(signed.serialize(), opts);
      }
      throw new Error('Privy wallet does not support sending');
    }

    if (!extSendTx) {
      throw new Error('No Solana signer available');
    }

    return extSendTx(tx, connection, opts);
  }, [activeWalletKind, privyEmbeddedSol, extSendTx, connection]);
  useEffect(() => {
    if (!evmAddress) {
      setSafeAddress(null);
      setSafeError(null);
      return;
    }
    let alive = true;
    const cached = lsGet(LS.safe(evmAddress));
    if (cached) {
      setSafeAddress(cached);
      setSafeError(null);
      return;
    }
    setSafeDeriving(true);
    deriveSafeAddress(evmAddress)
      .then((addr) => {
        if (!alive) return;
        setSafeAddress(addr);
        lsSet(LS.safe(evmAddress), addr);
        setSafeError(null);
      })
      .catch((e) => {
        if (!alive) return;
        dbgErr('safe', 'derive failed', e);
        setSafeError(e?.message || 'Failed to derive Safe');
      })
      .finally(() => {
        if (alive) setSafeDeriving(false);
      });
    return () => {
      alive = false;
    };
  }, [evmAddress]);
  useEffect(() => {
    if (!safeAddress) return;
    let alive = true;
    const tick = async () => {
      try {
        const b = await fetchSafeBalance(safeAddress);
        if (alive) setTradingBalance(b);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [safeAddress]);
  useEffect(() => {
    if (!fundingPubkey) return;
    let alive = true;
    const tick = async () => {
      try {
        const [u, s] = await Promise.all([
          fetchSolanaUsdcBalance(fundingPubkey),
          fetchSolanaSolBalance(fundingPubkey),
        ]);
        if (alive) {
          setUsdcBalance(u);
          setSolBalance(s);
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [fundingPubkey]);
  const refreshAll = useCallback(async () => {
    if (safeAddress) {
      try { setTradingBalance(await fetchSafeBalance(safeAddress)); } catch {}
    }
    if (fundingPubkey) {
      try {
        const [u, s] = await Promise.all([
          fetchSolanaUsdcBalance(fundingPubkey),
          fetchSolanaSolBalance(fundingPubkey),
        ]);
        setUsdcBalance(u);
        setSolBalance(s);
      } catch {}
    }
  }, [safeAddress, fundingPubkey]);
  const handleReset = useCallback(() => {
    if (!evmAddress) return;
    wipeUserCache(evmAddress);
    setSafeAddress(null);
    setSafeError(null);
    setFundOpen(false);
    setTimeout(() => {
      setSafeDeriving(true);
      deriveSafeAddress(evmAddress)
        .then((addr) => {
          setSafeAddress(addr);
          lsSet(LS.safe(evmAddress), addr);
        })
        .catch((e) => setSafeError(e?.message || 'Reset failed'))
        .finally(() => setSafeDeriving(false));
    }, 200);
  }, [evmAddress]);
  useEffect(() => {
    let alive = true;
    const h = HORIZONS.find((x) => x.id === horizonId) || HORIZONS[1];
    const load = async () => {
      try {
        let raw = [];
        if (h.slug) {
          raw = await fetchMarketsByTagSlug(h.slug);
          if (!Array.isArray(raw) || raw.length === 0) {
            raw = await fetchMarketsByTagId(CRYPTO_TAG_ID);
          }
        } else {
          raw = await fetchMarketsByTagId(CRYPTO_TAG_ID);
        }
        if (!alive) return;
        const norm = (Array.isArray(raw) ? raw : [])
          .map(normalizeEvent)
          .filter(Boolean);
        setMarkets(norm.filter((m) => isTradableMarket(m, h)));
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Failed to load markets');
      } finally {
        if (alive) setLoading(false);
      }
    };
    setLoading(true);
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [horizonId]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = q
      ? markets.filter((m) =>
          (m.title || '').toLowerCase().includes(q) ||
          (m.childQuestion || '').toLowerCase().includes(q)
        )
      : [...markets];
    if (sortBy === 'upside') {
      const u = (m) => {
        const y = Number(m.yesPrice) || 0;
        const n = Number(m.noPrice) || 0;
        const yU = y >= 0.02 && y < 0.98 ? (1 / y - 1) * 100 : 0;
        const nU = n >= 0.02 && n < 0.98 ? (1 / n - 1) * 100 : 0;
        return Math.max(yU, nU);
      };
      r.sort((a, b) => u(b) - u(a));
    } else if (sortBy === 'ending') {
      const t = (m) => {
        if (!m.endDate) return Infinity;
        const ms = new Date(m.endDate).getTime() - Date.now();
        return ms > 0 ? ms : Infinity;
      };
      r.sort((a, b) => t(a) - t(b));
    } else {
      r.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    }
    return r;
  }, [markets, search, sortBy]);
  const openTrade = useCallback((m, s) => {
    setOrderMarket(m);
    setOrderSide(s);
  }, []);
  if (loading) {
    return (
      <>
        <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)' }}>
          <Header
            tradingBalance={tradingBalance}
            onOpenFund={() => setFundOpen(true)}
            canFund={!!safeAddress}
            signedIn={!!privyAuthenticated}
            onSignIn={loginPrivy}
            signingIn={!privyReady}
          />
          {[1, 2, 3, 4, 5].map((i) => (
            <MarketSkeleton key={i} />
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>
        <Header
          tradingBalance={tradingBalance}
          onOpenFund={() => setFundOpen(true)}
          canFund={!!safeAddress && !safeDeriving}
          signedIn={!!privyAuthenticated}
          onSignIn={loginPrivy}
          signingIn={!privyReady}
        />
        {safeError && privyAuthenticated && (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: 'rgba(255,95,122,.07)', border: `1px solid ${C.no}33` }}>
            <div style={{ fontSize: 12, color: C.no, fontWeight: 700, marginBottom: 6, ...T.body }}>Couldn't set up trading account</div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, ...T.mono }}>{safeError}</div>
            <button onClick={handleReset} style={{ padding: '6px 12px', borderRadius: 8, background: C.no + '22', border: `1px solid ${C.no}55`, color: C.no, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>↻ Retry</button>
          </div>
        )}
        {safeDeriving && privyAuthenticated && (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: 'rgba(245,181,61,.06)', border: `1px solid ${C.amber}44`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.amber}33`, borderTopColor: C.amber, animation: 'nexus-spin .8s linear infinite' }} />
            <div style={{ fontSize: 12, color: C.amber, fontWeight: 700, ...T.body }}>Setting up your trading account…</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
          {HORIZONS.map((h) => {
            const active = horizonId === h.id;
            return (
              <button key={h.id} onClick={() => setHorizonId(h.id)} style={{ padding: '8px 14px', borderRadius: 99, whiteSpace: 'nowrap', background: active ? C.hlDim : 'rgba(255,255,255,.03)', border: `1px solid ${active ? C.borderHi : C.border}`, color: active ? C.hl : C.muted, fontSize: 11, fontWeight: 800, cursor: 'pointer', ...T.mono }}>
                {h.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginBottom: 12, position: 'relative' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" inputMode="search" style={{ width: '100%', padding: '10px 14px 10px 36px', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 11, color: C.ink, fontSize: 13, outline: 'none', ...T.body }} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto' }}>
          {[
            { id: 'volume', label: '📊 Volume' },
            { id: 'upside', label: '🔥 Upside' },
            { id: 'ending', label: '⏱ Ending' },
          ].map((o) => {
            const a = sortBy === o.id;
            return (
              <button key={o.id} onClick={() => setSortBy(o.id)} style={{ padding: '6px 11px', borderRadius: 99, whiteSpace: 'nowrap', background: a ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.02)', border: `1px solid ${a ? C.border : 'transparent'}`, color: a ? C.ink : C.muted2, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>
                {o.label}
              </button>
            );
          })}
        </div>
        {error && (
          <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(255,95,122,.07)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        )}
        {filtered.length === 0 && !error && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
            {search ? `No markets match "${search}"` : 'No active markets.'}
          </div>
        )}
        {filtered.map((m) => (
          <MarketCard key={m.id || m.slug} market={m} onTrade={openTrade} />
        ))}
        <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 10, color: C.muted, textAlign: 'center', ...T.mono }}>
          Powered by Polymarket · Safe v1.3 · Builder Code Attribution
        </div>
      </div>
      {orderMarket && (
        <OrderDrawer
          market={orderMarket}
          side={orderSide}
          onClose={() => {
            setOrderMarket(null);
            refreshAll();
          }}
          evmAddress={evmAddress}
          getEvmProvider={getEvmProvider}
          safeAddress={safeAddress}
          tradingBalance={tradingBalance}
          onNeedFunds={() => {
            setOrderMarket(null);
            setFundOpen(true);
          }}
          refreshAll={refreshAll}
        />
      )}
      <FundingSheet
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        evmAddress={evmAddress}
        safeAddress={safeAddress}
        tradingBalance={tradingBalance}
        fundingPubkey={fundingPubkey}
        solBalance={solBalance}
        usdcBalance={usdcBalance}
        sendSolanaTx={sendSolanaTx}
        solConnection={connection}
        onReset={handleReset}
        refreshAll={refreshAll}
      />
    </>
  );
}
export default function Predict() {
  return <PredictInner />;
}
