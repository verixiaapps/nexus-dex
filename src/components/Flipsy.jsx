import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFlipsy } from '../hooks/useFlipsy';
import './Flipsy.css';

const ADMIN_WALLET = 'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA';
const BLOCKED_COUNTRIES = ['US'];
const MIN_BET = 5;
const MAX_BET = 20;
const NET_MULT = 0.75;
const CLAIM_FORFEIT_DELAY = 259200; // 3 days in seconds

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
// ROUNDS HISTORY POPUP
// ============================================================
function RoundsPopup({ open, onClose, recentRounds, userBets, onClaim }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  if (!open) return null;

  const getBetsForEpoch = (epoch) => {
    const b = userBets[epoch];
    if (!b) return [];
    return Array.isArray(b) ? b : [b];
  };

  const nowTs = Math.floor(Date.now() / 1000);

  const isClaimable = (round) => {
    const bets = getBetsForEpoch(round.epoch);
    const expired = round.resolvedAt > 0 && nowTs > round.resolvedAt + CLAIM_FORFEIT_DELAY;
    if (expired) return false;
    return bets.some(b => {
      if (b.claimed) return false;
      if (round.outcome === b.side) return true;
      if (round.outcome === 'tie') return true;
      return false;
    });
  };

  // Only show rounds the user actually participated in
  const rounds = [...recentRounds]
    .reverse()
    .filter(r => getBetsForEpoch(r.epoch).length > 0);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
      }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480,
        zIndex: 201,
        background: 'linear-gradient(180deg, #12111f 0%, #0a0a14 100%)',
        borderTop: '2px solid rgba(153,69,255,0.4)',
        borderRadius: '28px 28px 0 0',
        maxHeight: '75vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Inter, sans-serif',
        animation: 'fp-modal-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Handle */}
        <div style={{ flexShrink: 0, padding: '16px 20px 0' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', margin: '0 auto 16px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', letterSpacing: '0.04em' }}>My Rounds</div>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.06)', border: 'none',
              borderRadius: '50%', width: 30, height: 30,
              color: '#9892B5', cursor: 'pointer', fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
          {rounds.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#5D5876', fontSize: 13, fontWeight: 600 }}>
              No rounds yet
            </div>
          )}
          {rounds.map(r => {
            const bets = getBetsForEpoch(r.epoch);
            const canClaim = isClaimable(r);
            const deadlineTs = r.resolvedAt > 0 ? r.resolvedAt + CLAIM_FORFEIT_DELAY : 0;
            const hoursLeft = deadlineTs > 0 ? Math.max(0, Math.floor((deadlineTs - nowTs) / 3600)) : 0;
            const expired = deadlineTs > 0 && nowTs > deadlineTs;
            const hasUnclaimedWin = bets.some(b => !b.claimed && (r.outcome === b.side || r.outcome === 'tie'));

            const longTotal = bets.filter(b => b.side === 'heads').reduce((s, b) => s + b.amount, 0);
            const shortTotal = bets.filter(b => b.side === 'tails').reduce((s, b) => s + b.amount, 0);
            const won = (r.outcome === 'heads' && longTotal > 0) || (r.outcome === 'tails' && shortTotal > 0);
            const lost = !won && r.outcome !== 'tie' && r.outcome !== 'unresolved';
            const tie = r.outcome === 'tie';

            let resultColor = '#5D5876';
            let resultLabel = r.outcome === 'heads' ? '↑ LONG WON' : r.outcome === 'tails' ? '↓ SHORT WON' : '= TIE';
            if (won) resultColor = '#14F195';
            if (lost) resultColor = '#DC1FFF';
            if (tie) resultColor = '#9945FF';

            return (
              <div key={r.epoch} style={{
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${won || canClaim ? 'rgba(20,241,149,0.2)' : lost ? 'rgba(220,31,255,0.2)' : 'rgba(153,69,255,0.2)'}`,
                borderRadius: 16, padding: '12px 14px', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                {/* Epoch */}
                <div style={{ minWidth: 36, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.1em' }}>RND</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#9945FF' }}>#{r.epoch}</div>
                </div>

                {/* Prices + bets */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#5D5876', fontVariantNumeric: 'tabular-nums' }}>
                    ${r.lockPrice.toFixed(2)} → ${r.closePrice.toFixed(2)}
                  </div>
                  <div style={{ marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {longTotal > 0 && (
                      <span style={{ fontSize: 10, color: '#14F195', fontWeight: 700 }}>↑ ${longTotal.toFixed(2)}</span>
                    )}
                    {shortTotal > 0 && (
                      <span style={{ fontSize: 10, color: '#DC1FFF', fontWeight: 700 }}>↓ ${shortTotal.toFixed(2)}</span>
                    )}
                  </div>
                  {/* Deadline warning for claimable wins */}
                  {canClaim && hoursLeft <= 24 && (
                    <div style={{ fontSize: 9, color: '#FFD66B', fontWeight: 700, marginTop: 2 }}>
                      ⚠️ {hoursLeft}h left to collect
                    </div>
                  )}
                </div>

                {/* Result / Claim / Expired */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {canClaim ? (
                    <div>
                      <button onClick={() => onClaim(r.epoch)} style={{
                        background: 'linear-gradient(135deg, #FFD66B, #FFC247)',
                        border: 'none', borderRadius: 10, padding: '7px 12px',
                        color: '#1A0F00', fontWeight: 900, fontSize: 11,
                        cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                        letterSpacing: '0.06em',
                        boxShadow: '0 4px 12px rgba(255,214,107,0.4)',
                        display: 'block',
                      }}>💰 Collect</button>
                      {hoursLeft > 0 && hoursLeft > 24 && (
                        <div style={{ fontSize: 9, color: '#9892B5', marginTop: 3, textAlign: 'center' }}>
                          {hoursLeft}h left
                        </div>
                      )}
                    </div>
                  ) : expired && hasUnclaimedWin ? (
                    <div style={{
                      fontSize: 10, fontWeight: 900, color: '#5D5876',
                      letterSpacing: '0.08em', padding: '5px 10px',
                      background: 'rgba(93,88,118,0.12)',
                      border: '1px solid rgba(93,88,118,0.3)',
                      borderRadius: 8,
                    }}>⌛ EXPIRED</div>
                  ) : (
                    <div style={{
                      fontSize: 10, fontWeight: 900, color: resultColor,
                      letterSpacing: '0.08em', padding: '5px 10px',
                      background: resultColor + '18',
                      border: `1px solid ${resultColor}44`,
                      borderRadius: 8,
                    }}>
                      {lost ? '💔 LOST' : tie ? '= TIE' : resultLabel}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* 3 day forfeit note */}
          <div style={{
            marginTop: 8, padding: '10px 14px', borderRadius: 12,
            background: 'rgba(255,214,107,0.06)',
            border: '1px solid rgba(255,214,107,0.15)',
            fontSize: 10, color: '#9892B5', lineHeight: 1.5, textAlign: 'center',
          }}>
            ⚠️ Uncollected winnings are forfeited after <span style={{ color: '#FFD66B', fontWeight: 800 }}>3 days</span>. Collect promptly.
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// BET MODAL
// ============================================================
function BetModal({ open, side, epoch, onClose, onTrade, balance, headsPayout, tailsPayout }) {
  const [amount, setAmount] = useState('5');
  const [status, setStatus] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setAmount('5'); setStatus('idle'); setErrMsg('');
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
  const belowMin = amt > 0 && amt < MIN_BET;
  const aboveMax = amt > MAX_BET;
  const invalidAmount = belowMin || aboveMax || insufficient;

  const handleTrade = async () => {
    if (amt <= 0 || invalidAmount) return;
    setStatus('signing'); setErrMsg('');
    try {
      await onTrade(epoch, side, amt);
      setStatus('success');
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setErrMsg(e.message || 'Transaction failed');
      setStatus('error');
    }
  };

  let buttonLabel = 'Trade';
  if (insufficient) buttonLabel = 'Insufficient Balance';
  else if (belowMin) buttonLabel = `Minimum $${MIN_BET}`;
  else if (aboveMax) buttonLabel = `Maximum $${MAX_BET}`;
  else if (status === 'signing') buttonLabel = 'Signing…';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480, zIndex: 301,
        background: 'linear-gradient(180deg, #12111f 0%, #0a0a14 100%)',
        borderTop: `2px solid ${sideColor}55`, borderRadius: '28px 28px 0 0',
        padding: '20px 20px 36px', fontFamily: 'Inter, sans-serif',
        animation: 'fp-modal-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', margin: '0 auto 18px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: '6px 16px', borderRadius: 999, background: sideColor + '18', border: `1px solid ${sideColor}66`, color: sideColor, fontWeight: 900, fontSize: 14, letterSpacing: '0.1em' }}>{sideLabel}</div>
            <span style={{ color: '#5D5876', fontSize: 12 }}>Round #{epoch}</span>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '50%', width: 32, height: 32, color: '#9892B5', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        <div style={{ background: 'rgba(6,6,12,0.8)', border: `1.5px solid ${status === 'error' ? '#DC1FFF66' : sideColor + '44'}`, borderRadius: 18, padding: '14px 18px', marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.2em', marginBottom: 6 }}>
            AMOUNT (USD) · MIN ${MIN_BET} · MAX ${MAX_BET}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: '#5D5876' }}>$</span>
            <input ref={inputRef} type="number" min={MIN_BET} max={MAX_BET} value={amount}
              onChange={e => { setAmount(e.target.value); setStatus('idle'); setErrMsg(''); }}
              disabled={status === 'signing' || status === 'success'}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 34, fontWeight: 900, color: '#FFFFFF', fontFamily: 'Inter, sans-serif', fontVariantNumeric: 'tabular-nums' }} />
            {balance != null && <span style={{ fontSize: 10, color: '#5D5876', whiteSpace: 'nowrap' }}>Bal: ${balance.toFixed(2)}</span>}
          </div>
        </div>

        {/* Quick-select buttons — all within $5–$20 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[5, 10, 15, 20].map(v => (
            <button key={v} onClick={() => { setAmount(String(v)); setStatus('idle'); setErrMsg(''); }}
              disabled={status === 'signing' || status === 'success'}
              style={{ flex: 1, padding: '8px 0', borderRadius: 999, background: parseFloat(amount) === v ? sideColor + '22' : 'rgba(255,255,255,0.04)', border: `1px solid ${parseFloat(amount) === v ? sideColor + '88' : 'rgba(255,255,255,0.08)'}`, color: parseFloat(amount) === v ? sideColor : '#9892B5', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.15s' }}
            >${v}</button>
          ))}
        </div>

        {amt > 0 && !belowMin && !aboveMax && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.15em', marginBottom: 3 }}>EST. PAYOUT</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: sideColor, fontVariantNumeric: 'tabular-nums' }}>${estWin.toFixed(2)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.15em', marginBottom: 3 }}>MULTIPLIER</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#FFD66B' }}>{payout.toFixed(2)}×</div>
            </div>
          </div>
        )}

        {status === 'signing' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '10px', marginBottom: 10, color: sideColor, fontSize: 13, fontWeight: 700 }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${sideColor}`, borderTopColor: 'transparent', animation: 'fp-spin 0.7s linear infinite' }} />
            Check your wallet…
          </div>
        )}
        {status === 'success' && (
          <div style={{ textAlign: 'center', padding: '10px', marginBottom: 10, color: '#14F195', fontSize: 14, fontWeight: 800, animation: 'fp-pop 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}>✓ Trade placed!</div>
        )}
        {status === 'error' && errMsg && (
          <div style={{ padding: '10px 14px', marginBottom: 10, borderRadius: 12, background: 'rgba(220,31,255,0.1)', border: '1px solid #DC1FFF44', color: '#DC1FFF', fontSize: 12, fontWeight: 700 }}>{errMsg}</div>
        )}

        {status !== 'success' && (
          <button onClick={handleTrade} disabled={amt <= 0 || invalidAmount || status === 'signing'}
            style={{ width: '100%', padding: '16px', borderRadius: 18, border: 'none', background: invalidAmount ? 'rgba(255,255,255,0.06)' : status === 'signing' ? 'rgba(255,255,255,0.08)' : `linear-gradient(135deg, ${sideColor}, ${isLong ? '#00D9FF' : '#9945FF'})`, color: invalidAmount || status === 'signing' ? '#5D5876' : isLong ? '#001A0F' : '#FFFFFF', fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 16, letterSpacing: '0.08em', cursor: invalidAmount || status === 'signing' ? 'not-allowed' : 'pointer', boxShadow: invalidAmount || status === 'signing' ? 'none' : `0 8px 30px ${sideColor}44`, transition: 'all 0.2s' }}>
            {buttonLabel}
          </button>
        )}
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 10, color: '#5D5876', fontWeight: 600, letterSpacing: '0.1em' }}>
          NETWORK FEE ~0.000005 SOL · 25% FEE ON WINNINGS ONLY
        </div>
      </div>
    </>
  );
}

// ============================================================
// ROUND CARD
// ============================================================
function RoundCard({ round, state, userBets, livePrice, onSideTap, claim, claimable }) {
  const { epoch, headsPool = 0, tailsPool = 0, lockPrice = 0, closePrice = 0, lockTime = 0, closeTime = 0, outcome = 'unresolved' } = round;
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
  if (isPrev)  { badge = 'CLOSED'; badgeColor = '#5D5876'; }
  if (isLive)  { badge = '● LIVE'; badgeColor = '#14F195'; }
  if (isNext)  { badge = 'NEXT';   badgeColor = '#9945FF'; }
  if (isLater) { badge = 'LATER';  badgeColor = '#5D5876'; }

  const priceDiff = isLive && lockPrice != null ? livePrice - lockPrice : 0;
  const isPriceUp = priceDiff >= 0;
  const timeLeft = isLive ? Math.max(0, closeTime - now) : 0;
  const startsIn = isNext || isLater ? Math.max(0, lockTime - now) : 0;
  const urgent = isLive && timeLeft <= 10 && timeLeft > 0;
  const longWon = isPrev && outcome === 'heads';
  const shortWon = isPrev && outcome === 'tails';
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const betsArr = Array.isArray(userBets) ? userBets : (userBets ? [userBets] : []);
  const longTotal = betsArr.filter(b => b.side === 'heads').reduce((s, b) => s + b.amount, 0);
  const shortTotal = betsArr.filter(b => b.side === 'tails').reduce((s, b) => s + b.amount, 0);

  return (
    <div className={`fp-card fp-card-${state}`}>
      {isLive && <div className="fp-card-livering" />}
      <div className="fp-card-head">
        <span className="fp-card-badge" style={{ color: badgeColor, borderColor: badgeColor + '88' }}>{badge}</span>
        <span className="fp-card-epoch">#{epoch}</span>
      </div>

      {/* Long button — enabled on live, next, and later cards */}
      <button className={`fp-card-side fp-card-long ${longWon ? 'won' : isPrev ? 'lost' : ''} ${longTotal > 0 ? 'active' : ''}`}
        onClick={() => !isPrev && onSideTap(epoch, 'heads', headsPayout, tailsPayout)} disabled={isPrev}>
        <div className="fp-card-side-icon">↑</div>
        <div className="fp-card-side-label">LONG</div>
        <div className="fp-card-side-mult">{headsPayout.toFixed(2)}×</div>
      </button>

      <div className="fp-card-mid">
        {isLive && (<>
          <div className="fp-mid-label">LAST PRICE</div>
          <div className={`fp-mid-price ${isPriceUp ? 'up' : 'down'}`}>${livePrice.toFixed(4)}</div>
          <div className={`fp-mid-delta ${isPriceUp ? 'up' : 'down'}`}>{isPriceUp ? '↑' : '↓'} ${Math.abs(priceDiff).toFixed(4)}</div>
          <div className="fp-mid-divider" />
          <div className="fp-mid-row"><span>Locked</span><span className="fp-mid-row-val">${lockPrice.toFixed(2)}</span></div>
          <div className="fp-mid-row"><span>Pool</span><span className="fp-mid-row-val gold">${totalPool.toFixed(2)}</span></div>
          <div className={`fp-mid-timer ${urgent ? 'urgent' : ''}`}>{fmtTime(timeLeft)}</div>
        </>)}
        {isNext && (<>
          <div className="fp-mid-label">PRIZE POOL</div>
          <div className="fp-mid-pool">${totalPool.toFixed(2)}</div>
          <div className="fp-mid-divider" />
          <div className="fp-mid-payout-preview">
            <div>Long wins <b>${(5 * headsPayout).toFixed(2)}</b> per $5</div>
            <div>Short wins <b>${(5 * tailsPayout).toFixed(2)}</b> per $5</div>
          </div>
          <div className="fp-mid-starts">Starts in <b>{fmtTime(startsIn)}</b></div>
        </>)}
        {isLater && (<>
          <div className="fp-mid-label">UPCOMING</div>
          <div className="fp-mid-later-icon">⏳</div>
          <div className="fp-mid-starts">Starts in <b>{fmtTime(startsIn)}</b></div>
        </>)}
        {isPrev && (<>
          <div className="fp-mid-label">CLOSED</div>
          <div className="fp-mid-row"><span>Lock</span><span className="fp-mid-row-val">${lockPrice.toFixed(2)}</span></div>
          <div className="fp-mid-row"><span>Close</span><span className="fp-mid-row-val">${closePrice.toFixed(2)}</span></div>
          <div className="fp-mid-divider" />
          <div className={`fp-mid-outcome ${longWon ? 'long' : shortWon ? 'short' : 'tie'}`}>
            {longWon ? '↑ LONG WON' : shortWon ? '↓ SHORT WON' : '= TIE'}
          </div>
          {claimable && <button className="fp-mid-claim" onClick={() => claim?.(epoch)}>💰 Claim Winnings</button>}
        </>)}
      </div>

      {/* Short button — enabled on live, next, and later cards */}
      <button className={`fp-card-side fp-card-short ${shortWon ? 'won' : isPrev ? 'lost' : ''} ${shortTotal > 0 ? 'active' : ''}`}
        onClick={() => !isPrev && onSideTap(epoch, 'tails', headsPayout, tailsPayout)} disabled={isPrev}>
        <div className="fp-card-side-mult">{tailsPayout.toFixed(2)}×</div>
        <div className="fp-card-side-label">SHORT</div>
        <div className="fp-card-side-icon">↓</div>
      </button>

      {longTotal > 0 && !isPrev && <div className="fp-card-position fp-card-position-heads"><span>● LONG</span><span>${longTotal.toFixed(2)}</span></div>}
      {shortTotal > 0 && !isPrev && <div className="fp-card-position fp-card-position-tails"><span>● SHORT</span><span>${shortTotal.toFixed(2)}</span></div>}
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

  let hookData = null, hookError = null;
  try { hookData = useFlipsy(wallet); }
  catch (e) { hookError = e; console.error('[Flipsy] useFlipsy threw:', e); }

  const { livePrice = 0, liveRound = null, upcomingRounds = [], recentRounds = [], userBets = {}, balance = 0,
    placeBet = async () => { throw new Error('Hook not ready'); },
    claim = async () => { throw new Error('Hook not ready'); },
    loading = true } = hookData || {};

  const [flash, setFlash] = useState(null);
  const [geo, setGeo] = useState({ blocked: false, ready: false });
  const [betModal, setBetModal] = useState(null);
  const [roundsOpen, setRoundsOpen] = useState(false);
  const carouselRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    checkGeo().then((res) => { if (!cancelled) setGeo({ blocked: res.blocked, ready: true }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hookError) setFlash({ type: 'error', msg: `Hook crashed: ${hookError.message || 'see console'}` });
  }, [hookError]);

  useEffect(() => {
    if (!liveRound || loading) return;
    const t = setTimeout(() => {
      const live = carouselRef.current?.querySelector('.fp-card-live');
      if (live && carouselRef.current) {
        const container = carouselRef.current;
        container.scrollLeft = live.offsetLeft + live.offsetWidth / 2 - container.offsetWidth / 2;
      }
    }, 400);
    return () => clearTimeout(t);
  }, [liveRound?.epoch, loading]);

  useEffect(() => {
    if (flash) { const t = setTimeout(() => setFlash(null), 3500); return () => clearTimeout(t); }
  }, [flash]);

  const isAdminWallet = wallet.publicKey && wallet.publicKey.toBase58() === ADMIN_WALLET;

  const getBetsForEpoch = (epoch) => {
    const b = userBets[epoch];
    if (!b) return [];
    return Array.isArray(b) ? b : [b];
  };

  const nowTs = Math.floor(Date.now() / 1000);

  const isClaimable = (round) => {
    const expired = round.resolvedAt > 0 && nowTs > round.resolvedAt + CLAIM_FORFEIT_DELAY;
    if (expired) return false;
    const bets = getBetsForEpoch(round.epoch);
    return bets.some(b => {
      if (b.claimed) return false;
      if (round.outcome === b.side) return true;
      if (round.outcome === 'tie') return true;
      return false;
    });
  };

  const claimableRounds = recentRounds.filter(r => isClaimable(r));
  const hasClaim = claimableRounds.length > 0;

  // Open to all connected wallets — no admin gate
  const handleSideTap = (epoch, side, headsPayout, tailsPayout) => {
    if (!wallet.connected) { onConnectWallet?.(); return; }
    setBetModal({ epoch, side, headsPayout, tailsPayout });
  };

  const handleTrade = useCallback(async (epoch, side, amount) => {
    if (amount < MIN_BET) throw new Error(`Minimum bet is $${MIN_BET}`);
    if (amount > MAX_BET) throw new Error(`Maximum bet is $${MAX_BET}`);
    if (balance < amount) throw new Error('Insufficient balance');
    await placeBet(epoch, side, amount);
    setFlash({ type: 'success', msg: `${side === 'heads' ? '↑ LONG' : '↓ SHORT'} #${epoch} · $${amount.toFixed(2)}` });
  }, [placeBet, balance]);

  const handleClaim = async (epoch) => {
    if (!wallet.connected) { onConnectWallet?.(); return; }
    try {
      await claim(epoch);
      setFlash({ type: 'success', msg: `💰 Claimed #${epoch}` });
      setRoundsOpen(false);
    } catch (e) {
      setFlash({ type: 'error', msg: e.message || 'Claim failed' });
    }
  };

  if (geo.ready && geo.blocked && !isAdminWallet) {
    return <BlockScreen title="Not Available" message="Flipsy is not available in your region." sub="This may change in the future." />;
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
        <div className="fp-claim-banner" onClick={() => setRoundsOpen(true)}>
          <span className="fp-claim-banner-icon">💰</span>
          <span>{claimableRounds.length} round{claimableRounds.length > 1 ? 's' : ''} ready to collect</span>
        </div>
      )}

      {flash && <div className={`fp-flash-top fp-flash ${flash.type}`}>{flash.msg}</div>}

      <header className="fp-header">
        <div className="fp-brand">
          <div className="fp-mascot">F</div>
          <div>
            <div className="fp-title">FLIPSY</div>
            <div className="fp-subtitle">Solana Sentiment</div>
          </div>
        </div>
        <div className="fp-actions">
          <button onClick={() => setRoundsOpen(true)} style={{
            background: hasClaim ? 'rgba(255,214,107,0.15)' : 'rgba(153,69,255,0.12)',
            border: `1px solid ${hasClaim ? 'rgba(255,214,107,0.4)' : 'rgba(153,69,255,0.3)'}`,
            borderRadius: 999, padding: '6px 14px',
            color: hasClaim ? '#FFD66B' : '#9945FF',
            fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 11,
            cursor: 'pointer', letterSpacing: '0.08em',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {hasClaim ? '💰' : '📋'} Rounds
            {hasClaim && (
              <span style={{ background: '#FFD66B', color: '#1A0F00', borderRadius: '50%', width: 16, height: 16, fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {claimableRounds.length}
              </span>
            )}
          </button>

          {wallet.connected ? (
            <div className="fp-balance">
              <span className="fp-balance-label">Bal</span>
              <span className="fp-balance-val">${balance.toFixed(2)}</span>
            </div>
          ) : (
            <div className="fp-balance" style={{ cursor: 'pointer', color: '#14F195', fontSize: 11, fontWeight: 800 }} onClick={() => onConnectWallet?.()}>
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
            <div style={{ textAlign: 'center', padding: 60, color: '#9892B5', fontSize: 13 }}>Loading rounds…</div>
          </div>
        )}
        {[...recentRounds].reverse().map(r => (
          <RoundCard key={`prev-${r.epoch}`} round={r} state="previous"
            userBets={getBetsForEpoch(r.epoch)} livePrice={livePrice}
            onSideTap={handleSideTap} claim={handleClaim} claimable={isClaimable(r)} />
        ))}
        {liveRound && (
          <RoundCard round={liveRound} state="live"
            userBets={getBetsForEpoch(liveRound.epoch)} livePrice={livePrice}
            onSideTap={handleSideTap} />
        )}
        {upcomingRounds[0] && (
          <RoundCard key={`next-${upcomingRounds[0].epoch}`} round={upcomingRounds[0]} state="next"
            userBets={getBetsForEpoch(upcomingRounds[0].epoch)} livePrice={livePrice}
            onSideTap={handleSideTap} />
        )}
        {upcomingRounds.slice(1).map(r => (
          <RoundCard key={`later-${r.epoch}`} round={r} state="later"
            userBets={getBetsForEpoch(r.epoch)} livePrice={livePrice}
            onSideTap={handleSideTap} />
        ))}
      </div>

      <div className="fp-footer">
        Powered by Solana · Non-custodial · 25% fee on wins only · No other fees
      </div>

      <RoundsPopup
        open={roundsOpen}
        onClose={() => setRoundsOpen(false)}
        recentRounds={recentRounds}
        userBets={userBets}
        onClaim={handleClaim}
      />

      {betModal && (
        <BetModal
          open={!!betModal} side={betModal.side} epoch={betModal.epoch}
          headsPayout={betModal.headsPayout} tailsPayout={betModal.tailsPayout}
          balance={balance} livePrice={livePrice}
          onClose={() => setBetModal(null)} onTrade={handleTrade}
        />
      )}
    </div>
  );
}
