// wc-entry.js — bundles WalletConnect SDK into a single IIFE file.
// After build, window.__VerixiaWC exposes { UniversalProvider, WalletConnectModal, bs58 }

export { UniversalProvider } from '@walletconnect/universal-provider';
export { WalletConnectModal } from '@walletconnect/modal';
export { default as bs58 } from 'bs58';
