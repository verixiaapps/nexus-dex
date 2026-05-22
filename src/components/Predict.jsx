// FINAL CLEAN ENDING OF Predict.jsx
// PASTE THIS AS THE VERY BOTTOM OF THE FILE
// DELETE EVERYTHING AFTER THIS

      {orderMarket && (
        <OrderDrawer
          market={orderMarket}
          side={orderSide}
          onClose={() => {
            setOrderMarket(null);
            refreshAll();
          }}
          evmAddress={evmAddress}
          getEvmProvider={getEvmProvider}
          safeAddress={safeAddress}
          tradingBalance={tradingBalance}
          onNeedFunds={() => {
            setOrderMarket(null);
            setFundOpen(true);
          }}
          refreshAll={refreshAll}
        />
      )}

      <FundingSheet
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        evmAddress={evmAddress}
        safeAddress={safeAddress}
        tradingBalance={tradingBalance}
        fundingPubkey={fundingPubkey}
        solBalance={solBalance}
        usdcBalance={usdcBalance}
        signSolanaTx={signSolanaTx}
        onReset={handleReset}
        refreshAll={refreshAll}
      />
    </>
  );
}

export default function Predict() {
  return <PredictInner />;
}