import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFlipsy } from '../hooks/useFlipsy';
import './Flipsy.css';

// ============================================================
// TESTING GUARDS — remove or open up before public launch
// ============================================================
const ADMIN_WALLET = 'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA';
const BLOCKED_COUNTRIES = ['US'];

const MIN_BET = 5;
const MAX_BET = 20;
const NET_MULT = 0.75; // 25% fee on profit only (matches FEE_BPS=2500 in lib.rs)
// ============================================================

// Geo check — runs in background. Page renders regardless; block screen
// only appears if geo resolves to a blocked country AND wallet isn't admin.
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
    } catch {
      // try next source
    }
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
// ROUND CARD — handles all four states
// ============================================================
function RoundCard({ round, state, userBet, livePrice, betAmount, placeBet, claim, claimable }) {
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

  // Local 1-sec ticker — only the LIVE card needs second-by-second precision.
  // NEXT and LATER cards show minute-scale countdowns ("Starts in 7:54") that
  // update fine on chain-poll cadence (every 5s). Fewer tickers = less jank.
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
  const tied     = isPrev && outcome === 'tie';

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const handleSide = (side) => {
    if (isNext || isLater) placeBet?.(epoch, side, betAmount);
  };

  return (
    <div className={`fp-card fp-card-${state}`}>
      {isLive && <div className="fp-card-livering" />}

      {/* HEADER */}
      <div className="fp-card-head">
        <span className="fp-card-badge" style={{ color: badgeColor, borderColor: badgeColor + '88' }}>{badge}</span>
        <span className="fp-card-epoch">#{epoch}</span>
      </div>

      {/* LONG */}
      <button
        className={`fp-card-side fp-card-long ${longWon ? 'won' : isPrev ? 'lost' : ''} ${userBet?.side === 'heads' ? 'active' : ''}`}
        onClick={() => handleSide('heads')}
        disabled={isPrev || isLive || userBet?.side === 'tails'}
      >
        <div className="fp-card-side-icon">↑</div>
        <div className="fp-card-side-label">LONG</div>
        <div className="fp-card-side-mult">{headsPayout.toFixed(2)}×</div>
      </button>

      {/* MIDDLE */}
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
              <div>If long, win <b>${(betAmount * headsPayout).toFixed(2)}</b></div>
              <div>If short, win <b>${(betAmount * tailsPayout).toFixed(2)}</b></div>
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
                💰 Claim
              </button>
            )}
          </>
        )}
      </div>

      {/* SHORT */}
      <button
        className={`fp-card-side fp-card-short ${shortWon ? 'won' : isPrev ? 'lost' : ''} ${userBet?.side === 'tails' ? 'active' : ''}`}
        onClick={() => handleSide('tails')}
        disabled={isPrev || isLive || userBet?.side === 'heads'}
      >
        <div className="fp-card-side-mult">{tailsPayout.toFixed(2)}×</div>
        <div className="fp-card-side-label">SHORT</div>
        <div className="fp-card-side-icon">↓</div>
      </button>

      {userBet && (isLive || isNext || isLater) && (
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
export default function Flipsy() {
  const wallet = useWallet();

  // Load eruda mobile console for debugging — REMOVE before production launch.
  // Tap the floating gear icon (bottom-right) to see errors / network / etc.
  useEffect(() => {
    if (typeof window === 'undefined' || window.eruda) return;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/eruda';
    s.onload = () => { try { window.eruda?.init(); } catch (e) { console.error(e); } };
    document.head.appendChild(s);
  }, []);

  // Call useFlipsy defensively. If the hook itself throws (bad IDL, anchor version
  // mismatch, missing Buffer polyfill, etc), fall back to empty data so the
  // page shell still renders and we can see WHAT'S broken via eruda.
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

  const [betAmount, setBetAmount] = useState(MIN_BET);
  const [flash, setFlash] = useState(null);
  const [geo, setGeo] = useState({ blocked: false, ready: false });
  const carouselRef = useRef(null);

  // Geo check — fires once on mount, never blocks render
  useEffect(() => {
    let cancelled = false;
    checkGeo().then((res) => {
      if (!cancelled) setGeo({ blocked: res.blocked, ready: true });
    });
    return () => { cancelled = true; };
  }, []);

  // Surface hook error to user via flash so it's visible without console
  useEffect(() => {
    if (hookError) {
      setFlash({ type: 'error', msg: `Hook crashed: ${hookError.message || 'see console'}` });
    }
  }, [hookError]);

  // Auto-scroll to live card when it loads
  useEffect(() => {
    if (!liveRound) return;
    const t = setTimeout(() => {
      const live = carouselRef.current?.querySelector('.fp-card-live');
      if (live && carouselRef.current) {
        const container = carouselRef.current;
        const cardCenter = live.offsetLeft + live.offsetWidth / 2;
        container.scrollLeft = cardCenter - container.offsetWidth / 2;
      }
    }, 150);
    return () => clearTimeout(t);
  }, [liveRound?.epoch]);

  // Flash auto-dismiss
  useEffect(() => {
    if (flash) {
      const t = setTimeout(() => setFlash(null), 3500);
      return () => clearTimeout(t);
    }
  }, [flash]);

  // Admin wallet check (only your wallet can bet/claim — page itself is always visible)
  const isAdminWallet = wallet.publicKey && wallet.publicKey.toBase58() === ADMIN_WALLET;

  // PLACE BET wrapper with feedback
  const handlePlaceBet = async (epoch, side, amount) => {
    if (!wallet.connected) {
      setFlash({ type: 'error', msg: 'Connect wallet first' });
      return;
    }
    if (!isAdminWallet) {
      setFlash({ type: 'error', msg: 'Private beta — wallet not authorized' });
      return;
    }
    if (amount < MIN_BET || amount > MAX_BET) {
      setFlash({ type: 'error', msg: `$${MIN_BET}–$${MAX_BET}` });
      return;
    }
    if (balance < amount) {
      setFlash({ type: 'error', msg: 'Insufficient balance' });
      return;
    }
    try {
      await placeBet(epoch, side, amount);
      setFlash({ type: 'success', msg: `${side === 'heads' ? '↑ LONG' : '↓ SHORT'} #${epoch} · $${amount.toFixed(2)}` });
    } catch (e) {
      console.error(e);
      setFlash({ type: 'error', msg: e.message || 'Transaction failed' });
    }
  };

  // CLAIM wrapper with feedback
  const handleClaim = async (epoch) => {
    if (!isAdminWallet) {
      setFlash({ type: 'error', msg: 'Private beta — wallet not authorized' });
      return;
    }
    try {
      await claim(epoch);
      setFlash({ type: 'success', msg: `Claimed #${epoch}` });
    } catch (e) {
      setFlash({ type: 'error', msg: e.message || 'Claim failed' });
    }
  };

  // Figure out which previous rounds are claimable by this user
  const isClaimable = (round) => {
    const bet = userBets[round.epoch];
    if (!bet || bet.claimed) return false;
    if (round.outcome === bet.side) return true;
    if (round.outcome === 'tie') return true;
    return false;
  };

  return (
    <div className="fp-page">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div className="fp-glow fp-glow-1" />
      <div className="fp-glow fp-glow-2" />
      <div className="fp-glow fp-glow-3" />

      {/* HEADER */}
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
            <div className="fp-balance" style={{ color: '#9892B5', fontSize: 11 }}>
              Connect wallet in header
            </div>
          )}
        </div>
      </header>

      {/* ROUNDS HEADER */}
      <div className="fp-rounds-head">
        <h3 className="fp-rounds-title">Rounds</h3>
        <span className="fp-rounds-sub">swipe <span className="arrow">←</span></span>
      </div>

      {/* CAROUSEL */}
      <div className="fp-carousel" ref={carouselRef}>
        {loading && !liveRound && (
          <div className="fp-card fp-card-loading">
            <div style={{ textAlign: 'center', padding: 60, color: '#9892B5', fontSize: 13 }}>
              Loading rounds…
            </div>
          </div>
        )}

        {/* Previous rounds — oldest first so live is centered when scrolled to */}
        {[...recentRounds].reverse().map(r => (
          <RoundCard
            key={`prev-${r.epoch}`}
            round={r}
            state="previous"
            userBet={userBets[r.epoch]}
            livePrice={livePrice}
            betAmount={betAmount}
            placeBet={handlePlaceBet}
            claim={handleClaim}
            claimable={isClaimable(r)}
          />
        ))}

        {/* LIVE round */}
        {liveRound && (
          <RoundCard
            round={liveRound}
            state="live"
            userBet={userBets[liveRound.epoch]}
            livePrice={livePrice}
            betAmount={betAmount}
            placeBet={handlePlaceBet}
          />
        )}

        {/* NEXT round */}
        {upcomingRounds[0] && (
          <RoundCard
            key={`next-${upcomingRounds[0].epoch}`}
            round={upcomingRounds[0]}
            state="next"
            userBet={userBets[upcomingRounds[0].epoch]}
            livePrice={livePrice}
            betAmount={betAmount}
            placeBet={handlePlaceBet}
          />
        )}

        {/* LATER rounds */}
        {upcomingRounds.slice(1).map(r => (
          <RoundCard
            key={`later-${r.epoch}`}
            round={r}
            state="later"
            userBet={userBets[r.epoch]}
            livePrice={livePrice}
            betAmount={betAmount}
            placeBet={handlePlaceBet}
          />
        ))}
      </div>

      {/* BOTTOM */}
      <div className="fp-bottom">
        <div className="fp-bottom-card">
          <div className="fp-bottom-head">
            <h3 className="fp-bottom-title">Position Size</h3>
            <span className="fp-bottom-tag">25% fee</span>
          </div>
          <div className="fp-amt-box">
            <div className="fp-amt-row">
              <button className="fp-amt-step" onClick={() => setBetAmount(a => +Math.max(MIN_BET, a - 1).toFixed(2))}>−</button>
              <input
                type="number" min={MIN_BET} max={MAX_BET} step={1}
                value={betAmount}
                onChange={(e) => setBetAmount(Math.max(MIN_BET, Math.min(MAX_BET, +(+e.target.value || MIN_BET).toFixed(2))))}
                className="fp-amt-input"
              />
              <button className="fp-amt-step" onClick={() => setBetAmount(a => +Math.min(MAX_BET, a + 1).toFixed(2))}>+</button>
            </div>
            <div className="fp-quick-row">
              {[5, 10, 15, 20].map(v => (
                <button
                  key={v}
                  className={`fp-quick ${betAmount === v ? 'active' : ''}`}
                  onClick={() => setBetAmount(v)}
                >${v}</button>
              ))}
            </div>
          </div>
          {flash && <div className={`fp-flash ${flash.type}`}>{flash.msg}</div>}
        </div>

        <div className="fp-bottom-card">
          <div className="fp-bottom-head">
            <h3 className="fp-bottom-title">History</h3>
          </div>
          <div className="fp-hist-list">
            {recentRounds.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: '#5D5876', fontSize: 12, fontWeight: 600 }}>
                No completed rounds yet
              </div>
            )}
            {recentRounds.map(h => (
              <div key={h.epoch} className="fp-hist-item">
                <div className="fp-hist-epoch">#{h.epoch}</div>
                <div className="fp-hist-prices">
                  {h.lockPrice.toFixed(2)} → {h.closePrice.toFixed(2)}
                </div>
                <div className={`fp-hist-result ${h.outcome === 'heads' ? 'up' : h.outcome === 'tails' ? 'down' : 'tie'}`}>
                  {h.outcome === 'heads' ? 'LONG' : h.outcome === 'tails' ? 'SHORT' : 'TIE'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="fp-footer">
        Powered by Solana · Non-custodial · 25% program fee on wins · No other fees
      </div>
    </div>
  );
}
