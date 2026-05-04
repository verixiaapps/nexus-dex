/**
* NEXUS DEX -- Backend Proxy Server
* 
* Responsibilities:
*   1. Proxy all third-party API calls so secrets never reach the browser.
*   2. Rate-limit per IP to protect API quotas.
*   3. CORS locked to our own domain in production.
*   4. Serve the built React app.
*   5. Healthcheck for Railway.
*
* Required env vars (server-side, NOT REACT_APP_ prefixed):
*   OX_API_KEY       -- 0x.org API key
*   PINATA_JWT       -- Pinata JWT for IPFS uploads
*   HELIUS_API_KEY   -- Helius Solana RPC key (optional, falls back to public)
*   MORALIS_API_KEY  -- Moralis API key for Portfolio EVM balances
*   ALLOWED_ORIGINS  -- comma-separated list of allowed origins
*                       (e.g. "https://swap.verixiaapps.com,http://localhost:3000")
*   PORT             -- provided by Railway
*
* Deprecated (kept temporarily for migration):
*   REACT_APP_0X_API_KEY      -- falls back to this if OX_API_KEY missing
*   REACT_APP_PINATA_JWT      -- falls back to this if PINATA_JWT missing
*   REACT_APP_MORALIS_API_KEY -- falls back to this if MORALIS_API_KEY missing
*/

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.set('trust proxy', 1);

const OX_API_KEY      = process.env.OX_API_KEY      || process.env.REACT_APP_0X_API_KEY      || '';
const PINATA_JWT      = process.env.PINATA_JWT      || process.env.REACT_APP_PINATA_JWT      || '';
const HELIUS_API_KEY  = process.env.HELIUS_API_KEY  || process.env.REACT_APP_HELIUS_API_KEY  || '';
const MORALIS_API_KEY = process.env.MORALIS_API_KEY || process.env.REACT_APP_MORALIS_API_KEY || '';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://swap.verixiaapps.com,http://localhost:3000')
 .split(',')
 .map((s) => s.trim())
 .filter(Boolean);

const corsOptions = {
 origin: (origin, callback) => {
   if (!origin) return callback(null, true);
   if (NODE_ENV !== 'production') return callback(null, true);
   if (allowedOrigins.includes(origin)) return callback(null, true);
   return callback(new Error('Not allowed by CORS: ' + origin));
 },
 credentials: false,
 methods: ['GET', 'POST', 'OPTIONS'],
 allowedHeaders: ['Content-Type', 'Accept'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '256kb' }));

const apiLimiter = rateLimit({
 windowMs: 60_000,
 max: 120,
 standardHeaders: true,
 legacyHeaders: false,
 message: { error: 'Too many requests, slow down.' },
});

const uploadLimiter = rateLimit({
 windowMs: 60_000,
 max: 10,
 standardHeaders: true,
 legacyHeaders: false,
 message: { error: 'Too many uploads, slow down.' },
});

app.use('/api/', apiLimiter);

async function fetchWithTimeout(url, options, timeoutMs) {
 timeoutMs = timeoutMs || 12_000;
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), timeoutMs);
 try {
   return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
 } finally {
   clearTimeout(timer);
 }
}

async function safeJson(response) {
 const text = await response.text();
 try {
   return { parsed: JSON.parse(text), raw: null };
 } catch (e) {
   return { parsed: null, raw: text };
 }
}

function scrubSecrets(s) {
 if (s == null) return '';
 return String(s)
   .replace(/api-key=[^&\s"']+/gi, 'api-key=***')
   .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
   .replace(/0x-api-key["':\s]+[^&\s"',}]+/gi, '0x-api-key=***');
}

function logError(tag, err) {
 const msg = scrubSecrets(err && err.message ? err.message : err);
 if (NODE_ENV === 'production') {
   console.warn('[' + tag + ']', msg);
 } else {
   const stack = err && err.stack ? scrubSecrets(err.stack) : '';
   console.error('[' + tag + ']', msg, stack ? '\n' + stack : '');
 }
}

app.get('/api/health', (req, res) => {
 res.json({
   ok: true,
   env: NODE_ENV,
   has: {
     ox:      Boolean(OX_API_KEY),
     pinata:  Boolean(PINATA_JWT),
     helius:  Boolean(HELIUS_API_KEY),
     moralis: Boolean(MORALIS_API_KEY),
   },
   time: new Date().toISOString(),
 });
});

async function proxy0x(req, res) {
 try {
   const subPath = req.path.replace('/api/0x', '');
   const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
   const url = 'https://api.0x.org' + subPath + queryString;

   const headers = {
     '0x-api-key': OX_API_KEY,
     '0x-version': 'v2',
     'Content-Type': 'application/json',
     Accept: 'application/json',
   };

   const fetchOpts = { method: req.method, headers };
   if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
     fetchOpts.body = JSON.stringify(req.body);
   }

   const response = await fetchWithTimeout(url, fetchOpts);
   const result = await safeJson(response);

   if (result.parsed !== null) {
     return res.status(response.status).json(result.parsed);
   }
   return res.status(response.status).json({
     error: 'Upstream returned non-JSON',
     body: result.raw && result.raw.slice(0, 500),
   });
 } catch (e) {
   if (e.name === 'AbortError') {
     return res.status(504).json({ error: '0x API request timed out' });
   }
   logError('0x', e);
   return res.status(500).json({ error: e.message || 'Unknown error' });
 }
}

app.get('/api/0x/*', proxy0x);
app.post('/api/0x/*', proxy0x);

app.get('/api/raydium/*', async (req, res) => {
 try {
   const subPath = req.path.replace('/api/raydium', '');
   const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
   const url = 'https://api-v3.raydium.io' + subPath + queryString;

   const response = await fetchWithTimeout(url, {
     method: 'GET',
     headers: { 'Content-Type': 'application/json' },
   });
   const result = await safeJson(response);

   if (result.parsed !== null) {
     return res.status(response.status).json(result.parsed);
   }
   return res.status(response.status).json({
     error: 'Upstream returned non-JSON',
     body: result.raw && result.raw.slice(0, 500),
   });
 } catch (e) {
   if (e.name === 'AbortError') {
     return res.status(504).json({ error: 'Raydium API request timed out' });
   }
   logError('raydium', e);
   return res.status(500).json({ error: e.message || 'Unknown error' });
 }
});

app.get('/api/lifi/*', async (req, res) => {
 try {
   const subPath = req.path.replace('/api/lifi', '');
   const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
   const url = 'https://li.quest/v1' + subPath + queryString;

   const response = await fetchWithTimeout(url, {
     method: 'GET',
     headers: { 'Content-Type': 'application/json' },
   });
   const result = await safeJson(response);

   if (result.parsed !== null) {
     return res.status(response.status).json(result.parsed);
   }
   return res.status(response.status).json({
     error: 'Upstream returned non-JSON',
     body: result.raw && result.raw.slice(0, 500),
   });
 } catch (e) {
   if (e.name === 'AbortError') {
     return res.status(504).json({ error: 'LiFi API request timed out' });
   }
   logError('lifi', e);
   return res.status(500).json({ error: e.message || 'Unknown error' });
 }
});

app.post('/api/solana-rpc', async (req, res) => {
 try {
   const url = HELIUS_API_KEY
     ? 'https://mainnet.helius-rpc.com/?api-key=' + HELIUS_API_KEY
     : 'https://api.mainnet-beta.solana.com';

   const response = await fetchWithTimeout(url, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(req.body || {}),
   }, 15_000);
   const result = await safeJson(response);

   if (result.parsed !== null) {
     return res.status(response.status).json(result.parsed);
   }
   return res.status(response.status).json({
     error: 'Upstream returned non-JSON',
     body: result.raw && result.raw.slice(0, 500),
   });
 } catch (e) {
   if (e.name === 'AbortError') {
     return res.status(504).json({ error: 'Solana RPC request timed out' });
   }
   logError('solana-rpc', e);
   return res.status(500).json({ error: e.message || 'Unknown error' });
 }
});

const upload = multer({
 storage: multer.memoryStorage(),
 limits: { fileSize: 5 * 1024 * 1024 },
 fileFilter: (req, file, cb) => {
   if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(file.mimetype || '')) {
     return cb(new Error('Only image files are allowed'));
   }
   cb(null, true);
 },
});

app.post('/api/pinata/json', uploadLimiter, async (req, res) => {
 try {
   if (!PINATA_JWT) return res.status(503).json({ error: 'Pinata not configured' });
   const { name, content } = req.body || {};
   if (!content || typeof content !== 'object') {
     return res.status(400).json({ error: 'Missing content' });
   }

   const response = await fetchWithTimeout('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       Authorization: 'Bearer ' + PINATA_JWT,
     },
     body: JSON.stringify({
       pinataContent: content,
       pinataMetadata: { name: (name || 'metadata').slice(0, 64) },
     }),
   }, 20_000);

   const result = await safeJson(response);
   if (result.parsed && result.parsed.IpfsHash) {
     return res.json({
       ipfsHash: result.parsed.IpfsHash,
       url: 'https://ipfs.io/ipfs/' + result.parsed.IpfsHash,
     });
   }
   return res.status(response.status).json({
     error: 'Pinata upload failed',
     detail: result.parsed || (result.raw && result.raw.slice(0, 300)),
   });
 } catch (e) {
   logError('pinata-json', e);
   return res.status(500).json({ error: e.message || 'Unknown error' });
 }
});

app.post('/api/pinata/file', uploadLimiter, upload.single('file'), async (req, res) => {
 try {
   if (!PINATA_JWT) return res.status(503).json({ error: 'Pinata not configured' });
   if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

   const fd = new FormData();
   const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
   fd.append('file', blob, req.file.originalname || 'upload');
   if (req.body && req.body.name) {
     fd.append('pinataMetadata', JSON.stringify({ name: String(req.body.name).slice(0, 64) }));
   }

   const response = await fetchWithTimeout('https://api.pinata.cloud/pinning/pinFileToIPFS', {
     method: 'POST',
     headers: { Authorization: 'Bearer ' + PINATA_JWT },
     body: fd,
   }, 30_000);

   const result = await safeJson(response);
   if (result.parsed && result.parsed.IpfsHash) {
     return res.json({
       ipfsHash: result.parsed.IpfsHash,
       url: 'https://ipfs.io/ipfs/' + result.parsed.IpfsHash,
     });
   }
   return res.status(response.status).json({
     error: 'Pinata upload failed',
     detail: result.parsed || (result.raw && result.raw.slice(0, 300)),
   });
 } catch (e) {
   logError('pinata-file', e);
   return res.status(500).json({ error: e.message || 'Unknown error' });
 }
});

const MORALIS_CHAIN_TO_ID = {
 eth: 1,
 polygon: 137,
 bsc: 56,
 avalanche: 43114,
 fantom: 250,
 cronos: 25,
 arbitrum: 42161,
 gnosis: 100,
 base: 8453,
 optimism: 10,
 linea: 59144,
 moonbeam: 1284,
 ronin: 2020,
 lisk: 1135,
 pulse: 369,
};

app.get('/api/moralis/wallet-tokens', async (req, res) => {
 try {
   if (!MORALIS_API_KEY) {
     return res.status(503).json({ error: 'Moralis not configured', tokens: [] });
   }

   const address = (req.query.address || '').toString().trim();
   if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
     return res.status(400).json({ error: 'Invalid EVM address', tokens: [] });
   }

   const chainsParam = (req.query.chains || 'eth,polygon,arbitrum,base,bsc,avalanche,optimism').toString();
   const chains = chainsParam
     .split(',')
     .map((s) => s.trim().toLowerCase())
     .filter((c) => MORALIS_CHAIN_TO_ID[c]);

   if (!chains.length) {
     return res.status(400).json({ error: 'No valid chains', tokens: [] });
   }

   const headers = {
     Accept: 'application/json',
     'X-API-Key': MORALIS_API_KEY,
   };

   const results = await Promise.allSettled(chains.map(async (chain) => {
     const url = 'https://deep-index.moralis.io/api/v2.2/wallets/' +
       encodeURIComponent(address) + '/tokens?chain=' + encodeURIComponent(chain) +
       '&exclude_spam=true&exclude_unverified_contracts=false';
     const r = await fetchWithTimeout(url, { method: 'GET', headers }, 15_000);
     const parsed = await safeJson(r);
     if (!r.ok || !parsed.parsed) {
       return { chain, items: [] };
     }
     return { chain, items: parsed.parsed.result || [] };
   }));

   const tokens = [];
   results.forEach((settled) => {
     if (settled.status !== 'fulfilled') return;
     const { chain, items } = settled.value;
     const chainId = MORALIS_CHAIN_TO_ID[chain];
     if (!chainId) return;

     items.forEach((t) => {
       const balanceFmt = parseFloat(t.balance_formatted || '0');
       if (!balanceFmt || balanceFmt <= 0) return;

       const usdPrice = parseFloat(t.usd_price || '0');
       const usdValue = parseFloat(t.usd_value || '0');
       const pct24h   = parseFloat(t.usd_price_24hr_percent_change || '0');

       tokens.push({
         chainId,
         contractAddress: t.native_token ? '' : (t.token_address || ''),
         symbol: t.symbol || '',
         name:   t.name   || t.symbol || '',
         logo:   t.logo   || t.thumbnail || null,
         balance: t.balance || '0',
         balanceFormatted: balanceFmt,
         decimals: parseInt(t.decimals || '18'),
         usdPrice,
         usdValue,
         pct24h,
         isNative: Boolean(t.native_token),
       });
     });
   });

   return res.json({ tokens });
 } catch (e) {
   if (e.name === 'AbortError') {
     return res.status(504).json({ error: 'Moralis request timed out', tokens: [] });
   }
   logError('moralis', e);
   return res.status(500).json({ error: e.message || 'Unknown error', tokens: [] });
 }
});

app.all('/api/*', (req, res) => {
 res.status(404).json({ error: 'API route not found: ' + req.path });
});

app.use(express.static(path.join(__dirname, 'build'), {
 maxAge: '7d',
 setHeaders: (res, filePath) => {
   if (filePath.endsWith('.html')) {
     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
   }
 },
}));

app.get('*', (req, res) => {
 res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.use((err, req, res, next) => {
 if (err && err.message && err.message.startsWith('Not allowed by CORS')) {
   return res.status(403).json({ error: 'CORS: origin not allowed' });
 }
 if (err && err.message === 'Only image files are allowed') {
   return res.status(400).json({ error: err.message });
 }
 if (err && err.code === 'LIMIT_FILE_SIZE') {
   return res.status(413).json({ error: 'File too large (max 5MB)' });
 }
 if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
   return res.status(400).json({ error: 'Unexpected file field -- use field name "file"' });
 }
 logError('unhandled', err);
 if (res.headersSent) return next(err);
 res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
 console.log('Nexus DEX server running on port ' + PORT);
 console.log('  env:             ' + NODE_ENV);
 console.log('  allowed origins: ' + allowedOrigins.join(', '));
 if (!OX_API_KEY)      console.warn('  WARNING: OX_API_KEY not set -- EVM swaps will fail');
 if (!PINATA_JWT)      console.warn('  WARNING: PINATA_JWT not set -- token launch metadata will fail');
 if (!HELIUS_API_KEY)  console.warn('  WARNING: HELIUS_API_KEY not set -- falling back to public Solana RPC');
 if (!MORALIS_API_KEY) console.warn('  WARNING: MORALIS_API_KEY not set -- Portfolio EVM balances will be empty');
});

process.on('uncaughtException',  (err) => logError('uncaughtException', err));
process.on('unhandledRejection', (err) => logError('unhandledRejection', err));
