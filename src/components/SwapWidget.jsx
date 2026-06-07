// SwapWidget.jsx — atomic single-transaction Jupiter swap.
//
// Flow:
//   1. Get Jupiter swap instructions via /api/jupiter/build (no platformFeeBps)
//   2. Build fee instructions (3% of input mint -> FEE_WALLET)
//   3. Combine into ONE TransactionMessage with shared ALTs
//   4. Wallet simulates the SAME bytes the user signs — Blowfish sees full
//      net effect (X in, Y out, Z to fee wallet) instead of two opaque txs.
//   5. Atomic on-chain: swap and fee succeed together or revert together.
//
// Embed support:
//   - Accepts optional `defaultInputMint` / `defaultOutputMint` (per-page pair).
//   - Accepts optional `onConnectWallet` — when not connected, the primary
//     button calls this (opens the host's wallet picker) instead of erroring.
//     The main app already passes it via sharedProps; the embed passes one too.
//   - RPC may come from window.__VERIXIA_CONFIG__ (runtime, server-injected),
//     then build-time env, then public fallback.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';
import './SwapWidget.css';

/* ─── CONFIG ──────────────────────────────────────────────────────── */

const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300; // 3%
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Priority fee target ~0.001 SOL on Jupiter's swap tx via the /build endpoint.
// We do NOT add our own compute budget ixs anymore — Jupiter already includes
// them in build.computeBudgetInstructions, and duplicating them in the same
// tx would either be rejected or double-charge.
const PRIORITY_FEE_MICROLAMPORTS = 50_000;

// Fixed slippage — high enough that the tx almost always lands. No user setting.
const SLIPPAGE_BPS = 500; // 5%

// Runtime config (server-injected) takes precedence, then build-time env,
// then public fallback. Undefined window.__VERIXIA_CONFIG__ (main app) is fine.
const RUNTIME_CFG = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};
const RPC_URL =
  RUNTIME_CFG.rpc ||
  process.env.REACT_APP_SOLANA_RPC ||
  (process.env.REACT_APP_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

/* ─── HELPERS ──────────────────────────────────────────────────────── */

const fmtAmount = (n, decimals = 6) => {
  if (n == null || isNaN(n)) return '0';
  const num = Number(n);
  if (num === 0) return '0';
  if (num < 0.000001) return num.toExponential(2);
  if (num < 1)        return num.toFixed(Math.min(6, decimals));
  if (num < 1000)     return num.toFixed(Math.min(4, decimals));
  if (num < 1_000_000) return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return (num / 1_000_000).toFixed(2) + 'M';
};

const friendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient'))      return 'Insufficient balance for this swap.';
  if (m.includes('slippage'))          return 'Price moved too much. Try again or increase slippage.';
  if (m.includes('blockhash') || m.includes('expired'))
    return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled'))
    return 'Transaction cancelled.';
  if (m.includes('simulation failed')) return 'Swap simulation failed — the price may have moved.';
  if (m.includes('account not'))       return 'Token account not ready. Please try again in a moment.';
  if (m.includes('rate'))              return 'Too many requests — please wait a moment.';
  if (m.includes('could not find any route') || m.includes('no route'))
    return 'No route available for this pair.';
  if (m.includes('too large') || m.includes('transaction too large'))
    return 'Route is too complex to fit in one transaction. Try a different amount or token.';
  return err?.message || 'Swap failed. Please try again.';
};

// Deserialize a Jupiter /build instruction into a web3.js-compatible ix.
const deserIx = (ix) => ({
  programId: new PublicKey(ix.programId),
  keys: ix.accounts.map(a => ({
    pubkey:     new PublicKey(a.pubkey),
    isSigner:   a.isSigner,
    isWritable: a.isWritable,
  })),
  data: Buffer.from(ix.data, 'base64'),
});

/* ─── COMPONENT ───────────────────────────────────────────────────── */

export default function SwapWidget({ defaultInputMint, defaultOutputMint, onConnectWallet } = {}) {
  const wallet = useWallet();
  const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);

  const [tokens, setTokens]               = useState([]);
  const [tokensLoading, setTokensLoading] = useState(true);

  const [inputMint,  setInputMint]   = useState(defaultInputMint  || SOL_MINT);
  const [outputMint, setOutputMint]  = useState(defaultOutputMint || USDC_MINT);
  const [amount,     setAmount]      = useState('');

  const [showPicker, setShowPicker] = useState(null);

  const [quote, setQuote]           = useState(null);
  const [quoting, setQuoting]       = useState(false);
  const [quoteError, setQuoteError] = useState(null);

  const [swapping, setSwapping]     = useState(false);
  const [swapError, setSwapError]   = useState(null);
  const [swapResult, setSwapResult] = useState(null);

  const [balances, setBalances] = useState({});

  /* tokens */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/jupiter/tokens');
        const data = await r.json();
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.tokens || []);
        const norm = list.map(t => ({
          address:  t.id || t.address || t.mint,
          symbol:   t.symbol,
          name:     t.name,
          decimals: t.decimals,
          logoURI:  t.icon || t.logoURI || null,
        })).filter(t => t.address && t.symbol && t.decimals != null);
        setTokens(norm);
      } catch (e) {
        console.warn('[swap] token list failed', e);
        setTokens([
          { address: SOL_MINT,  symbol: 'SOL',  name: 'Solana',   decimals: 9, logoURI: null },
          { address: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: null },
        ]);
      } finally {
        if (!cancelled) setTokensLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* balances */
  const refreshBalances = useCallback(async () => {
    if (!wallet.publicKey) { setBalances({}); return; }
    try {
      const owner = wallet.publicKey;
      const [solBal, tokenAccs] = await Promise.all([
        connection.getBalance(owner),
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      ]);
      let token22Accs = { value: [] };
      try {
        token22Accs = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
      } catch {}
      const out = {};
      out[SOL_MINT] = { amount: solBal, decimals: 9, uiAmount: solBal / 1e9 };
      const merge = (accs) => {
        for (const acc of accs.value) {
          const info = acc.account.data.parsed?.info;
          if (!info) continue;
          const mint     = info.mint;
          const amount   = info.tokenAmount?.amount;
          const decimals = info.tokenAmount?.decimals;
          const uiAmount = info.tokenAmount?.uiAmount;
          if (!mint || amount == null) continue;
          out[mint] = { amount: Number(amount), decimals, uiAmount };
        }
      };
      merge(tokenAccs);
      merge(token22Accs);
      setBalances(out);
    } catch (e) {
      console.warn('[swap] balances failed', e);
    }
  }, [wallet.publicKey, connection]);

  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  const inputToken  = useMemo(() => tokens.find(t => t.address === inputMint)  || null, [tokens, inputMint]);
  const outputToken = useMemo(() => tokens.find(t => t.address === outputMint) || null, [tokens, outputMint]);
  const inputBalance = balances[inputMint];

  /* user input -> raw amount (smallest units, as string) */
  const rawAmount = useMemo(() => {
    if (!amount || !inputToken) return '';
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return '';
    return Math.floor(n * Math.pow(10, inputToken.decimals)).toString();
  }, [amount, inputToken]);

  /* QUOTE — Jupiter routes the NET amount (after our fee). */
  const quoteAbortRef = useRef(null);
  useEffect(() => {
    if (!rawAmount || inputMint === outputMint) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const ac = new AbortController();
    quoteAbortRef.current = ac;

    setQuoting(true);
    setQuoteError(null);

    const t = setTimeout(async () => {
      try {
        const net = (BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n;
        if (net <= 0n) {
          setQuote(null);
          setQuoting(false);
          return;
        }
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount:      net.toString(),
          slippageBps: String(SLIPPAGE_BPS),
          taker:       wallet.publicKey
            ? wallet.publicKey.toBase58()
            : '11111111111111111111111111111111',
          computeUnitPriceMicroLamports: String(PRIORITY_FEE_MICROLAMPORTS),
        });
        const r = await fetch(`/api/jupiter/build?${params}`, { signal: ac.signal });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Quote failed (${r.status})`);
        }
        const data = await r.json();
        if (!ac.signal.aborted) {
          setQuote(data);
          setQuoteError(null);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!ac.signal.aborted) {
          setQuote(null);
          setQuoteError(friendlyError(e));
        }
      } finally {
        if (!ac.signal.aborted) setQuoting(false);
      }
    }, 350);

    return () => { clearTimeout(t); ac.abort(); };
  }, [rawAmount, inputMint, outputMint, wallet.publicKey]);

  const outAmountUi = useMemo(() => {
    if (!quote || !outputToken) return null;
    return Number(quote.outAmount) / Math.pow(10, outputToken.decimals);
  }, [quote, outputToken]);

  const minReceived = useMemo(() => {
    if (!quote || !outputToken) return null;
    return Number(quote.otherAmountThreshold) / Math.pow(10, outputToken.decimals);
  }, [quote, outputToken]);

  const priceImpact = useMemo(() => {
    if (!quote || quote.priceImpactPct == null) return null;
    const n = Number(quote.priceImpactPct);
    return Number.isFinite(n) ? n * (Math.abs(n) <= 1 ? 100 : 1) : null;
  }, [quote]);

  const flip = () => {
    setInputMint(outputMint);
    setOutputMint(inputMint);
    setAmount('');
    setQuote(null);
  };

  const setMax = () => {
    if (!inputBalance) return;
    let maxAmt = inputBalance.uiAmount;
    if (inputMint === SOL_MINT) maxAmt = Math.max(0, maxAmt - 0.01);
    setAmount(String(maxAmt));
  };

  /* SWAP — single atomic transaction.
   * Fee ixs are prepended to Jupiter's instructions so they share the same
   * tx, the same blockhash, and the same simulation. What the wallet shows
   * the user IS what executes on-chain. */
  const handleSwap = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setSwapError('Please connect a wallet (Phantom, Solflare, Backpack).');
      return;
    }
    if (!quote || !outputToken || !inputToken) {
      setSwapError('No quote available — try again.');
      return;
    }

    setSwapping(true);
    setSwapError(null);
    setSwapResult(null);

    try {
      const dec = inputToken.decimals;

      // Use the SAME quote the user is looking at. No re-fetch — the build
      // response stored in `quote` is what the user sees and what we sign.
      const build = quote;

      // 1) Build the fee instructions FIRST (they go at the front of the tx).
      const feeAmount = (BigInt(rawAmount) * BigInt(FEE_BPS)) / 10000n;
      if (feeAmount <= 0n) throw new Error('Fee amount rounds to zero — amount too small.');

      const feeIxs = [];
      if (inputMint === SOL_MINT) {
        // Native SOL transfer from the user's wallet. Jupiter's setup ixs
        // will then wrap the remaining SOL for the swap.
        feeIxs.push(SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey:   FEE_WALLET,
          lamports:   Number(feeAmount),
        }));
      } else {
        // SPL transfer — determine token program from the mint owner.
        const mintPk = new PublicKey(inputMint);
        const mintInfo = await connection.getAccountInfo(mintPk);
        if (!mintInfo) throw new Error('Input mint not found on-chain.');
        const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;

        const sourceAta = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, tokenProgram);
        const destAta   = getAssociatedTokenAddressSync(mintPk, FEE_WALLET,       true, tokenProgram);

        // Idempotent: no-op if fee wallet's ATA already exists.
        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey, destAta, FEE_WALLET, mintPk, tokenProgram,
        ));
        feeIxs.push(createTransferCheckedInstruction(
          sourceAta, mintPk, destAta, wallet.publicKey,
          feeAmount, dec, [], tokenProgram,
        ));
      }

      // 2) Assemble the full instruction list.
      //   [Jupiter compute-budget ixs]
      //   [our fee ixs]
      //   [Jupiter setup ixs]
      //   [Jupiter swap ix]
      //   [Jupiter cleanup ix]
      //   [Jupiter other ixs]
      const ixs = [];
      if (Array.isArray(build.computeBudgetInstructions))
        for (const ix of build.computeBudgetInstructions) ixs.push(deserIx(ix));

      for (const ix of feeIxs) ixs.push(ix);

      if (Array.isArray(build.setupInstructions))
        for (const ix of build.setupInstructions) ixs.push(deserIx(ix));
      if (build.swapInstruction) ixs.push(deserIx(build.swapInstruction));
      if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
      if (Array.isArray(build.otherInstructions))
        for (const ix of build.otherInstructions) ixs.push(deserIx(ix));

      // 3) Resolve Jupiter's address lookup tables.
      const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
      let alts = [];
      if (altKeys.length > 0) {
        const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
        alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
          key:   new PublicKey(k),
          state: AddressLookupTableAccount.deserialize(infos[i].data),
        }) : null).filter(Boolean);
      }

      // 4) Compile ONE v0 transaction.
      const latest = await connection.getLatestBlockhash('confirmed');
      const message = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: latest.blockhash,
        instructions:    ixs,
      }).compileToV0Message(alts);
      const tx = new VersionedTransaction(message);

      // 5) Pre-flight simulation.
      const mapSimErr = (logs) => {
        const j = (logs || []).join('\n').toLowerCase();
        if (j.includes('insufficient') || j.includes('0x1')) return 'Insufficient balance for this swap.';
        if (j.includes('slippage') || j.includes('0x1771'))  return 'Price moved — try a higher slippage or smaller amount.';
        if (j.includes('account not') || j.includes('uninitialized')) return 'Token account not ready. Try again in a moment.';
        if (j.includes('blockhash') || j.includes('expired')) return 'Quote expired. Please refresh and retry.';
        return null;
      };
      try {
        const sim = await connection.simulateTransaction(tx, {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        if (sim.value.err) {
          throw new Error(mapSimErr(sim.value.logs) || 'Swap simulation failed — the price may have moved.');
        }
      } catch (simErr) {
        if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) {
          throw simErr;
        }
        console.warn('[swap] sim non-fatal', simErr);
      }

      // 6) Sign — wallet simulates the FULL tx (swap + fee). One popup.
      const signed = await wallet.signTransaction(tx);

      // 7) Broadcast.
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // 8) Confirm with polling fallback.
      let confirmed = false;
      try {
        const conf = await Promise.race([
          connection.confirmTransaction({
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }, 'confirmed'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 30_000)),
        ]);
        if (conf?.value?.err) throw new Error('Swap tx failed on-chain: ' + JSON.stringify(conf.value.err));
        confirmed = true;
      } catch (cfErr) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
            if (st?.value?.err) throw new Error('Swap tx failed on-chain.');
          } catch (e) {
            if (/failed on-chain/i.test(String(e.message))) throw e;
          }
        }
      }

      setSwapResult({ signature: sig, pending: !confirmed });

      if (confirmed) {
        setAmount('');
        setQuote(null);
        setTimeout(() => refreshBalances(), 2000);
      }
    } catch (e) {
      console.error('[swap]', e);
      setSwapError(friendlyError(e));
    } finally {
      setSwapping(false);
    }
  }, [
    wallet, quote, outputToken, inputToken,
    inputMint, outputMint, rawAmount,
    connection, refreshBalances,
  ]);

  const hasFunds = inputBalance && Number(amount) > 0 && inputBalance.uiAmount >= Number(amount);
  const canSwap  = !!wallet.publicKey && !!quote && !quoting && !swapping &&
                   Number(amount) > 0 && inputMint !== outputMint && hasFunds;

  const priceImpactClass = priceImpact == null ? 'sw-impact-neutral'
    : priceImpact > 5 ? 'sw-impact-bad'
    : priceImpact > 1 ? 'sw-impact-warn'
    : 'sw-impact-good';

  /* ─── RENDER ─── */

  return (
    <div className="sw-root">
      <div className="sw-container">

        <div className="sw-header">
          <h1 className="sw-title">Swap</h1>
          <div className="sw-live-pill">
            <span className="sw-live-dot"></span>
            LIVE
          </div>
        </div>

        <div className="sw-panel">
          <SwapRow
            label="You pay"
            token={inputToken}
            amount={amount}
            onAmountChange={setAmount}
            onPickerOpen={() => setShowPicker('input')}
            balance={inputBalance}
            onMax={setMax}
            editable
          />

          <div className="sw-flip-wrap">
            <button onClick={flip} className="sw-flip-btn" aria-label="Flip tokens"><FlipIcon/></button>
          </div>

          <SwapRow
            label="You receive"
            token={outputToken}
            amount={outAmountUi != null ? fmtAmount(outAmountUi, outputToken?.decimals) : (quoting ? '…' : '')}
            onPickerOpen={() => setShowPicker('output')}
            balance={balances[outputMint]}
            editable={false}
          />
        </div>

        {quote && outputToken && inputToken && Number(amount) > 0 && (
          <div className="sw-details">
            <Row label="Rate">
              1 {inputToken.symbol} ≈ {fmtAmount((outAmountUi / Number(amount)) || 0, outputToken.decimals)} {outputToken.symbol}
            </Row>
            <Row label="Minimum received">
              {fmtAmount(minReceived, outputToken.decimals)} {outputToken.symbol}
            </Row>
            <Row label="Price impact">
              <span className={priceImpactClass}>
                {priceImpact != null ? `${priceImpact.toFixed(2)}%` : '—'}
              </span>
            </Row>
            <Row label="Platform fee">{(FEE_BPS / 100).toFixed(1)}% (in {inputToken.symbol})</Row>
          </div>
        )}

        {quoteError && !swapping && !swapResult && <Banner kind="error">{quoteError}</Banner>}
        {swapError && <Banner kind="error">{swapError}</Banner>}
        {swapResult && (
          <Banner kind={swapResult.pending ? 'pending' : 'success'}>
            {swapResult.pending ? 'Submitted but still confirming. ' : 'Swap confirmed. '}
            <a
              href={`https://solscan.io/tx/${swapResult.signature}`}
              target="_blank"
              rel="noreferrer"
              className="sw-banner-link"
            >
              View on Solscan
            </a>
          </Banner>
        )}

        <button
          onClick={(!wallet.publicKey && onConnectWallet) ? onConnectWallet : handleSwap}
          disabled={!wallet.publicKey ? !onConnectWallet : !canSwap}
          className={'sw-primary-btn' + ((!wallet.publicKey ? !!onConnectWallet : canSwap) ? '' : ' sw-disabled')}
        >
          {swapping
            ? 'Swapping…'
            : !wallet.publicKey
              ? 'Connect Wallet'
              : inputMint === outputMint
                ? 'Select different tokens'
                : !amount || Number(amount) <= 0
                  ? 'Enter amount'
                  : !quote && quoting
                    ? 'Getting quote…'
                    : !quote
                      ? 'No route available'
                      : !hasFunds
                        ? `Insufficient ${inputToken?.symbol || ''}`
                        : '🚀 Swap'}
        </button>

        <p className="sw-footer">
          Powered by <b>Jupiter</b> · Solana's leading DEX aggregator
        </p>
      </div>

      {showPicker && (
        <TokenPicker
          tokens={tokens}
          loading={tokensLoading}
          balances={balances}
          excludeMint={showPicker === 'input' ? outputMint : inputMint}
          onSelect={(mint) => {
            if (showPicker === 'input') setInputMint(mint);
            else                         setOutputMint(mint);
            setShowPicker(null);
          }}
          onClose={() => setShowPicker(null)}
        />
      )}
    </div>
  );
}

/* ─── SUB-COMPONENTS ────────────────────────────────────────── */

function SwapRow({ label, token, amount, onAmountChange, onPickerOpen, balance, onMax, editable }) {
  return (
    <div className="sw-row">
      <div className="sw-row-top">
        <span className="sw-row-label">{label}</span>
        {balance && (
          <span className="sw-balance">
            Balance: {fmtAmount(balance.uiAmount, balance.decimals)}
            {editable && onMax && balance.uiAmount > 0 && (
              <button onClick={onMax} className="sw-max-btn">MAX</button>
            )}
          </span>
        )}
      </div>
      <div className="sw-row-mid">
        <button onClick={onPickerOpen} className="sw-token-btn">
          {token?.logoURI && (
            <img
              src={token.logoURI}
              alt=""
              className="sw-token-logo"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <span>{token?.symbol || 'Select'}</span>
          <ChevronIcon/>
        </button>
        {editable ? (
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, '');
              const parts = v.split('.');
              if (parts.length > 2) return;
              onAmountChange(v);
            }}
            className="sw-amount-input"
          />
        ) : (
          <input type="text" readOnly value={amount} placeholder="0.00" className="sw-amount-input"/>
        )}
      </div>
    </div>
  );
}

function TokenPicker({ tokens, loading, balances, excludeMint, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/jupiter/tokens/search?query=${encodeURIComponent(query.trim())}`);
        const data = await r.json();
        const list = Array.isArray(data) ? data : (data?.tokens || []);
        setSearchResults(list.map(t => ({
          address:  t.id || t.address || t.mint,
          symbol:   t.symbol,
          name:     t.name,
          decimals: t.decimals,
          logoURI:  t.icon || t.logoURI || null,
        })).filter(t => t.address && t.symbol && t.decimals != null));
      } catch (e) {
        console.warn('[swap] search failed', e);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const list = useMemo(() => {
    const base = searchResults != null
      ? searchResults
      : tokens.filter(t => {
          if (!query.trim()) return true;
          const q = query.toLowerCase();
          return t.symbol.toLowerCase().includes(q) ||
                 t.name.toLowerCase().includes(q)   ||
                 t.address.toLowerCase().startsWith(q);
        });
    return base
      .filter(t => t.address !== excludeMint)
      .sort((a, b) => {
        const ab = balances[a.address]?.uiAmount || 0;
        const bb = balances[b.address]?.uiAmount || 0;
        if (ab > 0 && bb === 0) return -1;
        if (bb > 0 && ab === 0) return 1;
        if (ab !== bb) return bb - ab;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 150);
  }, [tokens, searchResults, query, excludeMint, balances]);

  return (
    <div className="sw-modal-overlay" onClick={onClose}>
      <div className="sw-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="sw-modal-head">
          <div className="sw-modal-head-row">
            <h3 className="sw-modal-title">Select token</h3>
            <button onClick={onClose} className="sw-icon-btn"><CloseIcon/></button>
          </div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol, or paste address"
            className="sw-modal-search"
          />
        </div>
        <div className="sw-modal-list">
          {loading && <div className="sw-modal-msg">Loading tokens…</div>}
          {!loading && list.length === 0 && (
            <div className="sw-modal-msg">{searching ? 'Searching…' : 'No tokens found.'}</div>
          )}
          {list.map(t => {
            const bal = balances[t.address];
            return (
              <button
                key={t.address}
                onClick={() => onSelect(t.address)}
                className="sw-token-row"
              >
                {t.logoURI
                  ? <img src={t.logoURI} alt="" className="sw-token-row-logo"
                         onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                  : <div className="sw-token-row-placeholder" />
                }
                <div className="sw-token-row-info">
                  <div className="sw-token-row-sym">{t.symbol}</div>
                  <div className="sw-token-row-name">{t.name}</div>
                </div>
                {bal && bal.uiAmount > 0 && (
                  <div className="sw-token-row-bal">
                    {fmtAmount(bal.uiAmount, bal.decimals)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="sw-detail-row">
      <span>{label}</span>
      <span className="sw-detail-val">{children}</span>
    </div>
  );
}

function Banner({ kind, children }) {
  return (
    <div className={`sw-banner sw-banner-${kind}`}>{children}</div>
  );
}

/* ─── ICONS ────────────────────────────────────────────────── */

const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const FlipIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" transform="rotate(90 12 12)"/>
  </svg>
);
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6"  y2="18"/>
    <line x1="6"  y1="6" x2="18" y2="18"/>
  </svg>
);
