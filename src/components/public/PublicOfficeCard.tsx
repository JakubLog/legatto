import { useState } from 'react';
import { ChevronRight, Phone } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { mpForms } from '@/lib/mpForms';
import { roleLabel } from '@/lib/permissions';
import type { SiteIdentity } from '@/lib/siteContent';
import type { SiteOffice, SiteStaffMember } from '@/lib/siteSnapshot';
import { cn } from '@/lib/utils';
import { OfficeContactList } from '@/components/public/OfficeContactList';
import { telHref } from '@/components/public/officeLinks';
import { publicCard, publicFocus, publicTag } from '@/components/public/styles';

/** Ile awatarów pokazać na kafelku; resztę zastępuje licznik "+N". */
const AVATAR_STACK_MAX = 4;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function StaffAvatar({ person, className }: { person: SiteStaffMember; className?: string }) {
  return (
    <Avatar className={cn('bg-cream-2', className)}>
      {person.avatar_url && <AvatarImage src={person.avatar_url} alt="" className="object-cover" />}
      <AvatarFallback className="bg-cream-2 font-semibold text-muted-foreground">{initials(person.full_name)}</AvatarFallback>
    </Avatar>
  );
}

function StaffList({ staff, mpGender }: { staff: SiteStaffMember[]; mpGender: SiteIdentity['mp_gender'] }) {
  const forms = mpForms(mpGender);
  return (
    <ul className="divide-y divide-border">
      {staff.map((person) => (
        <li key={person.id} className="flex items-center gap-3 py-3">
          <StaffAvatar person={person} className="h-12 w-12 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug">{person.full_name}</p>
            <p className="text-sm text-muted-foreground">{roleLabel(person.role, forms)}</p>
            {person.phone && (
              <a
                href={telHref(person.phone)}
                className={cn(
                  'inline-flex min-h-8 items-center gap-1.5 rounded text-sm font-medium tabular-nums hover:text-brand',
                  publicFocus,
                )}
              >
                <Phone className="h-3.5 w-3.5 text-brand" aria-hidden />
                {person.phone}
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface PublicOfficeCardProps {
  office: SiteOffice;
  /** Pracownicy biura widoczni publicznie (z migawki strony). */
  staff: SiteStaffMember[];
  /** Forma tytułu posła w etykiecie roli (Poseł/Posłanka). */
  mpGender: SiteIdentity['mp_gender'];
}

/** Kafelek biura: jednakowy dla wszystkich biur, biuro główne wyróżnione wyłącznie etykietą. */
export function PublicOfficeCard({ office, staff, mpGender }: PublicOfficeCardProps) {
  const [staffOpen, setStaffOpen] = useState(false);
  const shown = staff.slice(0, AVATAR_STACK_MAX);
  const hidden = staff.length - shown.length;

  return (
    <article id={`biuro-${office.id}`} className={cn(publicCard, 'flex h-full scroll-mt-24 flex-col')}>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold leading-snug">{office.name}</h3>
          {office.is_main && <span className={cn(publicTag, 'mt-0.5 shrink-0')}>Biuro główne</span>}
        </div>
        <OfficeContactList office={office} className="mt-2" />
      </div>

      {staff.length > 0 ? (
        <button
          type="button"
          onClick={() => setStaffOpen(true)}
          className={cn(
            'flex h-[60px] items-center gap-3 rounded-b-[var(--public-radius-card)] border-t border-border px-5 text-left transition-colors hover:bg-cream/60 sm:px-6',
            publicFocus,
            'focus-visible:outline-offset-[-3px]',
          )}
        >
          <span className="flex -space-x-2" aria-hidden>
            {shown.map((person) => (
              <StaffAvatar key={person.id} person={person} className="h-8 w-8 text-[11px] ring-2 ring-card" />
            ))}
            {hidden > 0 && (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cream-2 text-[11px] font-semibold text-muted-foreground ring-2 ring-card">
                +{hidden}
              </span>
            )}
          </span>
          <span className="text-sm font-medium">Zobacz zespół</span>
          <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden />
        </button>
      ) : null}

      <Dialog open={staffOpen} onOpenChange={setStaffOpen}>
        <DialogContent className="max-h-[85vh] max-w-md gap-2 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{office.name}</DialogTitle>
            <DialogDescription>Zespół biura</DialogDescription>
          </DialogHeader>
          <StaffList staff={staff} mpGender={mpGender} />
        </DialogContent>
      </Dialog>
    </article>
  );
}
