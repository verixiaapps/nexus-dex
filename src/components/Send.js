import React, { useState, useEffect } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';

const FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const BASE_FEE = 0.03;
const ANTIMEV_FEE = 0.02;

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const SOL_TOKEN = {
  mint: 'So11111111111111111111111111111111111111112',
  symbol: 'SOL', name: 'Solana', decimals: 9, isNative: true,
};

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

  var isValidAddress = function(str) {
    try { new PublicKey(str); return str.length >= 32; } catch (e) { return false; }
  };

  var lookupContract = async function(addr) {
    if (!isValidAddress(addr)) return;
    setContractLoading(true);
    try {
      var found = jupiterTokens.find(function(t) { return t.mint === addr; });
      if (found) {
        setContractToken(found);
      } else {
        var res = await fetch('https://tokens.jup.ag/token/' + addr);
        if (res.ok) {
          var data = await res.json();
          setContractToken({ mint: data.address, symbol: data.symbol, name: data.name, decimals: data.decimals, logoURI: data.logoURI });
        } else {
          setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, isNative: false });
        }
      }
    } catch (e) {
      setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, isNative: false });
    }
    setContractLoading(false);
  };

  var filtered = (jupiterTokens || []).filter(function(t) {
    if (!q) return true;
    var ql = q.toLowerCase();
    return (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
      (t.name && t.name.toLowerCase().includes(ql)) ||
      (t.mint && t.mint.toLowerCase().includes(ql));
  }).slice(0, 100);

  if (!open) return null;

  return (
    <>
      <div onClick={function() { onClose(null); }} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,.75)' }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 300, background: C.card,
        border: '1px solid ' + C.borderHi,
        borderRadius: 18, width: '94vw', maxWidth: 420,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,.95)',
      }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
              <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>All Solana tokens including unverified — DYOR</div>
            </div>
            <button onClick={function() { onClose(null); }} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0 }}>×</button>
          </div>
          <input
            autoFocus value={q}
            onChange={function(e) { setQ(e.target.value); }}
            placeholder="Search by name or symbol..."
            style={{
              width: '100%', background: C.card2, border: '1px solid ' + C.border,
              borderRadius: 8, padding: '10px 12px', color: C.text,
              fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8,
            }}
          />
          <input
            value={contractAddr}
            onChange={function(e) { setContractAddr(e.target.value); }}
            onBlur={function() { if (contractAddr) lookupContract(contractAddr); }}
            placeholder="Paste any Solana contract address..."
            style={{
              width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)',
              borderRadius: 8, padding: '10px 12px', color: C.accent,
              fontSize: 12, outline: 'none', fontFamily: 'JetBrains Mono, monospace',
            }}
          />
          {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>}
          {contractToken && !contractLoading && (
            <div onClick={function() { onClose(contractToken); setContractAddr(''); setContractToken(null); setQ(''); }}
              style={{
                marginTop: 8, padding: '10px 12px',
                background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)',
                borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent }}>
                {contractToken.symbol && contractToken.symbol.charAt(0)}
              </div>
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>{contractToken.name}</div>
              </div>
              <div style={{ marginLeft: 'auto', color: C.accent, fontSize: 11, fontWeight: 600 }}>Select →</div>
            </div>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          <div onClick={function() { onClose(SOL_TOKEN); setQ(''); }}
            style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)', background: 'rgba(153,69,255,.05)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(153,69,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#9945ff', flexShrink: 0 }}>S</div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>SOL</div>
              <div style={{ color: C.muted, fontSize: 11 }}>Solana (Native)</div>
            </div>
          </div>

          {filtered.map(function(t) {
            return (
              <div key={t.mint}
                onClick={function() { onClose({ ...t, isNative: false }); setQ(''); }}
                style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }}
                onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
                onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
              >
                {t.logoURI ? (
                  <img src={t.logoURI} alt={t.symbol} style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0 }}
                    onError={function(e) { e.target.style.display = 'none'; }} />
                ) : (
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
                    {t.symbol && t.symbol.charAt(0)}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
                  <div style={{ color: C.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                </div>
                <div style={{ color: C.muted2, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
                  {t.mint && t.mint.slice(0, 4) + '...' + t.mint.slice(-4)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function Send({ coins, jupiterTokens, onConnectWallet }) {
  const { publicKey, connected, sendTransaction } = useWallet();
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

  var totalFee = antiMev ? BASE_FEE + ANTIMEV_FEE : BASE_FEE;

  useEffect(function() {
    if (!publicKey || !connection) return;
    var fetchBal = async function() {
      try {
        var bal = await connection.getBalance(publicKey);
        setSolBalance(bal / LAMPORTS_PER_SOL);
      } catch (e) {}
    };
    fetchBal();
  }, [publicKey, connection]);

  var getPrice = function(symbol) {
    var coin = coins.find(function(c) {
      return c.symbol && c.symbol.toLowerCase() === (symbol || '').toLowerCase();
    });
    return coin ? coin.current_price : 0;
  };

  var isValidAddress = function(addr) {
    try { new PublicKey(addr); return addr.length >= 32; } catch (e) { return false; }
  };

  var amountNum = parseFloat(amount) || 0;
  var feeAmount = amountNum * totalFee;
  var recipientAmount = amountNum - feeAmount;
  var price = getPrice(selectedToken.symbol);
  var usdValue = amountNum * price;

  var handleSend = async function() {
    if (!connected || !publicKey) {
      if (onConnectWallet) onConnectWallet();
      return;
    }
    if (!recipient || !isValidAddress(recipient)) { setError('Invalid recipient address'); return; }
    if (!amount || amountNum <= 0) { setError('Enter a valid amount'); return; }
    setError('');
    setStatus('loading');
    try {
      var recipientPubkey = new PublicKey(recipient);
      var feePubkey = new PublicKey(FEE_WALLET);
      var transaction = new Transaction();

      if (selectedToken.isNative) {
        var recipientLamports = Math.round(recipientAmount * LAMPORTS_PER_SOL);
        var feeLamports = Math.round(feeAmount * LAMPORTS_PER_SOL);
        transaction.add(SystemProgram.transfer({
          fromPubkey: publicKey, toPubkey: recipientPubkey, lamports: recipientLamports,
        }));
        if (feeLamports > 0) {
          transaction.add(SystemProgram.transfer({
            fromPubkey: publicKey, toPubkey: feePubkey, lamports: feeLamports,
          }));
        }
      } else {
        var mintPubkey = new PublicKey(selectedToken.mint);
        var decimals = selectedToken.decimals || 6;
        var recipientUnits = Math.round(recipientAmount * Math.pow(10, decimals));
        var feeUnits = Math.round(feeAmount * Math.pow(10, decimals));
        var fromAta = await getAssociatedTokenAddress(mintPubkey, publicKey);
        var toAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
        var feeAta = await getAssociatedTokenAddress(mintPubkey, feePubkey);
        transaction.add(createTransferInstruction(fromAta, toAta, publicKey, recipientUnits));
        if (feeUnits > 0) {
          transaction.add(createTransferInstruction(fromAta, feeAta, publicKey, feeUnits));
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
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send Tokens</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
          Any Solana token · {(totalFee * 100).toFixed(0)}% fee
        </p>
      </div>

      {!connected ? (
        <div style={{ textAlign: 'center', padding: '60px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>➤</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Wallet to Send</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
            Connect your wallet to send any Solana token.
          </p>
          <button onClick={onConnectWallet} style={{
            background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
            border: 'none', borderRadius: 10, padding: '12px 28px',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'Syne, sans-serif',
          }}>Connect Wallet</button>
        </div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20 }}>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: .8 }}>SELECT TOKEN</div>
            <button onClick={function() { setTokenModalOpen(true); }} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: C.card2, border: '1px solid ' + C.border,
              borderRadius: 12, padding: '12px 16px', cursor: 'pointer', width: '100%',
            }}>
              {selectedToken.logoURI ? (
                <img src={selectedToken.logoURI} alt={selectedToken.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }}
                  onError={function(e) { e.target.style.display = 'none'; }} />
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent }}>
                  {selectedToken.symbol && selectedToken.symbol.charAt(0)}
                </div>
              )}
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{selectedToken.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>{selectedToken.name}</div>
              </div>
              <span style={{ color: C.muted, fontSize: 11 }}>Change ▾</span>
            </button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: .8 }}>RECIPIENT ADDRESS</div>
            <input
              value={recipient}
              onChange={function(e) { setRecipient(e.target.value); }}
              placeholder="Paste Solana wallet address..."
              style={{
                width: '100%', background: C.card2,
                border: '1px solid ' + (recipient && !isValidAddress(recipient) ? C.red : C.border),
                borderRadius: 12, padding: '14px 16px', color: C.text,
                fontFamily: 'JetBrains Mono, monospace', fontSize: 12, outline: 'none',
              }}
            />
            {recipient && !isValidAddress(recipient) && (
              <div style={{ color: C.red, fontSize: 11, marginTop: 5 }}>Invalid Solana address</div>
            )}
            {recipient && isValidAddress(recipient) && (
              <div style={{ color: C.green, fontSize: 11, marginTop: 5 }}>✓ Valid address</div>
            )}
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>AMOUNT</span>
              {selectedToken.isNative && (
                <span style={{ fontSize: 11, color: C.muted }}>Balance: {solBalance.toFixed(4)} SOL</span>
              )}
            </div>
            <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                value={amount}
                onChange={function(e) { setAmount(e.target.value.replace(/[^0-9.]/g, '')); }}
                placeholder="0.00"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 600, color: '#fff', outline: 'none', minWidth: 0 }}
              />
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                <div style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>{selectedToken.symbol}</div>
                {price > 0 && amount && (
                  <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{fmt(usdValue)}</div>
                )}
              </div>
            </div>
            {selectedToken.isNative && solBalance > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {[0.25, 0.5, 0.75, 1].map(function(p) {
                  return (
                    <button key={p} onClick={function() { setAmount((solBalance * p * 0.99).toFixed(6)); }} style={{
                      flex: 1, padding: '5px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      background: 'transparent', border: '1px solid ' + C.border, color: C.muted,
                      fontFamily: 'Syne, sans-serif',
                    }}>{p === 1 ? 'MAX' : (p * 100) + '%'}</button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ background: '#050912', borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>ANTI-MEV PROTECTION</span>
                <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>
                  {antiMev ? 'ON — Priority processing (+2%)' : 'OFF — Standard (saves 2%)'}
                </div>
              </div>
              <button onClick={function() { setAntiMev(!antiMev); }} style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: antiMev ? C.accent : C.muted2, transition: 'background .2s',
                position: 'relative', flexShrink: 0,
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 3, left: antiMev ? 23 : 3,
                  transition: 'left .2s',
                }} />
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
                ].filter(Boolean).map(function(item) {
                  return (
                    <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                      <span style={{ color: C.muted }}>{item[0]}</span>
                      <span style={{ color: item[0] === 'Recipient Gets' ? C.green : C.text, fontWeight: item[0] === 'Recipient Gets' ? 600 : 400 }}>
                        {item[1]}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>
              {error}
            </div>
          )}

          <button onClick={handleSend}
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
            }}>
            {status === 'loading' ? 'Confirming in Wallet...'
              : status === 'success' ? 'Sent Successfully!'
              : status === 'error' ? 'Failed - Try Again'
              : !recipient ? 'Enter Recipient Address'
              : !amount ? 'Enter Amount'
              : 'Send ' + selectedToken.symbol}
          </button>

          {txSig && status === 'success' && (
            <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer"
              style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>
              View on Solscan ↗
            </a>
          )}

          <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 14, lineHeight: 1.6 }}>
            Non-custodial · Fees sent directly to Nexus DEX
          </p>
        </div>
      )}

      <TokenSearchModal
        open={tokenModalOpen}
        jupiterTokens={jupiterTokens || []}
        onClose={function(token) {
          setTokenModalOpen(false);
          if (token) setSelectedToken(token);
        }}
      />
    </div>
  );
}
