import { ClipboardList } from 'lucide-react';
import { AnalyticsCard } from '@/components/expenses/analytics/AnalyticsUi';
import { formatPLN } from '@/lib/expenses';
import type { Settlement } from '@/lib/settlement';
import { cn } from '@/lib/utils';

/** Podgląd tabeli sprawozdania: pozycje 1-22 (z podpozycjami 22), kategorie źródłowe, razem. */
export function SettlementPreview({ settlement }: { settlement: Settlement }) {
  return (
    <AnalyticsCard
      title="Sprawozdanie z wydatkowania ryczałtu"
      icon={ClipboardList}
      description="Pozycje formularza Kancelarii Sejmu z sumami kategorii przypisanych do każdej pozycji."
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="w-10 pb-2 pr-2 font-medium">Lp.</th>
            <th className="pb-2 pr-3 font-medium">Rodzaj wydatków</th>
            <th className="pb-2 text-right font-medium">Kwota</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {settlement.lines.map((line) => (
            <tr key={line.code} className={cn('align-top', line.amount === 0 && 'text-muted-foreground')}>
              <td className={cn('py-2 pr-2 tabular-nums', line.isSub && 'pl-3 text-xs')}>{line.lp}</td>
              <td className={cn('py-2 pr-3', line.isSub && 'pl-3 text-xs')}>
                <span className="block leading-snug">{line.label}</span>
                {line.categories.length > 0 && line.code !== '22' && (
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {line.categories.map((c) => c.name).join(', ')} · {line.count} dok.
                  </span>
                )}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap py-2 text-right tabular-nums',
                  line.amount > 0 && !line.isSub && 'font-semibold text-foreground',
                  line.isSub && 'text-xs',
                )}
              >
                {formatPLN(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2">
            <td />
            <td className="py-2.5 pr-3 font-semibold">Razem</td>
            <td className="whitespace-nowrap py-2.5 text-right font-semibold tabular-nums">
              {formatPLN(settlement.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </AnalyticsCard>
  );
}
