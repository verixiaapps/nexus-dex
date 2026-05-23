// ─── Replace formatEndDate (around line 70) ──────────────────────────────────
function formatEndDate(iso) {
  if (iso == null) return null;
  let d;
  if (typeof iso === 'number') {
    // Jupiter returns Unix seconds; JS Date wants ms.
    d = new Date(iso < 1e12 ? iso * 1000 : iso);
  } else {
    d = new Date(iso);
  }
  if (!Number.isFinite(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  if (ms < 60 * 60_000) return `Ends in ${Math.floor(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) {
    const h  = Math.floor(ms / 3_600_000);
    const mm = Math.floor((ms % 3_600_000) / 60_000);
    return `Ends in ${h}h ${mm}m`;
  }
  const mo  = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  return `Ends ${mo} ${day}`;
}

// ─── Replace pickEventFields (around line 215) ───────────────────────────────
function pickEventFields(ev) {
  const market = (ev.markets && ev.markets[0]) || ev.market || null;
  if (!market) return null;

  // Jupiter (polymarket-backed) returns prices in micro-USD (6 decimals).
  const fromMicro = v => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n > 1.5 ? n / 1e6 : n;   // tolerate either scale
  };
  const fromMicroVol = v => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n / 1e6;
  };

  const pricing = market.pricing || market;
  const yesPrice = fromMicro(pricing.buyYesPriceUsd ?? pricing.yesBuyPriceUsd ?? pricing.yesPrice ?? pricing.priceYes ?? 0);
  let   noPrice  = fromMicro(pricing.buyNoPriceUsd  ?? pricing.noBuyPriceUsd  ?? pricing.noPrice  ?? pricing.priceNo  ?? 0);
  if (!noPrice && yesPrice) noPrice = 1 - yesPrice;

  // Prefer event-level title (e.g. "2026 FIFA World Cup Winner"),
  // never the market-level title (which is the outcome name like "France").
  const meta  = ev.metadata || {};
  const title = meta.title || ev.title || ev.name || market.title || 'Untitled';
  const image = meta.imageUrl || ev.imageUrl || ev.image || ev.icon || market.imageUrl || market.image || null;

  return {
    eventId:   ev.eventId || ev.id || market.eventId,
    title,
    image,
    category:  String(ev.category || market.category || '').toLowerCase(),
    series:    ev.series || ev.seriesName || meta.series || null,
    closeTime: meta.closeTime || ev.closeTime || market.closeTime || ev.endDate || market.endDate || null,
    createdAt: ev.createdAt || market.createdAt || null,
    volume24h: fromMicroVol(ev.volume24hr || ev.volume24h || ev.volumeUsd || market.volume || 0),
    liquidity: fromMicroVol(ev.liquidity || market.liquidity || 0),
    market: {
      marketId: market.marketId || market.id,
      status:   market.status || 'open',
      result:   market.result || null,
      yesPrice, noPrice,
      yesPct:   Math.max(0, Math.min(99, Math.round(yesPrice * 100))),
      noPct:    Math.max(0, Math.min(99, Math.round(noPrice  * 100))),
    },
  };
}
