import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import {
  CalendarDays,
  Mail,
  MapPin,
  Newspaper,
  Pencil,
  Phone,
  StickyNote,
  Tag,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { canWrite, isAdmin } from '@/lib/permissions';
import { mailtoHref } from '@/lib/mailto';
import type { ContactWithRelations } from '@/integrations/supabase/types';
import { ContactAvatar, ContactTypePill } from './ContactAtoms';

interface Props {
  contact: ContactWithRelations | null;
  onClose: () => void;
  onEdit: (c: ContactWithRelations) => void;
  onDelete: (c: ContactWithRelations) => void;
}

function Property({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-start gap-3 py-2 max-md:grid-cols-[minmax(0,7rem)_1fr] max-md:items-center">
      <dt className="flex items-center gap-2 pt-px text-[13px] text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-muted-foreground">–</span>;

export function ContactDetailsDialog({ contact: c, onClose, onEdit, onDelete }: Props) {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const admin = isAdmin(profile?.role);

  const handleEdit = () => {
    if (!c) return;
    onClose();
    onEdit(c);
  };

  const handleDelete = () => {
    if (!c) return;
    onClose();
    onDelete(c);
  };

  const region = c ? [c.powiat?.name, c.gmina?.name].filter(Boolean).join(' · ') : '';
  const emailHref = mailtoHref(c?.email);
  const address = c
    ? [c.street, [c.postal_code, c.miejscowosc].filter(Boolean).join(' ')].filter(Boolean)
    : [];

  return (
    <Dialog open={c !== null} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {c && (
          <>
            <DialogHeader className="min-w-0 flex-row items-center gap-3 space-y-0 pr-8 text-left">
              <ContactAvatar firstName={c.first_name} lastName={c.last_name} type={c.type} size="lg" />
              <div className="min-w-0 space-y-1">
                <DialogTitle className="break-words text-lg leading-snug">
                  {c.first_name} {c.last_name}
                </DialogTitle>
                <DialogDescription className={c.function ? undefined : 'sr-only'}>
                  {c.function ?? 'Szczegóły kontaktu'}
                </DialogDescription>
              </div>
            </DialogHeader>

            <dl className="divide-y rounded-lg border bg-muted/20 px-3">
              <Property icon={Tag} label="Typ">
                <ContactTypePill type={c.type} />
              </Property>
              <Property icon={Phone} label="Telefon">
                {c.phone ? (
                  <a href={`tel:${c.phone}`} className="text-primary hover:underline max-md:inline-flex max-md:min-h-10 max-md:items-center">
                    {c.phone}
                  </a>
                ) : (
                  EMPTY
                )}
              </Property>
              <Property icon={Mail} label="Email">
                {c.email ? (
                  emailHref ? (
                    <a href={emailHref} className="break-all text-primary hover:underline max-md:inline-flex max-md:min-h-10 max-md:max-w-full max-md:items-center">
                      {c.email}
                    </a>
                  ) : (
                    <span className="break-all">{c.email}</span>
                  )
                ) : (
                  EMPTY
                )}
              </Property>
              <Property icon={MapPin} label="Region">
                {region || EMPTY}
              </Property>
              <Property icon={MapPin} label="Adres">
                {address.length > 0 ? address.map(line => <div key={line}>{line}</div>) : EMPTY}
              </Property>
              <Property icon={Newspaper} label="Newsletter">
                {c.newsletter_consent ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Zgoda
                  </span>
                ) : (
                  <span className="text-muted-foreground">Brak zgody</span>
                )}
              </Property>
              {c.creator && (
                <Property icon={UserRound} label="Dodał(a)">
                  <span className="inline-flex items-center gap-2">
                    <CreatorAvatar name={c.creator.full_name} avatarUrl={c.creator.avatar_url} className="h-5 w-5" />
                    {c.creator.full_name}
                  </span>
                </Property>
              )}
              <Property icon={CalendarDays} label="Utworzono">
                {format(new Date(c.created_at), 'd MMM yyyy', { locale: pl })}
              </Property>
            </dl>

            {c.notes && (
              <section className="space-y-1.5">
                <h3 className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                  <StickyNote className="h-4 w-4" />
                  Notatki
                </h3>
                <p className="whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-sm max-md:[overflow-wrap:anywhere]">{c.notes}</p>
              </section>
            )}

            {/* Stopka jak w podglądzie sprawy: Usuń po lewej, Zamknij + Edytuj po prawej. */}
            <DialogFooter>
              {admin && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
                  onClick={handleDelete}
                >
                  <Trash2 />
                  Usuń
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                Zamknij
              </Button>
              {writer && (
                <Button type="button" onClick={handleEdit}>
                  <Pencil />
                  Edytuj
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
