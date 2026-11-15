import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 dark:bg-black/60',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onPointerDownOutside, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid max-h-[90vh] w-[calc(100%-1.5rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] grid-cols-1 gap-4 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-popover duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
        // grid-cols-1 = minmax(0,1fr): długi tytuł z `truncate` nie rozpycha okna poza ekran.
        // Desktop: wysokie okno nie wychodzi poza ekran - przewija się w max-h-[90vh] (wywołujący może nadpisać max-h/overflow).
        // Telefon: arkusz od dołu, przewijany, z miejscem na pasek iOS.
        // Poniżej sm zajmuje pełną szerokość; na małym tablecie zachowuje szerokość `sm:max-w-*`.
        'max-md:bottom-0 max-md:top-auto max-md:max-h-[92dvh] max-md:translate-y-0 max-md:overflow-y-auto max-md:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-md:data-[state=closed]:zoom-out-100 max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:slide-out-to-bottom-full max-md:data-[state=open]:slide-in-from-bottom-full max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none',
        className,
      )}
      onPointerDownOutside={(e) => {
        // Klik poza oknem przy otwartej liście `SearchSelect` zamyka tylko listę (jak przy `Select`).
        if (document.querySelector('[data-search-select-popup][data-state="open"]')) e.preventDefault();
        onPointerDownOutside?.(e);
      }}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none max-md:right-2 max-md:top-2 max-md:h-11 max-md:w-11">
        <X className="h-4 w-4" />
        <span className="sr-only">Zamknij</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 pr-8 text-left max-md:pr-10', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // -bottom-6/-mb-6/pb-6: stopka przykrywa dolny padding DialogContent (p-6), więc przewijana treść nie prześwituje pod nią.
      // max-md: to samo dla dolnego paddingu arkusza powiększonego o safe-area.
      // `!` przy marginesie: stopka bywa w `<form className="space-y-*">`, a `space-y` zeruje margin-bottom dzieci
      // selektorem o wyższej specyficzności (zostawał pusty pas 24 px pod przyciskami). Nadpisanie: `!mb-0`.
      'sticky -bottom-6 z-10 !-mb-6 flex flex-col-reverse bg-card pb-6 pt-2 sm:flex-row sm:justify-end sm:space-x-2 max-md:-bottom-[calc(1.5rem+env(safe-area-inset-bottom))] max-md:!-mb-[calc(1.5rem+env(safe-area-inset-bottom))] max-md:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:gap-3',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-tight tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
