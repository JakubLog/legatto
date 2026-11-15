import { zodResolver } from '@hookform/resolvers/zod';
import type { FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/**
 * zodResolver typowany wyjściem schematu (tak jak w zod 3). W zod 4 typ wejścia
 * `z.coerce.*` to `unknown`, a pola z `.default()` są opcjonalne - formularze, które trzymają
 * wartości w typie wyjściowym schematu (`useForm<z.infer<...>>`), używają tego helpera.
 */
export function zodFormResolver<S extends z.ZodType<FieldValues>>(schema: S): Resolver<z.output<S>> {
  return zodResolver(schema as never) as unknown as Resolver<z.output<S>>;
}
