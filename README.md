# TradeFlow

TradeFlow is a programmable USDC escrow and cross-border settlement desk for GCC SMEs, built for the Stablecoins Commerce Stack Challenge.

## What it demonstrates

- Create a protected import/export trade in under a minute.
- Lock test USDC in a purpose-built escrow on Arc Testnet.
- Move through shipment and delivery milestones.
- Release payment with an auditable, deterministic settlement.
- Raise disputes and use an independent arbitrator fallback.
- Run the complete product story in Demo mode without a funded wallet.

The chain integration targets Arc Testnet (chain ID `5042002`). Native USDC is used for gas and escrow value. Add the deployed contract address to `NEXT_PUBLIC_ESCROW_ADDRESS` to enable live transactions.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system diagram and [contracts/TradeFlowEscrow.sol](contracts/TradeFlowEscrow.sol) for settlement logic.

## Local commands

```bash
npm install
npm run dev
npm run build
```
