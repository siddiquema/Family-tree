import en from './en.json';
import ta from './ta.json';
import { state } from '../data/store.js';

const strings = { en, ta };

/** Translated string with {placeholders}. Falls back to English, then to the key. */
export function t(key, vars = {}) {
  const s = strings[state.lang][key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

/** DD MMM YY, in the interface language. Intl.DateTimeFormat throws RangeError: Invalid time
 *  value on a bad date rather than printing something — that's crashed a whole screen before
 *  (see admin.js's formatWhen), so guard here too rather than at every caller. */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(state.lang === 'ta' ? 'ta-IN' : 'en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).format(d);
}
