import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-center"
      // Telefon (PWA standalone): toast pod paskiem statusu/notchem, nie na nim.
      mobileOffset={{ top: 'calc(env(safe-area-inset-top) + 16px)' }}
      toastOptions={{
        classNames: {
          toast:
            'group toast gap-2.5 font-sans group-[.toaster]:rounded-lg group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:px-3.5 group-[.toaster]:py-3 group-[.toaster]:text-[13px] group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-popover',
          title: 'font-medium',
          description: 'group-[.toast]:text-xs group-[.toast]:text-muted-foreground',
          icon: 'group-data-[type=success]:text-emerald-600 group-data-[type=error]:text-destructive group-data-[type=warning]:text-amber-600 group-data-[type=info]:text-primary dark:group-data-[type=success]:text-emerald-400 dark:group-data-[type=warning]:text-amber-400',
          actionButton:
            'group-[.toast]:rounded-md group-[.toast]:bg-primary group-[.toast]:font-medium group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:rounded-md group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
