            }>Done</button>
          ) : (
            <button onClick={handleDeposit} disabled={isBusy || !amount || notEnoughSol} style={{
              width: '100%', padding: 16, borderRadius: 16, border: 'none',
              background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 15,
              cursor: isBusy || !amount || notEnoughSol ? 'not-allowed' : 'pointer',
              minHeight: 52, opacity: !amount || isBusy || notEnoughSol ? 0.55 : 1, ...T.display,
            }}>
              {isBusy ? 'Processing...' : 'Deposit to Trading Account'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* -- Trade Drawer ---------------------------------------------------- */
function TradeDrawer({
  open, onClose, pair, onConnectWallet, walletPubkey, marketData,
  hlWallet, setHlWallet,
  hlBalance, setHlBalance,
  positions, setPositions,
  solLamports, setSolLamports,
  solPrice,
  refreshAccount,
}) {
  const { connected, signMessage, publicKey } = useWallet();
  const { connection } = useConnection();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide]               = useState('long');
  const [solAmount, setSolAmount]     = useState('');
  const [leverage, setLeverage]       = useState(5);
  const [status, setStatus]           = useState('idle');
  const [statusMsg, setStatusMsg]     = useState('');
  const [error, setError]             = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [depositOpen,  setDepositOpen]  = useState(false);
  const [syncing,      setSyncing]      = useState(false);

  useBodyLock(open && !withdrawOpen && !depositOpen);

  // Auto-clamp leverage to the asset's max when switching markets. Prevents the
  // BTC-at-10x-leverage state from carrying into STABLE-max-3x and failing margin
  // check. Reset triggers on pair.id change (each market) and on pair.leverage
  // change (in case the cap updates from HL's meta).
  useEffect(() => {
    if (!pair?.leverage) return;
    setLeverage(prev => {
      const max = Math.max(1, Math.floor(pair.leverage));
      return prev > max ? max : prev;
    });
  }, [pair?.id, pair?.leverage]);

  const handleSync = async () => {
    if (!walletPubkey) return;
    if (!signMessage) { setError('Wallet does not support message signing'); return; }
    setSyncing(true); setError('');
    try {
      const wd = await deriveHLWallet(signMessage, walletPubkey);
      setHlWallet({ address: wd.address });
      await refreshAccount?.();
    } catch (e) {
      console.error('[sync]', e);
      setError(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const isLong       = side === 'long';
  const solVal       = parseFloat(solAmount) || 0;
  const usdAmount    = solVal * solPrice;
  const notionalUsd  = usdAmount * leverage;
  const entryPrice   = Number(pair?.price || 0);
  const liqPrice     = entryPrice > 0
    ? isLong ? entryPrice * (1 - 0.9 / leverage) : entryPrice * (1 + 0.9 / leverage)
    : 0;
  const solBalance   = solLamports / LAMPORTS_PER_SOL;
  const notEnoughSol = solVal > 0 && solVal > solBalance * 0.98;
  const fundingRate  = pair?.funding || 0;

  const quickPct = (p) => {
    const avail = (solLamports / LAMPORTS_PER_SOL) * 0.95;
    if (avail <= 0) return;
    setSolAmount((avail * p / 100).toFixed(4));
  };

  const execute = async () => {
    if (!wcon)            { onConnectWallet?.(); return; }
    if (!signMessage)     { setError('Wallet does not support message signing'); return; }
    if (!solVal || solVal < 0.01) { setError('Enter an amount'); return; }
    if (notEnoughSol)     { setError('Not enough SOL in your wallet'); return; }
    if (!pair?.price)     { setError('Price unavailable, try again'); return; }
    const usd = solVal * solPrice;
    if (usd < 10) { setError('Minimum trade is $10'); return; }

    setStatus('loading'); setError(''); setStatusMsg('');
    try {
      setStatusMsg('Setting up account...');
      const walletData = await deriveHLWallet(signMessage, walletPubkey);
      if (!hlWallet) setHlWallet({ address: walletData.address });

      let { balance: currentHlBal } = await fetchHlBalanceAndPositions(walletData.address);
      setHlBalance(currentHlBal);

      // Deposit margin if needed. Over-fund 5% to absorb Li.Fi fees + slippage so
      // the landed balance reliably covers the requested margin in one shot.
      if (currentHlBal < usd * 0.99) {
        const needed   = usd - currentHlBal;
        const lamports = Math.ceil((needed / solPrice) * LAMPORTS_PER_SOL * 1.05);
        setStatusMsg('Bridging SOL...');
        const { txHash } = await depositSolToHyperCore({
          solLamports: lamports,
          hlAddress:   walletData.address,
          solPubkey:   walletPubkey,
          onStatus:    setStatusMsg,
        });
        saveBridge('deposit', { txHash, usd: needed });
        setStatusMsg('Waiting for funds...');
        currentHlBal = await pollUntilFunded(walletData.address, usd);
        // Refetch once more in case the poll returned at the threshold
        const fresh = await fetchHlBalanceAndPositions(walletData.address);
        currentHlBal = fresh.balance;
        setHlBalance(currentHlBal);
        clearBridge('deposit');
      }

      setStatusMsg(`Opening ${isLong ? 'long' : 'short'}...`);
      // Cap margin at 98% of actual landed balance so HL always has a fee reserve.
      // Without this, the first trade after a bridge can fail with "insufficient margin"
      // because fees nibble a few cents off the deposit -- forcing the user to click twice.
      const safeMargin = Math.min(usd, currentHlBal * 0.98);
      if (safeMargin < 10) {
        throw new Error('Balance settled below minimum after fees. Wait a moment and try again.');
      }
      await placeOrder({ pair, isLong, usdAmount: safeMargin, leverage, hlWalletData: walletData });

      setStatus('success');
      setStatusMsg('');
      refreshAccount?.();
      setTimeout(() => { setStatus('idle'); onClose(); }, 2000);
    } catch (e) {
      console.error('[execute]', e);
      setError(e.message || 'Trade failed');
      setStatus('error');
      setStatusMsg('');
      clearBridge('deposit');
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  const closePosition = async (pos, posPair) => {
    const walletData = getSessionWallet(walletPubkey);
    if (!walletData?.privateKey) { setError('Session expired -- refresh page'); return; }
    const targetPair = posPair || marketData.find(p => p.id === pos.coin);
    if (!targetPair) { setError('Market data unavailable'); return; }

    setStatus('loading'); setError(''); setStatusMsg(`Closing ${pos.coin} position...`);
    try {
      await placeOrder({
        pair:       targetPair,
        isLong:     !pos.isLong,       // opposite side closes
        usdAmount:  pos.posValue,      // full position value
        leverage:   pos.leverage,
        reduceOnly: true,
        hlWalletData: walletData,
      });
      setStatus('success');
      setStatusMsg('');
      refreshAccount?.();
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      console.error('[close]', e);
      setError(e.message || 'Close failed');
      setStatus('error');
      setStatusMsg('');
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  if (!open || !pair) return null;
  const dayUp     = pair.change >= 0;
  const isBusy    = status === 'loading';
  const isSuccess = status === 'success';
  const isError   = status === 'error';
  const sessionWallet = getSessionWallet(walletPubkey);

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '14px 22px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Ticker symbol={pair.base} size={44}/>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: C.inkStr, fontWeight: 800, fontSize: 20, letterSpacing: '-.03em', ...T.display }}>{pair.base}</span>
                  <span style={{ color: C.hl, fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: C.hlDim, border: `1px solid ${C.borderHi}`, letterSpacing: '.06em', ...T.mono }}>PERP</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ color: C.ink, fontSize: 14, fontWeight: 700, ...T.mono }}>{fmt(pair.price, 2)}</span>
                  <span style={{ color: dayUp ? C.up : C.down, fontSize: 11, fontWeight: 700, ...T.mono }}>{pct(pair.change)}</span>
                  {fundingRate !== 0 && (
                    <span style={{ fontSize: 9, color: fundingRate >= 0 ? C.down : C.up, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: fundingRate >= 0 ? 'rgba(255,138,158,.10)' : 'rgba(61,213,152,.10)', ...T.mono }}>
                      Fr {fundingRate >= 0 ? '+' : ''}{(fundingRate * 100).toFixed(4)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 34, height: 34, borderRadius: 11, fontSize: 20, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.4 : 1 }}>X</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', marginTop: 14, padding: '10px 0', borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}` }}>
            {[
              ['1H',      pct(pair.change1h),      pair.change1h >= 0 ? C.up : C.down],
              ['VOLUME',  shortNum(pair.volume24h), C.ink],
              ['MAX LEV', `${pair.leverage}x`,      C.hl],
            ].map(([l, v, c], i) => (
              <div key={l} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{l}</div>
                <div style={{ fontSize: 12, color: c, fontWeight: 700, marginTop: 3, ...T.mono }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 22px calc(env(safe-area-inset-bottom) + 86px)' }}>

          {wcon && (
            <WalletPanel
              solLamports={solLamports} solPrice={solPrice}
              hlBalanceUsd={hlBalance} hlAddress={hlWallet?.address}
              onWithdraw={() => setWithdrawOpen(true)}
              onDeposit={() => setDepositOpen(true)}
              onSync={handleSync}
              syncing={syncing}
            />
          )}

          <PositionsPanel
            positions={positions}
            marketData={marketData}
            onClose={closePosition}
          />

          {/* Long / Short */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              ['long',  C.up,   'rgba(61,213,152,.10)',  'rgba(61,213,152,.42)'],
              ['short', C.down, 'rgba(255,138,158,.10)', 'rgba(255,138,158,.42)'],
            ].map(([s, color, bg, bdr]) => {
              const active = side === s;
              return (
                <button key={s} onClick={() => setSide(s)} disabled={isBusy} style={{
                  padding: 14, borderRadius: 14,
                  border: `1px solid ${active ? bdr : C.border}`,
                  background: active ? bg : 'rgba(255,255,255,.03)',
                  color: active ? color : C.muted,
                  fontWeight: 800, fontSize: 15, cursor: isBusy ? 'not-allowed' : 'pointer',
                  textTransform: 'capitalize', transition: 'all .15s',
                  boxShadow: active ? `0 0 20px ${color}1c` : 'none', ...T.display,
                }}>{s}</button>
              );
            })}
          </div>

          {/* Amount */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>MARGIN (SOL)</span>
              <span style={{ fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono }}>INSTANT FILL</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${notEnoughSol ? 'rgba(255,138,158,.40)' : C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 10, opacity: isBusy ? 0.6 : 1 }}>
              <input value={solAmount} onChange={e => { setSolAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy}
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 25, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg,#14f195,#9945ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: '#000' }}>O</div>
                <span style={{ fontSize: 12, color: C.ink, fontWeight: 700, ...T.mono }}>SOL</span>
              </div>
            </div>

            {solVal > 0 && solPrice > 0 && (
              <div style={{ marginBottom: 9, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, ...T.mono }}>
                <span>Margin ~ {fmt(usdAmount, 2)}</span>
                <span style={{ color: C.ink }}>Position ~ {fmt(notionalUsd, 2)}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => quickPct(p)} disabled={isBusy || !wcon} style={{
                  flex: 1, padding: '8px', borderRadius: 10, border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,.03)', color: C.muted,
                  fontWeight: 700, fontSize: 11, cursor: 'pointer',
                  opacity: isBusy || !wcon ? 0.4 : 1, ...T.mono,
                }}>{p === 100 ? 'Max' : p + '%'}</button>
              ))}
            </div>

            {notEnoughSol && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.28)', borderRadius: 10 }}>
                <div style={{ fontSize: 12, color: C.down, fontWeight: 700, ...T.body }}>Not enough SOL</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.body }}>Add more SOL to your wallet. You have {solBalance.toFixed(4)} SOL.</div>
              </div>
            )}
          </div>

          {/* Leverage */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>LEVERAGE</span>
              <span style={{ fontSize: 13, color: C.hl, fontWeight: 800, padding: '4px 10px', borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, ...T.mono }}>{leverage}x</span>
            </div>
            <input type="range" min="1" max={pair.leverage} value={leverage} onChange={e => setLeverage(Number(e.target.value))} disabled={isBusy} style={{ width: '100%', height: 6, padding: '8px 0' }}/>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 9, color: C.muted2, ...T.mono }}>
              <span style={{ fontWeight: 700 }}>1x</span>
              <span>Conservative | Balanced | Aggressive</span>
              <span style={{ fontWeight: 700 }}>{pair.leverage}x</span>
            </div>
          </div>

          {/* Order summary */}
          {solVal > 0 && solPrice > 0 && entryPrice > 0 && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
              {[
                ['Margin',        fmt(usdAmount, 2)],
                ['Position size', roundSize(notionalUsd / entryPrice, pair.szDecimals) + ' ' + pair.base],
                ['Limit price',   fmt(Number(aggressivePx(entryPrice, isLong, pair.szDecimals)))],
                ['Liquidation',   fmt(liqPrice, 4)],
                ['Funding rate',  (fundingRate >= 0 ? '+' : '') + (fundingRate * 100).toFixed(4) + '% / h'],
              ].map(([l, v], i, a) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < a.length - 1 ? `1px solid ${C.hairline}` : 'none' }}>
                  <span style={{ color: C.muted, fontSize: 12, ...T.body }}>{l}</span>
                  <span style={{ color: l === 'Funding rate' ? (fundingRate >= 0 ? C.down : C.up) : C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* Status */}
          {(isBusy || isSuccess) && statusMsg && (
            <div style={{ marginBottom: 12, padding: 12, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
            </div>
          )}
          {error && <div style={{ marginBottom: 12, padding: 11, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

          {/* CTA */}
          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} style={{ width: '100%', padding: 17, borderRadius: 16, border: 'none', background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`, color: '#04070f', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 56, letterSpacing: '-.01em', ...T.display }}>
              Connect Solana Wallet
            </button>
          ) : (
            <button onClick={execute} disabled={isBusy || notEnoughSol || !solAmount} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: isSuccess ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)` : isError ? `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)` : isLong ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)` : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: isBusy || notEnoughSol || !solAmount ? 'not-allowed' : 'pointer',
              minHeight: 56, opacity: !solAmount || notEnoughSol ? 0.55 : 1,
              boxShadow: isLong ? '0 12px 30px rgba(61,213,152,.22)' : '0 12px 30px rgba(255,138,158,.24)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {isBusy ? 'Processing...' : isSuccess ? `${isLong ? 'Long' : 'Short'} opened` : isError ? 'Retry' : isLong ? `Long ${pair.base} | ${leverage}x` : `Short ${pair.base} | ${leverage}x`}
            </button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 14, fontWeight: 600, ...T.mono }}>
            Non-custodial | Powered by Hyperliquid &amp; Li.Fi
          </div>
        </div>
      </div>

      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        hlAddress={hlWallet?.address || ''}
        hlPrivateKey={sessionWallet?.privateKey || ''}
        hlBalance={hlBalance}
        walletPubkey={walletPubkey}
      />

      <DepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        walletPubkey={walletPubkey}
        hlWallet={hlWallet} setHlWallet={setHlWallet}
        solLamports={solLamports} solPrice={solPrice}
        signMessage={signMessage}
        refreshAccount={refreshAccount}
      />
    </>
  );
}

/* -- Main page ------------------------------------------------------- */
export default function PerpsTrade({ onConnectWallet }) {
  const [oneHourMap, setOneHourMap] = useState({});
  const [sparkMap,   setSparkMap]   = useState({});
  const [allPerps,   setAllPerps]   = useState([]);
  const allPerpsRef = useRef(allPerps);
  useEffect(() => { allPerpsRef.current = allPerps; }, [allPerps]);

  const [marketData, setMarketData] = useState(() =>
    PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0, change1h: 0, spark: [], volume24h: 0, openInterest: 0, funding: 0, assetIndex: null, szDecimals: 4 }))
  );
  const [activePair, setActivePair] = useState(marketData[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter]         = useState('All');
  const [spotSymbols, setSpotSymbols] = useState(() => new Set());

  const { publicKey: solPk, wallet: solWallet } = useWallet();
  const { connection } = useConnection();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  /* -- Trading account state (lifted up so it loads before drawer opens) */
  const [hlWallet, setHlWallet]       = useState(null);
  const [hlBalance, setHlBalance]     = useState(0);
  const [positions, setPositions]     = useState([]);
  const [solLamports, setSolLamports] = useState(0);
  const [solPrice, setSolPrice]       = useState(0);

  // INSTANT first paint: hydrate from localStorage cache before any network call.
  useEffect(() => {
    if (!walletPubkey) return;
    const addr = getResolvedHlAddress(walletPubkey);
    if (addr) setHlWallet({ address: addr });
    const cached = loadCachedAccount(walletPubkey);
    if (cached) {
      if (typeof cached.balance === 'number')         setHlBalance(cached.balance);
      if (Array.isArray(cached.positions))            setPositions(cached.positions);
      if (typeof cached.solLamports === 'number')     setSolLamports(cached.solLamports);
      if (typeof cached.solPrice === 'number' && cached.solPrice > 0) setSolPrice(cached.solPrice);
    }
  }, [walletPubkey]);

  // Background fetch + 10s poll. Kicks off the moment the wallet is connected --
  // does NOT wait for the trade drawer to open.
  const refreshAccount = useCallback(async () => {
    if (!walletPubkey) return;
    const addr = getResolvedHlAddress(walletPubkey);
    if (addr && !hlWallet) setHlWallet({ address: addr });
    const [lam, price, bp] = await Promise.all([
      solPk ? fetchSolBalance(connection, solPk) : Promise.resolve(0),
      fetchSolPrice().catch(() => 0),
      addr ? fetchHlBalanceAndPositions(addr) : Promise.resolve(null),
    ]);
    setSolLamports(lam);
    if (price > 0) setSolPrice(price);
    if (bp) { setHlBalance(bp.balance); setPositions(bp.positions); }
    saveCachedAccount(walletPubkey, {
      balance:     bp?.balance ?? 0,
      positions:   bp?.positions ?? [],
      solLamports: lam,
      solPrice:    price > 0 ? price : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletPubkey, solPk, connection]);

  useEffect(() => {
    if (!walletPubkey) return;
    let alive = true;
    const tick = () => { if (alive) refreshAccount(); };
    tick();
    const id = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [walletPubkey, refreshAccount]);

  // Resume in-flight deposit (page refresh mid-bridge)
  useEffect(() => {
    if (!walletPubkey) return;
    const addr = getResolvedHlAddress(walletPubkey);
    const inFlight = loadBridge('deposit');
    if (!addr || !inFlight) return;
    let alive = true;
    pollUntilFunded(addr, inFlight.usd)
      .then(bal => { if (alive) { setHlBalance(bal); clearBridge('deposit'); } })
      .catch(() => { if (alive) clearBridge('deposit'); });
    return () => { alive = false; };
  }, [walletPubkey]);

  // Ethers preload (still used for HL withdrawal signing)
  useEffect(() => { getEthers().catch(() => {}); }, []);

  // Configure Li.Fi SDK once + (re)register Solana provider when the wallet adapter changes.
  // executeRoute() will then trigger one popup on the user's Solana wallet for the bridge.
  useEffect(() => {
    ensureLifiConfig();
    if (!solWallet?.adapter) return;
    try {
      lifiConfig.setProviders([
        LifiSolana({
          async getWalletAdapter() {
            return solWallet.adapter;
          },
        }),
      ]);
    } catch (e) {
      console.warn('[lifi setProviders]', e);
    }
  }, [solWallet?.adapter]);

  // Single consolidated market poll: one API hit -> both marketData (curated)
  // and allPerps (full universe). Falls back to keeping prior good data on
  // transient errors (no zero-flicker).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const { curated, all } = await fetchMarketSnapshot({ spotSymbols, oneHourMap, sparkMap });
        if (alive) { setMarketData(curated); setAllPerps(all); }
      } catch (e) {
        console.warn('[market poll]', e?.message || e);
        // keep prior state - don't wipe to zeros
      }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotSymbols, oneHourMap, sparkMap]);

  // 1-hour change map (slow). Only fetches change data for curated pairs.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (!marketData.length) return;
      try {
        const map = await fetchOneHourMap(marketData);
        if (!alive) return;
        setOneHourMap(map);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 120_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sparkline map (slowest). Fetched once on mount, then every 5 min.
  // Covers curated markets AND top-by-asset-index so the New tab gets charts.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const allNow = allPerpsRef.current || [];
      if (!marketData.length && !allNow.length) return;
      try {
        // Top 8 by asset index desc -> covers everything visible in the New tab
        const newest = [...allNow]
          .filter(p => p.hasSpot && p.volume24h >= 500_000 && p.price > 0)
          .sort((a, b) => (b.assetIndex || 0) - (a.assetIndex || 0))
          .slice(0, 8);
        const seen = new Set();
        const combined = [];
        [...marketData, ...newest].forEach(p => {
          if (!seen.has(p.id)) { seen.add(p.id); combined.push(p); }
        });
        const map = await fetchSparkMap(combined);
        if (!alive) return;
        setSparkMap(map);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 300_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch sparks the first time allPerps populates (otherwise New-tab charts
  // stay empty for up to 5 min until the next interval tick).
  const sparkSeededRef = useRef(false);
  useEffect(() => {
    if (sparkSeededRef.current) return;
    if (allPerps.length === 0) return;
    sparkSeededRef.current = true;
    (async () => {
      try {
        const newest = [...allPerps]
          .filter(p => p.hasSpot && p.volume24h >= 500_000 && p.price > 0)
          .sort((a, b) => (b.assetIndex || 0) - (a.assetIndex || 0))
          .slice(0, 8);
        const seen = new Set();
        const combined = [];
        [...marketData, ...newest].forEach(p => {
          if (!seen.has(p.id)) { seen.add(p.id); combined.push(p); }
        });
        const map = await fetchSparkMap(combined);
        setSparkMap(prev => ({ ...prev, ...map }));
      } catch {}
    })();
  }, [allPerps, marketData]);

  useEffect(() => {
    if (!activePair?.id) return;
    const fresh = marketData.find(p => p.id === activePair.id);
    if (fresh) setActivePair(fresh);
  }, [marketData, activePair?.id]);

  // Spot universe (very slow-changing, used to flag perps with a spot pair)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const s = await fetchSpotSymbols(); if (alive) setSpotSymbols(s); }
      catch {}
    };
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'New')     return filterNewListings(allPerps);
    if (filter === 'Hot')     return marketData.filter(p => p.hot);
    if (filter === 'Gainers') return [...marketData].filter(p => p.change > 0).sort((a, b) => b.change - a.change);
    if (filter === 'Losers')  return [...marketData].filter(p => p.change < 0).sort((a, b) => a.change - b.change);
    return marketData;
  }, [marketData, allPerps, filter]);

  const totalVol = marketData.reduce((s, p) => s + Number(p.volume24h || 0), 0);
  const gainers  = marketData.filter(p => p.change > 0).length;
  const openTrade = (pair) => { setActivePair(pair); setDrawerOpen(true); };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nexus-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nexus-spin  { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; } input[type="range"]{-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.07);border-radius:99px;outline:none;} input[type="range"]::-webkit-slider-runnable-track{height:6px;border-radius:99px;background:rgba(255,255,255,.07);} input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;border-radius:50%;background:#fff;cursor:grab;border:2.5px solid #97fce4;box-shadow:0 0 0 4px rgba(151,252,228,.10),0 0 16px rgba(151,252,228,.55),0 2px 6px rgba(0,0,0,.35);margin-top:-8px;transition:transform .12s;} input[type="range"]::-webkit-slider-thumb:active{cursor:grabbing;transform:scale(1.08);} input[type="range"]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;cursor:grab;border:2.5px solid #97fce4;}`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', marginBottom: 16 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.hl, boxShadow: `0 0 10px ${C.hl}`, animation: 'nexus-pulse 2s ease-in-out infinite' }}/>
              <span style={{ color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>POWERED BY HYPERLIQUID</span>
            </div>
            <h1 style={{ fontSize: 34, lineHeight: 1.0, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.045em', ...T.hero }}>
              Trade{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>perpetuals</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 18px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
              Connect your Solana wallet. Pick a market. Long or short -- that's it.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '12px 14px', borderRadius: 14, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}` }}>
              {[{ label: 'MARKETS', value: marketData.length || '-' }, { label: '24H VOL', value: shortNum(totalVol) }, { label: 'GAINERS', value: `${gainers}/${marketData.length}` }].map((s, i) => (
                <div key={s.label} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, letterSpacing: '-.03em', ...T.display }}>Markets</div>
            <div style={{ color: C.muted2, fontSize: 10, fontWeight: 600, marginTop: 2, ...T.mono }}>Tap any market to trade</div>
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {['All', 'New', 'Hot', 'Gainers', 'Losers'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{ padding: '7px 11px', borderRadius: 999, border: `1px solid ${filter === f ? C.borderHi : C.border}`, background: filter === f ? C.hlDim : 'rgba(255,255,255,.03)', color: filter === f ? C.hl : C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.body }}>{f}</button>
            ))}
          </div>
        </div>

        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 18, backdropFilter: 'blur(12px)' }}>
          {filtered.map(p => <MarketRow key={p.id} pair={p} onClick={() => openTrade(p)}/>)}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>HYPERLIQUID</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>

        <TradeDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          pair={activePair}
          onConnectWallet={onConnectWallet}
          walletPubkey={walletPubkey}
          marketData={marketData}
          hlWallet={hlWallet} setHlWallet={setHlWallet}
          hlBalance={hlBalance} setHlBalance={setHlBalance}
          positions={positions} setPositions={setPositions}
          solLamports={solLamports} setSolLamports={setSolLamports}
          solPrice={solPrice}
          refreshAccount={refreshAccount}
        />
      </div>
    </>
  );
}
