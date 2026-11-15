import { Construction } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';

interface PlaceholderProps {
  title: string;
  description: string;
}

export default function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <Page narrow>
      <PageHeader title={title} />
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-14 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Construction className="h-5 w-5" />
        </div>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </Page>
  );
}
