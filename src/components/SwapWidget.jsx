/**
 * NEXUS DEX - Unified Swap Widget (OKX DEX edition)
 *
 * Swap engine: OKX DEX API
 *   Solana swaps  -> /api/okx/dex/aggregator/swap-instruction
 *   EVM swaps     -> /api/okx/dex/aggregator/swap
 * 
 * Price data: DexScreener (replaces LiFi + Helius)
 * Token search: OKX (Solana) + DexScreener (all chains)
 * OKX referrer tag added to all OKX requests.
 * Fees injected server-side in server.js.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { useAccount, useWalletClient, useBalance, useSwitchChain, usePublicClient } from 'wagmi';
import {
  VersionedTransaction, PublicKey, LAMPORTS_PER_SOL,
  TransactionInstruction, TransactionMessage, AddressLookupTableAccount,
} from '@solana/web3.js';

const OKX_REFERRER = 'nexus-dex';
const PLATFORM_FEE = 0.03;
const SAFETY_FEE   = 0.02;
const TOTAL_FEE    = PLATFORM_FEE + SAFETY_FEE;
const OKX_SOL_NATIVE = '11111111111111111111111111111111';
const OKX_EVM_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const WSOL_MINT  = 'So11111111111111111111111111111111111111112';

const OKX_EVM_CHAINS = new Set([1, 10, 56, 130, 137, 146, 324, 1101, 5000, 8453, 34443, 42161, 43114, 57073, 59144, 80094, 81457, 534352, 1329, 2741]);

const SOL_RESERVE_LAMPORTS   = 5_000_000;
const EVM_NATIVE_RESERVE_PCT = 0.005;
const QUOTE_DEBOUNCE_MS      = 250;
const PRICE_CACHE_TTL_MS     = 60_000;

const CHAIN_NAMES = { 1:'Ethereum',10:'Optimism',56:'BNB Chain',100:'Gnosis',130:'Unichain',137:'Polygon',146:'Sonic',250:'Fantom',324:'zkSync Era',2741:'Abstract',5000:'Mantle',8453:'Base',34443:'Mode',42161:'Arbitrum',43114:'Avalanche',57073:'Ink',59144:'Linea',80094:'Berachain',81457:'Blast',534352:'Scroll',1329:'SEI',1101:'Polygon zkEVM' };
const CHAIN_SHORT = { 1:'ETH',10:'OP',56:'BNB',130:'UNI',137:'POL',146:'SONIC',324:'zkSync',2741:'ABS',5000:'MNT',8453:'BASE',34443:'MODE',42161:'ARB',43114:'AVAX',57073:'INK',59144:'LINEA',80094:'BERA',81457:'BLAST',534352:'SCROLL',1329:'SEI',1101:'POL-ZK' };

const USDC_BY_CHAIN = { 1:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',10:'0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',56:'0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',137:'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',8453:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',42161:'0xaf88d065e77c8cC2239327C5EDb3A432268e5831',43114:'0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' };
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEXSCREENER_BASE = '/api/dexscreener';

const DEFAULT_BUY_PRESETS  = [25,50,100,250,500];
const DEFAULT_SELL_PRESETS = [50,100];
const PRESETS_LS_KEY = 'nexus_presets_v2';
const LAST_PAIR_LS_KEY = 'nexus_last_pair_v1';

const C = { bg:'#03060f',card:'#080d1a',card2:'#0c1220',card3:'#111d30',border:'rgba(0,229,255,0.10)',borderHi:'rgba(0,229,255,0.25)',accent:'#00e5ff',green:'#00ffa3',red:'#ff3b6b',text:'#cdd6f4',muted:'#586994',muted2:'#2e3f5e',buyGrad:'linear-gradient(135deg,#00e5ff,#0055ff)',sellGrad:'linear-gradient(135deg,#ff3b6b,#cc1144)',privy:'#a855f7' };

const POPULAR_TOKENS = [
  { mint:WSOL_MINT,symbol:'SOL',name:'Solana',decimals:9,chain:'solana',logoURI:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'},
  { mint:USDC_SOLANA,symbol:'USDC',name:'USD Coin',decimals:6,chain:'solana'},
  { address:NATIVE_EVM,chainId:1,symbol:'ETH',name:'Ethereum',decimals:18,chain:'evm'},
  { address:NATIVE_EVM,chainId:8453,symbol:'ETH',name:'ETH (Base)',decimals:18,chain:'evm'},
  { address:NATIVE_EVM,chainId:42161,symbol:'ETH',name:'ETH (Arbitrum)',decimals:18,chain:'evm'},
  { address:NATIVE_EVM,chainId:10,symbol:'ETH',name:'ETH (Optimism)',decimals:18,chain:'evm'},
  { address:NATIVE_EVM,chainId:56,symbol:'BNB',name:'BNB',decimals:18,chain:'evm'},
  { address:NATIVE_EVM,chainId:137,symbol:'POL',name:'Polygon',decimals:18,chain:'evm'},
  { address:NATIVE_EVM,chainId:43114,symbol:'AVAX',name:'Avalanche',decimals:18,chain:'evm'},
  { address:USDC_BY_CHAIN[1],chainId:1,symbol:'USDC',name:'USDC (ETH)',decimals:6,chain:'evm'},
  { address:USDC_BY_CHAIN[8453],chainId:8453,symbol:'USDC',name:'USDC (Base)',decimals:6,chain:'evm'},
  { address:USDC_BY_CHAIN[42161],chainId:42161,symbol:'USDC',name:'USDC (Arbitrum)',decimals:6,chain:'evm'},
];

const _NATIVE_BY_CHAIN = { 1:{symbol:'ETH',name:'Ethereum'},56:{symbol:'BNB',name:'BNB'},137:{symbol:'POL',name:'Polygon'},43114:{symbol:'AVAX',name:'Avalanche'},8453:{symbol:'ETH',name:'ETH (Base)'},42161:{symbol:'ETH',name:'ETH (Arbitrum)'},10:{symbol:'ETH',name:'ETH (Optimism)'} };

function safeBigInt(v){if(v==null)return BigInt(0);if(typeof v==='bigint')return v;if(typeof v==='number')return Number.isFinite(v)?BigInt(Math.trunc(v)):BigInt(0);let s=String(v).trim();if(!s)return BigInt(0);if(/^-?0x[0-9a-f]+$/i.test(s))return BigInt(s);if(/^-?\d+$/.test(s))return BigInt(s);const n=Number(s);return Number.isFinite(n)?BigInt(Math.trunc(n)):BigInt(0);}
function tokensEqual(a,b){if(!a||!b)return false;if(a.chain==='solana'&&b.chain==='solana')return a.mint===b.mint;if(a.chain==='evm'&&b.chain==='evm')return a.chainId===b.chainId&&(a.address||'').toLowerCase()===(b.address||'').toLowerCase();return false;}
function fmtUsd(n,d=2){if(n==null||isNaN(n))return'-';const v=Number(n);if(v>=1e9)return'$'+(v/1e9).toFixed(2)+'B';if(v>=1e6)return'$'+(v/1e6).toFixed(2)+'M';if(v>=1000)return'$'+v.toLocaleString('en-US',{maximumFractionDigits:d});if(v>=1)return'$'+v.toFixed(d);if(v>0)return'$'+v.toFixed(6);return'$0.00';}
function fmtTokenAmount(n,d=4){if(n==null||isNaN(n))return'0';const v=Number(n);if(v>=1e9)return(v/1e9).toFixed(2)+'B';if(v>=1e6)return(v/1e6).toFixed(2)+'M';if(v>=1000)return v.toLocaleString('en-US',{maximumFractionDigits:2});return v.toFixed(d);}
function shortAddr(a,h=4,t=4){if(!a||a.length<h+t)return a||'';return a.slice(0,h)+'\u2026'+a.slice(-t);}
function isValidSolMint(s){return!!s&&s.length>=32&&s.length<=44&&/^[1-9A-HJ-NP-Za-km-z]+$/.test(s);}
function isValidEvmAddr(s){return!!s&&/^0x[0-9a-fA-F]{40}$/.test(s);}
function toRawAmount(s,dec){if(!s||dec==null)return'0';let v=String(s).trim().replace(/,/g,'.').replace(/^\+/,'');if(!v||v.startsWith('-'))return'0';if(/e/i.test(v)){const n=Number(v);if(!Number.isFinite(n)||n<0)return'0';v=n.toFixed(Math.max(Number(dec)||0,20));}const d=Math.floor(Number(dec));if(!Number.isFinite(d)||d<0||d>18)return'0';const[w,f='']=v.split('.');const sw=(w||'0').replace(/[^\d]/g,'').replace(/^0+(?=\d)/,'')||'0';const ft=(f||'').replace(/[^\d]/g,'').slice(0,d);const fp=(ft+'0'.repeat(d)).slice(0,d)||'0';try{return(BigInt(sw)*(10n**BigInt(d))+BigInt(fp)).toString();}catch{return'0';}}

function normalizeToken(input){if(!input)return null;if(input.chain==='solana'&&input.mint)return input;if(input.chain==='evm'&&input.address&&input.chainId)return input;const logo=input.logoURI