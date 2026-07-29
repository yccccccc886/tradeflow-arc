# TradeFlow architecture

```mermaid
flowchart LR
  Buyer[SME buyer] -->|Create PO + lock USDC| Web[TradeFlow web app]
  Seller[Overseas supplier] -->|Shipment milestone| Web
  Web -->|Wallet transaction| Escrow[TradeFlowEscrow on Arc]
  Evidence[Invoice and inspection evidence] -->|Hash + policy result| Web
  Escrow -->|Release in under 1 second| Seller
  Escrow -->|Timeout or dispute refund| Buyer
  Arbitrator[Approved arbitrator] -->|Resolve disputed trades| Escrow
  Escrow --> Explorer[Arcscan audit trail]
```

## Stack

- Arc Testnet (`5042002`) as the settlement network.
- Native USDC for gas and escrow value.
- Solidity escrow with buyer, seller and independent-arbitrator roles.
- Responsive Next.js/Vinext web experience with MetaMask-compatible wallet support.
- Demo mode for zero-funds judging; live mode for contract-backed testnet transactions.

## Security model

- Checks-effects-interactions and a reentrancy lock protect value transfers.
- A unique `bytes32` purchase-order reference prevents duplicate escrows.
- Funds can only settle after delivery confirmation, through arbitration, or return after a pre-shipment timeout.
- The contract stores only settlement state; private commercial documents remain offchain and can be represented by hashes.
