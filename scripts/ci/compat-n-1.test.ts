import { describe, expect, it } from 'vitest';
import { extractRefs, lostSurface, objectKeys, unresolvedRefs } from './compat-n-1.mjs';

function scan(source: string) {
  const refs = { tables: new Set<string>(), rpc: new Map<string, Set<string>>(), buckets: new Set<string>() };
  extractRefs(source, refs);
  return {
    tables: [...refs.tables].sort(),
    rpc: Object.fromEntries([...refs.rpc].map(([k, v]) => [k, [...v].sort()])),
    buckets: [...refs.buckets].sort(),
  };
}

describe('extractRefs', () => {
  it('rozróżnia tabele, kubełki i RPC z argumentami', () => {
    const refs = scan(`
      await supabase.from('cases').select('id, title');
      await supabase.storage
        .from('avatars').upload(path, file);
      await supabase.rpc('get_public_district', { p_gmina: id, p_opts: { nested: 1 }, p_short });
      await supabase.rpc('can_manage_newsletters');
      await supabase.rpc('dynamic_args', args);`);
    expect(refs).toEqual({
      tables: ['cases'],
      rpc: { can_manage_newsletters: [], dynamic_args: [], get_public_district: ['p_gmina', 'p_opts', 'p_short'] },
      buckets: ['avatars'],
    });
  });

  it('objectKeys pomija klucze zagnieżdżone i wartości ze stringami', () => {
    expect(objectKeys(" a: 'x, y: z', b: fn(c, d), 'e': [1, { f: 2 }] ")).toEqual(['a', 'b', 'e']);
  });
});

describe('lostSurface', () => {
  const refs = { tables: ['offices'], rpc: { get_x: ['p_a'] }, buckets: ['avatars'] };
  const before = [
    'table\toffices\tname',
    'tgrant\toffices\tanon\tSELECT',
    'tgrant\tunused\tanon\tSELECT',
    'func\tget_x',
    'farg\tget_x\tp_a',
    'farg\tget_x\tp_unused',
    'fexec\tget_x\tauthenticated',
    'bucket\tavatars',
  ];

  it('zwraca tylko utracone elementy używane przez N-1', () => {
    const after = ['table\toffices\tname', 'func\tget_x', 'farg\tget_x\tp_a', 'fexec\tget_x\tauthenticated', 'bucket\tavatars'];
    expect(lostSurface(refs, before, after)).toEqual(['tgrant\toffices\tanon\tSELECT']);
  });

  it('pusta lista przy zachowanej powierzchni; unresolvedRefs zgłasza brakujące obiekty', () => {
    expect(lostSurface(refs, before, before)).toEqual([]);
    expect(unresolvedRefs({ tables: ['gone'], rpc: {}, buckets: [] }, before)).toEqual(['tabela gone']);
  });
});
