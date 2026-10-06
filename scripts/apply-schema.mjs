// Applies every file in supabase/migrations/, in order, to DATABASE_URL.
// For a brand-new Supabase project only: the migrations use plain CREATE TABLE / CREATE POLICY,
// so re-running this against an already-migrated database will fail on "already exists" —
// that's expected, not a bug; it means the schema is already there.
//
//   DATABASE_URL=postgres://...  node scripts/apply-schema.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const dir = 'supabase/migrations';
const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL (Supabase → Project Settings → Database → Connect → Session pooler).');
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  for (const file of files) {
    process.stdout.write(`${file} ... `);
    await client.query(readFileSync(join(dir, file), 'utf8'));
    console.log('ok');
  }
  console.log('\nSchema applied. Next: npm run seed:import');
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  console.error('Nothing after this file was applied; fix the cause and run again — tables already created are left as they are.');
  process.exitCode = 1;
} finally {
  await client.end();
}
