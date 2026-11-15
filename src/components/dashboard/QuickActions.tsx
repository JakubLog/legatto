import { Briefcase, Calendar, FileText, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const QUICK_LINKS = [
  { to: '/biuro/sprawy', label: 'Sprawy', icon: Briefcase },
  { to: '/biuro/kontakty', label: 'Kontakty', icon: Users },
  { to: '/biuro/kalendarz', label: 'Kalendarz', icon: Calendar },
  { to: '/biuro/interpelacje', label: 'Interpelacje', icon: FileText },
  { to: '/biuro/budzet', label: 'Budżet', icon: Wallet },
] as const;

/** Rząd kompaktowych skrótów do modułów portalu (tylko nawigacja). */
export function QuickActions() {
  return (
    <nav aria-label="Szybkie akcje" className="space-y-2">
      <h2 className="text-xs font-medium text-muted-foreground">Szybkie akcje</h2>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 max-md:gap-3 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
        {QUICK_LINKS.map(({ to, label, icon: Icon }) => (
          <Button
            key={to}
            asChild
            variant="outline"
            size="sm"
            className="h-10 shrink-0 rounded-lg bg-card shadow-card hover:border-primary/30 hover:bg-primary/5 hover:text-foreground max-md:h-11 max-md:px-4"
          >
            <Link to={to}>
              <Icon className="text-primary" />
              {label}
            </Link>
          </Button>
        ))}
      </div>
    </nav>
  );
}
