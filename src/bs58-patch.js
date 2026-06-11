/**
 * bs58 override — defensive patch
 *
 * Some env var or hardcoded value contains a non-base58 character (likely
 * `0`, `O`, `I`, `l`, whitespace, quotes, or an `0x`/hex string). That
 * makes `new PublicKey(...)` throw at module load and produce a blank
 * screen.
 *
 * This patch:
 *   1. Wraps bs58.decode so bad input no longer crashes the bundle.
 *   2. Returns a 32-byte zero buffer (System Program address) as a safe
 *      fallback, so callers that build a PublicKey get a valid-shape value
 *      instead of an exception.
 *   3. Records every bad input on `window.__BS58_BAD__` and prints a
 *      visible red banner at the top of the page listing them, so you can
 *      see exactly which value is invalid.
 *
 * IMPORTANT: import this FIRST in src/index.js, before any other import:
 *
 *     import './bs58-patch.js';
 *     import React from 'react';
 *     // ...rest of imports
 *
 * Remove the import once the bad value is fixed.
 */

import bs58 from 'bs58';

if (typeof window !== 'undefined') {
  window.__BS58_BAD__ = window.__BS58_BAD__ || [];
}

const ZERO_32 = new Uint8Array(32); // System Program 11111111111111111111111111111111

const origDecode = bs58.decode;
bs58.decode = function patchedDecode(input) {
  try {
    return origDecode.call(this, input);
  } catch (e) {
    const sample = typeof input === 'string' ? input : String(input);
    const record = {
      input: sample.slice(0, 200),
      length: sample.length,
      stack: (new Error()).stack,
      time: new Date().toISOString(),
    };
    if (typeof window !== 'undefined') {
      window.__BS58_BAD__.push(record);
      showBanner();
    }
    // eslint-disable-next-line no-console
    console.warn('[bs58-patch] bad input intercepted:', sample.slice(0, 80));
    return ZERO_32;
  }
};

function showBanner() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('__bs58_banner__');
  if (!el) {
    el = document.createElement('div');
    el.id = '__bs58_banner__';
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
      'background:#3a0a0a;color:#ffb4b4;border-bottom:2px solid #ff4444;' +
      'padding:8px 12px;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;' +
      'max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-all';
    function attach() {
      if (document.body) document.body.appendChild(el);
      else document.addEventListener('DOMContentLoaded', attach);
    }
    attach();
  }
  const list = (window.__BS58_BAD__ || [])
    .map((r, i) =>
      '#' + (i + 1) + ' [' + r.length + ' chars] "' + r.input + '"\n' +
      r.stack.split('\n').slice(1, 6).join('\n')
    )
    .join('\n\n---\n\n');
  el.textContent =
    '⚠️ bs58.decode received invalid base58 input. App is running with zero-address fallback.\n\n' +
    list;
}
 