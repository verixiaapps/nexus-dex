// config-overrides.embed.js
//
// react-app-rewired config for the EMBED build ONLY.
// Run via:  react-app-rewired build --config-overrides config-overrides.embed.js
// (the `build:embed` npm script does this).
//
// It produces a single self-contained file at  embed_dist/verixia-swap.js
// which the `build:all` npm script then copies to  build/embed/verixia-swap.js .
//
// SEO pages load it with:
//   <script src="/embed/config.js"></script>            (runtime config)
//   <script src="/embed/verixia-swap.js" defer></script> (this bundle)
//
// The main app build (`npm run build`) is untouched.
//
// KEY DESIGN POINT: this file does NOT hand-copy the polyfill/alias config.
// It calls the real ./config-overrides.js first, so the embed bundle gets the
// EXACT SAME setup as the main app — the @web3modal stubs (required by the
// WalletConnect adapter), the node: scheme rewrites, the buffer/process/crypto
// polyfills, the ProvidePlugin, etc. Then it layers the embed-only changes on
// top. If the main app builds, the shared parts of the embed build do too.

const path    = require('path');
const webpack = require('webpack');
const baseOverride = require('./config-overrides.js');

// Plugins that only make sense for the full HTML app. Removed for the embed,
// which is a single JS file with no index.html and no service worker.
const DROP_PLUGINS = new Set([
  'HtmlWebpackPlugin',
  'InlineChunkHtmlPlugin',
  'InterpolateHtmlPlugin',
  'ManifestPlugin',
  'WebpackManifestPlugin',
  'MiniCssExtractPlugin', // CSS is injected via style-loader instead (see below)
  'GenerateSW',
  'WorkboxWebpackPlugin',
]);

// Walk CRA's nested module rules and replace the MiniCssExtractPlugin loader
// with style-loader, so all imported CSS (SwapWidget.css + the wallet-adapter
// modal styles) is injected into <head> at runtime and travels inside the JS
// bundle — nothing extra to load on the SEO page.
function useStyleLoader(rules) {
  if (!Array.isArray(rules)) return;
  for (const rule of rules) {
    if (!rule) continue;
    if (Array.isArray(rule.oneOf)) useStyleLoader(rule.oneOf);
    if (Array.isArray(rule.use)) {
      rule.use = rule.use.map((u) => {
        const loader = typeof u === 'string' ? u : (u && u.loader);
        if (loader && loader.includes('mini-css-extract-plugin')) {
          return require.resolve('style-loader');
        }
        return u;
      });
    }
  }
}

module.exports = function override(config, env) {
  // 1) Apply the SAME overrides as the main app build.
  config = baseOverride(config, env);

  // 2) Entry: just the embed bootstrap, not the CRA app shell.
  config.entry = path.resolve(__dirname, 'src/embed/index.jsx');

  // 3) Output: one file, emitted OUTSIDE build/ so the main build's clean step
  //    (react-scripts empties build/ on every run) can't wipe it. The build:all
  //    npm script copies embed_dist/ -> build/embed/ afterwards (inline, no
  //    separate script file).
  config.output = Object.assign({}, config.output, {
    path:          path.resolve(__dirname, 'embed_dist'),
    filename:      'verixia-swap.js',
    chunkFilename: 'verixia-swap.[contenthash:8].chunk.js',
    publicPath:    '/embed/',
  });
  delete config.output.library; // the entry assigns window.VerixiaSwap itself

  // 4) No code splitting / no separate runtime chunk — single file.
  config.optimization = Object.assign({}, config.optimization || {}, {
    splitChunks:  false,
    runtimeChunk: false,
  });

  // 5) CSS in JS (style-loader) instead of an extracted .css file.
  useStyleLoader(config.module && config.module.rules);

  // 5b) Skip the main-site SwapWidget.css for the EMBED build ONLY.
  //     SwapWidget.jsx imports './SwapWidget.css' (the mint main-site theme).
  //     SEO pages style the widget from their own inline <style>, so we must NOT
  //     bundle that mint CSS — otherwise it would inject at runtime and override
  //     the SEO page's styling. IgnorePlugin drops that one import (no stub file
  //     needed). Main build is untouched — this is embed-only.
  config.plugins.push(new webpack.IgnorePlugin({
    resourceRegExp: /SwapWidget\.css$/,
    contextRegExp: /components/,
  }));

  // 6) Drop the HTML/manifest/service-worker plugins.
  config.plugins = (config.plugins || []).filter(
    (p) => p && p.constructor && !DROP_PLUGINS.has(p.constructor.name)
  );

  // 7) Source map for prod debugging (small extra .map file in embed_dist).
  config.devtool = env === 'production' ? 'source-map' : 'eval-source-map';

  return config;
};
