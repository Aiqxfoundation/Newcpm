import { useEffect, useId, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, Flame, Gift, Inbox, Sparkles, X } from 'lucide-react';
import { dateTime, type ActivityItem } from '@/lib/protocol';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <img
        src="/assets/aistudio/bitnoir-logo-96.png"
        srcSet="/assets/aistudio/bitnoir-logo-96.png 96w, /assets/aistudio/bitnoir-logo-144.png 144w, /assets/aistudio/bitnoir-logo-256.png 256w, /assets/aistudio/file_00000000c9508208b439e1d861b81370_d5533dc6.png 1254w"
        sizes="28px"
        alt="Bitnoir"
        width={28}
        height={28}
        draggable={false}
        style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: '9999px' }}
      />
      {!compact && <span>Bitnoir</span>}
    </span>
  );
}

type AssetKind = 'bits' | 'bnr' | 'usdt';

export function AssetIcon({ asset, size = 36 }: { asset: AssetKind; size?: number }) {
  if (asset === 'usdt') {
    return (
      <span className="asset-icon usdt" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
        {'₮'}
      </span>
    );
  }
  const isBitnoir = asset === 'bnr';
  const defaultSrc = isBitnoir
    ? size <= 32
      ? '/assets/aistudio/bitnoir-logo-96.png'
      : '/assets/aistudio/bitnoir-logo-144.png'
    : size <= 32
      ? '/assets/aistudio/bits-logo-96.png'
      : '/assets/aistudio/bits-logo-144.png';

  return (
    <img
      className="asset-icon"
      src={defaultSrc}
      srcSet={
        isBitnoir
          ? '/assets/aistudio/bitnoir-logo-96.png 96w, /assets/aistudio/bitnoir-logo-144.png 144w, /assets/aistudio/bitnoir-logo-256.png 256w, /assets/aistudio/file_00000000c9508208b439e1d861b81370_d5533dc6.png 1254w'
          : '/assets/aistudio/bits-logo-96.png 96w, /assets/aistudio/bits-logo-144.png 144w, /assets/aistudio/bits-logo-256.png 256w, /assets/aistudio/file_0000000071f8820880f6865e316e2a08_5b35eeb9.png 1254w'
      }
      sizes={`${size}px`}
      alt={isBitnoir ? 'Bitnoir' : 'Bits'}
      width={size}
      height={size}
      draggable={false}
      style={{
        width: size,
        height: size,
        objectFit: 'cover',
        borderRadius: '9999px',
      }}
    />
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  full = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  full?: boolean;
}) {
  return (
    <div className={`seg ${full ? 'seg-full' : ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, tone = 'gold', label }: { value: number; tone?: 'gold' | 'green'; label: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span className={tone} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'gold' | 'red'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function KV({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`kv ${strong ? 'kv-strong' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={22} aria-hidden="true" />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ width: `${90 - (i % 3) * 18}%` }} />
      ))}
    </div>
  );
}

const kindMeta: Record<string, { icon: typeof Flame; tone: string }> = {
  deposit: { icon: ArrowDownLeft, tone: 'green' },
  withdraw: { icon: ArrowUpRight, tone: 'neutral' },
  stake: { icon: Flame, tone: 'gold' },
  claim: { icon: Sparkles, tone: 'gold' },
  referral: { icon: Gift, tone: 'green' },
};

export function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <ul className="list">
      {items.map((item) => {
        const meta = kindMeta[item.kind] ?? kindMeta.claim;
        const Icon = meta.icon;
        return (
          <li key={item.id} className="list-item">
            <span className={`tx-icon tone-${meta.tone}`} aria-hidden="true">
              <Icon size={16} />
            </span>
            <div className="list-main">
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
            <time className="list-meta" dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
          </li>
        );
      })}
    </ul>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
