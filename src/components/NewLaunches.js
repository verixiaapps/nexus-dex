import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Buffer } from 'buffer';

const FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const PLATFORM_FEE = 0.02;
const SERVICE_FEE = 0.01;
const ANTIMEV_FEE = 0.01;
const JUP_API_KEY = process.env.REACT_APP_JUPITER_API_KEY1 || '';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PRESET_KEY = 'nexus_launch_presets';
const LAST_AMT_KEY = 'nexus_launch_last_amt';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  orange: '#ff9500', purple: '#9945ff',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function loadPresets() {
  try { const v = localStorage.getItem(PRESET_KEY); return v ? JSON.parse(v) : [5, 10, 25, 50, 100]; }
  catch (e) { return [5, 10, 25, 50, 100]; }
}
function savePresets(arr) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(arr)); } catch (e) {}
}
function loadLastAmt() {
  try { return parseFloat(localStorage.getItem(LAST_AMT_KEY) || '25') || 25; } catch (e) { return 25; }
}
function saveLastAmt(v) {
  try { localStorage.setItem(LAST_AMT_KEY, String(v)); } catch (e) {}
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  return Math.floor(diff / 3600) + 'h';
}
function fmtMc(n) {
  if (!n) return '–';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}
function fmtPrice(n) {
  if (!n || n === 0) return '–';
  if (n < 0.000001) return '$' + n.toExponential(2);
  if (n < 0.001) return '$' + n.toFixed(7);
  if (n < 1) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return null;
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

async function sendFee(publicKey, sendTransaction, connection, dollarAmt, solPrice, totalFeeRate) {
  try {
    const feeSol = (dollarAmt * totalFeeRate) / solPrice;
    if (feeSol < 0.000001) return;
    const feeTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new PublicKey(FEE_WALLET),
        lamports: Math.round(feeSol * LAMPORTS_PER_SOL),
      })
    );
    const lb = await connection.getLatestBlockhash();
    feeTx.recentBlockhash = lb.blockhash;
    feeTx.feePayer = publicKey;
    await sendTransaction(feeTx, connection);
  } catch (e) { console.log('Fee tx silent fail:', e); }
}

async function fetchDexData(mints) {
  if (!mints || mints.length === 0) return {};
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mints.slice(0, 30).join(','));
    const data = await res.json();
    const out = {};
    if (data.pairs) {
      data.pairs.forEach(pair => {
        const addr = pair.baseToken && pair.baseToken.address;
        if (!addr) return;
        if (!out[addr] || (pair.liquidity && pair.liquidity.usd > (out[addr].liquidity || 0))) {
          out[addr] = {
            price: parseFloat(pair.priceUsd || 0),
            marketCap: pair.fdv || pair.marketCap || 0,
            pct5m: pair.priceChange?.m5 != null ? pair.priceChange.m5 : null,
            pct1h: pair.priceChange?.h1 != null ? pair.priceChange.h1 : null,
            pct24h: pair.priceChange?.h24 != null ? pair.priceChange.h24 : null,
            volume24h: pair.volume?.h24 ? pair.volume.h24 : 0,
            liquidity: pair.liquidity?.usd ? pair.liquidity.usd : 0,
            graduated: pair.dexId !== 'pump',
            dexId: pair.dexId,
            pairAddress: pair.pairAddress,
          };
        }
      });
    }
    return out;
  } catch (e) { return {}; }
}

function PresetEditor({ open, onClose, presets, onSave }) {
  const [vals, setVals] = useState(presets.map(String));

  useEffect(() => { if (open) setVals(presets.map(String)); }, [open, presets]);

  if (!open) return null;

  return (
    <div>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.8)' }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi,
        borderRadius: 18, padding: 24, width: '90vw', maxWidth: 360,
        boxShadow: '0 24px 80px rgba(0,0,0,.95)',
      }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Edit Presets</div>
        <div style={{ color: C.muted, fontSize: 11, marginBottom: 18 }}>Set your 5 quick-buy dollar amounts</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {vals.map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: C.muted, fontSize: 13, width: 60 }}>Preset {i + 1}</span>
              <div style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: C.muted }}>$</span>
                <input
                  value={v}
                  onChange={e => {
                    const nv = e.target.value.replace(/[^0-9.]/g, '');
                    setVals(prev => { const n = [...prev]; n[i] = nv; return n; });
                  }}
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 15, fontWeight: 600, outline: 'none' }}
                />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: 12, borderRadius: 10, background: C.card2, border: '1px solid ' + C.border, color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
          >Cancel</button>
          <button
            onClick={() => {
              const parsed = vals.map(v => parseFloat(v) || 0).filter(v => v > 0);
              while (parsed.length < 5) parsed.push(25);
              onSave(parsed.slice(0, 5));
              onClose();
            }}
            style={{ flex: 2, padding: 12, borderRadius: 10, background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}
          >Save Presets</button>
        </div>
      </div>
    </div>
  );
}

function TradeDrawer({ open, onClose, mode, token, solPrice, onConnectWallet, isConnected, isSolanaConnected, presets, onPresetsChange }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [activePreset, setActivePreset] = useState(null);
  const [customAmt, setCustomAmt] = useState('');
  const [sellPct, setSellPct] = useState(50);
  const [antiMev, setAntiMev] = useState(true);
  const [status, setStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [error, setError] = useState('');
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);

  const lastAmt = loadLastAmt();
  const totalFeeRate = PLATFORM_FEE + SERVICE_FEE + (antiMev ? ANTIMEV_FEE : 0);

  useEffect(() => {
    if (open) {
      const last = loadLastAmt();
      const matchingPreset = presets.find(p => p === last);
      if (matchingPreset) { setActivePreset(last); setCustomAmt(''); }
      else { setActivePreset(null); setCustomAmt(String(last)); }
      setStatus('idle'); setTxSig(null); setError('');
    }
  }, [open, presets]);

  const activeDollar = parseFloat(customAmt) || activePreset || lastAmt;
  const solAmt = solPrice > 0 ? activeDollar / solPrice : 0;

  const executeTrade = async () => {
    if (!isConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!isSolanaConnected || !publicKey) { setError('Connect Phantom to trade'); return; }
    if (!token) return;
    setStatus('loading'); setError('');
    const isGrad = token.graduated || (token.bondingProgress || 0) >= 100;
    try {
      if (!isGrad) {
        const body = {
          publicKey: publicKey.toString(),
          action: mode,
          mint: token.mint,
          denominatedInSol: mode === 'buy' ? 'true' : 'false',
          amount: mode === 'buy' ? parseFloat(solAmt.toFixed(6)) : (sellPct + '%'),
          slippage: 15,
          priorityFee: antiMev ? 0.001 : 0.0001,
          pool: 'auto',
        };
        const res = await fetch('https://pumpportal.fun/api/trade-local', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('PumpPortal error ' + res.status);
        const txBytes = await res.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, 'confirmed');
        setTxSig(sig);
      } else {
        const inputMint = mode === 'buy' ? SOL_MINT : token.mint;
        const outputMint = mode === 'buy' ? token.mint : SOL_MINT;
        const amount = mode === 'buy' ? Math.round(solAmt * 1e9) : Math.round((sellPct / 100) * (token.userBalance || 1e6));
        const qRes = await fetch(
          `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=150&restrictIntermediateTokens=true`,
          { headers: { 'x-api-key': JUP_API_KEY } }
        );
        const qData = await qRes.json();
        if (!qData.outAmount) throw new Error(qData.error || 'No Jupiter route');
        const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': JUP_API_KEY },
          body: JSON.stringify({ quoteResponse: qData, userPublicKey: publicKey.toString(), wrapAndUnwrapSol: true, computeUnitPriceMicroLamports: antiMev ? 50000 : 1000, prioritizationFeeLamports: antiMev ? 100000 : 5000 }),
        });
        const swapData = await swapRes.json();
        if (!swapData.swapTransaction) throw new Error(swapData.error || 'No swap tx');
        const jupTx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
        const sig = await sendTransaction(jupTx, connection);
        await connection.confirmTransaction(sig, 'confirmed');
        setTxSig(sig);
      }

      await sendFee(publicKey, sendTransaction, connection, activeDollar, solPrice, totalFeeRate);
      saveLastAmt(activeDollar);
      setStatus('success');
      setTimeout(() => { setStatus('idle'); setTxSig(null); onClose(); }, 3500);
    } catch (e) {
      console.error('Trade error:', e);
      setError(e.message || 'Trade failed');
      setStatus('error');
      setTimeout(() => { setStatus('idle'); setError(''); }, 4000);
    }
  };

  if (!open || !token) return null;
  const isBuy = mode === 'buy';
  const isGrad = token.graduated || (token.bondingProgress || 0) >= 100;

  return (
    <div>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 401,
        background: C.card, borderTop: '2px solid ' + C.borderHi,
        borderRadius: '20px 20px 0 0', padding: '20px 20px 44px',
        maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
      }}>
        <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 20px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {token.image
              ? <img src={token.image} alt={token.symbol} style={{ width: 36, height: 36, borderRadius: 8 }} onError={e => { e.target.style.display = 'none'; }} />
              : <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: C.purple }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>
            }
            <div>
              <div style={{ color: isBuy ? C.accent : C.red, fontWeight: 800, fontSize: 18 }}>{isBuy ? 'Buy' : 'Sell'} {token.symbol}</div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>{isGrad ? 'Jupiter swap' : 'Pump.fun curve'} - {(totalFeeRate * 100).toFixed(0)}% fee</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: 0 }}>x</button>
        </div>

        {!isConnected && (
          <div style={{ marginBottom: 16, padding: 14, background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Connect wallet to trade</span>
            <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
          </div>
        )}
        {isConnected && !isSolanaConnected && (
          <div style={{ marginBottom: 16, padding: 14, background: 'rgba(255,59,107,.05)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 12 }}>
            <span style={{ color: C.red, fontSize: 13 }}>Solana wallet required. Connect Phantom.</span>
          </div>
        )}

        {isBuy ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>QUICK BUY</span>
              <button onClick={() => setPresetEditorOpen(true)} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, padding: 0 }}>Edit presets</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {presets.map(amt => {
                const active = activePreset === amt && !customAmt;
                return (
                  <button
                    key={amt}
                    onClick={() => { setActivePreset(amt); setCustomAmt(''); saveLastAmt(amt); }}
                    style={{
                      flex: 1, padding: '11px 2px', borderRadius: 10,
                      border: '1px solid ' + (active ? C.accent : C.border),
                      background: active ? 'rgba(0,229,255,.12)' : C.card2,
                      color: active ? C.accent : C.muted,
                      fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                    }}
                  >${amt}</button>
                );
              })}
            </div>
            <div style={{ background: C.card2, border: '1px solid ' + (customAmt ? C.accent : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 18, fontWeight: 600 }}>$</span>
              <input
                value={customAmt}
                onChange={e => { setCustomAmt(e.target.value.replace(/[^0-9.]/g, '')); setActivePreset(null); }}
                placeholder={`Custom (last: $${lastAmt})`}
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 18, fontWeight: 600, color: '#fff', outline: 'none' }}
              />
              {solPrice > 0 && activeDollar > 0 && (
                <span style={{ color: C.muted, fontSize: 11, flexShrink: 0 }}>{(activeDollar / solPrice).toFixed(3)} SOL</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>SELL AMOUNT</div>
            <div style={{ display: 'flex', gap: 7 }}>
              {[25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => setSellPct(pct)}
                  style={{
                    flex: 1, padding: '11px 4px', borderRadius: 10,
                    border: '1px solid ' + (sellPct === pct ? C.red : C.border),
                    background: sellPct === pct ? 'rgba(255,59,107,.1)' : C.card2,
                    color: sellPct === pct ? C.red : C.muted,
                    fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                  }}
                >{pct === 100 ? 'MAX' : pct + '%'}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: '#050912', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SNIPER PROTECTION</span>
              <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>
                {antiMev ? 'ON - Priority, bot protected (+1%)' : 'OFF - Standard speed (saves 1%)'}
              </div>
            </div>
            <button
              onClick={() => setAntiMev(!antiMev)}
              style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: antiMev ? C.accent : C.muted2, position: 'relative', flexShrink: 0 }}
            >
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: antiMev ? 23 : 3, transition: 'left .2s' }} />
            </button>
          </div>
          {isBuy && activeDollar > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 8 }}>
              {[
                ['Platform Fee (2%)', '$' + (activeDollar * PLATFORM_FEE).toFixed(2)],
                ['Service Fee (1%)', '$' + (activeDollar * SERVICE_FEE).toFixed(2)],
                antiMev ? ['Sniper Protection (1%)', '$' + (activeDollar * ANTIMEV_FEE).toFixed(2)] : null,
                ['Total spend', `$${activeDollar.toFixed(2)} (${solPrice > 0 ? (activeDollar / solPrice).toFixed(3) : '0'} SOL)`],
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 11 }}>
                  <span style={{ color: C.muted }}>{label}</span>
                  <span style={{ color: C.text }}>{value}</span>
                </div>
              ))}
            </div>
          )}
          {!antiMev && (
            <div style={{ marginTop: 6, padding: '6px 8px', background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.2)', borderRadius: 6, fontSize: 10, color: C.orange }}>
              Warning: bots may front-run your trade
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>
        )}

        <button
          onClick={executeTrade}
          disabled={status === 'loading'}
          style={{
            width: '100%', padding: 18, borderRadius: 14, border: 'none',
            background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
              : status === 'error' ? 'rgba(255,59,107,.2)'
              : !isConnected ? 'linear-gradient(135deg,#9945ff,#7c3aed)'
              : isBuy ? 'linear-gradient(135deg,#00e5ff,#0055ff)'
              : 'linear-gradient(135deg,#ff3b6b,#cc1144)',
            color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
            cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 54,
          }}
        >
          {!isConnected ? 'Connect Wallet'
            : !isSolanaConnected ? 'Solana Wallet Required'
            : status === 'loading' ? 'Confirming...'
            : status === 'success' ? (isBuy ? 'Bought!' : 'Sold!') + ' Confirmed'
            : status === 'error' ? 'Failed - Try Again'
            : isBuy ? `Buy ${token.symbol} - $${activeDollar.toFixed(2)}`
            : `Sell ${sellPct}% of ${token.symbol}`}
        </button>

        {txSig && status === 'success' && (
          <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>View on Solscan</a>
        )}
        <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 12, lineHeight: 1.6 }}>Non-custodial - Fees go directly to Nexus DEX</p>
      </div>
      <PresetEditor open={presetEditorOpen} onClose={() => setPresetEditorOpen(false)} presets={presets} onSave={onPresetsChange} />
    </div>
  );
}

function TokenPage({ token, onBack, onConnectWallet, isConnected, isSolanaConnected, solPrice, presets, onPresetsChange }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [dexData, setDexData] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetchDexData([token.mint]).then(d => { if (d[token.mint]) setDexData(d[token.mint]); });
  }, [token]);

  if (!token) return null;

  const price = dexData ? dexData.price : token.price || 0;
  const marketCap = dexData ? dexData.marketCap : token.marketCap || 0;
  const pct5m = dexData ? dexData.pct5m : null;
  const pct1h = dexData ? dexData.pct1h : null;
  const pct24h = dexData ? dexData.pct24h : null;
  const volume = dexData ? dexData.volume24h : 0;
  const progress = token.bondingProgress || 0;
  const isGrad = (dexData ? dexData.graduated : token.graduated) || progress >= 100;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>
        Back to Launches
      </button>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {token.image ? (
              <img src={token.image} alt={token.symbol} style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: C.purple }}>
                {token.symbol ? token.symbol.charAt(0) : '?'}
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{token.symbol}</span>
                {isGrad ? (
                  <span style={{ background: 'rgba(0,255,163,.12)', color: C.green, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(0,255,163,.25)' }}>GRADUATED</span>
                ) : (
                  <span style={{ background: 'rgba(153,69,255,.12)', color: C.purple, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(153,69,255,.25)' }}>PUMP.FUN</span>
                )}
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>{token.name}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#fff' }}>{fmtPrice(price)}</div>
            {pct1h != null && (
              <div style={{ fontSize: 13, fontWeight: 600, color: pct1h >= 0 ? C.green : C.red, marginTop: 2 }}>{fmtPct(pct1h)} (1h)</div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
          {[['5m', pct5m], ['1h', pct1h], ['24h', pct24h]].map(([label, val]) => (
            <div key={label} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: val == null ? C.muted2 : val >= 0 ? C.green : C.red }}>
                {val == null ? '--' : fmtPct(val)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 16 }}>
          {[
            ['Market Cap', fmtMc(marketCap)],
            ['Volume 24h', fmtMc(volume)],
            ['Created', timeAgo(token.createdAt) + ' ago'],
            ['Exchange', isGrad ? 'Raydium' : 'Pump.fun'],
          ].map(([label, value]) => (
            <div key={label} style={{ background: C.card2, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>{label}</div>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{value}</div>
            </div>
          ))}
        </div>

        {!isGrad && progress > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>BONDING CURVE PROGRESS</span>
              <span style={{ fontSize: 11, color: progress > 75 ? C.orange : C.muted, fontWeight: 700 }}>{progress.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, background: C.card3, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4, width: Math.min(progress, 100) + '%',
                background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)',
                transition: 'width 0.5s',
              }} />
            </div>
            {progress >= 80 && (
              <div style={{ marginTop: 6, fontSize: 10, color: C.orange }}>
                Almost graduated to Raydium - {(100 - progress).toFixed(1)}% remaining
              </div>
            )}
          </div>
        )}

        <div style={{ background: C.card3, borderRadius: 10, padding: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, fontWeight: 700, letterSpacing: 1 }}>CONTRACT</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>{token.mint}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button
          onClick={() => { setDrawerMode('buy'); setDrawerOpen(true); }}
          style={{ padding: '18px 10px', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, boxShadow: '0 0 20px rgba(0,229,255,.2)', minHeight: 56 }}
        >Buy {token.symbol}</button>
        <button
          onClick={() => { setDrawerMode('sell'); setDrawerOpen(true); }}
          style={{ padding: '18px 10px', borderRadius: 14, cursor: 'pointer', background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}
        >Sell {token.symbol}</button>
      </div>

      <TradeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mode={drawerMode}
        token={{ ...token, ...(dexData || {}), graduated: isGrad }}
        solPrice={solPrice}
        onConnectWallet={onConnectWallet}
        isConnected={isConnected}
        isSolanaConnected={isSolanaConnected}
        presets={presets}
        onPresetsChange={onPresetsChange}
      />
    </div>
  );
}

function TokenCard({ token, onClick, isNew }) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (isNew) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 4000);
      return () => clearTimeout(t);
    }
  }, [isNew]);

  const progress = token.bondingProgress || 0;
  const isGrad = token.graduated || progress >= 100;
  const pct = token.pct1h != null ? token.pct1h : token.pct5m != null ? token.pct5m : null;
  const pctLabel = token.pct1h != null ? '1h' : '5m';

  return (
    <div
      onClick={() => onClick(token)}
      style={{ background: flash ? 'rgba(0,255,163,0.04)' : C.card, border: '1px solid ' + (flash ? 'rgba(0,255,163,0.2)' : C.border), borderRadius: 14, padding: 14, marginBottom: 10, cursor: 'pointer', transition: 'background 0.6s, border 0.6s' }}
      onMouseEnter={e => { e.currentTarget.style.border = '1px solid rgba(0,229,255,.2)'; }}
      onMouseLeave={e => { e.currentTarget.style.border = '1px solid ' + (flash ? 'rgba(0,255,163,.2)' : C.border); }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {token.image ? (
            <img src={token.image} alt={token.symbol} style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
          ) : (
            <div style={{ width: 46, height: 46, borderRadius: 10, background: 'rgba(153,69,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: C.purple }}>
              {token.symbol ? token.symbol.charAt(0) : '?'}
            </div>
          )}
          {flash && <div style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: C.green, boxShadow: '0 0 6px ' + C.green }} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2, flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>{token.symbol || '???'}</span>
            {isGrad ? (
              <span style={{ background: 'rgba(0,255,163,.1)', color: C.green, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>GRAD</span>
            ) : (
              <span style={{ background: 'rgba(153,69,255,.1)', color: C.purple, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>PUMP</span>
            )}
            {flash && <span style={{ fontSize: 9, color: C.green, fontWeight: 700 }}>NEW</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {token.price > 0 && <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{fmtPrice(token.price)}</span>}
            <span style={{ fontSize: 12, color: C.muted }}>{fmtMc(token.marketCap)}</span>
            <span style={{ fontSize: 10, color: C.muted2 }}>{timeAgo(token.createdAt)}</span>
          </div>
          {!isGrad && progress > 0 && (
            <div style={{ marginTop: 5, height: 3, background: C.card3, borderRadius: 2, overflow: 'hidden', width: '100%' }}>
              <div style={{ height: '100%', borderRadius: 2, width: Math.min(progress, 100) + '%', background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)' }} />
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          {pct != null ? (
            <div style={{ fontSize: 14, fontWeight: 700, color: pct >= 0 ? C.green : C.red }}>{fmtPct(pct)}</div>
          ) : (
            <div style={{ fontSize: 11, color: C.muted2 }}>--</div>
          )}
          {pct != null && <div style={{ fontSize: 9, color: C.muted2, marginTop: 1 }}>{pctLabel}</div>}
        </div>
      </div>
    </div>
  );
}

export default function NewLaunches({ coins, onConnectWallet, isConnected, isSolanaConnected, walletAddress }) {
  const [tokens, setTokens] = useState([]);
  const [tab, setTab] = useState('new');
  const [selectedToken, setSelectedToken] = useState(null);
  const [newMints, setNewMints] = useState(new Set());
  const [wsStatus, setWsStatus] = useState('connecting');
  const [presets, setPresets] = useState(loadPresets());
  const tokensRef = useRef([]);
  const dexQueueRef = useRef([]);
  const dexTimerRef = useRef(null);

  const solCoin = coins && coins.find(c => c.id === 'solana');
  const solPrice = solCoin ? solCoin.current_price : 150;

  const handlePresetsChange = newPresets => { setPresets(newPresets); savePresets(newPresets); };

  const queueDexFetch = useCallback(mint => {
    dexQueueRef.current.push(mint);
    if (dexTimerRef.current) clearTimeout(dexTimerRef.current);
    dexTimerRef.current = setTimeout(async () => {
      const batch = dexQueueRef.current.slice();
      dexQueueRef.current = [];
      if (batch.length === 0) return;
      const data = await fetchDexData(batch);
      if (Object.keys(data).length === 0) return;
      tokensRef.current = tokensRef.current.map(t => data[t.mint] ? { ...t, ...data[t.mint] } : t);
      setTokens([...tokensRef.current]);
    }, 1000);
  }, []);

  const addToken = useCallback(token => {
    tokensRef.current = [token, ...tokensRef.current.filter(t => t.mint !== token.mint)].slice(0, 150);
    setTokens([...tokensRef.current]);
    queueDexFetch(token.mint);
  }, [queueDexFetch]);

  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      try {
        ws = new WebSocket('wss://pumpportal.fun/api/data');
        ws.onopen = () => {
          setWsStatus('live');
          ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
        };
        ws.onmessage = event => {
          try {
            const data = JSON.parse(event.data);
            if (!data.mint) return;
            const token = {
              mint: data.mint,
              symbol: data.symbol || '???',
              name: data.name || data.symbol || 'Unknown',
              image: data.image_uri || null,
              marketCap: data.usd_market_cap || data.market_cap || 0,
              price: 0, pct5m: null, pct1h: null, pct24h: null,
              bondingProgress: data.virtual_sol_reserves
                ? Math.min((data.virtual_sol_reserves / 85000) * 100, 100) : 0,
              graduated: data.complete || false,
              createdAt: data.created_timestamp || Date.now(),
              recentBuys: 0,
            };
            setNewMints(prev => {
              const next = new Set(prev);
              next.add(token.mint);
              setTimeout(() => { setNewMints(p => { const n = new Set(p); n.delete(token.mint); return n; }); }, 6000);
              return next;
            });
            addToken(token);
          } catch (e) {}
        };
        ws.onerror = () => setWsStatus('error');
        ws.onclose = () => { setWsStatus('reconnecting'); reconnectTimer = setTimeout(connect, 3000); };
      } catch (e) {
        setWsStatus('error');
        reconnectTimer = setTimeout(connect, 5000);
      }
    }

    connect();

    fetch('https://api.dexscreener.com/token-profiles/latest/v1')
      .then(r => r.json())
      .then(data => {
        const arr = Array.isArray(data) ? data : (data.tokenProfiles || []);
        arr.filter(t => t.chainId === 'solana').slice(0, 30).forEach(t => {
          addToken({
            mint: t.tokenAddress, symbol: t.header || t.tokenAddress.slice(0, 6),
            name: t.description || t.header || 'Unknown', image: t.icon || null,
            marketCap: 0, price: 0, pct5m: null, pct1h: null, pct24h: null,
            bondingProgress: 0, graduated: false, createdAt: Date.now(), recentBuys: 0,
          });
        });
      }).catch(() => {});

    return () => { clearTimeout(reconnectTimer); clearTimeout(dexTimerRef.current); if (ws) ws.close(); };
  }, [addToken]);

  if (selectedToken) {
    return (
      <TokenPage
        token={selectedToken}
        onBack={() => setSelectedToken(null)}
        onConnectWallet={onConnectWallet}
        isConnected={isConnected}
        isSolanaConnected={isSolanaConnected}
        solPrice={solPrice}
        presets={presets}
        onPresetsChange={handlePresetsChange}
      />
    );
  }

  const displayTokens = [...tokens].sort((a, b) =>
    tab === 'new'
      ? (b.createdAt || 0) - (a.createdAt || 0)
      : Math.abs(b.pct1h || 0) - Math.abs(a.pct1h || 0)
  );

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <style>{`@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }`}</style>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>New Launches</h1>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: wsStatus === 'live' ? 'rgba(0,255,163,.08)' : 'rgba(255,149,0,.08)',
            border: '1px solid ' + (wsStatus === 'live' ? 'rgba(0,255,163,.2)' : 'rgba(255,149,0,.2)'),
            borderRadius: 20, padding: '3px 10px',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: wsStatus === 'live' ? C.green : C.orange, animation: wsStatus === 'live' ? 'pulse 1.5s infinite' : 'none' }} />
            <span style={{ fontSize: 10, color: wsStatus === 'live' ? C.green : C.orange, fontWeight: 600 }}>
              {wsStatus === 'live' ? 'LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}
            </span>
          </div>
        </div>
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{tokens.length} tokens tracked - tap any to trade</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['new', 'New'], ['trending', 'Trending']].map(([val, lbl]) => {
          const active = tab === val;
          return (
            <button
              key={val}
              onClick={() => setTab(val)}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, fontWeight: 700, fontSize: 13,
                cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                background: active ? 'rgba(0,229,255,.1)' : C.card2,
                border: '1px solid ' + (active ? 'rgba(0,229,255,.3)' : C.border),
                color: active ? C.accent : C.muted,
              }}
            >{lbl}</button>
          );
        })}
      </div>

      {tokens.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: C.card, border: '1px solid ' + C.border, borderRadius: 16 }}>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 8 }}>
            {wsStatus === 'live' ? 'Waiting for new launches...' : 'Connecting to live feed...'}
          </div>
          <div style={{ color: C.muted2, fontSize: 12 }}>Tokens will appear here as they launch</div>
        </div>
      ) : (
        displayTokens.map(token => (
          <TokenCard key={token.mint} token={token} onClick={setSelectedToken} isNew={newMints.has(token.mint)} />
        ))
      )}
    </div>
  );
}
