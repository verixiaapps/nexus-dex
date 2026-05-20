import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Connection, PublicKey, TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';

import { readEarnPositions } from './earnPositions';
import {
  SUPPORTED_INPUT_TOKENS,
  fetchOkxSwapInstructions,
  fetchOkxQuote,
} from './okxSwap';

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b', text: '#cdd6f4', muted: '#586994',
};

// =====================================================================
// Nexus Earn — Kamino USDC routing via Kamino's public REST API.
//
// Why the REST API instead of the SDK:
//   - No SDK version drift
//   - No LUT handling complexity (API returns lookup tables for us)
//   - Kamino maintains the endpoint; we just sign and send
//
// Flow:
//   1. User enters USDC amount
//   2. POST to api.kamino.finance/ktx/klend/deposit-instructions
//      with { wallet, market, reserve, amount: "<decimal>" }
//   3. We get back { instructions, lutsByAddress }
//   4. Prepend our own ixs: compute budget, treasury ATA (idempotent),
//      fee transfer (3% to treasury)
//   5. Fetch the LUT accounts from chain
//   6. Compile + sign + send one V0 transaction
//
// Non-custodial: position is in user's wallet at Kamino. We take only
// the 3% fee. Withdrawals happen on app.kamino.finance directly.
// =====================================================================

// ---------- Config ----------
const RPC_URL   = process.env.REACT_APP_RPC_URL || 'https://api.mainnet-beta.solana.com';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Kamino main market + USDC reserve (mainnet)
const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const KAMINO_USDC_RESERVE = 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59';
const KAMINO_API = 'https://api.kamino.finance';

// IMPORTANT: this MUST be set via env. If unset, deposits fail loudly
// rather than silently sending fees to System Program (lost forever).
const TREASURY_RAW = process.env.REACT_APP_NEXUS_TREASURY;
const TREASURY = TREASURY_RAW ? new PublicKey(TREASURY_RAW) : null;

const ROUTING_FEE_BPS = 300; // 3% of deposit
const KAMINO_USDC_POOL = 'd9c395b9-00d0-4426-a6b3-572a6dd68e54'; // DefiLlama

// =====================================================================
// Consent — one-time per browser
// =====================================================================
const CONSENT_KEY = 'nx_earn_consent_v1';
function hasConsented() {
  try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; }
}
function setConsented() {
  try { localStorage.setItem(CONSENT_KEY, '1'); } catch {}
}

// ---------- Helpers ----------
async function fetchApy(poolId) {
  try {
    const res = await fetch('https://yields.llama.fi/chart/' + poolId);
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data?.data?.[data.data.length - 1];
    return typeof latest?.apy === 'number' ? latest.apy : null;
  } catch { return null; }
}

const fmtPct = n => (typeof n === 'number' ? n.toFixed(2) + '%' : '—');
const fmtUSD = n => '$' + Number(n || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function toPublicKey(pk) {
  if (!pk) return null;
  if (pk instanceof PublicKey) return pk;
  if (typeof pk === 'string') return new PublicKey(pk);
  if (typeof pk?.toBase58 === 'function') return new PublicKey(pk.toBase58());
  throw new Error('Invalid publicKey');
}

// =====================================================================
// Kamino API: fetch deposit instructions + lookup tables for `amount` USDC.
// Returns { instructions: TransactionInstruction[], lookupTables: AddressLookupTableAccount[] }
// =====================================================================
async function fetchKaminoDepositIxs({ connection, walletAddress, amountDecimal }) {
  const res = await fetch(KAMINO_API + '/ktx/klend/deposit-instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet:  walletAddress,
      market:  KAMINO_MAIN_MARKET,
      reserve: KAMINO_USDC_RESERVE,
      amount:  amountDecimal,          // decimal string, e.g. "4.85"
    }),
  });

  if (!res.ok) {
    let msg = 'Kamino API error: ' + res.status;
    try {
      const err = await res.json();
      if (err?.message) msg = 'Kamino: ' + err.message;
    } catch {}
    throw new Error(msg);
  }

  const body = await res.json();
  // body shape per OpenAPI spec:
  //   instructions: [{ accounts: [{ address, role, signer? }], data, programAddress }]
  //   lutsByAddress: { [lutAddress]: [refAddress, ...] }

  // Convert API "instruction" objects into TransactionInstruction
  const instructions = body.instructions.map(ix => ({
    programId: new PublicKey(ix.programAddress),
    keys: ix.accounts.map(a => ({
      pubkey:     new PublicKey(a.address),
      // 'role' values per Solana spec: READONLY, WRITABLE, READONLY_SIGNER, WRITABLE_SIGNER
      isSigner:   /SIGNER$/.test(a.role || ''),
      isWritable: /^WRITABLE/.test(a.role || ''),
    })),
    data: ix.data ? Buffer.from(ix.data, 'base64') : Buffer.alloc(0),
  }));

  // Fetch each LUT account from chain
  const lutAddresses = Object.keys(body.lutsByAddress || {});
  const lookupTables = [];
  if (lutAddresses.length > 0) {
    const results = await Promise.all(
      lutAddresses.map(addr => connection.getAddressLookupTable(new PublicKey(addr))),
    );
    for (const r of results) {
      if (r?.value) lookupTables.push(r.value);
    }
  }

  return { instructions, lookupTables };
}

// =====================================================================
// Disclosure modal
// =====================================================================
function DisclosureModal({ onAccept, onCancel }) {
  return (
    <>
      <div onClick={onCancel} style={{
        position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.78)',
        backdropFilter: 'blur(8px)',
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'calc(100% - 32px)', maxWidth: 420, zIndex: 501,
        background: '#080d1a', border: '1px solid rgba(0,229,255,.22)',
        borderRadius: 20, padding: '24px 22px',
        boxShadow: '0 30px 80px rgba(0,0,0,.7), 0 0 32px rgba(0,229,255,.12)',
        fontFamily: 'Syne, sans-serif',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 14, letterSpacing: '-.01em' }}>
          Before you deposit
        </div>
        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55, marginBottom: 14 }}>
          Your USDC will be deposited into <strong style={{ color: '#fff' }}>Kamino</strong> using your own wallet.
          The position lives in <strong style={{ color: '#fff' }}>your wallet</strong>, not ours.
        </div>
        <div style={{
          background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.18)',
          borderRadius: 12, padding: '12px 14px', marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: '.06em', marginBottom: 6 }}>TO WITHDRAW LATER</div>
          <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5 }}>
            Go to <a href="https://app.kamino.finance" target="_blank" rel="noreferrer"
              style={{ color: C.accent, fontWeight: 700 }}>app.kamino.finance</a> and connect this same wallet.
            We'll also remember it for you on the Wallet page.
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, marginBottom: 18 }}>
          Nexus is non-custodial: we cannot withdraw your funds for you. Smart contract risk of Kamino applies.
          The 3% routing fee is non-refundable.
        </div>
        <button onClick={onAccept} style={{
          width: '100%', padding: 14, borderRadius: 12, border: 'none',
          background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg,
          fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
          cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,229,255,.25)', marginBottom: 8,
        }}>I understand — continue</button>
        <button onClick={onCancel} style={{
          width: '100%', padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,.08)',
          background: 'transparent', color: C.muted,
          fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 13, cursor: 'pointer',
        }}>Cancel</button>
      </div>
    </>
  );
}

// =====================================================================
// Component
// =====================================================================
export default function Earn({ isConnected, onConnectWallet }) {
  const { publicKey: walletPk, signTransaction } = useWallet();
  const walletAddress = walletPk ? walletPk.toBase58() : null;

  const [apy, setApy]               = useState(null);
  const [loading, setLoading]       = useState(true);
  const [amount, setAmount]         = useState('');
  const [busy, setBusy]             = useState(false);
  const [msg, setMsg]               = useState('');
  const [txSig, setTxSig]           = useState('');
  const [positions, setPositions]   = useState([]);
  const [pendingDeposit, setPendingDeposit] = useState(false);
  const [selectedToken, setSelectedToken]   = useState(SUPPORTED_INPUT_TOKENS[0]); // default USDC
  const [showTokenMenu, setShowTokenMenu]   = useState(false);
  const [quote, setQuote]                   = useState(null);  // estimated USDC out for non-USDC deposits
  const [quoteLoading, setQuoteLoading]     = useState(false);
  const runDepositRef = useRef(null);

  // Load Kamino APY
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const a = await fetchApy(KAMINO_USDC_POOL);
      if (cancelled) return;
      setApy(a); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Read position from Kamino API on mount + after deposits
  useEffect(() => {
    if (!walletAddress) { setPositions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const pos = await readEarnPositions({ walletAddress });
        if (!cancelled) setPositions(pos);
      } catch {
        if (!cancelled) setPositions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  const refreshPositions = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const pos = await readEarnPositions({ walletAddress });
      setPositions(pos);
    } catch {}
  }, [walletAddress]);

  // Debounced OKX quote fetch for non-USDC deposits.
  // Updates the "you'll deposit ~$X USDC" preview as user types.
  useEffect(() => {
    if (selectedToken.symbol === 'USDC' || !amount || Number(amount) <= 0) {
      setQuote(null); setQuoteLoading(false);
      return;
    }
    setQuoteLoading(true);
    const handle = setTimeout(async () => {
      const lamports = BigInt(Math.round(Number(amount) * 10 ** selectedToken.decimals));
      const out = await fetchOkxQuote({
        fromTokenMint:   selectedToken.mint,
        amountLamports:  lamports.toString(),
      });
      setQuote(out);
      setQuoteLoading(false);
    }, 400);
    return () => clearTimeout(handle);
  }, [amount, selectedToken]);

  const onDepositClick = useCallback(() => {
    if (!isConnected || !walletPk) { onConnectWallet?.(); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setMsg('Enter an amount'); return; }
    if (apy == null) { setMsg('APY unavailable, try again'); return; }
    setMsg('');

    if (hasConsented()) {
      runDepositRef.current && runDepositRef.current();
    } else {
      setPendingDeposit(true);
    }
  }, [amount, isConnected, onConnectWallet, walletPk, apy]);

  const onModalAccept = () => {
    setConsented();
    setPendingDeposit(false);
    runDepositRef.current && runDepositRef.current();
  };
  const onModalCancel = () => setPendingDeposit(false);

  const runDeposit = useCallback(async () => {
    if (!signTransaction) { setMsg('Wallet cannot sign transactions'); return; }
    if (!TREASURY) {
      setMsg('Treasury wallet not configured (set REACT_APP_NEXUS_TREASURY)');
      return;
    }
    const amt = Number(amount);
    setBusy(true); setMsg(''); setTxSig('');

    try {
      const conn = new Connection(RPC_URL, 'confirmed');
      const user = toPublicKey(walletPk);
      const isUsdc = selectedToken.symbol === 'USDC';

      // ---- Compute amounts ----
      const inputLamports = BigInt(Math.round(amt * 10 ** selectedToken.decimals));

      let depositLamports;       // USDC base units we'll instruct Kamino to deposit
      let feeLamports = 0n;      // Kamino routing fee (USDC base units); only USDC path
      let okxSwap = null;        // { instructions, lutAddresses, minUsdcOut } when applicable

      if (isUsdc) {
        // Direct USDC path: take 3% routing fee, deposit the rest.
        feeLamports     = (inputLamports * BigInt(ROUTING_FEE_BPS)) / 10000n;
        depositLamports = inputLamports - feeLamports;
      } else {
        // Non-USDC path: OKX swap takes 5% via referral fee (server-side).
        // No additional Kamino routing fee on our end; revenue comes from OKX spread.
        okxSwap = await fetchOkxSwapInstructions({
          fromTokenMint:    selectedToken.mint,
          amountLamports:   inputLamports.toString(),
          userWalletAddress: walletAddress,
          slippagePercent:  '0.5',
        });
        if (!okxSwap.minUsdcOut || okxSwap.minUsdcOut <= 0) {
          throw new Error('OKX did not return a valid swap output amount');
        }
        // minUsdcOut is the worst-case post-slippage output. Safe to deposit.
        // Convert from human-readable USDC to base units.
        depositLamports = BigInt(Math.round(okxSwap.minUsdcOut * 1e6));
      }

      // Kamino API takes decimal strings.
      const depositDecimal = (Number(depositLamports) / 1e6).toFixed(6).replace(/\.?0+$/, '');

      // ATAs
      const userUsdcAta     = await getAssociatedTokenAddress(USDC_MINT, user);
      const treasuryUsdcAta = await getAssociatedTokenAddress(USDC_MINT, TREASURY);

      // For USDC path, pre-check user has enough. For swap path, OKX validates.
      if (isUsdc) {
        const userBal = await conn.getTokenAccountBalance(userUsdcAta).catch(() => null);
        if (!userBal) throw new Error('No USDC account found in wallet');
        if (BigInt(userBal.value.amount) < inputLamports) throw new Error('Insufficient USDC balance');
      }

      // ---- Build instruction list ----
      const ixs = [];
      ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
      ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }));

      if (isUsdc) {
        // Idempotent treasury ATA — no-op if exists, no race
        ixs.push(createAssociatedTokenAccountIdempotentInstruction(
          user, treasuryUsdcAta, TREASURY, USDC_MINT,
        ));
        // 3% fee transfer to treasury (atomic with deposit)
        ixs.push(createTransferInstruction(
          userUsdcAta, treasuryUsdcAta, user, feeLamports,
        ));
      } else {
        // Prepend OKX swap instructions. OKX's instruction list includes all
        // setup ixs (ATAs, etc.) — we don't need to add any of our own.
        ixs.push(...okxSwap.instructions);
      }

      // Kamino deposit ixs + LUTs from the public API
      const { instructions: depositIxs, lookupTables: kaminoLuts } = await fetchKaminoDepositIxs({
        connection: conn,
        walletAddress,
        amountDecimal: depositDecimal,
      });
      ixs.push(...depositIxs);

      // ---- Merge LUTs from OKX + Kamino ----
      // OKX returns LUT *addresses*; we fetch them. Kamino's helper already
      // returns AddressLookupTableAccount objects.
      let allLuts = [...kaminoLuts];
      if (okxSwap && okxSwap.lutAddresses.length > 0) {
        const okxLutAccounts = await Promise.all(
          okxSwap.lutAddresses.map(addr =>
            conn.getAddressLookupTable(new PublicKey(addr)).then(r => r.value).catch(() => null)
          )
        );
        allLuts = [...allLuts, ...okxLutAccounts.filter(Boolean)];
      }

      // ---- Compile + sign + send ----
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const messageV0 = new TransactionMessage({
        payerKey: user,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message(allLuts);

      const vtx = new VersionedTransaction(messageV0);

      // Detect tx size overflow EARLY (before asking user to sign).
      // 1232 bytes is the Solana mainnet limit. If we exceed, we'd need a
      // two-tx flow (swap first, then deposit) — not implemented yet.
      // Surface a clear error so user knows to try smaller amount or USDC direct.
      const txSize = vtx.serialize().length;
      if (txSize > 1232) {
        throw new Error(
          `Swap + deposit too large for one transaction (${txSize} bytes). ` +
          `Try depositing USDC directly, or use a smaller amount.`
        );
      }

      const signed = await signTransaction(vtx);
      const sig = await conn.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Surface sig immediately so user can debug even if confirmation fails
      setTxSig(sig);

      await conn.confirmTransaction({
        signature: sig,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      setAmount('');
      // Give Kamino's API a few seconds to index the new deposit, then refresh.
      setTimeout(refreshPositions, 3000);
    } catch (e) {
      console.error('[earn deposit]', e);
      const errMsg = e?.message || String(e);
      setMsg(/reject|cancel|denied|user/i.test(errMsg) ? 'Cancelled' : errMsg);
    } finally {
      setBusy(false);
    }
  }, [amount, walletPk, signTransaction, walletAddress, refreshPositions, selectedToken]);

  useEffect(() => { runDepositRef.current = runDeposit; }, [runDeposit]);

  // ---------- Render ----------
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', fontFamily: 'Syne, sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '3px 10px',
          borderRadius: 999, background: 'rgba(0,229,255,.08)',
          border: '1px solid rgba(0,229,255,.22)', marginBottom: 10 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent }} />
          <span style={{ color: C.accent, fontSize: 9, fontWeight: 700, letterSpacing: '.10em' }}>EARN</span>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-.02em' }}>
          Earn yield on stablecoins
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
          Fully liquid · Withdraw anytime
        </div>
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16,
        padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600,
          letterSpacing: '.08em', marginBottom: 6 }}>CURRENT APY</div>
        <div style={{ fontSize: 40, fontWeight: 800, color: C.green,
          letterSpacing: '-.03em', lineHeight: 1 }}>
          {loading ? '—' : fmtPct(apy)}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
          {loading ? 'Loading rates...' : (
            <>Live from <span style={{ color: C.text }}>Kamino</span> · You keep 100% of yield</>
          )}
        </div>
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16,
        padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: '.08em' }}>
            DEPOSIT
          </div>

          {/* Token selector */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowTokenMenu(s => !s)}
              style={{
                background: 'rgba(255,255,255,.04)',
                border: '1px solid rgba(255,255,255,.08)',
                borderRadius: 8, padding: '5px 10px',
                color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'Syne, sans-serif',
              }}>
              {selectedToken.symbol} ▾
            </button>
            {showTokenMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: C.card, border: '1px solid ' + C.border,
                borderRadius: 10, padding: 4, zIndex: 10, minWidth: 100,
                boxShadow: '0 8px 24px rgba(0,0,0,.5)',
              }}>
                {SUPPORTED_INPUT_TOKENS.map(t => (
                  <button
                    key={t.mint}
                    onClick={() => {
                      setSelectedToken(t);
                      setShowTokenMenu(false);
                      setAmount('');
                      setQuote(null);
                      setMsg('');
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: t.symbol === selectedToken.symbol ? 'rgba(0,229,255,.08)' : 'transparent',
                      border: 'none', padding: '8px 10px', borderRadius: 6,
                      color: '#fff', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                    }}>
                    {t.symbol}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <input
          type="number" inputMode="decimal" placeholder="0.00"
          value={amount} onChange={e => setAmount(e.target.value)}
          style={{
            width: '100%', background: 'rgba(255,255,255,.03)',
            border: '1px solid rgba(255,255,255,.06)',
            borderRadius: 12, padding: '14px 16px', color: '#fff', fontSize: 22, fontWeight: 700,
            fontFamily: 'Syne, sans-serif', outline: 'none', marginBottom: 12,
          }}
        />

        {/* Cost preview — differs by path */}
        {amount && Number(amount) > 0 && selectedToken.symbol === 'USDC' && (
          <div style={{ display: 'flex', justifyContent: 'space-between',
            fontSize: 11, color: C.muted, marginBottom: 12 }}>
            <span>3% routing fee</span>
            <span>{fmtUSD(Number(amount) * 0.03)}</span>
          </div>
        )}
        {amount && Number(amount) > 0 && selectedToken.symbol !== 'USDC' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: C.muted, marginBottom: 4 }}>
              <span>Swap to USDC via OKX</span>
              <span>{quoteLoading ? '...' : quote ? `~${fmtUSD(quote)}` : '—'}</span>
            </div>
            <div style={{ fontSize: 10, color: C.muted }}>
              Includes 5% swap fee · 0% Kamino fee on swapped deposits
            </div>
          </div>
        )}

        {msg && <div style={{ color: C.red, fontSize: 12, marginBottom: 8 }}>{msg}</div>}
        {txSig && (
          <div style={{ color: msg ? C.muted : C.green, fontSize: 12, marginBottom: 8 }}>
            {msg ? 'Tx sent (see error above):' : 'Deposited.'}{' '}
            <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer"
              style={{ color: C.accent }}>View tx</a>
          </div>
        )}
        <button onClick={onDepositClick} disabled={busy || loading} style={{
          width: '100%', padding: 14, borderRadius: 12, border: 'none',
          background: (busy || loading) ? 'rgba(255,255,255,.05)' : 'linear-gradient(135deg,#00e5ff,#0055ff)',
          color: (busy || loading) ? C.muted : C.bg,
          fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
          cursor: (busy || loading) ? 'wait' : 'pointer',
          boxShadow: (busy || loading) ? 'none' : '0 8px 24px rgba(0,229,255,.25)',
        }}>{!isConnected ? 'Connect Wallet to Deposit' : busy ? 'Routing...' : 'Deposit & Earn'}</button>
      </div>

      {positions.length > 0 ? (
        <div style={{ background: C.card, border: '1px solid ' + C.border,
          borderRadius: 16, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700,
            letterSpacing: '.08em', marginBottom: 10 }}>YOUR POSITION</div>
          {positions.map(p => (
            <div key={p.protocol} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 0', borderTop: '1px solid rgba(255,255,255,.04)',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: (p.color || C.accent) + '22',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800, color: p.color || C.accent,
              }}>K</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                  {fmtUSD(p.amount)} on Kamino
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                  Live balance · USDC supplied
                </div>
              </div>
              <a href={p.withdrawUrl} target="_blank" rel="noreferrer" style={{
                fontSize: 11, fontWeight: 700, color: C.accent,
                background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.25)',
                borderRadius: 8, padding: '6px 10px', textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}>Manage ↗</a>
            </div>
          ))}
          <div style={{ fontSize: 10, color: C.muted, marginTop: 10, lineHeight: 1.4 }}>
            Tap "Manage" to open Kamino. Connect this same wallet there to withdraw.
          </div>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid ' + C.border,
          borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.text, fontWeight: 700, marginBottom: 4 }}>To withdraw</div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
            After you deposit, your position will show here with a direct link to Kamino.
            Funds live in your own wallet — Nexus is non-custodial.
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, padding: '0 4px' }}>
        <span style={{ color: C.text, fontWeight: 600 }}>One-time 3% routing fee.</span>{' '}
        No yield fees. Swap fees apply when converting other tokens to USDC.
        Funds are deposited into Kamino with your own wallet as owner — Nexus is non-custodial.
        Smart contract risk of Kamino applies.
      </div>

      {pendingDeposit && (
        <DisclosureModal onAccept={onModalAccept} onCancel={onModalCancel} />
      )}
    </div>
  );
}
