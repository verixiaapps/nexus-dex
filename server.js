// Load .env for local development (no-op in production where
// env vars are set through the hosting platform directly)
require('dotenv').config();

const express = require(‘express’);
const cors = require(‘cors’);
const path = require(‘path’);

const app = express();
const PORT = process.env.PORT || 3001;
// Check both naming conventions — REACT_APP_ prefix is React convention
// but server env vars on hosting platforms are often set without it
const OX_API_KEY = process.env.REACT_APP_0X_API_KEY || process.env.OX_API_KEY || ‘’;

// Fetch with a 10s timeout — prevents hanging requests if upstream API stalls
async function fetchWithTimeout(url, options, timeoutMs) {
timeoutMs = timeoutMs || 10000;
var controller = new AbortController();
var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
try {
var res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
return res;
} finally {
clearTimeout(timer);
}
}

// Parse upstream response safely — if upstream returns HTML (e.g. Cloudflare
// error page), response.json() would throw and lose the real error body.
async function safeJson(response) {
var text = await response.text();
try {
return { parsed: JSON.parse(text), raw: null };
} catch (e) {
return { parsed: null, raw: text };
}
}

app.use(cors());
app.use(express.json());

// Proxy all 0x API requests
app.get(’/api/0x/*’, async function(req, res) {
try {
var oxPath = req.path.replace(’/api/0x’, ‘’);
var queryString = req.url.includes(’?’) ? req.url.slice(req.url.indexOf(’?’)) : ‘’;
var url = ‘https://api.0x.org’ + oxPath + queryString;


var response = await fetchWithTimeout(url, {
  headers: {
    '0x-api-key': OX_API_KEY,
    '0x-version': 'v2',
    'Content-Type': 'application/json',
  },
});

var result = await safeJson(response);
if (result.parsed !== null) {
  return res.status(response.status).json(result.parsed);
}
return res.status(response.status).json({ error: 'Upstream returned non-JSON', body: result.raw });


} catch (e) {
if (e.name === ‘AbortError’) {
return res.status(504).json({ error: ‘0x API request timed out’ });
}
res.status(500).json({ error: e.message });
}
});

// Proxy Raydium API requests
app.get(’/api/raydium/*’, async function(req, res) {
try {
var raydiumPath = req.path.replace(’/api/raydium’, ‘’);
var queryString = req.url.includes(’?’) ? req.url.slice(req.url.indexOf(’?’)) : ‘’;
var url = ‘https://api-v3.raydium.io’ + raydiumPath + queryString;


var response = await fetchWithTimeout(url, {
  headers: { 'Content-Type': 'application/json' },
});

var result = await safeJson(response);
if (result.parsed !== null) {
  return res.status(response.status).json(result.parsed);
}
return res.status(response.status).json({ error: 'Upstream returned non-JSON', body: result.raw });
```

} catch (e) {
if (e.name === ‘AbortError’) {
return res.status(504).json({ error: ‘Raydium API request timed out’ });
}
res.status(500).json({ error: e.message });
}
});

// Catch unmatched /api/* routes — use app.all (not app.use) so it explicitly
// handles every HTTP method and avoids Express 4 prefix-matching edge cases.
// Must come before the static file handler so invalid API paths don’t fall
// through and receive index.html with a 200 status.
app.all(’/api/*’, function(req, res) {
res.status(404).json({ error: ’API route not found: ’ + req.path });
});

// Serve React build in production
app.use(express.static(path.join(__dirname, ‘build’)));
app.get(’*’, function(req, res) {
res.sendFile(path.join(__dirname, ‘build’, ‘index.html’));
});

app.listen(PORT, function() {
console.log(’Nexus DEX server running on port ’ + PORT);
if (!OX_API_KEY) {
console.warn(‘WARNING: No 0x API key found. Set REACT_APP_0X_API_KEY or OX_API_KEY in your environment.’);
}
});