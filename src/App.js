{
  "name": "nexus-dex",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1",
    "ajv": "^8.12.0",
    "@solana/web3.js": "^1.87.6",
    "@solana/wallet-adapter-base": "^0.9.23",
    "@solana/wallet-adapter-react": "^0.15.35",
    "@solana/wallet-adapter-react-ui": "^0.9.35",
    "@solana/wallet-adapter-phantom": "^0.9.24",
    "@solana/wallet-adapter-solflare": "^0.6.28",
    "@solana/spl-token": "^0.3.11",
    "@rainbow-me/rainbowkit": "^2.1.3",
    "wagmi": "^2.12.0",
    "viem": "^2.21.0",
    "@tanstack/react-query": "^5.56.0",
    "@jup-ag/api": "^6.0.0",
    "recharts": "^2.10.0",
    "axios": "^1.6.0"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "serve": "npx serve -s build -l $PORT"
  },
  "browserslist": {
    "production": [">0.2%", "not dead", "not op_mini all"],
    "development": ["last 1 chrome version"]
  },
  "engines": {
    "node": "18.x"
  }
}
