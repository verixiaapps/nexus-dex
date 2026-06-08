/**
 * WalletConnect SDK bundle for Verixia SEO pages.
 *
 * Built via:  node scripts/build-wc.js
 * Output:     public/verixia-wc.js
 *
 * The vanilla swap widget in the SEO template reads window.__VerixiaWC
 * to access UniversalProvider, WalletConnectModal, and bs58.
 */

import { UniversalProvider } from '@walletconnect/universal-provider';
import { WalletConnectModal } from '@walletconnect/modal';
import bs58 from 'bs58';

window.__VerixiaWC = {
  UniversalProvider,
  WalletConnectModal,
  bs58,
};
