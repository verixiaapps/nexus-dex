import React, { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useAccount } from 'wagmi';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};
 
function fmt(n, d = 2) {
  if (n == null) return '-';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

export default function Portfolio({ coins, jupiterTokens, onSend, onConnectWallet, isConnected, isSolanaConnected, walletAddress, refreshKey, onSelectToken }) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [balances, setBalances] = useState([]);
  const [solBalance, setSolBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [totalValue, setTotalValue] = useState(0);
  const [activeTab, setActiveTab] = useState('holdings');
  const [error, setError] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [lookupAddress, setLookupAddress] = useState('');

  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const [evmTokens, setEvmTokens] = useState([]);
  const [evmLoading, setEvmLoading] = useState(false);

  useEffect(() => {
    if (!evmAddress) { setEvmTokens([]); return; }
    const MORALIS_KEY = process.env.REACT_APP_MORALIS_KEY || '';
    if (!MORALIS_KEY) return;
    setEvmLoading(true);
    const EVM_CHAINS = ['0x1', '0x89', '0xa4b1', '0x2105', '0x38', '0xa86a', '0xa'];
    const CHAIN_NAMES = { '0x1': 'Ethereum', '0x89': 'Polygon', '0xa4b1': 'Arbitrum', '0x2105': 'Base', '0x38': 'BSC', '0xa86a': 'Avalanche', '0xa': 'Optimism' };
    Promise.all(EVM_CHAINS.map(chainId =>
      fetch('https://deep-index.moralis.io/api/v2.2/wallets/' + evmAddress + '/tokens?chain=' + chainId + '&exclude_spam=true&exclude_unverified_contracts=false', {
        headers: { 'X-API-Key': MORALIS_KEY, 'Accept': 'application/json' },
      })
        .then(r => r.ok ? r.json() : { result: [] })
        .then(data => (data.result || []).map(t => ({
          chain: chainId,
          chainName: CHAIN_NAMES[chainId] || chainId,
          address: t.token_address,
          symbol: t.symbol || '???',
          name: t.name || 'Unknown',
          logo: t.logo || t.thumbnail || null,
          decimals: parseInt(t.decimals || 18),
          balance: parseFloat(t.balance_formatted || (t.balance / Math.pow(10, parseInt(t.decimals || 18)))),
          price: parseFloat(t.usd_price || 0),
          value: parseFloat(t.usd_value || 0),
          pct24h: parseFloat(t.usd_price_24hr_percent_change || 0),
          isNative: t.native_token || false,
          isSpam: t.possible_spam || false,
        })).filter(t => !t.isSpam && t.balance > 0))
        .catch(() => [])
    )).then(results => {
      const all = results.flat().sort((a, b) => b.value - a.value);
      setEvmTokens(all);
      setEvmLoading(false);
    });
  }, [evmAddress, refreshKey]);

  const getPrice = useCallback(symbol => {
    if (!symbol || !coins || !coins.length) return 0;
    const coin = coins.find(c => c.symbol && c.symbol.toLowerCase() === symbol.toLowerCase());
    return coin ? coin.current_price : 0;
  }, [coins]);

  const getTokenInfo = useCallback(mint => {
    if (!jupiterTokens || !jupiterTokens.length) return null;
    return jupiterTokens.find(t => t.mint === mint);
  }, [jupiterTokens]);

  const fetchBalances = useCallback(async () => {
    const addrToUse = publicKey ? publicKey.toString() : lookupAddress;
    if (!addrToUse || !connection) return;
    setLoading(true); setError('');
    try {
      const lookupPubkey = new PublicKey(addrToUse);
      const solLamports = await connection.getBalance(lookupPubkey);
      const solAmt = solLamports / 1e9;
      setSolBalance(solAmt);

      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(lookupPubkey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      });
      const holdings = [];
      tokenAccounts.value.forEach(account => {
        try {
          const info = account.account.data.parsed.info;
          const mint = info.mint;
          const uiAmount = info.tokenAmount.uiAmount;
          if (uiAmount && uiAmount > 0.000001) {
            const tokenInfo = getTokenInfo(mint);
            holdings.push({
              mint, symbol: tokenInfo ? tokenInfo.symbol : mint.slice(0, 4) + '...' + mint.slice(-4),
              name: tokenInfo ? tokenInfo.name : 'Unknown Token',
              logoURI: tokenInfo ? tokenInfo.logoURI : null,
              decimals: info.tokenAmount.decimals, uiAmount,
            });
          }
        } catch (e) {}
      });
      holdings.sort((a, b) => (b.uiAmount * getPrice(b.symbol)) - (a.uiAmount * getPrice(a.symbol)));
      setBalances(holdings);

      const solPrice = getPrice('SOL');
      let total = solAmt * solPrice;
      holdings.forEach(h => { total += h.uiAmount * getPrice(h.symbol); });
      setTotalValue(total);
    } catch (e) {
      console.error('Balance fetch error:', e);
      setError('Failed to load balances: ' + (e.message || 'Check your connection'));
    }
    setLoading(false);
  }, [publicKey, connection, lookupAddress, getPrice, getTokenInfo]);

  const effectiveAddress = publicKey ? publicKey.toString() : lookupAddress;

  useEffect(() => {
    if (effectiveAddress) {
      fetchBalances();
      const interval = setInterval(fetchBalances, 30000);
      return () => clearInterval(interval);
    }
  }, [effectiveAddress, fetchBalances]);

  useEffect(() => {
    if (effectiveAddress && coins.length > 0) fetchBalances();
  }, [coins.length]);

  useEffect(() => {
    if (refreshKey > 0 && (publicKey || lookupAddress)) fetchBalances();
  }, [refreshKey]);

  const solPrice = getPrice('SOL');
  const solValue = solBalance * solPrice;
  const rootStyle = { width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' };

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', ...rootStyle }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Track your wallet balances in real time</p>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>W</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Your Wallet</h2>
          <p style={{ color: C.muted, fontSize: 13, maxWidth: 300, margin: '0 auto 24px', lineHeight: 1.6 }}>Connect your wallet to view real-time balances.</p>
          <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 10, padding: '12px 28px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', ...rootStyle }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Real-time balances - Auto-refreshes every 30s</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchBalances} style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '7px 14px', color: C.accent, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>Refresh</button>
          {onSend && <button onClick={onSend} style={{ background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', borderRadius: 8, padding: '7px 14px', color: '#03060f', fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>Send Tokens</button>}
        </div>
      </div>

      {!publicKey && (
        <div style={{ background: C.card, border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 8 }}>SOLANA WALLET ADDRESS</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={manualAddress}
              onChange={e => setManualAddress(e.target.value)}
              placeholder="Paste your Solana address to view balances..."
              style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: '#fff', fontFamily: 'monospace', fontSize: 12, outline: 'none' }}
            />
            <button onClick={() => setLookupAddress(manualAddress.trim())} style={{ background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', borderRadius: 8, padding: '10px 16px', color: '#03060f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', flexShrink: 0 }}>
              Load
            </button>
          </div>
          {lookupAddress && <div style={{ fontSize: 11, color: C.green, marginTop: 6 }}>Showing balances for: {lookupAddress.slice(0, 8)}...{lookupAddress.slice(-8)}</div>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          ['Total Value', fmt(totalValue), C.accent],
          ['SOL Balance', solBalance.toFixed(4) + ' SOL', C.green],
          ['SOL Value', fmt(solValue), C.text],
          ['Assets', (balances.length + 1) + ' tokens', C.muted],
        ].map(([label, value, color]) => (
          <div key={label} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, fontWeight: 700, letterSpacing: .8 }}>{label}</div>
            <div style={{ fontSize: 16, color, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: C.card, border: '1px solid rgba(0,255,163,.15)', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700 }}>CONNECTED WALLET</div>
          <div style={{ fontSize: 11, color: C.green, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{walletAddress || ''}</div>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {[['holdings', 'Holdings'], ['activity', 'Activity']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{ padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: 'Syne, sans-serif', cursor: 'pointer', background: activeTab === id ? 'rgba(0,229,255,.09)' : 'transparent', border: '1px solid ' + (activeTab === id ? 'rgba(0,229,255,.25)' : C.border), color: activeTab === id ? C.accent : C.muted }}
          >{label}</button>
        ))}
      </div>

      {activeTab === 'holdings' && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
            <div>TOKEN</div><div style={{ textAlign: 'right' }}>BALANCE</div><div style={{ textAlign: 'right' }}>PRICE</div><div style={{ textAlign: 'right' }}>VALUE</div>
          </div>

          <div
            onClick={() => onSelectToken && onSelectToken({ id: 'solana', symbol: 'SOL', name: 'Solana', current_price: solPrice })}
            style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: onSelectToken ? 'pointer' : 'default' }}
            onMouseEnter={e => { if (onSelectToken) e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
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
            balances.map(token => {
              const price = getPrice(token.symbol);
              const value = token.uiAmount * price;
              return (
                <div
                  key={token.mint}
                  onClick={() => onSelectToken && onSelectToken({ id: token.mint, symbol: token.symbol, name: token.name, image: token.logoURI, current_price: getPrice(token.symbol), isSolanaToken: true, mint: token.mint })}
                  style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: onSelectToken ? 'pointer' : 'default' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,229,255,.02)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {token.logoURI
                      ? <img src={token.logoURI} alt={token.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
                      : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{token.symbol?.charAt(0)}</div>
                    }
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

      {evmConnected && evmAddress && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>EVM WALLETS -- ALL CHAINS</span>
            {evmLoading && <span style={{ fontSize: 11, color: C.accent }}>Loading...</span>}
            {!evmLoading && evmTokens.length > 0 && (
              <span style={{ fontSize: 11, color: C.muted }}>
                Total: <span style={{ color: C.green, fontWeight: 700 }}>{fmt(evmTokens.reduce((sum, t) => sum + t.value, 0))}</span>
              </span>
            )}
          </div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
              <div>TOKEN</div><div style={{ textAlign: 'right' }}>BALANCE</div><div style={{ textAlign: 'right' }}>PRICE</div><div style={{ textAlign: 'right' }}>VALUE</div>
            </div>
            {evmLoading && <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading balances across all chains...</div>}
            {!evmLoading && evmTokens.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>No EVM token balances found</div>}
            {evmTokens.map((token, i) => {
              const positive = token.pct24h >= 0;
              return (
                <div
                  key={token.chain + '-' + token.address + '-' + i}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', alignItems: 'center' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,229,255,.02)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {token.logo
                      ? <img src={token.logo} alt={token.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
                      : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(98,126,234,.15)', border: '1px solid rgba(98,126,234,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#627eea', flexShrink: 0 }}>{token.symbol.charAt(0)}</div>
                    }
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{token.symbol}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>{token.chainName}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>
                    {token.balance >= 1000 ? token.balance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : token.balance.toFixed(4)}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12 }}>
                    <div style={{ color: C.text }}>{token.price > 0 ? fmt(token.price) : '--'}</div>
                    {token.pct24h !== 0 && (
                      <div style={{ fontSize: 10, color: positive ? C.green : C.red }}>
                        {positive ? '+' : ''}{token.pct24h.toFixed(2)}%
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', color: token.value > 0.01 ? C.green : C.muted, fontSize: 12, fontWeight: token.value > 0.01 ? 600 : 400 }}>
                    {token.value > 0.01 ? fmt(token.value) : '--'}
                  </div>
                </div>
              );
            })}
            {evmAddress && (
              <div style={{ padding: '10px 16px', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.03)' }}>
                <a href={'https://etherscan.io/address/' + evmAddress} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.accent, textDecoration: 'none' }}>View on Etherscan</a>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>T</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Transaction History</div>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, maxWidth: 280, margin: '0 auto 20px' }}>View your full transaction history on Solscan.</p>
          {walletAddress && (
            <a href={'https://solscan.io/account/' + walletAddress} target="_blank" rel="noreferrer" style={{ display: 'inline-block', padding: '10px 24px', borderRadius: 10, background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)', color: C.accent, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>View on Solscan</a>
          )}
        </div>
      )}
    </div>
  );
}
