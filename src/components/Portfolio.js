import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function fmt(n, d) {
  d = d || 2;
  if (n == null) return '--';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

function fmtAmt(n, decimals) {
  if (!n) return '0';
  var val = n / Math.pow(10, decimals || 9);
  if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(6);
}

const TOKEN_MAP = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', name: 'Solana', decimals: 9, cgId: 'solana' },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin', decimals: 6, cgId: 'usd-coin' },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'Tether', decimals: 6, cgId: 'tether' },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { symbol: 'JUP', name: 'Jupiter', decimals: 6, cgId: 'jupiter-exchange-solana' },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', name: 'Bonk', decimals: 5, cgId: 'bonk' },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', name: 'Marinade SOL', decimals: 9, cgId: 'msol' },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { symbol: 'RAY', name: 'Raydium', decimals: 6, cgId: 'raydium' },
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': { symbol: 'PYTH', name: 'Pyth', decimals: 6, cgId: 'pyth-network' },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'ETH', name: 'Ethereum', decimals: 8, cgId: 'ethereum' },
};

export default function Portfolio({ coins }) {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const [balances, setBalances] = useState([]);
  const [solBalance, setSolBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [totalValue, setTotalValue] = useState(0);

  var getPrice = function(cgId) {
    var coin = coins.find(function(c) { return c.id === cgId; });
    return coin ? coin.current_price : 0;
  };

  var fetchBalances = async function() {
    if (!publicKey || !connection) return;
    setLoading(true);
    try {
      var solLamports = await connection.getBalance(publicKey);
      var solAmt = solLamports / 1e9;
      setSolBalance(solAmt);

      var tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        publicKey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      var holdings = [];
      tokenAccounts.value.forEach(function(account) {
        var info = account.account.data.parsed.info;
        var mint = info.mint;
        var amount = info.tokenAmount.amount;
        var decimals = info.tokenAmount.decimals;
        var uiAmount = info.tokenAmount.uiAmount;

        if (uiAmount && uiAmount > 0) {
          var tokenInfo = TOKEN_MAP[mint];
          holdings.push({
            mint: mint,
            symbol: tokenInfo ? tokenInfo.symbol : mint.slice(0, 6) + '...',
            name: tokenInfo ? tokenInfo.name : 'Unknown Token',
            decimals: decimals,
            amount: amount,
            uiAmount: uiAmount,
            cgId: tokenInfo ? tokenInfo.cgId : null,
          });
        }
      });

      setBalances(holdings);

      var total = solAmt * getPrice('solana');
      holdings.forEach(function(h) {
        if (h.cgId) {
          total += h.uiAmount * getPrice(h.cgId);
        }
      });
      setTotalValue(total);

    } catch (e) {
      console.error('Balance fetch error:', e);
    }
    setLoading(false);
  };

  useEffect(function() {
    if (connected && publicKey) {
      fetchBalances();
      var interval = setInterval(fetchBalances, 30000);
      return function() { clearInterval(interval); };
    }
  }, [connected, publicKey, coins]);

  var solPrice = getPrice('solana');
  var solValue = solBalance * solPrice;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Real-time Solana wallet balances</p>
      </div>

      {!connected ? (
        <div style={{ textAlign: 'center', padding: '80px 40px', background: C.card, border: '1px solid ' + C.border, borderRadius: 22 }}>
          <div style={{ fontSize: 54, marginBottom: 20 }}>🔐</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Your Wallet</h2>
          <p style={{ color: C.muted, fontSize: 14, maxWidth: 360, margin: '0 auto 28px', lineHeight: 1.6 }}>
            Link Phantom or Solflare to view your real-time portfolio and token balances.
          </p>
          <WalletMultiButton />
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
            {[
              ['Total Value', fmt(totalValue), C.accent],
              ['SOL Balance', solBalance.toFixed(4) + ' SOL', C.green],
              ['SOL Value', fmt(solValue), C.text],
              ['Tokens', (balances.length + 1).toString(), C.muted],
            ].map(function(item) {
              return (
                <div key={item[0]} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 18 }}>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: .8 }}>{item[0]}</div>
                  <div style={{ fontSize: 18, color: item[2], fontWeight: 600 }}>{item[1]}</div>
                </div>
              );
            })}
          </div>

          <div style={{ background: C.card, border: '1px solid rgba(0,255,163,.15)', borderRadius: 14, padding: 16, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(0,255,163,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>👛</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Connected Wallet</div>
              <div style={{ fontSize: 12, color: C.green, fontFamily: 'JetBrains Mono, monospace', fontWeight: 500 }}>
                {publicKey ? publicKey.toString() : ''}
              </div>
            </div>
            <button onClick={fetchBalances} style={{
              background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)',
              borderRadius: 8, padding: '6px 12px', color: C.accent,
              fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600,
            }}>Refresh</button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Loading balances...</div>
          ) : (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,229,255,.06)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>
                <div>TOKEN</div>
                <div style={{ textAlign: 'right' }}>BALANCE</div>
                <div style={{ textAlign: 'right' }}>PRICE</div>
                <div style={{ textAlign: 'right' }}>VALUE</div>
              </div>

              <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#9945ff' }}>S</div>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>SOL</div>
                    <div style={{ color: C.muted, fontSize: 10 }}>Solana</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', color: C.text, fontSize: 13 }}>{solBalance.toFixed(4)}</div>
                <div style={{ textAlign: 'right', color: C.text, fontSize: 13 }}>{fmt(solPrice)}</div>
                <div style={{ textAlign: 'right', color: C.green, fontSize: 13, fontWeight: 600 }}>{fmt(solValue)}</div>
              </div>

              {balances.map(function(token) {
                var price = token.cgId ? getPrice(token.cgId) : 0;
                var value = token.uiAmount * price;
                return (
                  <div key={token.mint} style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)' }}
                    onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.02)'; }}
                    onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent }}>
                        {token.symbol.charAt(0)}
                      </div>
                      <div>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{token.symbol}</div>
                        <div style={{ color: C.muted, fontSize: 10 }}>{token.name}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', color: C.text, fontSize: 13 }}>{token.uiAmount.toFixed(4)}</div>
                    <div style={{ textAlign: 'right', color: C.text, fontSize: 13 }}>{price > 0 ? fmt(price) : '--'}</div>
                    <div style={{ textAlign: 'right', color: value > 0 ? C.green : C.muted, fontSize: 13, fontWeight: value > 0 ? 600 : 400 }}>
                      {value > 0 ? fmt(value) : '--'}
                    </div>
                  </div>
                );
              })}

              {balances.length === 0 && !loading && (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                  No SPL token balances found in this wallet.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
