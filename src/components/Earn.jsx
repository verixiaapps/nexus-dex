import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PublicKey, TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';

import { readEarnPositions } from './earnPositions';
import {
  SUPPORTED_INPUT_TOKENS,
  fetchOkxSwapInstructions,
  fetchOkxQuote,
  buildOkxSolTx,
} from './okxSwap';

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b', text: '#cdd6f4', muted: '#586994',
};

// =====================================================================
// Nexus Earn — SOL-only deposit, swapped to USDC, supplied to Kamino.
//
// Flow:
//   1. User enters SOL amount.
//   2. OKX swap SOL -> USDC.
//   3. Kamino deposit-instructions API returns ixs + LUTs to supply USDC.
//   4. Compile + sign + send one V0 transaction for the deposit.
//
// SOL is the only accepted input. Simplest reliable path: no token
// selector, no decimal juggling per token, no edge cases for USDC-as-input.
// User holds SOL in their wallet, we route to Kamino USDC yield.
//
// Non-custodial: position is in user's wallet at Kamino. We take no
// fee from the deposit itself — OKX takes its swap fee, that's it.
// Withdrawals happen on app.kamino.finance directly.
// =====================================================================

// ---------- Config ----------
// RPC is provided by ConnectionProvider in index.js (reads REACT_APP_SOLANA_RPC).
// We use useConnection() below to consume the same shared connection as the
// rest of the app — no separate env var, no duplicate Connection instance.
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOL_MINT  = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;

// Kamino main market + USDC reserve (mainnet)
const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const KAMINO_USDC_RESERVE = 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59';
const KAMINO_API = 'https://api.kamino.finance';

const KAMINO_USDC_POOL = 'd9c395b9-00d0-4426-a6b3-572a6dd68e54'; // DefiLlama

// Pick SOL from the okxSwap token registry if present, otherwise fall
// back to an inline definition. Keeps okxSwap.js as the source of truth.
const SOL_TOKEN =
  (SUPPORTED_INPUT_TOKENS || []).find(t => t.symbol === 'SOL') ||
  { symbol: 'SOL', mint: SOL_MINT, decimals: SOL_DECIMALS };

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

  const instructions = body.instructions.map((ix, i) => {
    if (!ix.data) {
      throw new Error(`Kamino returned instruction #${i} with no data field`);
    }
    return {
      programId: new PublicKey(ix.programAddress),
      keys: ix.accounts.map(a => ({
        pubkey:     new PublicKey(a.address),
        isSigner:   /SIGNER$/.test(a.role || ''),
        isWritable: /^WRITABLE/.test(a.role || ''),
      })),
      data: Buffer.from(ix.data, 'base64'),
    };
  });

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
          Your SOL will be swapped to USDC and deposited into <strong style={{ color: '#fff' }}>Kamino</strong> using
          your own wallet. The position lives in <strong style={{ color: '#fff' }}>your wallet</strong>, not ours.
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
  const { publicKey: walletPk, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const walletAddress = walletPk ? walletPk.toBase58() : null;

  const [apy, setApy]               = useState(null);
  const [loading, setLoading]       = useState(true);
  const [amount, setAmount]         = useState('');
  const [busy, setBusy]             = useState(false);
  const [msg, setMsg]               = useState('');
  const [txSig, setTxSig]           = useState('');
  // status: 'idle' | 'swapping' | 'swapped' | 'depositing' | 'done'
  const [status, setStatus]         = useState('idle');
  const [positions, setPositions]   = useState([]);
  const [pendingDeposit, setPendingDeposit] = useState(false);
  const [quote, setQuote]                   = useState(null);  // estimated USDC out
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

  // Debounced OKX quote fetch — updates the "you'll deposit ~$X USDC" preview.
  useEffect(() => {
    if (!amount || Number(amount) <= 0) {
      setQuote(null); setQuoteLoading(false);
      return;
    }
    setQuoteLoading(true);
    const handle = setTimeout(async () => {
      const lamports = BigInt(Math.round(Number(amount) * 10 ** SOL_TOKEN.decimals));
      const out = await fetchOkxQuote({
        fromTokenMint:   SOL_TOKEN.mint,
        amountLamports:  lamports.toString(),
      });
      setQuote(out);
      setQuoteLoading(false);
    }, 400);
    return () => clearTimeout(handle);
  }, [amount]);

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
    if (!sendTransaction) { setMsg('Wallet cannot send transactions'); return; }
    if (!connection)      { setMsg('RPC connection not ready');         return; }
    const amt = Number(amount);
    setBusy(true); setMsg(''); setTxSig(''); setStatus('idle');

    try {
      const user = toPublicKey(walletPk);

      // ================================================================
      // STEP 1: SWAP SOL -> USDC via OKX
      // ================================================================
      setStatus('swapping');
      setMsg('Step 1 of 2: Swapping SOL to USDC…');

      const inputLamports = BigInt(Math.round(amt * 10 ** SOL_TOKEN.decimals));
      const swapData = await fetchOkxSwapInstructions({
        fromTokenMint:    SOL_TOKEN.mint,
        amountLamports:   inputLamports.toString(),
        userWalletAddress: walletAddress,
      });
      const swapTx = await buildOkxSolTx({
        connection, userPubkey: user, swapData,
      });
      const swapSig = await sendTransaction(swapTx, connection, {
        skipPreflight:       false,
        preflightCommitment: 'processed',
        maxRetries:          3,
      });
      setTxSig(swapSig);
      await connection.confirmTransaction(swapSig, 'confirmed');
      setStatus('swapped');

      // ================================================================
      // STEP 2: KAMINO DEPOSIT
      // Read user's real USDC balance after the swap and deposit all of it.
      // ================================================================
      setStatus('depositing');
      setMsg('Step 2 of 2: Depositing into Kamino…');

      const userUsdcAta = await getAssociatedTokenAddress(USDC_MINT, user);

      const bal = await connection.getTokenAccountBalance(userUsdcAta);
      const depositLamports = BigInt(bal?.value?.amount || '0');
      if (depositLamports === 0n) {
        throw new Error('Swap completed but no USDC found in wallet. Check the swap tx and retry.');
      }

      const depositDecimal = (Number(depositLamports) / 1e6).toFixed(6).replace(/\.?0+$/, '');

      const ixs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
      ];

      const { instructions: depositIxs, lookupTables: kaminoLuts } = await fetchKaminoDepositIxs({
        connection, walletAddress, amountDecimal: depositDecimal,
      });
      ixs.push(...depositIxs);

      const { blockhash } = await connection.getLatestBlockhash('finalized');
      const vtx = new VersionedTransaction(new TransactionMessage({
        payerKey:        user,
        recentBlockhash: blockhash,
        instructions:    ixs,
      }).compileToV0Message(kaminoLuts));

      const depositSig = await sendTransaction(vtx, connection, {
        skipPreflight:       false,
        preflightCommitment: 'processed',
        maxRetries:          3,
      });
      setTxSig(depositSig);
      await connection.confirmTransaction(depositSig, 'confirmed');

      setStatus('done');
      setMsg('');
      setAmount('');
      // Give Kamino's API a few seconds to index the new deposit, then refresh.
      setTimeout(refreshPositions, 3000);
      setTimeout(() => setStatus('idle'), 6000);
    } catch (e) {
      console.error('[earn deposit]', e);
      const errMsg = e?.message || String(e);
      if (/reject|cancel|denied|user/i.test(errMsg)) {
        setMsg(status === 'swapping' ? 'Swap cancelled' : 'Deposit cancelled');
      } else {
        setMsg(errMsg);
      }
      setStatus('idle');
    } finally {
      setBusy(false);
    }
  }, [amount, walletPk, sendTransaction, walletAddress, refreshPositions, status, connection]);

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

          {/* SOL-only label — no dropdown, no token switching. */}
          <div style={{
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 8, padding: '5px 12px',
            color: '#fff', fontSize: 12, fontWeight: 700,
            fontFamily: 'Syne, sans-serif',
          }}>
            SOL
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

        {/* Cost preview */}
        {amount && Number(amount) > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: C.muted, marginBottom: 4 }}>
              <span>You'll deposit at least</span>
              <span>{quoteLoading ? '…' : quote ? `~${fmtUSD(quote * 0.995)} USDC` : '—'}</span>
            </div>
            <div style={{ fontSize: 10, color: C.muted }}>
              Includes OKX swap fee · No Nexus routing fee
            </div>
          </div>
        )}

        {msg && (
          <div style={{
            color: status === 'idle' ? C.red : C.accent,
            fontSize: 12, marginBottom: 8, fontWeight: status === 'idle' ? 600 : 700,
          }}>{msg}</div>
        )}
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
        }}>{!isConnected ? 'Connect Wallet to Deposit'
              : status === 'swapping'   ? 'Swapping SOL to USDC…'
              : status === 'swapped'    ? 'Preparing deposit…'
              : status === 'depositing' ? 'Depositing into Kamino…'
              : status === 'done'       ? 'Done ✓'
              : busy                    ? 'Working…'
              : 'Deposit & Earn'}</button>
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
        <span style={{ color: C.text, fontWeight: 600 }}>Deposit SOL.</span>{' '}
        We swap to USDC (OKX swap fee applies) and supply it to Kamino in your own wallet.
        No yield fees, no Nexus routing fee. Funds are non-custodial.
        Smart contract risk of Kamino applies.
      </div>

      {pendingDeposit && (
        <DisclosureModal onAccept={onModalAccept} onCancel={onModalCancel} />
      )}
    </div>
  );
}
