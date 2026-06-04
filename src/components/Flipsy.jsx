import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFlipsy } from '../hooks/useFlipsy';
import './Flipsy.css';

// ============================================================
// TESTING GUARDS
// ============================================================
const ADMIN_WALLET = 'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA';
const BLOCKED_COUNTRIES = ['US'];
const MIN_BET = 1;
const MAX_BET = 500;
const NET_MULT = 0.75;
// ============================================================

async function checkGeo() {
  const sources = [
    { url: 'https://ipapi.co/json/', field: 'country_code' },
    { url: 'https://api.country.is/', field: 'country' },
  ];
  for (const src of sources) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(src.url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const cc = (data[src.field] || '').toUpperCase();
      if (cc) return { country: cc, blocked: BLOCKED_COUNTRIES.includes(cc) };
    } catch {}
  }
  return { country: 'UNKNOWN', blocked: false };
}

function BlockScreen({ title, message, sub }) {
  return (
    <div className="fp-page">
      <div className="fp-glow fp-glow-1" />
      <div className="fp-glow fp-glow-2" />
      <div className="fp-glow fp-glow-3" />
      <div className="fp-block-wrap">
        <div className="fp-block-card">
          <div className="fp-block-icon">🔒</div>
          <h2 className="fp-block-title">{title}</h2>
          <p className="fp-block-msg">{message}</p>
          {sub && <p className="fp-block-sub">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BET MODAL — pops up after tapping LONG or SHORT
// ============================================================
function BetModal({ open, side, epoch, onClose, onTrade, balance, livePrice, headsPayout, tailsPayout }) {
  const [amount, setAmount] = useState('5');
  const [status, setStatus] = useState('idle'); // idle | simulating | signing | success | error
  const [simResult, setSimResult] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setAmount('5');
      setStatus('idle');
      setSimResult(null);
      setErrMsg('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  if (!open) return null;

  const amt = parseFloat(amount) || 0;
  const payout = side === 'heads' ? headsPayout : tailsPayout;
  const estWin = amt * payout;
  const isLong = side === 'heads';
  const sideColor = isLong ? '#14F195' : '#DC1FFF';
  const sideLabel = isLong ? '↑ LONG' : '↓ SHORT';
  const insufficient = amt > balance;

  const handleTrade = async () => {
    if (amt <= 0 || insufficient) return;
    setStatus('simulating');
    setErrMsg('');
    try {
      // Run simulation then sign — all handled in onTrade
      const result = await onTrade(epoch, side, amt);
      setSimResult(result);
      setStatus('success');
      setTimeout(() => { onClose(); }, 1800);
    } catch (e) {
      setErrMsg(e.message || 'Transaction failed');
      setStatus('error');
    }
  };

  const quickAmounts = [5, 10, 25, 50];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        bottom: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480,
        zIndex: 201,
        background: 'linear-gradient(180deg, #12111f 0%, #0a0a14 100%)',
        borderTop: `2px solid ${sideColor}44`,
        borderRadius: '28px 28px 0 0',
        padding: '24px 24px 40px',
        fontFamily: 'Inter, sans-serif',
        animation: 'fp-modal-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Handle */}
        <div style={{
          width: 40, height: 4, borderRadius: 2,
          background: 'rgba(255,255,255,0.12)',
          margin: '0 auto 20px',
        }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              padding: '6px 16px', borderRadius: 999,
              background: sideColor + '18',
              border: `1px solid ${sideColor}66`,
              color: sideColor,
              fontWeight: 900, fontSize: 14, letterSpacing: '0.1em',
            }}>
              {sideLabel}
            </div>
            <span style={{ color: '#5D5876', fontSize: 12 }}>Round #{epoch}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)', border: 'none',
              borderRadius: '50%', width: 32, height: 32,
              color: '#9892B5', cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* Amount input */}
        <div style={{
          background: 'rgba(6,6,12,0.8)',
          border: `1.5px solid ${status === 'error' ? '#DC1FFF' : sideColor + '44'}`,
          borderRadius: 20, padding: '16px 20px', marginBottom: 14,
          transition: 'border-color 0.2s',
        }}>
          <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>
            AMOUNT (USD)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: '#5D5876' }}>$</span>
            <input
              ref={inputRef}
              type="number"
              min={MIN_BET}
              max={MAX_BET}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              disabled={status !== 'idle' && status !== 'error'}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 36, fontWeight: 900, color: '#FFFFFF',
                fontFamily: 'Inter, sans-serif',
                fontVariantNumeric: 'tabular-nums',
              }}
            />
            {balance != null && (
              <span style={{ fontSize: 10, color: '#5D5876', whiteSpace: 'nowrap' }}>
                Bal: ${balance.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* Quick amounts */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {quickAmounts.map(v => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              disabled={status !== 'idle' && status !== 'error'}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 999,
                background: parseFloat(amount) === v ? sideColor + '22' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${parseFloat(amount) === v ? sideColor + '88' : 'rgba(255,255,255,0.08)'}`,
                color: parseFloat(amount) === v ? sideColor : '#9892B5',
                fontWeight: 800, fontSize: 13, cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                transition: 'all 0.15s',
              }}
            >
              ${v}
            </button>
          ))}
        </div>

        {/* Est payout */}
        {amt > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 16, padding: '12px 16px', marginBottom: 16,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.15em', marginBottom: 4 }}>
                EST. PAYOUT
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: sideColor, fontVariantNumeric: 'tabular-nums' }}>
                ${estWin.toFixed(2)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.15em', marginBottom: 4 }}>
                MULTIPLIER
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#FFD66B' }}>
                {payout.toFixed(2)}×
              </div>
            </div>
          </div>
        )}

        {/* Sim result */}
        {status === 'simulating' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: '12px', marginBottom: 12,
            color: '#9892B5', fontSize: 13, fontWeight: 600,
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              border: '2px solid #9945FF', borderTopColor: 'transparent',
              animation: 'fp-spin 0.7s linear infinite',
            }} />
            Simulating transaction…
          </div>
        )}

        {status === 'signing' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: '12px', marginBottom: 12,
            color: sideColor, fontSize: 13, fontWeight: 700,
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              border: `2px solid ${sideColor}`, borderTopColor: 'transparent',
              animation: 'fp-spin 0.7s linear infinite',
            }} />
            Sign in your wallet…
          </div>
        )}

        {status === 'success' && (
          <div style={{
            textAlign: 'center', padding: '12px', marginBottom: 12,
            color: '#14F195', fontSize: 14, fontWeight: 800,
            animation: 'fp-pop 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          }}>
            ✓ Trade placed!
          </div>
        )}

        {status === 'error' && errMsg && (
          <div style={{
            padding: '10px 14px', marginBottom: 12, borderRadius: 12,
            background: 'rgba(220,31,255,0.1)', border: '1px solid #DC1FFF44',
            color: '#DC1FFF', fontSize: 12, fontWeight: 700,
          }}>
            {errMsg}
          </div>
        )}

        {/* Trade button */}
        {status !== 'success' && (
          <button
            onClick={handleTrade}
            disabled={amt <= 0 || insufficient || (status !== 'idle' && status !== 'error')}
            style={{
              width: '100%', padding: '16px',
              borderRadius: 18, border: 'none',
              background: insufficient
                ? 'rgba(255,255,255,0.06)'
                : status !== 'idle' && status !== 'error'
                  ? 'rgba(255,255,255,0.08)'
                  : `linear-gradient(135deg, ${sideColor}, ${isLong ? '#00D9FF' : '#9945FF'})`,
              color: insufficient || (status !== 'idle' && status !== 'error') ? '#5D5876' : isLong ? '#001A0F' : '#FFFFFF',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 900, fontSize: 16, letterSpacing: '0.08em',
              cursor: insufficient || (status !== 'idle' && status !== 'error') ? 'not-allowed' : 'pointer',
              boxShadow: insufficient || (status !== 'idle' && status !== 'error')
                ? 'none'
                : `0 8px 30px ${sideColor}44`,
              transition: 'all 0.2s',
            }}
          >
            {insufficient
              ? 'Insufficient Balance'
              : status === 'simulating' ? 'Simulating…'
              : status === 'signing' ? 'Check Wallet…'
              : 'Trade'}
          </button>
        )}

        <div style={{
          textAlign: 'center', marginTop: 12,
          fontSize: 10, color: '#5D5876', fontWeight: 600, letterSpacing: '0.1em',
        }}>
          NETWORK FEE ~0.000005 SOL · 25% FEE ON WINNINGS ONLY
        </div>
      </div>
    </>
  );
}

// ============================================================
// ROUND CARD
// ============================================================
function RoundCard({ round, state, userBet, livePrice, onSideTap, claim, claimable }) {
  const {
    epoch,
    headsPool = 0, tailsPool = 0,
    lockPrice = 0, closePrice = 0,
    lockTime = 0, closeTime = 0,
    outcome = 'unresolved',
  } = round;
  const totalPool = headsPool + tailsPool;
  const headsPayout = headsPool > 0 ? 1 + ((totalPool / headsPool) - 1) * NET_MULT : 2.0;
  const tailsPayout = tailsPool > 0 ? 1 + ((totalPool / tailsPool) - 1) * NET_MULT : 2.0;

  const isPrev = state === 'previous';
  const isLive = state === 'live';
  const isNext = state === 'next';
  const isLater = state === 'later';

  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!isLive) return;
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, [isLive]);

  let badge, badgeColor;
  if (isPrev)  { badge = 'CLOSED';  badgeColor = '#5D5876'; }
  if (isLive)  { badge = '● LIVE';  badgeColor = '#14F195'; }
  if (isNext)  { badge = 'NEXT';    badgeColor = '#9945FF'; }
  if (isLater) { badge = 'LATER';   badgeColor = '#5D5876'; }

  const priceDiff = isLive && lockPrice != null ? livePrice - lockPrice : 0;
  const isPriceUp = priceDiff >= 0;
  const timeLeft = isLive ? Math.max(0, closeTime - now) : 0;
  const startsIn = isNext || isLater ? Math.max(0, lockTime - now) : 0;
  const urgent = isLive && timeLeft <= 10 && timeLeft > 0;

  const longWon  = isPrev && outcome === 'heads';
  const shortWon = isPrev && outcome === 'tails';

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const canBet = !isPrev;

  return (
    <div className={`fp-card fp-card-${state}`}>
      {isLive && <div className="fp-card-livering" />}

      <div className="fp-card-head">
        <span className="fp-card-badge" style={{ color: badgeColor, borderColor: badgeColor + '88' }}>{badge}</span>
        <span className="fp-card-epoch">#{epoch}</span>
      </div>

      <button
        className={`fp-card-side fp-card-long ${longWon ? 'won' : isPrev ? 'lost' : ''} ${userBet?.side === 'heads' ? 'active' : ''}`}
        onClick={() => canBet && !userBet && onSideTap(epoch, 'heads', headsPayout, tailsPayout)}
        disabled={isPrev || (userBet && userBet.side !== 'heads')}
      >
        <div className="fp-card-side-icon">↑</div>
        <div className="fp-card-side-label">LONG</div>
        <div className="fp-card-side-mult">{headsPayout.toFixed(2)}×</div>
      </button>

      <div className="fp-card-mid">
        {isLive && (
          <>
            <div className="fp-mid-label">LAST PRICE</div>
            <div className={`fp-mid-price ${isPriceUp ? 'up' : 'down'}`}>${livePrice.toFixed(4)}</div>
            <div className={`fp-mid-delta ${isPriceUp ? 'up' : 'down'}`}>
              {isPriceUp ? '↑' : '↓'} ${Math.abs(priceDiff).toFixed(4)}
            </div>
            <div className="fp-mid-divider" />
            <div className="fp-mid-row">
              <span>Locked</span>
              <span className="fp-mid-row-val">${lockPrice.toFixed(2)}</span>
            </div>
            <div className="fp-mid-row">
              <span>Pool</span>
              <span className="fp-mid-row-val gold">${totalPool.toFixed(2)}</span>
            </div>
            <div className={`fp-mid-timer ${urgent ? 'urgent' : ''}`}>
              {fmtTime(timeLeft)}
            </div>
          </>
        )}

        {isNext && (
          <>
            <div className="fp-mid-label">PRIZE POOL</div>
            <div className="fp-mid-pool">${totalPool.toFixed(2)}</div>
            <div className="fp-mid-divider" />
            <div className="fp-mid-payout-preview">
              <div>Long wins <b>${(5 * headsPayout).toFixed(2)}</b> per $5</div>
              <div>Short wins <b>${(5 * tailsPayout).toFixed(2)}</b> per $5</div>
            </div>
            <div className="fp-mid-starts">
              Starts in <b>{fmtTime(startsIn)}</b>
            </div>
          </>
        )}

        {isLater && (
          <>
            <div className="fp-mid-label">UPCOMING</div>
            <div className="fp-mid-later-icon">⏳</div>
            <div className="fp-mid-starts">
              Starts in <b>{fmtTime(startsIn)}</b>
            </div>
          </>
        )}

        {isPrev && (
          <>
            <div className="fp-mid-label">CLOSED</div>
            <div className="fp-mid-row">
              <span>Lock</span>
              <span className="fp-mid-row-val">${lockPrice.toFixed(2)}</span>
            </div>
            <div className="fp-mid-row">
              <span>Close</span>
              <span className="fp-mid-row-val">${closePrice.toFixed(2)}</span>
            </div>
            <div className="fp-mid-divider" />
            <div className={`fp-mid-outcome ${longWon ? 'long' : shortWon ? 'short' : 'tie'}`}>
              {longWon ? '↑ LONG WON' : shortWon ? '↓ SHORT WON' : '= TIE'}
            </div>
            {claimable && (
              <button className="fp-mid-claim" onClick={() => claim?.(epoch)}>
                💰 Claim Winnings
              </button>
            )}
          </>
        )}
      </div>

      <button
        className={`fp-card-side fp-card-short ${shortWon ? 'won' : isPrev ? 'lost' : ''} ${userBet?.side === 'tails' ? 'active' : ''}`}
        onClick={() => canBet && !userBet && onSideTap(epoch, 'tails', headsPayout, tailsPayout)}
        disabled={isPrev || (userBet && userBet.side !== 'tails')}
      >
        <div className="fp-card-side-mult">{tailsPayout.toFixed(2)}×</div>
        <div className="fp-card-side-label">SHORT</div>
        <div className="fp-card-side-icon">↓</div>
      </button>

      {userBet && !isPrev && (
        <div className={`fp-card-position fp-card-position-${userBet.side}`}>
          <span>● {userBet.side === 'heads' ? 'LONG' : 'SHORT'}</span>
          <span>${userBet.amount.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN
// ============================================================
export default function Flipsy({ onConnectWallet }) {
  const wallet = useWallet();

  useEffect(() => {
    if (typeof window === 'undefined' || window.eruda) return;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/eruda';
    s.onload = () => { try { window.eruda?.init(); } catch (e) { console.error(e); } };
    document.head.appendChild(s);
  }, []);

  let hookData = null;
  let hookError = null;
  try {
    hookData = useFlipsy(wallet);
  } catch (e) {
    hookError = e;
    console.error('[Flipsy] useFlipsy threw:', e);
  }
  const {
    livePrice = 0,
    liveRound = null,
    upcomingRounds = [],
    recentRounds = [],
    userBets = {},
    balance = 0,
    placeBet = async () => { throw new Error('Hook not ready'); },
    claim = async () => { throw new Error('Hook not ready'); },
    loading = true,
  } = hookData || {};

  const [flash, setFlash] = useState(null);
  const [geo, setGeo] = useState({ blocked: false, ready: false });
  const carouselRef = useRef(null);

  // Bet modal state
  const [betModal, setBetModal] = useState(null); // { epoch, side, headsPayout, tailsPayout }

  useEffect(() => {
    let cancelled = false;
    checkGeo().then((res) => {
      if (!cancelled) setGeo({ blocked: res.blocked, ready: true });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hookError) setFlash({ type: 'error', msg: `Hook crashed: ${hookError.message || 'see console'}` });
  }, [hookError]);

  // FIX 1: scroll to live card after loading
  useEffect(() => {
    if (!liveRound || loading) return;
    const t = setTimeout(() => {
      const live = carouselRef.current?.querySelector('.fp-card-live');
      if (live && carouselRef.current) {
        const container = carouselRef.current;
        const cardCenter = live.offsetLeft + live.offsetWidth / 2;
        container.scrollLeft = cardCenter - container.offsetWidth / 2;
      }
    }, 400);
    return () => clearTimeout(t);
  }, [liveRound?.epoch, loading]);

  useEffect(() => {
    if (flash) {
      const t = setTimeout(() => setFlash(null), 3500);
      return () => clearTimeout(t);
    }
  }, [flash]);

  const isAdminWallet = wallet.publicKey && wallet.publicKey.toBase58() === ADMIN_WALLET;

  const isClaimable = (round) => {
    const bet = userBets[round.epoch];
    if (!bet || bet.claimed) return false;
    if (round.outcome === bet.side) return true;
    if (round.outcome === 'tie') return true;
    return false;
  };

  const claimableRounds = recentRounds.filter(r => isClaimable(r));
  const hasClaim = claimableRounds.length > 0;

  // Called when user taps LONG or SHORT on a card
  const handleSideTap = (epoch, side, headsPayout, tailsPayout) => {
    if (!wallet.connected) {
      onConnectWallet?.();
      return;
    }
    if (!isAdminWallet) {
      setFlash({ type: 'error', msg: 'Private beta — wallet not authorized' });
      return;
    }
    setBetModal({ epoch, side, headsPayout, tailsPayout });
  };

  // Called from BetModal — simulate then sign
  const handleTrade = useCallback(async (epoch, side, amount) => {
    if (balance < amount) throw new Error('Insufficient balance');
    // placeBet handles simulation + transaction in useFlipsy
    await placeBet(epoch, side, amount);
    setFlash({ type: 'success', msg: `${side === 'heads' ? '↑ LONG' : '↓ SHORT'} #${epoch} · $${amount.toFixed(2)}` });
  }, [placeBet, balance]);

  const handleClaim = async (epoch) => {
    if (!wallet.connected) { onConnectWallet?.(); return; }
    if (!isAdminWallet) {
      setFlash({ type: 'error', msg: 'Private beta — wallet not authorized' });
      return;
    }
    try {
      await claim(epoch);
      setFlash({ type: 'success', msg: `💰 Claimed #${epoch}` });
    } catch (e) {
      setFlash({ type: 'error', msg: e.message || 'Claim failed' });
    }
  };

  if (geo.ready && geo.blocked && !isAdminWallet) {
    return (
      <BlockScreen
        title="Not Available"
        message="Flipsy is not available in your region."
        sub="This may change in the future."
      />
    );
  }

  return (
    <div className="fp-page">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div className="fp-glow fp-glow-1" />
      <div className="fp-glow fp-glow-2" />
      <div className="fp-glow fp-glow-3" />

      {hasClaim && (
        <div className="fp-claim-banner" onClick={() => handleClaim(claimableRounds[0].epoch)}>
          <span className="fp-claim-banner-icon">💰</span>
          <span>Round #{claimableRounds[0].epoch} — tap to collect winnings</span>
          {claimableRounds.length > 1 && (
            <span className="fp-claim-banner-count">+{claimableRounds.length - 1} more</span>
          )}
        </div>
      )}

      {flash && (
        <div className={`fp-flash-top fp-flash ${flash.type}`}>{flash.msg}</div>
      )}

      <header className="fp-header">
        <div className="fp-brand">
          <div className="fp-mascot">F</div>
          <div>
            <div className="fp-title">FLIPSY</div>
            <div className="fp-subtitle">Solana Sentiment</div>
          </div>
        </div>
        <div className="fp-actions">
          {wallet.connected ? (
            <div className="fp-balance">
              <span className="fp-balance-label">Bal</span>
              <span className="fp-balance-val">${balance.toFixed(2)}</span>
            </div>
          ) : (
            <div
              className="fp-balance"
              style={{ cursor: 'pointer', color: '#14F195', fontSize: 11, fontWeight: 800 }}
              onClick={() => onConnectWallet?.()}
            >
              Connect Wallet
            </div>
          )}
        </div>
      </header>

      <div className="fp-rounds-head">
        <h3 className="fp-rounds-title">Rounds</h3>
        <span className="fp-rounds-sub">swipe <span className="arrow">←</span></span>
      </div>

      <div className="fp-carousel" ref={carouselRef}>
        {loading && !liveRound && (
          <div className="fp-card fp-card-loading">
            <div style={{ textAlign: 'center', padding: 60, color: '#9892B5', fontSize: 13 }}>
              Loading rounds…
            </div>
          </div>
        )}

        {[...recentRounds].reverse().map(r => (
          <RoundCard
            key={`prev-${r.epoch}`}
            round={r} state="previous"
            userBet={userBets[r.epoch]}
            livePrice={livePrice}
            onSideTap={handleSideTap}
            claim={handleClaim}
            claimable={isClaimable(r)}
          />
        ))}

        {liveRound && (
          <RoundCard
            round={liveRound} state="live"
            userBet={userBets[liveRound.epoch]}
            livePrice={livePrice}
            onSideTap={handleSideTap}
          />
        )}

        {upcomingRounds[0] && (
          <RoundCard
            key={`next-${upcomingRounds[0].epoch}`}
            round={upcomingRounds[0]} state="next"
            userBet={userBets[upcomingRounds[0].epoch]}
            livePrice={livePrice}
            onSideTap={handleSideTap}
          />
        )}

        {upcomingRounds.slice(1).map(r => (
          <RoundCard
            key={`later-${r.epoch}`}
            round={r} state="later"
            userBet={userBets[r.epoch]}
            livePrice={livePrice}
            onSideTap={handleSideTap}
          />
        ))}
      </div>

      <div className="fp-footer">
        Powered by Solana · Non-custodial · 25% fee on wins only · No other fees
      </div>

      {/* BET MODAL */}
      {betModal && (
        <BetModal
          open={!!betModal}
          side={betModal.side}
          epoch={betModal.epoch}
          headsPayout={betModal.headsPayout}
          tailsPayout={betModal.tailsPayout}
          balance={balance}
          livePrice={livePrice}
          onClose={() => setBetModal(null)}
          onTrade={handleTrade}
        />
      )}
    </div>
  );
}
