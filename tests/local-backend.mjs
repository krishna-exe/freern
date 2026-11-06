// Test-only stand-in for Supabase auth + PostgREST, backed by real Postgres (PGlite).
// Runs the migrations for fast privacy checks. It has no realtime, so those need
// the real project. Usage: node tests/local-backend.mjs supabase/migrations/*.sql
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text unique not null, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- Same permissive defaults a hosted Supabase project has, so the revokes are really tested.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create publication supabase_realtime;
  create schema realtime;
  create table realtime.messages (id serial primary key);
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql as $$ select '' $$;
  create function realtime.send(jsonb, text, text, boolean) returns void language sql as $$ select $$;
`)
for (const f of process.argv.slice(2)) {
  if (!f.includes('hosted_only')) await db.exec(readFileSync(f, 'utf8'))
}

const passwords = new Map()
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const refreshTokens = new Map()
const session = (u) => {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const refresh_token = randomUUID()
  refreshTokens.set(refresh_token, u)
  return {
    access_token: `${b64({ alg: 'none' })}.${b64({ sub: u.id, role: 'authenticated', exp })}.x`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token,
    user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }
}
const sub = (req) => {
  try { return JSON.parse(Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1], 'base64url')).sub } catch { return null }
}
const as = (uid, fn) => db.transaction(async (tx) => {
  if (uid) await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid })])
  await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`)
  return fn(tx)
})

const ident = (s) => { if (!/^\w+$/.test(s)) throw new Error('bad identifier'); return `"${s}"` }
function where(params, args) {
  const parts = []
  for (const [k, v] of params) {
    if (k === 'select' || k === 'columns') continue
    if (k === 'or') {
      const ands = [...v.matchAll(/and\(([^)]*)\)/g)].map((m) => m[1].split(',').map((c) => {
        const [col, , val] = c.split('.'); args.push(val); return `${ident(col)}::text = $${args.length}`
      }).join(' and '))
      parts.push(`(${ands.join(' or ')})`)
    } else {
      args.push(v.replace(/^eq\./, '')); parts.push(`${ident(k)}::text = $${args.length}`)
    }
  }
  return parts.length ? ` where ${parts.join(' and ')}` : ''
}

async function rest(req, path, params, body) {
  const uid = sub(req)
  if (path[0] === 'rpc') {
    const named = Object.keys(body).map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')
    const r = await as(uid, (tx) => tx.query(`select ${ident(path[1])}(${named}) as v`, Object.values(body)))
    return [200, r.rows[0].v ?? null]
  }
  const table = `public.${ident(path[0])}`, args = []
  if (req.method === 'GET') {
    const cols = (params.get('select') ?? '*').split(',').map((c) => (c === '*' ? c : ident(c))).join(',')
    const sql = `select ${cols} from ${table}${where(params, args)}`
    return [200, (await as(uid, (tx) => tx.query(sql, args))).rows]
  }
  if (req.method === 'DELETE') {
    const sql = `delete from ${table}${where(params, args)}`
    await as(uid, (tx) => tx.query(sql, args)); return [204, null]
  }
  if (req.method === 'PATCH') {
    const sets = Object.entries(body).map(([k, v]) => { args.push(v); return `${ident(k)} = $${args.length}` }).join(', ')
    const sql = `update ${table} set ${sets}${where(params, args)}`
    await as(uid, (tx) => tx.query(sql, args)); return [204, null]
  }
  if (req.method === 'POST') {
    const keys = Object.keys(body)
    const sql = `insert into ${table} (${keys.map(ident)}) values (${keys.map((_, i) => `$${i + 1}`)})`
    await as(uid, (tx) => tx.query(sql, Object.values(body))); return [201, null]
  }
  return [405, { message: 'method' }]
}

async function auth(req, path, params, body) {
  if (path[0] === 'signup') {
    const id = randomUUID()
    try {
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, body.email, JSON.stringify(body.data ?? {})])
    } catch (e) {
      if (e.code === '23505') return [422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' }]
      return [500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' }]
    }
    passwords.set(body.email, { id, password: body.password })
    return [200, session({ id, email: body.email })]
  }
  if (path[0] === 'token' && params.get('grant_type') === 'refresh_token') {
    const u = refreshTokens.get(body.refresh_token)
    return u ? [200, session(u)] : [400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }]
  }
  if (path[0] === 'token') {
    const u = passwords.get(body.email)
    const stillThere = u && (await db.query('select 1 from auth.users where id = $1', [u.id])).rows.length > 0
    if (!stillThere || u.password !== body.password) return [400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }]
    return [200, session({ id: u.id, email: body.email })]
  }
  if (path[0] === 'logout') return [204, null]
  return [404, { msg: 'nope' }]
}

http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  let raw = ''
  req.on('data', (d) => { raw += d })
  req.on('end', async () => {
    const u = new URL(req.url, 'http://x')
    const [, svc, , ...path] = u.pathname.split('/')
    let status, out
    try {
      const body = raw ? JSON.parse(raw) : {}
      ;[status, out] = await (svc === 'auth' ? auth : rest)(req, path, u.searchParams, body)
    } catch (e) {
      status = e.code === '42501' ? 403 : 400
      out = { message: e.message, code: e.code }
    }
    res.writeHead(status, { ...cors, 'content-type': 'application/json' })
    res.end(out === null && status === 204 ? undefined : JSON.stringify(out))
  })
}).listen(54399, () => console.log('ready'))
