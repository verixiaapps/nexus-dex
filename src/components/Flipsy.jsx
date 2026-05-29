import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useFlipsy } from '../hooks/useFlipsy';
import './Flipsy.css';

// === Solana brand mark ===
function SolMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 397 311" fill="none">
      <defs>
        <linearGradient id="solg" x1="360" y1="-15" x2="142" y2="402" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00FFA3" /><stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#solg)" />
      <path d="M64.6 3.8C67.1 1.3 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#solg)" />
      <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.6z" fill="url(#solg)" />
    </svg>
  );
}

// === Sparkline ===
function Sparkline({ points, lockPrice }) {
  if (!points || points.length < 2) return null;
  const max = Math.max(...points, lockPrice);
  const min = Math.min(...points, lockPrice);
  const range = max - min || 0.01;
  const w = 320, h = 56;
  const path = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const lockY = h - ((lockPrice - min) / range) * h;
  const lastUp = points[points.length - 1] >= lockPrice;
  const color = lastUp ? '#5EFFCC' : '#FF7FB8';
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={lockY} x2={w} y2={lockY} stroke="#A875FF" strokeDasharray="3 4" strokeWidth="1" opacity="0.6" />
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill="url(#sparkfill)" />
      <path d={path} stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - ((points[points.length - 1] - min) / range) * h} r="5" fill={color} stroke="#FFF" strokeWidth="1.5" />
    </svg>
  );
}

// === Upcoming round card ===
function UpcomingCard({ data, userBet, connected, placeBet, betAmount, index }) {
  const { epoch, headsPool, tailsPool, lockTime } = data;
  const total = headsPool + tailsPool;
  const headsPayout = headsPool > 0 ? (total / headsPool) * 0.85 : 2.0;
  const tailsPayout = tailsPool > 0 ? (total / tailsPool) * 0.85 : 2.0;
  const now = Math.floor(Date.now() / 1000);
  const startsIn = Math.max(0, lockTime - now);
  const mins = Math.floor(startsIn / 60);
  const secs = startsIn % 60;

  const handle = async (side) => {
    try { await placeBet(epoch, side, betAmount); } catch (e) { console.error(e); }
  };

  return (
    <div className="flipsy-upcoming-card" style={{ animationDelay: `${index * 80}ms` }}>
      <div className="flipsy-upcoming-head">
        <div className="flipsy-next-badge">⚡ Next</div>
        <span className="flipsy-epoch">#{epoch}</span>
      </div>

      <button
        className={`flipsy-bet-btn flipsy-bet-up ${userBet?.side === 'heads' ? 'active' : ''}`}
        onClick={() => handle('heads')}
        disabled={!connected || userBet?.side === 'tails'}
      >
        <span className="flipsy-bet-btn-left">↑ UP</span>
        <span>{headsPayout.toFixed(2)}×</span>
      </button>

      <div className="flipsy-card-middle">
        <div className="flipsy-card-middle-row">
          <span className="flipsy-card-middle-label">Prize Pool</span>
          <span className="flipsy-card-middle-value">${total.toFixed(2)}</span>
        </div>
        <div className="flipsy-card-middle-row">
          <span className="flipsy-card-middle-label">⏱ Starts in</span>
          <span style={{ color: '#C49FFF', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {mins}:{String(secs).padStart(2, '0')}
          </span>
        </div>
      </div>

      <button
        className={`flipsy-bet-btn flipsy-bet-down ${userBet?.side === 'tails' ? 'active' : ''}`}
        onClick={() => handle('tails')}
        disabled={!connected || userBet?.side === 'heads'}
      >
        <span className="flipsy-bet-btn-left">↓ DOWN</span>
        <span>{tailsPayout.toFixed(2)}×</span>
      </button>

      {userBet && (
        <div className={`flipsy-entered-chip ${userBet.side}`}>
          <span>✓ Entered</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>${userBet.amount.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

export default function Flipsy() {
  const wallet = useWallet();
  const { liveRound, upcomingRounds, recentRounds, userBets, balance, placeBet, claim, loading } = useFlipsy(wallet);

  const [betAmount, setBetAmount] = useState(1);
  const [pricePoints, setPricePoints] = useState([]);
  const [flash, setFlash] = useState(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  // Tick now every second for countdown
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);

  // Track live price for sparkline
  useEffect(() => {
    if (liveRound?.lockPrice) {
      setPricePoints((pts) => [...pts.slice(-40), liveRound.lockPrice]);
    }
  }, [liveRound?.lockPrice]);

  useEffect(() => {
    if (flash) { const t = setTimeout(() => setFlash(null), 3500); return () => clearTimeout(t); }
  }, [flash]);

  const handlePlaceBet = async (epoch, side, amount) => {
    if (!wallet.connected) { setFlash({ type: 'error', msg: 'Connect wallet first' }); return; }
    if (amount < 0.1 || amount > 5) { setFlash({ type: 'error', msg: '$0.10–$5.00' }); return; }
    if (balance < amount) { setFlash({ type: 'error', msg: 'Insufficient USDC' }); return; }
    try {
      await placeBet(epoch, side, amount);
      setFlash({ type: 'success', msg: `Entered #${epoch} ${side === 'heads' ? '↑ UP' : '↓ DOWN'} $${amount.toFixed(2)}` });
    } catch (e) {
      console.error(e);
      setFlash({ type: 'error', msg: e.message || 'Transaction failed' });
    }
  };

  // Compute display values
  const livePrice = liveRound?.lockPrice || 0; // TODO: hook up live Pyth price feed for sparkline
  const lockPrice = liveRound?.lockPrice || 0;
  const priceDiff = livePrice - lockPrice;
  const isUp = priceDiff >= 0;
  const timeLeft = liveRound ? Math.max(0, liveRound.closeTime - now) : 0;
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const totalPool = (liveRound?.headsPool || 0) + (liveRound?.tailsPool || 0);
  const headsPayout = liveRound && liveRound.headsPool > 0 ? (totalPool / liveRound.headsPool) * 0.85 : 0;
  const tailsPayout = liveRound && liveRound.tailsPool > 0 ? (totalPool / liveRound.tailsPool) * 0.85 : 0;

  return (
    <div className="flipsy-page">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Ambient blobs */}
      <div className="flipsy-blob flipsy-blob-1" />
      <div className="flipsy-blob flipsy-blob-2" />
      <div className="flipsy-blob flipsy-blob-3" />

      {/* Header */}
      <header className="flipsy-header">
        <div className="flipsy-brand">
          <div className="flipsy-mascot-wrap">
            <div className="flipsy-mascot">
              {/* Mascot will be added later — placeholder uses gradient */}
              <div style={{
                width: '100%', height: '100%',
                background: 'linear-gradient(135deg, #C49FFF 0%, #FF7FB8 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, fontWeight: 900, color: '#FFF',
              }}>F</div>
            </div>
            <span className="flipsy-sparkle" style={{ top: -4, right: -4, fontSize: 12, color: '#FFD66B', animationDelay: '0s' }}>✦</span>
            <span className="flipsy-sparkle" style={{ bottom: 4, left: -8, fontSize: 10, color: '#5EFFCC', animationDelay: '0.7s' }}>✦</span>
            <span className="flipsy-sparkle" style={{ top: 30, right: -10, fontSize: 8, color: '#FF7FB8', animationDelay: '1.4s' }}>✦</span>
          </div>
          <div>
            <div className="flipsy-title">FLIPSY</div>
            <div className="flipsy-subtitle">
              <SolMark size={14} /> Solana Predictions
            </div>
          </div>
        </div>
        <div className="flipsy-actions">
          {wallet.connected && (
            <div className="flipsy-balance">
              <span className="flipsy-balance-label">Balance</span>
              <span className="flipsy-balance-value">${balance.toFixed(2)}</span>
            </div>
          )}
          <WalletMultiButton className="flipsy-connect-btn" />
        </div>
      </header>

      <main className="flipsy-main">
        {/* Live round hero */}
        {liveRound && (
          <div className="flipsy-hero">
            <div className="flipsy-hero-top">
              <div className="flipsy-live-badge">
                <div className="flipsy-pulse-dot" />
                🔒 LIVE · Round #{liveRound.epoch}
              </div>
              <div className="flipsy-timer-pill">
                ⏱ {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
              </div>
            </div>

            <div className="flipsy-price-row">
              <div>
                <div className="flipsy-price-label">✨ SOL/USD · Live via Pyth</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                  <span className={`flipsy-price-big ${isUp ? 'up' : 'down'}`}>
                    ${livePrice.toFixed(4)}
                  </span>
                  <span className={`flipsy-delta-pill ${isUp ? 'up' : 'down'}`}>
                    {isUp ? '↑' : '↓'} ${Math.abs(priceDiff).toFixed(4)}
                  </span>
                </div>
                <div className="flipsy-locked-row">
                  🔒 Locked at <span className="flipsy-locked-value">${lockPrice.toFixed(4)}</span>
                </div>
              </div>
              <div className="flipsy-chart-card">
                <div className="flipsy-chart-label">Last 40s</div>
                <Sparkline points={pricePoints} lockPrice={lockPrice} />
              </div>
            </div>

            <div className="flipsy-pool-split">
              <div className="flipsy-pool-row">
                <div className="flipsy-pool-side">
                  <span className="flipsy-pool-chip up">↑ UP {headsPayout.toFixed(2)}×</span>
                  <span className="flipsy-pool-amount">${liveRound.headsPool.toFixed(2)}</span>
                </div>
                <div className="flipsy-pool-side">
                  <span className="flipsy-pool-amount">${liveRound.tailsPool.toFixed(2)}</span>
                  <span className="flipsy-pool-chip down">{tailsPayout.toFixed(2)}× DOWN ↓</span>
                </div>
              </div>
              <div className="flipsy-pool-bar">
                <div className="flipsy-pool-bar-up" style={{ width: totalPool > 0 ? `${(liveRound.headsPool / totalPool) * 100}%` : '50%' }} />
                <div className="flipsy-pool-bar-down" style={{ width: totalPool > 0 ? `${(liveRound.tailsPool / totalPool) * 100}%` : '50%' }} />
              </div>
              <div className="flipsy-pool-total">
                Total prize pool · <span className="flipsy-pool-total-value">${totalPool.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Upcoming */}
        <div className="flipsy-section-head">
          <h3 className="flipsy-section-title">Upcoming</h3>
          <span className="flipsy-section-sub">Enter anytime · max $5/round</span>
        </div>
        <div className="flipsy-upcoming-grid">
          {upcomingRounds.map((r, idx) => (
            <UpcomingCard
              key={r.epoch}
              data={r}
              userBet={userBets[r.epoch]}
              connected={wallet.connected}
              placeBet={handlePlaceBet}
              betAmount={betAmount}
              index={idx}
            />
          ))}
        </div>

        {/* Bottom row */}
        <div className="flipsy-bottom-grid">
          <div className="flipsy-bottom-card">
            <div className="flipsy-bet-amount-head">
              <h3 className="flipsy-bet-amount-title">Bet Amount</h3>
              <span className="flipsy-fee-tag">5% fee</span>
            </div>
            <div className="flipsy-amount-box">
              <div className="flipsy-amount-row">
                <button className="flipsy-amount-step" onClick={() => setBetAmount(a => +Math.max(0.1, a - 0.5).toFixed(2))}>−</button>
                <input
                  type="number" min={0.1} max={5} step={0.1}
                  value={betAmount}
                  onChange={(e) => setBetAmount(Math.max(0.1, Math.min(5, +(+e.target.value || 0.1).toFixed(2))))}
                  className="flipsy-amount-input"
                />
                <button className="flipsy-amount-step" onClick={() => setBetAmount(a => +Math.min(5, a + 0.5).toFixed(2))}>+</button>
              </div>
              <div className="flipsy-quick-row">
                {[0.5, 1, 2.5, 5].map(v => (
                  <button key={v} className={`flipsy-quick-btn ${betAmount === v ? 'active' : ''}`} onClick={() => setBetAmount(v)}>
                    ${v}
                  </button>
                ))}
              </div>
            </div>
            <div className="flipsy-fee-row">
              <div><span>Deposit fee (5%)</span><span className="fee-deduct">−${(betAmount * 0.05).toFixed(2)}</span></div>
              <div><span className="fee-net-label">In pool</span><span className="fee-net">${(betAmount * 0.95).toFixed(2)}</span></div>
            </div>
            {flash && <div className={`flipsy-flash ${flash.type}`}>{flash.msg}</div>}
          </div>

          <div className="flipsy-bottom-card">
            <div className="flipsy-history-head">
              📜 <h3 className="flipsy-bet-amount-title">Recent</h3>
            </div>
            <div className="flipsy-history-list">
              {recentRounds.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: '#8B7BB8', fontSize: 13 }}>
                  No completed rounds yet
                </div>
              )}
              {recentRounds.map(h => (
                <div key={h.epoch} className="flipsy-history-item">
                  <div className="flipsy-history-epoch">#{h.epoch}</div>
                  <div className="flipsy-history-prices">
                    {h.lockPrice.toFixed(2)} → {h.closePrice.toFixed(2)}
                  </div>
                  <div className={`flipsy-history-result ${h.outcome === 'heads' ? 'up' : h.outcome === 'tails' ? 'down' : 'tie'}`}>
                    {h.outcome === 'heads' ? '↑ UP' : h.outcome === 'tails' ? '↓ DOWN' : '= TIE'}
                  </div>
                </div>
              ))}
            </div>

            {/* Claim buttons for resolved rounds where user has unclaimed bets */}
            {Object.entries(userBets).map(([epoch, bet]) => {
              const round = recentRounds.find(r => r.epoch === parseInt(epoch));
              if (!round || bet.claimed) return null;
              const won = round.outcome === bet.side;
              const tie = round.outcome === 'tie';
              if (!won && !tie) return null;
              return (
                <button
                  key={epoch}
                  onClick={async () => {
                    try { await claim(parseInt(epoch)); setFlash({ type: 'success', msg: `Claimed #${epoch}` }); }
                    catch (e) { setFlash({ type: 'error', msg: e.message || 'Claim failed' }); }
                  }}
                  className="flipsy-bet-btn flipsy-bet-up"
                  style={{ marginTop: 10 }}
                >
                  💰 Claim #{epoch}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flipsy-footer">
          Non-custodial · Funds in program PDA · Resolved by Pyth · Max $5 · 5% deposit · 15% on winnings
        </div>
      </main>
    </div>
  );
}
