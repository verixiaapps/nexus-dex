/**
 * NEXUS DEX — Cross-Chain Swap
 *
 * Routing:
 *   1) OKX cross-chain (primary)  — /api/okx/dex/cross-chain/{quote,build-tx}
 *   2) LI.FI            (fallback) — /api/lifi/quote
 *
 * Both go through your existing server proxies, so:
 *   - no CSP issues
 *   - OKX server-side fee injection already handled
 *   - LI.FI key (if set) attached server-side
 *
 * Wallet: Solana wallet adapter (Phantom / Solflare / Backpack / WC)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

/* ─── CONSTANTS ─── */
const WSOL_MINT      = 'So11111111111111111111111111111111111111112';
const SOL_MINT_OKX   = '11111111111111111111111111111111';
const USDC_SOLANA    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_RESERVE    = 1_000_000;
const QUOTE_DEBOUNCE = 400;
const PRICE_CACHE_MS = 60_000;
const SLIPPAGE       = '1';

const OKX_SOLANA_IDX = '501';
const LIFI_SOLANA_ID = 1151111081099710;

const OKX_CHAIN_INDEX = {
  '1':'1','56':'56','137':'137','42161':'42161','10':'10',
  '43114':'43114','8453':'8453','59144':'59144','324':'324','100':'100',
};

const C = {
  bg:'#03060f', card:'#080d1a', card2:'#0c1220', card3:'#111d30',
  border:'rgba(0,229,255,0.10)', borderHi:'rgba(0,229,255,0.25)',
  accent:'#00e5ff', green:'#00ffa3', red:'#ff3b6b',
  text:'#cdd6f4', muted:'#586994', muted2:'#2e3f5e',
  buyGrad:'linear-gradient(135deg,#00e5ff,#0055ff)',
  successGrad:'linear-gradient(135deg,#00ffa3,#00b36b)',
};

const CHAIN_META = {
  '1':{name:'Ethereum',color:'#627eea'},
  '56':{name:'BNB Chain',color:'#f0b90b'},
  '137':{name:'Polygon',color:'#8247e5'},
  '42161':{name:'Arbitrum',color:'#28a0f0'},
  '10':{name:'Optimism',color:'#ff0420'},
  '43114':{name:'Avalanche',color:'#e84142'},
  '8453':{name:'Base',color:'#0052ff'},
  '59144':{name:'Linea',color:'#61dfff'},
  '324':{name:'zkSync',color:'#8c8dfc'},
  '100':{name:'Gnosis',color:'#04795b'},
};
const chainName  = id => CHAIN_META[String(id)]?.name  || 'Chain '+id;
const chainColor = id => CHAIN_META[String(id)]?.color || C.accent;
const isEvm      = id => String(id) !== String(LIFI_SOLANA_ID);

/* ─── FORMATTERS ─── */
const trimZeros = v => String(v).replace(/(\.\d*?[1-9])0+$/,'$1').replace(/\.0+$/,'').replace(/\.$/,'');
function decsForDisplay(n){const v=+n;if(!Number.isFinite(v))return 4;if(v===0)return 2;if(v<1e-8)return 12;if(v<1e-6)return 10;if(v<0.01)return 8;if(v<1)return 6;return 4;}
function fmtTok(n){if(n==null||isNaN(n))return'0';const v=+n;if(!Number.isFinite(v))return'0';if(v>=1e9)return trimZeros((v/1e9).toFixed(2))+'B';if(v>=1e6)return trimZeros((v/1e6).toFixed(2))+'M';if(v>=1000)return v.toLocaleString('en-US',{maximumFractionDigits:2});return trimZeros(v.toFixed(decsForDisplay(v)));}
function fmtInput(n,dec=9){const v=+n;if(!Number.isFinite(v)||v<=0)return'';const m=Math.min(Math.max(+dec||6,0),12);return trimZeros(v.toFixed(m));}
function fmtUsd(n,d=2){if(n==null||isNaN(n))return'-';const v=+n;if(!Number.isFinite(v))return'-';if(v>=1e9)return'$'+trimZeros((v/1e9).toFixed(2))+'B';if(v>=1e6)return'$'+trimZeros((v/1e6).toFixed(2))+'M';if(v>=1000)return'$'+v.toLocaleString('en-US',{maximumFractionDigits:d});if(v>=1)return'$'+v.toFixed(d);if(v>0)return'$'+trimZeros(v.toFixed(v<1e-6?10:8));return'$0.00';}
function toRaw(s,dec){if(!s||dec==null)return'0';let v=String(s).trim().replace(/,/g,'.').replace(/^\+/,'');if(!v||v.startsWith('-'))return'0';if(/e/i.test(v)){const n=Number(v);if(!Number.isFinite(n)||n<0)return'0';v=n.toFixed(Math.max(+dec||0,20));}const d=Math.floor(+dec);if(!Number.isFinite(d)||d<0||d>18)return'0';const[w,f='']=v.split('.');const sw=(w||'0').replace(/[^\d]/g,'').replace(/^0+(?=\d)/,'')||'0';const ft=(f||'').replace(/[^\d]/g,'').slice(0,d);const fp=(ft+'0'.repeat(d)).slice(0,d);try{return(BigInt(sw)*(10n**BigInt(d))+BigInt(fp)).toString();}catch{return'0';}}
function maxSafeSol(lamports){return lamports?Math.max(0,lamports-SOL_RESERVE)/LAMPORTS_PER_SOL:0;}

function validateDest(addr, chainId){
  if(!addr||!addr.trim()) return 'Destination address required';
  const a = addr.trim();
  if (isEvm(chainId)) { if(!/^0x[0-9a-fA-F]{40}$/.test(a)) return 'Invalid EVM address'; }
  else { if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'Invalid Solana address'; }
  return null;
}
const isValidSolMint = s => !!s && s.length>=32 && s.length<=44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
const toOkxSol       = m => m === WSOL_MINT ? SOL_MINT_OKX : m;

/* ─── OKX SOLANA TOKEN CACHE ─── */
let _okxCache = null, _okxLoading = null;
function loadOkxSolTokens(){
  if (_okxCache) return Promise.resolve(_okxCache);
  if (_okxLoading) return _okxLoading;
  _okxLoading = fetch('/api/okx/dex/aggregator/all-tokens?chainIndex=501')
    .then(r => r.ok ? r.json() : { data:[] }).catch(()=>({data:[]}))
    .then(j => {
      const out = (j.data||[]).map(t => {
        const d = parseInt(t.decimals);
        return {
          chainId: String(LIFI_SOLANA_ID),
          mint: t.tokenContractAddress, address: t.tokenContractAddress,
          symbol: t.tokenSymbol||'', name: t.tokenName||t.tokenSymbol||'',
          decimals: Number.isFinite(d)?d:6, logoURI: t.tokenLogoUrl||null,
        };
      }).filter(t => isValidSolMint(t.mint) && t.symbol);
      _okxCache = out; _okxLoading = null; return out;
    })
    .catch(e => { _okxLoading = null; throw e; });
  return _okxLoading;
}
function getOkxCached(mint){ return _okxCache?.find(t => t.mint === mint) || null; }
function resolveDecimals(token){
  if (!token) return 6;
  if (token.mint === WSOL_MINT || token.mint === SOL_MINT_OKX) return 9;
  if (token.mint === USDC_SOLANA) return 6;
  const okx = getOkxCached(token.mint);
  if (okx && Number.isFinite(+okx.decimals)) return +okx.decimals;
  const d = +token.decimals;
  return Number.isFinite(d) && d>=0 && d<=18 ? d : 6;
}

/* ─── LI.FI TOKEN CACHE ─── */
let _lifiCache = null, _lifiLoading = null;
function loadLifiTokens(){
  if (_lifiCache) return Promise.resolve(_lifiCache);
  if (_lifiLoading) return _lifiLoading;
  _lifiLoading = fetch('/api/lifi/tokens')
    .then(r => r.ok ? r.json() : { tokens:{} })
    .then(j => {
      const all = [];
      for (const [cid, tokens] of Object.entries(j?.tokens || {})) {
        if (String(cid) === String(LIFI_SOLANA_ID)) continue;
        for (const t of (tokens||[])) {
          if (!t.address || !t.symbol) continue;
          all.push({
            chainId: String(cid),
            address: t.address,
            symbol: t.symbol,
            name: t.name || t.symbol,
            decimals: +t.decimals || 18,
            logoURI: t.logoURI || null,
          });
        }
      }
      _lifiCache = all; _lifiLoading = null; return all;
    })
    .catch(e => { _lifiLoading = null; throw e; });
  return _lifiLoading;
}

/* ─── PRICE ─── */
const _priceCache = new Map();
async function fetchPrice(token){
  const mint = token?.mint || token?.address;
  if (!mint) return null;
  if (mint === USDC_SOLANA) return 1;
  const c = _priceCache.get(mint);
  if (c && Date.now()-c.ts < PRICE_CACHE_MS) return c.price;
  // Only price Solana tokens via OKX
  if (token.chainId && String(token.chainId) !== String(LIFI_SOLANA_ID)) return null;
  await loadOkxSolTokens().catch(()=>{});
  const dec = resolveDecimals(token);
  const amount = (10n**BigInt(dec)).toString();
  try {
    const r = await fetch(`/api/okx/dex/aggregator/quote?chainIndex=501&fromTokenAddress=${toOkxSol(mint)}&toTokenAddress=${USDC_SOLANA}&amount=${amount}`);
    const j = await r.json();
    if (j.code === '0' && j.data) {
      const d = Array.isArray(j.data) ? j.data[0] : j.data;
      const price = Number(d.toTokenAmount)/1e6;
      if (price>0){ _priceCache.set(mint,{price,ts:Date.now()}); return price; }
    }
  } catch {}
  return null;
}

/* ═══════════ AGGREGATORS ═══════════ */

/* OKX V6 cross-chain API — verified from live error responses:
 *   V6 cross-chain uses fromChainIndex/toChainIndex (V5 docs lie — they say chainId)
 *   Live error confirmed: "Parameter fromChainIndex cannot be empty"
 *   slippagePercent name comes from V6 changelog (V5 used slippage)
 *   We send BOTH old and new names so it works on either version.
 */
const SLIPPAGE_FRACTION = '0.05'; // 5%
function buildOkxXChainParams(extra){
  return new URLSearchParams({
    fromChainIndex: OKX_SOLANA_IDX,
    toChainIndex:   String(extra.toChainId),
    // Also send V5 names defensively — extra params are ignored by upstream
    fromChainId:    OKX_SOLANA_IDX,
    toChainId:      String(extra.toChainId),
    fromTokenAddress: toOkxSol(extra.fromMint),
    toTokenAddress:   extra.toAddress || extra.toTokenAddress,
    amount: String(extra.amount),
    slippagePercent: SLIPPAGE_FRACTION,
    slippage:        SLIPPAGE_FRACTION,
    sort: '1',
    ...(extra.sender   ? { userWalletAddress: extra.sender }   : {}),
    ...(extra.receiver ? { receiveAddress:    extra.receiver } : {}),
  });
}
async function okxQuote({ fromMint, toChainId, toAddress, amount }){
  const p = buildOkxXChainParams({ fromMint, toChainId, toAddress, amount });
  const r = await fetch('/api/okx/dex/cross-chain/quote?'+p.toString());
  const j = await r.json();
  if (j.code !== '0' || !j.data) throw new Error('OKX quote: '+(j.msg || JSON.stringify(j).slice(0,200)));
  return Array.isArray(j.data) ? j.data[0] : j.data;
}

async function okxBuild({ fromMint, toChainId, toTokenAddress, amount, sender, receiver }){
  const p = buildOkxXChainParams({ fromMint, toChainId, toTokenAddress, amount, sender, receiver });
  const r = await fetch('/api/okx/dex/cross-chain/build-tx?'+p.toString());
  const j = await r.json();
  if (j.code !== '0' || !j.data) throw new Error('OKX build: '+(j.msg || JSON.stringify(j).slice(0,200)));
  return Array.isArray(j.data) ? j.data[0] : j.data;
}

/* LI.FI Solana note (from docs):
 *   - Native SOL: use System Program "11111111111111111111111111111111"
 *   - Wrapped SOL: use "So11111111111111111111111111111111111111112"
 *   Most users hold native SOL, not wSOL. When the UI passes wSOL mint,
 *   we silently translate to native for LI.FI so quotes succeed.
 * Order values (verified from LI.FI docs/examples):
 *   CHEAPEST | FASTEST | SAFEST | RECOMMENDED  (RECOMMENDED is valid;
 *   was previously BEST_VALUE — LI.FI accepts both per their SDK source)
 */
function lifiFromToken(mint){
  // LI.FI treats the wSOL mint as the wrapped token, NOT native SOL.
  // If user means native SOL (UI default), pass system program.
  return mint === WSOL_MINT ? SOL_MINT_OKX : mint;
}
async function lifiQuote({ fromMint, toChainId, toAddress, amount, sender, receiver }){
  if (!sender) throw new Error('LI.FI requires connected wallet');
  const p = new URLSearchParams({
    fromChain: String(LIFI_SOLANA_ID),
    toChain:   String(toChainId),
    fromToken: lifiFromToken(fromMint),
    toToken:   toAddress,
    fromAmount: String(amount),
    fromAddress: sender,
    toAddress: receiver || sender,
    slippage: SLIPPAGE_FRACTION,
    integrator: 'NexusDEX',
    order: 'FASTEST',
    skipSimulation: 'true',
  });
  const r = await fetch('/api/lifi/quote?'+p.toString());
  const j = await r.json().catch(()=>({}));
  if (!r.ok) {
    const detail = j?.message || j?.errors?.[0]?.message || j?.error || `HTTP ${r.status}`;
    throw new Error('LI.FI quote: '+detail);
  }
  return j;
}

/* Solana tx decoder.
 * OKX returns base58-encoded VersionedTransaction in tx.data.
 * LI.FI returns base64-encoded VersionedTransaction in transactionRequest.data.
 * Wrong decoder = corrupt tx = "invalid account data" on chain.
 */
async function sendSolanaTx({ connection, txData, encoding, sendTx }){
  let bytes;
  if (encoding === 'base58') {
    bytes = bs58.decode(txData);
  } else {
    bytes = Buffer.from(txData, 'base64');
  }
  let tx;
  try { tx = VersionedTransaction.deserialize(bytes); }
  catch (e) { throw new Error('Failed to deserialize ('+encoding+'): '+e.message); }

  // Refresh blockhash so the tx doesn't expire while user signs
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  tx.message.recentBlockhash = blockhash;

  const sig = await sendTx(tx, connection, { skipPreflight:false, preflightCommitment:'processed', maxRetries:3 });
  connection.confirmTransaction({ signature:sig, blockhash, lastValidBlockHeight }, 'confirmed').catch(()=>{});
  return sig;
}

/* placeholder receiver for QUOTING ONLY (must be valid for dest chain type) */
const QUOTE_PLACEHOLDER_EVM = '0x000000000000000000000000000000000000dEaD';
const QUOTE_PLACEHOLDER_SOL = '11111111111111111111111111111111';
function placeholderReceiver(chainId){
  return isEvm(chainId) ? QUOTE_PLACEHOLDER_EVM : QUOTE_PLACEHOLDER_SOL;
}

async function getUnifiedQuote({ fromToken, toToken, amount, sender, receiver }){
  const fromMint = fromToken.mint || fromToken.address;
  const toDec    = +toToken.decimals || 18;
  const errors   = [];

  // 1. OKX first
  if (OKX_CHAIN_INDEX[String(toToken.chainId)]) {
    try {
      const q = await okxQuote({ fromMint, toChainId: toToken.chainId, toAddress: toToken.address, amount });
      // Per docs: response is { fromTokenAmount, fromToken, toToken, routerList:[{router:{bridgeName,...}, toTokenAmount, minimumReceived, estimateTime, ...}], toChainId }
      const route = q?.routerList?.[0];
      const toAmtRaw = route?.toTokenAmount || q.toTokenAmount;
      if (toAmtRaw) {
        const outAmt = Number(toAmtRaw) / Math.pow(10, toDec);
        const dur = Number(route?.estimateTime || 0);
        return {
          aggregator:'okx', outAmt, outDisplay:fmtTok(outAmt),
          estTime: dur > 0 ? dur : null,
          bridge: route?.router?.bridgeName || 'OKX',
        };
      }
      errors.push('OKX: empty response');
    } catch (e) {
      console.warn('[OKX quote]', e.message);
      errors.push(e.message);
    }
  } else {
    errors.push('OKX: chain '+toToken.chainId+' not supported');
  }

  // 2. LI.FI fallback — requires real sender
  if (!sender) {
    errors.push('LI.FI: connect wallet to get a quote');
    const err = new Error(errors.join(' | '));
    err.errors = errors;
    throw err;
  }
  try {
    const j = await lifiQuote({ fromMint, toChainId: toToken.chainId, toAddress: toToken.address, amount, sender, receiver: receiver || sender });
    if (j && j.estimate) {
      const outAmt = Number(j.estimate.toAmountMin || j.estimate.toAmount) / Math.pow(10, toDec);
      return {
        aggregator:'lifi', outAmt, outDisplay:fmtTok(outAmt),
        estTime: j.estimate.executionDuration || null,
        bridge: j.toolDetails?.name || j.tool || 'LI.FI',
      };
    }
    errors.push('LI.FI: empty estimate');
  } catch (e) {
    console.warn('[LI.FI quote]', e.message);
    errors.push(e.message);
  }

  const err = new Error(errors.join(' | '));
  err.errors = errors;
  throw err;
}

/* ─── DEFAULTS ─── */
const DEFAULT_FROM = {
  chainId: String(LIFI_SOLANA_ID),
  mint: WSOL_MINT, address: WSOL_MINT,
  symbol:'SOL', name:'Solana', decimals: 9,
  logoURI:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
};
const DEFAULT_TO = {
  chainId:'1',
  address:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol:'USDC', name:'USD Coin', decimals: 6,
  logoURI:'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
};

/* ─── HOOKS ─── */
let _bl = 0;
function useBodyScrollLock(open){
  useEffect(()=>{ if(!open||typeof document==='undefined')return; if(_bl===0)document.body.classList.add('nexus-scroll-locked'); _bl++; return ()=>{ _bl=Math.max(0,_bl-1); if(_bl===0)document.body.classList.remove('nexus-scroll-locked'); }; },[open]);
}
function useEscape(open, h){
  useEffect(()=>{ if(!open)return; const fn=e=>{ if(e.key==='Escape'){e.stopPropagation();h?.();} }; window.addEventListener('keydown',fn); return ()=>window.removeEventListener('keydown',fn); },[open,h]);
}

/* ─── UI BITS ─── */
function TokenIcon({ token, size=32 }){
  const [err,setErr] = useState(false);
  if (token?.logoURI && !err)
    return <img src={token.logoURI} alt="" style={{width:size,height:size,borderRadius:'50%',flexShrink:0}} onError={()=>setErr(true)}/>;
  const ch = token?.symbol ? token.symbol.charAt(0).toUpperCase() : '?';
  return <div style={{width:size,height:size,borderRadius:'50%',flexShrink:0,background:'rgba(0,229,255,.1)',border:'1px solid rgba(0,229,255,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:Math.round(size*.4),fontWeight:700,color:C.accent}}>{ch}</div>;
}

function ChainBadge({ chainId, small=false }){
  const color = chainColor(chainId), name = chainName(chainId);
  return (
    <div style={{display:'inline-flex',alignItems:'center',gap:4,background:color+'22',border:'1px solid '+color+'55',borderRadius:6,padding:small?'2px 6px':'3px 8px',fontSize:small?9:10,color,fontWeight:700,fontFamily:'Syne, sans-serif'}}>
      <div style={{width:small?5:6,height:small?5:6,borderRadius:'50%',background:color}}/>
      {name}
    </div>
  );
}

function StepProgress({ step }){
  if (step <= 0) return null;
  const steps = [{label:'Quote',id:1},{label:'Sign',id:2},{label:'Bridge',id:3},{label:'Done',id:4}];
  return (
    <div style={{display:'flex',alignItems:'center',gap:0,margin:'14px 0 10px'}}>
      {steps.map((s,i)=>{
        const done=step>s.id, active=step===s.id;
        return (
          <React.Fragment key={s.id}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1}}>
              <div style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,background:done?C.green:active?C.accent:C.card3,color:(done||active)?'#000':C.muted,border:active?'2px solid '+C.accent:done?'2px solid '+C.green:'2px solid '+C.muted2}}>{done?'✓':s.id}</div>
              <div style={{fontSize:9,color:done?C.green:active?C.accent:C.muted,marginTop:3,fontWeight:700}}>{s.label}</div>
            </div>
            {i<steps.length-1 && <div style={{height:2,flex:1,background:done?C.green:C.muted2,marginBottom:14}}/>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ─── FROM MODAL ─── */
function FromTokenModal({ open, onClose, onSelect }){
  const [q,setQ]=useState(''); const [r,setR]=useState([]); const [loading,setLoading]=useState(false);
  useEffect(()=>{ if(!open)return; setLoading(true); loadOkxSolTokens().then(()=>setLoading(false)).catch(()=>setLoading(false)); },[open]);
  useEffect(()=>{
    const t=q.trim().toLowerCase(); if(!t){setR([]);return;}
    const tm=setTimeout(()=>{ setR((_okxCache||[]).filter(tk=>tk.symbol?.toLowerCase().includes(t)||tk.name?.toLowerCase().includes(t)||tk.mint?.toLowerCase().includes(t)).slice(0,40)); },150);
    return ()=>clearTimeout(tm);
  },[q]);
  const close=useCallback(()=>{setQ('');setR([]);onClose();},[onClose]);
  useBodyScrollLock(open); useEscape(open,close);
  const popular=[DEFAULT_FROM,{chainId:String(LIFI_SOLANA_ID),mint:USDC_SOLANA,address:USDC_SOLANA,symbol:'USDC',name:'USD Coin',decimals:6,logoURI:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png'}];
  const display = q.trim() ? r : popular;
  if (!open) return null;
  return (<>
    <div onClick={close} style={{position:'fixed',inset:0,zIndex:499,background:'rgba(0,0,0,.78)'}}/>
    <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',zIndex:500,background:C.card,border:'1px solid '+C.borderHi,borderRadius:18,width:'94vw',maxWidth:440,maxHeight:'min(85vh,100dvh)',display:'flex',flexDirection:'column',boxShadow:'0 24px 80px rgba(0,0,0,.95)'}}>
      <div style={{padding:'16px 16px 10px',borderBottom:'1px solid '+C.border}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
          <div style={{color:'#fff',fontWeight:700,fontSize:16,fontFamily:'Syne, sans-serif'}}>From <span style={{fontSize:11,color:C.muted,fontWeight:400}}>· Solana</span></div>
          <button onClick={close} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:20,padding:4}}>✕</button>
        </div>
        <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" style={{width:'100%',background:C.card2,border:'1px solid '+C.border,borderRadius:8,padding:'10px 12px',color:'#fff',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
      </div>
      <div style={{overflowY:'auto',flex:1}}>
        {loading && <div style={{padding:24,textAlign:'center',color:C.muted,fontSize:12}}>Loading tokens…</div>}
        {!q.trim()&&!loading && <div style={{padding:'8px 16px 4px',fontSize:10,color:C.muted,fontWeight:700}}>POPULAR</div>}
        {display.length===0&&!loading && <div style={{padding:24,textAlign:'center',color:C.muted}}>No matches</div>}
        {display.map((t,i)=>(
          <div key={(t.mint||'')+i} onClick={()=>{onSelect(t);close();}} style={{padding:'12px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid rgba(255,255,255,.03)'}}>
            <TokenIcon token={t} size={32}/>
            <div style={{flex:1}}>
              <div style={{color:'#fff',fontWeight:700,fontSize:13}}>{t.symbol}</div>
              <div style={{color:C.muted,fontSize:11}}>{t.name}</div>
            </div>
            <ChainBadge chainId={String(LIFI_SOLANA_ID)} small/>
          </div>
        ))}
      </div>
    </div>
  </>);
}

/* ─── TO MODAL ─── */
function ToTokenModal({ open, onClose, onSelect }){
  const [q,setQ]=useState(''); const [all,setAll]=useState([]); const [r,setR]=useState([]);
  const [loading,setLoading]=useState(false); const [sel,setSel]=useState('all');
  useEffect(()=>{ if(!open)return; setLoading(true); loadLifiTokens().then(t=>{setAll(t);setLoading(false);}).catch(()=>setLoading(false)); },[open]);
  const chains = useMemo(()=>{
    const ids = new Set(all.map(t=>t.chainId));
    const order = ['1','56','137','42161','10','43114','8453','324','59144','100'];
    return ['all', ...Array.from(ids).sort((a,b)=>{const ai=order.indexOf(a),bi=order.indexOf(b);if(ai>=0&&bi>=0)return ai-bi;if(ai>=0)return -1;if(bi>=0)return 1;return a.localeCompare(b);})];
  },[all]);
  useEffect(()=>{
    const t=q.trim().toLowerCase();
    const filt = sel==='all' ? all : all.filter(tk=>tk.chainId===sel);
    if (!t) { setR(filt.filter(tk=>['USDC','USDT','ETH','BNB','MATIC','AVAX','WETH','DAI'].includes(tk.symbol?.toUpperCase())).slice(0,24)); return; }
    const tm = setTimeout(()=>{ setR(filt.filter(tk=>tk.symbol?.toLowerCase().includes(t)||tk.name?.toLowerCase().includes(t)||tk.address?.toLowerCase().includes(t)).slice(0,50)); },150);
    return ()=>clearTimeout(tm);
  },[q,all,sel]);
  const close=useCallback(()=>{setQ('');setR([]);setSel('all');onClose();},[onClose]);
  useBodyScrollLock(open); useEscape(open,close);
  if (!open) return null;
  return (<>
    <div onClick={close} style={{position:'fixed',inset:0,zIndex:499,background:'rgba(0,0,0,.78)'}}/>
    <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',zIndex:500,background:C.card,border:'1px solid '+C.borderHi,borderRadius:18,width:'94vw',maxWidth:460,maxHeight:'min(88vh,100dvh)',display:'flex',flexDirection:'column',boxShadow:'0 24px 80px rgba(0,0,0,.95)'}}>
      <div style={{padding:'16px 16px 10px',borderBottom:'1px solid '+C.border}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
          <div style={{color:'#fff',fontWeight:700,fontSize:16,fontFamily:'Syne, sans-serif'}}>To <span style={{fontSize:11,color:C.muted,fontWeight:400}}>· All Chains</span></div>
          <button onClick={close} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:20,padding:4}}>✕</button>
        </div>
        <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" style={{width:'100%',background:C.card2,border:'1px solid '+C.border,borderRadius:8,padding:'10px 12px',color:'#fff',fontSize:13,outline:'none',marginBottom:10,boxSizing:'border-box'}}/>
        <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:2}}>
          {chains.map(id=>{
            const active=sel===id; const color=id==='all'?C.accent:chainColor(id);
            return (
              <button key={id} onClick={()=>setSel(id)} style={{flexShrink:0,padding:'4px 10px',borderRadius:20,border:active?'1px solid '+color:'1px solid '+C.muted2,background:active?color+'22':'transparent',color:active?color:C.muted,fontSize:11,fontWeight:700,cursor:'pointer'}}>
                {id==='all'?'All':chainName(id)}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{overflowY:'auto',flex:1}}>
        {loading && <div style={{padding:24,textAlign:'center',color:C.muted,fontSize:12}}>Loading tokens…</div>}
        {!loading && r.length===0 && <div style={{padding:24,textAlign:'center',color:C.muted}}>No matches</div>}
        {r.map((t,i)=>(
          <div key={t.chainId+':'+t.address+i} onClick={()=>{onSelect(t);close();}} style={{padding:'11px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid rgba(255,255,255,.03)'}}>
            <TokenIcon token={t} size={30}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{color:'#fff',fontWeight:700,fontSize:13}}>{t.symbol}</div>
              <div style={{color:C.muted,fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.name}</div>
            </div>
            <ChainBadge chainId={t.chainId} small/>
          </div>
        ))}
      </div>
    </div>
  </>);
}

/* ═══════════ MAIN ═══════════ */
export default function CrossChainSwap({ onConnectWallet }){
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();
  useNexusWallet();

  const pubkey = publicKey || null;
  const wcon   = !!connected && !!pubkey;

  const [fromToken, setFromToken] = useState(DEFAULT_FROM);
  const [toToken,   setToToken]   = useState(DEFAULT_TO);
  const [fromAmt,   setFromAmt]   = useState('');
  const [destAddr,  setDestAddr]  = useState('');
  const [addrErr,   setAddrErr]   = useState('');
  const [quote,     setQuote]     = useState(null);
  const [quoting,   setQuoting]   = useState(false);
  const [quoteErr,  setQuoteErr]  = useState('');

  // 0=idle 1=building 2=signing 3=bridging 4=done -1=error
  const [step,      setStep]      = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [swapErr,   setSwapErr]   = useState('');
  const [txHash,    setTxHash]    = useState(null);

  const [sbl, setSbl] = useState(null);
  const [ssb, setSsb] = useState(null);
  const [fp,  setFp]  = useState(null);
  const [tp,  setTp]  = useState(null);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen,   setToOpen]   = useState(false);
  const reqIdRef = useRef(0);

  useEffect(()=>{ loadOkxSolTokens().catch(()=>{}); loadLifiTokens().catch(()=>{}); },[]);

  useEffect(()=>{
    if (!pubkey || !connection) { setSbl(null); setSsb(null); return; }
    let c = false;
    connection.getBalance(pubkey).then(b=>{ if(!c) setSbl(b); }).catch(()=>{});
    if (fromToken?.mint && fromToken.mint !== WSOL_MINT) {
      connection.getParsedTokenAccountsByOwner(pubkey,{mint:new PublicKey(fromToken.mint)})
        .then(a=>{ if(!c) setSsb(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0); })
        .catch(()=>{});
    } else { setSsb(null); }
    return ()=>{ c = true; };
  },[pubkey, connection, fromToken, step]);

  useEffect(()=>{ let c=false; fetchPrice(fromToken).then(p=>{if(!c)setFp(p);}); return ()=>{c=true;}; },[fromToken]);
  useEffect(()=>{ let c=false; fetchPrice(toToken).then(p=>{if(!c)setTp(p);}); return ()=>{c=true;}; },[toToken]);

  const fbd = useMemo(()=>{
    if (fromToken?.mint === WSOL_MINT) return sbl != null ? sbl/LAMPORTS_PER_SOL : null;
    return ssb;
  },[fromToken, sbl, ssb]);

  const needsDest = toToken && String(toToken.chainId) !== String(LIFI_SOLANA_ID);

  useEffect(()=>{
    if (!needsDest || !destAddr.trim()) { setAddrErr(''); return; }
    setAddrErr(validateDest(destAddr, toToken?.chainId) || '');
  },[destAddr, toToken, needsDest]);

  const fetchQuote = useCallback(async ()=>{
    setQuoteErr('');
    if (!fromAmt || +fromAmt <= 0 || !fromToken || !toToken) { setQuote(null); return; }
    const myReq = ++reqIdRef.current;
    setQuoting(true);
    try {
      const dec = resolveDecimals(fromToken);
      const raw = toRaw(fromAmt, dec);
      if (!raw || raw === '0') { setQuote(null); setQuoting(false); return; }
      // For quoting only: aggregators need valid-format sender/receiver to
      // return route estimates. If wallet isn't connected or destination
      // isn't entered, use chain-appropriate placeholders. Real addresses
      // are enforced at execute time.
      const sender = pubkey ? pubkey.toString() : QUOTE_PLACEHOLDER_SOL;
      const userDest = destAddr.trim();
      const userDestOk = userDest && !validateDest(userDest, toToken?.chainId);
      const receiver = userDestOk ? userDest : placeholderReceiver(toToken?.chainId);
      const q = await getUnifiedQuote({ fromToken, toToken, amount: raw, sender, receiver });
      if (myReq !== reqIdRef.current) return;
      setQuote(q);
    } catch (e) {
      if (myReq === reqIdRef.current) {
        setQuote(null);
        setQuoteErr(e.message || 'Quote failed');
      }
    } finally {
      if (myReq === reqIdRef.current) setQuoting(false);
    }
  },[fromAmt, fromToken, toToken, destAddr, pubkey]);

  useEffect(()=>{ const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE); return ()=>clearTimeout(t); },[fetchQuote]);

  const onMax = useCallback(()=>{
    if (fbd == null || fbd <= 0) return;
    const dec = Math.min(resolveDecimals(fromToken), 9);
    if (fromToken?.mint === WSOL_MINT) { setFromAmt(fmtInput(maxSafeSol(sbl), dec)); return; }
    setFromAmt(fmtInput(fbd, dec));
  },[fbd, fromToken, sbl]);

  const execute = useCallback(async ()=>{
    if (!wcon) { onConnectWallet?.(); return; }
    if (needsDest) {
      const e = validateDest(destAddr, toToken?.chainId);
      if (e) { setAddrErr(e); return; }
    }
    if (!quote) { setSwapErr('No route. Wait for routing.'); return; }

    // Minimum amount guard: cross-chain bridges have minimum fees of
    // several dollars (gas on destination + bridge fee). Anything below
    // ~$1 will succeed on Solana side but fail at the bridge instruction
    // with "invalid account data" because the amount is dust after fees.
    const inUsd = fromAmt && fp > 0 ? +fromAmt * fp : 0;
    if (inUsd > 0 && inUsd < 1) {
      setSwapErr(`Minimum bridge amount is ~$1 (you're sending ~${fmtUsd(inUsd)}). Cross-chain fees would exceed the swap.`);
      setStep(-1);
      setTimeout(()=>{ setStep(0); setSwapErr(''); }, 6000);
      return;
    }

    setStep(1); setSwapErr(''); setStatusMsg('Building route…'); setTxHash(null);
    try {
      const dec = resolveDecimals(fromToken);
      const raw = toRaw(fromAmt, dec);
      if (!raw || raw === '0') throw new Error('Invalid amount');
      if (!pubkey) throw new Error('Connect Solana wallet');

      const sender   = pubkey.toString();
      const receiver = needsDest ? destAddr.trim() : sender;
      const fromMint = fromToken.mint || fromToken.address;

      // Hard safety: never let quote-time placeholders reach the build step.
      if (receiver === QUOTE_PLACEHOLDER_EVM || receiver === QUOTE_PLACEHOLDER_SOL || !receiver) {
        throw new Error('Enter a destination address before bridging');
      }
      if (needsDest) {
        const ve = validateDest(receiver, toToken?.chainId);
        if (ve) throw new Error(ve);
      }

      let txData = null;
      let txEncoding = null;
      let usedAggregator = null;

      const tryOkx = async () => {
        setStatusMsg('Building OKX route…');
        const built = await okxBuild({
          fromMint, toChainId: toToken.chainId, toTokenAddress: toToken.address,
          amount: raw, sender, receiver,
        });
        const data = built?.tx?.data || built?.data || null;
        if (!data) throw new Error('OKX: no tx data');
        return { data, encoding: 'base58' }; // OKX returns base58 for Solana
      };
      const tryLifi = async () => {
        setStatusMsg('Building LI.FI route…');
        const j = await lifiQuote({
          fromMint, toChainId: toToken.chainId, toAddress: toToken.address,
          amount: raw, sender, receiver,
        });
        const data = j?.transactionRequest?.data;
        if (!data) throw new Error('LI.FI: no tx data');
        return { data, encoding: 'base64' }; // LI.FI returns base64
      };

      const okxSupported = !!OKX_CHAIN_INDEX[String(toToken.chainId)];
      const order = (quote.aggregator === 'lifi' || !okxSupported)
        ? ['lifi', 'okx']
        : ['okx',  'lifi'];

      for (const a of order) {
        try {
          if (a === 'okx' && !okxSupported) continue;
          const result = a === 'okx' ? await tryOkx() : await tryLifi();
          txData = result.data;
          txEncoding = result.encoding;
          usedAggregator = a;
          break;
        } catch (err) {
          console.warn('[build '+a+']', err.message);
          setStatusMsg((a==='okx'?'OKX':'LI.FI')+' unavailable, trying other…');
        }
      }
      if (!txData) throw new Error('Both aggregators failed to build a transaction');

      setStep(2); setStatusMsg('Sign in wallet…');
      const sig = await sendSolanaTx({ connection, txData, encoding: txEncoding, sendTx: sendTransaction });
      setTxHash(sig);

      setStep(3); setStatusMsg(`Bridging via ${usedAggregator === 'okx' ? 'OKX' : 'LI.FI'}…`);
      setTimeout(()=>{ setStep(4); setStatusMsg(''); }, 1500);

    } catch (e) {
      console.error('[CrossChain execute]', e);
      setSwapErr(e.message || 'Swap failed');
      setStep(-1);
      setTimeout(()=>{ setStep(0); setSwapErr(''); }, 6000);
    }
  },[wcon, needsDest, destAddr, toToken, fromToken, fromAmt, pubkey, sendTransaction, connection, quote, onConnectWallet]);

  const reset = useCallback(()=>{
    setStep(0); setStatusMsg(''); setSwapErr(''); setTxHash(null);
    setFromAmt(''); setQuote(null); setQuoteErr('');
  },[]);

  const fuv = fromAmt && fp>0 ? +fromAmt * fp : 0;
  const tuv = quote?.outAmt && tp>0 ? quote.outAmt * tp : 0;
  const busy = step > 0 && step < 4 && step !== -1;
  const isSuccess = step === 4;
  const isError   = step === -1;
  const solscan   = txHash ? 'https://solscan.io/tx/'+txHash : null;

  const btnLabel = () => {
    if (!wcon) return 'Connect Wallet';
    if (step === 1) return 'Building Route…';
    if (step === 2) return 'Sign in Wallet…';
    if (step === 3) return 'Bridging…';
    if (isSuccess) return 'Bridge Submitted ✓';
    if (isError) return 'Try Again';
    if (!fromAmt) return 'Enter Amount';
    if (needsDest && !destAddr.trim()) return 'Enter Destination';
    if (addrErr) return 'Invalid Address';
    if (!quote) return quoting ? 'Finding Route…' : 'No Route';
    return `Bridge ${fromToken?.symbol||''} → ${toToken?.symbol||''}`;
  };
  const btnDisabled = busy
    || (wcon && (!fromAmt || (needsDest && !destAddr.trim()) || !!addrErr || (!quote && !isError && !isSuccess)));
  const btnBg = () => {
    if (isSuccess) return C.successGrad;
    if (isError) return 'rgba(255,59,107,.2)';
    if (btnDisabled && wcon) return C.card2;
    return C.buyGrad;
  };

  return (
    <div style={{width:'100%',maxWidth:540,margin:'0 auto'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:22,fontWeight:800,color:'#fff',margin:0,fontFamily:'Syne, sans-serif'}}>Cross-Chain</h1>
        <p style={{color:C.muted,fontSize:12,marginTop:4,fontFamily:'Syne, sans-serif'}}>Solana → Any Chain · OKX + LI.FI</p>
      </div>

      <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:20,padding:20}}>
        <StepProgress step={step}/>

        {/* FROM */}
        <div style={{background:C.card2,borderRadius:14,padding:16,border:'1px solid '+C.border,marginBottom:4}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
            <span style={{fontSize:11,color:C.muted,fontWeight:700}}>YOU SEND</span>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <ChainBadge chainId={String(LIFI_SOLANA_ID)} small/>
              {fbd!=null && <span style={{fontSize:11,color:C.muted}}>Bal: <span style={{color:C.text}}>{fmtTok(fbd)}</span></span>}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <button onClick={()=>!busy&&setFromOpen(true)} style={{display:'flex',alignItems:'center',gap:8,background:C.card3,border:'1px solid '+C.border,borderRadius:12,padding:'9px 12px',cursor:busy?'default':'pointer',flexShrink:0,minWidth:110}}>
              <TokenIcon token={fromToken} size={22}/>
              <span style={{color:'#fff',fontWeight:700,fontSize:14}}>{fromToken?.symbol}</span>
              {!busy && <span style={{color:C.muted,fontSize:12}}>▾</span>}
            </button>
            <input value={fromAmt} onChange={e=>{ if(!busy) setFromAmt(e.target.value.replace(/[^0-9.]/g,'')); }} placeholder="0.00" inputMode="decimal" disabled={busy} style={{flex:1,background:'transparent',border:'none',fontSize:24,color:'#fff',textAlign:'right',outline:'none',fontFamily:'JetBrains Mono, monospace',opacity:busy?0.5:1}}/>
            {fbd>0 && !busy && <button onClick={onMax} style={{background:'rgba(0,229,255,.12)',border:'1px solid rgba(0,229,255,.25)',borderRadius:6,padding:'6px 10px',color:C.accent,fontSize:11,fontWeight:700,cursor:'pointer'}}>MAX</button>}
          </div>
          {fuv>0 && <div style={{textAlign:'right',marginTop:6,fontSize:11,color:C.muted}}>{fmtUsd(fuv)}</div>}
        </div>

        <div style={{display:'flex',justifyContent:'center',margin:'8px 0'}}>
          <div style={{width:42,height:42,borderRadius:12,background:C.card3,border:'1px solid '+C.border,display:'flex',alignItems:'center',justifyContent:'center',color:C.accent,fontSize:16}}>↓</div>
        </div>

        {/* TO */}
        <div style={{background:C.card2,borderRadius:14,padding:16,border:'1px solid '+C.border}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
            <span style={{fontSize:11,color:C.muted,fontWeight:700}}>YOU RECEIVE (EST.)</span>
            {toToken && <ChainBadge chainId={toToken.chainId} small/>}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <button onClick={()=>!busy&&setToOpen(true)} style={{display:'flex',alignItems:'center',gap:8,background:C.card3,border:'1px solid '+C.border,borderRadius:12,padding:'9px 12px',cursor:busy?'default':'pointer',flexShrink:0,minWidth:110}}>
              <TokenIcon token={toToken} size={22}/>
              <span style={{color:'#fff',fontWeight:700,fontSize:14}}>{toToken?.symbol}</span>
              {!busy && <span style={{color:C.muted,fontSize:12}}>▾</span>}
            </button>
            <div style={{flex:1,textAlign:'right',fontSize:24,color:quote?C.green:C.muted2,fontFamily:'JetBrains Mono, monospace'}}>
              {quoting ? <span style={{fontSize:14,color:C.muted}}>…</span> : (quote?.outDisplay || '0')}
            </div>
          </div>
          {tuv>0 && <div style={{textAlign:'right',marginTop:6,fontSize:11,color:C.muted}}>{fmtUsd(tuv)}</div>}
          {quote && (
            <div style={{marginTop:8,fontSize:10,color:C.muted,display:'flex',justifyContent:'space-between'}}>
              <span>via {quote.bridge}</span>
              {quote.estTime && <span>~{Math.max(1,Math.ceil(quote.estTime/60))} min</span>}
            </div>
          )}
        </div>

        {needsDest && (
          <div style={{marginTop:12}}>
            <div style={{fontSize:11,color:C.muted,fontWeight:700,marginBottom:6}}>
              DESTINATION <span style={{color:chainColor(toToken?.chainId),fontWeight:400}}>· {chainName(toToken?.chainId)}</span>
            </div>
            <div style={{position:'relative'}}>
              <input value={destAddr} onChange={e=>{ if(!busy) setDestAddr(e.target.value.trim()); }} placeholder={isEvm(toToken?.chainId)?'0x...':'Solana address'} disabled={busy} style={{width:'100%',boxSizing:'border-box',background:C.card2,border:'1px solid '+(addrErr?C.red:destAddr&&!addrErr?C.green:C.border),borderRadius:10,padding:'12px 14px',color:'#fff',fontSize:13,outline:'none',fontFamily:'JetBrains Mono, monospace',opacity:busy?0.5:1}}/>
              {destAddr && !addrErr && <div style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',color:C.green,fontSize:14}}>✓</div>}
            </div>
            {addrErr && <div style={{marginTop:5,fontSize:11,color:C.red}}>{addrErr}</div>}
          </div>
        )}

        {quoteErr && !quote && (
          <div style={{marginTop:10,padding:'10px 12px',background:'rgba(255,149,0,.08)',border:'1px solid rgba(255,149,0,.2)',borderRadius:8,fontSize:12,color:'#ff9500'}}>{quoteErr}</div>
        )}

        {quote && fromAmt && (
          <div style={{marginTop:14,background:'#050912',borderRadius:12,padding:14,border:'1px solid '+C.border}}>
            {[
              ['Aggregator', quote.aggregator === 'okx' ? 'OKX' : 'LI.FI'],
              ['Route',      quote.bridge],
              ['Slippage',   SLIPPAGE+'%'],
              ['Est. time',  quote.estTime ? '~'+Math.max(1,Math.ceil(quote.estTime/60))+' min' : '—'],
            ].map(([k,v])=>(
              <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:11}}>
                <span style={{color:C.muted}}>{k}</span>
                <span style={{color:C.text}}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {statusMsg && busy && (
          <div style={{marginTop:10,padding:'10px 12px',background:'rgba(0,229,255,.06)',border:'1px solid rgba(0,229,255,.15)',borderRadius:8,fontSize:12,color:C.accent,display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:12,height:12,borderRadius:'50%',border:'2px solid rgba(0,229,255,.3)',borderTopColor:C.accent,animation:'wc-spin 0.8s linear infinite',flexShrink:0}}/>
            {statusMsg}
          </div>
        )}

        {swapErr && <div style={{marginTop:10,padding:'10px 12px',background:'rgba(255,59,107,.1)',border:'1px solid rgba(255,59,107,.3)',borderRadius:8,fontSize:12,color:C.red}}>{swapErr}</div>}

        {isSuccess && (
          <div style={{marginTop:10,padding:14,background:'rgba(0,255,163,.06)',border:'1px solid rgba(0,255,163,.2)',borderRadius:10,textAlign:'center'}}>
            <div style={{fontSize:22,marginBottom:4}}>🎉</div>
            <div style={{color:C.green,fontWeight:700,fontSize:14}}>Bridge Submitted!</div>
            <div style={{color:C.muted,fontSize:11,marginTop:4}}>Funds arrive in {quote?.estTime ? '~'+Math.max(1,Math.ceil(quote.estTime/60))+' min' : 'a few min'}</div>
          </div>
        )}

        {!isSuccess ? (
          <button onClick={isError ? reset : (!wcon ? ()=>onConnectWallet?.() : execute)} disabled={btnDisabled && !isError} style={{width:'100%',marginTop:16,padding:16,borderRadius:14,border:'none',background:btnBg(),color:(btnDisabled&&wcon)?C.muted2:'#fff',fontFamily:'Syne, sans-serif',fontWeight:800,fontSize:15,cursor:btnDisabled?'not-allowed':'pointer',minHeight:54,opacity:busy?0.8:1}}>
            {busy && <span style={{marginRight:8,display:'inline-block',animation:'wc-spin 0.8s linear infinite'}}>⟳</span>}
            {btnLabel()}
          </button>
        ) : (
          <button onClick={reset} style={{width:'100%',marginTop:16,padding:16,borderRadius:14,border:'none',background:C.card3,color:C.accent,fontFamily:'Syne, sans-serif',fontWeight:800,fontSize:15,cursor:'pointer',minHeight:54}}>New Swap</button>
        )}

        {txHash && solscan && <a href={solscan} target="_blank" rel="noreferrer" style={{display:'block',textAlign:'center',marginTop:10,fontSize:12,color:C.accent}}>View source tx ↗</a>}
        <p style={{textAlign:'center',fontSize:10,color:C.muted2,marginTop:14}}>Non-custodial · OKX + LI.FI · Solana origin</p>
      </div>

      <FromTokenModal open={fromOpen} onClose={()=>setFromOpen(false)} onSelect={t=>{ setFromToken(t); setQuote(null); }}/>
      <ToTokenModal   open={toOpen}   onClose={()=>setToOpen(false)}   onSelect={t=>{ setToToken(t); setQuote(null); setDestAddr(''); setAddrErr(''); }}/>
    </div>
  );
}
