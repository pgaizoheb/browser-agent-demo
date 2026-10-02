-- Local `supabase db reset` entry point for the MedPoint LOCAL MOCK / DEMO dataset.
-- Rows only; synthetic attachment files are uploaded by `npm run demo:reset`.
-- The password below is the documented local demo password, not a secret.
select mp_private.reset_demo_dataset('MedPointDemo!2026');
