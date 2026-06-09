/* verixia-wc.js
 * Self-contained wallet bundle for Verixia's SEO landing pages.
 * Dynamically imports Reown AppKit from a public ESM CDN at runtime,
 * then exposes a stable API on window.VerixiaWallet.
 */
(async function () {
  try {
    var m1 = await import('https://esm.sh/@reown/appkit@1.8.20');
    var m2 = await import('https://esm.sh/@reown/appkit-adapter-solana@1.8.20');
    var m3 = await import('https://esm.sh/@reown/appkit@1.8.20/networks');

    var createAppKit  = m1.createAppKit;
    var SolanaAdapter = m2.SolanaAdapter;
    var solana        = m3.solana;

    var cfg = (window.__VERIXIA_CONFIG__) || {};
    var projectId = cfg.wcProjectId || '1a7c741caab0a2c5ffa2b199a816ea92';
    var origin = (window.location && window.location.origin) || 'https://verixiaapps.com';

    var modal = createAppKit({
      adapters: [new SolanaAdapter()],
      networks: [solana],
      projectId: projectId,
      metadata: {
        name: 'Verixia',
        description: 'Bridge & swap on Solana via Jupiter',
        url: origin,
        icons: [origin + '/favicon.ico'],
      },
      themeMode: 'dark',
      themeVariables: { '--w3m-accent': '#00b8d4' },
      features: { analytics: true, email: false, socials: false },
    });

    var subscribers = new Set();
    modal.subscribeProvider(function (s) {
      var state = {
        isConnected: !!(s && s.isConnected),
        address: (s && s.address) || null,
        providerType: (s && s.providerType) || null,
        walletName: (s && s.providerType) || null,
      };
      subscribers.forEach(function (cb) { try { cb(state); } catch (e) {} });
    });

    window.VerixiaWallet = {
      open: function () { return modal.open(); },
      close: function () { return modal.close(); },
      disconnect: function () { return modal.disconnect(); },
      getAddress: function () { try { return modal.getAddress() || null; } catch (e) { return null; } },
      isConnected: function () { try { return !!modal.getAddress(); } catch (e) { return false; } },
      getProvider: function () { try { return modal.getWalletProvider() || null; } catch (e) { return null; } },
      getProviderType: function () { try { return (modal.getWalletProviderType && modal.getWalletProviderType()) || null; } catch (e) { return null; } },
      subscribe: function (cb) {
        if (typeof cb !== 'function') return function () {};
        subscribers.add(cb);
        try {
          cb({
            isConnected: this.isConnected(),
            address: this.getAddress(),
            providerType: this.getProviderType(),
            walletName: this.getProviderType(),
          });
        } catch (e) {}
        return function () { subscribers.delete(cb); };
      },
      _modal: modal,
    };

    console.log('[VerixiaWallet] AppKit ready');
    window.dispatchEvent(new Event('verixia-wallet-ready'));
  } catch (err) {
    console.error('[VerixiaWallet] init failed:', err);
    window.VerixiaWallet = {
      _error: (err && err.message) || 'init failed',
      open: function () { alert('Wallet failed to load: ' + this._error); },
      close: function () {}, disconnect: function () {},
      getAddress: function () { return null; }, isConnected: function () { return false; },
      getProvider: function () { return null; }, getProviderType: function () { return null; },
      subscribe: function () { return function () {}; },
    };
    window.dispatchEvent(new Event('verixia-wallet-ready'));
  }
})();
