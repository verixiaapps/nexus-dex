import React, { createContext, useContext } from ‘react’;
import { useWallet } from ‘@solana/wallet-adapter-react’;
import { useAccount, useWalletClient, useSwitchChain } from ‘wagmi’;

// Single wallet context for the entire Nexus DEX site.
// Wrap the app once in index.js and every component gets live wallet state
// without needing props passed down manually.
//
// Usage in any component:
//   import { useNexusWallet } from ‘./WalletContext’;
//   const { isConnected, publicKey, evmAddress } = useNexusWallet();

const WalletContext = createContext(null);

export function WalletContextProvider({ children }) {
const {
publicKey,
connected: solConnected,
sendTransaction,
signTransaction,
disconnect: solDisconnect,
wallet: solWallet,
} = useWallet();

const {
address: evmAddress,
isConnected: evmConnected,
chainId: evmChainId,
} = useAccount();

const { data: walletClient } = useWalletClient();
const { switchChain } = useSwitchChain();

const isConnected  = solConnected || evmConnected;
const walletAddress = solConnected && publicKey
? publicKey.toString()
: evmConnected && evmAddress
? evmAddress
: null;

const connectedWalletName = solConnected
? (solWallet?.adapter?.name || ‘Solana’)
: evmConnected
? ‘EVM Wallet’
: null;

return (
<WalletContext.Provider value={{
// Connection state
isConnected,
solConnected,
evmConnected,
isSolanaConnected: solConnected,

```
  // Addresses
  walletAddress,
  publicKey:  solConnected && publicKey ? publicKey : null,
  evmAddress: evmConnected ? evmAddress  : null,

  // Chain
  evmChainId,

  // Transaction signers
  walletClient,
  sendTransaction,
  signTransaction,
  switchChain,

  // Wallet name for display
  connectedWalletName,
}}>
  {children}
</WalletContext.Provider>
```

);
}

export function useNexusWallet() {
const ctx = useContext(WalletContext);
if (!ctx) throw new Error(‘useNexusWallet must be used inside WalletContextProvider’);
return ctx;
}