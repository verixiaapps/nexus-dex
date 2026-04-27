import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Connection, PublicKey } from '@solana/web3.js';
 
const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const RPC = process.env.REACT_APP_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

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
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE': { symbol: 'ORCA', name: 'Orca', decimals: 6, cgId: 'orca' },
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

export default function Portfolio({ coins, onSend }) {
  const { address, isConnected } = useAccount();
  const [balances, setBalances] = useState([]);
  const [solBalance, setSolBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [totalValue, setTotalValue] = useState(0);
  const [activeTab, setActiveTab] = useState('holdings');

  var getPrice = function(cgId) {
    var coin = coins.find(function(c) { return c.id === cgId; });
    return coin ? coin.current_price : 0;
  };

  var fetchBalances = async function() {
    if (!address) return;
    setLoading(true);
    try {
      var connection = new Connection(RPC);
      var pubkey = new PublicKey(address);

      var solLamports = await connection.getBalance(pubkey);
      var solAmt = solLamports / 1e9;
      setSolBalance(solAmt);

      var tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        pubkey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      var holdings = [];
      tokenAccounts.value.forEach(function(account) {
        var info = account.account.data.parsed.info;
        var mint = info.mint;
        var uiAmount = info.tokenAmount.uiAmount;
        if (uiAmount && uiAmount > 0.000001) {
          var tokenInfo = TOKEN_MAP[mint];
          holdings.push({
            mint: mint,
            symbol: tokenInfo ? tokenInfo.symbol : mint.slice(0, 4) + '...',
            name: tokenInfo ? tokenInfo.name : 'Unknown Token',
            decimals: info.tokenAmount.decimals,
            uiAmount: uiAmount,
            cgId: tokenInfo ? tokenInfo.cgId : null,
          });
        }
      });

      holdings.sort(function(a, b) {
        var aVal = a.uiAmount * (a.cgId ? getPrice(a.cgId) : 0);
        var bVal = b.uiAmount * (b.cgId ? getPrice(b.cgId) : 0);
        return bVal - aVal;
      });

      setBalances(holdings);

      var solPrice = getPrice('solana');
      var total = solAmt * solPrice;
      holdings.forEach(function(h) {
        if (h.cgId) total += h.uiAmount * getPrice(h.cgId);
      });
      setTotalValue(total);

    } catch (e) {
      console.error('Balance fetch error:', e);
    }
    setLoading(false);
  };

  useEffect(function() {
    if (isConnected && address) {
      fetchBalances();
      var interval = setInterval(fetchBalances, 30000);
      return function() { clearInterval(interval); };
    }
  }, [isConnected, address, coins.length]);

  var solPrice = getPrice('solana');
  var solValue = solBalance * solPrice;

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Track your wallet balances in real time</p>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👛</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Your Wallet</h2>
          <p style={{ color: C.muted, fontSize: 13, maxWidth: 300, margin: '0 auto 24px', lineHeight: 1.6 }}>
            Connect via WalletConnect to view your real-time portfolio and token balances.
          </p>
          <ConnectButton showBalance={false} chainStatus="none" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Real-time balances · Auto-refreshes every 30s</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchBalances} style={{
            background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)',
            borderRadius: 8, padding: '7px 14px', color: C.accent,
            fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600,
          }}>Refresh</button>
          {onSend && (
            <button onClick={onSend} style={{
              background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
              border: 'none', borderRadius: 8, padding: '7px 14px',
              color: '#03060f', fontSize: 12, cursor: 'pointer',
              fontFamily: 'Syne, sans-serif', fontWeight: 700,
            }}>Send Tokens</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          ['Total Value', fmt(totalValue), C.accent],
          ['SOL Balance', solBalance.toFixed(4) + ' SOL', C.green],
          ['SOL Value', fmt(solValue), C.text],
          ['Assets', (balances.length + 1) + ' tokens', C.muted],
        ].map(function(item) {
          return (
            <div key={item[0]} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, fontWeight: 700, letterSpacing: .8 }}>{item[0]}</div>
              <div style={{ fontSize: 16, color: item[2], fontWeight: 600 }}>{item[1]}</div>
            </div>
          );
        })}
      </div>

      <div style={{ background: C.card, border: '1px solid rgba(0,255,163,.15)', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 24, flexShrink: 0 }}>👛</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700 }}>CONNECTED WALLET</div>
          <div style={{ fontSize: 11, color: C.green, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {address}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {[['holdings', 'Holdings'], ['activity', 'Activity']].map(function(item) {
          return (
            <button key={item[0]} onClick={function() { setActiveTab(item[0]); }} style={{
              padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              fontFamily: 'Syne, sans-serif', cursor: 'pointer',
              background: activeTab === item[0] ? 'rgba(0,229,255,.09)' : 'transparent',
              border: '1px solid ' + (activeTab === item[0] ? 'rgba(0,229,255,.25)' : C.border),
              color: activeTab === item[0] ? C.accent : C.muted,
            }}>{item[1]}</button>
          );
        })}
      </div>

      {activeTab === 'holdings' && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
            <div>TOKEN</div>
            <div style={{ textAlign: 'right' }}>BALANCE</div>
            <div style={{ textAlign: 'right' }}>PRICE</div>
            <div style={{ textAlign: 'right' }}>VALUE</div>
          </div>

          <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#9945ff', flexShrink: 0 }}>S</div>
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>SOL</div>
                <div style={{ color: C.muted, fontSize: 10 }}>Solana</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{solBalance.toFixed(4)}</div>
            <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmt(solPrice)}</div>
            <div style={{ textAlign: 'right', color: C.green, fontSize: 13, fontWeight: 600 }}>{fmt(solValue)}</div>
          </div>

          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading balances...</div>
          ) : balances.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>No other token balances found</div>
          ) : (
            balances.map(function(token) {
              var price = token.cgId ? getPrice(token.cgId) : 0;
              var value = token.uiAmount * price;
              return (
                <div key={token.mint} style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', transition: 'background .15s' }}
                  onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.02)'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
                      {token.symbol.charAt(0)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.symbol}</div>
                      <div style={{ color: C.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>
                    {token.uiAmount >= 1000 ? token.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : token.uiAmount.toFixed(4)}
                  </div>
                  <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{price > 0 ? fmt(price) : '--'}</div>
                  <div style={{ textAlign: 'right', color: value > 0.01 ? C.green : C.muted, fontSize: 12, fontWeight: value > 0.01 ? 600 : 400 }}>
                    {value > 0.01 ? fmt(value) : '--'}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Transaction History</div>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, maxWidth: 280, margin: '0 auto 20px' }}>
            View your full transaction history on Solscan.
          </p>
          {address && (
            <a href={'https://solscan.io/account/' + address} target="_blank" rel="noreferrer"
              style={{
                display: 'inline-block', padding: '10px 24px', borderRadius: 10,
                background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)',
                color: C.accent, fontSize: 13, fontWeight: 600, textDecoration: 'none',
              }}>
              View on Solscan ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
