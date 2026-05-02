import React, { useState, useCallback } from ‘react’;
import { useWallet, useConnection } from ‘@solana/wallet-adapter-react’;
import { PublicKey, SystemProgram, Transaction, Keypair, LAMPORTS_PER_SOL } from ‘@solana/web3.js’;
// FIX 3: Static imports — these are already installed, no need for dynamic import()
import { Raydium, LAUNCHPAD_PROGRAM, getPdaLaunchpadConfigId, TxVersion } from ‘@raydium-io/raydium-sdk-v2’;
import { NATIVE_MINT } from ‘@solana/spl-token’;
import BN from ‘bn.js’;
 
// FIX 2: Removed unused LAUNCHPAD_PROGRAM_ID string constant — the SDK exports
// LAUNCHPAD_PROGRAM (a PublicKey) which is what all SDK calls actually use.
const SOL_FEE_WALLET = ‘47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5’;
const LAUNCH_FEE_SOL = 0.5;
const PLATFORM_ID = process.env.REACT_APP_PLATFORM_ID || null;

const C = {
bg: ‘#03060f’, card: ‘#080d1a’, card2: ‘#0c1220’, card3: ‘#111d30’,
border: ‘rgba(0,229,255,0.10)’, borderHi: ‘rgba(0,229,255,0.25)’,
accent: ‘#00e5ff’, green: ‘#00ffa3’, red: ‘#ff3b6b’,
text: ‘#cdd6f4’, muted: ‘#586994’, muted2: ‘#2e3f5e’,
};

function StepDot({ step, current }) {
var done = current > step;
var active = current === step;
return (
<div style={{ width: 28, height: 28, borderRadius: ‘50%’, display: ‘flex’, alignItems: ‘center’, justifyContent: ‘center’, fontSize: 11, fontWeight: 700, flexShrink: 0, background: done ? C.green : active ? C.accent : C.card2, color: done || active ? C.bg : C.muted, border: ’2px solid ’ + (done ? C.green : active ? C.accent : C.muted2) }}>
{done ? ‘v’ : step}
</div>
);
}

function Field({ label, children, required }) {
return (
<div style={{ marginBottom: 14 }}>
<div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>
{label}{required && <span style={{ color: C.red }}> *</span>}
</div>
{children}
</div>
);
}

function Input({ value, onChange, placeholder, mono }) {
return (
<input value={value} onChange={onChange} placeholder={placeholder}
style={{ width: ‘100%’, background: C.card2, border: ’1px solid ’ + C.border, borderRadius: 10, padding: ‘12px 14px’, color: ‘#fff’, fontSize: 13, outline: ‘none’, fontFamily: mono ? ‘monospace’ : ‘Syne, sans-serif’ }} />
);
}

async function uploadMetadata(name, symbol, description, imageUri) {
var metadata = { name, symbol, description: description || ‘’, image: imageUri || ‘’, showName: true };
try {
var res = await fetch(‘https://api.pinata.cloud/pinning/pinJSONToIPFS’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’, ‘Authorization’: ’Bearer ’ + (process.env.REACT_APP_PINATA_JWT || ‘’) },
body: JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: symbol + ‘-metadata.json’ } }),
});
if (res.ok) {
var data = await res.json();
return ‘https://ipfs.io/ipfs/’ + data.IpfsHash;
}
} catch (e) {}
// Fallback: data URI (set REACT_APP_PINATA_JWT for real IPFS storage)
return ‘data:application/json;base64,’ + btoa(JSON.stringify(metadata));
}

async function uploadImage(file) {
if (!file) return ‘’;
try {
var fd = new FormData();
fd.append(‘file’, file);
var res = await fetch(‘https://api.pinata.cloud/pinning/pinFileToIPFS’, {
method: ‘POST’,
headers: { ‘Authorization’: ’Bearer ’ + (process.env.REACT_APP_PINATA_JWT || ‘’) },
body: fd,
});
if (res.ok) {
var data = await res.json();
return ‘https://ipfs.io/ipfs/’ + data.IpfsHash;
}
} catch (e) {}
return ‘’;
}

export default function TokenLaunch({ isConnected, onConnectWallet }) {
const { publicKey, signTransaction, signAllTransactions } = useWallet();
const { connection } = useConnection();

const [step, setStep] = useState(1);
const [form, setForm] = useState({
name: ‘’, symbol: ‘’, description: ‘’, imageUrl: ‘’, website: ‘’, twitter: ‘’,
supply: ‘1000000000’, decimals: ‘6’,
});
const [imageFile, setImageFile] = useState(null);
const [imagePreview, setImagePreview] = useState(’’);
const [status, setStatus] = useState(’’);
const [error, setError] = useState(’’);
const [launching, setLaunching] = useState(false);
const [launched, setLaunched] = useState(null);

var set = function(k, v) { setForm(function(f) { return Object.assign({}, f, { [k]: v }); }); };

var handleImage = function(e) {
var file = e.target.files[0];
if (!file) return;
setImageFile(file);
var reader = new FileReader();
reader.onload = function(ev) { setImagePreview(ev.target.result); };
reader.readAsDataURL(file);
};

var step1Valid = form.name.trim() && form.symbol.trim() && parseInt(form.supply) >= 10000000;

var doLaunch = useCallback(async function() {
if (!publicKey || !signTransaction || !signAllTransactions) {
setError(‘Connect Solana wallet first’); return;
}


// FIX 1: Validate supply string before BN conversion
var supplyStr = form.supply.trim();
if (!supplyStr || isNaN(Number(supplyStr)) || Number(supplyStr) < 10000000) {
  setError('Supply must be at least 10,000,000');
  return;
}

setLaunching(true); setError(''); setStatus('');

try {
  setStatus('Checking balance...');
  var balance = await connection.getBalance(publicKey);
  if (balance < (LAUNCH_FEE_SOL + 0.05) * LAMPORTS_PER_SOL) {
    throw new Error('Need at least ' + (LAUNCH_FEE_SOL + 0.05) + ' SOL (launch fee + transaction costs)');
  }

  setStatus('Collecting launch fee (0.5 SOL)...');
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
  var signedFee = await signTransaction(feeTx);
  var feeSig = await connection.sendRawTransaction(signedFee.serialize());
  await connection.confirmTransaction({ signature: feeSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');

  setStatus('Uploading image...');
  var imageUri = form.imageUrl || '';
  if (imageFile) {
    var uploaded = await uploadImage(imageFile);
    if (uploaded) imageUri = uploaded;
  }

  setStatus('Uploading metadata...');
  var metadataUri = await uploadMetadata(form.name, form.symbol, form.description, imageUri);

  setStatus('Creating token on Raydium LaunchLab...');
  var raydium = await Raydium.load({
    connection,
    owner: publicKey,
    signAllTransactions,
    disableLoadToken: true,
  });

  var configId = getPdaLaunchpadConfigId(LAUNCHPAD_PROGRAM, NATIVE_MINT, 0, 0).publicKey;
  var mintKeypair = Keypair.generate();

  // FIX 1: Use BN(string) directly — avoids parseInt() precision cap at
  // Number.MAX_SAFE_INTEGER for very large supply values
  var supplyBN = new BN(supplyStr).mul(new BN(10).pow(new BN(parseInt(form.decimals))));

  var launchParams = {
    programId: LAUNCHPAD_PROGRAM,
    mintA: mintKeypair.publicKey,
    decimals: parseInt(form.decimals),
    name: form.name,
    symbol: form.symbol,
    uri: metadataUri,
    configId,
    migrateType: 'cpmm',
    txVersion: TxVersion.V0,
    createOnly: true,
    extraSigners: [mintKeypair],
    supply: supplyBN,
  };

  if (PLATFORM_ID) {
    launchParams.platformId = new PublicKey(PLATFORM_ID);
  }

  var { execute, extInfo } = await raydium.launchpad.createLaunchpad(launchParams);

  setStatus('Please confirm transaction(s) in your wallet...');
  var txids = await execute({ sendAndConfirm: true });

  var mintAddress = mintKeypair.publicKey.toBase58();
  var poolId = extInfo && extInfo.poolId ? extInfo.poolId.toBase58() : null;

  setLaunched({
    mint: mintAddress,
    poolId,
    name: form.name,
    symbol: form.symbol,
    image: imagePreview || imageUri,
    txid: Array.isArray(txids) ? txids[0] : txids,
  });

  setStep(4);
  setStatus('success');

} catch (e) {
  console.error('Launch error:', e);
  setError(e.message || 'Launch failed');
}
setLaunching(false);


}, [publicKey, signTransaction, signAllTransactions, connection, form, imageFile, imagePreview]);

var resetForm = function() {
setStep(1);
setForm({ name: ‘’, symbol: ‘’, description: ‘’, imageUrl: ‘’, website: ‘’, twitter: ‘’, supply: ‘1000000000’, decimals: ‘6’ });
setImageFile(null); setImagePreview(’’); setLaunched(null); setStatus(’’); setError(’’);
};

return (
<div style={{ maxWidth: 560, margin: ‘0 auto’, width: ‘100%’ }}>
<div style={{ marginBottom: 24 }}>
<h1 style={{ fontSize: 24, fontWeight: 800, color: ‘#fff’, margin: 0 }}>Launch a Token</h1>
<p style={{ color: C.muted, fontSize: 13, margin: ‘6px 0 0’ }}>Create your Solana token with a bonding curve. Powered by Raydium LaunchLab.</p>
</div>


  {step < 4 && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24 }}>
      {[1, 2, 3].map(function(s) {
        return (
          <React.Fragment key={s}>
            <StepDot step={s} current={step} />
            {s < 3 && <div style={{ flex: 1, height: 2, background: step > s ? C.green : C.muted2, borderRadius: 1 }} />}
          </React.Fragment>
        );
      })}
      <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>
        {step === 1 ? 'Token Info' : step === 2 ? 'Project Details' : 'Review & Launch'}
      </span>
    </div>
  )}

  {step === 1 && (
    <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 20 }}>
      <div style={{ fontSize: 12, color: C.muted, fontWeight: 700, marginBottom: 16, letterSpacing: .8 }}>TOKEN DETAILS</div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
        <div onClick={function() { document.getElementById('tok-img').click(); }}
          style={{ width: 72, height: 72, borderRadius: 16, background: imagePreview ? 'transparent' : C.card2, border: '2px dashed ' + (imagePreview ? C.accent : C.border), display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', flexShrink: 0 }}>
          {imagePreview ? <img src={imagePreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ textAlign: 'center', fontSize: 9, color: C.muted }}><div style={{ fontSize: 22 }}>+</div>IMAGE</div>}
        </div>
        <input id="tok-img" type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 5 }}>Or paste image URL</div>
          <Input value={form.imageUrl} onChange={function(e) { set('imageUrl', e.target.value); if (e.target.value) setImagePreview(e.target.value); }} placeholder="https://..." mono />
        </div>
      </div>
      <Field label="Token Name" required>
        <Input value={form.name} onChange={function(e) { set('name', e.target.value); }} placeholder="e.g. Moon Coin" />
      </Field>
      <Field label="Symbol (ticker)" required>
        <Input value={form.symbol} onChange={function(e) { set('symbol', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)); }} placeholder="e.g. MOON" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Total Supply" required>
          <Input value={form.supply} onChange={function(e) { set('supply', e.target.value.replace(/[^0-9]/g, '')); }} placeholder="1000000000" />
          <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Min: 10,000,000</div>
        </Field>
        <Field label="Decimals">
          <select value={form.decimals} onChange={function(e) { set('decimals', e.target.value); }}
            style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', appearance: 'none', cursor: 'pointer' }}>
            <option value="6">6</option>
            <option value="9">9</option>
          </select>
        </Field>
      </div>
      <button onClick={function() { if (step1Valid) setStep(2); }} disabled={!step1Valid}
        style={{ width: '100%', marginTop: 6, padding: 16, borderRadius: 12, border: 'none', background: step1Valid ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : C.card2, color: step1Valid ? C.bg : C.muted2, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: step1Valid ? 'pointer' : 'not-allowed' }}>
        Continue
      </button>
    </div>
  )}

  {step === 2 && (
    <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 20 }}>
      <div style={{ fontSize: 12, color: C.muted, fontWeight: 700, marginBottom: 16, letterSpacing: .8 }}>PROJECT DETAILS <span style={{ color: C.muted2, fontWeight: 400, fontSize: 11 }}>(optional)</span></div>
      <Field label="Description">
        <textarea value={form.description} onChange={function(e) { set('description', e.target.value); }} placeholder="Tell people about your token..." rows={3}
          style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', resize: 'vertical' }} />
      </Field>
      <Field label="Website">
        <Input value={form.website} onChange={function(e) { set('website', e.target.value); }} placeholder="https://yoursite.com" />
      </Field>
      <Field label="Twitter / X">
        <Input value={form.twitter} onChange={function(e) { set('twitter', e.target.value); }} placeholder="https://x.com/yourhandle" />
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={function() { setStep(1); }} style={{ flex: 1, padding: 14, borderRadius: 12, border: '1px solid ' + C.border, background: 'transparent', color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Back</button>
        <button onClick={function() { setStep(3); }} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Continue</button>
      </div>
    </div>
  )}

  {step === 3 && (
    <div>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 20, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 700, marginBottom: 16, letterSpacing: .8 }}>REVIEW YOUR TOKEN</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          {(imagePreview || form.imageUrl)
            ? <img src={imagePreview || form.imageUrl} alt="" style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} />
            : <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(0,229,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: C.accent, flexShrink: 0 }}>{form.symbol.charAt(0)}</div>}
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{form.name}</div>
            <div style={{ fontSize: 13, color: C.accent }}>${form.symbol}</div>
          </div>
        </div>
        {[
          ['Total Supply', parseInt(form.supply).toLocaleString() + ' ' + form.symbol],
          ['Decimals', form.decimals],
          ['Blockchain', 'Solana'],
          ['Bonding Curve', 'Constant Product (LaunchLab)'],
          ['Graduation Target', '85 SOL'],
          ['After Graduation', 'Raydium CPMM Pool'],
          form.description ? ['Description', form.description.slice(0, 80) + (form.description.length > 80 ? '...' : '')] : null,
        ].filter(Boolean).map(function(item) {
          return (
            <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: 12 }}>
              <span style={{ color: C.muted }}>{item[0]}</span>
              <span style={{ color: C.text, maxWidth: '55%', textAlign: 'right', wordBreak: 'break-word' }}>{item[1]}</span>
            </div>
          );
        })}
      </div>

      <div style={{ background: '#050912', border: '1px solid ' + C.border, borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 10, letterSpacing: .8 }}>COST BREAKDOWN</div>
        {[
          ['Launch Fee', '0.5 SOL', true],
          ['Transaction Costs', '~0.01 SOL', false],
          ['Trading Fee (per swap)', '1.5%', false],
          ['Protocol Fee', '0.25%', false],
        ].map(function(item) {
          return (
            <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: C.muted }}>{item[0]}</span>
              <span style={{ color: item[2] ? C.accent : C.text }}>{item[1]}</span>
            </div>
          );
        })}
        {/* FIX 5: Visible warning if Pinata JWT is missing */}
        {!process.env.REACT_APP_PINATA_JWT && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,59,107,.06)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 8, fontSize: 11, color: C.red }}>
            REACT_APP_PINATA_JWT not set — token image will not be stored on IPFS
          </div>
        )}
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(0,229,255,.05)', borderRadius: 8, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
          Token launches on a bonding curve. Price rises as people buy. At 85 SOL raised, liquidity auto-migrates to Raydium permanently.
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 12, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, fontSize: 12, color: C.red }}>{error}</div>
      )}
      {launching && status && (
        <div style={{ marginBottom: 12, padding: 12, background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 10, fontSize: 12, color: C.accent }}>{status}</div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={function() { setStep(2); }} disabled={launching}
          style={{ flex: 1, padding: 14, borderRadius: 12, border: '1px solid ' + C.border, background: 'transparent', color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, cursor: launching ? 'not-allowed' : 'pointer' }}>Back</button>
        {isConnected ? (
          <button onClick={doLaunch} disabled={launching}
            style={{ flex: 2, padding: 16, borderRadius: 12, border: 'none', background: launching ? C.card2 : 'linear-gradient(135deg,#00e5ff,#0055ff)', color: launching ? C.muted2 : C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: launching ? 'not-allowed' : 'pointer' }}>
            {launching ? (status || 'Launching...') : 'Launch Token - 0.5 SOL'}
          </button>
        ) : (
          <button onClick={onConnectWallet}
            style={{ flex: 2, padding: 16, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
            Connect Wallet to Launch
          </button>
        )}
      </div>
    </div>
  )}

  {step === 4 && launched && (
    <div style={{ background: C.card, border: '1px solid rgba(0,255,163,.25)', borderRadius: 18, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 52, marginBottom: 10 }}>🚀</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.green, marginBottom: 6 }}>Token Launched!</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>{launched.name} (${launched.symbol}) is live on Raydium LaunchLab</div>
      <div style={{ background: C.card2, borderRadius: 12, padding: 14, marginBottom: 12, textAlign: 'left' }}>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: .8 }}>MINT ADDRESS</div>
        <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all' }}>{launched.mint}</div>
      </div>
      {launched.poolId && (
        <div style={{ background: C.card2, borderRadius: 12, padding: 14, marginBottom: 12, textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: .8 }}>LAUNCHLAB POOL ID</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all' }}>{launched.poolId}</div>
        </div>
      )}
      <div style={{ padding: '10px 14px', background: 'rgba(0,255,163,.06)', border: '1px solid rgba(0,255,163,.15)', borderRadius: 10, fontSize: 12, color: C.green, marginBottom: 16 }}>
        Bonding curve is now active. Liquidity auto-migrates to Raydium at 85 SOL raised.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <a href={'https://solscan.io/token/' + launched.mint} target="_blank" rel="noreferrer"
          style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid rgba(0,229,255,.3)', background: 'transparent', color: C.accent, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Solscan</a>
        <a href={'https://raydium.io/launchpad/token/?mint=' + launched.mint} target="_blank" rel="noreferrer"
          style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid rgba(0,229,255,.3)', background: 'transparent', color: C.accent, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Raydium</a>
        <button onClick={resetForm}
          style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>New Token</button>
      </div>
    </div>
  )}

  {step < 4 && (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20 }}>
      {[
        { icon: '📈', title: 'Bonding Curve', desc: 'Price rises automatically as people buy. No manual liquidity needed.' },
        { icon: '🔒', title: 'Locked Liquidity', desc: 'At 85 SOL raised, liquidity locks in Raydium CPMM forever.' },
        { icon: '🌊', title: 'Raydium AMM', desc: 'Your token auto-graduates to the largest Solana DEX.' },
        { icon: '💸', title: '1.5% Fee Per Swap', desc: 'Low trading fee keeps your community active.' },
      ].map(function(item) {
        return (
          <div key={item.title} style={{ background: C.card2, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{item.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>{item.title}</div>
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{item.desc}</div>
          </div>
        );
      })}
    </div>
  )}
</div>

);
}