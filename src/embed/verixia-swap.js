/* =====================================================================
 * VERIXIA SWAP — pure vanilla browser bundle. NO BUILD STEP.
 *
 * Drop at:  public/embed/verixia-swap.js
 * Ships as: https://swap.verixiaapps.com/embed/verixia-swap.js
 *
 * Faithful vanilla port of the main site's flow:
 *   • SwapWidget.jsx      → atomic Jupiter swap (3% fee, single tx)
 *   • WalletModal         → Phantom + WalletConnect picker
 *   • TermsGate           → scroll-to-accept bottom sheet
 *   • screenAddress       → Chainalysis sanctions screening, 24h cache
 *
 * SEO page must have:
 *   <div id="verixia-swap-root">…skeleton…</div>
 *   <button class="connect">Connect</button>
 *   <script src="/embed/config.js"></script>
 *   <script src="/embed/verixia-swap.js" defer></script>
 * ===================================================================== */
(function () {
  'use strict';

  /* ─── Diagnostic boot banner ─────────────────────────────────────── */
  function paintMsg(msg, color) {
    var el = document.getElementById('verixia-swap-root');
    if (!el) return;
    el.innerHTML =
      '<div style="padding:24px;color:' + color + ';font-family:monospace;' +
      'font-size:12px;line-height:1.5;background:rgba(0,0,0,0.4);' +
      'border:1px solid ' + color + ';border-radius:14px;text-align:center;' +
      'white-space:pre-wrap;word-break:break-word;">' + msg + '</div>';
  }
  function showError(where, err) {
    var msg = (err && (err.stack || err.message)) || String(err);
    paintMsg('VERIXIA SWAP ERROR — ' + where + '\n\n' + msg, '#ff5d7d');
    console.error('[verixia-swap]', where, err);
  }
  function bootBanner() {
    paintMsg('VERIXIA EMBED v4 — loading dependencies…', '#00b8d4');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootBanner);
  else bootBanner();
  window.addEventListener('error', function (e) {
    if (e && e.error && !window.__verixiaReady) showError('window.error', e.error);
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (!window.__verixiaReady) showError('unhandled-rejection', e.reason || e);
  });

  /* ─── Inject the few global rules WalletModal/TermsGate need ────── */
  (function injectKitStyles() {
    if (document.getElementById('verixia-kit-styles')) return;
    var el = document.createElement('style');
    el.id = 'verixia-kit-styles';
    el.textContent =
      '@keyframes wc-spin{to{transform:rotate(360deg)}}' +
      '.nexus-scroll-locked{overflow:hidden !important}' +
      '.scroll-contain{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}';
    document.head.appendChild(el);
  })();

  /* ─── Runtime config ─────────────────────────────────────────────── */
  var CFG = window.__VERIXIA_CONFIG__ || {};
  var RPC_URL = CFG.rpc || 'https://api.mainnet-beta.solana.com';
  var WC_PROJECT_ID = CFG.wcProjectId || '';

  var FEE_WALLET   = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
  var FEE_BPS      = 300;
  var SLIPPAGE_BPS = 500;
  var PRIORITY_FEE = 50000;
  var SOL_MINT     = 'So11111111111111111111111111111111111111112';
  var USDC_MINT    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  var TERMS_KEY    = 'nexus_terms_accepted_v3';
  var SANCTIONS_URL = 'https://public.chainalysis.com/api/v1/address/';
  var SANCTIONS_PFX = 'nx_sanctions_';
  var SANCTIONS_TTL = 24 * 60 * 60 * 1000;
  var SANCTIONS_TIMEOUT = 5000;

  main().catch(function (e) { showError('boot', e); });

  async function main() {
    /* ─── Load Solana libs ─────────────────────────────────────── */
    var web3, splToken, BufferMod;
    try {
      paintMsg('VERIXIA EMBED — loading Solana libs…', '#00b8d4');
      [web3, splToken, BufferMod] = await Promise.all([
        import('https://esm.sh/@solana/[email protected]?bundle'),
        import('https://esm.sh/@solana/[email protected]?bundle&deps=@solana/[email protected]'),
        import('https://esm.sh/buffer@6'),
      ]);
    } catch (e) { showError('lib-load', e); return; }

    var Buffer = BufferMod.Buffer;
    window.Buffer = window.Buffer || Buffer;

    var Connection           = web3.Connection;
    var PublicKey            = web3.PublicKey;
    var VersionedTransaction = web3.VersionedTransaction;
    var TransactionMessage   = web3.TransactionMessage;
    var SystemProgram        = web3.SystemProgram;
    var ALT                  = web3.AddressLookupTableAccount;
    var TOKEN_PROGRAM        = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    var TOKEN_2022           = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    var connection = new Connection(RPC_URL, 'confirmed');
    var FEE_PK     = new PublicKey(FEE_WALLET);

    /* ─── State ────────────────────────────────────────────────── */
    var S = {
      walletPublicKey: null,
      walletProvider:  null,          // Phantom-style provider
      walletConnectSession: null,     // WalletConnect session if used
      walletKind:      null,          // 'phantom' | 'walletconnect'
      tokens:          [],
      tokensLoading:   true,
      inputMint:       SOL_MINT,
      outputMint:      USDC_MINT,
      amount:          '',
      quote:           null,
      quoting:         false,
      quoteError:      null,
      swapping:        false,
      swapError:       null,
      swapResult:      null,
      balances:        {},
      picker:          null,
      walletModalOpen: false,
      termsPending:    false,
      termsAccepted:   false,
      modalState:      { kind: 'idle', message: '', wallet: '' }, // connecting/screening/error/timeout/blocked
    };
    try { S.termsAccepted = localStorage.getItem(TERMS_KEY) === '1'; } catch (e) {}

    var subs = [];
    function notify() { for (var i = 0; i < subs.length; i++) subs[i](); }
    function subscribe(fn) { subs.push(fn); }

    /* ─── Mint per-page overrides ──────────────────────────────── */
    var rootEl = document.getElementById('verixia-swap-root');
    if (!rootEl) { showError('mount', new Error('#verixia-swap-root missing')); return; }
    function cleanMint(v) { return (v && v.indexOf('{{') === -1) ? v : null; }
    S.inputMint  = cleanMint(rootEl.dataset.inputMint)  || SOL_MINT;
    S.outputMint = cleanMint(rootEl.dataset.outputMint) || USDC_MINT;

    /* ─── Tokens ──────────────────────────────────────────────── */
    try {
      var r = await fetch('/api/jupiter/tokens');
      var data = await r.json();
      var list = Array.isArray(data) ? data : (data && data.tokens) || [];
      S.tokens = list.map(function (t) {
        return { address: t.id || t.address || t.mint, symbol: t.symbol, name: t.name, decimals: t.decimals, logoURI: t.icon || t.logoURI || null };
      }).filter(function (t) { return t.address && t.symbol && t.decimals != null; });
    } catch (e) {
      console.warn('[verixia-swap] token list failed', e);
      S.tokens = [
        { address: SOL_MINT,  symbol: 'SOL',  name: 'Solana',   decimals: 9, logoURI: null },
        { address: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: null },
      ];
    }
    S.tokensLoading = false;

    /* ─── Helpers ─────────────────────────────────────────────── */
    function fmt(n, decimals) {
      if (n == null || isNaN(n)) return '0';
      var num = Number(n);
      if (num === 0) return '0';
      if (num < 0.000001) return num.toExponential(2);
      if (num < 1)        return num.toFixed(Math.min(6, decimals || 6));
      if (num < 1000)     return num.toFixed(Math.min(4, decimals || 4));
      if (num < 1000000)  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
      return (num / 1000000).toFixed(2) + 'M';
    }
    function findToken(m) { for (var i = 0; i < S.tokens.length; i++) if (S.tokens[i].address === m) return S.tokens[i]; return null; }
    function shortAddr(a) { return a.slice(0, 6) + '...' + a.slice(-4); }
    function friendlyError(err) {
      var m = String((err && err.message) || err || '').toLowerCase();
      if (m.indexOf('insufficient') >= 0) return 'Insufficient balance for this swap.';
      if (m.indexOf('slippage') >= 0) return 'Price moved too much. Try again.';
      if (m.indexOf('blockhash') >= 0 || m.indexOf('expired') >= 0) return 'Transaction expired. Please try again.';
      if (m.indexOf('user reject') >= 0 || m.indexOf('user denied') >= 0 || m.indexOf('user cancelled') >= 0) return 'Transaction cancelled.';
      if (m.indexOf('simulation failed') >= 0) return 'Swap simulation failed — price may have moved.';
      if (m.indexOf('no route') >= 0 || m.indexOf('could not find any route') >= 0) return 'No route available for this pair.';
      if (m.indexOf('transaction too large') >= 0 || m.indexOf('too large') >= 0) return 'Route too complex for one tx. Try a different amount.';
      return (err && err.message) || 'Swap failed. Please try again.';
    }
    function deserIx(ix) {
      return {
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map(function (a) { return { pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable }; }),
        data: Buffer.from(ix.data, 'base64'),
      };
    }

    /* ─── DOM helpers ─────────────────────────────────────────── */
    function h(tag, attrs, children) {
      var el = document.createElement(tag);
      if (attrs) for (var k in attrs) {
        var v = attrs[k];
        if (v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v);
      }
      if (children != null) {
        if (!Array.isArray(children)) children = [children];
        children.forEach(function (c) {
          if (c == null || c === false) return;
          if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
          else el.appendChild(c);
        });
      }
      return el;
    }

    /* ─── Sanctions screening (Chainalysis, 24h cache, fail-open) ─── */
    async function screenAddress(address) {
      if (!address || typeof address !== 'string') return { clean: true };
      try {
        var raw = localStorage.getItem(SANCTIONS_PFX + address);
        if (raw) {
          var c = JSON.parse(raw);
          if (Date.now() - c.ts < SANCTIONS_TTL) return c.result;
        }
      } catch (e) {}
      try {
        var ctrl = new AbortController();
        var t = setTimeout(function () { ctrl.abort(); }, SANCTIONS_TIMEOUT);
        var resp = await fetch(SANCTIONS_URL + encodeURIComponent(address), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        clearTimeout(t);
        if (!resp.ok) return { clean: true };
        var data = await resp.json();
        var ids = Array.isArray(data && data.identifications) ? data.identifications : [];
        var result = ids.length > 0
          ? { clean: false, reason: (ids[0] && (ids[0].name || ids[0].category)) || 'Sanctioned' }
          : { clean: true };
        try { localStorage.setItem(SANCTIONS_PFX + address, JSON.stringify({ result: result, ts: Date.now() })); } catch (e) {}
        return result;
      } catch (e) {
        console.warn('[sanctions]', e && e.message);
        return { clean: true };
      }
    }

    /* ─── Phantom connect ────────────────────────────────────── */
    function getPhantomProvider() {
      if (window.phantom && window.phantom.solana) return window.phantom.solana;
      if (window.solana && window.solana.isPhantom) return window.solana;
      return null;
    }

    async function connectPhantom() {
      var provider = getPhantomProvider();
      if (!provider) {
        var ua = (navigator.userAgent || '').toLowerCase();
        if (/iphone|ipad|android/.test(ua)) {
          var ref = encodeURIComponent(location.href);
          location.href = 'https://phantom.app/ul/browse/' + ref + '?ref=' + ref;
          return;
        }
        throw new Error('Phantom not detected. Install the Phantom extension.');
      }
      S.modalState = { kind: 'connecting', message: '', wallet: 'Phantom' };
      notify();
      var timeout = setTimeout(function () {
        if (S.modalState.kind === 'connecting') {
          S.modalState = { kind: 'timeout', message: 'Taking too long? Check your wallet and try again.', wallet: 'Phantom' };
          notify();
        }
      }, 15000);
      try {
        var resp = await provider.connect();
        clearTimeout(timeout);
        var pk = new PublicKey(resp.publicKey.toString());
        S.walletPublicKey = pk;
        S.walletProvider  = provider;
        S.walletKind      = 'phantom';
        S.modalState = { kind: 'screening', message: '', wallet: 'Phantom' };
        notify();
        var screened = await screenAddress(pk.toBase58());
        if (!screened.clean) {
          try { await provider.disconnect(); } catch (e) {}
          S.walletPublicKey = null; S.walletProvider = null; S.walletKind = null;
          S.modalState = { kind: 'blocked', message: 'This wallet is on a sanctioned addresses list. Access is denied.', wallet: 'Phantom' };
          notify();
          return;
        }
        S.modalState = { kind: 'idle', message: '', wallet: '' };
        S.walletModalOpen = false;
        notify();
        refreshBalances();
      } catch (e) {
        clearTimeout(timeout);
        var msg = (e && e.message) || 'Connection failed';
        if (/reject|cancel|denied|user/i.test(msg)) msg = 'Connection cancelled';
        S.modalState = { kind: 'error', message: msg, wallet: 'Phantom' };
        notify();
      }
    }

    /* ─── WalletConnect ──────────────────────────────────────── */
    var wcSignClient = null;
    async function getWcClient() {
      if (wcSignClient) return wcSignClient;
      if (!WC_PROJECT_ID) throw new Error('WalletConnect projectId missing on server.');
      var mod;
      try {
        mod = await import('https://esm.sh/@walletconnect/[email protected]?bundle');
      } catch (e) {
        throw new Error('WalletConnect SDK failed to load.');
      }
      var SignClient = mod.SignClient || (mod.default && mod.default.SignClient) || mod.default;
      wcSignClient = await SignClient.init({
        projectId: WC_PROJECT_ID,
        metadata: {
          name: 'Nexus DEX',
          description: 'Solana DEX powered by Jupiter',
          url: 'https://swap.verixiaapps.com',
          icons: ['https://swap.verixiaapps.com/icon-512.png'],
        },
      });
      return wcSignClient;
    }

    async function connectWalletConnect() {
      S.modalState = { kind: 'connecting', message: '', wallet: 'WalletConnect' };
      notify();
      try {
        var client = await getWcClient();
        var SOLANA_MAINNET_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
        var connect = await client.connect({
          requiredNamespaces: {
            solana: {
              chains: [SOLANA_MAINNET_CHAIN],
              methods: ['solana_signTransaction', 'solana_signMessage'],
              events: [],
            },
          },
        });
        if (connect.uri) {
          // Open user's wallet (mobile deep-link). On desktop, log so user can copy URI.
          var ua = (navigator.userAgent || '').toLowerCase();
          if (/iphone|ipad|android/.test(ua)) {
            location.href = connect.uri;
          } else {
            // Desktop: just open a QR via wc:// — most desktop wallets have system handlers.
            window.open(connect.uri, '_blank');
          }
        }
        var session = await connect.approval();
        S.walletConnectSession = session;
        S.walletKind = 'walletconnect';
        var sessAccounts = (session.namespaces.solana && session.namespaces.solana.accounts) || [];
        if (!sessAccounts.length) throw new Error('WalletConnect session returned no Solana account.');
        var addr = sessAccounts[0].split(':').pop();
        S.walletPublicKey = new PublicKey(addr);

        S.modalState = { kind: 'screening', message: '', wallet: 'WalletConnect' };
        notify();
        var screened = await screenAddress(addr);
        if (!screened.clean) {
          try { await client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'Sanctioned' } }); } catch (e) {}
          S.walletPublicKey = null; S.walletConnectSession = null; S.walletKind = null;
          S.modalState = { kind: 'blocked', message: 'This wallet is on a sanctioned addresses list. Access is denied.', wallet: 'WalletConnect' };
          notify();
          return;
        }

        // Build a Phantom-compatible provider shim so the rest of the code stays unchanged.
        var topic = session.topic;
        S.walletProvider = {
          isShim: true,
          signTransaction: async function (tx) {
            var serialized = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64');
            var result = await client.request({
              topic: topic,
              chainId: SOLANA_MAINNET_CHAIN,
              request: {
                method: 'solana_signTransaction',
                params: { transaction: serialized, pubkey: addr },
              },
            });
            var signed = result.transaction || result.signedTransaction || result;
            var bytes = Buffer.from(signed, 'base64');
            return VersionedTransaction.deserialize(bytes);
          },
          disconnect: async function () {
            try { await client.disconnect({ topic: topic, reason: { code: 6000, message: 'User disconnected' } }); } catch (e) {}
          },
        };

        S.modalState = { kind: 'idle', message: '', wallet: '' };
        S.walletModalOpen = false;
        notify();
        refreshBalances();
      } catch (e) {
        S.modalState = { kind: 'error', message: (e && e.message) || 'WalletConnect failed', wallet: 'WalletConnect' };
        notify();
      }
    }

    async function disconnectWallet() {
      try { if (S.walletProvider && S.walletProvider.disconnect) await S.walletProvider.disconnect(); } catch (e) {}
      S.walletPublicKey = null;
      S.walletProvider  = null;
      S.walletConnectSession = null;
      S.walletKind      = null;
      S.balances        = {};
      notify();
    }

    /* ─── Open wallet flow (terms-gate first) ─────────────────── */
    function openWalletFlow() {
      if (S.walletPublicKey) { S.walletModalOpen = true; notify(); return; }
      if (S.termsAccepted) { S.walletModalOpen = true; notify(); }
      else { S.termsPending = true; notify(); }
    }
    function acceptTerms() {
      try { localStorage.setItem(TERMS_KEY, '1'); } catch (e) {}
      S.termsAccepted = true;
      S.termsPending = false;
      S.walletModalOpen = true;
      notify();
    }

    /* ─── Balances ────────────────────────────────────────────── */
    async function refreshBalances() {
      if (!S.walletPublicKey) { S.balances = {}; notify(); return; }
      try {
        var owner = S.walletPublicKey;
        var solBal = await connection.getBalance(owner);
        var t1 = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM });
        var t2 = { value: [] };
        try { t2 = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022 }); } catch (e) {}
        var out = {};
        out[SOL_MINT] = { amount: solBal, decimals: 9, uiAmount: solBal / 1e9 };
        function merge(accs) {
          for (var i = 0; i < accs.value.length; i++) {
            var info = accs.value[i].account.data.parsed && accs.value[i].account.data.parsed.info;
            if (!info) continue;
            var mint = info.mint;
            var amt = info.tokenAmount && info.tokenAmount.amount;
            var dec = info.tokenAmount && info.tokenAmount.decimals;
            var ui  = info.tokenAmount && info.tokenAmount.uiAmount;
            if (!mint || amt == null) continue;
            out[mint] = { amount: Number(amt), decimals: dec, uiAmount: ui };
          }
        }
        merge(t1); merge(t2);
        S.balances = out;
        notify();
      } catch (e) { console.warn('[verixia-swap] balances', e); }
    }

    /* ─── Quote scheduling ────────────────────────────────────── */
    var quoteAbort = null, quoteTimer = null;
    function scheduleQuote() {
      if (quoteTimer) clearTimeout(quoteTimer);
      if (quoteAbort) quoteAbort.abort();
      var input = findToken(S.inputMint);
      if (!input || !S.amount || S.inputMint === S.outputMint) {
        S.quote = null; S.quoting = false; S.quoteError = null; notify(); return;
      }
      var n = Number(S.amount);
      if (!isFinite(n) || n <= 0) {
        S.quote = null; S.quoting = false; S.quoteError = null; notify(); return;
      }
      var rawAmount = Math.floor(n * Math.pow(10, input.decimals)).toString();
      S.quoting = true; S.quoteError = null; notify();
      var ac = new AbortController(); quoteAbort = ac;
      quoteTimer = setTimeout(async function () {
        try {
          var net = (BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / BigInt(10000);
          if (net <= BigInt(0)) { S.quote = null; S.quoting = false; notify(); return; }
          var params = new URLSearchParams({
            inputMint:   S.inputMint,
            outputMint:  S.outputMint,
            amount:      net.toString(),
            slippageBps: String(SLIPPAGE_BPS),
            taker:       S.walletPublicKey ? S.walletPublicKey.toBase58() : '11111111111111111111111111111111',
            computeUnitPriceMicroLamports: String(PRIORITY_FEE),
          });
          var r = await fetch('/api/jupiter/build?' + params, { signal: ac.signal });
          if (!r.ok) {
            var body = await r.json().catch(function () { return {}; });
            throw new Error(body.error || ('Quote failed (' + r.status + ')'));
          }
          var data = await r.json();
          if (!ac.signal.aborted) { S.quote = data; S.quoting = false; notify(); }
        } catch (e) {
          if (e.name === 'AbortError') return;
          if (!ac.signal.aborted) {
            S.quote = null; S.quoting = false; S.quoteError = friendlyError(e); notify();
          }
        }
      }, 350);
    }

    /* ─── Atomic swap ─────────────────────────────────────────── */
    async function doSwap() {
      if (!S.walletPublicKey || !S.walletProvider) { openWalletFlow(); return; }
      var input  = findToken(S.inputMint);
      var output = findToken(S.outputMint);
      if (!S.quote || !input || !output) { S.swapError = 'No quote.'; notify(); return; }

      S.swapping = true; S.swapError = null; S.swapResult = null; notify();
      try {
        var build = S.quote;
        var n = Number(S.amount);
        var rawAmount = Math.floor(n * Math.pow(10, input.decimals)).toString();
        var feeAmount = (BigInt(rawAmount) * BigInt(FEE_BPS)) / BigInt(10000);
        if (feeAmount <= BigInt(0)) throw new Error('Fee rounds to zero.');

        var feeIxs = [];
        if (S.inputMint === SOL_MINT) {
          feeIxs.push(SystemProgram.transfer({
            fromPubkey: S.walletPublicKey, toPubkey: FEE_PK, lamports: Number(feeAmount),
          }));
        } else {
          var mintPk = new PublicKey(S.inputMint);
          var mintInfo = await connection.getAccountInfo(mintPk);
          if (!mintInfo) throw new Error('Input mint not found on-chain.');
          var tokenProgram = mintInfo.owner.equals(TOKEN_2022) ? TOKEN_2022 : TOKEN_PROGRAM;
          var sourceAta = splToken.getAssociatedTokenAddressSync(mintPk, S.walletPublicKey, true, tokenProgram);
          var destAta   = splToken.getAssociatedTokenAddressSync(mintPk, FEE_PK,             true, tokenProgram);
          feeIxs.push(splToken.createAssociatedTokenAccountIdempotentInstruction(S.walletPublicKey, destAta, FEE_PK, mintPk, tokenProgram));
          feeIxs.push(splToken.createTransferCheckedInstruction(sourceAta, mintPk, destAta, S.walletPublicKey, feeAmount, input.decimals, [], tokenProgram));
        }

        var ixs = [];
        if (Array.isArray(build.computeBudgetInstructions)) build.computeBudgetInstructions.forEach(function (ix) { ixs.push(deserIx(ix)); });
        feeIxs.forEach(function (ix) { ixs.push(ix); });
        if (Array.isArray(build.setupInstructions)) build.setupInstructions.forEach(function (ix) { ixs.push(deserIx(ix)); });
        if (build.swapInstruction)    ixs.push(deserIx(build.swapInstruction));
        if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
        if (Array.isArray(build.otherInstructions)) build.otherInstructions.forEach(function (ix) { ixs.push(deserIx(ix)); });

        var alts = [];
        var altKeys = Object.keys(build.addressesByLookupTableAddress || {});
        if (altKeys.length > 0) {
          var infos = await connection.getMultipleAccountsInfo(altKeys.map(function (k) { return new PublicKey(k); }));
          for (var i = 0; i < altKeys.length; i++) {
            if (infos[i]) alts.push(new ALT({ key: new PublicKey(altKeys[i]), state: ALT.deserialize(infos[i].data) }));
          }
        }

        var latest = await connection.getLatestBlockhash('confirmed');
        var message = new TransactionMessage({
          payerKey: S.walletPublicKey, recentBlockhash: latest.blockhash, instructions: ixs,
        }).compileToV0Message(alts);
        var tx = new VersionedTransaction(message);

        try {
          var sim = await connection.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false });
          if (sim.value.err) {
            var logs = (sim.value.logs || []).join('\n').toLowerCase();
            if (logs.indexOf('insufficient') >= 0 || logs.indexOf('0x1') >= 0) throw new Error('Insufficient balance for this swap.');
            if (logs.indexOf('slippage') >= 0 || logs.indexOf('0x1771') >= 0) throw new Error('Price moved — try a smaller amount.');
            throw new Error('Swap simulation failed — price may have moved.');
          }
        } catch (simErr) {
          if (simErr && /balance|slippage|simulation failed|expired/i.test(simErr.message || '')) throw simErr;
          console.warn('[verixia-swap] sim non-fatal', simErr);
        }

        var signed = await S.walletProvider.signTransaction(tx);
        var sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });

        var confirmed = false;
        try {
          var conf = await Promise.race([
            connection.confirmTransaction({
              signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight,
            }, 'confirmed'),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('confirm-timeout')); }, 30000); }),
          ]);
          if (conf && conf.value && conf.value.err) throw new Error('Swap failed on-chain.');
          confirmed = true;
        } catch (cfErr) {
          var deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            await new Promise(function (r) { setTimeout(r, 2000); });
            try {
              var st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
              var cs = st && st.value && st.value.confirmationStatus;
              if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
              if (st && st.value && st.value.err) throw new Error('Swap failed on-chain.');
            } catch (e) {
              if (/failed on-chain/i.test(String(e.message))) throw e;
            }
          }
        }

        S.swapResult = { signature: sig, pending: !confirmed };
        if (confirmed) { S.amount = ''; S.quote = null; setTimeout(refreshBalances, 2000); }
      } catch (e) {
        console.error('[verixia-swap]', e);
        S.swapError = friendlyError(e);
      } finally {
        S.swapping = false;
        notify();
      }
    }

    /* ─── Render: SwapWidget (`.sw-*` classes already styled on the SEO page) ─── */
    function render() {
      var input  = findToken(S.inputMint);
      var output = findToken(S.outputMint);
      var inputBalance = S.balances[S.inputMint];

      var outAmountUi = (S.quote && output) ? Number(S.quote.outAmount) / Math.pow(10, output.decimals) : null;
      var minReceived = (S.quote && output) ? Number(S.quote.otherAmountThreshold) / Math.pow(10, output.decimals) : null;
      var priceImpact = (S.quote && S.quote.priceImpactPct != null) ? Number(S.quote.priceImpactPct) * 100 : null;

      var hasFunds = inputBalance && Number(S.amount) > 0 && inputBalance.uiAmount >= Number(S.amount);
      var canSwap  = S.walletPublicKey && S.quote && !S.quoting && !S.swapping &&
                     Number(S.amount) > 0 && S.inputMint !== S.outputMint && hasFunds;

      var btnText = S.swapping ? 'Swapping…'
                  : !S.walletPublicKey ? 'Connect Wallet'
                  : S.inputMint === S.outputMint ? 'Select different tokens'
                  : !S.amount || Number(S.amount) <= 0 ? 'Enter amount'
                  : !S.quote && S.quoting ? 'Getting quote…'
                  : !S.quote ? 'No route available'
                  : !hasFunds ? ('Insufficient ' + (input ? input.symbol : ''))
                  : '🚀 Swap';

      var primaryHandler = (!S.walletPublicKey ? openWalletFlow : doSwap);

      var container = h('div', { class: 'sw-container' }, [
        h('div', { class: 'sw-header' }, [
          h('h1', { class: 'sw-title' }, 'Swap'),
        ]),
        h('div', { class: 'sw-panel' }, [
          legRow('input', 'You pay', input, S.amount, inputBalance, true),
          h('div', { class: 'sw-flip-wrap' }, [
            h('button', { class: 'sw-flip-btn', 'aria-label': 'Flip', onClick: function () {
              S.inputMint = [S.outputMint, S.outputMint = S.inputMint][0];
              S.amount = ''; S.quote = null;
              scheduleQuote(); notify();
            } }, '⇅'),
          ]),
          legRow('output', 'You receive', output,
                 outAmountUi != null ? fmt(outAmountUi, output && output.decimals) : (S.quoting ? '…' : ''),
                 S.balances[S.outputMint], false),
        ]),
        S.quote && input && output && Number(S.amount) > 0 ? h('div', { class: 'sw-details' }, [
          detailRow('Rate', '1 ' + input.symbol + ' ≈ ' + fmt((outAmountUi / Number(S.amount)) || 0, output.decimals) + ' ' + output.symbol),
          detailRow('Minimum received', fmt(minReceived, output.decimals) + ' ' + output.symbol),
          detailRow('Price impact', priceImpact != null ? priceImpact.toFixed(2) + '%' : '—',
                    priceImpact == null ? 'sw-impact-neutral'
                    : priceImpact > 5 ? 'sw-impact-bad'
                    : priceImpact > 1 ? 'sw-impact-warn'
                    : 'sw-impact-good'),
          detailRow('Platform fee', (FEE_BPS / 100).toFixed(1) + '% (in ' + input.symbol + ')'),
        ]) : null,
        S.quoteError && !S.swapping && !S.swapResult ? banner('error', S.quoteError) : null,
        S.swapError ? banner('error', S.swapError) : null,
        S.swapResult ? banner(S.swapResult.pending ? 'pending' : 'success',
          (S.swapResult.pending ? 'Submitted but still confirming. ' : 'Swap confirmed. '),
          'https://solscan.io/tx/' + S.swapResult.signature, 'View on Solscan') : null,
        h('button', {
          class: 'sw-primary-btn' + (canSwap || !S.walletPublicKey ? '' : ' sw-disabled'),
          onClick: primaryHandler,
        }, btnText),
        h('p', { class: 'sw-footer' }, [
          'Powered by ', h('b', null, 'Jupiter'), ' · Solana\'s leading DEX aggregator',
        ]),
      ]);

      var wrap = h('div', { class: 'sw-root' }, [container]);
      rootEl.innerHTML = '';
      rootEl.appendChild(wrap);

      if (S.picker) rootEl.appendChild(renderPicker());
      renderHeaderConnect();
      renderTermsAndWalletModals();
    }

    function legRow(kind, label, token, amount, balance, editable) {
      var balText = balance ? ('Balance: ' + fmt(balance.uiAmount, balance.decimals)) : '';
      var amountAttrs = { type: 'text', inputmode: 'decimal', placeholder: '0.00', value: amount == null ? '' : String(amount), class: 'sw-amount-input' };
      if (!editable) amountAttrs.readonly = '';
      var amountInput = h('input', amountAttrs);
      if (editable) {
        amountInput.addEventListener('input', function (e) {
          var v = e.target.value.replace(/[^\d.]/g, '');
          var parts = v.split('.');
          if (parts.length > 2) { e.target.value = S.amount; return; }
          S.amount = v;
          scheduleQuote(); notify();
        });
      }
      return h('div', { class: 'sw-row' }, [
        h('div', { class: 'sw-row-top' }, [
          h('span', { class: 'sw-row-label' }, label),
          balance ? h('span', { class: 'sw-balance' }, [
            balText,
            editable && balance.uiAmount > 0 ? h('button', { class: 'sw-max-btn', onClick: function () {
              var maxAmt = balance.uiAmount;
              if (S.inputMint === SOL_MINT) maxAmt = Math.max(0, maxAmt - 0.01);
              S.amount = String(maxAmt);
              scheduleQuote(); notify();
            } }, 'MAX') : null,
          ]) : null,
        ]),
        h('div', { class: 'sw-row-mid' }, [
          h('button', { class: 'sw-token-btn', onClick: function () { S.picker = kind; notify(); } }, [
            token && token.logoURI ? h('img', { src: token.logoURI, alt: '', class: 'sw-token-logo' }) : null,
            h('span', null, token ? token.symbol : 'Select'),
            h('span', null, ' ▾'),
          ]),
          amountInput,
        ]),
      ]);
    }

    function detailRow(label, value, valClass) {
      return h('div', { class: 'sw-detail-row' }, [
        h('span', null, label),
        h('span', { class: 'sw-detail-val ' + (valClass || '') }, value),
      ]);
    }

    function banner(kind, text, link, linkText) {
      var children = [text];
      if (link) children.push(h('a', { href: link, target: '_blank', rel: 'noreferrer', class: 'sw-banner-link' }, linkText));
      return h('div', { class: 'sw-banner sw-banner-' + kind }, children);
    }

    /* ─── Token picker ────────────────────────────────────────── */
    function renderPicker() {
      var query = '';
      var searchResults = null;
      var searchTimer = null;
      var overlay = h('div', { class: 'sw-modal-overlay', onClick: function () { S.picker = null; notify(); } });
      var card = h('div', { class: 'sw-modal-card' });
      card.addEventListener('click', function (e) { e.stopPropagation(); });
      overlay.appendChild(card);
      var searchInput = h('input', { autofocus: '', placeholder: 'Search name, symbol, or paste address', class: 'sw-modal-search' });
      var listEl = h('div', { class: 'sw-modal-list' });
      card.appendChild(h('div', { class: 'sw-modal-head' }, [
        h('div', { class: 'sw-modal-head-row' }, [
          h('h3', { class: 'sw-modal-title' }, 'Select token'),
          h('button', { class: 'sw-icon-btn', onClick: function () { S.picker = null; notify(); } }, '✕'),
        ]),
        searchInput,
      ]));
      card.appendChild(listEl);

      function refillList() {
        var excludeMint = S.picker === 'input' ? S.outputMint : S.inputMint;
        var source = searchResults != null ? searchResults : S.tokens.filter(function (t) {
          if (!query.trim()) return true;
          var q = query.toLowerCase();
          return t.symbol.toLowerCase().indexOf(q) >= 0 ||
                 (t.name || '').toLowerCase().indexOf(q) >= 0 ||
                 t.address.toLowerCase().indexOf(q) === 0;
        });
        var list = source.filter(function (t) { return t.address !== excludeMint; }).sort(function (a, b) {
          var ab = (S.balances[a.address] && S.balances[a.address].uiAmount) || 0;
          var bb = (S.balances[b.address] && S.balances[b.address].uiAmount) || 0;
          if (ab > 0 && bb === 0) return -1;
          if (bb > 0 && ab === 0) return 1;
          if (ab !== bb) return bb - ab;
          return a.symbol.localeCompare(b.symbol);
        }).slice(0, 150);
        listEl.innerHTML = '';
        if (S.tokensLoading) { listEl.appendChild(h('div', { class: 'sw-modal-msg' }, 'Loading tokens…')); return; }
        if (list.length === 0) { listEl.appendChild(h('div', { class: 'sw-modal-msg' }, 'No tokens found.')); return; }
        list.forEach(function (t) {
          var bal = S.balances[t.address];
          var row = h('button', { class: 'sw-token-row', onClick: function () {
            if (S.picker === 'input') S.inputMint = t.address; else S.outputMint = t.address;
            S.picker = null; S.quote = null;
            scheduleQuote(); notify();
          } }, [
            t.logoURI ? h('img', { src: t.logoURI, alt: '', class: 'sw-token-row-logo' }) : h('div', { class: 'sw-token-row-placeholder' }),
            h('div', { class: 'sw-token-row-info' }, [
              h('div', { class: 'sw-token-row-sym' }, t.symbol),
              h('div', { class: 'sw-token-row-name' }, t.name || ''),
            ]),
            bal && bal.uiAmount > 0 ? h('div', { class: 'sw-token-row-bal' }, fmt(bal.uiAmount, bal.decimals)) : null,
          ]);
          listEl.appendChild(row);
        });
      }
      searchInput.addEventListener('input', function (e) {
        query = e.target.value;
        if (searchTimer) clearTimeout(searchTimer);
        if (!query.trim()) { searchResults = null; refillList(); return; }
        searchTimer = setTimeout(async function () {
          try {
            var r = await fetch('/api/jupiter/tokens/search?query=' + encodeURIComponent(query.trim()));
            var data = await r.json();
            var arr = Array.isArray(data) ? data : (data && data.tokens) || [];
            searchResults = arr.map(function (t) {
              return { address: t.id || t.address || t.mint, symbol: t.symbol, name: t.name, decimals: t.decimals, logoURI: t.icon || t.logoURI || null };
            }).filter(function (t) { return t.address && t.symbol && t.decimals != null; });
            refillList();
          } catch (e) { console.warn('[verixia-swap] search', e); }
        }, 250);
      });
      refillList();
      return overlay;
    }

    /* ─── Terms gate + WalletModal (matched to main site) ─────── */
    var modalsHost = document.createElement('div');
    document.body.appendChild(modalsHost);

    function renderTermsAndWalletModals() {
      modalsHost.innerHTML = '';
      if (S.termsPending) modalsHost.appendChild(renderTermsGate());
      if (S.walletModalOpen) modalsHost.appendChild(renderWalletModal());
    }

    function renderTermsGate() {
      var canAccept = false;
      var dim = h('div', { style: 'position:fixed;inset:0;z-index:999;background:rgba(3,6,15,.50);' });
      var sheet = h('div', { style:
        'position:fixed;bottom:0;left:50%;transform:translateX(-50%);' +
        'width:100%;max-width:480px;max-height:50dvh;z-index:1000;' +
        'display:flex;flex-direction:column;overflow:hidden;background:#080d1a;' +
        'border:1px solid rgba(0,229,255,.22);border-top:1px solid rgba(0,229,255,.30);' +
        'border-radius:16px 16px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.8), 0 0 20px rgba(0,229,255,.08);' +
        'font-family:Syne, sans-serif;',
      });
      sheet.appendChild(h('div', { style: 'flex-shrink:0;padding-top:10px;display:flex;justify-content:center;' }, [
        h('div', { style: 'width:36px;height:3px;border-radius:2px;background:rgba(255,255,255,.15);' }),
      ]));
      sheet.appendChild(h('div', { style: 'flex-shrink:0;padding:8px 18px 6px;display:flex;align-items:center;gap:10px;' }, [
        h('div', { style: 'display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.22);' }, [
          h('span', { style: 'width:5px;height:5px;border-radius:50%;background:#00e5ff;' }),
          h('span', { style: 'color:#00e5ff;font-size:9px;font-weight:700;letter-spacing:.10em;' }, 'TERMS OF USE'),
        ]),
        h('div', { style: 'flex:1' }),
        h('div', { style: 'font-size:11px;color:#586994;' }, 'Non-custodial · You assume all risk'),
      ]));

      var scrollEl = h('div', { class: 'scroll-contain', style: 'flex:1;overflow-y:auto;min-height:0;padding:4px 18px 10px;' });
      var body = h('div', { style: 'font-size:11px;color:#cdd6f4;line-height:1.55;' });
      body.innerHTML =
        'By clicking <strong style="color:#fff">"Accept &amp; Continue"</strong> you agree that:<br><br>' +
        '• Nexus DEX is a non-custodial interface by Verixia Apps. We do not custody funds, control wallets, execute trades, or provide financial, investment, legal, or tax advice.<br><br>' +
        '• <strong style="color:#fff">Compliance &amp; wallet screening.</strong> All wallet addresses are screened against U.S. OFAC, U.N., E.U., and U.K. sanctions lists via Chainalysis. Flagged wallets are denied access.<br><br>' +
        '• <strong style="color:#fff">Restricted jurisdictions.</strong> You are not located in, a resident of, or citizen of: Iran, North Korea, Cuba, Syria, Crimea, Donetsk, Luhansk, Sevastopol, or any other jurisdiction subject to comprehensive U.S., U.N., E.U., or U.K. sanctions.<br><br>' +
        '• <strong style="color:#fff">You are 18 or older</strong> and have full legal capacity to enter this agreement.<br><br>' +
        '• All swaps, routing, liquidity, and blockchain interactions are handled by third-party protocols. All transactions are signed directly by you through your own wallet.<br><br>' +
        '• DeFi and smart contracts carry substantial risk including total loss of funds. <strong style="color:#fff">You assume all risk.</strong><br><br>' +
        '• <strong style="color:#fff">No reimbursement.</strong> Verixia Apps will not refund or compensate any loss, regardless of cause.<br><br>' +
        '• <strong style="color:#fff">AS-IS / AS-AVAILABLE.</strong> No warranties of any kind.<br><br>' +
        '• <strong style="color:#fff">No liability.</strong> Verixia Apps is not liable for any damages arising from your use of Nexus DEX.<br><br>' +
        '• <strong style="color:#fff">No class actions.</strong> You waive any right to class action or jury trial against Verixia Apps.<br><br>' +
        '• <strong style="color:#fff">Binding arbitration.</strong> Disputes resolved through individual arbitration only.<br><br>' +
        'If you do not agree, discontinue use immediately.';
      scrollEl.appendChild(body);
      sheet.appendChild(scrollEl);

      var footer = h('div', { style: 'flex-shrink:0;padding:8px 18px 14px;border-top:1px solid rgba(255,255,255,.04);background:#080d1a;' });
      var scrollHint = h('div', { style: 'display:flex;align-items:center;justify-content:center;gap:5px;font-size:10px;color:#586994;margin-bottom:8px;font-weight:600;letter-spacing:.04em;' }, '↓ Scroll to continue');
      var acceptBtn = h('button', {
        style: 'width:100%;padding:12px;border-radius:10px;border:none;background:rgba(255,255,255,.05);color:#586994;font-family:Syne, sans-serif;font-weight:800;font-size:14px;cursor:not-allowed;transition:all .2s;',
        disabled: '',
      }, 'Accept & Continue');
      function enable() {
        canAccept = true;
        if (scrollHint.parentNode) scrollHint.parentNode.removeChild(scrollHint);
        acceptBtn.removeAttribute('disabled');
        acceptBtn.style.background = 'linear-gradient(135deg,#00e5ff,#0055ff)';
        acceptBtn.style.color = '#03060f';
        acceptBtn.style.cursor = 'pointer';
        acceptBtn.style.boxShadow = '0 6px 20px rgba(0,229,255,.25)';
      }
      acceptBtn.addEventListener('click', function () { if (canAccept) acceptTerms(); });
      footer.appendChild(scrollHint);
      footer.appendChild(acceptBtn);
      footer.appendChild(h('div', { style: 'font-size:9px;color:#586994;text-align:center;margin-top:8px;font-weight:600;letter-spacing:.06em;' }, 'NON-CUSTODIAL · NO ACCOUNT · YOUR KEYS'));
      sheet.appendChild(footer);

      setTimeout(function () {
        if (scrollEl.scrollHeight <= scrollEl.clientHeight + 8) enable();
      }, 50);
      scrollEl.addEventListener('scroll', function () {
        if (canAccept) return;
        if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 8) enable();
      });

      var wrap = document.createDocumentFragment();
      wrap.appendChild(dim); wrap.appendChild(sheet);
      var holder = document.createElement('div');
      holder.appendChild(dim); holder.appendChild(sheet);
      return holder;
    }

    function renderWalletModal() {
      var ms = S.modalState;
      var isConnecting = ms.kind === 'connecting' || ms.kind === 'screening';
      var isTimeout    = ms.kind === 'timeout';
      var isBlocked    = ms.kind === 'blocked';
      var isScreening  = ms.kind === 'screening';
      var pending      = (isConnecting || isTimeout) ? ms.wallet : null;
      var addrDisp     = S.walletPublicKey ? shortAddr(S.walletPublicKey.toBase58()) : null;
      var connected    = !!S.walletPublicKey;

      function close() {
        S.walletModalOpen = false;
        S.modalState = { kind: 'idle', message: '', wallet: '' };
        notify();
      }
      function retry() { S.modalState = { kind: 'idle', message: '', wallet: '' }; notify(); }
      async function handleDisconnect() { await disconnectWallet(); close(); }

      var dim = h('div', { onClick: close, style: 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.85);' });

      var sheet = h('div', { style:
        'position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:520px;z-index:501;' +
        'background:#080d1a;border-top:2px solid rgba(0,229,255,.2);border-radius:20px 20px 0 0;' +
        'box-shadow:0 -20px 60px rgba(0,0,0,.9);max-height:min(85vh, 100dvh);display:flex;flex-direction:column;overflow:hidden;' +
        'font-family:Syne, sans-serif;',
      });

      var headTitle = isBlocked ? 'Access Restricted' : connected ? 'Wallet Connected' : 'Connect Wallet';
      var header = h('div', { style: 'flex-shrink:0;padding:20px 24px 16px;' }, [
        h('div', { style: 'width:40px;height:4px;background:#2e3f5e;border-radius:2px;margin:0 auto 20px;cursor:pointer;padding:8px 0;box-sizing:content-box;', onClick: close }),
        h('div', { style: 'text-align:center;' }, [
          h('div', { style: 'font-size:20px;font-weight:800;color:#fff;margin-bottom:6px;' }, headTitle),
          (addrDisp && !isBlocked) ? h('div', { style: 'font-size:13px;color:#586994;' }, [ (S.walletKind === 'phantom' ? 'Phantom' : S.walletKind === 'walletconnect' ? 'WalletConnect' : 'Wallet') + ': ' + addrDisp ]) : null,
          isScreening ? h('div', { style: 'font-size:12px;color:#00e5ff;margin-top:4px;' }, 'Verifying wallet address...') : null,
          (!connected && !isBlocked && !isScreening) ? h('div', { style: 'font-size:12px;color:#586994;margin-top:4px;' }, 'Pick one. We never see your keys.') : null,
        ]),
      ]);
      sheet.appendChild(header);

      var body = h('div', { class: 'scroll-contain', style: 'flex:1;padding:0 24px;padding-bottom:calc(env(safe-area-inset-bottom) + 32px);' });
      sheet.appendChild(body);

      var inner = h('div', { style: 'display:flex;flex-direction:column;gap:12px;max-width:400px;margin:0 auto;padding-top:8px;' });

      if (isBlocked) {
        inner.appendChild(h('div', { style: 'background:rgba(255,59,107,.10);border:1px solid rgba(255,59,107,.35);border-radius:16px;padding:16px 18px;' }, [
          h('div', { style: 'color:#ff3b6b;font-weight:800;font-size:14px;margin-bottom:6px;' }, 'Wallet not eligible'),
          h('div', { style: 'color:#cdd6f4;font-size:12px;line-height:1.55;' }, (ms.message || '') + ' This is automated screening against major sanctions lists. If you believe this is an error, please try a different wallet.'),
        ]));
        inner.appendChild(h('button', { style: 'background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.30);border-radius:16px;padding:14px;cursor:pointer;width:100%;color:#00e5ff;font-weight:700;font-size:14px;font-family:Syne, sans-serif;', onClick: retry }, 'Try a different wallet'));
        inner.appendChild(h('button', { style: 'background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:12px;cursor:pointer;color:#586994;font-size:13px;font-family:Syne, sans-serif;', onClick: close }, 'Close'));
      } else if (connected) {
        inner.appendChild(h('div', { style: 'background:rgba(0,255,163,.08);border:1px solid rgba(0,255,163,.2);border-radius:16px;padding:16px 20px;' }, [
          h('div', { style: 'color:#00ffa3;font-weight:700;font-size:15px;margin-bottom:4px;' }, 'Connected'),
          h('div', { style: 'color:#586994;font-size:12px;font-family:monospace;word-break:break-all;' }, addrDisp || '(provisioning...)'),
        ]));
        inner.appendChild(h('button', { style: 'background:rgba(255,59,107,.1);border:1px solid rgba(255,59,107,.3);border-radius:16px;padding:16px;cursor:pointer;width:100%;color:#ff3b6b;font-weight:700;font-size:15px;font-family:Syne, sans-serif;', onClick: handleDisconnect }, 'Disconnect'));
        inner.appendChild(h('button', { style: 'background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:14px;cursor:pointer;color:#586994;font-size:14px;font-family:Syne, sans-serif;', onClick: close }, 'Close'));
      } else {
        if (ms.kind === 'error' || isTimeout) {
          inner.appendChild(h('div', { style: 'display:flex;justify-content:space-between;gap:10px;background:rgba(255,149,0,.10);border:1px solid rgba(255,149,0,.3);border-radius:12px;padding:10px 14px;' }, [
            h('span', { style: 'color:#ff9500;font-size:12px;font-weight:600;' }, ms.message),
            h('button', { style: 'background:transparent;border:1px solid #ff9500;color:#ff9500;padding:4px 10px;border-radius:6px;font-size:11px;font-family:Syne, sans-serif;font-weight:700;cursor:pointer;', onClick: retry }, 'Retry'),
          ]));
        }
        var opts = [
          { key: 'phantom',       name: 'Phantom',       subtitle: 'Solana wallet',          color: '#ab9ff2', onClick: connectPhantom },
          { key: 'walletconnect', name: 'WalletConnect', subtitle: 'Scan QR or link any wallet', color: '#3b99fc', onClick: connectWalletConnect },
        ];
        opts.forEach(function (o) {
          var isPending = isConnecting && pending === o.name;
          var disabled = isConnecting || isTimeout;
          var btn = h('button', {
            style:
              'display:flex;align-items:center;gap:12px;background:' + (isPending ? 'rgba(0,229,255,.12)' : 'rgba(255,255,255,.025)') + ';' +
              'border:1px solid ' + (isPending ? 'rgba(0,229,255,.35)' : 'rgba(255,255,255,.06)') + ';' +
              'border-radius:12px;padding:11px 14px;cursor:' + (disabled ? 'wait' : 'pointer') + ';width:100%;' +
              'opacity:' + (isTimeout && !isPending ? 0.55 : 1) + ';transition:background .15s, border-color .15s;',
            onClick: function () { if (!disabled) o.onClick(); },
          }, [
            h('div', { style: 'width:32px;height:32px;border-radius:8px;background:' + o.color + '33;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:' + o.color + ';flex-shrink:0;' }, o.name.charAt(0)),
            h('div', { style: 'text-align:left;flex:1;min-width:0;' }, [
              h('div', { style: 'color:#fff;font-weight:700;font-size:14px;' }, o.name),
              h('div', { style: 'color:#586994;font-size:11px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
                isPending ? (isScreening ? 'Verifying address...' : 'Check your wallet...') : o.subtitle),
            ]),
            isPending ? h('div', { style: 'width:16px;height:16px;border-radius:50%;border:2px solid #00e5ff;border-top-color:transparent;animation:wc-spin 0.8s linear infinite;flex-shrink:0;' }) : null,
          ]);
          inner.appendChild(btn);
        });
        inner.appendChild(h('div', { style: 'font-size:10px;color:#586994;text-align:center;margin-top:6px;' }, 'Non-custodial. We never see or store your keys.'));
      }

      body.appendChild(inner);

      var holder = document.createElement('div');
      holder.appendChild(dim);
      holder.appendChild(sheet);
      document.body.classList.add('nexus-scroll-locked');
      var onKey = function (e) { if (e.key === 'Escape') close(); };
      window.addEventListener('keydown', onKey);
      // Cleanup when modal removed.
      var observer = new MutationObserver(function () {
        if (!holder.isConnected) {
          document.body.classList.remove('nexus-scroll-locked');
          window.removeEventListener('keydown', onKey);
          observer.disconnect();
        }
      });
      observer.observe(modalsHost, { childList: true });
      return holder;
    }

    /* ─── Header connect button ───────────────────────────────── */
    function renderHeaderConnect() {
      var btn = document.querySelector('button.connect, .connect');
      if (!btn) return;
      var label = S.walletPublicKey ? shortAddr(S.walletPublicKey.toBase58()) : 'Connect';
      btn.textContent = label;
      if (btn.__verixiaWired) return;
      btn.__verixiaWired = true;
      btn.addEventListener('click', function () { openWalletFlow(); });
    }

    /* ─── Wire up & first render ──────────────────────────────── */
    subscribe(render);
    render();
    window.__verixiaReady = true;

    // Detect already-connected Phantom (mobile in-app browser auto-injects).
    var auto = getPhantomProvider();
    if (auto && auto.isConnected && auto.publicKey) {
      try {
        S.walletPublicKey = new PublicKey(auto.publicKey.toString());
        S.walletProvider = auto;
        S.walletKind = 'phantom';
        notify();
        refreshBalances();
      } catch (e) {}
    }
  }
})();
