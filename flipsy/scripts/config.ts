import { PublicKey } from "@solana/web3.js";
 
export const NETWORK = (process.env.NETWORK || "devnet") as "devnet" | "mainnet";

export const RPC_URL =
  process.env.RPC_URL ||
  (NETWORK === "mainnet"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com");

export const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "Fpsy1111111111111111111111111111111111111111"
);

export const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ||
    (NETWORK === "mainnet"
      ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")
);

export const PYTH_SOL_USD = new PublicKey(
  process.env.PYTH_FEED ||
    (NETWORK === "mainnet"
      ? "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG"
      : "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix")
);

export const TREASURY_OWNER = process.env.TREASURY_OWNER
  ? new PublicKey(process.env.TREASURY_OWNER)
  : null;
