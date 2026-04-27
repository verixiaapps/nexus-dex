import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const YOUR_FEE_WALLET = 'E2yVdtMKBX8c7nNwks2mJ8gXpVrEMf2gkrXLz5oaDzQX';
const FEE_PERCENT = 0.001;

const TOKEN_LIST = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9, isNative: true },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, isNative: false },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, isNative: false },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, isNative: false },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, isNative: false },
  { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'ETH', name: 'Ethereum', decimals: 8, isNative: false },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium', decimals: 6, isNative: false },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL', decimals: 9, isNative: false },
];

function fmt(n) {
  if (!n) return '$0.00';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(6);
}

export default function Send({ coins }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [selectedToken, setSelectedToken] = useState(TOKEN_LIST[0]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [error, setError] = useState('');
  const [solBalance, setSolBalance] = useState(0);

  useEffect(function() {
    if (!publicKey || !connection) return;
    var fetch = async function() {
      try {
        var bal = await connection.getBalance(publicKey);
        setSolBalance(bal / LAMPORTS_PER_SOL);
      } catch (e) {}
    };
    fetch();
  }, [publicKey, connection]);

  var getPrice = function(symbol) {
    var coin = coins.find(function(c) { return c.symbol && c.symbol.toLowerCase() === symbol.toLowerCase(); });
    return coin ? coin.current_price : 0;
  };

  var price = getPrice(selectedToken.symbol);
  var amountNum = parseFloat(amount) || 0;
  var feeAmount = amountNum * FEE_PERCENT;
  var recipientAmount = amountNum - feeAmount;
  var usdValue = amountNum * price;

  var isValidAddress = function(addr) {
    try {
      new PublicKey(addr);
      return true;
    } catch (e) {
      return false;
    }
  };

  var handleSend = async function() {
    if (!connected || !publicKey) return;
    if (!recipient || !isValidAddress(recipient)) {
      setError('Invalid recipient address');
      return;
    }
    if (!amount || amountNum <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setError('');
    setStatus('loading');
    try {
      var recipientPubkey = new PublicKey(recipient);
      var feePubkey = new PublicKey(YOUR_FEE_WALLET);
      var transaction = new Transaction();

      if (selectedToken.isNative) {
        var recipientLamports = Math.round(recipientAmount * LAMPORTS_PER_SOL);
        var feeLamports = Math.round(feeAmount * LAMPORTS_PER_SOL);

        transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: recipientPubkey,
            lamports: recipientLamports,
          })
        );

        if (feeLamports > 0) {
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: feePubkey,
              lamports: feeLamports,
            })
          );
        }
      } else {
        var mintPubkey = new PublicKey(selectedToken.mint);
        var decimals = selectedToken.decimals;
        var recipientUnits = Math.round(recipientAmount * Math.pow(10, decimals));
        var feeUnits = Math.round(feeAmount * Math.pow(10, decimals));

        var fromAta = await getAssociatedTokenAddress(mintPubkey, publicKey);
        var toAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
        var feeAta = await getAssociatedTokenAddress(mintPubkey, feePubkey);

        transaction.add(
          createTransferInstruction(fromAta, toAta, publicKey, recipientUnits)
        );

        if (feeUnits > 0) {
          transaction.add(
            createTransferInstruction(fromAta, feeAta, publicKey, feeUnits)
          );
        }
      }

      var { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      var sig = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      setTxSig(sig);
      setStatus('success');
      setAmount('');
      setRecipient('');
      setTimeout(function() { setStatus('idle'); }, 5000);
    } catch (e) {
      console.error('Send error:', e);
      setError(e.message || 'Transaction failed');
      setStatus('error');
      setTimeout(function() { setStatus('idle'); setError(''); }, 4000);
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>Send Tokens</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
          Send crypto to any Solana wallet · 0.1% network fee
        </p>
      </div>

      {!connected ? (
        <div style={{ textAlign: 'center', padding: '60px 40px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>➤</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Wallet to Send</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>Connect your Phantom or Solflare wallet to send tokens.</p>
          <WalletMultiButton />
        </div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 24 }}>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, fontWeight: 600 }}>SELECT TOKEN</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TOKEN_LIST.map(function(token) {
                return (
                  <button key={token.mint} onClick={function() { setSelectedToken(token); }}
                    style={{
                      padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                      background: selectedToken.mint === token.mint ? 'rgba(0,229,255,.12)' : 'transparent',
                      border: '1px solid ' + (selectedToken.mint === token.mint ? 'rgba(0,229,255,.4)' : C.border),
                      color: selectedToken.mint === token.mint ? C.accent : C.muted,
                    }}>{token.symbol}</button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, fontWeight: 600 }}>RECIPIENT ADDRESS</div>
            <input
              value={recipient}
              onChange={function(e) { setRecipient(e.target.value); }}
              placeholder="Paste Solana wallet address..."
              style={{
                width: '100%', background: C.card2, border: '1px solid ' + (recipient && !isValidAddress(recipient) ? C.red : C.border),
                borderRadius: 12, padding: '14px 16px', color: C.text,
                fontFamily: 'JetBrains Mono, monospace', fontSize: 12, outline: 'none',
              }}
            />
            {recipient && !isValidAddress(recipient) && (
              <div style={{ color: C.red, fontSize: 11, marginTop: 6 }}>Invalid Solana address</div>
            )}
            {recipient && isValidAddress(recipient) && (
              <div style={{ color: C.green, fontSize: 11, marginTop: 6 }}>Valid address</div>
            )}
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>AMOUNT</span>
              {selectedToken.isNative && (
                <span style={{ fontSize: 11, color: C.muted }}>
                  Balance: {solBalance.toFixed(4)} SOL
                </span>
              )}
            </div>
            <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                value={amount}
                onChange={function(e) { setAmount(e.target.value.replace(/[^0-9.]/g, '')); }}
                placeholder="0.00"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 500, color: '#fff', outline: 'none', minWidth: 0 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                <span style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>{selectedToken.symbol}</span>
                {price > 0 && amount && (
                  <span style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{fmt(usdValue)}</span>
                )}
              </div>
            </div>
            {selectedToken.isNative && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {[0.25, 0.5, 0.75, 1].map(function(pct) {
                  return (
                    <button key={pct} onClick={function() { setAmount((solBalance * pct * 0.99).toFixed(6)); }}
                      style={{
                        flex: 1, padding: '4px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                        background: 'transparent', border: '1px solid ' + C.border, color: C.muted,
                        fontFamily: 'Syne, sans-serif',
                      }}>{pct === 1 ? 'MAX' : (pct * 100) + '%'}</button>
                  );
                })}
              </div>
            )}
          </div>

          {amount && parseFloat(amount) > 0 && (
            <div style={{ background: '#050912', borderRadius: 12, padding: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700 }}>TRANSACTION BREAKDOWN</div>
              {[
                ['You Send', amountNum.toFixed(6) + ' ' + selectedToken.symbol],
                ['Nexus Fee (0.1%)', feeAmount.toFixed(6) + ' ' + selectedToken.symbol],
                ['Recipient Gets', recipientAmount.toFixed(6) + ' ' + selectedToken.symbol],
                ['USD Value', fmt(usdValue)],
              ].map(function(item) {
                return (
                  <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: C.muted }}>{item[0]}</span>
                    <span style={{ color: item[0] === 'Recipient Gets' ? C.green : C.text, fontWeight: item[0] === 'Recipient Gets' ? 600 : 400 }}>{item[1]}</span>
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>
              {error}
            </div>
          )}

          <button onClick={handleSend}
            disabled={!amount || !recipient || !isValidAddress(recipient) || status === 'loading'}
            style={{
              width: '100%', padding: 18, borderRadius: 14, border: 'none',
              background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                : status === 'error' ? 'rgba(255,59,107,.2)'
                : !amount || !recipient ? C.card2
                : 'linear-gradient(135deg,#00e5ff,#0055ff)',
              color: !amount || !recipient ? C.muted2 : status === 'error' ? C.red : C.bg,
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
              cursor: !amount || !recipient ? 'not-allowed' : 'pointer',
              transition: 'all .3s',
            }}>
            {status === 'loading' ? 'Confirm in Wallet...'
              : status === 'success' ? 'Sent Successfully!'
              : status === 'error' ? 'Failed - Try Again'
              : !recipient ? 'Enter Recipient Address'
              : !amount ? 'Enter Amount'
              : 'Send ' + selectedToken.symbol}
          </button>

          {txSig && status === 'success' && (
            <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer"
              style={{ display: 'block', textAlign: 'center', marginTop: 12, fontSize: 12, color: C.accent }}>
              View on Solscan ↗
            </a>
          )}

          <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 14, lineHeight: 1.6 }}>
            0.1% fee on all sends · Fee goes to Nexus DEX · User pays all gas
          </p>
        </div>
      )}
    </div>
  );
}
