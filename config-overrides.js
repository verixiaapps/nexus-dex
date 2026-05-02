const webpack = require('webpack');

module.exports = function override(config) {
  // Spread existing fallbacks rather than overwriting -- preserves any
  // fallbacks CRA's webpack config already sets
  config.resolve.fallback = {
    ...(config.resolve.fallback || {}),
    // Core crypto/stream -- needed by @solana/web3.js and Raydium SDK
    crypto: require.resolve('crypto-browserify'),
    stream: require.resolve('stream-browserify'),
    buffer: require.resolve('buffer'),
    // HTTP -- needed by @solana/web3.js for RPC calls in the browser
    http: require.resolve('stream-http'),
    https: require.resolve('https-browserify'),
    // OS and path -- Raydium SDK uses these; false causes build errors
    os: require.resolve('os-browserify'),
    path: require.resolve('path-browserify'),
    // Assert and url -- needed by various web3 dependencies
    assert: require.resolve('assert'),
    url: require.resolve('url'),
    // These genuinely don't have browser equivalents
    fs: false,
    vm: false,
  };

  config.plugins.push(
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      // Omit .js extension -- more reliable across webpack 5 resolver configs
      process: 'process/browser',
    })
  );

  // Suppress source map warnings from large third-party packages
  config.ignoreWarnings = [/Failed to parse source map/];

  return config;
};
