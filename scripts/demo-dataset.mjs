#!/usr/bin/env node
// Resets ONLY the MedPoint LOCAL MOCK / DEMO synthetic dataset.
//
//   node scripts/demo-dataset.mjs reset            # local Supabase (default)
//   node scripts/demo-dataset.mjs storage          # re-sync synthetic files only
//   node scripts/demo-dataset.mjs reset --remote --confirm=<project-ref>
//
// SQL: calls mp_private.reset_demo_dataset(), which deletes rows belonging to demo
// organizations/profiles only and re-seeds them deterministically.
// Storage: touches only the dedicated `mp-demo-documents` bucket. Objects that are
// not part of the seeded set (e.g. test uploads) are removed; seeded files are
// re-uploaded byte-for-byte deterministically.
//
// Service-role credentials are read from the environment or local `supabase status`
// and are never printed.

import { existsSync } from 'node:fs'
import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { localSupabaseEnv } from './lib/local-supabase.mjs'
import { syntheticFile } from './lib/synthetic-files.mjs'

const BUCKET = 'mp-demo-documents'
const LOCAL_PASSWORD = 'MedPointDemo!2026'

const args = process.argv.slice(2)
const command = args.find((arg) => !arg.startsWith('--')) || 'reset'
const remote = args.includes('--remote')
const confirm = args.find((arg) => arg.startsWith('--confirm='))?.split('=')[1]

function fail(message) {
  console.error(`demo-dataset: ${message}`)
  process.exit(1)
}

function localConfig() {
  let env
  try {
    env = localSupabaseEnv()
  } catch (error) {
    fail(error.message)
  }
  return {
    label: 'local',
    dbUrl: env.DB_URL,
    apiUrl: env.API_URL,
    serviceKey: env.SERVICE_ROLE_KEY,
    password: process.env.MP_DEMO_PASSWORD || LOCAL_PASSWORD,
  }
}

function remoteConfig() {
  if (existsSync('.env.backend')) process.loadEnvFile('.env.backend')
  const ref = process.env.SUPABASE_PROJECT_REF
  const required = ['SUPABASE_PROJECT_REF', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MP_DEMO_PASSWORD']
  const missing = required.filter((name) => !process.env[name])
  if (missing.length) fail(`remote reset needs ${missing.join(', ')} in .env.backend or the environment.`)
  if (confirm !== ref) fail(`remote reset requires --confirm=${ref} to prove the target project.`)
  return {
    label: `remote project ${ref}`,
    dbUrl: process.env.SUPABASE_DB_URL,
    apiUrl: process.env.SUPABASE_URL || `https://${ref}.supabase.co`,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    password: process.env.MP_DEMO_PASSWORD,
  }
}

async function resetRows(sql, password) {
  const nonDemo = await sql`select count(*)::int as n from public.mp_organizations where not is_demo`
  if (nonDemo[0].n !== 0) fail('refusing to reset: non-demo organizations exist in mp_organizations.')
  const [{ counts }] = await sql`select mp_private.reset_demo_dataset(${password}) as counts`
  return counts
}

async function syncStorage(sql, storage) {
  const documents = await sql`
    select storage_path, mime_type, document_number, file_name, category, description
    from public.mp_documents where is_seeded order by storage_path`
  const forms = await sql`select storage_path, mime_type, folder, title from public.mp_forms_manuals order by storage_path`

  const expected = new Map()
  for (const doc of documents) {
    expected.set(doc.storage_path, {
      mimeType: doc.mime_type,
      body: syntheticFile({
        mimeType: doc.mime_type,
        title: `Synthetic document ${doc.document_number}`,
        lines: [`File: ${doc.file_name}`, `Category: ${doc.category}`, `Description: ${doc.description}`],
      }),
    })
  }
  for (const form of forms) {
    expected.set(form.storage_path, {
      mimeType: form.mime_type,
      body: syntheticFile({
        mimeType: form.mime_type,
        title: form.title,
        lines: [`Folder: ${form.folder}`, 'Synthetic forms-and-manuals entry. Not a production document.'],
      }),
    })
  }

  const existing = await sql`select name from storage.objects where bucket_id = ${BUCKET}`
  const stale = existing.map((row) => row.name).filter((name) => !expected.has(name))
  for (let index = 0; index < stale.length; index += 100) {
    const { error } = await storage.from(BUCKET).remove(stale.slice(index, index + 100))
    if (error) fail(`could not remove stale demo objects: ${error.message}`)
  }

  for (const [path, file] of expected) {
    const { error } = await storage.from(BUCKET).upload(path, file.body, { contentType: file.mimeType, upsert: true })
    if (error) fail(`upload failed for ${path}: ${error.message}`)
  }

  await sql.begin(async (tx) => {
    // Maintenance write: keep it out of the demo audit trail.
    await tx`select set_config('mp.suppress_audit', 'on', true)`
    for (const doc of documents) {
      await tx`update public.mp_documents set size_bytes = ${expected.get(doc.storage_path).body.length}
               where storage_path = ${doc.storage_path}`
    }
  })
  return { uploaded: expected.size, removed: stale.length }
}

async function main() {
  if (!['reset', 'storage'].includes(command)) fail(`unknown command "${command}". Use reset or storage.`)
  const config = remote ? remoteConfig() : localConfig()
  const sql = postgres(config.dbUrl, { max: 1, onnotice: () => {} })
  const admin = createClient(config.apiUrl, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    console.log(`demo-dataset: target ${config.label}`)
    if (command === 'reset') {
      const counts = await resetRows(sql, config.password)
      console.log(`demo-dataset: rows reset ${JSON.stringify(counts)}`)
    }
    const files = await syncStorage(sql, admin.storage)
    console.log(`demo-dataset: storage synced ${JSON.stringify(files)}`)
  } finally {
    await sql.end()
  }
}

main().catch((error) => fail(error.message))
