// Swap.jsx — Jupiter Swap V2 Router (single signature, atomic 5% fee)
//
// Flow:
//   1. User picks input + output tokens + amount
//   2. We call /api/jupiter/build (proxies api.jup.ag/swap/v2/build) with
//      platformFeeBps=500 + feeAccount=<our fee ATA for output mint>
//   3. Jupiter returns raw instructions. We assemble them into a single
//      VersionedTransaction.
//   4. Simulate to estimate compute units, then rebuild with 1.2x CU.
//   5. User signs once. We broadcast via RPC.
//   6. Confirm with Solscan-link fallback on timeout.
//
// Fee policy:
//   - 5% taken in the OUTPUT mint via Jupiter's native platformFeeBps.
//   - Fee account is the ATA of FEE_WALLET for the output mint. Jupiter
//     creates it via setupInstructions if it doesn't exist (user pays
//     ~0.002 SOL rent).

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  ComputeBudgetProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';

const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 500;
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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

/* helpers --------------------------------------------------------------- */

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
  if (m.includes('blockhash'))         return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled'))
    return 'Transaction cancelled.';
  if (m.includes('simulation failed')) return 'Swap simulation failed — the price may have moved.';
  if (m.includes('account not'))       return 'Token account not ready. Please try again in a moment.';
  if (m.includes('rate'))              return 'Too many requests — please wait a moment.';
  return err?.message || 'Swap failed. Please try again.';
};

function deserializeInstruction(ix) {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map(a => ({
      pubkey:     new PublicKey(a.pubkey),
      isSigner:   a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, 'base64'),
  });
}

async function getAltAccounts(connection, addressesByLut) {
  if (!addressesByLut) return [];
  const keys = Object.keys(addressesByLut);
  if (keys.length === 0) return [];
  const infos = await connection.getMultipleAccountsInfo(keys.map(k => new PublicKey(k)));
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    if (!infos[i]) continue;
    out.push(new AddressLookupTableAccount({
      key:   new PublicKey(keys[i]),
      state: AddressLookupTableAccount.deserialize(infos[i].data),
    }));
  }
  return out;
}

/* component ------------------------------------------------------------- */

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

  const rawAmount = useMemo(() => {
    if (!amount || !inputToken) return '';
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return '';
    return Math.floor(n * Math.pow(10, inputToken.decimals)).toString();
  }, [amount, inputToken]);

  /* quote */
  const quoteAbortRef = useRef(null);
  useEffect(() => {
    if (!rawAmount || inputMint === outputMint) {
      setQuote(null); setQuoteError(null); return;
    }
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const ac = new AbortController();
    quoteAbortRef.current = ac;
    setQuoting(true); setQuoteError(null);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount:         rawAmount,
          slippageBps:    String(slippageBps),
          taker:          wallet.publicKey ? wallet.publicKey.toBase58() : '11111111111111111111111111111111',
          platformFeeBps: String(FEE_BPS),
        });
        const r = await fetch(`/api/jupiter/build?${params}`, { signal: ac.signal });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Quote failed (${r.status})`);
        }
        const data = await r.json();
        if (!ac.signal.aborted) { setQuote(data); setQuoteError(null); }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!ac.signal.aborted) { setQuote(null); setQuoteError(friendlyError(e)); }
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

  const priceImpact = useMemo(() => {
    if (!quote || quote.priceImpactPct == null) return null;
    const n = Number(quote.priceImpactPct);
    return Number.isFinite(n) ? n * (Math.abs(n) <= 1 ? 100 : 1) : null; // some APIs return 0-1 fraction
  }, [quote]);

  const minReceived = useMemo(() => {
    if (!quote || !outputToken) return null;
    return Number(quote.otherAmountThreshold) / Math.pow(10, outputToken.decimals);
  }, [quote, outputToken]);

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

  /* swap */
  const handleSwap = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setSwapError('Please connect a wallet first.');
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
      // Determine output token program (Token or Token-2022) to derive correct ATA
      const outputMintInfo = await connection.getAccountInfo(new PublicKey(outputMint));
      if (!outputMintInfo) throw new Error('Output mint not found on-chain.');
      const outputTokenProgram = outputMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;
      const feeAccount = getAssociatedTokenAddressSync(
        new PublicKey(outputMint),
        FEE_WALLET,
        true,
        outputTokenProgram,
      );

      const buildParams = new URLSearchParams({
        inputMint,
        outputMint,
        amount:          rawAmount,
        slippageBps:     String(slippageBps),
        taker:           wallet.publicKey.toBase58(),
        platformFeeBps:  String(FEE_BPS),
        feeAccount:      feeAccount.toBase58(),
      });
      const r = await fetch(`/api/jupiter/build?${buildParams}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `Build failed (${r.status})`);
      }
      const build = await r.json();

      // assemble instructions
      const ixs = [];
      if (Array.isArray(build.computeBudgetInstructions))
        for (const ix of build.computeBudgetInstructions) ixs.push(deserializeInstruction(ix));
      if (Array.isArray(build.setupInstructions))
        for (const ix of build.setupInstructions) ixs.push(deserializeInstruction(ix));
      if (build.swapInstruction) ixs.push(deserializeInstruction(build.swapInstruction));
      if (build.cleanupInstruction) ixs.push(deserializeInstruction(build.cleanupInstruction));
      if (Array.isArray(build.otherInstructions))
        for (const ix of build.otherInstructions) ixs.push(deserializeInstruction(ix));

      const alts = await getAltAccounts(connection, build.addressesByLookupTableAddress || null);
      const latest = await connection.getLatestBlockhash('confirmed');

      // Simulate with max CU to estimate
      const simMsg = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: latest.blockhash,
        instructions:    [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs],
      }).compileToV0Message(alts);
      const simTx = new VersionedTransaction(simMsg);

      let estimatedCu = 600_000;
      try {
        const sim = await connection.simulateTransaction(simTx, {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        if (sim.value.err) {
          const logs = (sim.value.logs || []).join('\n');
          if (/insufficient/i.test(logs)) throw new Error('Insufficient balance for this swap.');
          if (/slippage/i.test(logs))     throw new Error('Slippage exceeded — price moved.');
          throw new Error('Simulation failed: ' + JSON.stringify(sim.value.err));
        }
        if (sim.value.unitsConsumed) {
          estimatedCu = Math.min(1_400_000, Math.ceil(sim.value.unitsConsumed * 1.2));
        }
      } catch (simErr) {
        if (/insufficient|slippage|simulation failed/i.test(String(simErr.message))) throw simErr;
        console.warn('[swap] sim non-fatal', simErr);
      }

      // Final tx — strip any compute-unit-limit instruction from build's CB ixs
      // (we replace it with our simulated value). Keep priority-fee instructions.
      const finalIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: estimatedCu }),
        ...ixs.filter(ix => {
          if (!ix.programId.equals(ComputeBudgetProgram.programId)) return true;
          return ix.data[0] !== 0x02; // 0x02 = setComputeUnitLimit
        }),
      ];
      const finalMsg = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: latest.blockhash,
        instructions:    finalIxs,
      }).compileToV0Message(alts);
      const finalTx = new VersionedTransaction(finalMsg);

      const signed = await wallet.signTransaction(finalTx);
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Confirm + fallback
      let confirmed = false;
      try {
        const result = await Promise.race([
          connection.confirmTransaction({
            signature,
            blockhash:           latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }, 'confirmed'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 30_000)),
        ]);
        if (result?.value?.err) {
          throw new Error('Transaction failed on-chain: ' + JSON.stringify(result.value.err));
        }
        confirmed = true;
      } catch (cfErr) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
            if (st?.value?.err) throw new Error('Transaction failed on-chain.');
          } catch (pollErr) {
            if (/failed on-chain/i.test(String(pollErr.message))) throw pollErr;
          }
        }
      }

      setSwapResult({ signature, pending: !confirmed });

      if (confirmed) {
        setAmount('');
        setQuote(null);
        setTimeout(() => { refreshBalances(); }, 2000);
      }
    } catch (e) {
      console.error('[swap] failed', e);
      setSwapError(friendlyError(e));
    } finally {
      setSwapping(false);
    }
  }, [wallet, quote, outputToken, inputToken, inputMint, outputMint, rawAmount, slippageBps, connection, refreshBalances]);

  const hasFunds = inputBalance && Number(amount) > 0 && inputBalance.uiAmount >= Number(amount);
  const canSwap  = !!wallet.publicKey && !!quote && !quoting && !swapping &&
                   Number(amount) > 0 && inputMint !== outputMint && hasFunds;

  /* render */
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, ...T.body, paddingBottom: 80 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ ...T.display, fontSize: 28, margin: 0 }}>Swap</h1>
          <button onClick={() => setShowSettings(true)} style={iconBtn} aria-label="Settings">
            <SettingsIcon />
          </button>
        </div>

        <div style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 20,
          padding: 16,
        }}>
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
            <button onClick={flip} style={flipBtn} aria-label="Flip tokens">
              <FlipIcon />
            </button>
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
            <Row label="Platform fee">{(FEE_BPS / 100).toFixed(1)}% (in {outputToken.symbol})</Row>
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

/* sub-components -------------------------------------------------------- */

function SwapRow({ label, token, amount, onAmountChange, onPickerOpen, balance, onMax, editable }) {
  return (
    <div style={{
      background: C.panel2,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: C.textDim }}>{label}</span>
        {balance && (
          <span style={{ fontSize: 12, color: C.textDim }}>
            Balance: {fmtAmount(balance.uiAmount, balance.decimals)}
            {editable && onMax && balance.uiAmount > 0 && (
              <button
                onClick={onMax}
                style={{
                  marginLeft: 6,
                  background: 'transparent',
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: '2px 6px',
                  color: C.accent,
                  fontSize: 11,
                  cursor: 'pointer',
                  ...T.body,
                }}
              >
                MAX
              </button>
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
          <ChevronIcon />
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
          <input
            type="text"
            readOnly
            value={amount}
            placeholder="0.00"
            style={amountInputStyle}
          />
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
            <button onClick={onClose} style={iconBtn}><CloseIcon /></button>
          </div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol, or paste address"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: C.panel2,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: C.text,
              fontSize: 14,
              outline: 'none',
              ...T.body,
              boxSizing: 'border-box',
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
                  <div style={{ fontSize: 12, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </div>
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
          <button onClick={onClose} style={iconBtn}><CloseIcon /></button>
        </div>

        <div style={{ marginBottom: 8, fontSize: 13, color: C.textDim }}>Slippage tolerance</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {presets.map(bps => (
            <button
              key={bps}
              onClick={() => { onChange(bps); setCustom((bps / 100).toString()); }}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: 10,
                border: `1px solid ${slippageBps === bps ? C.accent : C.border}`,
                background: slippageBps === bps ? C.accent : C.panel2,
                color: C.text,
                fontSize: 13,
                cursor: 'pointer',
                ...T.body,
              }}
            >
              {bps / 100}%
            </button>
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
              width: '100%',
              padding: '10px 32px 10px 12px',
              background: C.panel2,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: C.text,
              fontSize: 14,
              outline: 'none',
              ...T.body,
              boxSizing: 'border-box',
            }}
          />
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: C.textDim }}>
            %
          </span>
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
      marginTop: 12,
      padding: 12,
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 12,
      color: c.fg,
      fontSize: 14,
    }}>
      {children}
    </div>
  );
}

/* styles ---------------------------------------------------------------- */

const primaryBtn = {
  width: '100%',
  padding: '16px',
  background: C.accent,
  border: 'none',
  borderRadius: 14,
  color: '#fff',
  fontSize: 16,
  fontWeight: 600,
  ...T.body,
};

const iconBtn = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  width: 36, height: 36,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
  color: C.text,
};

const flipBtn = {
  background: C.panel2,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  width: 36, height: 36,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
  color: C.text,
};

const tokenPickerBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  ...T.body,
};

const amountInputStyle = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: C.text,
  fontSize: 24,
  textAlign: 'right',
  fontWeight: 600,
  ...T.body,
  minWidth: 0,
};

const tokenRowBtn = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  background: 'transparent',
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
  color: C.text,
  textAlign: 'left',
  ...T.body,
};

const modalOverlay = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16, zIndex: 1000,
};

const modalCard = {
  width: '100%',
  maxWidth: 400,
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 18,
  padding: 20,
  color: C.text,
};

/* icons ----------------------------------------------------------------- */

const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const FlipIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6"  x2="6"  y2="18" />
    <line x1="6"  y1="6"  x2="18" y2="18" />
  </svg>
);
