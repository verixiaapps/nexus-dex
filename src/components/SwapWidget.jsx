/**
 * NEXUS DEX - Unified Swap Widget (OKX DEX edition)
 *
 * Swap engine: OKX DEX API — Solana only
 * Price data: OKX quote endpoint (direct pair quote + USD display)
 * Token search: OKX token list
 * OKX referrer + fees injected server-side.
 *
 * FIXES:
 *  - USD token price now uses real token decimals
 *  - fetchOkxPrice receives full token object, not just mint
 *  - OKX token list is loaded before fallback decimal lookup
 *  - price amount uses BigInt-safe decimal math
 *  - slippagePercent restored for OKX swap-instruction/proxy
 *  - client-side quote no longer subtracts fake fee from receive amount
 *  - fixed drawer opacity syntax bug
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import {
  VersionedTransaction, PublicKey, LAMPORTS_PER_SOL,
  TransactionInstruction, TransactionMessage, AddressLookupTableAccount,
} from '@solana/web3.js';

const OKX_REFERRER = 'nexus-dex';
const PLATFORM_FEE = 0.03;
const SAFETY_FEE   = 0.02;
const TOTAL_FEE    = PLATFORM_FEE + SAFETY_FEE;
const OKX_SOL_NATIVE = '11111111111111111111111111111111';
const WSOL_MINT  = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_RESERVE_LAMPORTS = 5_000_000;
const QUOTE_DEBOUNCE_MS = 250;
const OKX_PRICE_CACHE_MS = 60_000;

const DEFAULT_BUY_PRESETS  = [25,50,100,250,500];
const DEFAULT_SELL_PRESETS = [50,100];
const PRESETS_LS_KEY = 'nexus_presets_v2';
const LAST_PAIR_LS_KEY = 'nexus_last_pair_v1';

const C = { bg:'#03060f',card:'#080d1a',card2:'#0c1220',card3:'#111d30',border:'rgba(0,229,255,0.10)',borderHi:'rgba(0,229,255,0.25)',accent:'#00e5ff',green:'#00ffa3',red:'#ff3b6b',text:'#cdd6f4',muted:'#586994',muted2:'#2e3f5e',buyGrad:'linear-gradient(135deg,#00e5ff,#0055ff)',sellGrad:'linear-gradient(135deg,#ff3b6b,#cc1144)',privy:'#a855f7' };

const POPULAR_TOKENS = [
  { mint:WSOL_MINT,symbol:'SOL',name:'Solana',decimals:9,chain:'solana',logoURI:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'},
  { mint:USDC_SOLANA,symbol:'USDC',name:'USD Coin',decimals:6,chain:'solana',logoURI:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png'},
];

function safeBigInt(v){if(v==null)return BigInt(0);if(typeof v==='bigint')return v;if(typeof v==='number')return Number.isFinite(v)?BigInt(Math.trunc(v)):BigInt(0);let s=String(v).trim();if(!s)return BigInt(0);if(/^-?0x[0-9a-f]+$/i.test(s))return BigInt(s);if(/^-?\d+$/.test(s))return BigInt(s);const n=Number(s);return Number.isFinite(n)?BigInt(Math.trunc(n)):BigInt(0);}
function tokensEqual(a,b){if(!a||!b)return false;if(a.chain==='solana'&&b.chain==='solana')return a.mint===b.mint;return false;}
function fmtUsd(n,d=2){if(n==null||isNaN(n))return'-';const v=Number(n);if(v>=1e9)return'$'+(v/1e9).toFixed(2)+'B';if(v>=1e6)return'$'+(v/1e6).toFixed(2)+'M';if(v>=1000)return'$'+v.toLocaleString('en-US',{maximumFractionDigits:d});if(v>=1)return'$'+v.toFixed(d);if(v>0)return'$'+v.toFixed(6);return'$0.00';}
function fmtTokenAmount(n,d=4){if(n==null||isNaN(n))return'0';const v=Number(n);if(v>=1e9)return(v/1e9).toFixed(2)+'B';if(v>=1e6)return(v/1e6).toFixed(2)+'M';if(v>=1000)return v.toLocaleString('en-US',{maximumFractionDigits:2});return v.toFixed(d);}
function shortAddr(a,h=4,t=4){if(!a||a.length<h+t)return a||'';return a.slice(0,h)+'\u2026'+a.slice(-t);}
function isValidSolMint(s){return!!s&&s.length>=32&&s.length<=44&&/^[1-9A-HJ-NP-Za-km-z]+$/.test(s);}
function toRawAmount(s,dec){if(!s||dec==null)return'0';let v=String(s).trim().replace(/,/g,'.').replace(/^\+/,'');if(!v||v.startsWith('-'))return'0';if(/e/i.test(v)){const n=Number(v);if(!Number.isFinite(n)||n<0)return'0';v=n.toFixed(Math.max(Number(dec)||0,20));}const d=Math.floor(Number(dec));if(!Number.isFinite(d)||d<0||d>18)return'0';const[w,f='']=v.split('.');const sw=(w||'0').replace(/[^\d]/g,'').replace(/^0+(?=\d)/,'')||'0';const ft=(f||'').replace(/[^\d]/g,'').slice(0,d);const fp=('0'.repeat(d)+ft).slice(-d);try{return(BigInt(sw)*(10n**BigInt(d))+BigInt(fp)).toString();}catch{return'0';}}

function normalizeToken(input){
  if(!input)return null;
  if(input.chain==='solana'&&input.mint)return input;

  const logo=input.logoURI||input.image||input.thumbnail||null;
  const sym=input.symbol||'TOKEN';
  const name=input.name||sym;
  const solMint=input.mint||(input.isSolanaToken?input.id:null);
  const parsedDecimals=Number(input.decimals);

  if(solMint&&isValidSolMint(solMint)){
    return {
      chain:'solana',
      mint:solMint,
      symbol:sym,
      name,
      decimals:Number.isFinite(parsedDecimals)?parsedDecimals:null,
      logoURI:logo
    };
  }

  return null;
}

function nativeOfChain(){return POPULAR_TOKENS.find(t=>t.mint===WSOL_MINT);}
function usdcOfChain(){return POPULAR_TOKENS.find(t=>t.mint===USDC_SOLANA);}

function defaultTokenPair({mode,viewedToken,lastFromToken,walletState}){
  const ws=walletState||{};const viewed=viewedToken?normalizeToken(viewedToken):null;
  if(mode==='buy'&&viewed){const f=POPULAR_TOKENS.find(t=>!tokensEqual(t,viewed))||POPULAR_TOKENS[0];return{fromToken:f,toToken:viewed};}
  if(mode==='sell'&&viewed){const t=POPULAR_TOKENS.find(t=>!tokensEqual(t,viewed))||POPULAR_TOKENS[1];return{fromToken:viewed,toToken:t};}
  if(lastFromToken&&!tokensEqual(lastFromToken,usdcOfChain()))return{fromToken:lastFromToken,toToken:usdcOfChain()};
  return{fromToken:nativeOfChain(),toToken:usdcOfChain()};
}

function pickRoute(){return'okx-sol';}
function toOkxSolAddress(m){return m===WSOL_MINT?OKX_SOL_NATIVE:m;}

// ---------- OKX token list (with decimals) ----------
let _okxCache=null;let _okxLoading=null;
function loadOkxSolTokens(){
  if(_okxCache)return Promise.resolve(_okxCache);
  if(_okxLoading)return _okxLoading;
  _okxLoading=fetch('/api/okx/dex/aggregator/all-tokens?chainIndex=501')
    .then(r=>r.ok?r.json():{data:[]})
    .catch(()=>({data:[]}))
    .then(j=>{
      const t=(j.data||[]).map(t=>({
        chain:'solana',mint:t.tokenContractAddress,
        symbol:t.tokenSymbol||'',name:t.tokenName||t.tokenSymbol||'',
        decimals:parseInt(t.decimals),logoURI:t.tokenLogoUrl||null,
      })).filter(t=>isValidSolMint(t.mint)&&t.symbol&&Number.isFinite(t.decimals));
      _okxCache=t;_okxLoading=null;return t;
    })
    .catch(e=>{_okxLoading=null;throw e;});
  return _okxLoading;
}

function getTokenDecimals(mint){
  if(!mint)return null;
  if(mint===WSOL_MINT||mint===OKX_SOL_NATIVE)return 9;
  const found=POPULAR_TOKENS.find(t=>t.mint===mint);
  if(found)return found.decimals;
  if(_okxCache){
    const okx=_okxCache.find(t=>t.mint===mint);
    if(okx&&Number.isFinite(Number(okx.decimals)))return Number(okx.decimals);
  }
  return null;
}

function getResolvedDecimals(token){
  if(!token)return null;
  const direct=Number(token.decimals);
  if(Number.isFinite(direct)&&direct>=0&&direct<=18)return direct;
  const found=getTokenDecimals(token.mint);
  if(Number.isFinite(Number(found))&&Number(found)>=0&&Number(found)<=18)return Number(found);
  return null;
}

// ---------- OKX price cache (USD display only) ----------
const _okxPriceCache=new Map();
function getCachedOkxPrice(mint){
  const e=_okxPriceCache.get(mint);
  if(!e)return null;
  if(Date.now()-e.ts>OKX_PRICE_CACHE_MS){_okxPriceCache.delete(mint);return null;}
  return e.price;
}
function setCachedOkxPrice(mint,price){
  if(!mint||price<=0)return;
  _okxPriceCache.set(mint,{price,ts:Date.now()});
}

async function fetchOkxPrice(token){
  if(!token?.mint)return null;

  const mint=token.mint;

  if(mint===USDC_SOLANA)return 1;

  const cached=getCachedOkxPrice(mint);
  if(cached!=null)return cached;

  await loadOkxSolTokens().catch(()=>{});

  const decimals=getResolvedDecimals(token);
  if(decimals==null)return null;

  const amount=(10n**BigInt(decimals)).toString();

  try{
    const params=new URLSearchParams({
      chainIndex:'501',
      fromTokenAddress:toOkxSolAddress(mint),
      toTokenAddress:USDC_SOLANA,
      amount,
    }).toString();

    const r=await fetch(`/api/okx/dex/aggregator/quote?${params}`);
    const j=await r.json();

    if(j.code==='0'&&j.data){
      const d=Array.isArray(j.data)?j.data[0]:j.data;
      const price=Number(d.toTokenAmount)/1e6;
      if(price>0){setCachedOkxPrice(mint,price);return price;}
    }
  }catch{}

  return null;
}

// ---------- OKX swap ----------
async function fetchOkxSolSwap({fromMint,toMint,amount,userWallet,signal}){
  const p=new URLSearchParams({
    chainIndex:'501',
    chainId:'501',
    fromTokenAddress:toOkxSolAddress(fromMint),
    toTokenAddress:toOkxSolAddress(toMint),
    amount:String(amount),
    slippagePercent:'15',
    userWalletAddress:userWallet,
    referrer:OKX_REFERRER,
  });
  const r=await fetch('/api/okx/dex/aggregator/swap-instruction?'+p.toString(),{signal});
  const j=await r.json();
  if(j.code!=='0'||!j.data)throw new Error(j.msg||'OKX swap-instruction failed');
  return Array.isArray(j.data)?j.data[0]:j.data;
}

function deserializeOkxIx(ix){
  try{
    if(!ix||!ix.programId||!Array.isArray(ix.accounts)||!ix.data)return null;
    return new TransactionInstruction({programId:new PublicKey(ix.programId),keys:ix.accounts.map(a=>({pubkey:new PublicKey(a.pubkey||a.publicKey||a.address),isSigner:!!a.isSigner,isWritable:!!a.isWritable})),data:Buffer.from(ix.data,'base64')});
  }catch{return null;}
}

async function buildOkxSolTx({connection,userPubkey,swapData}){
  if(swapData.tx&&swapData.tx.data){try{return VersionedTransaction.deserialize(Buffer.from(swapData.tx.data,'base64'));}catch{}}
  if(swapData.data&&typeof swapData.data==='string'){try{return VersionedTransaction.deserialize(Buffer.from(swapData.data,'base64'));}catch{}}
  const ixs=(swapData.instructionLists||[]).map(deserializeOkxIx).filter(Boolean);
  if(!ixs.length)throw new Error('No usable instructions in OKX response');
  const lta=Array.isArray(swapData.addressLookupTableAccount)?swapData.addressLookupTableAccount:[];
  const lts=(await Promise.all(lta.map(async a=>{try{const acct=await connection.getAccountInfo(new PublicKey(a));if(!acct)return null;return new AddressLookupTableAccount({key:new PublicKey(a),state:AddressLookupTableAccount.deserialize(acct.data)});}catch{return null;}}))).filter(Boolean);
  const{blockhash}=await connection.getLatestBlockhash('finalized');
  return new VersionedTransaction(new TransactionMessage({payerKey:userPubkey,recentBlockhash:blockhash,instructions:ixs}).compileToV0Message(lts));
}

function loadPresets(){try{const r=localStorage.getItem(PRESETS_LS_KEY);if(!r)return{buy:DEFAULT_BUY_PRESETS.slice(),sell:DEFAULT_SELL_PRESETS.slice()};const p=JSON.parse(r);return{buy:Array.isArray(p.buy)&&p.buy.length>=2?p.buy:DEFAULT_BUY_PRESETS.slice(),sell:Array.isArray(p.sell)&&p.sell.length>=1?p.sell:DEFAULT_SELL_PRESETS.slice()};}catch{return{buy:DEFAULT_BUY_PRESETS.slice(),sell:DEFAULT_SELL_PRESETS.slice()};}}
function savePresets(p){try{localStorage.setItem(PRESETS_LS_KEY,JSON.stringify(p));}catch{}}
function loadLastPair(){try{const v=JSON.parse(localStorage.getItem(LAST_PAIR_LS_KEY)||'null');return(!v||!v.from)?null:v;}catch{return null;}}
function saveLastPair(from,to){if(!from||!to)return;try{localStorage.setItem(LAST_PAIR_LS_KEY,JSON.stringify({from,to,ts:Date.now()}));}catch{}}
function maxSafeSolBalance(lamports){return lamports?Math.max(0,lamports-SOL_RESERVE_LAMPORTS)/LAMPORTS_PER_SOL:0;}

function TokenIcon({token,size=32}){const[err,setErr]=useState(false);if(token&&token.logoURI&&!err)return<img src={token.logoURI} alt="" style={{width:size,height:size,borderRadius:'50%',flexShrink:0}} onError={()=>setErr(true)}/>;const ch=(token&&token.symbol)?token.symbol.charAt(0).toUpperCase():'?';return<div style={{width:size,height:size,borderRadius:'50%',flexShrink:0,background:'rgba(0,229,255,.1)',border:'1px solid rgba(0,229,255,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:Math.round(size*.4),fontWeight:700,color:C.accent}}>{ch}</div>;}

let _bl=0;
function useBodyScrollLock(open){useEffect(()=>{if(!open)return;if(typeof document==='undefined')return;if(_bl===0)document.body.classList.add('nexus-scroll-locked');_bl++;return()=>{_bl=Math.max(0,_bl-1);if(_bl===0)document.body.classList.remove('nexus-scroll-locked');};},[open]);}
function useEscapeKey(open,handler){useEffect(()=>{if(!open)return;const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();handler?.();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[open,handler]);}

function TokenSelectModal({open,onClose,onSelect}){
  const[q,setQ]=useState('');const[sr,setSr]=useState([]);
  useEffect(()=>{const t=q.trim();if(!t){setSr([]);return;}const h=setTimeout(()=>{const sol=(_okxCache||[]).filter(tk=>tk.symbol&&tk.symbol.toLowerCase().includes(t.toLowerCase())).slice(0,30);const pop=POPULAR_TOKENS.filter(tk=>tk.symbol&&tk.symbol.toLowerCase().includes(t.toLowerCase()));setSr([...sol,...pop]);},200);return()=>clearTimeout(h);},[q]);
  const close=()=>{setQ('');setSr([]);onClose();};useBodyScrollLock(open);useEscapeKey(open,close);
  const hs=useCallback(t=>{onSelect(t);close();},[onSelect,close]);
  const disp=q.trim()?sr:POPULAR_TOKENS;
  if(!open)return null;
  return(<><div onClick={close} style={{position:'fixed',inset:0,zIndex:499,background:'rgba(0,0,0,.78)'}}/>
    <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',zIndex:500,background:C.card,border:'1px solid '+C.borderHi,borderRadius:18,width:'94vw',maxWidth:440,maxHeight:'min(85vh, 100dvh)',display:'flex',flexDirection:'column',boxShadow:'0 24px 80px rgba(0,0,0,.95)'}}>
      <div style={{padding:'16px 16px 10px',borderBottom:'1px solid '+C.border,flexShrink:0}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}><div style={{color:'#fff',fontWeight:700,fontSize:16}}>Select Token</div><button onClick={close} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:22,padding:4}}>x</button></div>
        <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, symbol..." style={{width:'100%',background:C.card2,border:'1px solid '+C.border,borderRadius:8,padding:'10px 12px',color:'#fff',fontSize:13,outline:'none',fontFamily:'Syne, sans-serif'}}/>
      </div>
      <div style={{overflowY:'auto',flex:1}}>
        {!q&&<div style={{padding:'8px 16px 4px',fontSize:10,color:C.muted,fontWeight:700}}>POPULAR</div>}
        {disp.length===0&&<div style={{padding:24,textAlign:'center',color:C.muted}}>No matches</div>}
        {disp.map((t,i)=>(<div key={(t.mint||'')+i} onClick={()=>hs(t)} style={{padding:'12px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid rgba(255,255,255,.03)'}}><TokenIcon token={t} size={32}/><div style={{flex:1}}><span style={{color:'#fff',fontWeight:700,fontSize:13}}>{t.symbol}</span><div style={{color:C.muted,fontSize:11}}>{t.name}</div></div></div>))}
      </div>
    </div></>);
}

/* ===== MAIN SWAP WIDGET ===== */
export default function SwapWidget({onConnectWallet,defaultFromToken,defaultToToken,compact=false,mode:modeProp='swap',presets:presetsProp,onPresetsChange,onStatusChange}){
  const{publicKey:extPk,sendTransaction:extSendTx,connected:solCon}=useWallet();const{connection}=useConnection();
  const nexus=useNexusWallet();const{activeWalletKind,privyEmbeddedSol}=nexus;
  const pubkey=useMemo(()=>{if(extPk)return extPk;if(privyEmbeddedSol?.address){try{return new PublicKey(privyEmbeddedSol.address);}catch{return null;}}return null;},[extPk,privyEmbeddedSol]);
  const hasSol=!!(solCon||(privyEmbeddedSol&&pubkey));const wcon=!!hasSol;

  const sendTx=useCallback(async(tx,conn)=>{
    try{const sim=await conn.simulateTransaction(tx,{sigVerify:false});if(sim&&sim.value&&sim.value.err)throw new Error('Transaction would fail');}catch(e){}
    if(activeWalletKind==='privy'&&privyEmbeddedSol){if(typeof privyEmbeddedSol.sendTransaction==='function')return privyEmbeddedSol.sendTransaction(tx,conn,{skipPreflight:false,maxRetries:3});if(typeof privyEmbeddedSol.signTransaction==='function'){const s=await privyEmbeddedSol.signTransaction(tx);return conn.sendRawTransaction(s.serialize(),{skipPreflight:true,maxRetries:3});}throw new Error('No sign method');}
    return extSendTx(tx,conn,{skipPreflight:false,maxRetries:3});
  },[activeWalletKind,privyEmbeddedSol,extSendTx]);

  const ip=useMemo(()=>{if(defaultFromToken||defaultToToken){const p=defaultTokenPair({mode:modeProp,viewedToken:defaultToToken||defaultFromToken,lastFromToken:null,walletState:{solConnected:solCon}});return{fromToken:defaultFromToken?normalizeToken(defaultFromToken):p.fromToken,toToken:defaultToToken?normalizeToken(defaultToToken):p.toToken};}const last=loadLastPair();return defaultTokenPair({mode:modeProp,viewedToken:null,lastFromToken:last?.from?normalizeToken(last.from):null,walletState:{solConnected:solCon}});},[]);
  const[ft,setFt]=useState(ip.fromToken||POPULAR_TOKENS[0]);const[tt,setTt]=useState(ip.toToken||POPULAR_TOKENS[1]);const[fa,setFa]=useState('');const utRef=useRef(false);
  const[quote,setQ]=useState(null);const[qe,setQe]=useState('');const[ss,setSs]=useState('idle');const[stx,setStx]=useState(null);const[se,setSe]=useState('');const[ps,setPs]=useState(false);
  const[sbl,setSbl]=useState(null);const[ssb,setSsb]=useState(null);
  const[pl,setPl]=useState(()=>presetsProp||loadPresets());const presets=presetsProp||pl;const setPresets=useCallback(p=>{if(onPresetsChange)onPresetsChange(p);else{setPl(p);savePresets(p);}},[onPresetsChange]);const[fso,setFso]=useState(false);const[tso,setTso]=useState(false);
  const[fp,setFp]=useState(null);const[tp,setTp]=useState(null);

  useEffect(()=>{onStatusChange?.(ss);},[ss,onStatusChange]);
  useEffect(()=>{if(!pubkey||!connection){setSbl(null);setSsb(null);return;}let c=false;connection.getBalance(pubkey).then(b=>{if(!c)setSbl(b);}).catch(()=>{});if(ft?.chain==='solana'&&ft.mint!==WSOL_MINT){connection.getParsedTokenAccountsByOwner(pubkey,{mint:new PublicKey(ft.mint)}).then(a=>{if(!c)setSsb(a.value.length?a.value[0].account.data.parsed.info.tokenAmount.uiAmount:0);}).catch(()=>{});}else{setSsb(null);}return()=>{c=true;};},[pubkey,connection,ft]);
  useEffect(()=>{if(ss!=='success')return;if(pubkey&&connection&&ft?.chain==='solana'){connection.getBalance(pubkey).then(setSbl).catch(()=>{});if(ft.mint!==WSOL_MINT)connection.getParsedTokenAccountsByOwner(pubkey,{mint:new PublicKey(ft.mint)}).then(a=>setSsb(a.value.length?a.value[0].account.data.parsed.info.tokenAmount.uiAmount:0)).catch(()=>{});}},[ss]);

  useEffect(()=>{let c=false;fetchOkxPrice(ft).then(p=>{if(!c)setFp(p);});return()=>{c=true;};},[ft]);
  useEffect(()=>{let c=false;fetchOkxPrice(tt).then(p=>{if(!c)setTp(p);});return()=>{c=true;};},[tt]);
  useEffect(()=>{loadOkxSolTokens().catch(()=>{});},[]);

  const fetchQ=useCallback(async()=>{
    setQe('');
    if(!fa||parseFloat(fa)<=0||tokensEqual(ft,tt)){
      setQ(null);
      if(tokensEqual(ft,tt))setQe('Cannot swap a token for itself.');
      return;
    }

    try{
      const fromDecimals=getResolvedDecimals(ft);
      const toDecimals=getResolvedDecimals(tt);

      if(fromDecimals==null||toDecimals==null){
        await loadOkxSolTokens().catch(()=>{});
      }

      const finalFromDecimals=getResolvedDecimals(ft);
      const finalToDecimals=getResolvedDecimals(tt);

      if(finalFromDecimals==null||finalToDecimals==null){
        setQe('Token decimals unavailable. Try searching/selecting the token again.');
        setQ(null);
        return;
      }

      const raw=toRawAmount(fa,finalFromDecimals);
      const params=new URLSearchParams({
        chainIndex:'501',
        fromTokenAddress:toOkxSolAddress(ft.mint),
        toTokenAddress:toOkxSolAddress(tt.mint),
        amount:raw,
      }).toString();

      const r=await fetch(`/api/okx/dex/aggregator/quote?${params}`);
      const j=await r.json();

      if(j.code!=='0'||!j.data){
        setQe(j.msg||'Quote not available');
        setQ(null);
        return;
      }

      const d=Array.isArray(j.data)?j.data[0]:j.data;
      const outAmount=Number(d.toTokenAmount)/Math.pow(10,finalToDecimals);

      setQ({
        engine:'okx',
        outAmountDisplay:outAmount.toFixed(outAmount<0.01?6:4),
        preview:false
      });
    }catch(e){
      setQe('Quote request failed');
      setQ(null);
    }
  },[fa,ft,tt]);

  useEffect(()=>{const t=setTimeout(fetchQ,QUOTE_DEBOUNCE_MS);return()=>clearTimeout(t);},[fetchQ]);

  const fbd=useMemo(()=>{if(ft?.chain==='solana')return ft.mint===WSOL_MINT?(sbl!=null?sbl/LAMPORTS_PER_SOL:null):ssb;return null;},[ft,sbl,ssb]);
  const onMax=useCallback(()=>{if(fbd==null||fbd<=0)return;utRef.current=true;const d=Math.min(getResolvedDecimals(ft)??6,9);if(ft?.chain==='solana'&&ft.mint===WSOL_MINT){setFa(maxSafeSolBalance(sbl).toFixed(d));return;}setFa(fbd.toFixed(d));},[fbd,ft,sbl]);
  const applyB=useCallback(d=>{if(fp>0){utRef.current=true;setFa((d/fp).toFixed(Math.min(getResolvedDecimals(ft)??6,9)));}},[fp,ft]);
  const applyS=useCallback(pct=>{if(fbd==null||fbd<=0)return;utRef.current=true;const d=Math.min(getResolvedDecimals(ft)??6,9);let a=fbd*(pct/100);if(pct===100&&ft?.chain==='solana'&&ft.mint===WSOL_MINT)a=maxSafeSolBalance(sbl);setFa(a.toFixed(d));},[fbd,ft,sbl]);
  const flip=useCallback(()=>{setFt(tt);setTt(ft);setFa('');setQ(null);setQe('');utRef.current=false;},[ft,tt]);

  const exec=useCallback(async()=>{
    if(!wcon){onConnectWallet?.();return;}
    setSs('loading');setSe('');setStx(null);
    try{
      const fromDecimals=getResolvedDecimals(ft);
      if(fromDecimals==null)throw new Error('Token decimals unavailable');

      const raw=toRawAmount(fa,fromDecimals);
      if(!raw||raw==='0')throw new Error('Invalid amount');
      if(!pubkey)throw new Error('Connect Solana wallet');

      const sd=await fetchOkxSolSwap({fromMint:ft.mint,toMint:tt.mint,amount:raw,userWallet:pubkey.toString()});
      const tx=await buildOkxSolTx({connection,userPubkey:pubkey,swapData:sd});
      const sig=await sendTx(tx,connection);

      setStx(sig);
      connection.confirmTransaction({signature:sig,blockhash:tx.message.recentBlockhash,lastValidBlockHeight:(await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight},'confirmed').catch(()=>{});
      saveLastPair(ft,tt);setSs('success');setFa('');setQ(null);utRef.current=false;
      setTimeout(()=>{setSs('idle');setStx(null);},6000);
    }catch(e){setSe(e.message||'Swap failed');setSs('error');setTimeout(()=>{setSs('idle');setSe('');},5000);}
  },[wcon,fa,ft,tt,pubkey,sendTx,connection,onConnectWallet]);

  useEffect(()=>{if(wcon&&ps){setPs(false);exec();}},[wcon,ps,exec]);

  const txLink=useMemo(()=>stx?'https://solscan.io/tx/'+stx:null,[stx]);
  const fuv=fa&&fp>0?parseFloat(fa)*fp:0;
  const tuv=quote&&tp>0?parseFloat(quote.outAmountDisplay)*tp:0;
  const td=quote?quote.outAmountDisplay:'0.00';
  const tc=quote?C.green:C.muted2;
  const showBuy=ft&&/^(SOL|USDC)$/i.test(ft.symbol||'');
  const showSell=modeProp==='sell';

  return(<div style={{width:'100%',maxWidth:compact?'100%':520,margin:'0 auto'}}>
    {!compact&&<div style={{marginBottom:16}}><h1 style={{fontSize:22,fontWeight:800,color:'#fff',margin:0}}>Swap</h1><p style={{color:C.muted,fontSize:12,marginTop:4}}>Solana. Powered by OKX DEX.</p></div>}
    <div style={{background:compact?'transparent':C.card,border:compact?'none':'1px solid '+C.border,borderRadius:compact?0:18,padding:compact?0:18}}>
      {showBuy&&<div style={{marginBottom:8}}><div style={{fontSize:10,color:C.muted,fontWeight:700,marginBottom:6}}>QUICK BUY</div><div style={{display:'flex',gap:5}}>{presets.buy.map((a,i)=><button key={i} onClick={()=>applyB(a)} style={{flex:1,padding:'10px 4px',borderRadius:8,border:'1px solid '+C.border,background:C.card2,color:C.muted,fontWeight:700,fontSize:12,cursor:'pointer',fontFamily:'Syne, sans-serif',minHeight:40}}>${a}</button>)}</div></div>}
      {showSell&&fbd>0&&<div style={{marginBottom:8}}><div style={{fontSize:10,color:C.muted,fontWeight:700,marginBottom:6}}>QUICK SELL</div><div style={{display:'flex',gap:5}}>{presets.sell.map((p,i)=><button key={i} onClick={()=>applyS(p)} style={{flex:1,padding:'10px 4px',borderRadius:8,border:'1px solid '+C.border,background:C.card2,color:C.muted,fontWeight:700,fontSize:12,cursor:'pointer',fontFamily:'Syne, sans-serif',minHeight:40}}>{p===100?'MAX':p+'%'}</button>)}</div></div>}

      <div style={{background:C.card2,borderRadius:12,padding:14,border:'1px solid '+C.border,marginBottom:4}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><span style={{fontSize:11,color:C.muted}}>YOU PAY</span>{fbd!=null&&<span style={{fontSize:11,color:C.muted}}>Balance: <span style={{color:C.text}}>{fmtTokenAmount(fbd)}</span></span>}</div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>setFso(true)} style={{display:'flex',alignItems:'center',gap:6,background:C.card3,border:'1px solid '+C.border,borderRadius:10,padding:'8px 10px',cursor:'pointer',flexShrink:0}}><TokenIcon token={ft} size={20}/><span style={{color:'#fff',fontWeight:700,fontSize:13}}>{ft?.symbol}</span></button>
          <input value={fa} onChange={e=>{utRef.current=true;setFa(e.target.value.replace(/[^0-9.]/g,''));}} placeholder="0.00" inputMode="decimal" style={{flex:1,background:'transparent',border:'none',fontSize:22,color:'#fff',textAlign:'right',outline:'none',fontFamily:'JetBrains Mono, monospace'}}/>
          {fbd>0&&<button onClick={onMax} style={{background:'rgba(0,229,255,.12)',border:'1px solid rgba(0,229,255,.25)',borderRadius:6,padding:'6px 10px',color:C.accent,fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0,fontFamily:'Syne, sans-serif'}}>MAX</button>}
        </div>
        {fuv>0&&<div style={{textAlign:'right',marginTop:5,fontSize:11,color:C.muted}}>{fmtUsd(fuv)}</div>}
      </div>

      <div style={{display:'flex',justifyContent:'center',margin:'8px 0'}}><button onClick={flip} style={{width:40,height:40,borderRadius:10,background:C.card3,border:'1px solid '+C.border,cursor:'pointer',color:C.accent,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>{'\u21F5'}</button></div>

      <div style={{background:C.card2,borderRadius:12,padding:14,border:'1px solid '+C.border}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><span style={{fontSize:11,color:C.muted}}>YOU RECEIVE</span></div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>setTso(true)} style={{display:'flex',alignItems:'center',gap:6,background:C.card3,border:'1px solid '+C.border,borderRadius:10,padding:'8px 10px',cursor:'pointer',flexShrink:0}}><TokenIcon token={tt} size={20}/><span style={{color:'#fff',fontWeight:700,fontSize:13}}>{tt?.symbol}</span></button>
          <div style={{flex:1,textAlign:'right',fontSize:22,color:tc,fontFamily:'JetBrains Mono, monospace'}}>{td}</div>
        </div>
        {tuv>0&&<div style={{textAlign:'right',marginTop:5,fontSize:11,color:C.muted}}>{fmtUsd(tuv)}</div>}
      </div>

      {qe&&<div style={{marginTop:8,padding:10,background:'rgba(255,59,107,.1)',border:'1px solid rgba(255,59,107,.2)',borderRadius:8,fontSize:12,color:C.red}}>{qe}</div>}

      {quote&&fa&&<div style={{marginTop:12,background:'#050912',borderRadius:10,padding:12}}>{[['Platform fee',fuv>0?fmtUsd(fuv*PLATFORM_FEE):(PLATFORM_FEE*100)+'%'],['Anti-MEV',(SAFETY_FEE*100)+'%']].map(i=><div key={i[0]} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:11}}><span style={{color:C.muted}}>{i[0]}</span><span style={{color:C.text}}>{i[1]}</span></div>)}</div>}

      {se&&<div style={{marginTop:10,padding:10,background:'rgba(255,59,107,.1)',border:'1px solid rgba(255,59,107,.3)',borderRadius:8,fontSize:12,color:C.red}}>{se}</div>}

      {!wcon?<button onClick={()=>onConnectWallet?.()} style={{width:'100%',marginTop:14,padding:16,borderRadius:12,border:'none',background:'linear-gradient(135deg,#9945ff,#7c3aed)',color:'#fff',fontFamily:'Syne, sans-serif',fontWeight:800,fontSize:15,cursor:'pointer',minHeight:52}}>Sign in to Swap</button>
      :<button onClick={exec} disabled={ss==='loading'||!fa} style={{width:'100%',marginTop:14,padding:16,borderRadius:12,border:'none',background:ss==='success'?'linear-gradient(135deg,#00ffa3,#00b36b)':ss==='error'?'rgba(255,59,107,.2)':!fa?C.card2:C.buyGrad,color:!fa?C.muted2:'#fff',fontFamily:'Syne, sans-serif',fontWeight:800,fontSize:15,cursor:ss==='loading'?'not-allowed':'pointer',minHeight:52}}>{ss==='loading'?'Confirming...':ss==='success'?'Done!':ss==='error'?'Retry':!fa?'Enter amount':'Swap '+(ft?.symbol||'')+' \u2192 '+(tt?.symbol||'')}</button>}

      {stx&&ss==='success'&&txLink&&<a href={txLink} target="_blank" rel="noreferrer" style={{display:'block',textAlign:'center',marginTop:10,fontSize:12,color:C.accent}}>View transaction</a>}
      <p style={{textAlign:'center',fontSize:10,color:C.muted2,marginTop:10}}>Non-custodial \u00b7 Powered by OKX DEX</p>
    </div>

    <TokenSelectModal open={fso} onClose={()=>setFso(false)} onSelect={t=>{setFt(t);setQ(null);setQe('');}}/>
    <TokenSelectModal open={tso} onClose={()=>setTso(false)} onSelect={t=>{setTt(t);setQ(null);setQe('');}}/>
  </div>);
}

/* ===== TRADE DRAWER ===== */
export function TradeDrawer({open,onClose,mode='buy',coin,onConnectWallet,presets,onPresetsChange}){
  const{connected:solCon}=useWallet();
  const nc=useMemo(()=>coin?normalizeToken(coin):null,[coin]);
  const pair=useMemo(()=>{return nc?defaultTokenPair({mode,viewedToken:nc,lastFromToken:null,walletState:{solConnected:solCon}}):defaultTokenPair({mode,viewedToken:null,lastFromToken:null,walletState:{solConnected:solCon}});},[nc,mode,solCon]);
  const wk=useMemo(()=>{const id=nc?(nc.mint||'tok'):'none';return id+'-'+mode;},[nc,mode]);
  const[sws,setSws]=useState('idle');const busy=sws==='loading';
  useEffect(()=>{if(open)setSws('idle');},[open]);
  const sc=useCallback(()=>{if(busy)return;onClose();},[busy,onClose]);
  useBodyScrollLock(open);useEscapeKey(open,sc);

  if(!open)return null;

  const sym=(nc&&nc.symbol)||(coin&&coin.symbol)||'';
  const img=(nc&&nc.logoURI)||(coin&&(coin.image||coin.logoURI));

  return(<><div onClick={sc} style={{position:'fixed',inset:0,zIndex:400,background:'rgba(0,0,0,.85)'}}/>
    <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:560,zIndex:401,background:C.card,borderTop:'2px solid '+C.borderHi,borderRadius:'20px 20px 0 0',boxShadow:'0 -20px 60px rgba(0,0,0,.9)',maxHeight:'min(90vh, 100dvh)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{flexShrink:0,padding:'16px 20px 12px'}}>
        <div onClick={sc} style={{width:40,height:4,background:C.muted2,borderRadius:2,margin:'0 auto 14px',cursor:busy?'default':'pointer',opacity:busy?0.4:1}}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {img&&<img src={img} alt="" style={{width:28,height:28,borderRadius:'50%'}} onError={e=>e.currentTarget.style.display='none'}/>}
            <div style={{color:mode==='buy'?C.accent:C.red,fontWeight:800,fontSize:17}}>{mode==='buy'?'Buy':'Sell'} {sym.toUpperCase()}</div>
          </div>
          <button onClick={sc} disabled={busy} style={{background:'none',border:'none',color:busy?C.muted2:C.muted,fontSize:26,cursor:busy?'not-allowed':'pointer',padding:4}}>x</button>
        </div>
      </div>
      <div style={{flex:1,minHeight:0,overflowY:'auto',padding:'4px 20px',paddingBottom:'calc(env(safe-area-inset-bottom) + 80px)'}}>
        <SwapWidget key={wk} onConnectWallet={onConnectWallet} defaultFromToken={pair.fromToken} defaultToToken={pair.toToken} compact={true} mode={mode} presets={presets} onPresetsChange={onPresetsChange} onStatusChange={setSws}/>
      </div>
    </div></>);
}