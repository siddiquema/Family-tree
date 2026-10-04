// A made-up family for the prototype and for tests. No real people: the real family data
// lives only in Supabase and in the gitignored /seed folder (CLAUDE.md §9).
// Rows have the same shape as the database tables, so the app can switch to Supabase
// by replacing src/data/store.js without touching the screens.

const P = (id, full_name, gender, birth_year, extra = {}) => ({
  id, full_name, name_known: full_name !== null, gender, birth_year,
  is_living: extra.death_year ? false : (extra.is_living ?? null),
  house_name: null, known_as: null, native_place: null, city: null, ...extra,
});

export const persons = [
  P('p01', 'Mohamed Yusuf', 'male', 1880, { death_year: 1941, house_name: 'Kadalkarai', native_place: 'Colachel' }),
  P('p02', 'Rahmath Beevi', 'female', 1886, { death_year: 1950 }),
  P('p03', 'Abdul Khader', 'male', 1905, { death_year: 1970, house_name: 'Kadalkarai' }),
  P('p04', 'Fathima', 'female', 1910, { death_year: 1985 }),
  P('p05', null, 'unknown', null, { is_living: false, notes: 'Died in infancy' }),
  P('p06', 'Ayisha Umma', 'female', 1912, { death_year: 1990, house_name: 'Vellai Veedu' }),
  P('p07', 'Hameed', 'male', 1905, { death_year: 1975 }),
  P('p08', 'Yusuf Ali', 'male', 1932, { death_year: 2004, house_name: 'Kadalkarai' }),
  P('p09', 'Khadija', 'female', 1938, { is_living: true, city: 'Nagercoil' }),
  P('p10', 'Rahima', 'female', 1936, { is_living: true }),
  P('p11', 'Basheer Ahamed', 'male', 1941, { death_year: 2015 }),
  P('p12', 'Zubaida', 'female', 1945, { death_year: 1972 }),
  P('p13', 'Nafeesa', 'female', 1950, { is_living: true }),
  P('p14', 'Salim', 'male', 1934, { death_year: 2010 }),
  P('p15', 'Mumtaz', 'female', 1940, { is_living: true }),
  P('p16', 'Nizar', 'male', 1960, { is_living: true, city: 'Nagercoil' }),
  P('p17', 'Shameema', 'female', 1965, { is_living: true, city: 'Nagercoil' }),
  P('p18', 'Farida', 'female', 1963, { is_living: true, city: 'Thuckalay' }),
  P('p19', 'Jabbar', 'male', 1958, { is_living: true }),
  P('p20', 'Riyaz', 'male', 1968, { is_living: true, city: 'Chennai' }),
  P('p21', 'Saleena', 'female', 1972, { is_living: true }),
  P('p22', 'Anwar', 'male', 1966, { is_living: true, city: 'Dubai' }),
  P('p23', 'Sabeena', 'female', 1975, { is_living: true }),
  P('p24', 'Jameela', 'female', 1962, { is_living: true }),
  P('p25', 'Kabeer', 'male', 1966, { is_living: true }),
  P('p26', 'Faizal', 'male', 1985, { is_living: true, city: 'Bengaluru' }),
  P('p27', 'Arif', 'male', 1988, { is_living: true, city: 'Nagercoil' }),
  P('p28', 'Hasina', 'female', 1991, { is_living: true }),
  P('p29', 'Safna', 'female', 1990, { is_living: true, city: 'Kochi' }),
  P('p30', 'Zara', 'female', 2016, { is_living: true }),
  P('p31', 'Imran', 'male', 2019, { is_living: true }),
  P('p32', 'Rasheed', 'male', 1985, { is_living: true, city: 'Thuckalay' }),
  P('p33', 'Afsal', 'male', 1995, { is_living: true, city: 'Chennai' }),
  P('p34', 'Nadia', 'female', 1994, { is_living: true }),
  P('p35', 'Rukhsana', 'female', 1970, { is_living: true }),
];

const parent = (a, b, subtype = 'biological') => ({ person_a: a, person_b: b, type: 'parent_of', subtype });
const kids = (father, mother, ...children) => children.flatMap((c) => [father && parent(father, c), mother && parent(mother, c)].filter(Boolean));
const wed = (a, b, status = 'married') => ({ person_a: a < b ? a : b, person_b: a < b ? b : a, type: 'spouse_of', status });

export const relationships = [
  wed('p01', 'p02'), ...kids('p01', 'p02', 'p03', 'p05', 'p06'),
  wed('p03', 'p04'), ...kids('p03', 'p04', 'p08', 'p10', 'p11'),
  wed('p06', 'p07'), ...kids('p07', 'p06', 'p14'),
  wed('p08', 'p09'), ...kids('p08', 'p09', 'p16', 'p18', 'p20'),
  wed('p11', 'p12', 'widowed'), ...kids('p11', 'p12', 'p22'),
  wed('p11', 'p13'), ...kids('p11', 'p13', 'p23'),
  wed('p14', 'p15'), ...kids('p14', 'p15', 'p24', 'p25'),
  wed('p16', 'p17'), ...kids('p16', 'p17', 'p26', 'p27', 'p29'),
  wed('p18', 'p19'), ...kids('p19', 'p18', 'p32'),
  wed('p20', 'p21'), ...kids('p20', 'p21', 'p33'),
  wed('p22', 'p35'), ...kids('p22', 'p35', 'p34'),
  wed('p27', 'p28'), ...kids('p27', 'p28', 'p30', 'p31'),
];

// Who has claimed a login (members.person_id). The viewer is p27, an admin.
export const members = [
  { person_id: 'p27', role: 'admin' },
  { person_id: 'p16', role: 'branch_owner' },
  { person_id: 'p26', role: 'member' },
  { person_id: 'p18', role: 'member' },
  { person_id: 'p20', role: 'member' },
  { person_id: 'p32', role: 'member' },
];
export const me = 'p27';
export const source = 'demo';
export const noWhatsapp = ['p18'];

// Dummy numbers only. Visibility is decided by the same immediate-family rule as the database.
export const contacts = {
  p27: { phone: '+91 90000 00027', phone_hidden: false },
  p16: { phone: '+91 90000 00016', phone_hidden: false },
  p26: { phone: '+91 90000 00026', phone_hidden: false },
  p18: { phone: '+91 90000 00018', phone_hidden: false },
  p20: { phone: '+91 90000 00020', phone_hidden: true },
  p32: { phone: '+91 90000 00032', phone_hidden: false },
};

export const announcements = [
  { id: 'a1', type: 'marriage', title: 'Nikah of Afsal and Nadia', body: 'Insha Allah on Sunday 15 Nov 26 at Kadalkarai house, Colachel. Walima to follow.', event_date: '2026-11-15', created_by: 'p20', sent_at: '2026-09-28', audience: 'all' },
  { id: 'a2', type: 'event', title: 'Family get-together', body: 'Lunch after Jumu\'ah at Nizar\'s house, Nagercoil. Bring old photographs to scan for the tree.', event_date: '2026-10-23', created_by: 'p16', sent_at: '2026-09-20', audience: 'selected' },
  { id: 'a3', type: 'birth', title: 'Welcome, baby girl', body: 'Rasheed and family are blessed with a daughter. Mother and baby are well.', event_date: '2026-08-02', created_by: 'p18', sent_at: '2026-08-03', audience: 'all' },
];

export const editRequests = [
  { id: 'e1', target_person_id: 'p08', submitted_by: 'p32', status: 'pending', created_at: '2026-10-01',
    proposed_changes: { native_place: 'Colachel', notes: 'Ran a cloth shop near Colachel harbour' } },
  { id: 'e2', target_person_id: 'p11', submitted_by: 'p26', status: 'pending', created_at: '2026-09-30',
    proposed_changes: { house_name: 'Kadalkarai', notes: 'Ran the furniture shop at Kottar' } },
];
