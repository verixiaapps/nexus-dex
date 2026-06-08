/**
 * Bundle the WalletConnect SDK into a single IIFE for the SEO template.
 *
 * Run:    node scripts/build-wc.js
 * Output: public/verixia-wc.js
 *
 * This runs BEFORE react-app-rewired build so the file lands in build/
 * alongside the rest of public/.
 */

const { build } = require('esbuild');
const path = require('path');

build({
  entryPoints: [path.join(__dirname, 'verixia-wc-entry.js')],
  bundle: true,
  outfile: path.join(__dirname, '..', 'public', 'verixia-wc.js'),
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    'global': 'globalThis',
  },
  logLevel: 'info',
}).then(() => {
  console.log('✓ public/verixia-wc.js built');
}).catch((err) => {
  console.error('✗ verixia-wc build failed:', err);
  process.exit(1);
});
