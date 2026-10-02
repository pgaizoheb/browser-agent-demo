export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  // Usernames without "@" map to synthetic accounts on the reserved example.invalid domain.
  loginDomain: 'example.invalid',
  bucket: 'mp-demo-documents',
  maxUploadBytes: 5 * 1024 * 1024,
  allowedUploadTypes: ['application/pdf', 'text/plain', 'image/png', 'image/jpeg'],
}

export const demoAccounts = [
  { username: 'demo.user', label: 'Demo User — provider office staff' },
  { username: 'demo.reviewer', label: 'Demo Reviewer — utilization reviewer' },
  { username: 'demo.admin', label: 'Demo Admin — IPA administrator' },
  { username: 'demo.viewer', label: 'Demo Viewer — read-only' },
  { username: 'demo.other', label: 'Demo Other IPA User — separate organization' },
]

// Documented synthetic password used by the sign-in "Fill demo credentials" helper.
// Hosted deployments may seed a different password (set VITE_DEMO_PASSWORD to match), or
// hide the helper entirely with VITE_DEMO_FILL=false.
export const demoPassword = import.meta.env.VITE_DEMO_FILL === 'false'
  ? ''
  : import.meta.env.VITE_DEMO_PASSWORD || 'MedPointDemo!2026'
