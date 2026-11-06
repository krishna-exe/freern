#!/usr/bin/env python3
"""One-time setup for push notifications. Safe to run again: existing keys are kept.

Makes the VAPID keys, gives the edge function its secrets, gives the database what
it needs to wake that function, and adds the public key to .env.local. The private
key is never written to disk or printed.
"""
import json
import pathlib
import secrets
import subprocess

from db import ROOT, management_api, project_ref, sql

ENV_FILE = pathlib.Path(ROOT) / '.env.local'


def vault_set(name, value):
    escaped = value.replace("'", "''")
    exists = sql(f"select id from vault.secrets where name = '{name}'")
    if exists:
        sql(f"select vault.update_secret('{exists[0]['id']}', '{escaped}')")
    else:
        sql(f"select vault.create_secret('{escaped}', '{name}')")


if 'VITE_VAPID_PUBLIC_KEY=' in ENV_FILE.read_text():
    raise SystemExit('Already set up. Delete VITE_VAPID_PUBLIC_KEY from .env.local to make new keys.')

keys = json.loads(subprocess.check_output(['npx', '-y', 'web-push', 'generate-vapid-keys', '--json'], text=True))
dispatch_secret = secrets.token_urlsafe(32)

management_api('POST', '/secrets', [
    {'name': 'VAPID_PUBLIC_KEY', 'value': keys['publicKey']},
    {'name': 'VAPID_PRIVATE_KEY', 'value': keys['privateKey']},
    {'name': 'VAPID_SUBJECT', 'value': 'https://freern.vercel.app'},
    {'name': 'DISPATCH_SECRET', 'value': dispatch_secret},
])
vault_set('project_url', f'https://{project_ref()}.supabase.co')
vault_set('dispatch_secret', dispatch_secret)

with ENV_FILE.open('a') as env:
    env.write(f"VITE_VAPID_PUBLIC_KEY={keys['publicKey']}\n")
print('done: function secrets, vault entries and public key are set')
