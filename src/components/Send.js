import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction } from '@solana/spl-token';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
}; 

const QUICK_TOKENS = [
  { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, isNative: true },
  { mint: USDC_SOLANA, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6BFrR4Jfrj6z7m9', symbol: 'BONK', name: 'Bonk', decimals: 5 },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', name: 'dogwifhat', decimals: 6 },
];

function fmt(n) {
  n = Number(n || 0);
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(6);
}

function isValidSolAddress(address) {
  try { new PublicKey(address.trim()); return address.trim().length >= 32; } catch { return false; }
}

function toRawAmount(value, decimals) {
  const clean = String(value).trim();
  if (!clean || Number.isNaN(Number(clean))) return BigInt(0);
  const parts = clean.split('.');
  const whole = parts[0] || '0';
  const fraction = parts[1] || '';
  const d = Number(decimals);
  const padded = (fraction + '0'.repeat(d)).slice(0, d);
  return BigInt(whole) * (BigInt(10) ** BigInt(d)) + BigInt(padded || '0');
}

async function getSolTokenProgramId(connection, mintPk) {
  try { const info = await connection.getAccountInfo(mintPk); if (info && info.owner && info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID; } catch {}
  return TOKEN_PROGRAM_ID;
}

export default function Send({ onConnectWallet }) {
  const { publicKey: extPk, sendTransaction: extSendTx, connected: solCon } = useWallet();
  const { connection } = useConnection();
  const { activeWalletKind, privyEmbeddedSol } = useNexusWallet();

  const pubkey = useMemo(() => {
    if (extPk) return extPk;
    if (privyEmbeddedSol?.address) { try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; } }
    return null;
  }, [extPk, privyEmbeddedSol]);

  const hasSol = !!(solCon || (privyEmbeddedSol && pubkey));

  const sendTx = useCallback(async (tx, conn) => {
    if (activeWalletKind === 'privy' && privyEmbeddedSol) {
      if (typeof privyEmbeddedSol.sendTransaction === 'function') return privyEmbeddedSol.sendTransaction(tx, conn, { skipPreflight: false, maxRetries: 3 });
      if (typeof privyEmbeddedSol.signTransaction === 'function') { const s = await privyEmbeddedSol.signTransaction(tx); return conn.sendRawTransaction(s.serialize(), { skipPreflight: true, maxRetries: 3 }); }
      throw new Error('No sign method');
    }
    return extSendTx(tx, conn, { skipPreflight: false, maxRetries: 3 });
  }, [activeWalletKind, privyEmbeddedSol, extSendTx]);

  const [selectedToken, setSelectedToken] = useState(QUICK_TOKENS[0]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [error, setError] = useState('');
  const [solBalance, setSolBalance] = useState(null);
  const [pendingSend, setPendingSend] = useState(false);

  const recipientValid = useMemo(() => recipient ? isValidSolAddress(recipient) : false, [recipient]);
  const amountNum = parseFloat(amount) || 0;

  useEffect(() => { setRecipient(''); setAmount(''); setError(''); setTxSig(null); setStatus('idle'); }, [selectedToken]);
  useEffect(() => { if (!hasSol || !pendingSend) return; const t = setTimeout(() => { setPendingSend(false); handleSend(); }, 200); return () => clearTimeout(t); }, [hasSol, pendingSend]);

  useEffect(() => {
    if (!pubkey || !connection) { setSolBalance(null); return; }
    let c = false;
    connection.getBalance(pubkey).then(b => { if (!c) setSolBalance(b / 1e9); }).catch(() => { if (!c) setSolBalance(null); });
    return () => { c = true; };
  }, [pubkey, connection]);

  const handleSend = async () => {
    if (!hasSol) { setPendingSend(true); onConnectWallet?.(); return; }
    if (!recipientValid) { setError('Invalid Solana address'); return; }
    if (!amountNum || amountNum <= 0) { setError('Enter a valid amount'); return; }
    setError(''); setTxSig(null); setStatus('loading');
    try {
      const recipientPk = new PublicKey(recipient.trim());
      const tx = new Transaction();
      if (selectedToken.mint === SOL_MINT) {
        const lamports = toRawAmount(amount, 9);
        if (lamports <= BigInt(0)) throw new Error('Amount too small');
        tx.add(SystemProgram.transfer({ fromPubkey: pubkey, toPubkey: recipientPk, lamports }));
      } else {
        const decimals = selectedToken.decimals || 6;
        const raw = toRawAmount(amount, decimals);
        if (raw <= BigInt(0)) throw new Error('Amount too small');
        const mintPk = new PublicKey(selectedToken.mint);
        const programId = await getSolTokenProgramId(connection, mintPk);
        const fromAta = await getAssociatedTokenAddress(mintPk, pubkey, false, programId);
        const toAta = await getAssociatedTokenAddress(mintPk, recipientPk, false, programId);
        const toInfo = await connection.getAccountInfo(toAta).catch(() => null);
        if (!toInfo) tx.add(createAssociatedTokenAccountInstruction(pubkey, toAta, recipientPk, mintPk, programId));
        tx.add(createTransferInstruction(fromAta, toAta, pubkey, raw, [], programId));
      }
      const latest = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = latest.blockhash;
      tx.feePayer = pubkey;
      const sig = await sendTx(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
      setTxSig(sig); setStatus('success'); setAmount(''); setRecipient('');
      setTimeout(() => { setStatus('idle'); setTxSig(null); }, 7000);
    } catch (e) {
      setError(e?.message || 'Transaction failed');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  if (!hasSol) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
        <div style={{ marginBottom: 20 }}><h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send</h1><p style={{ color: C.muted, fontSize: 12 }}>Solana wallet-to-wallet transfers</p></div>
        <div style={{ textAlign: 'center', padding: '60px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Wallet</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>Connect your Solana wallet to send tokens.</p>
          <button onClick={() => onConnectWallet?.()} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 10, padding: '12px 28px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <div style={{ marginBottom: 20 }}><h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send</h1><p style={{ color: C.muted, fontSize: 12 }}>Solana wallet-to-wallet transfers</p></div>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700 }}>TOKEN</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {QUICK_TOKENS.map(t => (
              <button key={t.mint} onClick={() => setSelectedToken(t)} style={{
                padding: '8px 14px', borderRadius: 10,
                border: '1px solid ' + (selectedToken.mint === t.mint ? C.accent : C.border),
                background: selectedToken.mint === t.mint ? 'rgba(0,229,255,.10)' : C.card2,
                color: selectedToken.mint === t.mint ? C.accent : C.muted,
                fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif',
              }}>{t.symbol}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700 }}>RECIPIENT</div>
          <input value={recipient} onChange={e => setRecipient(e.target.value.trim())} placeholder="Solana wallet address..." style={{ width: '100%', background: C.card2, border: '1px solid ' + (recipient && !recipientValid ? C.red : C.border), borderRadius: 12, padding: '14px 16px', color: C.text, fontFamily: 'monospace', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          {recipient && !recipientValid && <div style={{ color: C.red, fontSize: 11, marginTop: 4 }}>Invalid Solana address</div>}
          {recipient && recipientValid && <div style={{ color: C.green, fontSize: 11, marginTop: 4 }}>Valid address</div>}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>AMOUNT</span>
            {selectedToken.mint === SOL_MINT && solBalance != null && <span style={{ fontSize: 11, color: C.muted }}>Balance: {solBalance.toFixed(4)} SOL</span>}
          </div>
          <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <input value={amount} onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); const parts = v.split('.'); setAmount(parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : v); }} placeholder="0.00" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 600, color: '#fff', outline: 'none' }} />
            <div style={{ color: C.accent, fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{selectedToken.symbol}</div>
          </div>
          {selectedToken.mint === SOL_MINT && solBalance > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[0.25, 0.5, 0.75, 1].map(pct => (
                <button key={pct} onClick={() => setAmount((solBalance * pct * 0.99).toFixed(6))} style={{ flex: 1, padding: '5px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'transparent', border: '1px solid ' + C.border, color: C.muted, fontFamily: 'Syne, sans-serif' }}>{pct === 1 ? 'MAX' : (pct * 100) + '%'}</button>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: '#050912', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
          No fee. Direct wallet-to-wallet transfer. You pay only the Solana network fee.
        </div>

        {error && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>{error}</div>}

        <button onClick={handleSend} disabled={status === 'loading'} style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : status === 'error' ? 'rgba(255,59,107,.2)' : !amount || !recipient ? C.card2 : 'linear-gradient(135deg,#00e5ff,#0055ff)', color: !amount || !recipient ? C.muted2 : status === 'error' ? C.red : C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 52 }}>
          {status === 'loading' ? 'Confirming...' : status === 'success' ? 'Sent!' : status === 'error' ? 'Retry' : !recipient ? 'Enter Address' : !amount ? 'Enter Amount' : 'Send ' + selectedToken.symbol}
        </button>

        {txSig && status === 'success' && (
          <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>View on Solscan</a>
        )}

        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 14 }}>Non-custodial · Solana only · No fee</p>
      </div>
    </div>
  );
}