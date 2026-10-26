Source: https://aave.com/docs
Title: Aave Protocol Overview
Fetched: 2026-10-26T06:43:54.492Z

# Aave Documentation\#Copy

Aave is a decentralised non-custodial liquidity protocol where users can participate as suppliers or borrowers. Suppliers provide liquidity to the market while earning interest, and borrowers can access liquidity by providing collateral that exceeds the borrowed amount.

These docs cover the protocol end to end: concepts and risk parameters, the AaveKit SDKs (React, TypeScript, GraphQL), smart contract references for v3 and v4, GHO, governance, and integration guides. Every page is also available as markdown for agents and tooling: append `.md` to any URL, or send an `Accept: text/markdown` header.

## Get Familiar with Aave\#Copy

[Aave 101\\
\\
Learn the basics.](https://aave.com/docs/aave-101)

[Aave v3\\
\\
Learn about the Aave v3.](https://aave.com/docs/aave-v3/overview)

[Aave v4\\
\\
Learn about Aave v4.](https://aave.com/docs/aave-v4)

[Aave Horizon\\
\\
Borrow stablecoins with RWAs.](https://aave.com/docs/aave-v3/horizon)

[GHO\\
\\
Learn about the GHO stablecoin.](https://aave.com/docs/ecosystem/gho)

### Safety\#Copy

[Umbrella\\
\\
Native coverage for bad debt.](https://aave.com/docs/aave-v3/umbrella)

[Security\\
\\
Security resources and audits.](https://aave.com/security)

## Integrate Aave\#Copy

[Markets\\
\\
Earn by supplying assets.](https://aave.com/docs/aave-v3/markets/overview)

[Vaults\\
\\
Earn interest on assets.](https://aave.com/docs/vaults/simple-earn/overview)

### Quickstart\#Copy

- Market Data
- Supply Positions
- Borrow Positions
- Supply

```tsx
import { useAaveMarkets, chainId } from "@aave/react";
const { data, loading, error } = useAaveMarkets({  chainIds: [chainId(1), chainId(8453)], // Ethereum, Base});
```

[React](https://aave.com/docs/aave-v3/getting-started/react)

[TypeScript](https://aave.com/docs/aave-v3/getting-started/typescript)

[GraphQL](https://aave.com/docs/aave-v3/getting-started/graphql)

## Quick Links\#Copy

[Addresses\\
\\
Protocol smart addresses.](https://aave.com/docs/resources/addresses)

[Parameters\\
\\
View market parameters.](https://aave.com/docs/resources/parameters)

### Building On Aave

[Next\\
\\
**Aave 101**](https://aave.com/docs/aave-101)

We use cookies to enhance your user experience, provide personalised content and analyse traffic. [Cookie Policy](https://aave.com/privacy-policy#5-cookies-policy)

Accept AllDeny All