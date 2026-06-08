// config-overrides.embed.js — CRA override for the embed bundle.
//
// Usage: react-app-rewired build --config-overrides config-overrides.embed.js
//
// Produces build/embed/verixia-swap.js — a single self-contained IIFE
// that mounts the SwapWidget into #verixia-swap-root on any page.

const path = require('path');

module.exports = {
  webpack(config) {
    // Entry: src/embed/index.jsx
    config.entry = path.resolve(__dirname, 'src/embed/index.jsx');

    // Output: single file, no chunk splitting
    config.output = {
      ...config.output,
      path: path.resolve(__dirname, 'build/embed'),
      filename: 'verixia-swap.js',
      library: 'VerixiaSwap',
      libraryTarget: 'umd',
      publicPath: '/embed/',
    };

    // Disable code splitting — everything in one file
    config.optimization = {
      ...config.optimization,
      runtimeChunk: false,
      splitChunks: { cacheGroups: { default: false } },
    };

    // Disable CSS extraction — inline styles
    const MiniCssExtractPlugin = require('mini-css-extract-plugin');
    config.plugins = config.plugins.filter(
      (p) => !(p instanceof MiniCssExtractPlugin)
    );
    config.module.rules.forEach((rule) => {
      if (!rule.oneOf) return;
      rule.oneOf.forEach((oneOf) => {
        if (!oneOf.use) return;
        oneOf.use = oneOf.use.map((use) => {
          if (
            typeof use === 'object' &&
            use.loader &&
            use.loader.includes('mini-css-extract-plugin')
          ) {
            return { loader: require.resolve('style-loader') };
          }
          return use;
        });
      });
    });

    // Don't generate HTML for the embed
    const HtmlWebpackPlugin = require('html-webpack-plugin');
    config.plugins = config.plugins.filter(
      (p) => !(p instanceof HtmlWebpackPlugin)
    );

    // Remove GenerateSW / workbox (no service worker for embed)
    config.plugins = config.plugins.filter(
      (p) =>
        p.constructor.name !== 'GenerateSW' &&
        p.constructor.name !== 'InjectManifest' &&
        p.constructor.name !== 'WebpackManifestPlugin' &&
        p.constructor.name !== 'ManifestPlugin'
    );

    return config;
  },
};
