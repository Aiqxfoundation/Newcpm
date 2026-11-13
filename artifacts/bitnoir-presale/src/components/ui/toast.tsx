import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'fixed top-3 left-1/2 -translate-x-1/2 z-[120] m-0 flex max-h-screen w-[calc(100%-24px)] max-w-[440px] list-none flex-col gap-2.5 p-0 outline-none pointer-events-none sm:top-5',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border px-4 py-3.5 pr-10 backdrop-blur-2xl transition-all will-change-transform data-[swipe=cancel]:translate-y-0 data-[swipe=end]:translate-y-[var(--radix-toast-swipe-end-y)] data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-4 data-[state=closed]:zoom-out-95 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-4 data-[state=open]:zoom-in-95 duration-200',
  {
    variants: {
      variant: {
        default:
          'bg-[#11131a]/95 border-white/15 text-zinc-100 shadow-[0_22px_50px_-10px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.05),inset_0_1px_0_rgba(255,255,255,0.08)]',
        success:
          'bg-[#0b1613]/95 border-emerald-500/35 text-zinc-100 shadow-[0_22px_50px_-10px_rgba(0,0,0,0.9),0_0_32px_-8px_rgba(16,185,129,0.28),inset_0_1px_0_rgba(16,185,129,0.22)]',
        gold:
          'bg-[#17130b]/95 border-[#f7931a]/45 text-zinc-100 shadow-[0_22px_50px_-10px_rgba(0,0,0,0.9),0_0_32px_-8px_rgba(247,147,26,0.3),inset_0_1px_0_rgba(251,191,36,0.22)]',
        warning:
          'bg-[#17130d]/95 border-amber-400/35 text-zinc-100 shadow-[0_22px_50px_-10px_rgba(0,0,0,0.9),0_0_26px_-8px_rgba(251,191,36,0.24),inset_0_1px_0_rgba(251,191,36,0.18)]',
        destructive:
          'destructive group bg-[#1a0e12]/95 border-red-500/40 text-zinc-100 shadow-[0_22px_50px_-10px_rgba(0,0,0,0.9),0_0_32px_-8px_rgba(239,68,68,0.3),inset_0_1px_0_rgba(239,68,68,0.22)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-3 text-xs font-bold text-white transition-colors hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-[#f7931a]/50 disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 opacity-75 transition-all hover:bg-white/[0.08] hover:text-white hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/25 cursor-pointer',
      className,
    )}
    toast-close=""
    aria-label="Close notification"
    {...props}
  >
    <X className="h-3.5 w-3.5" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-[13.5px] font-bold tracking-[-0.01em] text-white leading-tight', className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn(
      'text-[12.5px] font-medium leading-snug text-zinc-300 tabular-nums break-words group-[.destructive]:text-red-200/90',
      className,
    )}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
