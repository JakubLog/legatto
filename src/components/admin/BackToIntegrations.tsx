import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Link powrotu do listy integracji (nad nagłówkiem podstrony). Na telefonie powrót daje pasek górny. */
export function BackToIntegrations() {
  return (
    <Button asChild variant="ghost" size="sm" className="-mb-2 -ml-2 text-muted-foreground max-md:hidden">
      <Link to="/biuro/admin/integracje">
        <ArrowLeft />
        Wszystkie integracje
      </Link>
    </Button>
  );
}
