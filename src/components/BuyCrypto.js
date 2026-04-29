  <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, overflow: 'hidden' }}>
    <div style={{ padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Buy crypto with Transak</div>
      <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
        Purchase SOL, BTC, ETH and 100+ cryptocurrencies with your card or bank transfer. Powered by Transak -- trusted by 5M+ users worldwide.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {['Visa', 'Mastercard', 'Apple Pay', 'Google Pay', 'Bank Transfer'].map(function(method) {
          return <div key={method} style={{ background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: C.accent, fontWeight: 600 }}>{method}</div>;
        })}
      </div>

      {walletAddress && (
        <div style={{ background: 'rgba(0,255,163,.05)', border: '1px solid rgba(0,255,163,.15)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, fontWeight: 700 }}>YOUR WALLET -- AUTO FILLED</div>
          <div style={{ fontSize: 11, color: '#00ffa3', fontFamily: 'monospace', wordBreak: 'break-all' }}>{walletAddress}</div>
        </div>
      )}

      <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block', width: '100%', padding: 16, background: 'linear-gradient(135deg,#00e5ff,#0055ff)', borderRadius: 12, border: 'none', cursor: 'pointer', color: '#03060f', fontWeight: 800, fontSize: 16, textAlign: 'center', textDecoration: 'none', fontFamily: 'Syne, sans-serif' }}>
        Buy Crypto with Transak
      </a>

      <p style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 12 }}>Opens in new tab - Powered by Transak - KYC handled by Transak</p>
    </div>
  </div>
</div>
