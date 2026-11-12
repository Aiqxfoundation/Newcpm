import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import {
  User, ShieldCheck, Copy, Check, ExternalLink, Sparkles,
  Wallet, RefreshCw, LogOut, ArrowRight, Award, Users, Share2
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  getSavedMiningPass,
  fetchSolBalance,
  type MiningPassData,
} from '@/lib/solana';
import type { UserAccount } from '@workspace/api-client-react';

export function ProfilePageView({
  account,
  user,
  signOut,
  Brand,
  BitsMark,
}: {
  account: UserAccount;
  user: any;
  signOut: () => void;
  Brand: any;
  BitsMark: any;
}) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [passData, setPassData] = useState<MiningPassData | null>(null);

  const username = user?.username || account?.name || 'miner';
  const solanaAddress = user?.solanaAddress || account?.id || '';
  const referralCode = account?.referralCode || username;

  useEffect(() => {
    if (solanaAddress) {
      fetchSolBalance(solanaAddress).then(setSolBalance);
      const pass = getSavedMiningPass(solanaAddress);
      setPassData(pass);
    }
  }, [solanaAddress]);

  const referralUrl = typeof window !== 'undefined'
    ? `${window.location.origin}?ref=${referralCode}`
    : `https://bitnoir.io?ref=${referralCode}`;

  const copyToClipboard = (text: string, isLink: boolean) => {
    navigator.clipboard.writeText(text);
    if (isLink) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
    toast({ title: 'Copied to clipboard' });
  };

  const shortAddress = (addr: string) =>
    addr && addr.length > 14 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 20px 80px' }}>
      {/* HEADER CARD */}
      <div
        style={{
          background: 'linear-gradient(180deg, #101625 0%, #0c101c 100%)',
          borderRadius: 24,
          padding: '32px 28px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
          marginBottom: 28,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: 'linear-gradient(135deg, rgba(0,245,155,0.2), rgba(120,87,255,0.3))',
              border: '2px solid rgba(0,245,155,0.4)',
              display: 'grid',
              placeItems: 'center',
              color: '#00f59b',
              fontSize: 24,
              fontWeight: 800,
              fontFamily: 'var(--app-font-serif)',
            }}
          >
            {username.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ font: '800 24px var(--app-font-serif)', color: '#ffffff', margin: 0 }}>
                @{username}
              </h1>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: 'monospace',
                  background: passData ? 'rgba(0, 245, 155, 0.15)' : 'rgba(255, 139, 47, 0.15)',
                  color: passData ? '#00f59b' : '#ff8b2f',
                  border: passData ? '1px solid rgba(0, 245, 155, 0.3)' : '1px solid rgba(255, 139, 47, 0.3)',
                }}
              >
                {passData ? 'VERIFIED MINER' : 'UNVERIFIED PASS'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--silver-medium)', marginTop: 4 }}>
              Member ID: <code style={{ color: '#cbd5e1' }}>{account?.id || 'member-01'}</code> · Role:{' '}
              <strong style={{ color: '#ffffff' }}>{account?.role === 'admin' ? 'Administrator' : 'Miner'}</strong>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            onClick={signOut}
            className="button button-ghost"
            style={{ fontSize: 13, gap: 6 }}
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* CARD 1: WALLET & RPC ONCHAIN STATUS */}
        <div
          style={{
            background: '#0d131f',
            borderRadius: 20,
            padding: 24,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Wallet size={20} color="#00f59b" />
            <h2 style={{ fontSize: 17, color: '#ffffff', fontWeight: 800, margin: 0 }}>
              Connected Solana Wallet
            </h2>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>
              Public Key
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: 'monospace',
                fontSize: 13,
                color: '#ffffff',
              }}
            >
              <span>{solanaAddress ? shortAddress(solanaAddress) : 'No wallet connected'}</span>
              {solanaAddress && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(solanaAddress, false)}
                    className="button button-ghost !p-1.5 !min-h-0"
                    title="Copy address"
                  >
                    {copiedCode ? <Check size={13} color="#00f59b" /> : <Copy size={13} />}
                  </button>
                  <a
                    href={`https://solscan.io/account/${solanaAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="button button-ghost !p-1.5 !min-h-0"
                    title="View on Solscan"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 14px',
              borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            <span style={{ fontSize: 13, color: '#94a3b8' }}>Onchain SOL Balance:</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#00f59b', fontFamily: 'monospace' }}>
              {solBalance !== null ? `${solBalance.toFixed(4)} SOL` : 'Checking RPC...'}
            </span>
          </div>
        </div>

        {/* CARD 2: SOULBOUND MINING PASS STATUS */}
        <div
          style={{
            background: '#0d131f',
            borderRadius: 20,
            padding: 24,
            border: passData ? '1px solid rgba(0, 245, 155, 0.3)' : '1px solid rgba(255, 139, 47, 0.3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Award size={20} color={passData ? '#00f59b' : '#ff8b2f'} />
            <h2 style={{ fontSize: 17, color: '#ffffff', fontWeight: 800, margin: 0 }}>
              Soulbound Mining Pass
            </h2>
          </div>

          {passData ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: 'rgba(0, 245, 155, 0.05)',
                  border: '1px solid rgba(0, 245, 155, 0.2)',
                }}
              >
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>
                  Pass Identifier
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#00f59b', fontFamily: 'monospace' }}>
                  {passData.passId}
                </div>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>
                  Minted Onchain: {new Date(passData.mintedAt).toLocaleDateString()}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <Link href="/mining" className="button button-primary !py-2 text-xs flex-1">
                  <span>Go to Mining</span>
                  <ArrowRight size={13} />
                </Link>
                {passData.solscanUrl && (
                  <a
                    href={passData.solscanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="button button-ghost !py-2 text-xs"
                  >
                    <ExternalLink size={13} />
                    <span>Explorer</span>
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--silver-medium)', margin: 0, lineHeight: 1.6 }}>
                Your wallet has not yet minted the <strong>0.02 SOL Soulbound Mining Pass</strong>.
                Mining hashrate remains locked until verification is confirmed.
              </p>
              <Link href="/mint" className="button button-primary !py-2 text-xs">
                <Sparkles size={14} />
                <span>Mint Mining Pass (0.02 SOL)</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          )}
        </div>

        {/* CARD 3: REFERRAL PROGRAM */}
        <div
          style={{
            background: '#0d131f',
            borderRadius: 20,
            padding: 24,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            gridColumn: '1 / -1',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Share2 size={20} color="#ff8b2f" />
            <h2 style={{ fontSize: 17, color: '#ffffff', fontWeight: 800, margin: 0 }}>
              Referral Ambassador Program
            </h2>
          </div>

          <p style={{ fontSize: 13.5, color: '#94a3b8', lineHeight: 1.6, marginBottom: 16, maxWidth: 700 }}>
            Earn <strong>100 Bits</strong> ($10.00 value) plus <strong>+10% hashrate boost</strong> for every peer who joins
            via your unique referral link and verifies their Mining Pass.
          </p>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
              padding: '12px 16px',
              borderRadius: 14,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              marginBottom: 16,
            }}
          >
            <div style={{ flex: 1, minWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', display: 'block' }}>
                Your Invite Link
              </span>
              <span style={{ fontSize: 13, color: '#ffffff', fontFamily: 'monospace' }}>
                {referralUrl}
              </span>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(referralUrl, true)}
              className="button button-primary !py-2 text-xs"
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedLink ? 'Copied Link' : 'Copy Link'}</span>
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Verified Referrals</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#00f59b', fontFamily: 'monospace' }}>
                {account?.referralBitsClaimed ? Math.floor(account.referralBitsClaimed / 100) : 3} Miners
              </div>
            </div>
            <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Claimable Referral Bits</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#ff8b2f', fontFamily: 'monospace' }}>
                {account?.referralBitsAvailable || 200} Bits
              </div>
            </div>
            <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Pending Referee Volume</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#ab9ff2', fontFamily: 'monospace' }}>
                {account?.referralBitsPending || 200} Bits
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
