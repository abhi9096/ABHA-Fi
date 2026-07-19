ABHA Fi

A DeFi suite built on Arc Testnet — Circle's stablecoin-native L1. ABHA Fi lets anyone swap, provide liquidity, lend, and borrow USDC, EURC, and cirBTC, with USDC-denominated gas for every transaction.

"Abha" means radiance / glow — a small nod to Arc's stablecoin-native network lighting up new DeFi use cases.

🔗 Live App

[Add your Vercel URL here]

✨ Features


Swap — trade between USDC, EURC, and cirBTC directly
Liquidity — provide liquidity across three pools (USDC-EURC, USDC-cirBTC, EURC-cirBTC)
Lend — deposit any supported token and earn simple interest
Borrow — post collateral and borrow against it (150% collateral ratio)
Faucet helper — one-click "Add Arc Testnet to Wallet" plus a direct link to Circle's faucet


🧱 Repository Structure

ABHA-Fi/
├── contracts/          # Solidity smart contracts
│   ├── MultiPoolSwap.sol
│   └── SimpleLending.sol
├── frontend/           # Web app (deployed via Vercel)
│   ├── index.html
│   ├── style.css
│   └── script.js
├── docs/               # Additional notes and diagrams
├── README.md
└── LICENSE

📜 Deployed Contracts (Arc Testnet)

ContractAddressMultiPoolSwap0xC71b9D161780AbA17D60b86D5d2Fb07F98DD5279SimpleLending0xd9145CCE52D386f254917e481eB44e9943F39138

TokenAddressDecimalsUSDC0x36000000000000000000000000000000000000006EURC0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a6cirBTC0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF8

🛠️ Tech Stack


Contracts: Solidity ^0.8.20
Frontend: HTML, CSS, vanilla JavaScript + ethers.js
Deployment: Remix IDE (contracts) · Vercel (frontend)


⚠️ Known Limitations (Testnet MVP)


Borrowing uses manually-set reference prices (owner-controlled), as a placeholder for a real price oracle (e.g. Chainlink). Not suitable for production use.
No liquidation mechanism yet — planned as a future upgrade.
cirBTC does not currently have a public faucet.


🤝 Contact


Twitter/X: @ImChoudharyA
Discord: Amit90098
Telegram: @amit2017kk


📄 License

MIT — see LICENSE.
