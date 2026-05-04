import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { TradeDrawer } from './SwapWidget.jsx';

const JUP_API_KEY = process.env.REACT_APP_JUPITER_API_KEY1 || '';
const PRESET_KEY = 'nexus_launch_presets';
const LAST_AMT_KEY = 'nexus_launch_last_amt';

var _rpc = process.env.REACT_APP_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
var HELIUS_WS = _rpc.replace('https://', 'wss://').replace('http://', 'ws://');

// Programs we listen to
var PUMPFUN_PROGRAM  = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
var RAYDIUM_AMM_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

// Programs that may appear in instruction lists; we use these to identify
// which inner instruction creates the new mint.
var TOKEN_PROGRAM   = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
var TOKEN_2022      = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const C = {
 bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
 border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
 accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
 down: '#3b9eff', orange: '#ff9500', purple: '#9945ff',
 text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function loadCachedTokens() { try { var v = localStorage.getItem('nexus_launch_cache'); if (!v) return []; var p = JSON.parse(v); if (Date.now() - (p.ts || 0) > 300000) return []; return p.tokens || []; } catch (e) { return []; } }
function saveCachedTokens(t) { try { localStorage.setItem('nexus_launch_cache', JSON.stringify({ ts: Date.now(), tokens: t.slice(0, 30) })); } catch (e) {} }
function loadPresets() { try { var v = localStorage.getItem(PRESET_KEY); return v ? JSON.parse(v) : [5, 10, 25, 50, 100]; } catch (e) { return [5, 10, 25, 50, 100]; } }
function savePresets(arr) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(arr)); } catch (e) {} }
function loadLastAmt() { try { return parseFloat(localStorage.getItem(LAST_AMT_KEY) || '25') || 25; } catch (e) { return 25; } }
function saveLastAmt(v) { try { localStorage.setItem(LAST_AMT_KEY, String(v)); } catch (e) {} }

function timeAgo(ts) {
 if (!ts) return '';
 var diff = Math.floor((Date.now() - ts) / 1000);
 if (diff < 60) return diff + 's';
 if (diff < 3600) return Math.floor(diff / 60) + 'm';
 return Math.floor(diff / 3600) + 'h';
}
function fmtMc(n) {
 if (!n) return '-';
 if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
 if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
 if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
 return '$' + n.toFixed(0);
}
function fmtPrice(n) {
 if (!n || n === 0) return '-';
 if (n < 0.000001) return '$' + n.toExponential(2);
 if (n < 0.001) return '$' + n.toFixed(7);
 if (n < 1) return '$' + n.toFixed(4);
 return '$' + n.toFixed(2);
}
function fmtPct(n) { if (n == null || isNaN(n)) return null; return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }
function pctColor(n) { if (n == null) return C.muted2; return n >= 0 ? C.green : C.down; }

async function fetchGeckoTerminal(mints) {
 if (!mints || !mints.length) return {};
 try {
   var chunks = [];
   for (var i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
   var results = await Promise.all(chunks.map(function(chunk) {
     return fetch('https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/' + chunk.join(','))
       .then(function(r) { return r.json(); }).catch(function() { return { data: [] }; });
   }));
   var out = {};
   results.forEach(function(res) {
     if (!res.data) return;
     res.data.forEach(function(item) {
       var attrs = item.attributes;
       if (!attrs || !attrs.address) return;
       var price = parseFloat(attrs.price_usd || 0);
       var pChange = attrs.price_change_percentage || {};
       out[attrs.address] = {
         price: price, marketCap: parseFloat(attrs.fdv_usd || attrs.market_cap_usd || 0),
         pct5m: pChange.m5 ? parseFloat(pChange.m5) : null,
         pct1h: pChange.h1 ? parseFloat(pChange.h1) : null,
         pct24h: pChange.h24 ? parseFloat(pChange.h24) : null,
         volume24h: parseFloat((attrs.volume_usd && attrs.volume_usd.h24) || 0),
         buys24h: attrs.transactions && attrs.transactions.h24 ? attrs.transactions.h24.buys || 0 : 0,
         image: attrs.image_url || null, name: attrs.name || null, symbol: attrs.symbol || null,
         graduated: true, priceHistory: price > 0 ? [price] : [],
       };
     });
   });
   return out;
 } catch (e) { return {}; }
}

async function fetchDexScreener(mints) { return fetchGeckoTerminal(mints); }
async function fetchTokenData(mints) { return fetchGeckoTerminal(mints); }

// NL-1 fix: Extract the new token mint from a transaction's parsed
// instructions instead of grepping the log strings. Logs do NOT contain
// the mint address -- it's in the instruction's account keys.
//
// pump.fun "create" instruction: account index 0 is the new mint.
// Raydium "initialize2" instruction: account index 8 is the LP mint;
// account index 9 is the pool coin mint, index 10 is the pool pc mint.
// We want the SPL mint that's NOT WSOL.
async function extractMintFromTx(connection, signature, programWatched) {
 try {
   var tx = await connection.getTransaction(signature, {
     maxSupportedTransactionVersion: 0,
     commitment: 'confirmed',
   });
   if (!tx || !tx.transaction || !tx.transaction.message) return null;

   var msg = tx.transaction.message;
   // Resolve account keys: in v0 transactions ALTs may add to staticAccountKeys.
   // tx.meta.loadedAddresses gives us writable + readonly from ALTs.
   var keys = msg.staticAccountKeys
     ? msg.staticAccountKeys.map(function(k) { return k.toBase58 ? k.toBase58() : String(k); })
     : (msg.accountKeys || []).map(function(k) { return k.toBase58 ? k.toBase58() : String(k); });

   if (tx.meta && tx.meta.loadedAddresses) {
     var w = tx.meta.loadedAddresses.writable || [];
     var r = tx.meta.loadedAddresses.readonly || [];
     keys = keys.concat(w.map(function(k) { return k.toBase58 ? k.toBase58() : String(k); }))
                .concat(r.map(function(k) { return k.toBase58 ? k.toBase58() : String(k); }));
   }

   // Find instructions that target the program we're watching.
   var instructions = msg.compiledInstructions || msg.instructions || [];

   // Strategy: look at ALL instructions (both top-level and inner) for a
   // SPL token-program "InitializeMint" or "InitializeMint2" -- that's the
   // most reliable signal that this tx CREATED a new token. The first arg
   // of those instructions is the mint account (index 0 in the accounts).
   function checkInstruction(ix) {
     var pid = keys[ix.programIdIndex];
     if (pid !== TOKEN_PROGRAM && pid !== TOKEN_2022) return null;
     var data = ix.data;
     // SPL token instruction discriminator is the first byte.
     // 0  = InitializeMint
     // 20 = InitializeMint2
     // We accept both. data is a base58-encoded string in some encodings;
     // try to detect either way.
     var firstByte = null;
     if (typeof data === 'string') {
       // Solana getTransaction returns instruction data as a base58 string
       // (default encoding when not requesting jsonParsed). Decode the first
       // byte to inspect the SPL token instruction discriminator.
       try {
         firstByte = bs58.decode(data)[0];
       } catch (e) {
         // Some RPC paths return base64 instead -- try that as a fallback.
         try { firstByte = Uint8Array.from(atob(data), function(c) { return c.charCodeAt(0); })[0]; } catch (e2) {}
       }
     } else if (data && data.length) {
       firstByte = data[0];
     }
     if (firstByte === 0 || firstByte === 20) {
       // First account in the instruction is the mint
       var accountIndices = ix.accountKeyIndexes || ix.accounts || [];
       if (accountIndices.length > 0) {
         var mintKey = keys[accountIndices[0]];
         return mintKey || null;
       }
     }
     return null;
   }

   // Top-level instructions
   for (var i = 0; i < instructions.length; i++) {
     var found = checkInstruction(instructions[i]);
     if (found) return found;
   }

   // Inner instructions (CPIs) -- pump.fun creates the mint via CPI to token program
   if (tx.meta && tx.meta.innerInstructions) {
     for (var j = 0; j < tx.meta.innerInstructions.length; j++) {
       var inner = tx.meta.innerInstructions[j];
       var innerIxs = inner.instructions || [];
       for (var k = 0; k < innerIxs.length; k++) {
         var f = checkInstruction(innerIxs[k]);
         if (f) return f;
       }
     }
   }

   return null;
 } catch (e) {
   console.warn('extractMintFromTx failed:', e && e.message);
   return null;
 }
}

function Sparkline({ history, up }) {
 if (!history || history.length < 2) return <div style={{ width: 64, height: 28 }} />;
 var min = Math.min.apply(null, history), max = Math.max.apply(null, history);
 var range = max - min || min * 0.01 || 1;
 var w = 64, h = 28;
 var pts = history.map(function(v, i) {
   return ((i / (history.length - 1)) * w).toFixed(1) + ',' + (h - ((v - min) / range) * (h - 4) - 2).toFixed(1);
 }).join(' ');
 var color = up == null ? C.muted2 : up ? C.green : C.down;
 return <svg width={w} height={h} style={{ overflow: 'hidden', flexShrink: 0 }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function PresetEditor({ open, onClose, presets, onSave }) {
 const [vals, setVals] = useState(presets.map(String));
 useEffect(function() { if (open) setVals(presets.map(String)); }, [open, presets]);

 // Drawer correctness: body lock + Escape close.
 useEffect(function() {
   if (!open) return undefined;
   if (typeof document === 'undefined') return undefined;
   var prevOverflow = document.body.style.overflow;
   var prevTouch = document.body.style.touchAction;
   document.body.style.overflow = 'hidden';
   document.body.style.touchAction = 'none';
   function onKey(e) {
     if (e.key === 'Escape' || e.keyCode === 27) onClose();
   }
   window.addEventListener('keydown', onKey);
   return function() {
     document.body.style.overflow = prevOverflow || '';
     document.body.style.touchAction = prevTouch || '';
     window.removeEventListener('keydown', onKey);
   };
 }, [open, onClose]);

 if (!open) return null;
 return (
   <>
     <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.8)' }} />
     <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, padding: 24, width: '90vw', maxWidth: 360, boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
         <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>Edit Quick Buy Presets</div>
         <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 24, padding: 0, lineHeight: 1 }}>x</button>
       </div>
       <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
         {vals.map(function(v, i) {
           return (
             <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
               <span style={{ color: C.muted, fontSize: 12, width: 56, flexShrink: 0 }}>Slot {i + 1}</span>
               <div style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                 <span style={{ color: C.muted }}>$</span>
                 <input value={v} onChange={function(e) { var nv = e.target.value.replace(/[^0-9.]/g, ''); setVals(function(p) { var n = p.slice(); n[i] = nv; return n; }); }} style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, outline: 'none', width: '100%' }} />
               </div>
             </div>
           );
         })}
       </div>
       <div style={{ display: 'flex', gap: 10 }}>
         <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 10, background: C.card2, border: '1px solid ' + C.border, color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
         <button onClick={function() { var parsed = vals.map(function(v) { return parseFloat(v) || 0; }).filter(function(v) { return v > 0; }); while (parsed.length < 5) parsed.push(25); onSave(parsed.slice(0, 5)); onClose(); }} style={{ flex: 2, padding: 12, borderRadius: 10, background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>Save Presets</button>
       </div>
     </div>
   </>
 );
}

function LaunchTradeDrawer({ open, onClose, mode, token, solPrice, onConnectWallet, isConnected, coins, jupiterTokens, presets, onPresetsChange }) {
 var isGrad = token && token.graduated;

 if (isGrad) {
   var coin = token ? {
     mint: token.mint, symbol: token.symbol, name: token.name,
     image: token.image, decimals: token.decimals || 6,
     chain: 'solana', isSolanaToken: true,
   } : null;
   return (
     <TradeDrawer
       open={open} onClose={onClose} mode={mode} coin={coin}
       jupiterTokens={jupiterTokens} coins={coins}
       onConnectWallet={onConnectWallet} isConnected={isConnected}
     />
   );
 }

 return (
   <PumpDrawer
     open={open} onClose={onClose} mode={mode} token={token}
     solPrice={solPrice} onConnectWallet={onConnectWallet} isConnected={isConnected}
     presets={presets} onPresetsChange={onPresetsChange}
   />
 );
}

function PumpDrawer({ open, onClose, mode, token, solPrice, onConnectWallet, isConnected, presets, onPresetsChange }) {
 const { publicKey, sendTransaction, connected: solConnected } = useWallet();
 const { connection } = useConnection();
 const walletConnected = solConnected;

 const [activePreset, setActivePreset] = useState(null);
 const [customAmt, setCustomAmt] = useState('');
 const [sellPct, setSellPct] = useState(50);
 const [customSellAmt, setCustomSellAmt] = useState('');
 const [solBalance, setSolBalance] = useState(null);
 const [tokenBalance, setTokenBalance] = useState(null);
 const [antiMev, setAntiMev] = useState(true);
 const [status, setStatus] = useState('idle');
 const [txSig, setTxSig] = useState(null);
 const [error, setError] = useState('');
 const [presetEditorOpen, setPresetEditorOpen] = useState(false);

 const BASE_FEE = 0.04;
 const ANTIMEV_FEE = 0.02;
 var totalFeeRate = BASE_FEE + (antiMev ? ANTIMEV_FEE : 0);

 // Drawer correctness: body scroll lock while open + Escape closes.
 useEffect(function() {
   if (!open) return undefined;
   if (typeof document === 'undefined') return undefined;
   var prevOverflow = document.body.style.overflow;
   var prevTouch = document.body.style.touchAction;
   document.body.style.overflow = 'hidden';
   document.body.style.touchAction = 'none';
   function onKey(e) {
     if ((e.key === 'Escape' || e.keyCode === 27) && status !== 'loading') onClose();
   }
   window.addEventListener('keydown', onKey);
   return function() {
     document.body.style.overflow = prevOverflow || '';
     document.body.style.touchAction = prevTouch || '';
     window.removeEventListener('keydown', onKey);
   };
 }, [open, status, onClose]);

 useEffect(function() {
   if (!publicKey || !connection || !open) { setSolBalance(null); setTokenBalance(null); return; }
   connection.getBalance(publicKey).then(function(lam) { setSolBalance(lam / 1e9); }).catch(function() {});
   if (token && token.mint) {
     connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(token.mint) })
       .then(function(accts) { setTokenBalance(accts.value.length > 0 ? accts.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0); })
       .catch(function() {});
   }
 }, [publicKey, connection, token, open]);

 useEffect(function() {
   if (open) {
     var last = loadLastAmt();
     var match = presets.find(function(p) { return p === last; });
     if (match) { setActivePreset(last); setCustomAmt(''); } else { setActivePreset(null); setCustomAmt(String(last)); }
     setStatus('idle'); setTxSig(null); setError(''); setCustomSellAmt('');
   }
 }, [open, presets]);

 var activeDollar = parseFloat(customAmt) || activePreset || loadLastAmt();
 var solAmt = solPrice > 0 ? activeDollar / solPrice : 0;

 var executeTrade = async function() {
   if (!walletConnected) { if (onConnectWallet) onConnectWallet(); return; }
   if (!publicKey || !token) return;
   setStatus('loading'); setError('');
   try {
     var _solBal = (await connection.getBalance(publicKey)) / 1e9;
     if (_solBal < 0.003) { setError('Need at least 0.003 SOL.'); setStatus('error'); setTimeout(function() { setStatus('idle'); setError(''); }, 5000); return; }

     var sellAmount = customSellAmt
       ? parseFloat(customSellAmt)
       : (sellPct / 100 * (tokenBalance || 0));

     var res = await fetch('https://pumpportal.fun/api/trade-local', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         publicKey: publicKey.toString(),
         action: mode,
         mint: token.mint,
         denominatedInSol: mode === 'buy' ? 'true' : 'false',
         amount: mode === 'buy' ? parseFloat(solAmt.toFixed(6)) : sellAmount,
         slippage: 15,
         priorityFee: antiMev ? 0.001 : 0.0001,
         pool: 'auto',
       }),
     });
     if (!res.ok) throw new Error('PumpPortal error ' + res.status);
     var txBytes = await res.arrayBuffer();
     var tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
     var sig = await sendTransaction(tx, connection);
     await connection.confirmTransaction(sig, 'confirmed');
     setTxSig(sig);
     saveLastAmt(activeDollar);
     setStatus('success');
     setTimeout(function() { setStatus('idle'); setTxSig(null); onClose(); }, 3000);
   } catch (e) {
     console.error('Trade error:', e); setError(e.message || 'Trade failed'); setStatus('error');
     setTimeout(function() { setStatus('idle'); setError(''); }, 4000);
   }
 };

 if (!open || !token) return null;
 var isBuy = mode === 'buy';

 return (
   <>
     <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
     <div style={{
       position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
       width: '100%', maxWidth: 560, zIndex: 401,
       background: C.card, borderTop: '2px solid ' + C.borderHi,
       borderRadius: '20px 20px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
       maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
     }}>
       <div style={{ flexShrink: 0, padding: '16px 20px 14px' }}>
         <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 16px' }} />
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
             {token.image ? <img src={token.image} alt={token.symbol} style={{ width: 38, height: 38, borderRadius: 10 }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: C.purple, fontSize: 16 }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>}
             <div>
               <div style={{ color: isBuy ? C.accent : C.red, fontWeight: 800, fontSize: 18 }}>{isBuy ? 'Buy' : 'Sell'} {token.symbol}</div>
               <div style={{ color: C.muted, fontSize: 11 }}>Pump.fun - {(totalFeeRate * 100).toFixed(0)}% fee</div>
             </div>
           </div>
           <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>x</button>
         </div>
       </div>
       <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>

         <div style={{ background: C.card2, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <span style={{ color: C.muted, fontSize: 12 }}>Current price</span>
             <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
               <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{token.price > 0 ? fmtPrice(token.price) : 'Loading...'}</span>
               {token.pct1h != null && <span style={{ fontSize: 11, fontWeight: 700, color: pctColor(token.pct1h), background: token.pct1h >= 0 ? 'rgba(0,255,163,.1)' : 'rgba(59,158,255,.1)', padding: '2px 7px', borderRadius: 6 }}>{fmtPct(token.pct1h)} 1h</span>}
             </div>
           </div>
           {isBuy && token.price > 0 && activeDollar > 0 && (
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, marginTop: 8, borderTop: '1px solid rgba(255,255,255,.05)' }}>
               <span style={{ color: C.muted, fontSize: 12 }}>You receive approx</span>
               <span style={{ color: C.green, fontWeight: 800, fontSize: 14 }}>{((activeDollar * (1 - totalFeeRate)) / token.price).toLocaleString('en-US', { maximumFractionDigits: 0 })} {token.symbol}</span>
             </div>
           )}
         </div>

         {!walletConnected && (
           <div style={{ marginBottom: 14, padding: 14, background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
             <span style={{ color: C.muted, fontSize: 13 }}>Connect wallet to trade</span>
             <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
           </div>
         )}

         {isBuy ? (
           <div style={{ marginBottom: 14 }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
               <div>
                 <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>QUICK BUY</span>
                 {solBalance != null && <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>SOL: <span style={{ color: C.text }}>{solBalance.toFixed(4)}</span></span>}
               </div>
               <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                 {solBalance != null && solBalance > 0.01 && <button onClick={function() { setCustomAmt((Math.max(0, solBalance - 0.005) * solPrice).toFixed(2)); setActivePreset(null); }} style={{ background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)', borderRadius: 6, padding: '2px 8px', color: C.accent, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>MAX</button>}
                 <button onClick={function() { setPresetEditorOpen(true); }} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, padding: 0 }}>Edit presets</button>
               </div>
             </div>
             <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
               {presets.map(function(amt) {
                 var active = activePreset === amt && !customAmt;
                 return <button key={amt} onClick={function() { setActivePreset(amt); setCustomAmt(''); }} style={{ flex: 1, padding: '11px 2px', borderRadius: 10, border: '1px solid ' + (active ? C.accent : C.border), background: active ? 'rgba(0,229,255,.15)' : C.card2, color: active ? C.accent : C.muted, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>${amt}</button>;
               })}
             </div>
             <div style={{ background: C.card2, border: '1px solid ' + (customAmt ? C.accent : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
               <span style={{ color: C.muted, fontSize: 20 }}>$</span>
               <input value={customAmt} onChange={function(e) { setCustomAmt(e.target.value.replace(/[^0-9.]/g, '')); setActivePreset(null); }} placeholder="Custom Amount" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 20, fontWeight: 700, color: '#fff', outline: 'none' }} />
               {solPrice > 0 && activeDollar > 0 && <span style={{ color: C.muted, fontSize: 11, flexShrink: 0 }}>{(activeDollar / solPrice).toFixed(3)} SOL</span>}
             </div>
           </div>
         ) : (
           <div style={{ marginBottom: 14 }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
               <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>SELL AMOUNT</span>
               {tokenBalance != null && <span style={{ fontSize: 10, color: C.muted }}>{token.symbol}: <span style={{ color: C.text }}>{tokenBalance >= 1000 ? tokenBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : tokenBalance.toFixed(4)}</span></span>}
             </div>
             <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
               {[25, 50, 75, 100].map(function(p) {
                 return <button key={p} onClick={function() { setSellPct(p); setCustomSellAmt(''); }} style={{ flex: 1, padding: '11px 2px', borderRadius: 10, border: '1px solid ' + (sellPct === p && !customSellAmt ? C.red : C.border), background: sellPct === p && !customSellAmt ? 'rgba(255,59,107,.15)' : C.card2, color: sellPct === p && !customSellAmt ? C.red : C.muted, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>{p === 100 ? 'MAX' : p + '%'}</button>;
               })}
             </div>
             <div style={{ background: C.card2, border: '1px solid ' + (customSellAmt ? C.red : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
               <input value={customSellAmt} onChange={function(e) { setCustomSellAmt(e.target.value.replace(/[^0-9.]/g, '')); setSellPct(null); }} placeholder="Custom Amount" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 20, fontWeight: 700, color: '#fff', outline: 'none' }} />
               <span style={{ color: C.muted, fontSize: 13, flexShrink: 0 }}>{token.symbol}</span>
               {tokenBalance != null && tokenBalance > 0 && <button onClick={function() { setCustomSellAmt(tokenBalance.toFixed(6)); setSellPct(null); }} style={{ background: 'rgba(255,59,107,.12)', border: '1px solid rgba(255,59,107,.25)', borderRadius: 6, padding: '4px 8px', color: C.red, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>MAX</button>}
             </div>
             {token.price > 0 && customSellAmt && parseFloat(customSellAmt) > 0 && (
               <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>&asymp; ${(parseFloat(customSellAmt) * token.price).toFixed(4)}</div>
             )}
           </div>
         )}

         <div style={{ background: '#050912', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <div>
             <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SNIPER PROTECTION</span>
             <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>{antiMev ? 'ON - bot protected (+2%)' : 'OFF - saves 2%'}</div>
           </div>
           <button onClick={function() { setAntiMev(!antiMev); }} style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: antiMev ? C.accent : C.muted2, position: 'relative', flexShrink: 0 }}>
             <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: antiMev ? 23 : 3, transition: 'left .2s' }} />
           </button>
         </div>

         {error && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>}

         <button onClick={executeTrade} disabled={status === 'loading'} style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : status === 'error' ? 'rgba(255,59,107,.2)' : !walletConnected ? 'linear-gradient(135deg,#9945ff,#7c3aed)' : isBuy ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'linear-gradient(135deg,#ff3b6b,#cc1144)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 17, cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 54 }}>
           {!walletConnected ? 'Connect Wallet' : status === 'loading' ? 'Confirming...' : status === 'success' ? (isBuy ? 'Bought!' : 'Sold!') : status === 'error' ? 'Failed - Try Again' : isBuy ? 'Buy $' + activeDollar.toFixed(2) + ' of ' + token.symbol : 'Sell ' + (customSellAmt || sellPct + '%') + ' ' + token.symbol}
         </button>

         {txSig && status === 'success' && <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>View on Solscan</a>}
         <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 10, lineHeight: 1.6 }}>Non-custodial &mdash; Fees go directly to Nexus DEX</p>
       </div>
       <PresetEditor open={presetEditorOpen} onClose={function() { setPresetEditorOpen(false); }} presets={presets} onSave={onPresetsChange} />
     </div>
   </>
 );
}

function TokenPage({ token, onBack, onConnectWallet, isConnected, solPrice, coins, jupiterTokens, presets, onPresetsChange }) {
 const [liveData, setLiveData] = useState(null);
 const [drawerOpen, setDrawerOpen] = useState(false);
 const [drawerMode, setDrawerMode] = useState('buy');
 const [loading, setLoading] = useState(true);

 useEffect(function() {
   if (!token) return;
   setLoading(true);
   fetchGeckoTerminal([token.mint]).then(function(d) { if (d[token.mint]) setLiveData(d[token.mint]); setLoading(false); });
   var interval = setInterval(function() { fetchGeckoTerminal([token.mint]).then(function(d) { if (d[token.mint]) setLiveData(d[token.mint]); }); }, 10000);
   return function() { clearInterval(interval); };
 }, [token]);

 if (!token) return null;
 var price = (liveData && liveData.price) || token.price || 0;
 var marketCap = (liveData && liveData.marketCap) || token.marketCap || 0;
 var pct5m = liveData ? liveData.pct5m : token.pct5m;
 var pct1h = liveData ? liveData.pct1h : token.pct1h;
 var pct24h = liveData ? liveData.pct24h : token.pct24h;
 var volume = (liveData && liveData.volume24h) || token.volume24h || 0;
 var buys = (liveData && liveData.buys24h) || 0;
 var isGrad = (liveData && liveData.graduated) || token.graduated || (token.bondingProgress || 0) >= 100;
 var progress = token.bondingProgress || 0;
 var history = token.priceHistory || [];
 var sparkUp = pct1h != null ? pct1h >= 0 : null;
 var fullToken = Object.assign({}, token, liveData || {}, { graduated: isGrad, price: price });

 return (
   <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
     <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>
         &lt;- Back to Launches
     </button>

     <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
           {token.image ? <img src={token.image} alt={token.symbol} style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover' }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: C.purple }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>}
           <div>
             <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
               <span style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{token.symbol}</span>
               {isGrad ? <span style={{ background: 'rgba(0,255,163,.12)', color: C.green, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>GRADUATED</span> : <span style={{ background: 'rgba(153,69,255,.12)', color: C.purple, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>PUMP.FUN</span>}
             </div>
             <div style={{ color: C.muted, fontSize: 12 }}>{token.name}</div>
           </div>
         </div>
         <div style={{ textAlign: 'right' }}>
           <div style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>{loading && !price ? '...' : fmtPrice(price)}</div>
           {pct1h != null && <div style={{ fontSize: 13, fontWeight: 700, color: pctColor(pct1h), marginTop: 3 }}>{fmtPct(pct1h)} 1h</div>}
         </div>
       </div>

       {history.length >= 2 && (
         <div style={{ marginBottom: 14, background: C.card2, borderRadius: 12, padding: '10px 14px' }}>
           <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, fontWeight: 700, letterSpacing: 1 }}>PRICE CHART (live)</div>
           <svg width="100%" height="56" viewBox="0 0 400 56" preserveAspectRatio="none" style={{ display: 'block' }}>
             {(function() {
               var min = Math.min.apply(null, history), max = Math.max.apply(null, history);
               var range = max - min || min * 0.01 || 1;
               var pts = history.map(function(v, i) { var x = (i / (history.length - 1)) * 400; var y = 52 - ((v - min) / range) * 46; return x.toFixed(1) + ',' + y.toFixed(1); }).join(' ');
               var col = sparkUp == null ? C.accent : sparkUp ? C.green : C.down;
               return <g><polyline points={pts + ' 400,56 0,56'} fill={col + '22'} stroke="none" /><polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g>;
             })()}
           </svg>
         </div>
       )}

       <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
         {[['5m', pct5m], ['1h', pct1h], ['24h', pct24h]].map(function(item) {
           var val = item[1];
           return (
             <div key={item[0]} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
               <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{item[0]}</div>
               <div style={{ fontSize: 15, fontWeight: 700, color: pctColor(val) }}>{val == null ? (loading ? '...' : '--') : fmtPct(val)}</div>
             </div>
           );
         })}
       </div>

       <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
         {[['Market Cap', fmtMc(marketCap)], ['Volume 24h', fmtMc(volume)], ['Buys 24h', buys > 0 ? buys.toLocaleString() : '--'], ['Age', timeAgo(token.createdAt) + ' ago']].map(function(item) {
           return (
             <div key={item[0]} style={{ background: C.card2, borderRadius: 10, padding: 12 }}>
               <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>{item[0]}</div>
               <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{item[1]}</div>
             </div>
           );
         })}
       </div>

       {!isGrad && progress > 0 && (
         <div style={{ marginBottom: 14 }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
             <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>BONDING CURVE</span>
             <span style={{ fontSize: 11, color: progress > 75 ? C.orange : C.muted, fontWeight: 700 }}>{progress.toFixed(1)}%</span>
           </div>
           <div style={{ height: 8, background: C.card3, borderRadius: 4, overflow: 'hidden' }}>
             <div style={{ height: '100%', borderRadius: 4, width: Math.min(progress, 100) + '%', background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)' }} />
           </div>
           {progress >= 80 && <div style={{ marginTop: 5, fontSize: 10, color: C.orange }}>Almost to Raydium &mdash; {(100 - progress).toFixed(1)}% left</div>}
         </div>
       )}

       <div style={{ background: C.card3, borderRadius: 10, padding: '8px 12px' }}>
         <div style={{ fontSize: 9, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>CONTRACT</div>
         <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all' }}>{token.mint}</div>
       </div>
     </div>

     <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
       <button onClick={function() { setDrawerMode('buy'); setDrawerOpen(true); }} style={{ padding: '18px 10px', borderRadius: 16, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>Buy {token.symbol}</button>
       <button onClick={function() { setDrawerMode('sell'); setDrawerOpen(true); }} style={{ padding: '18px 10px', borderRadius: 16, cursor: 'pointer', background: 'rgba(255,59,107,.1)', border: '1.5px solid rgba(255,59,107,.4)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>Sell {token.symbol}</button>
     </div>

     <LaunchTradeDrawer
       open={drawerOpen} onClose={function() { setDrawerOpen(false); }}
       mode={drawerMode} token={fullToken} solPrice={solPrice}
       onConnectWallet={onConnectWallet} isConnected={isConnected}
       coins={coins} jupiterTokens={jupiterTokens}
       presets={presets} onPresetsChange={onPresetsChange}
     />
   </div>
 );
}

function TokenCard({ token, onCardClick, onBuyClick, onSellClick, isNew }) {
 const [flash, setFlash] = useState(false);
 useEffect(function() {
   if (isNew) { setFlash(true); var t = setTimeout(function() { setFlash(false); }, 5000); return function() { clearTimeout(t); }; }
 }, [isNew]);

 var progress = token.bondingProgress || 0;
 var isGrad = token.graduated || progress >= 100;
 var pct = token.pct1h != null ? token.pct1h : token.pct5m != null ? token.pct5m : null;
 var pctLabel = token.pct1h != null ? '1h' : '5m';

 return (
   <div style={{ background: flash ? 'rgba(0,255,163,0.04)' : C.card, border: '1px solid ' + (flash ? 'rgba(0,255,163,.2)' : C.border), borderRadius: 14, padding: '12px 14px', marginBottom: 10, transition: 'background 0.8s, border 0.8s', width: '100%', boxSizing: 'border-box' }}>
     <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 10 }} onClick={function() { onCardClick(token); }}>
       <div style={{ position: 'relative', flexShrink: 0 }}>
         {token.image ? <img src={token.image} alt={token.symbol} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(153,69,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: C.purple }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>}
         {flash && <div style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: C.green, boxShadow: '0 0 8px ' + C.green }} />}
       </div>
       <div style={{ flex: 1, minWidth: 0 }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
           <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>{token.symbol || '???'}</span>
           {isGrad ? <span style={{ background: 'rgba(0,255,163,.1)', color: C.green, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>GRAD</span> : <span style={{ background: 'rgba(153,69,255,.1)', color: C.purple, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>PUMP</span>}
           {flash && <span style={{ fontSize: 9, color: C.green, fontWeight: 700 }}>NEW</span>}
         </div>
         <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
           {token.price > 0 && <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{fmtPrice(token.price)}</span>}
           {token.marketCap > 0 && <span style={{ fontSize: 11, color: C.muted }}>{fmtMc(token.marketCap)}</span>}
           <span style={{ fontSize: 10, color: C.muted2 }}>{timeAgo(token.createdAt)}</span>
           {token.buys24h > 0 && <span style={{ fontSize: 10, color: C.orange }}>{token.buys24h} buys</span>}
         </div>
         {!isGrad && progress > 0 && (
           <div style={{ marginTop: 5, height: 3, background: C.card3, borderRadius: 2, overflow: 'hidden' }}>
             <div style={{ height: '100%', borderRadius: 2, width: Math.min(progress, 100) + '%', background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)' }} />
           </div>
         )}
       </div>
       <div style={{ flexShrink: 0 }}>
         {pct != null ? (
           <div style={{ background: pct >= 0 ? 'rgba(0,255,163,.12)' : 'rgba(59,158,255,.12)', border: '1px solid ' + (pct >= 0 ? 'rgba(0,255,163,.25)' : 'rgba(59,158,255,.25)'), borderRadius: 8, padding: '5px 10px', textAlign: 'center' }}>
             <div style={{ fontSize: 14, fontWeight: 800, color: pctColor(pct) }}>{fmtPct(pct)}</div>
             <div style={{ fontSize: 9, color: C.muted2, marginTop: 1 }}>{pctLabel}</div>
           </div>
         ) : (
           <div style={{ fontSize: 11, color: C.muted2 }}>-</div>
         )}
       </div>
     </div>
     <div style={{ display: 'flex', gap: 8 }}>
       <button onClick={function(e) { e.stopPropagation(); onBuyClick(token); }} style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontWeight: 800, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Buy</button>
       <button onClick={function(e) { e.stopPropagation(); onSellClick(token); }} style={{ flex: 1, padding: '11px', borderRadius: 10, cursor: 'pointer', background: 'rgba(255,59,107,.1)', border: '1.5px solid rgba(255,59,107,.35)', color: C.red, fontWeight: 800, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Sell</button>
     </div>
   </div>
 );
}

export default function NewLaunches({ coins, jupiterTokens, onConnectWallet, isConnected, isSolanaConnected, walletAddress, resetKey }) {
 const { connection } = useConnection();
 const [tokens, setTokens] = useState([]);
 const [tab, setTab] = useState('new');
 const [selectedToken, setSelectedToken] = useState(null);
 const [drawerOpen, setDrawerOpen] = useState(false);
 const [drawerMode, setDrawerMode] = useState('buy');
 const [drawerToken, setDrawerToken] = useState(null);
 const [newMints, setNewMints] = useState(new Set());
 const [wsStatus, setWsStatus] = useState('connecting');
 const [presets, setPresets] = useState(loadPresets());
 const tokensRef = useRef([]);
 const dexQueueRef = useRef([]);
 const dexTimerRef = useRef(null);
 const refreshTimerRef = useRef(null);
 const seenSigsRef = useRef(new Set());

 var solCoin = coins && coins.find(function(c) { return c.id === 'solana'; });
 var solPrice = solCoin ? solCoin.current_price : 150;

 useEffect(function() { setSelectedToken(null); }, [resetKey]);

 var handlePresetsChange = function(p) { setPresets(p); savePresets(p); };

 var updateTokenDexData = useCallback(function(dexData) {
   var updated = false;
   tokensRef.current = tokensRef.current.map(function(t) {
     var d = dexData[t.mint];
     if (!d) return t;
     updated = true;
     var newPrice = d.price || t.price;
     var prevHistory = t.priceHistory || [];
     var newHistory = newPrice > 0 ? prevHistory.concat([newPrice]).slice(-30) : prevHistory;
     var pct1h = null, pct5m = null;
     if (newHistory.length >= 2) {
       var first = newHistory[0], last = newHistory[newHistory.length - 1];
       if (first > 0) pct1h = ((last - first) / first) * 100;
       if (newHistory.length >= 4) { var older = newHistory[newHistory.length - 4]; if (older > 0) pct5m = ((last - older) / older) * 100; }
     }
     return Object.assign({}, t, d, { priceHistory: newHistory, pct1h: d.pct1h != null ? d.pct1h : pct1h, pct5m: d.pct5m != null ? d.pct5m : pct5m });
   });
   if (updated) setTokens([].concat(tokensRef.current));
 }, []);

 var queueDexFetch = useCallback(function(mint) {
   if (!dexQueueRef.current.includes(mint)) dexQueueRef.current.push(mint);
   if (dexTimerRef.current) clearTimeout(dexTimerRef.current);
   dexTimerRef.current = setTimeout(async function() {
     var batch = dexQueueRef.current.splice(0, 30);
     if (!batch.length) return;
     var data = await fetchTokenData(batch);
     updateTokenDexData(data);
   }, 100);
 }, [updateTokenDexData]);

 var addToken = useCallback(function(token) {
   tokensRef.current = [token].concat(tokensRef.current.filter(function(t) { return t.mint !== token.mint; })).slice(0, 150);
   setTokens([].concat(tokensRef.current));
   fetchGeckoTerminal([token.mint]).then(function(data) {
     var d = data[token.mint];
     if (!d) return;
     tokensRef.current = tokensRef.current.map(function(t) {
       if (t.mint !== token.mint) return t;
       return Object.assign({}, t, d, { priceHistory: d.price > 0 ? [d.price] : [] });
     });
     setTokens([].concat(tokensRef.current));
   });
   queueDexFetch(token.mint);
 }, [queueDexFetch]);

 useEffect(function() {
   var ws;
   var reconnectTimer = null;     // NL-6 fix: track and clear before re-set
   var alive = true;
   // Track every per-message setTimeout we schedule (mint-extraction delays
   // and the new-mint flash timers) so cleanup clears them all. Without
   // this, ~50 logs landing right before unmount produce ~50 orphan timers
   // that each fire setState on the unmounted component (React warning
   // + stale closure work that's never seen).
   var pendingTimers = new Set();
   function track(t) { pendingTimers.add(t); return t; }

   function scheduleReconnect(delayMs) {
     if (!alive) return;
     if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
     reconnectTimer = setTimeout(function() { reconnectTimer = null; if (alive) connect(); }, delayMs);
   }

   function connect() {
     try {
       ws = new WebSocket(HELIUS_WS);
       ws.onopen = function() {
         setWsStatus('live');
         ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [PUMPFUN_PROGRAM] }, { commitment: 'processed' }] }));
         ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'logsSubscribe', params: [{ mentions: [RAYDIUM_AMM_PROGRAM] }, { commitment: 'processed' }] }));
       };
       ws.onmessage = async function(event) {
         try {
           var msg = JSON.parse(event.data);
           if (!msg.params || !msg.params.result) return;
           var result = msg.params.result;
           var sig = result.value && result.value.signature;
           if (!sig) return;

           // De-duplicate signatures we've already processed.
           if (seenSigsRef.current.has(sig)) return;
           seenSigsRef.current.add(sig);
           // Cap the set so it doesn't grow unbounded.
           if (seenSigsRef.current.size > 1000) {
             var first = seenSigsRef.current.values().next().value;
             seenSigsRef.current.delete(first);
           }

           // Skip failed transactions
           if (result.value.err) return;

           // NL-1 fix: extract the actual mint from the parsed transaction
           // instead of grepping log strings (which don't contain it).
           // We delay 800ms so the tx has time to be retrievable via RPC.
           var t1 = setTimeout(async function() {
             pendingTimers.delete(t1);
             if (!alive) return;
             var mintAddr = await extractMintFromTx(connection, sig, null);
             if (!alive || !mintAddr) return;
             if (tokensRef.current.find(function(t) { return t.mint === mintAddr; })) return;

             var token = {
               mint: mintAddr,
               symbol: mintAddr.slice(0, 4).toUpperCase(),
               name: 'Loading...',
               image: null, marketCap: 0, price: 0,
               pct5m: null, pct1h: null, pct24h: null,
               volume24h: 0, buys24h: 0, priceHistory: [],
               bondingProgress: 0, graduated: false,
               createdAt: Date.now(),
             };
             setNewMints(function(prev) {
               var next = new Set(prev); next.add(mintAddr);
               var t2 = setTimeout(function() {
                 pendingTimers.delete(t2);
                 if (!alive) return;
                 setNewMints(function(p) { var n = new Set(p); n.delete(mintAddr); return n; });
               }, 6000);
               track(t2);
               return next;
             });
             addToken(token);
           }, 800);
           track(t1);
         } catch (e) {}
       };
       ws.onerror = function() { setWsStatus('error'); };
       ws.onclose = function() { setWsStatus('reconnecting'); scheduleReconnect(3000); };
     } catch (e) {
       setWsStatus('error');
       scheduleReconnect(5000);
     }
   }

   connect();

   var cached = loadCachedTokens();
   if (cached.length > 0) { tokensRef.current = cached; setTokens([].concat(cached)); }

   refreshTimerRef.current = setInterval(async function() {
     if (!alive) return;
     var mints = tokensRef.current.slice(0, 30).map(function(t) { return t.mint; });
     if (!mints.length) return;
     var data = await fetchDexScreener(mints);
     if (!alive) return;        // guard against unmount during in-flight fetch
     updateTokenDexData(data);
     saveCachedTokens(tokensRef.current);
   }, 15000);

   var loadInitial = async function() {
     try {
       var res = await fetch('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1');
       if (!alive) return;
       var data = await res.json();
       if (!alive) return;
       var pools = (data.data || []).slice(0, 30);
       if (!pools.length) return;
       var initialTokens = pools.map(function(pool) {
         var attrs = pool.attributes || {};
         var pChange = attrs.price_change_percentage || {};
         var txns = attrs.transactions || {};
         var price = parseFloat(attrs.base_token_price_usd || 0);
         var mintAddr = pool.relationships && pool.relationships.base_token && pool.relationships.base_token.data && pool.relationships.base_token.data.id;
         mintAddr = mintAddr ? mintAddr.replace('solana_', '') : null;
         if (!mintAddr) return null;
         return { mint: mintAddr, symbol: attrs.name ? attrs.name.split('/')[0] : '???', name: attrs.name ? attrs.name.split('/')[0] : 'Unknown', image: null, marketCap: parseFloat(attrs.fdv_usd || attrs.market_cap_usd || 0), price: price, pct5m: pChange.m5 ? parseFloat(pChange.m5) : null, pct1h: pChange.h1 ? parseFloat(pChange.h1) : null, pct24h: pChange.h24 ? parseFloat(pChange.h24) : null, volume24h: parseFloat((attrs.volume_usd && attrs.volume_usd.h24) || 0), buys24h: txns.h24 ? txns.h24.buys || 0 : 0, priceHistory: price > 0 ? [price] : [], bondingProgress: 0, graduated: false, createdAt: attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : Date.now() };
       }).filter(Boolean);
       tokensRef.current = initialTokens;
       setTokens([].concat(tokensRef.current));
       saveCachedTokens(tokensRef.current);
       fetchGeckoTerminal(initialTokens.map(function(t) { return t.mint; })).then(function(gtData) {
         if (!alive) return;
         tokensRef.current = tokensRef.current.map(function(t) {
           var d = gtData[t.mint];
           if (!d) return t;
           return Object.assign({}, t, { image: d.image || t.image, name: d.name || t.name, symbol: d.symbol || t.symbol, price: d.price || t.price, marketCap: d.marketCap || t.marketCap, pct5m: d.pct5m !== null ? d.pct5m : t.pct5m, pct1h: d.pct1h !== null ? d.pct1h : t.pct1h, pct24h: d.pct24h !== null ? d.pct24h : t.pct24h });
         });
         setTokens([].concat(tokensRef.current));
         saveCachedTokens(tokensRef.current);
       });
     } catch (e) {}
   };
   loadInitial();

   return function() {
     alive = false;
     if (reconnectTimer) clearTimeout(reconnectTimer);
     if (dexTimerRef.current) clearTimeout(dexTimerRef.current);
     if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
     // Clear all pending per-message timers -- prevents orphan setState calls
     pendingTimers.forEach(function(t) { try { clearTimeout(t); } catch (e) {} });
     pendingTimers.clear();
     if (ws) {
       try { ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); } catch (e) {}
     }
   };
 }, [addToken, updateTokenDexData, connection]);

 var displayTokens = tokens.slice().sort(function(a, b) {
   if (tab === 'new') return (b.createdAt || 0) - (a.createdAt || 0);
   var scoreA = (a.volume24h || 0) + (a.buys24h || 0) * 10 + Math.abs(a.pct1h || a.pct5m || 0) * 100;
   var scoreB = (b.volume24h || 0) + (b.buys24h || 0) * 10 + Math.abs(b.pct1h || b.pct5m || 0) * 100;
   return scoreB - scoreA;
 });

 var openBuyDrawer = function(token) { setDrawerToken(token); setDrawerMode('buy'); setDrawerOpen(true); };
 var openSellDrawer = function(token) { setDrawerToken(token); setDrawerMode('sell'); setDrawerOpen(true); };

 if (selectedToken) {
   return <TokenPage token={selectedToken} onBack={function() { setSelectedToken(null); }} onConnectWallet={onConnectWallet} isConnected={isConnected} solPrice={solPrice} coins={coins} jupiterTokens={jupiterTokens} presets={presets} onPresetsChange={handlePresetsChange} />;
 }

 return (
   <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
     <style>{`@keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }`}</style>
     <div style={{ marginBottom: 18 }}>
       <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
         <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>New Launches</h1>
         <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: wsStatus === 'live' ? 'rgba(0,255,163,.08)' : 'rgba(255,149,0,.08)', border: '1px solid ' + (wsStatus === 'live' ? 'rgba(0,255,163,.2)' : 'rgba(255,149,0,.2)'), borderRadius: 20, padding: '3px 10px' }}>
           <div style={{ width: 6, height: 6, borderRadius: '50%', background: wsStatus === 'live' ? C.green : C.orange, animation: wsStatus === 'live' ? 'pulse 1.5s infinite' : 'none' }} />
           <span style={{ fontSize: 10, color: wsStatus === 'live' ? C.green : C.orange, fontWeight: 600 }}>{wsStatus === 'live' ? 'LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}</span>
         </div>
       </div>
       <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{tokens.length} tokens tracked - tap any to trade</p>
     </div>

     <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
       <button onClick={function() { setTab('new'); }} style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tab === 'new' ? 'rgba(0,229,255,.1)' : C.card2, border: '1px solid ' + (tab === 'new' ? 'rgba(0,229,255,.3)' : C.border), color: tab === 'new' ? C.accent : C.muted }}>New</button>
       <button onClick={function() { setTab('trending'); }} style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tab === 'trending' ? 'rgba(255,149,0,.1)' : C.card2, border: '1px solid ' + (tab === 'trending' ? 'rgba(255,149,0,.3)' : C.border), color: tab === 'trending' ? C.orange : C.muted }}>Trending</button>
     </div>

     {tokens.length === 0 ? (
       <div style={{ textAlign: 'center', padding: '60px 20px', background: C.card, border: '1px solid ' + C.border, borderRadius: 16 }}>
         <div style={{ color: C.muted, fontSize: 14, marginBottom: 6 }}>{wsStatus === 'live' ? 'Waiting for new launches...' : 'Connecting to live feed...'}</div>
         <div style={{ color: C.muted2, fontSize: 11 }}>Tokens appear here as they launch on Solana</div>
       </div>
     ) : (
       displayTokens.map(function(token) {
         return <TokenCard key={token.mint} token={token} onCardClick={setSelectedToken} onBuyClick={openBuyDrawer} onSellClick={openSellDrawer} isNew={newMints.has(token.mint)} />;
       })
     )}

     <LaunchTradeDrawer
       open={drawerOpen} onClose={function() { setDrawerOpen(false); }}
       mode={drawerMode} token={drawerToken} solPrice={solPrice}
       onConnectWallet={onConnectWallet} isConnected={isConnected}
       coins={coins} jupiterTokens={jupiterTokens}
       presets={presets} onPresetsChange={handlePresetsChange}
     />
   </div>
 );
}
