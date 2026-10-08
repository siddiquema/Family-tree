// Applies a single migration file to an already-running database — unlike apply-schema.mjs,
// which is for a brand-new project and re-runs every migration from the start (so it fails
// with "already exists" once the schema is already there). Use this instead whenever you've
// pulled a new migration file onto a database you've already set up.
//
//   node scripts/apply-one.mjs supabase/migrations/20261008000003_set_my_phone.sql
//
// Needs DATABASE_URL, or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (Supabase → Project
// Settings → Database → Connect → Session pooler) — same as apply-schema.mjs.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-one.mjs <path-to-migration.sql>');
  process.exit(1);
}
const { DATABASE_URL, PGHOST, PGPASSWORD } = process.env;
if (!DATABASE_URL && !(PGHOST && PGPASSWORD)) {
  console.error('Set DATABASE_URL, or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.');
  process.exit(1);
}

const client = new pg.Client(DATABASE_URL ? { connectionString: DATABASE_URL } : {});
await client.connect();
try {
  await client.query(readFileSync(file, 'utf8'));
  console.log('ok');
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
