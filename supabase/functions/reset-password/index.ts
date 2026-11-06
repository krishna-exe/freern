// Sets a new password for someone who has their recovery code. This has to run on
// the server because only the service role may change another account's password.
// Every failure gets the same answer, so it can't be used to find out which IDs exist.
import { createClient } from 'npm:@supabase/supabase-js@2'

const MIN_PASSWORD_LENGTH = 6

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const WRONG_CODE = { ok: false, error: 'That user ID and recovery code don’t match. Check them, or try again in an hour.' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const { handle, code, password } = await req.json().catch(() => ({}))
  if (typeof handle !== 'string' || typeof code !== 'string' || typeof password !== 'string') {
    return reply({ ok: false, error: 'Fill in every field.' }, 400)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return reply({ ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400)
  }

  const { data: account, error } = await admin.rpc('check_recovery_code', { user_handle: handle, code })
  if (error) return reply({ ok: false, error: 'Something went wrong. Try again.' }, 500)
  if (!account) return reply(WRONG_CODE)

  const updated = await admin.auth.admin.updateUserById(account, { password })
  if (updated.error) return reply({ ok: false, error: 'Something went wrong. Try again.' }, 500)

  await admin.rpc('use_recovery_code', { account })
  return reply({ ok: true })
})
