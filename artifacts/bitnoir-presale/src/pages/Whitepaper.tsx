import { BookOpen, Sparkles, Zap, ShieldCheck, ArrowRight, ExternalLink } from 'lucide-react';
import { Link } from 'wouter';

export function WhitepaperView({
  PublicHeader,
  Brand,
  BitsMark,
}: {
  PublicHeader: any;
  Brand: any;
  BitsMark: any;
}) {
  return (
    <div className="site-shell">
      <PublicHeader />
      <div className="whitepaper-wrapper">
        <header className="whitepaper-hero">
          <div className="eyebrow" style={{ borderColor: 'rgba(0, 245, 155, 0.4)', background: 'rgba(0, 245, 155, 0.06)' }}>
            <span className="eyebrow-dot" />
            Protocol Architecture Specification · Version 3.5 (Solana Native Edition)
          </div>
          <h1 className="display whitepaper-title">
            Bitnoir: Solana Proof-of-Power <br className="hide-mobile" />
            <span className="highlight-green">Mining & Dual-Token Architecture</span>
          </h1>
          <p style={{ maxWidth: 780, color: 'var(--silver-medium)', fontSize: 16, lineHeight: 1.8, margin: '14px 0 20px' }}>
            A formal cryptographic specification of Bitnoir’s Proof-of-Power (PoP) consensus,
            the 0.02 SOL onchain Mining Pass verification standard, SOL Power hashrate multipliers,
            and the immutable 21,000,000 hard-cap tokenomics model.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, color: 'var(--silver-dark)', fontFamily: 'var(--app-font-mono)' }}>
            <span style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', color: '#ab9ff2' }}>Consensus: Solana Proof-of-Power (PoP)</span>
            <span style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', color: '#00f59b' }}>Hard Cap: 21,000,000 Fixed ($NOIR)</span>
            <span style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', color: '#ff8b2f' }}>Mining Pass: 0.02 SOL Soulbound Proof</span>
            <span style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', color: '#38bdf8' }}>Claim: SPL-2022 Token Extension</span>
          </div>
        </header>

        <article className="whitepaper-content">
          {/* Section 1.0 */}
          <section className="whitepaper-section" id="abstract-vision">
            <div className="eyebrow">Section 1.0</div>
            <h2>Abstract & Solana Architectural Thesis</h2>
            <p>
              Traditional cryptocurrency mining has become monopolized by industrial ASIC data centers, excluding individual users
              and concentrating consensus among a handful of corporate conglomerates. Conversely, cloud mining and web-based tap games
              have dissolved into inflationary schemes with zero cryptographic proof, opaque accounting, and predatory token dumps.
            </p>
            <p>
              <strong>Bitnoir</strong> introduces a non-custodial, high-throughput <strong>Proof-of-Power (PoP)</strong> protocol
              native to the Solana blockchain. Built atop Solana’s sub-second finality and low-cost transaction infrastructure,
              Bitnoir enables verified individual miners to generate cryptographic <strong>Bits</strong> through deterministic hashrate
              velocity, secured by an onchain verification gate and boosted by transparent SOL treasury contributions.
            </p>

            <div className="whitepaper-spec-grid">
              <div className="whitepaper-spec-item">
                <div className="whitepaper-spec-key">Monetary Hard Cap</div>
                <div className="whitepaper-spec-val" style={{ color: 'var(--neon-green)' }}>21,000,000 $NOIR</div>
              </div>
              <div className="whitepaper-spec-item">
                <div className="whitepaper-spec-key">Consensus Standard</div>
                <div className="whitepaper-spec-val">Solana Proof-of-Power</div>
              </div>
              <div className="whitepaper-spec-item">
                <div className="whitepaper-spec-key">Verification Standard</div>
                <div className="whitepaper-spec-val" style={{ color: '#ff8b2f' }}>0.02 SOL Mining Pass</div>
              </div>
              <div className="whitepaper-spec-item">
                <div className="whitepaper-spec-key">Settlement Layer</div>
                <div className="whitepaper-spec-val">Solana SPL-2022 Standard</div>
              </div>
            </div>
          </section>

          {/* Section 2.0 */}
          <section className="whitepaper-section" id="mining-pass">
            <div className="eyebrow">Section 2.0</div>
            <h2>Mining Pass & Sybil-Resistant Onchain Verification</h2>
            <p>
              To eliminate automated bot farms, multi-accounting scripts, and malicious Sybil attacks from diluting the legitimate miner rewards pool,
              every participating wallet must mint an onchain <strong>Mining Pass</strong> prior to activating the mining engine.
            </p>
            <p>
              The Mining Pass is minted via a one-time <strong>0.02 SOL</strong> protocol registration fee sent directly to the verified protocol treasury onchain.
              Upon transaction finalization, the Solana public RPC verifies the signature, and the protocol issues a soulbound, non-transferable Pass ID (e.g. <code>#BN-SOL-XXXX</code>)
              permanently bound to the miner’s public key.
            </p>

            <div style={{ padding: 18, background: 'rgba(0, 245, 155, 0.04)', borderRadius: 12, border: '1px solid rgba(0, 245, 155, 0.25)', margin: '18px 0' }}>
              <h4 style={{ margin: '0 0 8px', color: '#00f59b', fontSize: 15 }}>Treasury Fee Allocation of the 0.02 SOL Pass</h4>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--silver-light)', lineHeight: 1.7 }}>
                <li><strong>50% Protocol Liquidity Reserve:</strong> Pooled to bootstrap the initial Raydium/Orca Bitnoir liquidity pairs.</li>
                <li><strong>30% Mining Pool Reward Reserve:</strong> Allocated to fund ongoing community hashrate incentives and bonuses.</li>
                <li><strong>10% Permanent Buyback & Burn:</strong> Used to periodically buy back and permanently incinerate $NOIR tokens.</li>
                <li><strong>10% Public RPC Infrastructure & Auditing:</strong> Dedicated to sustaining high-speed Solana validator RPC nodes.</li>
              </ul>
            </div>
          </section>

          {/* Section 3.0 */}
          <section className="whitepaper-section" id="dual-token">
            <div className="eyebrow">Section 3.0</div>
            <h2>Dual-Token System: Bits (BIT) vs. Bitnoir ($NOIR)</h2>
            <p>
              Bitnoir resolves the classical cryptocurrency trilemma through an economic decoupling between dynamic computational utility
              and sovereign digital scarcity:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, margin: '20px 0' }}>
              <div style={{ padding: 20, background: 'rgba(255,255,255,0.02)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <BitsMark size={24} />
                  <strong style={{ fontSize: 16, color: '#ffffff' }}>Bits (BIT) — Mining Emission Unit</strong>
                </div>
                <p style={{ fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
                  Continuous mining reward token issued block-by-block. Accumulates in real-time within the miner’s 24-hour storage tank.
                  Transferable peer-to-peer with zero gas fees between miners, convertible into $NOIR, and claimable onchain at TGE.
                </p>
              </div>

              <div style={{ padding: 20, background: 'rgba(255,255,255,0.02)', borderRadius: 14, border: '1px solid rgba(245,166,35,0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <img src="/asset-bitnoir.png" alt="Bitnoir" style={{ width: 24, height: 24, objectFit: 'contain' }} />
                  <strong style={{ fontSize: 16, color: '#f5a623' }}>Bitnoir ($NOIR) — Hard Cap Asset</strong>
                </div>
                <p style={{ fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
                  Fixed-supply governance and sovereign store of value. Strictly invariant at 21,000,000 maximum units.
                  Features deflationary burn mechanics, protocol fee dividends, and direct onchain withdrawal to connected Solana wallets.
                </p>
              </div>
            </div>
          </section>

          {/* Section 4.0 */}
          <section className="whitepaper-section" id="sol-power">
            <div className="eyebrow">Section 4.0</div>
            <h2>SOL Power Multiplier Mathematical Formulation</h2>
            <p>
              A miner's net mining velocity ($H_{net}$, measured in Bits per hour) is governed by three deterministic components:
              the Network Base Rate, the Team Referral Bonus, and the onchain SOL Power Contribution:
            </p>

            <div style={{ padding: 20, background: '#0a0f19', borderRadius: 14, border: '1px solid rgba(120,87,255,0.3)', fontFamily: 'monospace', fontSize: 14, color: '#00f59b', margin: '16px 0', textAlign: 'center' }}>
              <strong>H<sub>net</sub> = H<sub>base</sub> + &sum;(0.10 &times; H<sub>active_miners</sub>) + (&alpha; &times; SOL<sub>contributed</sub>)</strong>
            </div>

            <p style={{ fontSize: 13.5, color: 'var(--silver-medium)', lineHeight: 1.7 }}>
              Where:
              <br />• <strong>H<sub>base</sub></strong> = <code>0.1000 Bits/hr</code> (Base hashrate granted to all verified Mining Pass holders)
              <br />• <strong>H<sub>active_miners</sub></strong> = Active direct team members contribute 10% of their base rate (<code>+0.0100 Bits/hr</code> per active miner)
              <br />• <strong>&alpha;</strong> = SOL Power Multiplier constant: <code>5.0000 Bits/hr per 1.0 SOL</code> contributed to treasury
              <br />• <strong>SOL<sub>contributed</sub></strong> = Maximum quota of <code>10.0 SOL</code> per verified wallet account
            </p>

            <p>
              When a miner purchases SOL Power, the application prompts their Phantom wallet to send SOL onchain.
              The transaction is fetched and validated by public Solana RPC. Once confirmed, the miner's SOL Power hashrate is instantly boosted onchain.
            </p>
          </section>

          {/* Section 5.0 */}
          <section className="whitepaper-section" id="tokenomics">
            <div className="eyebrow">Section 5.0</div>
            <h2>Complete Tokenomics & Supply Distribution</h2>
            <p>
              Bitnoir Coin ($NOIR) enforces a strictly non-inflationary invariant of <strong>21,000,000 maximum units</strong>.
              No secondary mint functions exist within the smart contract.
            </p>

            <div style={{ overflowX: 'auto', margin: '20px 0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                    <th style={{ padding: '10px 14px' }}>Allocation Category</th>
                    <th style={{ padding: '10px 14px' }}>Percentage</th>
                    <th style={{ padding: '10px 14px' }}>Total Amount ($NOIR)</th>
                    <th style={{ padding: '10px 14px' }}>Vesting & Release Terms</th>
                  </tr>
                </thead>
                <tbody style={{ fontFamily: 'monospace' }}>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px 14px', color: '#00f59b', fontWeight: 700 }}>Proof-of-Power Mining Pool</td>
                    <td style={{ padding: '12px 14px' }}>45.0%</td>
                    <td style={{ padding: '12px 14px' }}>9,450,000</td>
                    <td style={{ padding: '12px 14px', color: '#cbd5e1', fontFamily: 'sans-serif' }}>Emitted block-by-block based on verified hashrate</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px 14px', color: '#ff8b2f', fontWeight: 700 }}>Fair Presale & DEX Liquidity</td>
                    <td style={{ padding: '12px 14px' }}>25.0%</td>
                    <td style={{ padding: '12px 14px' }}>5,250,000</td>
                    <td style={{ padding: '12px 14px', color: '#cbd5e1', fontFamily: 'sans-serif' }}>100% unlocked for Raydium / Orca liquidity pairs</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px 14px', color: '#38bdf8', fontWeight: 700 }}>Ecosystem & Developer Grants</td>
                    <td style={{ padding: '12px 14px' }}>15.0%</td>
                    <td style={{ padding: '12px 14px' }}>3,150,000</td>
                    <td style={{ padding: '12px 14px', color: '#cbd5e1', fontFamily: 'sans-serif' }}>12-month linear vest for tools, dApps & integrations</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px 14px', color: '#ab9ff2', fontWeight: 700 }}>Treasury Strategic Reserve</td>
                    <td style={{ padding: '12px 14px' }}>10.0%</td>
                    <td style={{ padding: '12px 14px' }}>2,100,000</td>
                    <td style={{ padding: '12px 14px', color: '#cbd5e1', fontFamily: 'sans-serif' }}>Multi-sig governed emergency stability & buyback reserve</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '12px 14px', color: '#94a3b8', fontWeight: 700 }}>Core Contributors & Security</td>
                    <td style={{ padding: '12px 14px' }}>5.0%</td>
                    <td style={{ padding: '12px 14px' }}>1,050,000</td>
                    <td style={{ padding: '12px 14px', color: '#cbd5e1', fontFamily: 'sans-serif' }}>6-month cliff followed by 24-month linear vesting</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 6.0 */}
          <section className="whitepaper-section" id="onchain-claim">
            <div className="eyebrow">Section 6.0</div>
            <h2>Onchain Token Claim Portal & SPL-2022 Roadmap</h2>
            <p>
              All Bits mined during the current network phase are recorded in the user's cryptographically audited mining ledger.
              At the upcoming <strong>Token Generation Event (TGE)</strong>, an onchain <strong>Solana Claim Contract</strong> will be deployed.
            </p>
            <p>
              Miners will connect their verified Phantom wallet and execute a 1:1 onchain claim transaction.
              The claim contract leverages <strong>Solana Token Extensions (SPL-2022)</strong>, providing zero-gas metadata verification
              and direct settlement into the miner's connected self-custody wallet.
            </p>
          </section>

          {/* Section 7.0 */}
          <section className="whitepaper-section" id="security-invariants">
            <div className="eyebrow">Section 7.0</div>
            <h2>Security, Non-Custodial Invariants & RPC Transparency</h2>
            <p>
              Bitnoir operates under strict non-custodial principles:
            </p>
            <ul style={{ paddingLeft: 20, fontSize: 14, color: 'var(--silver-light)', lineHeight: 1.8 }}>
              <li><strong>Zero Key Collection:</strong> The protocol only reads public keys (<code>publicKey.toString()</code>). Private keys, mnemonic seed phrases, and passwords are never collected, requested, or stored.</li>
              <li><strong>Public RPC Verification:</strong> All transactions (Mining Pass minting and SOL Power contributions) are validated directly against public Solana validator RPC endpoints (<code>api.mainnet-beta.solana.com</code> and <code>api.devnet.solana.com</code>).</li>
              <li><strong>Seamless Hidden Treasury:</strong> Target treasury addresses are managed programmatically in transaction envelopes, preventing user copy-paste errors while remaining 100% auditable on Solscan.</li>
            </ul>

            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <Link href="/staking" className="button button-primary" style={{ display: 'inline-flex', padding: '12px 24px', fontSize: 14 }}>
                <Sparkles size={16} />
                <span>Mint Mining Pass (0.02 SOL) & Start Mining</span>
                <ArrowRight size={16} />
              </Link>
            </div>
          </section>
        </article>
      </div>

      <footer className="footer">
        <Brand size="sm" />
        <span>Bitnoir Protocol Architecture Specification · Version 3.5 (Solana Native)</span>
        <span>Participation involves market and smart-contract risk. Review disclosures carefully.</span>
      </footer>
    </div>
  );
}
