alter table public.cases
  add column if not exists provider_name text not null default 'Demo Provider Group',
  add column if not exists provider_reference text not null default 'PRV-DEMO',
  add column if not exists diagnosis_context text not null default 'Fictional diagnosis context pending review.';

update public.cases
set
  provider_name = case request_id
    when 'PA-24001' then 'Harbor Dermatology Demo Clinic'
    when 'PA-24002' then 'Summit Rheumatology Demo Group'
    when 'PA-24003' then 'Lakeside Plastic Surgery Demo Center'
    when 'PA-24004' then 'Pine Valley Neurology Demo Practice'
    when 'PA-24005' then 'Metro Orthopedic Demo Institute'
    when 'PA-24006' then 'Cedar Endocrinology Demo Clinic'
    when 'PA-24007' then 'Northstar Rehabilitation Demo Center'
    when 'PA-24008' then 'Moonlight Sleep Demo Clinic'
    else provider_name
  end,
  provider_reference = case request_id
    when 'PA-24001' then 'PRV-2001'
    when 'PA-24002' then 'PRV-2002'
    when 'PA-24003' then 'PRV-2003'
    when 'PA-24004' then 'PRV-2004'
    when 'PA-24005' then 'PRV-2005'
    when 'PA-24006' then 'PRV-2006'
    when 'PA-24007' then 'PRV-2007'
    when 'PA-24008' then 'PRV-2008'
    else provider_reference
  end,
  diagnosis_context = case request_id
    when 'PA-24001' then 'Fictional diagnosis L20.9; severe atopic dermatitis.'
    when 'PA-24002' then 'Fictional rheumatoid arthritis treatment review.'
    when 'PA-24003' then 'Fictional cosmetic procedure request without functional diagnosis.'
    when 'PA-24004' then 'Fictional lumbar symptoms with newly documented left foot weakness.'
    when 'PA-24005' then 'Fictional advanced knee osteoarthritis procedure history.'
    when 'PA-24006' then 'Fictional conflicting type 2 diabetes and weight-management documentation.'
    when 'PA-24007' then 'Fictional rehabilitation plan following musculoskeletal injury.'
    when 'PA-24008' then 'Fictional fatigue and snoring evaluation for sleep-study review.'
    else diagnosis_context
  end;
