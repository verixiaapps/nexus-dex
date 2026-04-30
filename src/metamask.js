import { createSolanaClient } from '@metamask/connect-solana';

let metaMaskSolanaClient = null;

if (typeof window !== 'undefined' && window.ethereum && window.ethereum.isMetaMask) {
  try {
    metaMaskSolanaClient = createSolanaClient({
      appName: 'Nexus DEX',
      appUrl: 'https://swap.verixiaapps.com',
      appIcon: 'https://swap.verixiaapps.com/logo.png',
    });
  } catch (e) {
    console.warn('MetaMask Solana client init failed:', e);
  }
}

export { metaMaskSolanaClient };
