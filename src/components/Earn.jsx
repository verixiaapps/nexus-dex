import React from 'react';

const C = {
  ink: '#e6efff', inkStr: '#f5fafe',
  hl: '#97fce4',
};
 
export default function Earn() {
  return (
    <div style={{
      maxWidth: 680, margin: '0 auto', width: '100%',
      padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)',
      color: C.ink, minHeight: '80vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% 10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 30%,rgba(168,127,255,.08),transparent 50%)',
      fontFamily: "'Clash Display','Syne',system-ui,sans-serif",
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&display=swap');@import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap');`}</style>

      <div style={{
        width: '100%', maxWidth: 480,
        padding: '54px 28px 50px', borderRadius: 28,
        background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
        border: '1px solid rgba(151,252,228,.18)',
        boxShadow: '0 24px 80px rgba(0,0,0,.55), 0 0 60px rgba(151,252,228,.08)',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 100% 60% at 50% -10%,rgba(151,252,228,.10),transparent 70%)', pointerEvents: 'none' }}/>
        <div style={{ position: 'relative' }}>
          <h1 style={{
            fontSize: 38, lineHeight: 1.0, fontWeight: 600,
            margin: 0, letterSpacing: '-.045em',
            background: 'linear-gradient(135deg,' + C.inkStr + ' 0%,' + C.hl + ' 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            Coming soon
          </h1>
        </div>
      </div>
    </div>
  );
}
