import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { signingStatusLabel, type SigningDocument, type SigningStatus } from '@/lib/signing';

const STATUS_VARIANT: Record<SigningStatus, NonNullable<BadgeProps['variant']>> = {
  do_podpisu: 'warning',
  pobrany: 'warning',
  do_poprawy: 'destructive',
  podpisany: 'secondary',
  wyslany: 'outline',
  anulowany: 'muted',
};

interface Props {
  document: Pick<SigningDocument, 'status' | 'requires_signature'>;
  className?: string;
}

/** Status dokumentu; bez wymogu podpisu `podpisany` = "Gotowy do wysyłki". */
export function SigningStatusBadge({ document, className }: Props) {
  return (
    <Badge variant={STATUS_VARIANT[document.status]} className={cn('shrink-0', className)}>
      {signingStatusLabel(document)}
    </Badge>
  );
}
