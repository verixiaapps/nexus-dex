import React, { useState, useEffect, useMemo, useCallback, useRef } from ‘react’;
import { useWallet, useConnection } from ‘@solana/wallet-adapter-react’;
import { signL1Action } from ‘@nktkas/hyperliquid/signing’;

// === MODULES FROM src/unit-migration/ ===
import {
onboardUser, depositSolAndOpen, openFromHlBalance,
closePosition, withdrawToSolanaWallet,
} from ‘../unit-migration/unitFlows’;
import {
getUnitDepositAddress, UNIT_MIN_SOL_DEPOSIT,
} from ‘../unit-migration/unitClient’;
import {
isAgentApproved, getStoredAgent, nextNonce,
getEthers, getEthersNs,
} from ‘../unit-migration/hlAgentWallet’;
import { sendSolToUnit, readSolBalance, maxDepositableSol } from ‘../unit-migration/solanaSend’;

// === REPLACE THESE WITH YOUR EXISTING IMPORTS FROM PerpsTrade.js ===
// (your file already has all of these — just point at them)
import { useNexusWallet } from ‘../WalletContext.js’;
//   deriveHLWallet, hlRequest, fetchHlBalanceAndPositions,
//   buildOrderAction, ensureBuilderApproval, setLeverageOnHL,
//   PERPS_PAIRS, C, T, fmt, pct, cleanAmount, etc.
// These all live in your current PerpsTrade.js. Either move them to a
// shared module, or import them by re-exporting from PerpsTrade.js.

// —– CONFIG —–
const BUILDER_ADDRESS         = ‘’;          // SET when ready to enable fees
const BUILDER_FEE_PERPS_TBP   = 100;         // 0.1%
const BUILDER_FEE_SPOT_TBP    = 1000;        // 1.0%
const BUILDER_MAX_FEE_RATE    = ‘1%’;

// Color tokens — copy from your PerpsTrade.js. Showing key ones for ref:
const C = {
bg:’#04070f’, surface:’#0a1020’, surface2:’#0e1428’,
ink:’#e6efff’, muted:’#7a92b3’,
hl:’#97fce4’, hl2:’#5ce9c8’, hlDim:‘rgba(151,252,228,.14)’,
up:’#3dd598’, down:’#ff8a9e’, amber:’#f5b53d’, violet:’#a87fff’,
border:‘rgba(255,255,255,.06)’, borderHi:‘rgba(151,252,228,.24)’,
};
const T = {
body: { fontFamily:”‘Inter’, system-ui, sans-serif”, letterSpacing:’-.01em’ },
mono: { fontFamily:”‘IBM Plex Mono’, monospace” },
hero: { fontFamily:”‘Clash Display’, system-ui, sans-serif” },
};

// Coin list — slim subset of your full PERPS_PAIRS for the “swap-like” feel
const TOP_COINS = [
{ id:‘BTC’,  name:‘Bitcoin’,   leverage:50 },
{ id:‘ETH’,  name:‘Ethereum’,  leverage:50 },
{ id:‘SOL’,  name:‘Solana’,    leverage:20 },
{ id:‘HYPE’, name:‘Hyperliquid’,leverage:10 },
{ id:‘DOGE’, name:‘Dogecoin’,  leverage:20 },
{ id:‘XRP’,  name:‘XRP’,       leverage:20 },
];

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function PerpsTradeUnit({ onConnectWallet }) {
// —– Wallet state —–
const { connection } = useConnection();
const solWallet = useWallet();
const walletPubkey = solWallet?.publicKey?.toBase58() || null;
const isConnected = !!walletPubkey;

// Your existing NexusWallet context — exposes the HL-derived wallet
const { hlWallet, deriveHL } = useNexusWallet() || {};
// hlWallet should be { address, privateKey } after derivation

// —– UI state —–
const [selectedCoin, setSelectedCoin] = useState(TOP_COINS[0]);
const [direction, setDirection] = useState(‘long’);   // ‘long’ | ‘short’
const [usdAmount, setUsdAmount] = useState(‘25’);
const [leverage, setLeverage] = useState(5);

// —– Live data —–
const [solBalance, setSolBalance] = useState(0);
const [hlPerpUsdc, setHlPerpUsdc] = useState(0);
const [openPosition, setOpenPosition] = useState(null);    // { coin, isLong, sizeBase, entryPx, unrealizedPnl }
const [solPrice, setSolPrice] = useState(180);             // for SOL→USD math
const [pricesByCoin, setPricesByCoin] = useState({});      // for quick PnL display

// —– Flow state —–
const [busy, setBusy] = useState(false);
const [step, setStep] = useState(’’);                       // status label
const [error, setError] = useState(’’);
const [mode, setMode] = useState(‘idle’);                   // idle | trading | position | withdrawing

// ============================================================
// DATA LOADING
// ============================================================

// Solana balance polling
useEffect(() => {
if (!solWallet?.publicKey) { setSolBalance(0); return; }
let alive = true;
const tick = async () => {
const bal = await readSolBalance(connection, solWallet.publicKey);
if (alive) setSolBalance(bal);
};
tick();
const id = setInterval(tick, 15_000);
return () => { alive = false; clearInterval(id); };
}, [connection, solWallet?.publicKey]);

// HL state polling (perp balance + position)
useEffect(() => {
if (!hlWallet?.address) {
setHlPerpUsdc(0); setOpenPosition(null);
return;
}
let alive = true;
const tick = async () => {
try {
// YOU PROVIDE: hlRequest from your existing PerpsTrade.js
const state = await window.__nexusHlRequest({
type: ‘clearinghouseState’, user: hlWallet.address,
});
if (!alive) return;
setHlPerpUsdc(parseFloat(state?.withdrawable || 0));
const positions = (state.assetPositions || [])
.filter(p => parseFloat(p.position?.szi || 0) !== 0);
if (positions.length > 0) {
const p = positions[0]; // show the first open position
setOpenPosition({
coin: p.position.coin,
isLong: parseFloat(p.position.szi) > 0,
sizeBase: Math.abs(parseFloat(p.position.szi)),
entryPx: parseFloat(p.position.entryPx || 0),
unrealizedPnl: parseFloat(p.position.unrealizedPnl || 0),
positionValue: parseFloat(p.position.positionValue || 0),
});
setMode(‘position’);
} else {
setOpenPosition(null);
if (mode === ‘position’) setMode(‘idle’);
}
} catch (e) {
console.warn(’[hl state]’, e?.message);
}
};
tick();
const id = setInterval(tick, 8_000);
return () => { alive = false; clearInterval(id); };
}, [hlWallet?.address]);

// ============================================================
// VALIDATION
// ============================================================

const usdNum = useMemo(() => Number(usdAmount) || 0, [usdAmount]);
const requiredSol = useMemo(() => {
// Conservative estimate: needed SOL = (usdAmount / solPrice) + buffer
// Always >= UNIT_MIN_SOL_DEPOSIT
if (hlPerpUsdc >= usdNum) return 0;
const shortfall = usdNum - hlPerpUsdc;
const solNeeded = shortfall / Math.max(solPrice, 1) * 1.02;
return Math.max(UNIT_MIN_SOL_DEPOSIT, solNeeded);
}, [usdNum, hlPerpUsdc, solPrice]);

const canTrade = useMemo(() => {
if (!isConnected) return false;
if (busy) return false;
if (usdNum < 1) return false;
if (requiredSol > 0 && solBalance < requiredSol) return false;
return true;
}, [isConnected, busy, usdNum, requiredSol, solBalance]);

const tradeButtonLabel = useMemo(() => {
if (!isConnected) return ‘Connect Wallet’;
if (busy) return step || ‘Working…’;
if (usdNum < 1) return ‘Enter amount’;
if (requiredSol > 0 && solBalance < requiredSol) {
return `Need ${requiredSol.toFixed(2)} SOL`;
}
return `${direction === 'long' ? 'Long' : 'Short'} ${selectedCoin.id}`;
}, [isConnected, busy, step, usdNum, requiredSol, solBalance, direction, selectedCoin]);

// ============================================================
// ACTIONS
// ============================================================

// — BUY (open position) —
const handleBuy = useCallback(async () => {
if (!isConnected) { onConnectWallet?.(); return; }
if (!canTrade) return;

```
setBusy(true); setError(''); setStep('Preparing…');
try {
  // 1. Derive HL wallet (your existing pattern)
  const hl = hlWallet?.privateKey ? hlWallet : await deriveHL();
  if (!hl?.privateKey) throw new Error('Could not derive HL wallet');

  // 2. One-time onboarding (idempotent)
  await onboardUser({
    masterPrivateKey: hl.privateKey, hlAddress: hl.address,
    builderAddress: BUILDER_ADDRESS,
    builderMaxFeeRate: BUILDER_MAX_FEE_RATE,
    hlRequest: window.__nexusHlRequest,
    onStep: setStep,
  });

  // 3. Look up the perp pair (you have a helper for this in PerpsTrade.js;
  //    here's the inline version)
  const pair = await resolvePerpPair(selectedCoin.id);
  const isLong = direction === 'long';

  // 4. Fast path or slow path?
  if (hlPerpUsdc >= usdNum) {
    // FAST PATH: just place the order
    setStep('Opening position…');
    await openFromHlBalance({
      hlAddress: hl.address,
      pair, isLong, usdAmount: usdNum, leverage,
      placeOrder: makePlaceOrderWithAgent(hl),
      onStep: setStep,
    });
  } else {
    // SLOW PATH: deposit + open
    const { address: depositAddr } = await getUnitDepositAddress(hl.address);
    setStep('Send SOL to Unit (please sign)…');
    const sig = await sendSolToUnit({
      connection, wallet: solWallet,
      unitDepositAddress: depositAddr,
      amountSol: requiredSol,
      onStatus: ({ status }) => setStep(`Solana: ${status}`),
    });
    await depositSolAndOpen({
      masterPrivateKey: hl.privateKey, hlAddress: hl.address,
      builderAddress: BUILDER_ADDRESS,
      builderFeePerpsTbp: BUILDER_FEE_PERPS_TBP,
      builderFeeSpotTbp:  BUILDER_FEE_SPOT_TBP,
      solanaTxHash: sig,
      pair, isLong, usdAmount: usdNum, leverage,
      placeOrder: makePlaceOrderWithAgent(hl),
      hlRequest: window.__nexusHlRequest,
      onStep: setStep,
    });
  }
  setStep('Position open');
} catch (e) {
  console.error(e);
  setError(e?.message || 'Trade failed');
} finally {
  setBusy(false);
}
```

}, [isConnected, canTrade, hlWallet, deriveHL, selectedCoin, direction,
usdNum, leverage, hlPerpUsdc, requiredSol, connection, solWallet, onConnectWallet]);

// — CLOSE (instant) —
const handleClose = useCallback(async () => {
if (!openPosition || !hlWallet?.privateKey) return;
setBusy(true); setError(’’); setStep(‘Closing position…’);
try {
const pair = await resolvePerpPair(openPosition.coin);
await closePosition({
hlAddress: hlWallet.address,
pair,
currentSizeBase: openPosition.sizeBase,
isLong: openPosition.isLong,
placeOrder: makePlaceOrderWithAgent(hlWallet),
onStep: setStep,
});
setStep(‘Closed’);
setOpenPosition(null);
setMode(‘idle’);
} catch (e) {
console.error(e);
setError(e?.message || ‘Close failed’);
} finally {
setBusy(false);
}
}, [openPosition, hlWallet]);

// — WITHDRAW TO WALLET —
const handleWithdraw = useCallback(async (amountUsd) => {
if (!hlWallet?.privateKey || !walletPubkey) return;
setBusy(true); setError(’’); setStep(‘Starting withdraw…’);
setMode(‘withdrawing’);
try {
await withdrawToSolanaWallet({
masterPrivateKey: hlWallet.privateKey,
hlAddress: hlWallet.address,
solanaAddress: walletPubkey,
usdcAmount: amountUsd,
hlRequest: window.__nexusHlRequest,
onStep: setStep,
});
setStep(‘SOL delivered to your wallet’);
setMode(‘idle’);
} catch (e) {
console.error(e);
setError(e?.message || ‘Withdraw failed’);
} finally {
setBusy(false);
}
}, [hlWallet, walletPubkey]);

// ============================================================
// RENDER
// ============================================================

return (
<div style={{
minHeight: ‘100vh’, background: C.bg, color: C.ink,
padding: ‘24px 16px’, …T.body,
}}>
<div style={{ maxWidth: 480, margin: ‘0 auto’ }}>

```
    {/* ===== HEADER ===== */}
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <div style={{ ...T.hero, fontSize: 32, fontWeight: 700, letterSpacing: '-.03em' }}>
        Trade <span style={{ color: C.hl }}>Perps</span>
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
        From your Solana wallet. No bridge popups.
      </div>
    </div>

    {/* ===== WALLET CARD ===== */}
    {!isConnected && (
      <BigButton onClick={() => onConnectWallet?.()}>
        Connect Solana Wallet
      </BigButton>
    )}

    {isConnected && (
      <>
        {/* ===== BALANCES STRIP ===== */}
        <BalancesStrip
          solBalance={solBalance}
          hlPerpUsdc={hlPerpUsdc}
          solPrice={solPrice}
          hasAgent={hlWallet?.address && isAgentApproved(hlWallet.address)}
        />

        {/* ===== ACTIVE POSITION CARD ===== */}
        {openPosition && (
          <PositionCard
            position={openPosition}
            currentPrice={pricesByCoin[openPosition.coin] || openPosition.entryPx}
            onClose={handleClose}
            onWithdraw={() => handleWithdraw(hlPerpUsdc)}
            busy={busy}
            step={step}
          />
        )}

        {/* ===== TRADE FORM (always visible, even with open position) ===== */}
        <TradeForm
          coin={selectedCoin}
          onCoinChange={setSelectedCoin}
          direction={direction}
          onDirectionChange={setDirection}
          usdAmount={usdAmount}
          onAmountChange={setUsdAmount}
          leverage={leverage}
          onLeverageChange={setLeverage}
          maxLeverage={selectedCoin.leverage}
          hlPerpUsdc={hlPerpUsdc}
          requiredSol={requiredSol}
          solBalance={solBalance}
          disabled={busy}
        />

        {/* ===== ACTION BUTTON ===== */}
        <div style={{ marginTop: 16 }}>
          <BigButton
            onClick={handleBuy}
            disabled={!canTrade}
            variant={direction === 'long' ? 'up' : 'down'}
          >
            {tradeButtonLabel}
          </BigButton>
        </div>

        {/* ===== STATUS / ERROR ===== */}
        {(busy || error) && (
          <StatusRow step={step} error={error} />
        )}

        {/* ===== WITHDRAW WHEN NO POSITION BUT BALANCE EXISTS ===== */}
        {!openPosition && hlPerpUsdc > 1 && !busy && (
          <button onClick={() => handleWithdraw(hlPerpUsdc)} style={{
            marginTop: 24, width: '100%', padding: '14px 0',
            background: 'transparent', border: `1px solid ${C.border}`,
            color: C.muted, borderRadius: 14, fontSize: 13, cursor: 'pointer',
            ...T.mono,
          }}>
            Cash out ${hlPerpUsdc.toFixed(2)} to wallet
          </button>
        )}
      </>
    )}

    {/* ===== FOOTER ===== */}
    <div style={{ marginTop: 40, textAlign: 'center', fontSize: 11, color: C.muted }}>
      Powered by Hyperliquid · Bridged by Unit · Non-custodial
    </div>
  </div>
</div>
```

);

// ============================================================
// HELPERS (inline)
// ============================================================

/**

- Wrap your existing placeOrder so it auto-uses the agent for silent signing.
- REPLACE window.__nexusPlaceOrder with the imported function from your code.
  */
  function makePlaceOrderWithAgent(hl) {
  return async (args) => {
  const agent = getStoredAgent(hl.address);
  // YOU PROVIDE: window.__nexusPlaceOrder = your patched placeOrder
  return await window.__nexusPlaceOrder({
  …args,
  hlWalletData:    { address: hl.address, privateKey: hl.privateKey },
  agentWalletData: agent
  ? { address: agent.address, privateKey: agent.privateKey }
  : null,
  });
  };
  }

/**

- Look up the perp pair object from HL meta.
- Should match the shape your existing buildOrderAction expects.
  */
  async function resolvePerpPair(coinId) {
  const meta = await window.__nexusHlRequest({ type: ‘metaAndAssetCtxs’ });
  const universe = meta?.[0]?.universe || [];
  const idx = universe.findIndex(u => u?.name === coinId);
  if (idx < 0) throw new Error(`Perp pair ${coinId} not found`);
  return { id: coinId, base: coinId, assetIndex: idx, …universe[idx] };
  }
  }

// ============================================================
// SUB-COMPONENTS
// ============================================================

function BigButton({ children, onClick, disabled, variant = ‘primary’ }) {
const bgMap = {
primary: `linear-gradient(135deg, ${C.hl} 0%, ${C.hl2} 100%)`,
up:      `linear-gradient(135deg, ${C.up} 0%, ${C.hl2} 100%)`,
down:    `linear-gradient(135deg, ${C.down} 0%, ${C.violet} 100%)`,
};
return (
<button onClick={onClick} disabled={disabled} style={{
width: ‘100%’, padding: ‘20px 24px’, borderRadius: 18,
border: ‘none’, background: bgMap[variant] || bgMap.primary,
color: ‘#04070f’, fontSize: 16, fontWeight: 800,
cursor: disabled ? ‘not-allowed’ : ‘pointer’,
opacity: disabled ? 0.4 : 1,
transition: ‘transform 0.08s, opacity 0.15s’,
…T.hero, letterSpacing: ‘-.01em’,
}}
onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = ‘scale(0.98)’; }}
onMouseUp={(e) => { e.currentTarget.style.transform = ‘scale(1)’; }}
onMouseLeave={(e) => { e.currentTarget.style.transform = ‘scale(1)’; }}>
{children}
</button>
);
}

function BalancesStrip({ solBalance, hlPerpUsdc, solPrice, hasAgent }) {
return (
<div style={{
display: ‘flex’, gap: 8, marginBottom: 24,
background: C.surface, border: `1px solid ${C.border}`,
borderRadius: 14, padding: 12,
}}>
<BalanceItem label=“Wallet” value={`${solBalance.toFixed(3)} SOL`}
sub={`$${(solBalance * solPrice).toFixed(2)}`} />
<div style={{ width: 1, background: C.border }} />
<BalanceItem label=“Trading” value={`$${hlPerpUsdc.toFixed(2)}`}
sub={hasAgent ? ‘Agent ready’ : ‘No agent’} />
</div>
);
}

function BalanceItem({ label, value, sub }) {
return (
<div style={{ flex: 1, padding: ‘4px 8px’ }}>
<div style={{ fontSize: 10, color: C.muted, textTransform: ‘uppercase’, letterSpacing: ‘.08em’ }}>
{label}
</div>
<div style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginTop: 2, …T.mono }}>
{value}
</div>
<div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>
</div>
);
}

function PositionCard({ position, currentPrice, onClose, onWithdraw, busy, step }) {
const pnl = position.unrealizedPnl;
const pnlPct = position.positionValue > 0
? (pnl / (position.positionValue - pnl)) * 100
: 0;
const isUp = pnl >= 0;
return (
<div style={{
background: `linear-gradient(180deg, ${C.surface2} 0%, ${C.surface} 100%)`,
border: `1px solid ${isUp ? C.up : C.down}33`,
borderRadius: 18, padding: 18, marginBottom: 20,
position: ‘relative’, overflow: ‘hidden’,
}}>
<div style={{
position: ‘absolute’, top: 0, left: 0, right: 0, height: 2,
background: isUp ? C.up : C.down, opacity: 0.6,
}} />
<div style={{ display: ‘flex’, justifyContent: ‘space-between’, alignItems: ‘baseline’ }}>
<div>
<div style={{ fontSize: 11, color: C.muted, textTransform: ‘uppercase’, letterSpacing: ‘.08em’ }}>
Open {position.isLong ? ‘Long’ : ‘Short’}
</div>
<div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, …T.hero }}>
{position.coin}
</div>
</div>
<div style={{ textAlign: ‘right’ }}>
<div style={{ fontSize: 11, color: C.muted }}>Unrealized P&L</div>
<div style={{
fontSize: 20, fontWeight: 700, …T.mono,
color: isUp ? C.up : C.down,
}}>
{isUp ? ‘+’ : ‘’}${pnl.toFixed(2)}
</div>
<div style={{ fontSize: 11, color: isUp ? C.up : C.down }}>
{isUp ? ‘+’ : ‘’}{pnlPct.toFixed(2)}%
</div>
</div>
</div>

```
  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
    <button onClick={onClose} disabled={busy} style={{
      flex: 1, padding: 14, borderRadius: 12,
      background: isUp ? C.up : C.down, color: '#04070f',
      border: 'none', fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
      opacity: busy ? 0.5 : 1, fontSize: 14, ...T.body,
    }}>
      Close position
    </button>
    <button onClick={onWithdraw} disabled={busy} style={{
      flex: 1, padding: 14, borderRadius: 12,
      background: 'transparent', border: `1px solid ${C.border}`,
      color: C.muted, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
      opacity: busy ? 0.5 : 1, fontSize: 14, ...T.body,
    }}>
      Close & withdraw
    </button>
  </div>
</div>
```

);
}

function TradeForm({
coin, onCoinChange, direction, onDirectionChange,
usdAmount, onAmountChange, leverage, onLeverageChange, maxLeverage,
hlPerpUsdc, requiredSol, solBalance, disabled,
}) {
return (
<div style={{
background: C.surface, border: `1px solid ${C.border}`,
borderRadius: 18, padding: 18,
}}>
{/* Coin selector */}
<CoinSelector coin={coin} onChange={onCoinChange} disabled={disabled} />

```
  {/* Long / Short toggle */}
  <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
    {['long', 'short'].map(d => (
      <button key={d} onClick={() => onDirectionChange(d)} disabled={disabled} style={{
        flex: 1, padding: '12px 0', borderRadius: 12,
        background: direction === d
          ? (d === 'long' ? `${C.up}22` : `${C.down}22`)
          : 'transparent',
        border: `1px solid ${direction === d
          ? (d === 'long' ? C.up : C.down)
          : C.border}`,
        color: direction === d
          ? (d === 'long' ? C.up : C.down)
          : C.muted,
        fontWeight: 700, fontSize: 14, cursor: 'pointer',
        textTransform: 'uppercase', letterSpacing: '.05em',
        ...T.mono,
      }}>
        {d}
      </button>
    ))}
  </div>

  {/* Amount input */}
  <div style={{ marginTop: 16 }}>
    <div style={{ fontSize: 11, color: C.muted, marginBottom: 6,
                  textTransform: 'uppercase', letterSpacing: '.08em' }}>
      Amount
    </div>
    <div style={{
      display: 'flex', alignItems: 'center',
      background: C.surface2, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: '4px 12px',
    }}>
      <span style={{ color: C.muted, marginRight: 8 }}>$</span>
      <input
        value={usdAmount}
        onChange={e => onAmountChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder="0.00"
        disabled={disabled}
        inputMode="decimal"
        style={{
          flex: 1, background: 'transparent', border: 'none',
          color: C.ink, fontSize: 22, fontWeight: 700,
          padding: '12px 0', outline: 'none', ...T.mono,
        }}
      />
      {[25, 50, 100].map(v => (
        <button key={v} onClick={() => onAmountChange(String(v))} disabled={disabled} style={{
          padding: '4px 10px', borderRadius: 6, marginLeft: 4,
          background: 'transparent', border: `1px solid ${C.border}`,
          color: C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer',
          ...T.mono,
        }}>
          ${v}
        </button>
      ))}
    </div>
  </div>

  {/* Leverage slider */}
  <div style={{ marginTop: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 11, color: C.muted,
                    textTransform: 'uppercase', letterSpacing: '.08em' }}>
        Leverage
      </div>
      <div style={{ fontSize: 13, color: C.hl, fontWeight: 700, ...T.mono }}>
        {leverage}×
      </div>
    </div>
    <input type="range" min="1" max={maxLeverage} value={leverage}
           onChange={e => onLeverageChange(Number(e.target.value))}
           disabled={disabled}
           style={{ width: '100%', marginTop: 8, accentColor: C.hl }} />
  </div>

  {/* Source hint */}
  <div style={{
    marginTop: 14, padding: '8px 12px', borderRadius: 10,
    background: C.surface2, fontSize: 11, color: C.muted, lineHeight: 1.5,
  }}>
    {requiredSol > 0 ? (
      <>
        Will bridge <strong style={{ color: C.ink }}>{requiredSol.toFixed(3)} SOL</strong> from your wallet
        {' '}({solBalance < requiredSol ? '⚠️ insufficient' : '✓ available'})
        <div style={{ marginTop: 4, fontSize: 10 }}>
          {' '}~3 minutes via Unit. Min bridge: {UNIT_MIN_SOL_DEPOSIT} SOL.
        </div>
      </>
    ) : (
      <>
        Trading from your <strong style={{ color: C.ink }}>${hlPerpUsdc.toFixed(2)}</strong> balance
        {' '}— opens instantly, no signature.
      </>
    )}
  </div>
</div>
```

);
}

function CoinSelector({ coin, onChange, disabled }) {
const [open, setOpen] = useState(false);
return (
<div style={{ position: ‘relative’ }}>
<button onClick={() => !disabled && setOpen(!open)} disabled={disabled} style={{
width: ‘100%’, padding: ‘14px 16px’, borderRadius: 12,
background: C.surface2, border: `1px solid ${C.border}`,
display: ‘flex’, justifyContent: ‘space-between’, alignItems: ‘center’,
color: C.ink, cursor: ‘pointer’, textAlign: ‘left’,
}}>
<div style={{ display: ‘flex’, alignItems: ‘center’, gap: 12 }}>
<div style={{
width: 36, height: 36, borderRadius: ‘50%’,
background: `linear-gradient(135deg, ${C.hl} 0%, ${C.violet} 100%)`,
display: ‘flex’, alignItems: ‘center’, justifyContent: ‘center’,
color: ‘#04070f’, fontWeight: 800, fontSize: 13, …T.mono,
}}>
{coin.id.slice(0, 3)}
</div>
<div>
<div style={{ fontSize: 16, fontWeight: 700 }}>{coin.id}</div>
<div style={{ fontSize: 11, color: C.muted }}>
{coin.name} · up to {coin.leverage}×
</div>
</div>
</div>
<div style={{ color: C.muted, fontSize: 14 }}>{open ? ‘▴’ : ‘▾’}</div>
</button>

```
  {open && (
    <div style={{
      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
      marginTop: 4, background: C.surface, border: `1px solid ${C.borderHi}`,
      borderRadius: 12, padding: 4, maxHeight: 260, overflowY: 'auto',
      boxShadow: '0 16px 48px rgba(0,0,0,.5)',
    }}>
      {TOP_COINS.map(c => (
        <button key={c.id}
                onClick={() => { onChange(c); setOpen(false); }}
                style={{
                  width: '100%', padding: '12px 14px',
                  background: c.id === coin.id ? C.hlDim : 'transparent',
                  border: 'none', borderRadius: 8,
                  color: C.ink, cursor: 'pointer', textAlign: 'left',
                  fontSize: 14, fontWeight: 600, display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                }}>
          <span>{c.id}</span>
          <span style={{ fontSize: 11, color: C.muted, ...T.mono }}>
            {c.leverage}×
          </span>
        </button>
      ))}
    </div>
  )}
</div>
```

);
}

function StatusRow({ step, error }) {
return (
<div style={{
marginTop: 12, padding: ‘10px 14px’, borderRadius: 10,
background: error ? `${C.down}11` : `${C.hl}11`,
border: `1px solid ${error ? C.down : C.border}`,
fontSize: 12, color: error ? C.down : C.muted, …T.mono,
}}>
{error || step}
</div>
);
}