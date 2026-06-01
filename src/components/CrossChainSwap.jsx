/**
 * NEXUS DEX — Solana → Bitcoin (utility page)
 * Locked: SOL → native BTC via LI.FI. 5% fee in SOL, atomic single-tx.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import './SolToBtc.css';

/* ─── CONSTANTS ─── */

const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 500;
const SLIPPAGE   = 0.05;

const SOL_NATIVE      = '11111111111111111111111111111111';
const WSOL_MINT       = 'So11111111111111111111111111111111111111112';
const LIFI_SOLANA_ID  = 1151111081099710;
const LIFI_BITCOIN_ID = 20000000000001;
const BTC_TOKEN_ID    = 'bitcoin';
const BTC_DECIMALS    = 8;
const SOL_RESERVE     = 1_500_000;
const MIN_FEE_LAMPORTS = 1_000_000;
const QUOTE_DEBOUNCE  = 400;

const SOL_TOKEN = {
  symbol:   'SOL',
  name:     'Solana',
  decimals: 9,
  logoURI:  'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
};
const BTC_TOKEN = {
  symbol:   'BTC',
  name:     'Bitcoin',
  decimals: BTC_DECIMALS,
  logoURI:  'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/bitcoin.png',
};

/* ─── FORMATTERS ─── */

const trimZeros = v => String(v).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
const decsForDisplay = n => {
  const v = +n;
  if (!Number.isFinite(v)) return 4;
  if (v === 0)   return 2;
  if (v < 1e-8)  return 12;
  if (v < 1e-6)  return 10;
  if (v < 0.01)  return 8;
  if (v < 1)     return 6;
  return 4;
};
const fmtTok = n => {
  if (n == null || isNaN(n)) return '0';
  const v = +n;
  if (!Number.isFinite(v)) return '0';
  if (v >= 1e9)   return trimZeros((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6)   return trimZeros((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1000)  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return trimZeros(v.toFixed(decsForDisplay(v)));
};
const fmtInput = (n, dec = 9) => {
  const v = +n;
  if (!Number.isFinite(v) || v <= 0) return '';
  const m = Math.min(Math.max(+dec || 6, 0), 12);
  return trimZeros(v.toFixed(m));
};
const fmtUsd = (n, d = 2) => {
  if (n == null || isNaN(n)) return '-';
  const v = +n;
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9)  return '$' + trimZeros((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6)  return '$' + trimZeros((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: d });
  if (v >= 1)    return '$' + v.toFixed(d);
  if (v > 0)     return '$' + trimZeros(v.toFixed(v < 1e-6 ? 10 : 8));
  return '$0.00';
};
const toRaw = (s, dec) => {
  if (!s || dec == null) return '0';
  let v = String(s).trim().replace(/,/g, '.').replace(/^\+/, '');
  if (!v || v.startsWith('-')) return '0';
  if (/e/i.test(v)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return '0';
    v = n.toFixed(Math.max(+dec || 0, 20));
  }
  const d = Math.floor(+dec);
  if (!Number.isFinite(d) || d < 0 || d > 18) return '0';
  const [w, f = ''] = v.split('.');
  const sw = (w || '0').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '') || '0';
  const ft = (f || '').replace(/[^\d]/g, '').slice(0, d);
  const fp = (ft + '0'.repeat(d)).slice(0, d);
  try { return (BigInt(sw) * (10n ** BigInt(d)) + BigInt(fp)).toString(); }
  catch { return '0'; }
};

const validateBtcAddress = a => {
  if (!a || !a.trim()) return 'Bitcoin address required';
  const v = a.trim();
  if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,80}$/.test(v)) return 'Invalid Bitcoin address';
  return null;
};

const friendlyError = err => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient sol') || m.includes('not enough sol'))
    return 'Not enough SOL to cover the platform fee and network fee.';
  if (m.includes('insufficient') || m.includes('not enough'))
    return 'Insufficient balance for this bridge.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled'))
    return 'Transaction cancelled.';
  if (m.includes('blockhash') || m.includes('expired'))
    return 'Transaction expired. Please try again.';
  if (m.includes('slippage'))
    return 'Price moved too much. Try again.';
  if (m.includes('no route') || m.includes('no available') || m.includes('not found'))
    return 'No Bitcoin bridge route available right now. Try again shortly.';
  if (m.includes('minimum') || m.includes('too small'))
    return 'Amount too small — Bitcoin bridges typically require ~$20+ minimum.';
  if (m.includes('429') || m.includes('rate limit'))
    return 'Too many requests — please wait a moment.';
  if (m.includes('timeout') || m.includes('timed out'))
    return 'Network is slow — please try again.';
  if (m.includes('account not') || m.includes('uninitialized'))
    return 'Token account not ready. Try again in a moment.';
  if (m.includes('too large') || m.includes('transaction too large'))
    return 'Route is too complex to fit our fee in one transaction. Try a different amount.';
  return err?.message || 'Bridge failed. Please try again.';
};

/* ─── SOL PRICE ─── */

let _solPriceCache = null, _solPriceFetching = null;
const loadSolPrice = () => {
  if (_solPriceCache != null) return Promise.resolve(_solPriceCache);
  if (_solPriceFetching) return _solPriceFetching;
  _solPriceFetching = fetch('/api/lifi/tokens')
    .then(r => (r.ok ? r.json() : { tokens: {} }))
    .then(j => {
      const solTokens = j?.tokens?.[String(LIFI_SOLANA_ID)] || [];
      const sol = solTokens.find(t =>
        t.address === SOL_NATIVE || t.address === WSOL_MINT ||
        t.symbol?.toUpperCase() === 'SOL'
      );
      const p = sol?.priceUSD ? Number(sol.priceUSD) : null;
      _solPriceCache = Number.isFinite(p) && p > 0 ? p : null;
      _solPriceFetching = null;
      return _solPriceCache;
    })
    .catch(() => { _solPriceFetching = null; return null; });
  return _solPriceFetching;
};

/* ─── LI.FI QUOTE ─── */

const lifiQuote = async ({ amount, sender, btcAddress }) => {
  if (!sender) throw new Error('Connect wallet first');
  const p = new URLSearchParams({
    fromChain:   String(LIFI_SOLANA_ID),
    toChain:     String(LIFI_BITCOIN_ID),
    fromToken:   SOL_NATIVE,
    toToken:     BTC_TOKEN_ID,
    fromAmount:  String(amount),
    fromAddress: sender,
    toAddress:   btcAddress,
    slippage:    String(SLIPPAGE),
    order:       'FASTEST',
    skipSimulation: 'true',
  });
  const r = await fetch('/api/lifi/quote?' + p.toString());
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = j?.message || j?.errors?.[0]?.message || j?.error || `HTTP ${r.status}`;
    throw new Error(detail);
  }
  return j;
};

const computeSolFeeLamports = (fromAmountUSD, solPriceUSD) => {
  if (!fromAmountUSD || !solPriceUSD || fromAmountUSD <= 0 || solPriceUSD <= 0) {
    return MIN_FEE_LAMPORTS;
  }
  const feeUSD = fromAmountUSD * (FEE_BPS / 10000);
  const feeSOL = feeUSD / solPriceUSD;
  const lamports = Math.floor(feeSOL * LAMPORTS_PER_SOL);
  return Math.max(lamports, MIN_FEE_LAMPORTS);
};

/* ─── ATOMIC TX BUILDER ─── */

const buildAtomicTx = async ({
  connection, payer, bridgeTxBase64, feeLamports, blockhash,
}) => {
  const bridgeTx = VersionedTransaction.deserialize(Buffer.from(bridgeTxBase64, 'base64'));

  const altLookups = bridgeTx.message.addressTableLookups || [];
  let alts = [];
  if (altLookups.length > 0) {
    const altKeys = altLookups.map(l => l.accountKey);
    const infos = await connection.getMultipleAccountsInfo(altKeys);
    alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
      key:   k,
      state: AddressLookupTableAccount.deserialize(infos[i].data),
    }) : null).filter(Boolean);
    if (alts.length !== altKeys.length) {
      throw new Error('Could not resolve all address lookup tables for bridge tx');
    }
  }

  const decompiled = TransactionMessage.decompile(bridgeTx.message, {
    addressLookupTableAccounts: alts,
  });

  const feeIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey:   FEE_WALLET,
    lamports:   feeLamports,
  });
  decompiled.instructions = [feeIx, ...decompiled.instructions];
  decompiled.recentBlockhash = blockhash;
  decompiled.payerKey = payer;

  const newMessage = decompiled.compileToV0Message(alts);
  return new VersionedTransaction(newMessage);
};

/* ─── UI BITS ─── */

const TokenIcon = ({ token, size = 32 }) => {
  const [err, setErr] = useState(false);
  if (token?.logoURI && !err) {
    return (
      <img
        src={token.logoURI}
        alt=""
        className="sb-token-img"
        style={{ width: size, height: size }}
        onError={() => setErr(true)}
      />
    );
  }
  const ch = token?.symbol ? token.symbol.charAt(0).toUpperCase() : '?';
  return (
    <div
      className="sb-token-fallback"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >{ch}</div>
  );
};

const StepProgress = ({ step }) => {
  if (step <= 0) return null;
  const steps = [
    { label: 'Quote',  id: 1 },
    { label: 'Sign',   id: 2 },
    { label: 'Bridge', id: 3 },
    { label: 'Done',   id: 4 },
  ];
  return (
    <div className="sb-steps">
      {steps.map((s, i) => {
        const done   = step > s.id;
        const active = step === s.id;
        return (
          <React.Fragment key={s.id}>
            <div className="sb-step">
              <div className={'sb-step-circle' + (done ? ' sb-step-done' : active ? ' sb-step-active' : '')}>
                {done ? '✓' : s.id}
              </div>
              <div className={'sb-step-label' + (done ? ' sb-step-label-done' : active ? ' sb-step-label-active' : '')}>
                {s.label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className={'sb-step-line' + (done ? ' sb-step-line-done' : '')}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/* ═══════════ MAIN ═══════════ */

export default function SolToBtc({ onConnectWallet }) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const pubkey = publicKey || null;
  const wcon   = !!connected && !!pubkey;

  const [solAmt,   setSolAmt]   = useState('');
  const [btcAddr,  setBtcAddr]  = useState('');
  const [addrErr,  setAddrErr]  = useState('');

  const [quote,    setQuote]    = useState(null);
  const [quoting,  setQuoting]  = useState(false);
  const [quoteErr, setQuoteErr] = useState('');

  const [step,      setStep]      = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [swapErr,   setSwapErr]   = useState('');
  const [txSig,     setTxSig]     = useState(null);
  const [pendingMsg, setPendingMsg] = useState(null);

  const [sbl, setSbl] = useState(null);
  const [solPrice, setSolPrice] = useState(null);

  const reqIdRef = useRef(0);

  useEffect(() => { loadSolPrice().then(p => setSolPrice(p)); }, []);

  useEffect(() => {
    if (!pubkey || !connection) { setSbl(null); return; }
    let cancelled = false;
    connection.getBalance(pubkey)
      .then(b => { if (!cancelled) setSbl(b); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pubkey, connection, step]);

  const solBal = sbl != null ? sbl / LAMPORTS_PER_SOL : null;

  useEffect(() => {
    if (!btcAddr.trim()) { setAddrErr(''); return; }
    setAddrErr(validateBtcAddress(btcAddr) || '');
  }, [btcAddr]);

  const fetchQuote = useCallback(async () => {
    setQuoteErr('');
    if (!solAmt || +solAmt <= 0) { setQuote(null); return; }
    if (!pubkey) { setQuote(null); setQuoteErr('Connect a wallet to see a quote'); return; }

    const myReq = ++reqIdRef.current;
    setQuoting(true);

    try {
      const raw = toRaw(solAmt, 9);
      if (!raw || raw === '0') { setQuote(null); setQuoting(false); return; }

      const sender = pubkey.toString();
      const userAddr = btcAddr.trim();
      const userAddrOk = userAddr && !validateBtcAddress(userAddr);
      const dest = userAddrOk ? userAddr : 'bc1qmdpxhzarlxrygtvlxrkkl0eqguszkzqdgg4py5';

      const j = await lifiQuote({ amount: raw, sender, btcAddress: dest });
      if (myReq !== reqIdRef.current) return;

      if (!j?.estimate) throw new Error('No route available');
      const outAmt = Number(j.estimate.toAmountMin || j.estimate.toAmount) /
                     Math.pow(10, BTC_DECIMALS);
      const fromUSD = Number(j.estimate.fromAmountUSD) || 0;
      const feeLamports = computeSolFeeLamports(fromUSD, solPrice);
      const feeSOL = feeLamports / LAMPORTS_PER_SOL;
      const feeUSD = solPrice ? feeSOL * solPrice : null;

      setQuote({
        outAmt,
        outDisplay: fmtTok(outAmt),
        estTime:    j.estimate.executionDuration || null,
        bridge:     j.toolDetails?.name || j.tool || 'LI.FI',
        raw:        j,
        rawAmount:  raw,
        feeLamports,
        feeSOL,
        feeUSD,
        fromUSD,
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (myReq === reqIdRef.current) {
        setQuote(null);
        setQuoteErr(friendlyError(e));
      }
    } finally {
      if (myReq === reqIdRef.current) setQuoting(false);
    }
  }, [solAmt, btcAddr, pubkey, solPrice]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  const onMax = useCallback(() => {
    if (sbl == null || sbl <= 0) return;
    const reserveLamports = SOL_RESERVE + MIN_FEE_LAMPORTS;
    setSolAmt(fmtInput(Math.max(0, (sbl - reserveLamports)) / LAMPORTS_PER_SOL, 9));
  }, [sbl]);

  const solShortfall = useMemo(() => {
    if (!quote || sbl == null) return null;
    const inputLamports = Math.floor(Number(solAmt) * LAMPORTS_PER_SOL);
    const total = inputLamports + quote.feeLamports + SOL_RESERVE;
    return sbl < total ? (total - sbl) : 0;
  }, [quote, sbl, solAmt]);

  const execute = useCallback(async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    const e = validateBtcAddress(btcAddr);
    if (e) { setAddrErr(e); return; }
    if (!quote) { setSwapErr('No route. Wait for routing.'); return; }
    if (!signTransaction) {
      setSwapErr('Wallet does not support signing. Use Phantom or Solflare.');
      return;
    }
    if (solShortfall && solShortfall > 0) {
      setSwapErr(`Not enough SOL — need ~${(solShortfall / LAMPORTS_PER_SOL).toFixed(4)} more SOL to cover the platform + network fee.`);
      return;
    }

    setStep(1);
    setSwapErr('');
    setStatusMsg('Building route…');
    setTxSig(null);
    setPendingMsg(null);

    try {
      const raw = toRaw(solAmt, 9);
      if (!raw || raw === '0') throw new Error('Invalid amount');

      let j = quote.raw;
      const userAddr = btcAddr.trim();
      const quoteToAddr = j?.action?.toAddress || j?.estimate?.toAddress;
      if (!quoteToAddr || quoteToAddr.toLowerCase() !== userAddr.toLowerCase()) {
        setStatusMsg('Finalizing route with your Bitcoin address…');
        j = await lifiQuote({
          amount:     raw,
          sender:     pubkey.toString(),
          btcAddress: userAddr,
        });
        if (!j?.estimate) throw new Error('No route available');
      }

      const txData = j?.transactionRequest?.data;
      if (!txData) throw new Error('LI.FI returned no transaction');

      const fromUSD = Number(j.estimate.fromAmountUSD) || quote.fromUSD || 0;
      const feeLamports = computeSolFeeLamports(fromUSD, solPrice);

      setStatusMsg('Combining bridge + fee into one transaction…');
      const latest = await connection.getLatestBlockhash('confirmed');
      const tx = await buildAtomicTx({
        connection, payer: pubkey,
        bridgeTxBase64: txData,
        feeLamports,
        blockhash: latest.blockhash,
      });

      const mapSimErr = (logs) => {
        const t = (logs || []).join('\n').toLowerCase();
        if (t.includes('insufficient') || t.includes('0x1')) return 'Insufficient balance (need SOL for fee + bridge).';
        if (t.includes('slippage') || t.includes('0x1771'))  return 'Price moved — try a smaller amount or wait a moment.';
        if (t.includes('account not') || t.includes('uninitialized')) return 'Token account not ready. Try again in a moment.';
        if (t.includes('blockhash') || t.includes('expired')) return 'Quote expired. Please refresh and retry.';
        return null;
      };
      try {
        const sim = await connection.simulateTransaction(tx, {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        if (sim.value.err) {
          throw new Error(mapSimErr(sim.value.logs) || 'Bridge simulation failed — the price may have moved.');
        }
      } catch (simErr) {
        if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) {
          throw simErr;
        }
        console.warn('[soltobtc] sim non-fatal', simErr);
      }

      setStep(2);
      setStatusMsg('Sign in wallet…');
      const signed = await signTransaction(tx);

      setStep(3);
      setStatusMsg('Submitting transaction…');
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });
      setTxSig(sig);

      let bridgeOk = false;
      try {
        const result = await Promise.race([
          connection.confirmTransaction({
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }, 'confirmed'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 35_000)),
        ]);
        bridgeOk = !result?.value?.err;
        if (result?.value?.err) throw new Error('Bridge tx failed on-chain: ' + JSON.stringify(result.value.err));
      } catch (cfErr) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { bridgeOk = true; break; }
            if (st?.value?.err) throw new Error('Bridge tx failed on-chain.');
          } catch (e2) {
            if (/failed on-chain/i.test(String(e2.message))) throw e2;
          }
        }
      }

      if (bridgeOk) {
        setStep(4);
        setStatusMsg('');
      } else {
        setStep(4);
        setStatusMsg('');
        setPendingMsg('Submitted but still confirming. Check Solscan for status.');
      }
    } catch (e) {
      console.error('[SolToBtc]', e);
      setSwapErr(friendlyError(e));
      setStep(-1);
      setTimeout(() => { setStep(0); setSwapErr(''); }, 6000);
    }
  }, [
    wcon, btcAddr, solAmt, pubkey, signTransaction,
    connection, quote, onConnectWallet, solShortfall, solPrice,
  ]);

  const reset = useCallback(() => {
    setStep(0); setStatusMsg(''); setSwapErr(''); setTxSig(null); setPendingMsg(null);
    setSolAmt(''); setQuote(null); setQuoteErr('');
  }, []);

  const tuv = quote?.raw?.estimate?.toAmountUSD ? Number(quote.raw.estimate.toAmountUSD) : 0;
  const fromUsd = quote?.fromUSD || 0;
  const busy      = step > 0 && step < 4 && step !== -1;
  const isSuccess = step === 4;
  const isError   = step === -1;
  const solscan   = txSig ? 'https://solscan.io/tx/' + txSig : null;

  const btnLabel = () => {
    if (!wcon) return 'Connect Wallet';
    if (step === 1)   return 'Building Route…';
    if (step === 2)   return 'Sign in Wallet…';
    if (step === 3)   return 'Bridging…';
    if (isSuccess)    return pendingMsg ? 'Submitted ✓' : 'Bridge Submitted ✓';
    if (isError)      return 'Try Again';
    if (!solAmt)      return 'Enter SOL Amount';
    if (!btcAddr.trim()) return 'Enter Bitcoin Address';
    if (addrErr)      return 'Invalid BTC Address';
    if (!quote)       return quoting ? 'Finding Route…' : 'No Route';
    if (solShortfall) return 'Need more SOL';
    return 'Bridge SOL → BTC';
  };
  const btnDisabled = busy ||
    (wcon && (!solAmt || !btcAddr.trim() || !!addrErr ||
              (!quote && !isError && !isSuccess) || !!solShortfall));

  const btnClass = () => {
    if (isSuccess)  return 'sb-cta sb-cta-success';
    if (isError)    return 'sb-cta sb-cta-error';
    if (btnDisabled && wcon) return 'sb-cta sb-cta-disabled';
    return 'sb-cta sb-cta-primary';
  };

  return (
    <div className="sb-page">
      <div className="sb-header">
        <div className="sb-header-pills">
          <div className="sb-pill">
            <span className="sb-pill-dot"/>
            <span className="sb-pill-text">NATIVE BTC · LIVE</span>
          </div>
        </div>

        <div className="sb-pair">
          <TokenIcon token={SOL_TOKEN} size={44}/>
          <div className="sb-pair-arrow">→</div>
          <TokenIcon token={BTC_TOKEN} size={44}/>
        </div>

        <h1 className="sb-title">
          Solana <span className="sb-title-btc">→ Bitcoin</span>
        </h1>
        <p className="sb-subtitle">
          Swap SOL for native BTC · powered by LI.FI
        </p>
      </div>

      <div className="sb-card">
        <StepProgress step={step}/>

        <div className="sb-io-box">
          <div className="sb-io-head">
            <span className="sb-io-label">YOU SEND</span>
            <div className="sb-io-meta">
              <div className="sb-chain-badge sb-chain-badge-sol">
                <div className="sb-chain-dot sb-chain-dot-sol"/>
                Solana
              </div>
              {solBal != null && (
                <span className="sb-io-bal">
                  Bal: <span className="sb-io-bal-val">{fmtTok(solBal)}</span>
                </span>
              )}
            </div>
          </div>

          <div className="sb-io-row">
            <div className="sb-btc-display" style={{ background: 'rgba(20,241,149,.08)', borderColor: 'rgba(20,241,149,.28)' }}>
              <TokenIcon token={SOL_TOKEN} size={22}/>
              <span className="sb-btc-sym" style={{ color: '#14f195' }}>SOL</span>
            </div>
            <input
              value={solAmt}
              onChange={e => { if (!busy) setSolAmt(e.target.value.replace(/[^0-9.]/g, '')); }}
              placeholder="0.00"
              inputMode="decimal"
              disabled={busy}
              className="sb-io-input"
            />
            {solBal > 0 && !busy && (
              <button onClick={onMax} className="sb-max-btn">MAX</button>
            )}
          </div>
          {fromUsd > 0 && (
            <div className="sb-io-usd">{fmtUsd(fromUsd)}</div>
          )}
        </div>

        <div className="sb-flip-wrap">
          <div className="sb-flip-arrow">↓</div>
        </div>

        <div className="sb-io-box sb-io-box-btc">
          <div className="sb-io-head">
            <span className="sb-io-label">YOU RECEIVE (EST.)</span>
            <div className="sb-chain-badge sb-chain-badge-btc">
              <div className="sb-chain-dot sb-chain-dot-btc"/>
              Bitcoin
            </div>
          </div>
          <div className="sb-io-row">
            <div className="sb-btc-display">
              <TokenIcon token={BTC_TOKEN} size={22}/>
              <span className="sb-btc-sym">BTC</span>
            </div>
            <div className={'sb-io-output' + (quote ? ' sb-io-output-active' : '')}>
              {quoting
                ? <span className="sb-io-output-loading">…</span>
                : (quote?.outDisplay || '0')}
            </div>
          </div>
          {tuv > 0 && (
            <div className="sb-io-usd">{fmtUsd(tuv)}</div>
          )}
          {quote && (
            <div className="sb-route-meta">
              <span>via {quote.bridge}</span>
              {quote.estTime && <span>~{Math.max(1, Math.ceil(quote.estTime / 60))} min</span>}
            </div>
          )}
        </div>

        <div className="sb-dest">
          <div className="sb-dest-label">
            BITCOIN ADDRESS{' '}
            <span className="sb-dest-chain">· Bitcoin</span>
          </div>
          <div className="sb-dest-input-wrap">
            <input
              value={btcAddr}
              onChange={e => { if (!busy) setBtcAddr(e.target.value.trim()); }}
              placeholder="bc1q... / bc1p... / 1... / 3..."
              disabled={busy}
              className={'sb-dest-input' + (addrErr ? ' sb-dest-err' : btcAddr && !addrErr ? ' sb-dest-ok' : '')}
            />
            {btcAddr && !addrErr && (
              <div className="sb-dest-check">✓</div>
            )}
          </div>
          {addrErr && <div className="sb-dest-err-msg">{addrErr}</div>}
        </div>

        {quoteErr && !quote && (
          <div className="sb-warn">{quoteErr}</div>
        )}

        {quote && solAmt && (
          <div className="sb-route-details">
            {[
              ['Route',        quote.bridge],
              ['Platform fee', `${quote.feeSOL.toFixed(4)} SOL` + (quote.feeUSD ? ` (${fmtUsd(quote.feeUSD)})` : '')],
              ['Slippage',     (SLIPPAGE * 100).toFixed(1) + '%'],
              ['Est. time',    quote.estTime ? '~' + Math.max(1, Math.ceil(quote.estTime / 60)) + ' min' : '—'],
            ].map(([k, v]) => (
              <div key={k} className="sb-detail-row">
                <span className="sb-detail-key">{k}</span>
                <span className="sb-detail-val">{v}</span>
              </div>
            ))}
            <div className="sb-detail-note">
              Bitcoin confirmation typically takes 10–30 min after submission. Fee paid in SOL.
            </div>
          </div>
        )}

        {solShortfall > 0 && quote && (
          <div className="sb-warn">
            You need ~{(solShortfall / LAMPORTS_PER_SOL).toFixed(4)} more SOL in your wallet to cover the platform fee.
          </div>
        )}

        {statusMsg && busy && (
          <div className="sb-status">
            <div className="sb-spinner"/>
            {statusMsg}
          </div>
        )}

        {swapErr && (
          <div className="sb-error">{swapErr}</div>
        )}

        {isSuccess && (
          <div className={'sb-success' + (pendingMsg ? ' sb-success-pending' : '')}>
            <div className="sb-success-icon">{pendingMsg ? '⏳' : '🟠'}</div>
            <div className="sb-success-title">
              {pendingMsg ? 'Bridge Submitted' : 'Bridge Submitted!'}
            </div>
            <div className="sb-success-sub">
              {pendingMsg || 'BTC arrives in ~10–30 min at your Bitcoin address'}
            </div>
          </div>
        )}

        {!isSuccess ? (
          <button
            onClick={isError ? reset : (!wcon ? () => onConnectWallet?.() : execute)}
            disabled={btnDisabled && !isError}
            className={btnClass()}
          >
            {busy && <span className="sb-cta-spinner">⟳</span>}
            {btnLabel()}
          </button>
        ) : (
          <button onClick={reset} className="sb-cta sb-cta-reset">
            New Bridge
          </button>
        )}

        {txSig && solscan && (
          <a href={solscan} target="_blank" rel="noreferrer" className="sb-solscan-link">
            View on Solscan ↗
          </a>
        )}
        <p className="sb-footer-note">
          Non-custodial · LI.FI aggregator · Solana origin
        </p>
      </div>
    </div>
  );
}
 