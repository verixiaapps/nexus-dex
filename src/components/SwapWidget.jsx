// Swap.jsx — matches Predict pattern exactly:
//   1. Get a Jupiter swap tx untouched (no platformFeeBps/feeAccount)
//   2. Build a SEPARATE fee tx (5% of input mint -> FEE_WALLET)
//   3. signAllTransactions([swapTx, feeTx]) — ONE popup
//   4. Broadcast both via RPC in parallel
//   5. Confirm with Solscan-link fallback
//
// No Jupiter native fee mechanism. No referral SDK. Just like Predict.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';

/* ─── CONFIG ──────────────────────────────────────────────────────── */

const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 500; // 5%
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Priority fee: ~0.001 SOL (~$0.17) ceiling for fast confirmation on our fee tx.
const PRIORITY_FEE_MICROLAMPORTS = 5_000;
const PRIORITY_FEE_CU_LIMIT      = 200_000;

const RPC_URL =
  process.env.REACT_APP_SOLANA_RPC ||
  (process.env.REACT_APP_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

const C = {
  bg:        '#0a0a0c',
  panel:     '#101015',
  panel2:    '#15151c',
  border:    '#26262f',
  text:      '#f5f5f7',
  textDim:   '#8a8a92',
  textFaint: '#5a5a62',
  accent:    '#7c5cff',
  green:     '#22c55e',
  red:       '#ef4444',
  amber:     '#f59e0b',
};
const T = {
  display: { fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 700, letterSpacing: '-0.02em' },
  body:    { fontFamily: 'system-ui, -apple-system, sans-serif' },
};

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
  return err?.message || 'Swap failed. Please try again.';
};

/* ─── COMPONENT ───────────────────────────────────────────────────── */

export default function Swap() {
  const wallet = useWallet();
  const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);

  const [tokens, setTokens]               = useState([]);
  const [tokensLoading, setTokensLoading] = useState(true);

  const [inputMint,  setInputMint]   = useState(SOL_MINT);
  const [outputMint, setOutputMint]  = useState(USDC_MINT);
  const [amount,     setAmount]      = useState('');
  const [slippageBps, setSlippageBps] = useState(50);

  const [showPicker,   setShowPicker]   = useState(null);
  const [showSettings, setShowSettings] = useState(false);

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

  /* QUOTE — no fee params. Jupiter sees a clean, normal swap.
   * We deduct the 5% from rawAmount before sending so the quote
   * reflects what the user will actually receive after our fee. */
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
        // Net amount = input minus our 5% fee (taken in INPUT mint)
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
          slippageBps: String(slippageBps),
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
          setQuote({ ...data, netRaw: net.toString() });
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
  }, [rawAmount, inputMint, outputMint, slippageBps, wallet.publicKey]);

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

  /* SWAP — build fee tx separately, bundle with Jupiter's tx, sign once */
  const handleSwap = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signAllTransactions) {
      setSwapError('Please connect a wallet that supports multi-tx signing (Phantom, Solflare, Backpack).');
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
      const netRaw = quote.netRaw ||
        ((BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n).toString();

      // 1) Fresh /build call for the NET amount (locks in the actual route).
      // computeUnitPriceMicroLamports targets ~0.001 SOL (~$0.17) priority fee
      // on Jupiter's swap tx — matches our fee tx for consistent fast confirms.
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount:      netRaw,
        slippageBps: String(slippageBps),
        taker:       wallet.publicKey.toBase58(),
        computeUnitPriceMicroLamports: String(PRIORITY_FEE_MICROLAMPORTS),
      });
      const r = await fetch(`/api/jupiter/build?${params}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `Build failed (${r.status})`);
      }
      const build = await r.json();

      // 2) Reconstruct Jupiter's tx from raw instructions.
      // /build returns instructions, not a serialized tx, so we assemble.
      const ixs = [];
      const deser = (ix) => ({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map(a => ({
          pubkey:     new PublicKey(a.pubkey),
          isSigner:   a.isSigner,
          isWritable: a.isWritable,
        })),
        data: Buffer.from(ix.data, 'base64'),
      });
      if (Array.isArray(build.computeBudgetInstructions))
        for (const ix of build.computeBudgetInstructions) ixs.push(deser(ix));
      if (Array.isArray(build.setupInstructions))
        for (const ix of build.setupInstructions) ixs.push(deser(ix));
      if (build.swapInstruction) ixs.push(deser(build.swapInstruction));
      if (build.cleanupInstruction) ixs.push(deser(build.cleanupInstruction));
      if (Array.isArray(build.otherInstructions))
        for (const ix of build.otherInstructions) ixs.push(deser(ix));

      // ALTs
      const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
      const { AddressLookupTableAccount } = await import('@solana/web3.js');
      let alts = [];
      if (altKeys.length > 0) {
        const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
        alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
          key:   new PublicKey(k),
          state: AddressLookupTableAccount.deserialize(infos[i].data),
        }) : null).filter(Boolean);
      }

      // Fresh blockhash to stamp both txs (so they share validity window)
      const latest = await connection.getLatestBlockhash('confirmed');

      const swapMsg = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: latest.blockhash,
        instructions:    ixs.map(i => i),
      }).compileToV0Message(alts);
      const swapTx = new VersionedTransaction(swapMsg);

      // 3) Build fee tx — 5% of full input amount in input mint
      const feeAmount = (BigInt(rawAmount) * BigInt(FEE_BPS)) / 10000n;
      if (feeAmount <= 0n) throw new Error('Fee amount rounds to zero — amount too small.');

      const feeIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: PRIORITY_FEE_CU_LIMIT }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
      ];
      if (inputMint === SOL_MINT) {
        // Native SOL transfer
        feeIxs.push(SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey:   FEE_WALLET,
          lamports:   Number(feeAmount),
        }));
      } else {
        // SPL transfer — determine token program
        const mintPk = new PublicKey(inputMint);
        const mintInfo = await connection.getAccountInfo(mintPk);
        if (!mintInfo) throw new Error('Input mint not found on-chain.');
        const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;

        const sourceAta = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, tokenProgram);
        const destAta   = getAssociatedTokenAddressSync(mintPk, FEE_WALLET,       true, tokenProgram);

        // Idempotent ATA create — no-op if already exists, costs user ~0.002 SOL first time
        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey, destAta, FEE_WALLET, mintPk, tokenProgram,
        ));
        feeIxs.push(createTransferCheckedInstruction(
          sourceAta, mintPk, destAta, wallet.publicKey,
          feeAmount, dec, [], tokenProgram,
        ));
      }

      const feeMsg = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: latest.blockhash,
        instructions:    feeIxs,
      }).compileToV0Message();
      const feeTx = new VersionedTransaction(feeMsg);

      // 4) SIMULATE both txs before showing the wallet popup, so we catch
      //    insufficient-balance / slippage / account-not-ready errors with
      //    plain-English messages instead of opaque on-chain failures.
      const mapSimErr = (logs) => {
        const j = (logs || []).join('\n').toLowerCase();
        if (j.includes('insufficient') || j.includes('0x1')) return 'Insufficient balance for this swap.';
        if (j.includes('slippage') || j.includes('0x1771'))  return 'Price moved — try a higher slippage or smaller amount.';
        if (j.includes('account not') || j.includes('uninitialized')) return 'Token account not ready. Try again in a moment.';
        if (j.includes('blockhash') || j.includes('expired')) return 'Quote expired. Please refresh and retry.';
        return null;
      };
      try {
        const [simSwap, simFee] = await Promise.all([
          connection.simulateTransaction(swapTx, { replaceRecentBlockhash: true, sigVerify: false }),
          connection.simulateTransaction(feeTx,  { replaceRecentBlockhash: true, sigVerify: false }),
        ]);
        if (simSwap.value.err) {
          throw new Error(mapSimErr(simSwap.value.logs) || 'Swap simulation failed — the price may have moved.');
        }
        if (simFee.value.err) {
          throw new Error(mapSimErr(simFee.value.logs) || 'Fee transaction simulation failed.');
        }
      } catch (simErr) {
        // Don't block on network simulation failures (RPC hiccups); only
        // surface explicit on-chain sim errors.
        if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) {
          throw simErr;
        }
        console.warn('[swap] sim non-fatal', simErr);
      }

      // 5) ONE wallet popup
      const [signedSwap, signedFee] = await wallet.signAllTransactions([swapTx, feeTx]);

      // 6) Broadcast both in parallel
      const [swapSig, feeSig] = await Promise.all([
        connection.sendRawTransaction(signedSwap.serialize(), { skipPreflight: false, maxRetries: 3 }),
        connection.sendRawTransaction(signedFee.serialize(),  { skipPreflight: false, maxRetries: 3 }),
      ]);

      // 7) Confirm swap tx (the one that matters); fall back to polling
      let confirmed = false;
      try {
        const conf = await Promise.race([
          connection.confirmTransaction({
            signature: swapSig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }, 'confirmed'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 30_000)),
        ]);
        if (conf?.value?.err) throw new Error('Swap tx failed on-chain: ' + JSON.stringify(conf.value.err));
        confirmed = true;
      } catch (cfErr) {
        // Fallback poll
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(swapSig, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
            if (st?.value?.err) throw new Error('Swap tx failed on-chain.');
          } catch (e) {
            if (/failed on-chain/i.test(String(e.message))) throw e;
          }
        }
      }

      setSwapResult({ signature: swapSig, feeSig, pending: !confirmed });

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
    inputMint, outputMint, rawAmount, slippageBps,
    connection, refreshBalances,
  ]);

  const hasFunds = inputBalance && Number(amount) > 0 && inputBalance.uiAmount >= Number(amount);
  const canSwap  = !!wallet.publicKey && !!quote && !quoting && !swapping &&
                   Number(amount) > 0 && inputMint !== outputMint && hasFunds;

  /* ─── RENDER ─── */

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, ...T.body, paddingBottom: 80 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ ...T.display, fontSize: 28, margin: 0 }}>Swap</h1>
          <button onClick={() => setShowSettings(true)} style={iconBtn} aria-label="Settings">
            <SettingsIcon/>
          </button>
        </div>

        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 20, padding: 16 }}>
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

          <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
            <button onClick={flip} style={flipBtn} aria-label="Flip tokens"><FlipIcon/></button>
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
          <div style={{
            marginTop: 12,
            padding: 14,
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            fontSize: 13,
            color: C.textDim,
          }}>
            <Row label="Rate">
              1 {inputToken.symbol} ≈ {fmtAmount((outAmountUi / Number(amount)) || 0, outputToken.decimals)} {outputToken.symbol}
            </Row>
            <Row label="Minimum received">
              {fmtAmount(minReceived, outputToken.decimals)} {outputToken.symbol}
            </Row>
            <Row label="Price impact">
              <span style={{
                color: priceImpact == null ? C.textDim
                     : priceImpact > 5 ? C.red
                     : priceImpact > 1 ? C.amber
                     : C.green,
              }}>
                {priceImpact != null ? `${priceImpact.toFixed(2)}%` : '—'}
              </span>
            </Row>
            <Row label="Slippage tolerance">{(slippageBps / 100).toFixed(2)}%</Row>
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
              style={{ color: '#fff', textDecoration: 'underline' }}
            >
              View on Solscan
            </a>
          </Banner>
        )}

        <button
          onClick={handleSwap}
          disabled={!canSwap}
          style={{
            ...primaryBtn,
            opacity: canSwap ? 1 : 0.5,
            cursor:  canSwap ? 'pointer' : 'not-allowed',
            marginTop: 16,
          }}
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
                        : 'Swap'}
        </button>

        <p style={{ marginTop: 16, fontSize: 12, color: C.textFaint, textAlign: 'center' }}>
          Powered by Jupiter — Solana's leading DEX aggregator
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

      {showSettings && (
        <SettingsModal
          slippageBps={slippageBps}
          onChange={setSlippageBps}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

/* ─── SUB-COMPONENTS ────────────────────────────────────────── */

function SwapRow({ label, token, amount, onAmountChange, onPickerOpen, balance, onMax, editable }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: C.textDim }}>{label}</span>
        {balance && (
          <span style={{ fontSize: 12, color: C.textDim }}>
            Balance: {fmtAmount(balance.uiAmount, balance.decimals)}
            {editable && onMax && balance.uiAmount > 0 && (
              <button
                onClick={onMax}
                style={{
                  marginLeft: 6, background: 'transparent',
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '2px 6px', color: C.accent, fontSize: 11,
                  cursor: 'pointer', ...T.body,
                }}
              >MAX</button>
            )}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onPickerOpen} style={tokenPickerBtn}>
          {token?.logoURI && (
            <img
              src={token.logoURI}
              alt=""
              style={{ width: 22, height: 22, borderRadius: '50%' }}
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
            style={amountInputStyle}
          />
        ) : (
          <input type="text" readOnly value={amount} placeholder="0.00" style={amountInputStyle}/>
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
    <div style={modalOverlay} onClick={onClose}>
      <div
        style={{ ...modalCard, padding: 0, maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 16, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ ...T.display, fontSize: 18, margin: 0 }}>Select token</h3>
            <button onClick={onClose} style={iconBtn}><CloseIcon/></button>
          </div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol, or paste address"
            style={{
              width: '100%', padding: '10px 12px',
              background: C.panel2, border: `1px solid ${C.border}`,
              borderRadius: 10, color: C.text, fontSize: 14,
              outline: 'none', ...T.body, boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {loading && <div style={{ padding: 16, color: C.textDim }}>Loading tokens…</div>}
          {!loading && list.length === 0 && (
            <div style={{ padding: 16, color: C.textDim }}>
              {searching ? 'Searching…' : 'No tokens found.'}
            </div>
          )}
          {list.map(t => {
            const bal = balances[t.address];
            return (
              <button
                key={t.address}
                onClick={() => onSelect(t.address)}
                style={tokenRowBtn}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.panel2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {t.logoURI
                  ? <img src={t.logoURI} alt="" style={{ width: 32, height: 32, borderRadius: '50%' }}
                         onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                  : <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.panel2 }} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{t.symbol}</div>
                  <div style={{
                    fontSize: 12, color: C.textDim,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{t.name}</div>
                </div>
                {bal && bal.uiAmount > 0 && (
                  <div style={{ textAlign: 'right', fontWeight: 600, fontSize: 14 }}>
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

function SettingsModal({ slippageBps, onChange, onClose }) {
  const [custom, setCustom] = useState((slippageBps / 100).toString());
  const presets = [10, 50, 100, 500];

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ ...T.display, fontSize: 18, margin: 0 }}>Settings</h3>
          <button onClick={onClose} style={iconBtn}><CloseIcon/></button>
        </div>

        <div style={{ marginBottom: 8, fontSize: 13, color: C.textDim }}>Slippage tolerance</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {presets.map(bps => (
            <button
              key={bps}
              onClick={() => { onChange(bps); setCustom((bps / 100).toString()); }}
              style={{
                flex: 1, padding: '8px', borderRadius: 10,
                border: `1px solid ${slippageBps === bps ? C.accent : C.border}`,
                background: slippageBps === bps ? C.accent : C.panel2,
                color: C.text, fontSize: 13, cursor: 'pointer', ...T.body,
              }}
            >{bps / 100}%</button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <input
            value={custom}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, '');
              setCustom(v);
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0 && n <= 50) onChange(Math.round(n * 100));
            }}
            placeholder="Custom"
            style={{
              width: '100%', padding: '10px 32px 10px 12px',
              background: C.panel2, border: `1px solid ${C.border}`,
              borderRadius: 10, color: C.text, fontSize: 14,
              outline: 'none', ...T.body, boxSizing: 'border-box',
            }}
          />
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: C.textDim }}>%</span>
        </div>

        <p style={{ marginTop: 16, fontSize: 12, color: C.textFaint }}>
          Higher slippage helps transactions land in volatile markets but means you may receive less than quoted.
        </p>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span>{label}</span>
      <span style={{ color: C.text, fontWeight: 500 }}>{children}</span>
    </div>
  );
}

function Banner({ kind, children }) {
  const colors = {
    error:   { bg: '#2a1416', border: '#5a2630', fg: '#fca5a5' },
    success: { bg: '#0f2418', border: '#1f5238', fg: '#86efac' },
    pending: { bg: '#241f0d', border: '#52431f', fg: '#fcd34d' },
  };
  const c = colors[kind] || colors.error;
  return (
    <div style={{
      marginTop: 12, padding: 12,
      background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 12, color: c.fg, fontSize: 14,
    }}>{children}</div>
  );
}

/* ─── STYLES ───────────────────────────────────────────────── */

const primaryBtn = {
  width: '100%', padding: '16px',
  background: C.accent, border: 'none',
  borderRadius: 14, color: '#fff',
  fontSize: 16, fontWeight: 600, ...T.body,
};

const iconBtn = {
  background: C.panel, border: `1px solid ${C.border}`,
  borderRadius: 10, width: 36, height: 36,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: C.text,
};

const flipBtn = {
  background: C.panel2, border: `1px solid ${C.border}`,
  borderRadius: 10, width: 36, height: 36,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: C.text,
};

const tokenPickerBtn = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 12px', background: C.panel,
  border: `1px solid ${C.border}`, borderRadius: 10,
  color: C.text, fontSize: 15, fontWeight: 600,
  cursor: 'pointer', ...T.body,
};

const amountInputStyle = {
  flex: 1, background: 'transparent', border: 'none',
  outline: 'none', color: C.text, fontSize: 24,
  textAlign: 'right', fontWeight: 600, ...T.body,
  minWidth: 0,
};

const tokenRowBtn = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 12px', background: 'transparent', border: 'none',
  borderRadius: 10, cursor: 'pointer', color: C.text,
  textAlign: 'left', ...T.body,
};

const modalOverlay = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16, zIndex: 1000,
};

const modalCard = {
  width: '100%', maxWidth: 400,
  background: C.panel, border: `1px solid ${C.border}`,
  borderRadius: 18, padding: 20, color: C.text,
};

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
const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6"  y2="18"/>
    <line x1="6"  y1="6" x2="18" y2="18"/>
  </svg>
);
