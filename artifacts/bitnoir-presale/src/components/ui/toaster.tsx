import { AlertTriangle, Bell, CheckCircle2, ShieldAlert, Zap } from 'lucide-react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

type ToastVariant = 'default' | 'success' | 'gold' | 'warning' | 'destructive';

const VARIANT_META: Record<
  ToastVariant,
  {
    iconWrap: string;
    glow: string;
    bar: string;
    Icon: typeof CheckCircle2;
  }
> = {
  success: {
    iconWrap: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400',
    glow: 'radial-gradient(65% 80% at 15% 0%, rgba(16, 185, 129, 0.14), transparent 70%)',
    bar: 'bg-emerald-400',
    Icon: CheckCircle2,
  },
  gold: {
    iconWrap: 'bg-[#f7931a]/15 border-[#f7931a]/40 text-[#fbbf24]',
    glow: 'radial-gradient(65% 80% at 15% 0%, rgba(247, 147, 26, 0.16), transparent 70%)',
    bar: 'bg-gradient-to-r from-[#f7931a] to-[#fbbf24]',
    Icon: Zap,
  },
  warning: {
    iconWrap: 'bg-amber-400/15 border-amber-400/35 text-amber-300',
    glow: 'radial-gradient(65% 80% at 15% 0%, rgba(251, 191, 36, 0.14), transparent 70%)',
    bar: 'bg-amber-400',
    Icon: AlertTriangle,
  },
  destructive: {
    iconWrap: 'bg-red-500/15 border-red-500/35 text-red-400',
    glow: 'radial-gradient(65% 80% at 15% 0%, rgba(239, 68, 68, 0.16), transparent 70%)',
    bar: 'bg-red-400',
    Icon: ShieldAlert,
  },
  default: {
    iconWrap: 'bg-white/[0.08] border-white/15 text-zinc-200',
    glow: 'radial-gradient(65% 80% at 15% 0%, rgba(255, 255, 255, 0.08), transparent 70%)',
    bar: 'bg-zinc-400',
    Icon: Bell,
  },
};

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider duration={4200} swipeDirection="up">
      {toasts.map(function ({ id, title, description, action, icon, variant, duration, ...props }) {
        const resolvedVariant: ToastVariant = variant ?? 'default';
        const meta = VARIANT_META[resolvedVariant];
        const DefaultIcon = meta.Icon;
        const effectiveDuration = duration ?? (resolvedVariant === 'destructive' ? 5400 : 4200);

        return (
          <Toast key={id} variant={resolvedVariant} duration={effectiveDuration} {...props}>
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: meta.glow }}
              aria-hidden="true"
            />
            <div
              className={`relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border ${meta.iconWrap}`}
              aria-hidden="true"
            >
              {icon ?? <DefaultIcon className="h-[18px] w-[18px]" />}
            </div>
            <div className="relative z-10 grid min-w-0 flex-1 gap-0.5 pt-0.5">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action && <div className="relative z-10 self-center">{action}</div>}
            <ToastClose className="z-20" />
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.05]"
              aria-hidden="true"
            >
              <div
                className={`toast-progress-bar h-full w-full ${meta.bar}`}
                style={{ animationDuration: `${effectiveDuration}ms` }}
              />
            </div>
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
