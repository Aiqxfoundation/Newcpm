import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[120] m-0 flex max-h-screen w-[calc(100%-44px)] max-w-[340px] list-none flex-col gap-2.5 p-0 outline-none pointer-events-none',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full flex-col gap-6 overflow-hidden rounded-xl border px-6 pt-[22px] pb-[18px] transition-all will-change-transform data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-150',
  {
    variants: {
      variant: {
        default:
          'bg-[#1e1e1e] border-white/[0.08] text-zinc-100 shadow-[0_20px_56px_rgba(0,0,0,0.85)]',
        success:
          'bg-[#1e1e1e] border-white/[0.08] text-zinc-100 shadow-[0_20px_56px_rgba(0,0,0,0.85)]',
        gold:
          'bg-[#1e1e1e] border-white/[0.08] text-zinc-100 shadow-[0_20px_56px_rgba(0,0,0,0.85)]',
        warning:
          'bg-[#1e1e1e] border-white/[0.08] text-zinc-100 shadow-[0_20px_56px_rgba(0,0,0,0.85)]',
        destructive:
          'bg-[#1e1e1e] border-white/[0.08] text-zinc-100 shadow-[0_20px_56px_rgba(0,0,0,0.85)]',
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
      'inline-flex shrink-0 items-center justify-center bg-transparent px-2 py-1 text-sm font-semibold text-zinc-300 transition-colors hover:text-white focus:outline-none disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
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
      'inline-flex items-center justify-center bg-transparent border-0 px-2 py-1 text-sm font-semibold text-[#f59e0b] transition-colors hover:text-[#fbbf24] focus:outline-none cursor-pointer',
      className,
    )}
    toast-close=""
    aria-label="Close notification"
    {...props}
  >
    Close
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn(
      'text-[15px] font-normal leading-relaxed text-zinc-100 break-words',
      className,
    )}
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
      'text-[15px] font-normal leading-relaxed text-zinc-100 break-words',
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
