Source: https://docs.jup.ag/user-docs/trade/trading-bot/referral
Title: What is Jupiter Spot? - Jupiter Documentation
Fetched: 2026-10-26T06:44:31.353Z

> ## Documentation Index
>
> Fetch the complete documentation index at: [/llms.txt](https://docs.jup.ag/llms.txt)
>
> Use this file to discover all available pages before exploring further.

[Skip to main content](https://docs.jup.ag/user-docs/trade/spot#content-area)

Jupiter Spot is Jupiter’s spot trading product on Solana: exchange any token instantly with best-in-class execution, plus the data and tools to discover, analyze, and trade actively, all in one interface. It combines real-time token discovery feeds, detailed token pages, charting, wallet tracking, and configurable trade settings in a single workspace.Spot is available at [jup.ag/spot](https://jup.ag/spot). Until July 2026 the product was called Terminal, so older guides and videos may still use that name.

[**Learn Spot with a hands-on lesson** \\
\\
A plain-language lesson in Guides on how Spot prices your swap, with a step-by-step first swap.](https://docs.jup.ag/user-docs/guides/spot/swap-on-spot)

## [​](https://docs.jup.ag/user-docs/trade/spot\#how-it-works)  How it works

Jupiter scans liquidity pools in real time (Meteora, Raydium, Humidifi, and >100 other liquidity sources), splits the transaction if necessary, and optimizes the route to achieve the best overall execution, balancing price, speed, and success rate. See [How tokens are listed and routed](https://docs.jup.ag/user-docs/trade/spot/token-page#how-tokens-are-listed-and-routed) for details on listing requirements and supported AMMs.

## [​](https://docs.jup.ag/user-docs/trade/spot\#trading-modes)  Trading modes

Spot has two execution modes:

|  | [Ultra Mode](https://docs.jup.ag/user-docs/trade/spot/ultra-mode) | [Manual Mode](https://docs.jup.ag/user-docs/trade/spot/manual-mode) |
| --- | --- | --- |
| **Slippage** | Auto (via RTSE) | Custom |
| **Transaction Broadcasting** | Automatic | Custom |
| MEV **Protection** | Best in class | None |
| **Priority Fees** | Auto (ensures high success without overpaying) | Custom |
| **Gasless Swaps** | Available for most tokens | None |
| AMM **Exclusion** | Auto | Custom |

Spot also supports automated order types:

[**Limit Orders** \\
\\
Set a target price or market cap and let Jupiter execute your trade automatically when the condition is met.](https://docs.jup.ag/user-docs/trade/spot/limit-orders)

[**DCA Orders** \\
\\
Spread your purchases over time using dollar-cost averaging (DCA) with automated trades at regular intervals.](https://docs.jup.ag/user-docs/trade/spot/recurring-orders)

If you are unsure which settings to use, stick with Ultra mode: it handles slippage, priority fees, and MEV protection automatically based on current network conditions. See [Fees](https://docs.jup.ag/user-docs/trade/spot/fees) and [Risks and Limitations](https://docs.jup.ag/user-docs/trade/spot/risks-and-limitations) for details.

## [​](https://docs.jup.ag/user-docs/trade/spot\#interface-modes)  Interface modes

Spot offers two interface modes. Both execute swaps identically; the difference is purely in the layout. You can switch between them in **Settings → Spot → Trading Mode** (gear icon in the top navigation bar).

- Classic mode

- Trench mode


For all traders: the classic Jupiter UX with a simple swap widget. Cleaner layout, less information density, and a straightforward swap flow. Uses Ultra only. Suited for users who want a readable, uncluttered experience or who are new to Spot.

One-click trading: a pro UX with a compact trade widget, manual presets, and more real-time data visible at once. Designed for users who trade frequently, especially on volatile tokens, and need to adjust parameters quickly between transactions.

For one-click trading in Trench mode, use [Jupiter Wallet](https://docs.jup.ag/user-docs/manage/extension-wallet) and enable [Auto-Approve](https://docs.jup.ag/user-docs/manage/extension-wallet/settings#auto-approve).

## [​](https://docs.jup.ag/user-docs/trade/spot\#using-the-sidebar)  Using the Sidebar

On screens at least 1024 px wide, Spot pages and token pages show a vertical **Sidebar** tab on the left edge of the window. Click it to open a side panel next to the page, with four tabs: Watchlist, Tracker (the trades of the wallets you follow in [SmartMoney](https://docs.jup.ag/user-docs/trade/spot/smart-money)), Discover, and AlphaScan. Drag the panel’s right edge to resize it, and close it with the ✕ in its header. To move the tab up or down the edge, hover it and drag the handle that appears below its label. The sidebar keeps its open state, tab, width, and position for your next visit.

## [​](https://docs.jup.ag/user-docs/trade/spot\#settings)  Settings

The Settings panel (gear icon in the top navigation bar) lets you configure how Spot behaves. It is organized into three tabs ( **General**, **Spot**, and **Portfolio**):

General

- **Default Currency**: the token your trades are quoted against on Spot: USDC, SOL, or JupUSD
- **Preferred Explorer**: the block explorer used for transaction links: Solscan, Solana Beach, Solana Explorer, SolanaFM, Orb, or OKLink
- **Number Format**: **Local** (12.35k) or **World** (12.35K) abbreviations; full numbers stay 12,345.67 in both
- **Show Top Token Bar**: toggle the top bar showing Watchlist, Positions, and Recent tokens
- **Show support bubble**: toggle the floating help and feedback button in the bottom-right corner, which opens the support chat. Turn it off if it covers part of the page; **Get Help** in the left sidebar still opens the same chat. The bubble cannot be moved.
- **RPC Endpoint**: choose between **Jupiter RPC** (marked Beta), **Triton RPC Pool 1** and **2**, **Helius RPC 1**, or a custom RPC. Latency is displayed for each option.

Spot

- **Trading Mode**: switch between Classic and Trench mode
- **Sound Alerts**: toggle the trading sound, set notification volume (default 50%), and choose the Buy and Sell sound effects

Portfolio

- **Currency**: the currency Portfolio values are shown in: USD, EUR, GBP, JPY, AED, AUD, CAD, SGD, or INR
- **Hide positions**: hide positions under $0.01, $1, $5, or $10, or show all
- **Health mode**: show lending position health as a **Ratio** or a **Factor**
- **Spot PnL**: period covered by the Spot PnL card: **All time** or **24h**

See [Portfolio settings](https://docs.jup.ag/user-docs/manage/portfolio/settings) for details.

## [​](https://docs.jup.ag/user-docs/trade/spot\#supported-wallets)  Supported wallets

Jupiter works best with the [Jupiter Wallet](https://chromewebstore.google.com/detail/jupiter-wallet/iledlaeogohbilgbfhmbgkgmpplbfboh), available on desktop as a [browser extension](https://docs.jup.ag/user-docs/manage/extension-wallet) and on [mobile](https://jup.ag/mobile).Jupiter also supports all major Solana-native web extension wallets such as Phantom and Backpack, along with hardware wallets like Ledger and Trezor. The Jupiter Mobile app can be paired with the web interface via the **Magic Scan** feature.

### [​](https://docs.jup.ag/user-docs/trade/spot\#quick-accounts)  Quick Accounts

Jupiter Quick Accounts are embedded wallets powered by [Privy](https://www.privy.io/). They let you log in with social accounts (Discord, Google, email, etc.) or an existing crypto wallet, without needing a seed phrase. In the **Connect** menu on [jup.ag](https://jup.ag/), this option appears as **Jupiter ID** (Email or Social Login), alongside Jupiter Wallet, Jupiter Mobile (QR code), and the supported external wallets. Quick Accounts are:

- **Signless**: trades execute instantly without approving every transaction.
- **Non-custodial**: you retain full control. Your private key can be exported at any time.

Store your private key securely. Anyone with access to it has full control over your wallet and funds.

## [​](https://docs.jup.ag/user-docs/trade/spot\#portfolio-&-activity)  Portfolio & Activity

The **Portfolio drawer** (top right on [jup.ag](https://jup.ag/)) displays your holdings and activity across Jupiter products (Spot, Perps, Lend, etc.).

- **PnL (Profit and Loss) Analysis**: available in [Jupiter Portfolio](https://jup.ag/portfolio) under the Spot tab, or on token pages in the [My Holdings](https://docs.jup.ag/user-docs/trade/spot/token-page#my-holdings) tab under the chart. See [Spot PnL](https://docs.jup.ag/user-docs/manage/portfolio/spot-pnl).
- **Swap history**: available in the Portfolio drawer under the **Activity** tab.

For a broader view of your positions across multiple Solana protocols, use [Jupiter Portfolio](https://jup.ag/portfolio).

## [​](https://docs.jup.ag/user-docs/trade/spot\#after-swap-suggestions)  After-swap suggestions

After you complete a swap on the [jup.ag](https://jup.ag/) homepage or the swap page, the confirmation toast may show up to two suggested tokens related to the token you received (suggestions do not appear for swaps made from token pages). They are based on co-trading patterns (tokens that wallets holding your output token tend to trade next), weighted toward recent activity and updated daily. Only verified tokens are eligible, a blocklist filters out problematic tokens, and suggestions are global (the same for all users, not based on your wallet or history). Clicking a suggestion opens that token’s page. When the swap gets a suggested exit order under the swap form instead, the toast shows no suggested tokens; see [Orders suggested after a swap](https://docs.jup.ag/user-docs/trade/spot/limit-orders#orders-suggested-after-a-swap).

Suggestions are statistical patterns, not endorsements or financial advice. Always do your own research before trading a suggested token.

## [​](https://docs.jup.ag/user-docs/trade/spot\#rent-reclaim)  Rent Reclaim

When you interact with tokens on Solana, your wallet pays **rent**, a small SOL deposit required to keep token accounts open onchain. Over time, unused token accounts (e.g. from tokens you no longer hold) can accumulate, locking small amounts of SOL.Rent Reclaim recovers that SOL in two ways: it closes empty token accounts, and it reclaims the **excess rent** from token accounts you keep. Solana has lowered the rent requirement several times, so accounts created earlier hold more SOL than is now required; the excess is returned while the account stays open and usable, and the same account can yield more again after a future reduction. The panel lists the **Accounts to reclaim** and the **Eligible Tokens** with an **Estimated Reclaim**; untick what you want to leave as is, then click **Reclaim** and sign. Accounts whose close authority was handed to another application (some launchpads do this) are not listed, because the wallet cannot close them. Rent Reclaim is available at three locations on jup.ag:

- **Homepage**: below the portfolio widget, visible only if you have 10 or more reclaimable accounts
- **Wallet side drawer**: accessible from your wallet panel
- **Manage** menu: in the [My Holdings](https://docs.jup.ag/user-docs/trade/spot/token-page#my-holdings) tab on token pages, and in the Holdings tab under the trade form on [jup.ag/spot](https://jup.ag/spot); its **Reclaim** item is listed only when you have reclaimable accounts

**Known limitations:**

- If you dismiss the Rent Reclaim notification on the homepage, the prompt will no longer appear there. You can still access Rent Reclaim from the wallet side drawer or the **Manage** menu of the My Holdings tab on token pages.
- Rent Reclaim is currently not compatible with Trust Wallet’s in-app browser. If you use Trust Wallet, try accessing jup.ag through a different browser instead.

## [​](https://docs.jup.ag/user-docs/trade/spot\#changelog)  Changelog

All product updates are published at [jup.ag/updates](https://jup.ag/updates).

* * *

## [​](https://docs.jup.ag/user-docs/trade/spot\#explore-spot)  Explore Spot

[**Pulse** \\
\\
At-a-glance market overview: news, movers, and category dominance.](https://docs.jup.ag/user-docs/trade/spot/pulse)

[**Discover** \\
\\
Browse tokens by category using curated feeds and filters.](https://docs.jup.ag/user-docs/trade/spot/discover)

[**AlphaScan** \\
\\
Real-time feed of new token launches across Solana.](https://docs.jup.ag/user-docs/trade/spot/alphascan)

[**SmartMoney** \\
\\
Follow wallets and see what notable traders are buying.](https://docs.jup.ag/user-docs/trade/spot/smart-money)

[**Watchlist** \\
\\
Save tokens and track them with market data and per-token news.](https://docs.jup.ag/user-docs/trade/spot/watchlist)

[**Launchpad Screener & Runners** \\
\\
Cross-launchpad analysis and Runner criteria.](https://docs.jup.ag/user-docs/trade/spot/launchpad-screener-and-runners)

[**Token Page** \\
\\
Market data, safety indicators, charts, and trading tools for any token.](https://docs.jup.ag/user-docs/trade/spot/token-page)

[**Spot PnL** \\
\\
Your spot trading performance, PnL, and trading history in Portfolio.](https://docs.jup.ag/user-docs/manage/portfolio/spot-pnl)

[**Stock Page** \\
\\
Underlying stock data and the issuers you can trade it from.](https://docs.jup.ag/user-docs/trade/spot/stock-page)

[**Tokenized Stocks** \\
\\
Trade onchain tokenized equities, with issuer and risk details.](https://docs.jup.ag/user-docs/trade/spot/tokenized-stocks)

Assistant

Responses are generated using AI and may contain mistakes.