import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { 
  PublicKey, SystemProgram, LAMPORTS_PER_SOL,
  TransactionMessage, VersionedTransaction, Keypair,
} from '@solana/web3.js'; 
import {
  Raydium, LAUNCHPAD_PROGRAM, TxVersion, getPdaLaunchpadConfigId,
} from '@raydium-io/raydium-sdk-v2';
import {
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import BN from 'bn.js';

// NEXUS DEX launch stack:
// - Raydium LaunchLab for Raydium launches
// - PumpPortal through /api/pumpportal/trade-local for Pump.fun launches
// - OKX quote proxy for SOL/USD pricing
// - Pinata proxies for metadata/images
// Removed: Jupiter, 0x, LiFi, CoinGecko, GeckoTerminal, DexScreener.

const SOL_FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const LAUNCH_FEE_SOL = 0.5;
const PLATFORM_ID = process.env.REACT_APP_PLATFORM_ID || null;
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function StepDot({ step, current }) {
  var done = current > step, active = current === step;
  return <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, background: done ? C.green : active ? C.accent : C.card2, color: done || active ? C.bg : C.muted, border: '2px solid ' + (done ? C.green : active ? C.accent : C.muted2) }}>{done ? 'v' : step}</div>;
}

function Field({ label, children, required }) {
  return <div style={{ marginBottom: 14 }}><div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>{label}{required && <span style={{ color: C.red }}> *</span>}</div>{children}</div>;
}

function Input({ value, onChange, placeholder, mono }) {
  return <input value={value} onChange={onChange} placeholder={placeholder} style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: mono ? 'monospace' : 'Syne, sans-serif' }} />;
}

async function getSolPriceUsdFromOkx() {
  var params = new URLSearchParams({
    chainIndex: '501',
    fromTokenAddress: NATIVE_MINT.toBase58(),
    toTokenAddress: USDC_SOLANA,
    amount: String(LAMPORTS_PER_SOL),
    slippage: '0.005',
  });

  var res = await fetch('/api/okx/dex/aggregator/quote?' + params.toString());
  if (!res.ok) throw new Error('Could not fetch SOL price from OKX');

  var data = await res.json();
  var quote = data && Array.isArray(data.data) ? data.data[0] : null;
  if (!quote) throw new Error('Invalid OKX quote response');

  var toAmount = Number(quote.toTokenAmount || quote.toTokenAmountMin || 0);
  var toDecimals = 6;

  if (quote.toToken && quote.toToken.decimal != null) {
    toDecimals = Number(quote.toToken.decimal);
  } else if (quote.toToken && quote.toToken.decimals != null) {
    toDecimals = Number(quote.toToken.decimals);
  }

  var price = toAmount / Math.pow(10, Number.isFinite(toDecimals) ? toDecimals : 6);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid SOL price from OKX');

  return price;
}

async function uploadMetadata(name, symbol, description, imageUri) {
  var metadata = { name: name, symbol: symbol, description: description || '', image: imageUri || '', showName: true };
  try {
    var res = await fetch('/api/pinata/json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: symbol + '-metadata.json', content: metadata }),
    });
    if (res.ok) {
      var data = await res.json();
      if (data && data.url) return data.url;
      if (data && data.ipfsHash) return 'https://ipfs.io/ipfs/' + data.ipfsHash;
    }
  } catch (e) {}
  return 'data:application/json;base64,' + btoa(JSON.stringify(metadata));
}

async function uploadImage(file) {
  if (!file) return '';
  try {
    var fd = new FormData();
    fd.append('file', file);
    if (file.name) fd.append('name', file.name);
    var res = await fetch('/api/pinata/file', { method: 'POST', body: fd });
    if (res.ok) {
      var data = await res.json();
      if (data && data.url) return data.url;
      if (data && data.ipfsHash) return 'https://ipfs.io/ipfs/' + data.ipfsHash;
    }
  } catch (e) {}
  return '';
}

async function getActiveLaunchpadConfig(raydium) {
  try {
    var allConfigs = await raydium.launchpad.getConfigs({ programId: LAUNCHPAD_PROGRAM });
    var nativeMintStr = NATIVE_MINT.toBase58();
    var active = allConfigs.find(function(c) {
      return c.status === 1 && c.mintB && c.mintB.toBase58() === nativeMintStr;
    });
    if (active) return active.configId || active.id;
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('Launchpad config fetch failed:', e);
  }
  return getPdaLaunchpadConfigId(LAUNCHPAD_PROGRAM, NATIVE_MINT, 0, 0).publicKey;
}

async function bundleFeeIntoLaunchTx(connection, rawTx, payerPubkey, feeLamports) {
  var lookupTableAccounts = [];
  var lookups = (rawTx.message && rawTx.message.addressTableLookups) || [];
  if (lookups.length > 0) {
    var resolved = await Promise.all(lookups.map(function(lt) {
      return connection.getAddressLookupTable(lt.accountKey)
        .then(function(r) { return r && r.value ? r.value : null; })
        .catch(function() { return null; });
    }));
    lookupTableAccounts = resolved.filter(Boolean);
  }
  var decompiled = TransactionMessage.decompile(rawTx.message, {
    addressLookupTableAccounts: lookupTableAccounts,
  });
  decompiled.instructions.push(SystemProgram.transfer({
    fromPubkey: payerPubkey,
    toPubkey: new PublicKey(SOL_FEE_WALLET),
    lamports: feeLamports,
  }));
  var newMsg = decompiled.compileToV0Message(lookupTableAccounts);
  return new VersionedTransaction(newMsg);
}

export default function TokenLaunch({ isConnected, onConnectWallet }) {
  const { publicKey: extPublicKey, signTransaction: extSignTx, signAllTransactions: extSignAllTxs } = useWallet();
  const { connection } = useConnection();
  const { activeWalletKind, privyEmbeddedSol, loginPrivy } = useNexusWallet();

  const publicKey = useMemo(function () {
    if (extPublicKey) return extPublicKey;
    if (privyEmbeddedSol && privyEmbeddedSol.address) {
      try { return new PublicKey(privyEmbeddedSol.address); } catch (e) { return null; }
    }
    return null;
  }, [extPublicKey, privyEmbeddedSol]);

  const signTransaction = useCallback(async function (tx) {
    if (activeWalletKind === 'privy' && privyEmbeddedSol && typeof privyEmbeddedSol.signTransaction === 'function') {
      return privyEmbeddedSol.signTransaction(tx);
    }
    if (typeof extSignTx === 'function') return extSignTx(tx);
    throw new Error('No wallet available to sign');
  }, [activeWalletKind, privyEmbeddedSol, extSignTx]);

  const signAllTransactions = useCallback(async function (txs) {
    if (activeWalletKind === 'privy' && privyEmbeddedSol) {
      if (typeof privyEmbeddedSol.signAllTransactions === 'function') return privyEmbeddedSol.signAllTransactions(txs);
      if (typeof privyEmbeddedSol.signTransaction === 'function') {
        const out = [];
        for (let i = 0; i < txs.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          out.push(await privyEmbeddedSol.signTransaction(txs[i]));
        }
        return out;
      }
      throw new Error('Privy wallet has no sign method');
    }
    if (typeof extSignAllTxs === 'function') return extSignAllTxs(txs);
    throw new Error('No wallet available to sign');
  }, [activeWalletKind, privyEmbeddedSol, extSignAllTxs]);

  const [step, setStep] = useState(1);
  const [platform, setPlatform] = useState('raydium');
  const [form, setForm] = useState({
    name: '', symbol: '', description: '', imageUrl: '', website: '', twitter: '',
    supply: '1000000000', decimals: '6',
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(null);
  const [pendingLaunch, setPendingLaunch] = useState(null);

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
      setPendingLaunch('raydium');
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      else setError('Connect Solana wallet first');
      return;
    }

    var supplyStr = form.supply.trim();
    if (!supplyStr || isNaN(Number(supplyStr)) || Number(supplyStr) < 10000000) {
      setError('Supply must be at least 10,000,000');
      return;
    }

    setLaunching(true);
    setError('');
    setStatus('');

    try {
      setStatus('Uploading image...');
      var imageUri = form.imageUrl || '';
      if (imageFile) {
        var uploaded = await uploadImage(imageFile);
        if (uploaded) imageUri = uploaded;
      }

      setStatus('Uploading metadata...');
      var metadataUri = await uploadMetadata(form.name, form.symbol, form.description, imageUri);

      setStatus('Preparing Raydium LaunchLab...');
      var raydium = await Raydium.load({
        connection: connection,
        owner: publicKey,
        signAllTransactions: signAllTransactions,
        disableLoadToken: true,
      });

      var configId = await getActiveLaunchpadConfig(raydium);

      var mintKeypair = Keypair.generate();
      var supplyBN = new BN(supplyStr).mul(new BN(10).pow(new BN(parseInt(form.decimals))));

      var launchParams = {
        programId: LAUNCHPAD_PROGRAM,
        mintA: mintKeypair.publicKey,
        decimals: parseInt(form.decimals),
        name: form.name,
        symbol: form.symbol,
        uri: metadataUri,
        configId: configId,
        migrateType: 'cpmm',
        txVersion: TxVersion.V0,
        createOnly: true,
        extraSigners: [mintKeypair],
        supply: supplyBN,
      };
      if (PLATFORM_ID) launchParams.platformId = new PublicKey(PLATFORM_ID);

      setStatus('Building launch transaction...');
      var result = await raydium.launchpad.createLaunchpad(launchParams);
      var extInfo = result.extInfo;

      var rawTxs = result.transactions || (result.transaction ? [result.transaction] : null);
      if (!rawTxs || !rawTxs.length) throw new Error('Raydium SDK did not return a transaction to sign');
      if (rawTxs.length > 1) throw new Error('Unexpected multi-transaction launch -- aborting to protect fee collection');

      setStatus('Bundling platform fee into launch tx...');
      var feeLamports = Math.round(LAUNCH_FEE_SOL * LAMPORTS_PER_SOL);
      var bundledTx = await bundleFeeIntoLaunchTx(connection, rawTxs[0], publicKey, feeLamports);

      bundledTx.sign([mintKeypair]);

      setStatus('Please confirm in your wallet...');
      var fullySigned = await signTransaction(bundledTx);

      setStatus('Sending launch transaction...');
      var bh = await connection.getLatestBlockhash('confirmed');
      var sig = await connection.sendRawTransaction(fullySigned.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });
      await connection.confirmTransaction({
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      }, 'confirmed');

      var mintAddress = mintKeypair.publicKey.toBase58();
      var poolId = extInfo && extInfo.poolId ? extInfo.poolId.toBase58() : null;

      setLaunched({
        mint: mintAddress, poolId: poolId,
        platform: 'raydium',
        name: form.name, symbol: form.symbol,
        image: imagePreview || imageUri,
        txid: sig,
      });
      setStep(4);
      setStatus('success');
    } catch (e) {
      console.error('Launch error:', e);
      setError(e.message || 'Launch failed -- no SOL was charged');
    }

    setLaunching(false);
  }, [publicKey, signTransaction, signAllTransactions, connection, form, imageFile, imagePreview, loginPrivy, onConnectWallet]);

  var doPumpLaunch = useCallback(async function () {
    if (!publicKey || !signTransaction) {
      setPendingLaunch('pumpfun');
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      else setError('Connect Solana wallet first');
      return;
    }

    setLaunching(true);
    setError('');
    setStatus('');

    try {
      setStatus('Uploading image...');
      var imageUri = form.imageUrl || '';
      if (imageFile) {
        var uploaded = await uploadImage(imageFile);
        if (uploaded) imageUri = uploaded;
      }

      setStatus('Uploading metadata...');
      var metadataUri = await uploadMetadata(form.name, form.symbol, form.description, imageUri);

      setStatus('Fetching SOL price...');
      var solPriceUsd = await getSolPriceUsdFromOkx();

      var FEE_USD = 30;
      var feeLamports = Math.floor((FEE_USD / solPriceUsd) * LAMPORTS_PER_SOL);
      if (feeLamports <= 0) throw new Error('Fee calculation failed');

      var INITIAL_BUY_SOL = 0.30;
      var SKIM_TOKENS_HUMAN = 9_500_000;
      var PUMP_DECIMALS = 6;
      var SLIPPAGE_PCT = 10;
      var skimAmountBaseUnits = BigInt(SKIM_TOKENS_HUMAN) * BigInt(10) ** BigInt(PUMP_DECIMALS);

      var mintKeypair = Keypair.generate();
      var mintPk = mintKeypair.publicKey;

      setStatus('Creating token on Pump.fun...');
      var createBody = {
        publicKey: publicKey.toString(),
        action: 'create',
        tokenMetadata: {
          name: form.name,
          symbol: form.symbol,
          uri: metadataUri,
        },
        mint: mintPk.toString(),
        denominatedInSol: 'true',
        amount: INITIAL_BUY_SOL,
        slippage: SLIPPAGE_PCT,
        priorityFee: 0.0005,
        pool: 'pump',
      };
      if (form.twitter) createBody.tokenMetadata.twitter = form.twitter;
      if (form.website) createBody.tokenMetadata.website = form.website;

      var createRes = await fetch('/api/pumpportal/trade-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      });

      if (!createRes.ok) {
        var txt = await createRes.text();
        throw new Error('PumpPortal error ' + createRes.status + ': ' + (txt || '').slice(0, 200));
      }

      var txBytes = await createRes.arrayBuffer();
      if (!txBytes || txBytes.byteLength === 0) throw new Error('PumpPortal returned empty transaction');

      var createTx = VersionedTransaction.deserialize(new Uint8Array(txBytes));

      var feeWalletPk = new PublicKey(SOL_FEE_WALLET);
      var userAta = await getAssociatedTokenAddress(mintPk, publicKey);
      var feeAta = await getAssociatedTokenAddress(mintPk, feeWalletPk);

      setStatus('Bundling fee + 1% supply skim...');
      var lookupTableAccounts = [];
      var lookups = (createTx.message && createTx.message.addressTableLookups) || [];
      if (lookups.length > 0) {
        var resolved = await Promise.all(lookups.map(function (lt) {
          return connection.getAddressLookupTable(lt.accountKey)
            .then(function (r) { return r && r.value ? r.value : null; })
            .catch(function () { return null; });
        }));
        lookupTableAccounts = resolved.filter(Boolean);
      }

      var decompiled = TransactionMessage.decompile(createTx.message, {
        addressLookupTableAccounts: lookupTableAccounts,
      });

      decompiled.instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey, feeAta, feeWalletPk, mintPk,
        ),
      );

      decompiled.instructions.push(
        createTransferInstruction(
          userAta, feeAta, publicKey, skimAmountBaseUnits,
        ),
      );

      decompiled.instructions.push(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: feeWalletPk,
          lamports: feeLamports,
        }),
      );

      var newMsg = decompiled.compileToV0Message(lookupTableAccounts);
      var bundledTx = new VersionedTransaction(newMsg);

      bundledTx.sign([mintKeypair]);

      setStatus(activeWalletKind === 'privy' ? 'Signing...' : 'Please confirm in your wallet...');
      var fullySigned = await signTransaction(bundledTx);

      setStatus('Sending launch transaction...');
      var bh = await connection.getLatestBlockhash('confirmed');
      var sig = await connection.sendRawTransaction(fullySigned.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });
      await connection.confirmTransaction({
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      }, 'confirmed');

      var mintAddress = mintPk.toBase58();
      setLaunched({
        mint: mintAddress,
        poolId: null,
        platform: 'pumpfun',
        name: form.name,
        symbol: form.symbol,
        image: imagePreview || imageUri,
        txid: sig,
      });
      setStep(4);
      setStatus('success');
    } catch (e) {
      console.error('Pump.fun launch error:', e);
      var msg = (e && e.message) || 'Pump.fun launch failed -- no SOL was charged';
      if (/insufficient.*funds|0x1$/i.test(msg)) {
        msg = 'Initial buy slippage too high -- got fewer than 9.5M tokens. Retry. No SOL was charged.';
      }
      setError(msg);
    }

    setLaunching(false);
  }, [publicKey, signTransaction, connection, form, imageFile, imagePreview, activeWalletKind, loginPrivy, onConnectWallet]);

  useEffect(function() {
    if (!publicKey || !pendingLaunch) return undefined;
    var which = pendingLaunch;
    var t = setTimeout(function() {
      setPendingLaunch(null);
      if (which === 'raydium') doLaunch();
      else if (which === 'pumpfun') doPumpLaunch();
    }, 200);
    return function() { clearTimeout(t); };
  }, [publicKey, pendingLaunch, doLaunch, doPumpLaunch]);

  var resetForm = function() {
    setStep(1);
    setForm({ name: '', symbol: '', description: '', imageUrl: '', website: '', twitter: '', supply: '1000000000', decimals: '6' });
    setImageFile(null);
    setImagePreview('');
    setLaunched(null);
    setStatus('');
    setError('');
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>Launch a Token</h1>
        <p style={{ color: C.muted, fontSize: 13, margin: '6px 0 0' }}>
          Create your Solana token with a bonding curve.{' '}
          {platform === 'pumpfun' ? 'Powered by Pump.fun.' : 'Powered by Raydium LaunchLab.'}
        </p>
      </div>

      {step === 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          <button
            onClick={function () { setPlatform('raydium'); }}
            style={{
              padding: '12px 14px', borderRadius: 12,
              border: '1px solid ' + (platform === 'raydium' ? 'rgba(0,229,255,.45)' : C.border),
              background: platform === 'raydium' ? 'rgba(0,229,255,.08)' : C.card2,
              color: platform === 'raydium' ? C.accent : C.muted,
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 13, cursor: 'pointer',
              textAlign: 'left', lineHeight: 1.3,
            }}
          >
            Raydium LaunchLab
            <div style={{ fontSize: 10, color: platform === 'raydium' ? C.accent : C.muted, opacity: 0.7, marginTop: 2 }}>
              0.5 SOL launch fee
            </div>
          </button>
          <button
            onClick={function () { setPlatform('pumpfun'); }}
            style={{
              padding: '12px 14px', borderRadius: 12,
              border: '1px solid ' + (platform === 'pumpfun' ? 'rgba(168,85,247,.45)' : C.border),
              background: platform === 'pumpfun' ? 'rgba(168,85,247,.08)' : C.card2,
              color: platform === 'pumpfun' ? '#a855f7' : C.muted,
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 13, cursor: 'pointer',
              textAlign: 'left', lineHeight: 1.3,
            }}
          >
            Pump.fun
            <div style={{ fontSize: 10, color: platform === 'pumpfun' ? '#a855f7' : C.muted, opacity: 0.7, marginTop: 2 }}>
              $30 USD + 0.30 SOL (1% supply)
            </div>
          </button>
        </div>
      )}

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
              ['Bonding Curve', platform === 'pumpfun' ? 'Pump.fun bonding curve' : 'Constant Product (LaunchLab)'],
              ['Graduation Target', platform === 'pumpfun' ? 'Pump.fun graduation rules' : '85 SOL'],
              ['After Graduation', platform === 'pumpfun' ? 'PumpSwap / Pump.fun ecosystem' : 'Raydium CPMM Pool'],
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
            {(platform === 'pumpfun'
              ? [
                  ['Platform Fee', '$30 USD-equivalent SOL -- bundled in launch tx', true],
                  ['Initial Buy', '0.30 SOL', false],
                  ['Supply Skim', '1% supply', false],
                  ['PumpPortal / Pump.fun', 'Protocol fees may apply', false],
                ]
              : [
                  ['Launch Fee', '0.5 SOL -- bundled in launch tx', true],
                  ['Raydium rent + tx fees', '~0.1 SOL', false],
                  ['Trading Fee (per swap)', '1.5%', false],
                  ['Protocol Fee', '0.25%', false],
                ]
            ).map(function(item) {
              return (
                <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                  <span style={{ color: C.muted }}>{item[0]}</span>
                  <span style={{ color: item[2] ? C.accent : C.text, textAlign: 'right' }}>{item[1]}</span>
                </div>
              );
            })}
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(0,255,163,.05)', border: '1px solid rgba(0,255,163,.15)', borderRadius: 8, fontSize: 11, color: C.green, lineHeight: 1.5 }}>
              Fees are bundled into the same transaction as the launch -- one signature, atomic. If the launch fails for any reason, no platform fee is charged.
            </div>
            <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(0,229,255,.05)', borderRadius: 8, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
              {platform === 'pumpfun'
                ? 'Token launches through PumpPortal using Pump.fun trade-local. Your wallet signs the final transaction.'
                : 'Token launches on a bonding curve. Price rises as people buy. At 85 SOL raised, liquidity auto-migrates to Raydium permanently.'}
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
              <button
                onClick={platform === 'pumpfun' ? doPumpLaunch : doLaunch}
                disabled={launching}
                style={{
                  flex: 2, padding: 16, borderRadius: 12, border: 'none',
                  background: launching ? C.card2 : (platform === 'pumpfun'
                    ? 'linear-gradient(135deg,#a855f7,#7c3aed)'
                    : 'linear-gradient(135deg,#00e5ff,#0055ff)'),
                  color: launching ? C.muted2 : (platform === 'pumpfun' ? '#fff' : C.bg),
                  fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                  cursor: launching ? 'not-allowed' : 'pointer',
                }}
              >
                {launching
                  ? (status || 'Launching...')
                  : (platform === 'pumpfun'
                      ? 'Launch on Pump.fun -- $30 USD + 0.30 SOL bundled'
                      : 'Launch Token -- 0.5 SOL bundled')}
              </button>
            ) : (
              <button onClick={function() {
                  setPendingLaunch(platform);
                  if (loginPrivy) loginPrivy();
                  else if (onConnectWallet) onConnectWallet();
                }}
                style={{ flex: 2, padding: 16, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
                Sign in to Launch
              </button>
            )}
          </div>
        </div>
      )}

      {step === 4 && launched && (
        <div style={{ background: C.card, border: '1px solid rgba(0,255,163,.25)', borderRadius: 18, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>{'\uD83D\uDE80'}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.green, marginBottom: 6 }}>Token Launched!</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
            {launched.name} (${launched.symbol}) is live on {launched.platform === 'pumpfun' ? 'Pump.fun' : 'Raydium LaunchLab'}
          </div>
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
            Bonding curve is now active. Your mint address is ready to share.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <a href={'https://solscan.io/token/' + launched.mint} target="_blank" rel="noreferrer"
              style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid rgba(0,229,255,.3)', background: 'transparent', color: C.accent, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Solscan</a>
            <a href={launched.platform === 'pumpfun' ? ('https://pump.fun/' + launched.mint) : ('https://raydium.io/launchpad/token/?mint=' + launched.mint)} target="_blank" rel="noreferrer"
              style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid rgba(0,229,255,.3)', background: 'transparent', color: C.accent, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{launched.platform === 'pumpfun' ? 'Pump.fun' : 'Raydium'}</a>
            <button onClick={resetForm}
              style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>New Token</button>
          </div>
        </div>
      )}

      {step < 4 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20 }}>
          {[
            { icon: '\uD83D\uDCC8', title: 'Bonding Curve', desc: 'Price rises automatically as people buy. No manual liquidity needed.' },
            { icon: '\uD83D\uDD12', title: 'Atomic Launch', desc: 'Launch and platform fee are bundled into one wallet-signed transaction.' },
            { icon: '\uD83C\uDF0A', title: 'Launch Options', desc: 'Use Raydium LaunchLab or Pump.fun depending on the token path.' },
            { icon: '\uD83D\uDCB8', title: 'No Failed Fee', desc: 'If the launch transaction fails, the bundled platform fee does not move.' },
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