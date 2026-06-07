// config-overrides.embed.js
//
// react-app-rewired config for the EMBED build only.
//   npm run build:embed   ->  build/embed/verixia-swap.js  (single self-contained file)
//
// KEY FIX vs the previous version:
//   It now REUSES config-overrides.js first, so the embed bundle gets the
//   exact same polyfills, @web3modal stubs, `node:` scheme remap, .m?js rule,
//   and ESLint/ModuleScope removal as the main app. Without these the embed
//   build fails (e.g. `node:crypto`, unresolved `@web3modal/*`).
//
//   It also swaps MiniCssExtractPlugin for style-loader, so SwapWidget.css and
//   the wallet-adapter modal CSS are injected by the JS at runtime — making the
//   bundle truly self-contained (no separate .css the SEO page would have to load).

const path = require('path');

// Inherit ALL main-app overrides. This is the whole point of the fix.
const baseOverride = require('./config-overrides');

module.exports = function override(config, env) {
  // 1) Apply the main override first (polyfills, stubs, node: remap, rules, etc.)
  config = baseOverride(config, env);

  // 2) Entry: only the embed entry, not the full CRA app.
  config.entry = path.resolve(__dirname, 'src/embed/index.jsx');

  // 3) Output: one file under build/embed/.
  config.output = Object.assign({}, config.output, {
    path:          path.resolve(__dirname, 'build/embed'),
    filename:      'verixia-swap.js',
    chunkFilename: 'verixia-swap.[contenthash].chunk.js',
    publicPath:    '/embed/',
  });
  // The entry exposes window.VerixiaSwap itself; a webpack `library` target
  // would clobber it, so make sure none is set.
  delete config.output.library;
  delete config.output.libraryTarget;
  delete config.output.libraryExport;

  // 4) Single file: no code splitting, no separate runtime chunk.
  config.optimization = Object.assign({}, config.optimization || {}, {
    splitChunks: false,
    runtimeChunk: false,
  });

  // 5) Drop HTML/manifest plugins (JS-only) AND the MiniCssExtractPlugin
  //    (CSS will be injected via style-loader instead — see step 6).
  config.plugins = (config.plugins || []).filter(function (p) {
    const n = p && p.constructor && p.constructor.name;
    return n !== 'HtmlWebpackPlugin'
        && n !== 'InlineChunkHtmlPlugin'
        && n !== 'InterpolateHtmlPlugin'
        && n !== 'ManifestPlugin'
        && n !== 'WebpackManifestPlugin'
        && n !== 'MiniCssExtractPlugin';
  });

  // 6) Replace every MiniCssExtractPlugin.loader usage with style-loader.
  //    react-scripts depends on style-loader, so require.resolve finds it.
  let styleLoader;
  try {
    styleLoader = require.resolve('style-loader');
  } catch (e) {
    throw new Error(
      '[embed config] style-loader not found. Run `npm i -D style-loader` ' +
      '(react-app-rewired needs it to inline the embed CSS).'
    );
  }

  const isMiniCss = function (use) {
    const ldr = typeof use === 'string' ? use : (use && use.loader);
    return !!ldr && ldr.indexOf('mini-css-extract-plugin') !== -1;
  };

  const fixRule = function (rule) {
    if (!rule || typeof rule !== 'object') return;
    if (Array.isArray(rule.oneOf)) rule.oneOf.forEach(fixRule);
    if (Array.isArray(rule.rules)) rule.rules.forEach(fixRule);
    if (Array.isArray(rule.use)) {
      rule.use = rule.use.map(function (u) { return isMiniCss(u) ? { loader: styleLoader } : u; });
    } else if (isMiniCss(rule.use)) {
      rule.use = { loader: styleLoader };
    }
    if (isMiniCss(rule.loader)) {
      rule.loader = styleLoader;
      delete rule.options; // MiniCss options are invalid for style-loader
    }
  };
  (config.module.rules || []).forEach(fixRule);

  // 7) Source maps in production (small extra file, big debugging win).
  config.devtool = env === 'production' ? 'source-map' : 'eval-source-map';

  return config;
};
