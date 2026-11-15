import { addWeeks, startOfWeek, subWeeks } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type InterpellationSpeedMetricName =
  | 'submission_to_sent'
  | 'acceptance_to_sent'
  | 'feedback_to_revision';

export interface InterpellationSpeedMetric {
  averageSeconds: number | null;
  previousAverageSeconds: number | null;
  sampleCount: number;
  /** Dodatnia wartość oznacza szybciej, ujemna wolniej. */
  trendPercent: number | null;
}

export interface InterpellationMetrics {
  speed: Record<InterpellationSpeedMetricName, InterpellationSpeedMetric>;
  createdThisWeek: number;
  sentFromCreatedThisWeek: number;
  sentPercent: number;
}

interface DurationSample {
  metric: InterpellationSpeedMetricName;
  duration_seconds: number | string;
  completed_at: string;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** PostgREST zwraca maksymalnie `max_rows` (1000) wierszy; pobieramy kolejne strony. */
const SAMPLES_PAGE_SIZE = 1000;

async function fetchSamples(from: Date, to: Date): Promise<DurationSample[]> {
  const samples: DurationSample[] = [];
  for (let offset = 0; ; offset += SAMPLES_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('interpellation_duration_samples')
      .select('metric, duration_seconds, completed_at')
      .gte('completed_at', from.toISOString())
      .lt('completed_at', to.toISOString())
      .order('id')
      .range(offset, offset + SAMPLES_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as DurationSample[];
    samples.push(...page);
    if (page.length < SAMPLES_PAGE_SIZE) return samples;
  }
}

/** Średnie czasy bieżącego tygodnia i trend względem poprzedniego tygodnia kalendarzowego. */
export function useInterpellationMetrics() {
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const previousWeekStart = subWeeks(currentWeekStart, 1);
  const nextWeekStart = addWeeks(currentWeekStart, 1);

  return useQuery<InterpellationMetrics>({
    queryKey: ['interpellations', 'metrics', currentWeekStart.toISOString()],
    queryFn: async () => {
      const createdThisWeek = () =>
        supabase
          .from('interpellations')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', currentWeekStart.toISOString())
          .lt('created_at', nextWeekStart.toISOString());
      const [samples, createdResult, sentResult] = await Promise.all([
        fetchSamples(previousWeekStart, nextWeekStart),
        createdThisWeek(),
        createdThisWeek().eq('status', 'wyslana'),
      ]);
      if (createdResult.error) throw createdResult.error;
      if (sentResult.error) throw sentResult.error;

      const metricNames: InterpellationSpeedMetricName[] = [
        'submission_to_sent',
        'acceptance_to_sent',
        'feedback_to_revision',
      ];
      const speed = Object.fromEntries(
        metricNames.map((metric) => {
          const current = samples
            .filter((sample) => sample.metric === metric && new Date(sample.completed_at) >= currentWeekStart)
            .map((sample) => Number(sample.duration_seconds));
          const previous = samples
            .filter(
              (sample) =>
                sample.metric === metric &&
                new Date(sample.completed_at) >= previousWeekStart &&
                new Date(sample.completed_at) < currentWeekStart,
            )
            .map((sample) => Number(sample.duration_seconds));
          const averageSeconds = average(current);
          const previousAverageSeconds = average(previous);
          // Poprzednia średnia 0 s: procentu nie da się policzyć; 0 → 0 to brak zmian.
          const trendPercent =
            averageSeconds === null || previousAverageSeconds === null
              ? null
              : previousAverageSeconds > 0
                ? Math.round(((previousAverageSeconds - averageSeconds) / previousAverageSeconds) * 100)
                : averageSeconds === 0
                  ? 0
                  : null;
          return [
            metric,
            { averageSeconds, previousAverageSeconds, sampleCount: current.length, trendPercent },
          ];
        }),
      ) as Record<InterpellationSpeedMetricName, InterpellationSpeedMetric>;

      const created = createdResult.count ?? 0;
      const sentFromCreatedThisWeek = sentResult.count ?? 0;
      return {
        speed,
        createdThisWeek: created,
        sentFromCreatedThisWeek,
        sentPercent: created === 0 ? 0 : Math.round((sentFromCreatedThisWeek / created) * 100),
      };
    },
    staleTime: 30_000,
  });
}
