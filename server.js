import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const OX_API_KEY = process.env.REACT_APP_0X_API_KEY || '';

app.use(cors());
app.use(express.json());

// Proxy all 0x API requests
app.get('/api/0x/*', async function(req, res) {
  try {
    const oxPath = req.path.replace('/api/0x', '');
    const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const url = 'https://api.0x.org' + oxPath + queryString;

    const response = await fetch(url, {
      headers: {
        '0x-api-key': OX_API_KEY,
        '0x-version': 'v2',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve React build
app.use(express.static(path.join(__dirname, 'build')));
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, function() {
  console.log('Nexus DEX server running on port ' + PORT);
});
