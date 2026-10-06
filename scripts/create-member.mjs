// Links a Supabase Auth user (created manually in the dashboard, since invite redemption's
// Edge Function isn't built yet — CLAUDE.md §5a/§7 Phase 2) to a person in the family tree,
// as a member with the given role. This is the only way to create the first admin.
//
//   DATABASE_URL=postgres://...  FAMILY_NAME="..."  \
//     node scripts/create-member.mjs --email you@example.com --name "Full Name" --role admin
//
// --name must match persons.full_name exactly (case-insensitive). Re-running updates the
// same row (role, or which person it's linked to) instead of creating a duplicate membership.
import pg from 'pg';

const { DATABASE_URL, FAMILY_NAME } = process.env;
if (!DATABASE_URL || !FAMILY_NAME) {
  console.error('Set DATABASE_URL and FAMILY_NAME.');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []));
const { email, name, role = 'member' } = args;
if (!email || !name) {
  console.error('Usage: node scripts/create-member.mjs --email <email> --name "<full name>" [--role admin|branch_owner|member]');
  process.exit(1);
}
if (!['admin', 'branch_owner', 'member'].includes(role)) {
  console.error(`Role must be admin, branch_owner or member, got "${role}".`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  const { rows: familyRows } = await client.query('select id from families where name = $1', [FAMILY_NAME]);
  if (!familyRows.length) throw new Error(`No family named "${FAMILY_NAME}". Has the seed been imported?`);
  const familyId = familyRows[0].id;

  const { rows: userRows } = await client.query('select id from auth.users where lower(email) = lower($1)', [email]);
  if (!userRows.length) throw new Error(`No auth user with email ${email}. Create it in Supabase Dashboard → Authentication → Users first.`);
  const userId = userRows[0].id;

  const { rows: personRows } = await client.query(
    'select id, full_name from persons where family_id = $1 and lower(full_name) = lower($2)', [familyId, name]);
  if (!personRows.length) throw new Error(`No person named "${name}" in this family. Check spelling against persons.csv.`);
  if (personRows.length > 1) throw new Error(`${personRows.length} people are named "${name}" in this family — link manually via SQL instead.`);
  const personId = personRows[0].id;

  await client.query(
    `insert into members (family_id, user_id, person_id, role)
     values ($1, $2, $3, $4)
     on conflict (family_id, user_id) do update set person_id = excluded.person_id, role = excluded.role`,
    [familyId, userId, personId, role]);

  console.log(`Linked ${email} → ${personRows[0].full_name} (${personId}) as ${role} in family ${familyId}.`);
  if (role === 'admin') {
    console.log('Note: admin powers (per docs/database.md) need an authenticator-app sign-in (TOTP), not just a password. '
      + 'Enroll MFA for this account before relying on admin-only screens.');
  }
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
