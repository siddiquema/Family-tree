-- Draft kinship terms from CLAUDE.md §6a, copied into each new family.
-- Kanyakumari local terms ship unverified (is_verified = false): the app shows formal Tamil
-- until an admin confirms each local term with family elders.

create or replace function app.seed_kinship_terms(fid uuid) returns integer
language sql security definer set search_path = public, pg_temp as $$
  insert into kinship_terms (family_id, path, side, target_gender, label_en, label_ta_formal,
                             label_ta_local, label_ta_local_roman, notes)
  select fid, v.path, v.side, v.target_gender, v.label_en, v.label_ta_formal, v.label_ta_local, v.label_ta_local_roman,
         case when v.label_ta_local is null then 'No local term yet' else 'Draft local term: verify with elders' end
    from (values
    ('F', 'paternal', 'male', 'Father', 'அப்பா', 'வாப்பா', 'Vaappa'),
    ('M', 'maternal', 'female', 'Mother', 'அம்மா', 'உம்மா', 'Umma'),
    ('F.F', 'paternal', 'male', 'Paternal grandfather', 'தாத்தா', null, null),
    ('F.M', 'paternal', 'female', 'Paternal grandmother', 'பாட்டி', null, null),
    ('M.F', 'maternal', 'male', 'Maternal grandfather', 'தாத்தா', null, null),
    ('M.M', 'maternal', 'female', 'Maternal grandmother', 'பாட்டி', null, null),
    ('eB', 'none', 'male', 'Elder brother', 'அண்ணன்', 'காக்கா', 'Kaakka'),
    ('yB', 'none', 'male', 'Younger brother', 'தம்பி', 'தம்பி', 'Thambi'),
    ('eZ', 'none', 'female', 'Elder sister', 'அக்கா', 'ராத்தா', 'Raatha'),
    ('yZ', 'none', 'female', 'Younger sister', 'தங்கை', 'தங்கச்சி', 'Thangachi'),
    ('F.eB', 'paternal', 'male', 'Father''s elder brother', 'பெரியப்பா', 'பெரிய வாப்பா', 'Periya Vaappa'),
    ('F.yB', 'paternal', 'male', 'Father''s younger brother', 'சித்தப்பா', 'இளைய வாப்பா', 'Ilaya Vaappa'),
    ('F.eB.W', 'paternal', 'female', 'Father''s elder brother''s wife', 'பெரியம்மா', 'பெரியும்மா', 'Periyumma'),
    ('F.yB.W', 'paternal', 'female', 'Father''s younger brother''s wife', 'சித்தி', 'இளையும்மா', 'Ilayumma'),
    ('F.Z', 'paternal', 'female', 'Father''s sister', 'அத்தை', null, null),
    ('F.Z.H', 'paternal', 'male', 'Father''s sister''s husband', 'மாமா', 'மாமா', 'Maama'),
    ('M.eZ', 'maternal', 'female', 'Mother''s elder sister', 'பெரியம்மா', 'பெரியும்மா', 'Periyumma'),
    ('M.yZ', 'maternal', 'female', 'Mother''s younger sister', 'சித்தி', 'இளையும்மா', 'Ilayumma'),
    ('M.B', 'maternal', 'male', 'Mother''s brother', 'மாமா', 'மாமா', 'Maama'),
    ('M.B.W', 'maternal', 'female', 'Mother''s brother''s wife', 'மாமி', 'மாமி', 'Maami'),
    ('M.B.S', 'maternal', 'male', 'Cross cousin (male)', 'மச்சான்', 'மச்சான்', 'Machaan'),
    ('F.Z.S', 'paternal', 'male', 'Cross cousin (male)', 'அத்தான்', 'மச்சான்', 'Machaan'),
    ('M.B.D', 'maternal', 'female', 'Cross cousin (female)', 'மச்சினி', null, null),
    ('F.Z.D', 'paternal', 'female', 'Cross cousin (female)', 'மச்சினி', null, null),
    ('S', 'none', 'male', 'Son', 'மகன்', null, null),
    ('D', 'none', 'female', 'Daughter', 'மகள்', null, null),
    ('S.S', 'none', 'male', 'Grandson', 'பேரன்', 'பேரன்', 'Peran'),
    ('D.S', 'none', 'male', 'Grandson', 'பேரன்', 'பேரன்', 'Peran'),
    ('S.D', 'none', 'female', 'Granddaughter', 'பேத்தி', 'பேத்தி', 'Pethi'),
    ('D.D', 'none', 'female', 'Granddaughter', 'பேத்தி', 'பேத்தி', 'Pethi'),
    ('H', 'none', 'male', 'Husband', 'கணவர்', null, null),
    ('W', 'none', 'female', 'Wife', 'மனைவி', null, null),
    ('H.F', 'none', 'male', 'Father-in-law', 'மாமனார்', 'மாமா', 'Maama'),
    ('W.F', 'none', 'male', 'Father-in-law', 'மாமனார்', 'மாமா', 'Maama'),
    ('H.M', 'none', 'female', 'Mother-in-law', 'மாமியார்', 'மாமி', 'Maami'),
    ('W.M', 'none', 'female', 'Mother-in-law', 'மாமியார்', 'மாமி', 'Maami'),
    ('eB.W', 'none', 'female', 'Elder brother''s wife', 'அண்ணி', null, null),
    ('Z.H', 'none', 'male', 'Sister''s husband', 'மச்சான்', 'மச்சான்', 'Machaan'),
    ('W.B', 'none', 'male', 'Wife''s brother', 'மச்சான்', 'மச்சான்', 'Machaan'),
    ('H.Z', 'none', 'female', 'Husband''s sister', 'நாத்தனார்', null, null)
    ) as v(path, side, target_gender, label_en, label_ta_formal, label_ta_local, label_ta_local_roman)
  on conflict do nothing;
  select count(*)::int from kinship_terms where family_id = fid;
$$;

create or replace function app.on_family_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.seed_kinship_terms(new.id);
  return new;
end $$;

create trigger families_seed_kinship after insert on public.families
  for each row execute function app.on_family_created();
