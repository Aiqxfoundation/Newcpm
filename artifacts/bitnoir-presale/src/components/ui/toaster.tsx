import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

type ToastVariant = 'default' | 'success' | 'gold' | 'warning' | 'destructive';

export function Toaster() {
  const { toasts } = useToast();
  const hasVisibleToast = toasts.some((t) => t.open !== false);

  return (
    <ToastProvider duration={Infinity} swipeThreshold={99999}>
      {hasVisibleToast && (
        <div
          className="fixed inset-0 z-[119] bg-black/55 pointer-events-auto transition-opacity duration-150"
          aria-hidden="true"
        />
      )}
      {toasts.map(function ({ id, title, description, action, icon: _icon, variant, duration: _duration, ...props }) {
        const resolvedVariant: ToastVariant = variant ?? 'default';
        const message = description || title;

        return (
          <Toast
            key={id}
            variant={resolvedVariant}
            duration={Infinity}
            onSwipeStart={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
            {...props}
          >
            {message && (
              <ToastDescription>{message}</ToastDescription>
            )}

            <div className="flex items-center justify-end gap-4">
              {action}
              <ToastClose />
            </div>
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
