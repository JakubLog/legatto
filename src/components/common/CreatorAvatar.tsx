import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface Props {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  fallbackClassName?: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function CreatorAvatar({ name, avatarUrl, className, fallbackClassName }: Props) {
  return (
    <Avatar className={cn('h-6 w-6 ring-2 ring-card', className)} title={name}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
      <AvatarFallback className={cn('text-[10px] font-semibold', fallbackClassName)}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
