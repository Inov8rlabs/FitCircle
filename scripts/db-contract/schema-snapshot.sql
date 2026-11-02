-- Schema snapshot for the DB contract test (apps/web/__tests__/db-contract.test.ts).
-- Refresh after applying a migration:  node scripts/db-contract/refresh-snapshot.mjs
select json_build_object(
  'relations', (select json_object_agg(c.relname, (select json_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
                from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','p')),
  'foreign_keys', (select json_agg(json_build_object('name', con.conname, 'table', con.conrelid::regclass::text, 'ref', con.confrelid::regclass::text,
                     'columns', (select json_agg(a.attname) from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)) order by con.conname)
                   from pg_constraint con where con.contype = 'f' and con.connamespace = 'public'::regnamespace),
  'functions', (select json_agg(distinct p.proname order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace)
) as snapshot;
