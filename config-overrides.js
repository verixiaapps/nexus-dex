const webpack = require('webpack');

module.exports = function override(config) {
  config.resolve.fallback = {
    ...(config.resolve.fallback || {}),
    crypto: require.resolve('crypto-browserify'),
    stream: require.resolve('stream-browserify'),
    buffer: require.resolve('buffer'),
    http: require.resolve('stream-http'),
    https: require.resolve('https-browserify'),
    os: require.resolve('os-browserify'),
    path: require.resolve('path-browserify'),
    assert: require.resolve('assert'),
    url: require.resolve('url'),
    fs: false,
    vm: false,
  };

  config.plugins.push(
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser.js',
    })
  );

  config.ignoreWarnings = [/Failed to parse source map/];

  return config;
};
