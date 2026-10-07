// Invite tokens (§3, §5a): generated in the browser, never sent to the server in the clear.
// Only their SHA-256 hash is stored, matching what redeem_invite() hashes server-side to check
// against (supabase/migrations/…_invite_redemption.sql), so both sides agree without the raw
// token ever living in the database.
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomToken(bytes = 24) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}
