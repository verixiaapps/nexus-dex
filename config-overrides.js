const path = require('path');
const webpack = require('webpack');

const NODE_POLYFILLS = {
  buffer:        require.resolve('buffer'),
  process:       require.resolve('process/browser.js'),
  crypto:        require.resolve('crypto-browserify'),
  stream:        require.resolve('stream-browserify'),
  http:          require.resolve('stream-http'),
  https:         require.resolve('https-browserify'),
  os:            require.resolve('os-browserify/browser'),
  path:          require.resolve('path-browserify'),
  assert:        require.resolve('assert'),
  url:           require.resolve('url'),
  util:          require.resolve('util'),
  zlib:          false,
  fs:            false,
  net:           false,
  tls:           false,
  child_process: false,
};

const NODE_SCHEME_MAP = {
  crypto:  require.resolve('crypto-browserify'),
  buffer:  require.resolve('buffer'),
  stream:  require.resolve('stream-browserify'),
  util:    require.resolve('util'),
  assert:  require.resolve('assert'),
  http:    require.resolve('stream-http'),
  https:   require.resolve('https-browserify'),
  os:      require.resolve('os-browserify/browser'),
  path:    require.resolve('path-browserify'),
  process: require.resolve('process/browser.js'),
  url:     require.resolve('url'),
  events:  require.resolve('events'),
};

module.exports = function override(config) {
  config.resolve = config.resolve || {};

  config.resolve.plugins = (config.resolve.plugins || []).filter(
    (p) => !p || !p.constructor || p.constructor.name !== 'ModuleScopePlugin'
  );

  config.plugins = (config.plugins || []).filter(
    (p) => !p || !p.constructor || p.constructor.name !== 'ESLintWebpackPlugin'
  );

  config.resolve.fallback = Object.assign({}, config.resolve.fallback || {}, NODE_POLYFILLS);

  config.plugins = (config.plugins || []).concat([
    new webpack.ProvidePlugin({
      Buffer:  ['buffer', 'Buffer'],
      process: 'process/browser.js',
    }),
    new webpack.NormalModuleReplacementPlugin(/^node:(.+)$/, (resource) => {
      const mod = resource.request.replace(/^node:/, '');
      if (NODE_SCHEME_MAP[mod]) resource.request = NODE_SCHEME_MAP[mod];
    }),
  ]);

  config.module = config.module || {};
  config.module.rules = (config.module.rules || []).concat([
    { test: /\.m?js$/, resolve: { fullySpecified: false } },
  ]);

  config.ignoreWarnings = (config.ignoreWarnings || []).concat([/Failed to parse source map/]);

  return config;
};
