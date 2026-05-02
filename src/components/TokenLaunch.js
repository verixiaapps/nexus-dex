import React, { useState, useCallback } from ‘react’;
import { useWallet, useConnection } from ‘@solana/wallet-adapter-react’;
// FIX 4+6: Add Keypair to static import, remove unused web3 items
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, Keypair } from ‘@solana/web3.js’;
// FIX 5: Remove unused imports (createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority).
// Keep only what is actually used and move all spl-token usage to static imports.
import {
AuthorityType,
MINT_SIZE,
TOKEN_PROGRAM_ID,
createInitializeMintInstruction,
getMinimumBalanceForRentExemptMint,
createAssociatedTokenAccountInstruction,
getAssociatedTokenAddress,
createMintToInstruction,
createSetAuthorityInstruction,
} from ‘@solana/spl-token’;

const SOL_FEE_WALLET = ‘47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5’;
const LAUNCH_FEE_SOL = 0.5;

const C = {
bg: ‘#03060f’, card: ‘#080d1a’, card2: ‘#0c1220’, card3: ‘#111d30’,
border: ‘rgba(0,229,255,0.10)’, borderHi: ‘rgba(0,229,255,0.25)’,
accent: ‘#00e5ff’, green: ‘#00ffa3’, red: ‘#ff3b6b’,
text: ‘#cdd6f4’, muted: ‘#586994’, muted2: ‘#2e3f5e’,
};

function StepIndicator({ step, current }) {
var done = current > step;
var active = current === step;
return (
<div style={{ display: ‘flex’, alignItems: ‘center’, gap: 8 }}>
<div style={{ width: 28, height: 28, borderRadius: ‘50%’, display: ‘flex’, alignItems: ‘center’, justifyContent: ‘center’, fontSize: 12, fontWeight: 700, background: done ? C.green : active ? C.accent : C.card2, color: done || active ? C.bg : C.muted, border: ’2px solid ’ + (done ? C.green : active ? C.accent : C.muted2), flexShrink: 0 }}>
{done ? ‘v’ : step}
</div>
</div>
);
}

export default function TokenLaunch({ isConnected, onConnectWallet, walletAddress }) {
const { publicKey, signTransaction } = useWallet();
const { connection } = useConnection();

const [step, setStep] = useState(1);
const [form, setForm] = useState({
name: ‘’, symbol: ‘’, supply: ‘1000000000’, decimals: ‘9’,
description: ‘’, image: ‘’, website: ‘’, twitter: ‘’,
});
const [imageFile, setImageFile] = useState(null);
const [imagePreview, setImagePreview] = useState(’’);
const [launching, setLaunching] = useState(false);
const [launchStatus, setLaunchStatus] = useState(’’);
const [launchError, setLaunchError] = useState(’’);
const [launchedToken, setLaunchedToken] = useState(null);

var set = function(key, val) { setForm(function(f) { return Object.assign({}, f, { [key]: val }); }); };

var handleImage = useCallback(function(e) {
var file = e.target.files && e.target.files[0];
if (!file) return;
setImageFile(file);
var reader = new FileReader();
reader.onload = function(ev) { setImagePreview(ev.target.result); };
reader.readAsDataURL(file);
}, []);

var step1Valid = form.name.trim() && form.symbol.trim() && parseInt(form.supply) > 0;
var step2Valid = true;

var launchToken = useCallback(async function() {
if (!publicKey || !signTransaction) { setLaunchError(‘Connect Solana wallet first’); return; }

```
// FIX 7: Validate supply before attempting BigInt conversion
var supplyStr = form.supply.trim();
if (!supplyStr || isNaN(Number(supplyStr)) || Number(supplyStr) <= 0) {
  setLaunchError('Invalid supply amount');
  return;
}

setLaunching(true); setLaunchError(''); setLaunchStatus('');

try {
  // Step 1: Check SOL balance
  setLaunchStatus('Checking balance...');
  var balance = await connection.getBalance(publicKey);
  if (balance < (LAUNCH_FEE_SOL + 0.1) * LAMPORTS_PER_SOL) {
    throw new Error('Need at least ' + (LAUNCH_FEE_SOL + 0.1) + ' SOL to launch (fee + transaction costs)');
  }

  // Step 2: Upload image to IPFS via nft.storage or use provided URL
  var imageUri = form.image || '';
  if (imageFile) {
    setLaunchStatus('Uploading image...');
    try {
      var formData = new FormData();
      formData.append('file', imageFile);
      var uploadRes = await fetch('https://api.nft.storage/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (process.env.REACT_APP_NFT_STORAGE_KEY || '') },
        body: formData,
      });
      if (uploadRes.ok) {
        var uploadData = await uploadRes.json();
        imageUri = 'https://ipfs.io/ipfs/' + uploadData.value.cid;
      }
    } catch (e) { console.log('Image upload failed, continuing without image'); }
  }

  // Step 3: Collect launch fee
  setLaunchStatus('Collecting launch fee...');
  var feeTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: new PublicKey(SOL_FEE_WALLET),
      lamports: Math.round(LAUNCH_FEE_SOL * LAMPORTS_PER_SOL),
    })
  );
  var bh = await connection.getLatestBlockhash('confirmed');
  feeTx.recentBlockhash = bh.blockhash;
  feeTx.feePayer = publicKey;
  var signedFeeTx = await signTransaction(feeTx);
  var feeSig = await connection.sendRawTransaction(signedFeeTx.serialize());
  await connection.confirmTransaction({ signature: feeSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');

  // Step 4: Create token mint
  setLaunchStatus('Creating token...');
  var mintKeypair = Keypair.generate();
  var lamportsForMint = await getMinimumBalanceForRentExemptMint(connection);

  var mintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports: lamportsForMint,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      parseInt(form.decimals),
      publicKey,
      null, // freeze authority = null
      TOKEN_PROGRAM_ID
    )
  );

  var bh2 = await connection.getLatestBlockhash('confirmed');
  mintTx.recentBlockhash = bh2.blockhash;
  mintTx.feePayer = publicKey;

  // FIX 1: Correct multi-signer pattern — get wallet signature first,
  // then add mintKeypair signature to the already-signed tx object.
  // Calling mintTx.sign(mintKeypair) BEFORE signTransaction caused the
  // mintKeypair signature to be silently dropped (signTransaction returns
  // a new tx, discarding any prior signatures).
  var signedMintTx = await signTransaction(mintTx);
  signedMintTx.partialSign(mintKeypair);

  var mintSig = await connection.sendRawTransaction(signedMintTx.serialize());
  await connection.confirmTransaction({ signature: mintSig, blockhash: bh2.blockhash, lastValidBlockHeight: bh2.lastValidBlockHeight }, 'confirmed');

  var mintAddress = mintKeypair.publicKey.toBase58();

  // Step 5: Create token account and mint supply
  setLaunchStatus('Minting token supply...');
  var ata = await getAssociatedTokenAddress(mintKeypair.publicKey, publicKey);

  // FIX 2+3: Use BigInt exponentiation instead of Math.pow (avoids float
  // precision loss), and use BigInt(supplyStr) directly instead of
  // BigInt(parseInt(...)) which is capped at Number.MAX_SAFE_INTEGER.
  var supplyAmount = BigInt(supplyStr) * (BigInt(10) ** BigInt(parseInt(form.decimals)));

  var mintSupplyTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, mintKeypair.publicKey),
    createMintToInstruction(mintKeypair.publicKey, ata, publicKey, supplyAmount)
  );
  var bh3 = await connection.getLatestBlockhash('confirmed');
  mintSupplyTx.recentBlockhash = bh3.blockhash;
  mintSupplyTx.feePayer = publicKey;
  var signedMintSupplyTx = await signTransaction(mintSupplyTx);
  var mintSupplySig = await connection.sendRawTransaction(signedMintSupplyTx.serialize());
  await connection.confirmTransaction({ signature: mintSupplySig, blockhash: bh3.blockhash, lastValidBlockHeight: bh3.lastValidBlockHeight }, 'confirmed');

  // Step 6: Transfer mint authority to fee wallet
  setLaunchStatus('Securing token...');
  var transferAuthTx = new Transaction().add(
    createSetAuthorityInstruction(
      mintKeypair.publicKey,
      publicKey,
      AuthorityType.MintTokens,
      new PublicKey(SOL_FEE_WALLET)
    )
  );
  var bh4 = await connection.getLatestBlockhash('confirmed');
  transferAuthTx.recentBlockhash = bh4.blockhash;
  transferAuthTx.feePayer = publicKey;
  var signedAuthTx = await signTransaction(transferAuthTx);
  var authSig = await connection.sendRawTransaction(signedAuthTx.serialize());
  await connection.confirmTransaction({ signature: authSig, blockhash: bh4.blockhash, lastValidBlockHeight: bh4.lastValidBlockHeight }, 'confirmed');

  setLaunchedToken({
    mint: mintAddress,
    name: form.name,
    symbol: form.symbol,
    supply: form.supply,
    decimals: form.decimals,
    image: imagePreview || imageUri,
    txSig: mintSig,
  });

  setLaunchStatus('success');
  setStep(4);

} catch (e) {
  console.error('Launch error:', e);
  setLaunchError(e.message || 'Launch failed');
}
setLaunching(false);
```

}, [publicKey, signTransaction, connection, form, imageFile, imagePreview]);

return (
<div style={{ maxWidth: 560, margin: ‘0 auto’, width: ‘100%’ }}>
<div style={{ marginBottom: 24 }}>
<h1 style={{ fontSize: 24, fontWeight: 800, color: ‘#fff’, margin: 0 }}>Launch a Token</h1>
<p style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>Create and launch your Solana token with a bonding curve. Powered by Raydium LaunchLab.</p>
</div>

```
  {/* Step indicators */}
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24 }}>
    {[1, 2, 3].map(function(s) {
      return (
        <React.Fragment key={s}>
          <StepIndicator step={s} current={step} />
          {s < 3 && <div style={{ flex: 1, height: 2, background: step > s ? C.green : C.muted2, borderRadius: 1 }} />}
        </React.Fragment>
      );
    })}
    <div style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>
      {step === 1 ? 'Token Info' : step === 2 ? 'Details' : step === 3 ? 'Review & Launch' : 'Launched!'}
    </div>
  </div>

  {/* Step 1: Basic Info */}
  {step === 1 && (
    <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 20 }}>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 700, marginBottom: 16 }}>TOKEN DETAILS</div>

      {/* Image upload */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div>
          <div style={{ width: 72, height: 72, borderRadius: 16, background: imagePreview ? 'transparent' : C.card2, border: '2px dashed ' + (imagePreview ? C.accent : C.border), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', position: 'relative' }}
            onClick={function() { document.getElementById('img-upload').click(); }}>
            {imagePreview
              ? <img src={imagePreview} alt="token" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ textAlign: 'center' }}><div style={{ fontSize: 20 }}>+</div><div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>IMAGE</div></div>}
          </div>
          <input id="img-upload" type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Or paste image URL</div>
          <input value={form.image} onChange={function(e) { set('image', e.target.value); if (e.target.value) setImagePreview(e.target.value); }} placeholder="https://..." style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 12px', color: C.text, fontSize: 12, outline: 'none', fontFamily: 'monospace' }} />
        </div>
      </div>

      {[
        { key: 'name', label: 'Token Name', placeholder: 'e.g. My Token', required: true },
        { key: 'symbol', label: 'Symbol (ticker)', placeholder: 'e.g. MTK', required: true },
      ].map(function(field) {
        return (
          <div key={field.key} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>{field.label}{field.required && <span style={{ color: C.red }}> *</span>}</div>
            <input value={form[field.key]} onChange={function(e) { set(field.key, field.key === 'symbol' ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') : e.target.value); }} placeholder={field.placeholder} style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'Syne, sans-serif' }} />
          </div>
        );
      })}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Total Supply <span style={{ color: C.red }}>*</span></div>
          <input value={form.supply} onChange={function(e) { set('supply', e.target.value.replace(/[^0-9]/g, '')); }} placeholder="1000000000" style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'Syne, sans-serif' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Decimals</div>
          <select value={form.decimals} onChange={function(e) { set('decimals', e.target.value); }} style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'Syne, sans-serif', appearance: 'none' }}>
            {[6, 9].map(function(d) { return <option key={d} value={d}>{d}</option>; })}
          </select>
        </div>
      </div>

      <button onClick={function() { if (step1Valid) setStep(2); }} disabled={!step1Valid} style={{ width: '100%', padding: 16, borderRadius: 12, border: 'none', background: step1Valid ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : C.card2, color: step1Valid ? C.bg : C.muted2, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: step1Valid ? 'pointer' : 'not-allowed' }}>
        Continue
      </button>
    </div>
  )}

  {/* Step 2: Description & Links */}
  {step === 2 && (
    <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 20 }}>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 700, marginBottom: 16 }}>PROJECT DETAILS <span style={{ color: C.muted2, fontWeight: 400 }}>(optional)</span></div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Description</div>
        <textarea value={form.description} onChange={function(e) { set('description', e.target.value); }} placeholder="Tell people about your token..." rows={3} style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', resize: 'vertical' }} />
      </div>

      {[
        { key: 'website', label: 'Website', placeholder: 'https://yoursite.com' },
        { key: 'twitter', label: 'Twitter / X', placeholder: 'https://x.com/yourhandle' },
      ].map(function(field) {
        return (
          <div key={field.key} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>{field.label}</div>
            <input value={form[field.key]} onChange={function(e) { set(field.key, e.target.value); }} placeholder={field.placeholder} style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif' }} />
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={function() { setStep(1); }} style={{ flex: 1, padding: 14, borderRadius: 12, border: '1px solid ' + C.border, background: 'transparent', color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Back</button>
        <button onClick={function() { setStep(3); }} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Continue</button>
      </div>
    </div>
  )}

  {/* Step 3: Review & Launch */}
  {step === 3 && (
    <div>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: C.muted, fontWeight: 700, marginBottom: 16 }}>REVIEW YOUR TOKEN</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          {(imagePreview || form.image)
            ? <img src={imagePreview || form.image} alt={form.symbol} style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} />
            : <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(0,229,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: C.accent, flexShrink: 0 }}>{form.symbol.charAt(0)}</div>}
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{form.name}</div>
            <div style={{ fontSize: 13, color: C.accent, marginTop: 2 }}>${form.symbol}</div>
          </div>
        </div>

        {[
          ['Total Supply', parseInt(form.supply).toLocaleString() + ' ' + form.symbol],
          ['Decimals', form.decimals],
          ['Network', 'Solana'],
          form.description ? ['Description', form.description] : null,
        ].filter(Boolean).map(function(item) {
          return (
            <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: 13 }}>
              <span style={{ color: C.muted }}>{item[0]}</span>
              <span style={{ color: C.text, maxWidth: '60%', textAlign: 'right', wordBreak: 'break-word' }}>{item[1]}</span>
            </div>
          );
        })}
      </div>

      {/* Fee breakdown */}
      <div style={{ background: '#050912', border: '1px solid ' + C.border, borderRadius: 14, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 10 }}>LAUNCH COST</div>
        {[
          ['Launch Fee', '0.5 SOL'],
          ['Token Creation', '~0.01 SOL'],
          ['Transaction Fees', '~0.001 SOL'],
          ['Trading Fee (per swap)', '1.5%'],
        ].map(function(item) {
          return (
            <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: C.muted }}>{item[0]}</span>
              <span style={{ color: item[0] === 'Launch Fee' ? C.accent : C.text }}>{item[1]}</span>
            </div>
          );
        })}
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(0,229,255,.06)', borderRadius: 8, fontSize: 11, color: C.muted }}>
          Powered by Raydium LaunchLab. Bonding curve active until graduation target is reached, then auto-migrates to Raydium AMM.
        </div>
      </div>

      {launchError && (
        <div style={{ marginBottom: 14, padding: 12, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, fontSize: 13, color: C.red }}>
          {launchError}
        </div>
      )}

      {launching && launchStatus && launchStatus !== 'success' && (
        <div style={{ marginBottom: 14, padding: 12, background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 10, fontSize: 13, color: C.accent }}>
          {launchStatus}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={function() { setStep(2); }} disabled={launching} style={{ flex: 1, padding: 14, borderRadius: 12, border: '1px solid ' + C.border, background: 'transparent', color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, cursor: launching ? 'not-allowed' : 'pointer' }}>Back</button>
        {isConnected ? (
          <button onClick={launchToken} disabled={launching} style={{ flex: 2, padding: 16, borderRadius: 12, border: 'none', background: launching ? C.card2 : 'linear-gradient(135deg,#00e5ff,#0055ff)', color: launching ? C.muted2 : C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: launching ? 'not-allowed' : 'pointer' }}>
            {launching ? launchStatus || 'Launching...' : 'Launch Token - 0.5 SOL'}
          </button>
        ) : (
          <button onClick={onConnectWallet} style={{ flex: 2, padding: 16, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
            Connect Wallet to Launch
          </button>
        )}
      </div>
    </div>
  )}

  {/* Step 4: Success */}
  {step === 4 && launchedToken && (
    <div style={{ background: C.card, border: '1px solid rgba(0,255,163,.2)', borderRadius: 18, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🚀</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.green, marginBottom: 8 }}>Token Launched!</div>
      <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>{launchedToken.name} (${launchedToken.symbol}) is live on Solana</div>

      <div style={{ background: C.card2, borderRadius: 12, padding: 14, marginBottom: 16, textAlign: 'left' }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 8 }}>TOKEN ADDRESS</div>
        <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all' }}>{launchedToken.mint}</div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <a href={'https://solscan.io/token/' + launchedToken.mint} target="_blank" rel="noreferrer" style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid rgba(0,229,255,.3)', background: 'transparent', color: C.accent, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13, cursor: 'pointer', textAlign: 'center', textDecoration: 'none' }}>View on Solscan</a>
        <button onClick={function() { setStep(1); setForm({ name: '', symbol: '', supply: '1000000000', decimals: '9', description: '', image: '', website: '', twitter: '' }); setImageFile(null); setImagePreview(''); setLaunchedToken(null); setLaunchStatus(''); setLaunchError(''); }} style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Launch Another</button>
      </div>
    </div>
  )}

  {/* Info cards */}
  {step < 4 && (
    <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {[
        { icon: '🔒', title: 'Liquidity Locked', desc: 'Pool liquidity is permanently locked after graduation' },
        { icon: '📈', title: 'Bonding Curve', desc: 'Price auto-increases as more people buy' },
        { icon: '🌊', title: 'Raydium AMM', desc: 'Graduates to Raydium when target is reached' },
        { icon: '💰', title: '1.5% Trading Fee', desc: 'Low fee keeps traders coming back' },
      ].map(function(item) {
        return (
          <div key={item.title} style={{ background: C.card2, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>{item.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 3 }}>{item.title}</div>
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{item.desc}</div>
          </div>
        );
      })}
    </div>
  )}
</div>
```

);
}