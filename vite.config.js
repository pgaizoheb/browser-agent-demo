import { defineConfig, loadEnv } from 'vite'

// Builds a narrow Content-Security-Policy: same-origin assets plus the one configured
// Supabase origin (REST, Auth, RPC, Storage). No third-party scripts, fonts, or frames.
function contentSecurityPolicy(env, command) {
  const connect = ["'self'"]
  if (env.VITE_SUPABASE_URL) connect.push(new URL(env.VITE_SUPABASE_URL).origin)
  if (command === 'serve') connect.push('ws://localhost:*', 'ws://127.0.0.1:*') // Vite HMR in dev only
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    'frame-src blob:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if (/medpointmanagement/i.test(env.VITE_SUPABASE_URL || '')) {
    throw new Error('VITE_SUPABASE_URL must point at the demo Supabase project, never the production portal.')
  }
  return {
    base: env.VITE_BASE_PATH || '/browser-agent-demo/',
    plugins: [
      {
        name: 'medpoint-demo-csp',
        transformIndexHtml: (html) => html.replace('__MP_CSP__', contentSecurityPolicy(env, command)),
      },
    ],
  }
})
