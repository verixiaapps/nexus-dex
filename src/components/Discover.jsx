import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BRANDS, fetchBrandPrices, stkFetchSeries, stkThrottle } from './Stocks.jsx';
  
// =====================================================================
// Discover — the main discovery page. Self-contained by design (mirrors
// the anti-coupling pattern used across the app): its own fetch,
// normalizers, sparkline and score, so a stale export elsewhere can't
// break the build. Sources are IDENTICAL to LiveTokenFeeds:
//   /api/dex/launches                          → pump.fun launches
//   /api/jupiter/tokens/v2/toporganicscore/24h → graduated (Jupiter)
//   BRANDS + fetchBrandPrices                → xStocks (icons fetched inline)
// Every token is opened via onOpenToken(), so the existing pump/Jupiter
// TokenSheet and StockTradeModal handle trading unchanged.
// =====================================================================
const C = {
  ink:'#0b0b0c', ink2:'#86868b', ink3:'#aeaeb2',
  cyan:'#2f6bff', lav:'#7c5cff', green:'#16c08a', peach:'#f5921b', gold:'#a67200',
  red:'#f0425a', down:'#9d8cff',
  glass:'#ffffff', border:'#e9e9eb', borderHi:'#0b0b0c', hairline:'#f1f1f2',
};
const MONO = "'JetBrains Mono', monospace";
const SERIF = "'Instrument Serif', serif";
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ── Debug overlay ─────────────────────────────────────────────────────
// Paints a RAW-DOM panel (not React) so it survives even when an uncaught
// render error tears the React root down to a white screen. Shows the real
// error message + stack with Copy/Dismiss. Because it's driven by a global
// window listener, it catches crashes ANYWHERE — including the trade sheet,
// which App renders in its own tree, outside this component.
function paintDebug(title, message, stack, componentStack){
  try{
    let el = document.getElementById('nx-debug-overlay');
    if(!el){ el = document.createElement('div'); el.id='nx-debug-overlay'; document.body.appendChild(el); }
    el.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#0b0b0c;color:#e6e6e6;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;padding:18px 14px 60px;overflow:auto;-webkit-overflow-scrolling:touch';
    el.innerHTML='';
    const head=document.createElement('div');
    head.style.cssText='color:#f0425a;font-weight:700;font-size:14px;margin-bottom:6px';
    head.textContent='\u26A0 '+(title||'Runtime error');
    el.appendChild(head);
    const add=(label,text)=>{ if(!text) return;
      const l=document.createElement('div'); l.style.cssText='color:#9d8cff;font-weight:700;letter-spacing:.08em;margin:14px 0 4px'; l.textContent=label;
      const p=document.createElement('pre'); p.style.cssText='margin:0;white-space:pre-wrap;word-break:break-word;color:#c9d1d9'; p.textContent=String(text);
      el.appendChild(l); el.appendChild(p);
    };
    add('MESSAGE', message);
    add('STACK', stack);
    add('COMPONENT STACK', componentStack);
    const mk=(txt,bg,right,fn)=>{ const b=document.createElement('button'); b.textContent=txt; b.style.cssText='position:fixed;top:12px;right:'+right+'px;background:'+bg+';color:#fff;border:none;border-radius:8px;padding:8px 13px;font:700 12px monospace;z-index:2147483647'; b.onclick=fn; el.appendChild(b); };
    mk('Copy','#16c08a',14,()=>{ try{ navigator.clipboard.writeText([title,message,stack,componentStack].filter(Boolean).join('\n\n')); }catch(_){} });
    mk('Dismiss','#3a3a3a',88,()=>{ el.remove(); });
  }catch(_){}
}

class DiscoverBoundary extends React.Component {
  constructor(p){ super(p); this.state={ err:null }; }
  static getDerivedStateFromError(err){ return { err }; }
  componentDidCatch(err, info){ paintDebug('Discover render error', err&&(err.message||String(err)), err&&err.stack, info&&info.componentStack); }
  componentDidMount(){
    this._onErr = (e)=>{ const er=e.error||e; paintDebug('Uncaught error', (er&&er.message)||e.message||String(er), er&&er.stack, null); };
    this._onRej = (e)=>{ const r=e.reason||e; paintDebug('Unhandled promise rejection', (r&&r.message)||String(r), r&&r.stack, null); };
    window.addEventListener('error', this._onErr);
    window.addEventListener('unhandledrejection', this._onRej);
  }
  componentWillUnmount(){
    window.removeEventListener('error', this._onErr);
    window.removeEventListener('unhandledrejection', this._onRej);
  }
  render(){
    if(this.state.err){
      return (<div style={{padding:'40px 16px',fontFamily:MONO,fontSize:12,color:'#f0425a'}}>
        Discover failed to render — see the debug panel below. {String((this.state.err&&this.state.err.message)||this.state.err)}
      </div>);
    }
    return this.props.children;
  }
}

// ── formatters (kept local — same behavior as App.fmtUsd/fmtPct) ──────
function fmtUsd(n){
  if(!Number.isFinite(n)||n<=0) return '—';
  if(n>=1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if(n>=1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if(n>=1e3) return '$'+(n/1e3).toFixed(1)+'K';
  if(n>=1)   return '$'+n.toFixed(2);
  if(n>=0.01)return '$'+n.toFixed(4);
  return '$'+n.toPrecision(2);
}
const fmtPct = n => Number.isFinite(n) ? (n>=0?'+':'')+n.toFixed(2)+'%' : '—';
function pctFromSeries(pts){
  if(!pts||pts.length<2) return null;
  const a=pts[0].c, b=pts[pts.length-1].c;
  if(!(a>0)) return null;
  return ((b-a)/a)*100;
}
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const log10 = v => Math.log(Math.max(1,v))/Math.LN10;

// ── field pickers (robust across feed shapes, copied from App) ────────
function pickChange(t){
  const v=Number(t?.priceChange24h ?? t?.priceChange?.h24 ?? t?.stats24h?.priceChange ??
    t?.change24h ?? t?.change ?? t?.priceChangePercent24h ?? t?.h24 ?? 0);
  return Number.isFinite(v)?v:0;
}
function pickPrice(t){
  const d=Number(t?.price ?? t?.priceUsd ?? t?.usdPrice ?? t?.price_usd ?? t?.priceUSD ??
    t?.usd ?? t?.priceNative ?? t?.lastPrice ?? t?.stats24h?.price ?? t?.firstPool?.price ?? 0);
  if(d>0) return d;
  const mc=Number(t?.mcap ?? t?.marketCap ?? t?.fdv ?? 0);
  const sup=Number(t?.supply ?? t?.totalSupply ?? t?.circulatingSupply ?? 0);
  return (mc>0&&sup>0)?mc/sup:0;
}
const LR_EMOJI=['\u{1F680}','\u{1FA99}','\u{1F438}','\u{1F525}','\u{26A1}','\u{1F311}','\u{1F48E}','\u{1F9B4}','\u{1F436}','\u{1F431}','\u{1F34C}','\u{1F451}','\u{1F9EA}','\u{1F3AF}','\u{1F6F8}','\u{1F30A}'];
function emojiFor(sym){ sym=sym||''; let h=0; for(let i=0;i<sym.length;i++) h=(h*31+sym.charCodeAt(i))|0; return LR_EMOJI[Math.abs(h)%LR_EMOJI.length]; }
function ageMsOf(iso){ return iso ? Date.now()-new Date(iso).getTime() : Infinity; }
function ageStr(ms){
  if(!Number.isFinite(ms)||ms<0) return '';
  const m=ms/60000;
  if(m<1)  return Math.max(1,Math.round(ms/1000))+'s';
  if(m<60) return Math.round(m)+'m';
  const h=m/60; if(h<24) return Math.round(h)+'h';
  return Math.round(h/24)+'d';
}
const STABLE=new Set(['USDC','USDT','USD1','USDH','USDS','DAI','PYUSD','USDD','FDUSD','TUSD','USDE','CASH','BUSD','USDY','EURC','FRAX']);
function isStable(t){
  const s=String(t?.sym||'').toUpperCase().replace(/^\$/,'');
  if(STABLE.has(s)) return true;
  const p=Number(t?.price), ch=Math.abs(Number(t?.change)||0);
  return p>0.95&&p<1.05&&ch<0.5&&/USD|DAI/.test(s);
}
function uniqMint(list){
  const seen=new Set();
  return list.filter(t=>{
    if(!t||!t.mint) return false;
    const clone=(t.sym||'')+'|'+(t.icon||'')+'|'+Math.round(t.mcap||0);
    if(seen.has(t.mint)||seen.has(clone)) return false;
    seen.add(t.mint); seen.add(clone); return true;
  });
}

// xStock logos — inlined exactly like App.js's appFetchBrandIcons (same
// /api/jupiter/tokens/search endpoint). Kept local so Discover depends only on
// the Stocks.jsx exports App.js already imports (BRANDS, fetchBrandPrices,
// stkFetchSeries, stkThrottle) — never a newer export the live bundle may lack.
async function fetchStockIcons(mints){
  if(!mints||!mints.length) return {};
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),8000);
    const r=await fetch(`/api/jupiter/tokens/search?query=${encodeURIComponent(mints.join(','))}`,{headers:{Accept:'application/json'},signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok) return {};
    const data=await r.json();
    const arr=Array.isArray(data)?data:(data?.tokens||[]);
    const out={};
    for(const tk of arr){ const id=tk?.id||tk?.address; if(!id) continue; const url=tk.icon||tk.logoURI||null; if(url) out[id]=url; }
    return out;
  }catch{ return {}; }
}

// ── normalizers — same mapping + route tags App/TokenSheet expect ─────
function normalizePump(t){
  const mint=t&&t.mint;
  if(!mint||typeof mint!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  const ms=ageMsOf(t.pairCreatedAt);
  return {
    mint, sym:t.sym||'???', name:t.name||t.sym||'Unknown',
    emoji:emojiFor(t.sym||''), icon:t.icon||null,
    price:pickPrice(t), change:pickChange(t),
    age:ageStr(ms), ageMs:ms,
    mcap:Number(t.mcap||t.fdv||0), volume24h:Number(t.volume24h||0),
    liquidity:Number(t.liquidity||0), holders:Number(t.holders||t.holderCount||0),
    decimals:Number(t.decimals==null?6:t.decimals),
    dexId:t.dexId||null,
    pool:t.pairAddress||t.poolAddress||t.pool||t.poolId||t.pairId||(t.firstPool&&(t.firstPool.id||t.firstPool.address))||null,
    route:'pump', kind:'new',
  };
}
function normalizeJup(t){
  const created=t.firstPool?.createdAt||t.createdAt;
  const ms=ageMsOf(created);
  return {
    mint:t.id||t.address||t.mint, sym:t.symbol||'???', name:t.name||t.symbol||'Unknown',
    emoji:emojiFor(t.symbol||''), icon:t.icon||t.logoURI||null,
    price:pickPrice(t), change:pickChange(t),
    age:ageStr(ms), ageMs:ms,
    mcap:Number(t.mcap??t.fdv??0),
    volume24h:Number(t?.stats24h?.buyVolume??0)+Number(t?.stats24h?.sellVolume??0),
    holders:Number(t.holderCount||0), liquidity:Number(t.liquidity||0),
    decimals:Number(t.decimals??6),
    route:'jupiter', kind:ms<24*3600*1000?'new':'graduated',
  };
}

// =====================================================================
// NEXUS SCORE — composite 0-100 from four honest signals derived from
// real feed fields. Momentum 34 / Liquidity 26 / Holders 20 / Safety 20.
// =====================================================================
function signalsFor(t){
  const mom = clamp(50 + clamp(t.change,-60,120)*0.42, 4, 99);
  const liq = clamp((log10(t.liquidity)-3.5)/(6.7-3.5)*100, 3, 100);
  const hold= t.holders>0 ? clamp((log10(t.holders)-2)/(4.6-2)*100, 3, 100)
                          : clamp(liq*0.6, 3, 60);           // unknown holders → infer from depth
  const ageH = Number.isFinite(t.ageMs) ? t.ageMs/3.6e6 : 0;
  const ageScore = clamp((log10(ageH*60+1)-1)/(4.3-1)*100, 4, 100); // minutes → weeks
  const safe = clamp(ageScore*0.6 + liq*0.4, 3, 99);
  return { mom, liq, hold, safe };
}
function scoreOf(sig){ return Math.round(sig.mom*0.34 + sig.liq*0.26 + sig.hold*0.20 + sig.safe*0.20); }
function grade(s){
  if(s>=90) return {g:'A+',c:C.green};
  if(s>=82) return {g:'A', c:C.green};
  if(s>=72) return {g:'B', c:C.cyan};
  if(s>=60) return {g:'C', c:C.peach};
  return {g:'D', c:C.down};
}
function verdictText(sig){
  const parts=[];
  if(sig.mom>=80) parts.push('strong momentum'); else if(sig.mom>=55) parts.push('steady momentum'); else parts.push('cooling momentum');
  if(sig.liq>=75) parts.push('deep liquidity'); else if(sig.liq<45) parts.push('thin liquidity');
  if(sig.hold>=80) parts.push('a proven holder base'); else if(sig.hold<45) parts.push('an early holder base');
  const sc=scoreOf(sig);
  const lead = sc>=82?'Top-rated':sc>=72?'Solid':'Higher risk';
  return lead+' — '+parts.slice(0,2).join(' and ')+'.';
}

// ── sparkline (Catmull-Rom, same as App.Spark) ────────────────────────
const _spkHist=new Map();
function recordSpark(mint,price){
  if(!mint||!(price>0)) return _spkHist.get(mint)||[];
  let pts=_spkHist.get(mint); if(!pts){pts=[];_spkHist.set(mint,pts);}
  if(pts[pts.length-1]!==price){ pts.push(price); if(pts.length>32) pts.shift(); }
  return pts;
}
function endpointSeries(price,change){
  const now=Number(price); if(!(now>0)) return null;
  const c=Number(change);
  const then=(Number.isFinite(c)&&Math.abs(c)>0.001)?now/(1+c/100):now*0.985;
  if(!(then>0)) return null;
  const N=20,out=[];
  for(let i=0;i<N;i++){ const t=i/(N-1); const e=t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; out.push({c:then+(now-then)*e}); }
  return out;
}
function Spark({ pts, mint, price, change, w=52, h=26 }){
  const hist=recordSpark(mint,Number(price));
  const obs=hist.length>=2?hist.map(c=>({c})):null;
  const use=(pts&&pts.length>=2)?pts:(obs||endpointSeries(price,change));
  if(!use) return <svg width={w} height={h} style={{display:'block',flex:'0 0 auto'}} />;
  const vals=use.map(p=>p.c), n=vals.length, pad=3;
  let lo=Math.min(...vals), hi=Math.max(...vals);
  if(!(hi>lo)){ const m=lo||1; hi=m*1.001; lo=m*0.999; }
  const x=i=>pad+(i/(n-1))*(w-pad*2), y=v=>pad+(1-(v-lo)/(hi-lo))*(h-pad*2);
  const P=vals.map((v,i)=>({x:x(i),y:y(v)}));
  let d=`M${P[0].x.toFixed(1)},${P[0].y.toFixed(1)}`;
  for(let i=0;i<n-1;i++){ const p0=P[i-1]||P[i],p1=P[i],p2=P[i+1],p3=P[i+2]||P[i+1];
    d+=` C${(p1.x+(p2.x-p0.x)/6).toFixed(1)},${(p1.y+(p2.y-p0.y)/6).toFixed(1)} ${(p2.x-(p3.x-p1.x)/6).toFixed(1)},${(p2.y-(p3.y-p1.y)/6).toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`; }
  const up=Number.isFinite(change)?change>=0:vals[vals.length-1]>=vals[0];
  const col=up?C.green:C.down, gid='dspk'+(mint?String(mint).slice(0,6):'')+(up?'u':'d');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{display:'block',flex:'0 0 auto',overflow:'visible'}}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="0.18"/><stop offset="1" stopColor={col} stopOpacity="0"/></linearGradient></defs>
      <path d={`${d} L${P[n-1].x.toFixed(1)},${h} L${P[0].x.toFixed(1)},${h} Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={P[n-1].x.toFixed(1)} cy={P[n-1].y.toFixed(1)} r="1.8" fill={col} />
    </svg>
  );
}

// ── shared bits ───────────────────────────────────────────────────────
function SectionHead({ title, italic, meta, onAll }){
  return (
    <div style={{padding:'22px 4px 10px',display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10}}>
      <h2 style={{fontFamily:SERIF,fontSize:22,lineHeight:1,letterSpacing:'-0.015em',fontWeight:400,margin:0}}>
        {title} <em style={{fontStyle:'italic',background:'linear-gradient(120deg,#A0E7FF,#FF8FBE)',WebkitBackgroundClip:'text',backgroundClip:'text',color:'transparent'}}>{italic}</em>
      </h2>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <span style={{display:'inline-flex',alignItems:'center',gap:5,fontFamily:MONO,fontSize:9,fontWeight:700,color:C.green,letterSpacing:'0.12em',background:'rgba(22,192,138,.10)',border:`1px solid ${C.border}`,padding:'3px 8px',borderRadius:999}}>
          <span style={{width:5,height:5,borderRadius:'50%',background:C.green,boxShadow:`0 0 6px ${C.green}`,animation:'nx-pulse 1.4s infinite'}} />{meta}
        </span>
        {onAll && <button onClick={onAll} style={{background:'none',border:'none',cursor:'pointer',fontFamily:MONO,fontSize:10,fontWeight:700,color:C.cyan,letterSpacing:'0.06em'}}>All →</button>}
      </div>
    </div>
  );
}
function ScoreBadge({ score }){
  const {g,c}=grade(score);
  return (
    <div style={{flex:'0 0 auto',width:38,height:38,borderRadius:11,display:'grid',placeItems:'center',background:c+'14',border:`1px solid ${c}33`}}>
      <div style={{fontFamily:MONO,fontSize:14,fontWeight:700,lineHeight:1,color:c}}>{g}</div>
      <div style={{fontFamily:MONO,fontSize:8,fontWeight:700,marginTop:1,color:c,opacity:.75}}>{score}</div>
    </div>
  );
}

// ── one row ─────────────────────────────────────────────────────────────
function TokenRow({ t, rank, last, onOpen }){
  const up=Number.isFinite(t.pct)?t.pct>=0:true;
  const isImg=typeof t.ico==='string'&&/^https?:\/\//.test(t.ico);
  return (
    <button onClick={onOpen} style={{display:'flex',alignItems:'center',gap:9,padding:'11px 12px',width:'100%',background:'transparent',border:'none',borderBottom:last?'none':`1px solid ${C.hairline}`,cursor:'pointer',fontFamily:'inherit',textAlign:'left'}}>
      <div style={{position:'relative',width:36,height:36,borderRadius:11,flex:'0 0 auto',display:'grid',placeItems:'center',color:'#fff',fontWeight:800,fontSize:14,background:t.grad,backgroundSize:'cover',backgroundPosition:'center',...(isImg?{backgroundImage:`url(${t.ico})`}:{})}}>
        {!isImg?(t.ico||'?'):''}
        {rank!=null && <div style={{position:'absolute',top:-5,left:-5,width:16,height:16,borderRadius:6,background:'#0b0b0c',color:'#fff',fontFamily:MONO,fontSize:8,fontWeight:700,display:'grid',placeItems:'center'}}>{rank}</div>}
      </div>
      <div style={{minWidth:0,flex:1}}>
        <div style={{fontWeight:700,fontSize:14,letterSpacing:'-0.01em',display:'flex',alignItems:'center',gap:6}}>
          {t.sym}
          <span style={{fontFamily:MONO,fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:4,letterSpacing:'0.04em',textTransform:'uppercase',
            color:t.kind==='new'?C.green:C.ink3, background:t.kind==='new'?'rgba(22,192,138,.12)':'#f4f4f5'}}>
            {t.kind==='new'?t.age:t.kind}
          </span>
        </div>
        <div style={{fontSize:10.5,color:C.ink3,fontWeight:500,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {t.sub || `MC ${fmtUsd(t.mcap)} · Liq ${fmtUsd(t.liquidity)}${t.holders>0?` · ${t.holders.toLocaleString()} holders`:''}`}
        </div>
      </div>
      <Spark pts={t.pts} mint={t.mint} price={t.price} change={t.pct} />
      <ScoreBadge score={t.score} />
      <div style={{textAlign:'right',flex:'0 0 auto',minWidth:60}}>
        <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:C.ink}}>{fmtUsd(t.price)}</div>
        <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,marginTop:1,color:up?C.green:C.down}}>{fmtPct(t.pct)}</div>
      </div>
    </button>
  );
}

// =====================================================================
// MAIN
// =====================================================================
function DiscoverInner({ onSwitchTab, onOpenToken, onConnectWallet }){
  const [pumpToks,setPumpToks]=useState([]);
  const [jupToks,setJupToks]=useState([]);
  const [stockToks,setStockToks]=useState([]);
  const [series,setSeries]=useState({});
  const [whales,setWhales]=useState([]);
  const [filter,setFilter]=useState('all');
  const [sort,setSort]=useState('score');
  const fetched=useRef({});

  // sparkline loader (throttled — only for rendered rows). No pool hint passed:
  // matches LiveTokenFeeds (the home feed), so the series can't be pulled from an
  // unverified pool — and can't poison stkResolvePool's pool cache (stkFetchSeries
  // caches any poolHint you hand it, in memory AND localStorage). If no series
  // comes back, Spark falls back to the token's own price + real 24h change.
  // tf mirrors the app: '1D' for tokens (LiveTokenFeeds), '1M' for stocks (XStocksStrip).
  const loadSeries=(list,tf='1D')=>{
    list.forEach(t=>{
      if(!t||fetched.current[t.mint]) return;
      fetched.current[t.mint]=true;
      stkThrottle(()=>stkFetchSeries(t.mint,tf))
        .then(s=>{ if(s&&s.length>=2) setSeries(prev=>({...prev,[t.mint]:s})); })
        .catch(()=>{ fetched.current[t.mint]=false; });
    });
  };

  // pump + jupiter feeds (identical endpoints to LiveTokenFeeds)
  useEffect(()=>{
    let dead=false;
    const pullPump=async()=>{
      try{
        const r=await fetch('/api/dex/launches'); if(!r.ok) return;
        const d=await r.json();
        const list=uniqMint((Array.isArray(d?.tokens)?d.tokens:[]).map(normalizePump).filter(Boolean)).slice(0,30);
        if(!dead){ setPumpToks(list); loadSeries(list.slice(0,15)); }
      }catch{}
    };
    const pullJup=async()=>{
      try{
        const r=await fetch('/api/jupiter/tokens/v2/toporganicscore/24h?limit=40');
        const d=await r.json();
        const raw=Array.isArray(d)?d:(d?.data||d?.tokens||[]);
        const list=uniqMint(raw.map(normalizeJup).filter(t=>t.mint&&t.mint!==SOL_MINT&&t.sym!=='WSOL'&&t.sym!=='SOL'&&!isStable(t)));
        if(!dead){ setJupToks(list); loadSeries(list.slice(0,20)); }
      }catch{}
    };
    pullPump(); pullJup();
    const id=setInterval(()=>{ pullPump(); pullJup(); },5000);
    return ()=>{ dead=true; clearInterval(id); };
  },[]);

  // xStocks — uses only the Stocks.jsx exports App.js already imports, so it
  // can't call an undefined function in the live bundle. Price from
  // fetchBrandPrices ({mint: price}); 24h direction comes from the '1M' series
  // (pctFromSeries, like XStocksStrip); logos via the inline search fetch.
  // Opening one routes to StockTradeModal through App.openToken (matched by mint).
  const [stockIcons,setStockIcons]=useState({});
  useEffect(()=>{
    let dead=false;
    const picks=BRANDS.slice(0,12);
    const mints=picks.map(b=>b.mint);
    fetchStockIcons(mints).then(ic=>{ if(!dead) setStockIcons(ic||{}); }).catch(()=>{});
    const load=async()=>{
      const prices=await fetchBrandPrices(mints).catch(()=>({}));
      if(dead) return;
      const list=picks.map(b=>{
        const price=Number(prices?.[b.mint])||0;
        return { mint:b.mint, sym:b.ticker, name:b.name, icon:null, emoji:(b.ticker||'?').charAt(0),
          price, change:0, mcap:0, liquidity:0, holders:0, volume24h:0,
          age:'24/7', ageMs:Infinity, decimals:b.decimals,
          sub:`${b.name} · Tokenized equity · 24/7`, route:'stock', kind:'stock' };
      }).filter(x=>x.price>0);
      setStockToks(list);
      loadSeries(list,'1M');
    };
    load(); const id=setInterval(load,30000);
    return ()=>{ dead=true; clearInterval(id); };
  },[]);

  // whale feed (same /api/whale-events source as WhaleFeed)
  useEffect(()=>{
    let dead=false;
    const load=async()=>{
      try{
        const r=await fetch('/api/whale-events?since='+(48*3600*1000)); if(!r.ok) return;
        const d=await r.json();
        if(!dead) setWhales(Array.isArray(d?.events)?d.events.slice(0,5):[]);
      }catch{}
    };
    load(); const id=setInterval(load,12000);
    return ()=>{ dead=true; clearInterval(id); };
  },[]);

  // merge → score → decorate. Stocks score high on safety, momentum from the
  // '1M' series direction; their logos come from the inline icon fetch.
  const all=useMemo(()=>{
    const merged=uniqMint([...pumpToks,...jupToks,...stockToks]);
    return merged.map(t=>{
      const cs=pctFromSeries(series[t.mint]);
      const pct=Number.isFinite(cs)?cs:(Number.isFinite(t.change)?t.change:0);
      const icon=t.route==='stock'?(stockIcons[t.mint]||t.icon):t.icon;
      const withPct={...t,icon,pct};
      const sig=t.kind==='stock'
        ? {mom:clamp(50+clamp(pct,-15,15)*1.2,20,90),liq:92,hold:80,safe:95}
        : signalsFor(withPct);
      return {...withPct, sig, score:scoreOf(sig), pts:series[t.mint]};
    });
  },[pumpToks,jupToks,stockToks,stockIcons,series]);

  // filter + sort
  const view=useMemo(()=>{
    let list=all.slice();
    if(filter==='new')        list=list.filter(t=>t.route==='pump'||(t.ageMs<24*3600*1000));
    else if(filter==='graduated') list=list.filter(t=>t.route==='jupiter');
    else if(filter==='stock') list=list.filter(t=>t.route==='stock');
    else if(filter==='gainers')   list=list.filter(t=>t.pct>0);
    else if(filter==='trending')  list=list.filter(t=>t.route!=='stock');
    const cmp={
      score:(a,b)=>b.score-a.score,
      vol:(a,b)=>(b.volume24h||0)-(a.volume24h||0),
      chg:(a,b)=>(b.pct||0)-(a.pct||0),
      age:(a,b)=>(a.ageMs||0)-(b.ageMs||0),
    }[filter==='trending'?'vol':filter==='gainers'?'chg':sort];
    return list.sort(cmp).slice(0,40);
  },[all,filter,sort]);

  const spotlight=useMemo(()=> all.length ? [...all].filter(t=>t.route!=='stock').sort((a,b)=>b.score-a.score)[0] : null, [all]);

  // Open a token through the app's existing router (pump/Jupiter sheet or stock
  // modal). Pump.fun is the tricky one: NEVER hand SheetChart a raw feed pool as
  // a hint. A hint short-circuits SheetChart (`pumpFirst && !poolHint`), skipping
  // BOTH the real pump-candle path AND the contract-matched resolver — so an
  // unverified address could embed a look-alike mint. Nulling pool for
  // route==='pump' forces resolution BY CONTRACT: pump candles first, then
  // /api/nx/pool, then the base-token-exact + deepest-liquidity GeckoTerminal
  // pool (pickBestGeckoPool). Jupiter tokens already carry no pool, so they
  // always take the same contract-matched path.
  const open=(t)=>{
    // Hand the sheet the SAME shape the home feed (LiveTokenFeeds) passes.
    // Strip Discover-only extras (sig/score/pts/kind/ageMs) so nothing unexpected
    // reaches PumpTokenSheet / JupiterTokenSheet. Pump pool nulled for
    // contract-safe chart resolution.
    const { sig, score, pts, kind, ageMs, ...clean } = t;
    const payload = {
      ...clean,
      ico: clean.icon || clean.emoji,
      grad: clean.route==='stock' ? 'linear-gradient(135deg,#2f6bff,#1e49c9)' : 'linear-gradient(135deg,#f5921b,#d4760a)',
      price: clean.price, pct: t.pct, tf: '1D',
      stats: `MC ${fmtUsd(clean.mcap)} · Liq ${fmtUsd(clean.liquidity)}`,
      tab: clean.route==='stock' ? 'markets' : clean.route==='jupiter' ? 'wonderland' : 'launchradar',
    };
    if (payload.route==='pump') payload.pool = null;
    try { return onOpenToken(payload); }
    catch (e) { paintDebug('onOpenToken threw', e && (e.message||String(e)), e && e.stack, null); }
  };

  const counts=useMemo(()=>({
    all:all.length,
    trending:all.filter(t=>t.route!=='stock').length,
    new:all.filter(t=>t.route==='pump'||t.ageMs<24*3600*1000).length,
    gainers:all.filter(t=>t.pct>0).length,
    graduated:all.filter(t=>t.route==='jupiter').length,
    stock:all.filter(t=>t.route==='stock').length,
  }),[all]);

  const totalVol=useMemo(()=>all.reduce((s,t)=>s+(t.volume24h||0),0),[all]);
  const newCount=counts.new;
  const avgScore=all.length?Math.round(all.reduce((s,t)=>s+t.score,0)/all.length):0;

  const CHIPS=[['all','All'],['trending','Trending'],['new','New'],['gainers','Gainers'],['graduated','Graduated'],['stock','Stocks']];
  const SORTS=[['score','Score'],['vol','Volume'],['chg','Movers'],['age','Newest']];

  if(!all.length){
    return (
      <div style={{maxWidth:520,margin:'0 auto',width:'100%',padding:'80px 16px',textAlign:'center'}}>
        <span style={{display:'inline-block',width:26,height:26,borderRadius:'50%',border:`2.5px solid ${C.border}`,borderTopColor:'#0b0b0c',animation:'nx-spin .8s linear infinite'}} />
        <div style={{marginTop:14,fontFamily:MONO,fontSize:11,fontWeight:700,color:C.ink3,letterSpacing:'0.06em'}}>LOADING LIVE MARKETS…</div>
      </div>
    );
  }

  const sp=spotlight, spG=sp?grade(sp.score):null;

  return (
    <div style={{maxWidth:520,margin:'0 auto',width:'100%'}}>
      {/* head */}
      <div style={{padding:'20px 4px 4px'}}>
        <div style={{fontFamily:MONO,fontSize:10,fontWeight:700,letterSpacing:'0.16em',color:C.ink3,display:'flex',alignItems:'center',gap:6,textTransform:'uppercase'}}>
          <span style={{width:5,height:5,borderRadius:'50%',background:C.green,boxShadow:`0 0 6px ${C.green}`,animation:'nx-pulse 1.4s infinite'}} />Live discovery · updates every 5s
        </div>
        <h1 style={{fontFamily:SERIF,fontWeight:400,fontSize:40,lineHeight:.98,letterSpacing:'-0.02em',margin:'6px 0 2px'}}>
          Find what's <em style={{fontStyle:'italic',background:'linear-gradient(120deg,#A0E7FF,#FF8FBE)',WebkitBackgroundClip:'text',backgroundClip:'text',color:'transparent'}}>moving</em>
        </h1>
        <div style={{fontSize:12.5,color:C.ink2,fontWeight:500,maxWidth:340,lineHeight:1.4}}>Every token, rated. One number tells you if it's worth a look — before you dig in.</div>
      </div>

      {/* orbs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:14}}>
        {[[fmtUsd(totalVol),'24h Volume',C.ink],[newCount,'New · live',C.green],[avgScore||'—','Avg score',C.ink]].map(([v,l,c])=>(
          <div key={l} style={{background:C.glass,border:`1px solid ${C.border}`,borderRadius:14,padding:'11px 8px',textAlign:'center'}}>
            <div style={{fontFamily:MONO,fontSize:16,fontWeight:700,letterSpacing:'-0.02em',color:c}}>{v}</div>
            <div style={{fontSize:8.5,fontWeight:700,color:C.ink3,letterSpacing:'0.08em',textTransform:'uppercase',marginTop:3}}>{l}</div>
          </div>
        ))}
      </div>

      {/* spotlight */}
      {sp && <>
        <SectionHead title="Top" italic="pick right now" meta="SCORED" />
        <div style={{position:'relative',overflow:'hidden',borderRadius:20,border:`1px solid ${C.border}`,background:'linear-gradient(135deg,rgba(160,231,255,.18),rgba(255,143,190,.14)),#fff',padding:16}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:48,height:48,borderRadius:14,display:'grid',placeItems:'center',color:'#fff',fontWeight:800,fontSize:19,flex:'0 0 auto',background:'linear-gradient(135deg,#f5921b,#d4760a)',backgroundSize:'cover',...(typeof sp.icon==='string'&&/^https?:/.test(sp.icon)?{backgroundImage:`url(${sp.icon})`}:{})}}>{!(typeof sp.icon==='string'&&/^https?:/.test(sp.icon))?sp.emoji:''}</div>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:800,fontSize:19,letterSpacing:'-0.01em',display:'flex',alignItems:'center',gap:7}}>{sp.sym}
                <span style={{fontFamily:MONO,fontSize:8.5,fontWeight:700,color:C.green,background:'rgba(22,192,138,.12)',padding:'2px 6px',borderRadius:5,letterSpacing:'0.05em',textTransform:'uppercase'}}>{sp.kind}</span>
              </div>
              <div style={{fontSize:11.5,color:C.ink2,fontWeight:500,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:180}}>{sp.name}</div>
            </div>
            <div style={{marginLeft:'auto',textAlign:'right',flex:'0 0 auto'}}>
              <div style={{fontFamily:MONO,fontSize:18,fontWeight:700}}>{fmtUsd(sp.price)}</div>
              <div style={{fontFamily:MONO,fontSize:12,fontWeight:700,marginTop:1,color:sp.pct>=0?C.green:C.down}}>{fmtPct(sp.pct)}</div>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:14,marginTop:14}}>
            <div style={{width:76,height:76,flex:'0 0 auto',borderRadius:'50%',display:'grid',placeItems:'center',position:'relative',background:`conic-gradient(${spG.c} ${sp.score*3.6}deg, ${spG.c}22 0)`}}>
              <div style={{position:'absolute',inset:7,borderRadius:'50%',background:'#fff'}} />
              <div style={{position:'relative',fontFamily:MONO,fontWeight:700,fontSize:22,lineHeight:1,color:spG.c}}>{spG.g}</div>
              <div style={{position:'relative',fontFamily:MONO,fontWeight:700,fontSize:9,letterSpacing:'0.1em',marginTop:2,color:C.ink3}}>{sp.score}/100</div>
            </div>
            <div style={{flex:1,display:'flex',flexDirection:'column',gap:7}}>
              {[['Momentum',sp.sig.mom],['Liquidity',sp.sig.liq],['Holders',sp.sig.hold],['Safety',sp.sig.safe]].map(([l,v])=>{
                const gc=grade(v).c;
                return (
                  <div key={l} style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:C.ink3,letterSpacing:'0.06em',textTransform:'uppercase',width:64,flex:'0 0 auto'}}>{l}</span>
                    <span style={{flex:1,height:5,borderRadius:99,background:C.hairline,overflow:'hidden'}}><span style={{display:'block',height:'100%',borderRadius:99,width:`${v}%`,background:gc,transition:'width .6s cubic-bezier(.2,1,.4,1)'}} /></span>
                    <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,width:22,textAlign:'right',flex:'0 0 auto',color:gc}}>{Math.round(v)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <button onClick={()=>open(sp)} style={{marginTop:14,width:'100%',padding:14,borderRadius:15,border:'none',background:C.green,color:'#fff',fontWeight:800,fontSize:15,letterSpacing:'0.01em',cursor:'pointer'}}>Buy {sp.sym} · rated {spG.g}</button>
        </div>
      </>}

      {/* feed */}
      <SectionHead title="The" italic="feed" meta="LIVE" />
      <div style={{position:'sticky',top:54,zIndex:40,margin:'0 -16px',padding:'8px 16px',background:'rgba(251,245,255,.72)',backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)'}}>
        <div className="hide-scrollbar" style={{display:'flex',gap:7,overflowX:'auto',paddingBottom:2}}>
          {CHIPS.map(([k,l])=>{
            const on=filter===k;
            return (
              <button key={k} onClick={()=>setFilter(k)} style={{flex:'0 0 auto',border:`1px solid ${on?C.borderHi:C.hairline}`,background:on?'linear-gradient(135deg,rgba(160,231,255,.28),rgba(255,143,190,.24))':'rgba(255,255,255,.8)',borderRadius:999,padding:'8px 13px',fontSize:12,fontWeight:700,color:on?C.ink:C.ink2,whiteSpace:'nowrap',cursor:'pointer',display:'flex',alignItems:'center',gap:5}}>
                {l}<span style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:on?C.ink:C.ink3}}>{counts[k]||0}</span>
              </button>
            );
          })}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8}}>
          <span style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:C.ink3,letterSpacing:'0.08em',textTransform:'uppercase'}}>Sort</span>
          {SORTS.map(([k,l])=>{
            const on=sort===k&&filter!=='trending'&&filter!=='gainers';
            return <button key={k} onClick={()=>setSort(k)} style={{border:'none',background:on?'#f4f4f5':'transparent',fontFamily:MONO,fontSize:11,fontWeight:700,color:on?C.ink:C.ink2,padding:'5px 9px',borderRadius:8,cursor:'pointer'}}>{l}</button>;
          })}
        </div>
      </div>

      <div style={{borderRadius:18,overflow:'hidden',background:C.glass,backdropFilter:'blur(10px)',border:`1px solid ${C.border}`,marginTop:10}}>
        {view.map((t,i)=>(
          <TokenRow key={t.mint} t={t} last={i===view.length-1} rank={(sort==='score'&&filter==='all')?i+1:null} onOpen={()=>open(t)} />
        ))}
      </div>

      {/* whales */}
      {whales.length>0 && <>
        <SectionHead title="Whale" italic="activity" meta="LIVE" />
        <div style={{borderRadius:16,overflow:'hidden',background:C.glass,border:`1px solid ${C.border}`}}>
          {whales.map((e,i)=>{
            const s=Math.max(0,Math.round((Date.now()-(e.detectedAt||Date.now()))/1000));
            const ago=s<60?s+'s':s<3600?Math.round(s/60)+'m':Math.round(s/3600)+'h';
            return (
              <div key={(e.mint||'')+i} style={{display:'flex',alignItems:'center',gap:9,padding:'10px 14px',borderBottom:i===whales.length-1?'none':`1px solid ${C.hairline}`}}>
                <span style={{fontSize:14}}>🐋</span>
                <span style={{flex:1,fontSize:12,fontWeight:600,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b style={{fontWeight:800}}>Whale</b> bought <b style={{fontWeight:800}}>${e.symbol||'TOKEN'}</b></span>
                <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.green}}>+{Number(e.solAmount||0).toFixed(1)} SOL</span>
                <span style={{fontFamily:MONO,fontSize:9,color:C.ink3,minWidth:26,textAlign:'right'}}>{ago}</span>
              </div>
            );
          })}
        </div>
      </>}

      <div style={{textAlign:'center',fontFamily:MONO,fontSize:9,fontWeight:700,color:C.ink3,letterSpacing:'0.1em',margin:'18px 0 4px'}}>NON-CUSTODIAL · NO ACCOUNT · YOUR KEYS</div>
    </div>
  );
}

// Wrap the page so any render crash (including the trade sheet, via the global
// listener) surfaces a full on-screen debug panel instead of a white screen.
export default function Discover(props){
  return <DiscoverBoundary><DiscoverInner {...props} /></DiscoverBoundary>;
}
