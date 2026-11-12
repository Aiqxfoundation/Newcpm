import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Sparkles, Check, ArrowRight, ExternalLink, ShieldCheck, Zap,
  Coins, Copy, Lock, RefreshCw, Wallet, AlertCircle
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  getSavedMiningPass,
  mintMiningPass,
  fetchSolBalance,
  PROTOCOL_TREASURY_SOLANA,
  type MiningPassData,
} from '@/lib/solana';

export function MintPageView({
  PublicHeader,
  Brand,
  BitsMark,
  user,
  connectWallet,
}: {
  PublicHeader: any;
  Brand: any;
  BitsMark: any;
  user: any;
  connectWallet: (custom?: string) => Promise<string>;
}) {
  const [, setLocation] = useLocation();
  const [passData, setPassData] = useState<MiningPassData | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stepState, setStepState] = useState<'idle' | 'signing' | 'confirming' | 'complete'>('idle');

  const userAddress = user?.solanaAddress || '';

  useEffect(() => {
    if (userAddress) {
      const existing = getSavedMiningPass(userAddress);
      setPassData(existing);
      fetchSolBalance(userAddress).then(setSolBalance);
    } else {
      setPassData(null);
      setSolBalance(null);
    }
  }, [userAddress]);

  const handleMint = async () => {
    let targetAddress = userAddress;
    if (!targetAddress) {
      try {
        targetAddress = await connectWallet();
      } catch (err: any) {
        toast({
          title: 'Wallet required',
          description: 'Please connect your Solana wallet (or demo wallet) to mint.',
          variant: 'destructive',
        });
        return;
      }
    }

    setMinting(true);
    setStepState('signing');

    try {
      toast({
        title: 'Transaction broadcast',
        description: 'Signing 0.02 SOL Soulbound Mining Pass registration...',
      });

      setStepState('confirming');
      const pass = await mintMiningPass({ ownerAddress: targetAddress });
      setPassData(pass);
      setStepState('complete');

      toast({
        title: 'Mining Pass Minted!',
        description: `Verified soulbound Pass ${pass.passId} on Solana onchain. Mining activated!`,
      });
    } catch (err: any) {
      setStepState('idle');
      toast({
        title: 'Mint failed',
        description: err?.message || 'Transaction could not be completed.',
        variant: 'destructive',
      });
    } finally {
      setMinting(false);
    }
  };

  const copyAddress = (txt: string) => {
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied to clipboard' });
  };

  const shortAddress = (addr: string) =>
    addr && addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

  return (
    <div className="site-shell">
      <PublicHeader />

      <main style={{ maxWidth: 1040, margin: '40px auto', padding: '0 20px 80px' }}>
        {/* HERO TITLE */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div
            className="eyebrow"
            style={{
              borderColor: 'rgba(0, 245, 155, 0.4)',
              background: 'rgba(0, 245, 155, 0.06)',
              margin: '0 auto 12px',
            }}
          >
            <span className="eyebrow-dot" />
            Solana Proof-of-Power · Sybil-Resistant Verification Standard
          </div>
          <h1
            style={{
              font: '800 36px var(--app-font-serif)',
              letterSpacing: '-0.03em',
              color: '#ffffff',
              margin: '0 0 12px',
            }}
          >
            Mint Your <span style={{ color: '#00f59b' }}>Soulbound Mining Pass</span>
          </h1>
          <p
            style={{
              maxWidth: 640,
              margin: '0 auto',
              color: 'var(--silver-medium)',
              fontSize: 15,
              lineHeight: 1.7,
            }}
          >
            To eliminate automated bot farms and guarantee real rewards for real miners,
            every wallet verifies onchain via a one-time <strong>0.02 SOL</strong> registration fee.
            Once minted, your pass is soulbound and permanent.
          </p>
        </div>

        {/* MAIN GRID */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 32,
            alignItems: 'start',
          }}
        >
          {/* LEFT: 3D HOLOGRAPHIC PASS CARD */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              style={{
                width: '100%',
                maxWidth: 420,
                aspectRatio: '1.58 / 1',
                borderRadius: 24,
                padding: 24,
                position: 'relative',
                background:
                  'radial-gradient(circle at 80% 20%, rgba(0, 245, 155, 0.18) 0%, transparent 60%), radial-gradient(circle at 20% 80%, rgba(120, 87, 255, 0.22) 0%, transparent 60%), #0c101c',
                border: passData ? '2px solid rgba(0, 245, 155, 0.6)' : '1px solid rgba(255, 255, 255, 0.15)',
                boxShadow: passData
                  ? '0 20px 60px rgba(0, 245, 155, 0.2), inset 0 1px 2px rgba(255,255,255,0.3)'
                  : '0 20px 50px rgba(0, 0, 0, 0.6)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              {/* Card Holographic Watermark Pattern */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0.05,
                  backgroundImage:
                    'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 16px)',
                  pointerEvents: 'none',
                }}
              />

              {/* CARD TOP */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img
                    src="/asset-bitnoir.png"
                    alt="Bitnoir"
                    style={{ width: 28, height: 28, objectFit: 'contain' }}
                  />
                  <span
                    style={{
                      font: '800 16px var(--app-font-serif)',
                      color: '#ffffff',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    BITNOIR MINER
                  </span>
                </div>
                <div
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 800,
                    fontFamily: 'var(--app-font-mono)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    background: passData ? 'rgba(0, 245, 155, 0.15)' : 'rgba(255, 139, 47, 0.15)',
                    color: passData ? '#00f59b' : '#ff8b2f',
                    border: passData ? '1px solid rgba(0, 245, 155, 0.35)' : '1px solid rgba(255, 139, 47, 0.35)',
                  }}
                >
                  {passData ? '● VERIFIED SOULBOUND' : '○ UNVERIFIED WALLET'}
                </div>
              </div>

              {/* CHIP & NFC ICON */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, zIndex: 1 }}>
                <div
                  style={{
                    width: 38,
                    height: 28,
                    borderRadius: 6,
                    background: 'linear-gradient(135deg, #d4af37, #f3e5ab)',
                    border: '1px solid rgba(0,0,0,0.3)',
                    boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6)',
                  }}
                />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
                  <path d="M2 10a12 12 0 0 1 20 0M5 14a8 8 0 0 1 14 0M8 18a4 4 0 0 1 8 0" />
                </svg>
              </div>

              {/* CARD BOTTOM */}
              <div style={{ zIndex: 1 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Pass Identifier & Public Key
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: '#ffffff',
                    fontFamily: 'var(--app-font-mono)',
                    margin: '2px 0 4px',
                  }}
                >
                  {passData ? passData.passId : '#BN-SOL-PENDING'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.6)',
                    fontFamily: 'var(--app-font-mono)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {userAddress ? shortAddress(userAddress) : 'Connect wallet to generate pass'}
                </div>
              </div>
            </div>

            {/* PASS STATUS UNDER CARD */}
            <div style={{ marginTop: 18, textAlign: 'center' }}>
              {passData ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#00f59b', fontSize: 13, fontWeight: 700 }}>
                  <ShieldCheck size={18} />
                  <span>Onchain Pass Verified · Full Mining Power Unlocked</span>
                </div>
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#ff8b2f', fontSize: 13 }}>
                  <AlertCircle size={16} />
                  <span>Pass registration required before mining starts</span>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: MINT ACTION & PROTOCOL DISCLOSURES */}
          <div
            style={{
              background: '#0d131f',
              borderRadius: 20,
              padding: 28,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
            }}
          >
            <h2 style={{ fontSize: 20, color: '#ffffff', fontWeight: 800, margin: '0 0 16px' }}>
              Verification Order Details
            </h2>

            {/* Specs row */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span style={{ fontSize: 13, color: '#94a3b8' }}>One-Time Registration Fee</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#00f59b', fontFamily: 'monospace' }}>
                  0.02 SOL
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span style={{ fontSize: 13, color: '#94a3b8' }}>Pass Type</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#ffffff' }}>
                  Soulbound Non-Transferable Proof
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span style={{ fontSize: 13, color: '#94a3b8' }}>Connected Wallet</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1', fontFamily: 'monospace' }}>
                  {userAddress ? shortAddress(userAddress) : 'None'}
                </span>
              </div>

              {solBalance !== null && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 14px',
                    fontSize: 12,
                    color: '#94a3b8',
                  }}
                >
                  <span>Your Wallet Balance:</span>
                  <span style={{ color: solBalance >= 0.02 ? '#00f59b' : '#ff8b2f', fontWeight: 700, fontFamily: 'monospace' }}>
                    {solBalance.toFixed(4)} SOL
                  </span>
                </div>
              )}
            </div>

            {/* TREASURY SPLIT */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.06em', marginBottom: 10 }}>
                Transparent 0.02 SOL Fee Split
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 12 }}>
                <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <strong style={{ color: '#00f59b' }}>50%</strong> DEX Liquidity
                </div>
                <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <strong style={{ color: '#ff8b2f' }}>30%</strong> Mining Pool Reserve
                </div>
                <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <strong style={{ color: '#38bdf8' }}>10%</strong> Buyback & Burn
                </div>
                <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <strong style={{ color: '#ab9ff2' }}>10%</strong> Solana RPC Validator
                </div>
              </div>
            </div>

            {/* MINT BUTTON */}
            {passData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: 'rgba(0, 245, 155, 0.08)',
                    border: '1px solid rgba(0, 245, 155, 0.3)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#00f59b', marginBottom: 4 }}>
                    ✓ Mining Pass Active ({passData.passId})
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    Minted on {new Date(passData.mintedAt).toLocaleDateString()}
                  </div>
                </div>

                <Link
                  href="/mining"
                  className="button button-primary"
                  style={{ width: '100%', minHeight: 46, fontSize: 14, fontWeight: 700 }}
                >
                  <Zap size={16} />
                  <span>Launch Mining Engine</span>
                  <ArrowRight size={16} />
                </Link>

                {passData.solscanUrl && (
                  <a
                    href={passData.solscanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="button button-ghost"
                    style={{ width: '100%', minHeight: 40, fontSize: 13 }}
                  >
                    <ExternalLink size={14} />
                    <span>View on Solscan Explorer</span>
                  </a>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleMint}
                disabled={minting}
                className="button button-primary"
                style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 700 }}
              >
                {minting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>
                      {stepState === 'signing' ? 'Awaiting Wallet Signature...' : 'Confirming on Solana RPC...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    <span>Mint Soulbound Mining Pass (0.02 SOL)</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </main>

      <footer className="footer">
        <Brand size="sm" />
        <span>Bitnoir Solana Native Proof-of-Power Protocol</span>
        <span>All pass fees stream directly to protocol smart contracts onchain.</span>
      </footer>
    </div>
  );
}
