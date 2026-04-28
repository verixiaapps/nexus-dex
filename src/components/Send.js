import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction } from '@solana/spl-token';

const FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const BASE_FEE = 0.03;
const ANTIMEV_FEE = 0.02;
const JUP_API_KEY = process.env.REACT_APP_JUPITER_API_KEY1 || '';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const POPULAR_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9, isNative: true, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, logoURI: 'https://static.jup.ag/jup/icon.png' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png' },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL', decimals: 9, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png' },
  { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth', decimals: 6, logoURI: 'https://pyth.network/token.svg' },
  { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', symbol: 'ORCA', name: 'Orca', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png' },
  { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'WETH', name: 'Wrapped Ether', decimals: 8, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png' },
];

const SOL_TOKEN = POPULAR_TOKENS[0];

async function getTokenDecimals(token) {
  if (!token) return 6;
  const popular = POPULAR_TOKENS.find(t => t.mint === token.mint);
  if (popular) return popular.decimals;
  try {
    const r = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + token.mint, {
      headers: { 'x-api-key': JUP_API_KEY },
    });
    if (r.ok) {
      const d = await r.json();
      const dec = parseInt(d.decimals);
      return (!isNaN(dec) && dec >= 0 && dec <= 18) ? dec : (token.decimals || 6);
    }
  } catch (e) {}
  return token.decimals || 6;
}

function fmt(n) {
  if (!n) return '$0.00';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(6);
}

function TokenSearchModal({ open, onClose, jupiterTokens }) {
  const [q, setQ] = useState('');
  const [contractAddr, setContractAddr] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  const allTokens = jupiterTokens && jupiterTokens.length > 0 ? jupiterTokens : POPULAR_TOKENS;

  const isValidAddress = str =>
    str && str.length >= 32 && str.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(str);

  const lookupContract = async addr => {
    if (!isValidAddress(addr)) return;
    setContractLoading(true);
    try {
      const found = allTokens.find(t => t.mint === addr);
      if (found) {
        setContractToken(found);
      } else {
        const res = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + addr, {
          headers: { 'x-api-key': JUP_API_KEY },
        });
        if (res.ok) {
          const data = await res.json();
          const dec = parseInt(data.decimals);
          setContractToken({
            mint: data.address,
            symbol: data.symbol,
            name: data.name,
            decimals: (!isNaN(dec) && dec >= 0 && dec <= 18) ? dec : 6,
            logoURI: data.logoURI,
            isNative: false,
          });
        } else {
          setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, isNative: false });
        }
      }
    } catch (e) {
      setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, isNative: false });
    }
    setContractLoading(false);
  };

  useEffect(() => {
    if (!q) { setSearchResults([]); return; }
    const ql = q.toLowerCase();
    setSearchResults(
      allTokens.filter(t =>
        (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
        (t.name && t.name.toLowerCase().includes(ql)) ||
        (t.mint && t.mint.toLowerCase().includes(ql))
      ).slice(0, 100)
    );
  }, [q, allTokens]);

  const displayTokens = q ? searchResults : POPULAR_TOKENS;
  const close = () => { setQ(''); setContractAddr(''); setContractToken(null); setSearchResults([]); onClose(null); };

  if (!open) return null;

  return (
    <div>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,.75)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 300, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, width: '94vw', maxWidth: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
              <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>All Solana tokens including unverified - DYOR</div>
            </div>
            <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0 }}>x</button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by name or symbol..."
            style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8 }}
          />
          <input
            value={contractAddr}
            onChange={e => setContractAddr(e.target.value)}
            onBlur={() => { if (contractAddr) lookupContract(contractAddr); }}
            placeholder="Or paste any Solana contract address..."
            style={{ width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '10px 12px', color: C.accent, fontSize: 12, outline: 'none', fontFamily: 'monospace' }}
          />
          {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>}
          {contractToken && !contractLoading && (
            <div
              onClick={() => { onClose(contractToken); setContractAddr(''); setContractToken(null); setQ(''); }}
              style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {contractToken.logoURI
                ? <img src={contractToken.logoURI} alt={contractToken.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }} onError={e => { e.target.style.display = 'none'; }} />
                : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent }}>{contractToken.symbol && contractToken.symbol.charAt(0)}</div>
              }
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>{contractToken.name}</div>
              </div>
              <div style={{ marginLeft: 'auto', color: C.accent, fontSize: 11, fontWeight: 600 }}>Select</div>
            </div>
          )}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!q && <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>POPULAR TOKENS</div>}
          {q && searchResults.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>No tokens found. Paste contract address above.</div>
          )}
          {displayTokens.map(t => (
            <div
              key={t.mint}
              onClick={() => { onClose(t); setQ(''); }}
              style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {t.logoURI
                ? <img src={t.logoURI} alt={t.symbol} style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
                : <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{t.symbol && t.symbol.charAt(0)}</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
              </div>
              <div style={{ color: C.muted2, fontSize: 9, fontFamily: 'monospace', flexShrink: 0 }}>
                {t.mint && t.mint.slice(0, 4) + '...' + t.mint.slice(-4)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Send({ coins, jupiterTokens, onConnectWallet, isConnected, isSolanaConnected, walletAddress }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [selectedToken, setSelectedToken] = useState(SOL_TOKEN);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [error, setError] = useState('');
  const [solBalance, setSolBalance] = useState(0);
  const [antiMev, setAntiMev] = useState(true);

  const totalFee = antiMev ? BASE_FEE + ANTIMEV_FEE : BASE_FEE;

  useEffect(() => {
    if (!publicKey || !connection) return;
    connection.getBalance(publicKey)
      .then(bal => setSolBalance(bal / LAMPORTS_PER_SOL))
      .catch(() => {});
  }, [publicKey, connection]);

  const getPrice = symbol => {
    const coin = coins.find(c => c.symbol && c.symbol.toLowerCase() === (symbol || '').toLowerCase());
    return coin ? coin.current_price : 0;
  };

  const isValidAddress = addr => {
    try { new PublicKey(addr); return addr.length >= 32; } catch (e) { return false; }
  };

  const amountNum = parseFloat(amount) || 0;
  const feeAmount = amountNum * totalFee;
  const recipientAmount = amountNum - feeAmount;
  const price = getPrice(selectedToken.symbol);
  const usdValue = amountNum * price;

  const handleSend = async () => {
    if (!isConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!isSolanaConnected || !publicKey) { setError('Please connect a Solana wallet to send'); return; }
    if (!recipient || !isValidAddress(recipient)) { setError('Invalid recipient address'); return; }
    if (!amount || amountNum <= 0) { setError('Enter a valid amount'); return; }
    setError(''); setStatus('loading');
    try {
      const recipientPubkey = new PublicKey(recipient);
      const feePubkey = new PublicKey(FEE_WALLET);
      const transaction = new Transaction();
      const decimals = await getTokenDecimals(selectedToken);

      if (selectedToken.isNative || selectedToken.mint === SOL_TOKEN.mint) {
        const recipientLamports = Math.round(recipientAmount * LAMPORTS_PER_SOL);
        const feeLamports = Math.round(feeAmount * LAMPORTS_PER_SOL);
        transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: recipientPubkey, lamports: recipientLamports }));
        if (feeLamports > 0) transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feePubkey, lamports: feeLamports }));
      } else {
        const mintPubkey = new PublicKey(selectedToken.mint);
        const recipientUnits = Math.round(recipientAmount * Math.pow(10, decimals));
        const feeUnits = Math.round(feeAmount * Math.pow(10, decimals));
        const fromAta = await getAssociatedTokenAddress(mintPubkey, publicKey);
        const toAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
        const feeAta = await getAssociatedTokenAddress(mintPubkey, feePubkey);
        try {
          const toAtaInfo = await connection.getAccountInfo(toAta);
          if (!toAtaInfo) transaction.add(createAssociatedTokenAccountInstruction(publicKey, toAta, recipientPubkey, mintPubkey));
        } catch (e) {}
        transaction.add(createTransferInstruction(fromAta, toAta, publicKey, recipientUnits));
        if (feeUnits > 0) {
          try {
            const feeAtaInfo = await connection.getAccountInfo(feeAta);
            if (!feeAtaInfo) transaction.add(createAssociatedTokenAccountInstruction(publicKey, feeAta, feePubkey, mintPubkey));
          } catch (e) {}
          transaction.add(createTransferInstruction(fromAta, feeAta, publicKey, feeUnits));
        }
      }

      const lb = await connection.getLatestBlockhash();
      transaction.recentBlockhash = lb.blockhash;
      transaction.feePayer = publicKey;
      const sig = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      setTxSig(sig); setStatus('success'); setAmount(''); setRecipient('');
      setTimeout(() => setStatus('idle'), 5000);
    } catch (e) {
      console.error('Send error:', e);
      setError(e.message || 'Transaction failed');
      setStatus('error');
      setTimeout(() => { setStatus('idle'); setError(''); }, 4000);
    }
  };

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send Tokens</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Any Solana token - {(totalFee * 100).toFixed(0)}% fee</p>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Wallet to Send</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>Connect your wallet to send any Solana token.</p>
          <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 10, padding: '12px 28px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  if (!isSolanaConnected) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send Tokens</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Solana Wallet Required</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>Please connect Phantom to send Solana tokens.</p>
          <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 10, padding: '12px 28px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect Phantom</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send Tokens</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Any Solana token - {(totalFee * 100).toFixed(0)}% fee</p>
      </div>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20 }}>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>SELECT TOKEN</div>
          <button
            onClick={() => setTokenModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '12px 16px', cursor: 'pointer', width: '100%' }}
          >
            {selectedToken.logoURI
              ? <img src={selectedToken.logoURI} alt={selectedToken.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }} onError={e => { e.target.style.display = 'none'; }} />
              : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent }}>{selectedToken.symbol && selectedToken.symbol.charAt(0)}</div>
            }
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{selectedToken.symbol}</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{selectedToken.name}</div>
            </div>
            <span style={{ color: C.muted, fontSize: 11 }}>Change v</span>
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>RECIPIENT ADDRESS</div>
          <input
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            placeholder="Paste Solana wallet address..."
            style={{ width: '100%', background: C.card2, border: '1px solid ' + (recipient && !isValidAddress(recipient) ? C.red : C.border), borderRadius: 12, padding: '14px 16px', color: C.text, fontFamily: 'monospace', fontSize: 12, outline: 'none' }}
          />
          {recipient && !isValidAddress(recipient) && <div style={{ color: C.red, fontSize: 11, marginTop: 5 }}>Invalid Solana address</div>}
          {recipient && isValidAddress(recipient) && <div style={{ color: C.green, fontSize: 11, marginTop: 5 }}>Valid address</div>}
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>AMOUNT</span>
            {selectedToken.isNative && <span style={{ fontSize: 11, color: C.muted }}>Balance: {solBalance.toFixed(4)} SOL</span>}
          </div>
          <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 600, color: '#fff', outline: 'none', minWidth: 0 }}
            />
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>{selectedToken.symbol}</div>
              {price > 0 && amount && <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{fmt(usdValue)}</div>}
            </div>
          </div>
          {selectedToken.isNative && solBalance > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[0.25, 0.5, 0.75, 1].map(p => (
                <button
                  key={p}
                  onClick={() => setAmount((solBalance * p * 0.99).toFixed(6))}
                  style={{ flex: 1, padding: '5px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'transparent', border: '1px solid ' + C.border, color: C.muted, fontFamily: 'Syne, sans-serif' }}
                >
                  {p === 1 ? 'MAX' : (p * 100) + '%'}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: '#050912', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>ANTI-MEV PROTECTION</span>
              <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>
                {antiMev ? 'ON - Priority processing (+2%)' : 'OFF - Standard (saves 2%)'}
              </div>
            </div>
            <button
              onClick={() => setAntiMev(!antiMev)}
              style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: antiMev ? C.accent : C.muted2, transition: 'background .2s', position: 'relative', flexShrink: 0 }}
            >
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: antiMev ? 23 : 3, transition: 'left .2s' }} />
            </button>
          </div>
          {amount && parseFloat(amount) > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 8 }}>
              {[
                ['Platform Fee (3%)', (amountNum * BASE_FEE).toFixed(6) + ' ' + selectedToken.symbol],
                antiMev ? ['Anti-MEV Fee (2%)', (amountNum * ANTIMEV_FEE).toFixed(6) + ' ' + selectedToken.symbol] : null,
                ['Service Fee (1%)', (amountNum * 0.01).toFixed(6) + ' ' + selectedToken.symbol],
                ['Recipient Gets', recipientAmount.toFixed(6) + ' ' + selectedToken.symbol],
                price > 0 ? ['USD Value', fmt(usdValue)] : null,
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                  <span style={{ color: C.muted }}>{label}</span>
                  <span style={{ color: label === 'Recipient Gets' ? C.green : C.text, fontWeight: label === 'Recipient Gets' ? 600 : 400 }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>{error}</div>
        )}

        <button
          onClick={handleSend}
          disabled={status === 'loading'}
          style={{
            width: '100%', padding: 18, borderRadius: 14, border: 'none',
            background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
              : status === 'error' ? 'rgba(255,59,107,.2)'
              : !amount || !recipient ? C.card2
              : 'linear-gradient(135deg,#00e5ff,#0055ff)',
            color: !amount || !recipient ? C.muted2 : status === 'error' ? C.red : C.bg,
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
            cursor: status === 'loading' ? 'not-allowed' : 'pointer',
            transition: 'all .3s', minHeight: 52,
          }}
        >
          {status === 'loading' ? 'Confirming in Wallet...'
            : status === 'success' ? 'Sent Successfully!'
            : status === 'error' ? 'Failed - Try Again'
            : !recipient ? 'Enter Recipient Address'
            : !amount ? 'Enter Amount'
            : 'Send ' + selectedToken.symbol}
        </button>

        {txSig && status === 'success' && (
          <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>
            View on Solscan
          </a>
        )}
        <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 14, lineHeight: 1.6 }}>
          Non-custodial - Fees sent directly to Nexus DEX
        </p>
      </div>

      <TokenSearchModal
        open={tokenModalOpen}
        jupiterTokens={jupiterTokens || []}
        onClose={token => { setTokenModalOpen(false); if (token) setSelectedToken(token); }}
      />
    </div>
  );
}
