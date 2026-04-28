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

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  orange: '#ff9500', purple: '#9945ff',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  return Math.floor(diff / 3600) + 'h ago';
}

function fmtMc(n) {
  if (!n) return '–';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function getSaved() {
  try { return localStorage.getItem('nexus_launch_amt') || '25'; } catch (e) { return '25'; }
}

function saveLast(v) {
  try { localStorage.setItem('nexus_launch_amt', v); } catch (e) {}
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
  } catch (e) {
    console.log('Fee tx failed silently:', e);
  }
}

function TokenCard({ token, onBuy, onSell, isNew }) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (isNew) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isNew]);

  const progress = token.bondingProgress || 0;
  const isGrad = token.graduated || progress >= 100;
  const isHot = (token.recentBuys || 0) >= 10;

  return (
    <div style={{
      background: flash ? 'rgba(0,255,163,0.05)' : C.card,
      border: '1px solid ' + (flash ? 'rgba(0,255,163,0.25)' : C.border),
      borderRadius: 14, padding: 14, marginBottom: 10,
      transition: 'background 0.6s ease, border 0.6s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {token.image ? (
            <img
              src={token.image}
              alt={token.symbol}
              style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover' }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div style={{ width: 46, height: 46, borderRadius: 10, background: 'rgba(153,69,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: C.purple }}>
              {token.symbol ? token.symbol.charAt(0) : '?'}
            </div>
          )}
          {flash && (
            <div style={{ position: 'absolute', top: -3, right: -3, width: 10, height: 10, borderRadius: '50%', background: C.green, boxShadow: '0 0 8px ' + C.green }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>{token.symbol || '???'}</span>
            {isGrad ? (
              <span style={{ background: 'rgba(0,255,163,0.12)', color: C.green, fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, border: '1px solid rgba(0,255,163,0.25)' }}>GRAD</span>
            ) : (
              <span style={{ background: 'rgba(153,69,255,0.12)', color: C.purple, fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, border: '1px solid rgba(153,69,255,0.25)' }}>PUMP</span>
            )}
            {isHot && <span style={{ fontSize: 10 }}>Hot</span>}
            {flash && <span style={{ fontSize: 9, color: C.green, fontWeight: 700 }}>NEW</span>}
          </div>

          <div style={{ color: C.muted, fontSize: 11, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {token.name || ''}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{fmtMc(token.marketCap)}</span>
            <span style={{ fontSize: 10, color: C.muted2 }}>{timeAgo(token.createdAt)}</span>
            {(token.recentBuys || 0) > 0 && (
              <span style={{ fontSize: 10, color: C.orange }}>{token.recentBuys} buys/min</span>
            )}
          </div>

          {!isGrad && progress > 0 && (
            <div style={{ marginTop: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 9, color: C.muted }}>Bonding curve</span>
                <span style={{ fontSize: 9, color: progress > 75 ? C.orange : C.muted }}>{progress.toFixed(1)}%</span>
              </div>
              <div style={{ height: 4, background: C.card3, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, width: Math.min(progress, 100) + '%',
                  background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)',
                  transition: 'width 0.5s',
                }} />
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => onBuy(token)}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: '#03060f', fontWeight: 800, fontSize: 12, fontFamily: 'Syne, sans-serif' }}
          >Buy</button>
          <button
            onClick={() => onSell(token)}
            style={{ padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)', color: C.red, fontWeight: 800, fontSize: 12, fontFamily: 'Syne, sans-serif' }}
          >Sell</button>
        </div>
      </div>
    </div>
  );
}

function TradeDrawer({ open, onClose, mode, token, solPrice, onConnectWallet, isConnected, isSolanaConnected }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [dollarPreset, setDollarPreset] = useState(getSaved());
  const [customAmt, setCustomAmt] = useState('');
  const [sellPct, setSellPct] = useState(50);
  const [antiMev, setAntiMev] = useState(true);
  const [status, setStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [error, setError] = useState('');

  const totalFeeRate = PLATFORM_FEE + SERVICE_FEE + (antiMev ? ANTIMEV_FEE : 0);
  const activeDollar = parseFloat(customAmt || dollarPreset) || 25;
  const solAmt = solPrice > 0 ? activeDollar / solPrice : 0;

  useEffect(() => {
    if (!open) {
      setStatus('idle');
      setTxSig(null);
      setError('');
      setCustomAmt('');
    }
  }, [open]);

  const executeTrade = async () => {
    if (!isConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!isSolanaConnected || !publicKey) { setError('Please connect Phantom wallet'); return; }
    if (!token) return;

    setStatus('loading');
    setError('');

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
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
        const amount = mode === 'buy'
          ? Math.round(solAmt * 1e9)
          : Math.round((sellPct / 100) * (token.userBalance || 1e6));

        const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=150&restrictIntermediateTokens=true`;
        const qRes = await fetch(quoteUrl, { headers: { 'x-api-key': JUP_API_KEY } });
        const qData = await qRes.json();
        if (!qData.outAmount) throw new Error(qData.error || 'No Jupiter route found');

        const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': JUP_API_KEY },
          body: JSON.stringify({
            quoteResponse: qData,
            userPublicKey: publicKey.toString(),
            wrapAndUnwrapSol: true,
            computeUnitPriceMicroLamports: antiMev ? 50000 : 1000,
            prioritizationFeeLamports: antiMev ? 100000 : 5000,
          }),
        });
        const swapData = await swapRes.json();
        if (!swapData.swapTransaction) throw new Error(swapData.error || 'No swap transaction');

        const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
        const jupTx = VersionedTransaction.deserialize(txBuf);
        const sig = await sendTransaction(jupTx, connection);
        await connection.confirmTransaction(sig, 'confirmed');
        setTxSig(sig);
      }

      await sendFee(publicKey, sendTransaction, connection, activeDollar, solPrice, totalFeeRate);

      setStatus('success');
      saveLast(String(activeDollar));
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
            {token.image ? (
              <img src={token.image} alt={token.symbol} style={{ width: 36, height: 36, borderRadius: 8 }} onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: C.purple, fontSize: 16 }}>
                {token.symbol ? token.symbol.charAt(0) : '?'}
              </div>
            )}
            <div>
              <div style={{ color: isBuy ? C.accent : C.red, fontWeight: 800, fontSize: 18 }}>
                {isBuy ? 'Buy' : 'Sell'} {token.symbol}
              </div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>
                {isGrad ? 'Graduated - Jupiter' : 'Pump.fun bonding curve'} - {(totalFeeRate * 100).toFixed(0)}% total fee
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: 0 }}>x</button>
        </div>

        {!isConnected && (
          <div style={{ marginBottom: 16, padding: 14, background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Connect wallet to trade</span>
            <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
          </div>
        )}
        {isConnected && !isSolanaConnected && (
          <div style={{ marginBottom: 16, padding: 14, background: 'rgba(255,59,107,.05)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 12 }}>
            <span style={{ color: C.red, fontSize: 13 }}>Solana wallet required. Please connect Phantom.</span>
          </div>
        )}

        {isBuy ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>QUICK BUY AMOUNT</div>
            <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
              {['5', '10', '25', '50', '100'].map(amt => {
                const active = dollarPreset === amt && !customAmt;
                return (
                  <button
                    key={amt}
                    onClick={() => { setDollarPreset(amt); setCustomAmt(''); }}
                    style={{
                      flex: 1, padding: '11px 4px', borderRadius: 10,
                      border: '1px solid ' + (active ? C.accent : C.border),
                      background: active ? 'rgba(0,229,255,.12)' : C.card2,
                      color: active ? C.accent : C.muted,
                      fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                    }}
                  >${amt}</button>
                );
              })}
            </div>
            <div style={{ background: C.card2, border: '1px solid ' + (customAmt ? C.accent : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 18, fontWeight: 600 }}>$</span>
              <input
                value={customAmt}
                onChange={e => setCustomAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={`Custom (last used: $${dollarPreset})`}
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 18, fontWeight: 600, color: '#fff', outline: 'none' }}
              />
              {solPrice > 0 && activeDollar > 0 && (
                <span style={{ color: C.muted, fontSize: 11, flexShrink: 0 }}>{(activeDollar / solPrice).toFixed(3)} SOL</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>SELL PERCENTAGE</div>
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
                {antiMev ? 'ON - Bot protected, priority (+1%)' : 'OFF - Standard speed (saves 1%)'}
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
                ['You spend', `$${activeDollar.toFixed(2)} (${solPrice > 0 ? (activeDollar / solPrice).toFixed(3) : '0'} SOL)`],
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
              Warning: bots may front-run your trade without protection
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
              : isConnected && !isSolanaConnected ? 'rgba(255,59,107,.2)'
              : isBuy ? 'linear-gradient(135deg,#00e5ff,#0055ff)'
              : 'linear-gradient(135deg,#ff3b6b,#cc1144)',
            color: '#fff',
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
            cursor: status === 'loading' ? 'not-allowed' : 'pointer',
            minHeight: 54,
          }}
        >
          {!isConnected ? 'Connect Wallet'
            : !isSolanaConnected ? 'Solana Wallet Required'
            : status === 'loading' ? 'Confirming...'
            : status === 'success' ? (isBuy ? 'Bought!' : 'Sold!') + ' Transaction Confirmed'
            : status === 'error' ? 'Failed - Try Again'
            : isBuy ? `Buy ${token.symbol} - $${activeDollar.toFixed(2)}`
            : `Sell ${sellPct}% of ${token.symbol}`}
        </button>

        {txSig && status === 'success' && (
          <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>
            View on Solscan
          </a>
        )}
        <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 12, lineHeight: 1.6 }}>
          Non-custodial - Fees go directly to Nexus DEX
        </p>
      </div>
    </div>
  );
}

export default function NewLaunches({ coins, onConnectWallet, isConnected, isSolanaConnected, walletAddress }) {
  const [tokens, setTokens] = useState([]);
  const [tab, setTab] = useState('new');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [selectedToken, setSelectedToken] = useState(null);
  const [newMints, setNewMints] = useState(new Set());
  const [wsStatus, setWsStatus] = useState('connecting');
  const wsRef = useRef(null);
  const tokensRef = useRef([]);

  const solCoin = coins && coins.find(c => c.id === 'solana');
  const solPrice = solCoin ? solCoin.current_price : 150;

  const addOrUpdateToken = useCallback(token => {
    tokensRef.current = [token, ...tokensRef.current.filter(t => t.mint !== token.mint)].slice(0, 100);
    setTokens([...tokensRef.current]);
  }, []);

  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      try {
        ws = new WebSocket('wss://pumpportal.fun/api/data');
        wsRef.current = ws;

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
              image: data.image_uri || data.uri || null,
              marketCap: data.market_cap || data.usd_market_cap || 0,
              price: data.price || 0,
              bondingProgress: data.virtual_sol_reserves
                ? Math.min((data.virtual_sol_reserves / 85000) * 100, 100)
                : 0,
              graduated: data.complete || false,
              createdAt: data.created_timestamp || Date.now(),
              recentBuys: 0,
            };

            setNewMints(prev => {
              const next = new Set(prev);
              next.add(token.mint);
              setTimeout(() => {
                setNewMints(p => { const n = new Set(p); n.delete(token.mint); return n; });
              }, 5000);
              return next;
            });

            addOrUpdateToken(token);

            fetch('https://api.dexscreener.com/latest/dex/tokens/' + token.mint)
              .then(r => r.json())
              .then(d => {
                if (d.pairs && d.pairs.length > 0) {
                  const pair = d.pairs[0];
                  addOrUpdateToken({
                    ...token,
                    marketCap: pair.fdv || pair.marketCap || token.marketCap,
                    price: parseFloat(pair.priceUsd || 0),
                    graduated: pair.dexId !== 'pump',
                  });
                }
              })
              .catch(() => {});
          } catch (e) {}
        };

        ws.onerror = () => setWsStatus('error');

        ws.onclose = () => {
          setWsStatus('reconnecting');
          reconnectTimer = setTimeout(connect, 3000);
        };
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
        arr
          .filter(t => t.chainId === 'solana')
          .slice(0, 30)
          .forEach(t => {
            addOrUpdateToken({
              mint: t.tokenAddress,
              symbol: t.header || t.tokenAddress.slice(0, 6),
              name: t.description || t.header || 'Unknown',
              image: t.icon || null,
              marketCap: 0, price: 0, bondingProgress: 0,
              graduated: false, createdAt: Date.now(), recentBuys: 0,
            });
          });
      })
      .catch(() => {});

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [addOrUpdateToken]);

  const displayTokens = [...tokens].sort((a, b) =>
    tab === 'new'
      ? (b.createdAt || 0) - (a.createdAt || 0)
      : (b.recentBuys || 0) - (a.recentBuys || 0)
  );

  const openBuy = token => { setSelectedToken(token); setDrawerMode('buy'); setDrawerOpen(true); };
  const openSell = token => { setSelectedToken(token); setDrawerMode('sell'); setDrawerOpen(true); };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>New Launches</h1>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: wsStatus === 'live' ? 'rgba(0,255,163,.1)' : 'rgba(255,149,0,.1)',
            border: '1px solid ' + (wsStatus === 'live' ? 'rgba(0,255,163,.25)' : 'rgba(255,149,0,.25)'),
            borderRadius: 20, padding: '3px 10px',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: wsStatus === 'live' ? C.green : C.orange,
              animation: wsStatus === 'live' ? 'pulse 1.5s infinite' : 'none',
            }} />
            <span style={{ fontSize: 10, color: wsStatus === 'live' ? C.green : C.orange, fontWeight: 600 }}>
              {wsStatus === 'live' ? 'LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}
            </span>
          </div>
        </div>
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
          Solana tokens launching right now - {tokens.length} tracked
        </p>
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
          <div style={{ fontSize: 40, marginBottom: 12 }}>...</div>
          <div style={{ color: C.muted, fontSize: 14 }}>
            {wsStatus === 'live' ? 'Waiting for new launches...' : 'Connecting to live feed...'}
          </div>
        </div>
      ) : (
        <div>
          {displayTokens.map(token => (
            <TokenCard
              key={token.mint}
              token={token}
              onBuy={openBuy}
              onSell={openSell}
              solPrice={solPrice}
              isNew={newMints.has(token.mint)}
            />
          ))}
        </div>
      )}

      <TradeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mode={drawerMode}
        token={selectedToken}
        solPrice={solPrice}
        onConnectWallet={onConnectWallet}
        isConnected={isConnected}
        isSolanaConnected={isSolanaConnected}
      />
    </div>
  );
}
