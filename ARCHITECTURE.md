# Architecture Notes

## Overview
ABHA Fi consists of two independent smart contracts plus a static frontend:

1. **MultiPoolSwap.sol** — a constant-product AMM (Uniswap V2 style, 0.3% fee) generalized to support three tokens (USDC, EURC, cirBTC) across three independent liquidity pools.
2. **SimpleLending.sol** — a deposit/borrow pool. Deposits earn simple (linear) interest. Borrowing requires posting collateral in any supported token, checked against a 150% collateral ratio using reference USD prices.

## Why manual reference prices?
A production lending market needs a live price feed (e.g. Chainlink) to value collateral safely. Building and auditing a full oracle integration was out of scope for this testnet MVP, so `SimpleLending` uses an owner-settable `tokenPriceUSD` mapping as an explicit, documented placeholder. This is called out directly in the contract comments and the frontend UI so it's never presented as production-ready.

## Why no liquidations yet?
Liquidations require careful incentive design (liquidation bonus, partial liquidation thresholds, keeper bots) to avoid bad debt. This was intentionally deferred to keep the first version simple and auditable; it's the natural next milestone.

## Frontend
Plain HTML/CSS/JS talking directly to the contracts via [ethers.js](https://docs.ethers.org/) — no build step, no framework, so it can be hosted anywhere as static files (currently Vercel).
