/* ============================================================================
 * seo-protect.js — kills cached service workers + protects SEO slug pages
 *
 * Add ONE line to server.js, BEFORE all the express.static / slug-handler /
 * SPA-catchall blocks:
 *
 *     require('./seo-protect')(app);
 *
 * What it does:
 *   1. Serves a self-unregistering "tombstone" service worker at every path a
 *      CRA / older deploy may have registered one (/service-worker.js, /sw.js,
 *      /serviceWorker.js). Browsers that previously cached a service worker
 *      will fetch the new one, it unregisters itself, clears all caches, and
 *      then reloads open tabs. After that the redirect is gone forever.
 *   2. Intercepts requests for SEO slug pages (both /<slug>/ and
 *      /<slug>/index.html) and injects an inline unregister-script at the top
 *      of <head>. Belt and suspenders — works even if the user never visits
 *      the SW URL directly.
 *   3. Sends no-cache headers on SEO HTML so a fixed page replaces the broken
 *      one in browser cache on next load.
 *
 * Safe to deploy: does not touch your React build, your API routes, or the
 * dynamic /nexus-dex/defi/* router. Only acts on bare-slug paths.
 * ========================================================================== */

const fs   = require('fs');
const path = require('path');

const TOMBSTONE_SW = `// Verixia SW tombstone — unregister + clear caches + reload
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', async (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => { try { c.navigate(c.url); } catch (e) {} });
    } catch (e) {}
  })());
});
self.addEventListener('fetch', () => {}); // do not intercept anything
`;

const UNREGISTER_INLINE = `<script>
(function(){
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(rs){
        rs.forEach(function(r){ try { r.unregister(); } catch(e){} });
      }).catch(function(){});
    }
    if (window.caches && caches.keys) {
      caches.keys().then(function(ks){
        ks.forEach(function(k){ try { caches.delete(k); } catch(e){} });
      }).catch(function(){});
    }
  } catch(e){}
})();
</script>`;

const SW_PATHS = ['/service-worker.js', '/sw.js', '/serviceWorker.js'];

// Reserved top-level paths the slug handler should NOT touch.
const RESERVED = new Set([
  'api', 'health', 'embed', 'debug-seo', 'static', 'assets',
  'nexus-dex', 'favicon.ico', 'robots.txt', 'sitemap.xml',
  'manifest.json', 'service-worker.js', 'sw.js', 'serviceWorker.js',
  'og', 'images', 'fonts',
]);

// Matches `/slug` and `/slug/` and `/slug/index.html`
const SLUG_RE = /^\/([a-z0-9][a-z0-9-]*)(?:\/(?:index\.html)?)?$/i;

function serveSeoHtml(filePath, res) {
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      res.status(500).send('SEO read error');
      return;
    }
    let out = html;
    if (/<head[^>]*>/i.test(out)) {
      out = out.replace(/<head[^>]*>/i, (m) => m + '\n' + UNREGISTER_INLINE);
    } else if (/<html[^>]*>/i.test(out)) {
      out = out.replace(/<html[^>]*>/i, (m) => m + '\n<head>' + UNREGISTER_INLINE + '</head>');
    } else {
      out = UNREGISTER_INLINE + out;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(out);
  });
}

module.exports = function attachSeoProtect(app) {
  // 1) Tombstone service worker at every known SW path
  SW_PATHS.forEach((p) => {
    app.get(p, (req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
      res.send(TOMBSTONE_SW);
    });
  });

  // 2) Bare-slug + /<slug>/index.html handler with SW-killer injection
  app.get(SLUG_RE, (req, res, next) => {
    const slug = (req.params[0] || '').toLowerCase();
    if (!slug || RESERVED.has(slug)) return next();

    const candidates = [
      path.join(__dirname, 'public', slug, 'index.html'),
      path.join(__dirname, 'build',  slug, 'index.html'),
    ];

    (function tryNext(i) {
      if (i >= candidates.length) return next();
      fs.access(candidates[i], fs.constants.R_OK, (err) => {
        if (err) return tryNext(i + 1);
        serveSeoHtml(candidates[i], res);
      });
    })(0);
  });

  console.log('[seo-protect] attached: SW tombstone + slug-page injector');
};
