#!/usr/bin/env python3
"""Checks who gets queued a notification, against the real project.

Reads the private queue through the Management API. Usage: python3 tests/notifications.py
Then remove the accounts with scripts/clean_test_users.py.
With SENDER_DEPLOYED=1 it also runs the send-notifications function.
"""
import datetime as dt
import json
import os
import pathlib
import random
import re
import string
import sys
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'scripts'))
from db import ROOT, sql  # noqa: E402

env = (ROOT / '.env.local').read_text()
URL = re.search(r'VITE_SUPABASE_URL=(\S+)', env).group(1)
ANON = re.search(r'VITE_SUPABASE_ANON_KEY=(\S+)', env).group(1)
DOMAIN = 'crew-calendar-orcin.vercel.app'
TAG = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
failures = 0


def check(label, ok, detail=''):
    global failures
    print(f"{'ok  ' if ok else 'FAIL'} {label}{'' if ok else f' -> {detail}'}")
    failures += 0 if ok else 1


def post(path, body, token=ANON, headers=None):
    request = urllib.request.Request(
        URL + path, method='POST', data=json.dumps(body).encode(),
        headers={'apikey': ANON, 'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            text = response.read().decode()
            return response.status, json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()[:300]


class User:
    def __init__(self, name):
        self.handle = f'{name}_{TAG}'
        status, session = post('/auth/v1/signup', {
            'email': f'{self.handle}@{DOMAIN}', 'password': 'hunter22', 'data': {'name': name},
        })
        assert status == 200, session
        self.token, self.id = session['access_token'], session['user']['id']

    def rpc(self, name, **args):
        return post(f'/rest/v1/rpc/{name}', args, self.token)

    def queued(self, kind=None):
        extra = f" and kind = '{kind}'" if kind else ''
        return sql(f"select count(*) from private.notifications where recipient = '{self.id}'{extra}")[0]['count']

    def subscribe(self, endpoint=None):
        status, _ = self.rpc('save_push_subscription', sub_endpoint=endpoint or f'https://push.invalid/{self.id}',
                             sub_p256dh='key', sub_auth='auth')
        assert status < 300


def befriend(a, b):
    a.rpc('add_friend', friend_handle=b.handle)
    b.rpc('accept_friend', from_user=a.id)


def soon(minutes):
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=minutes)).isoformat()


actor, subscribed, unsubscribed, outsider = User('alice'), User('bob'), User('carol'), User('dave')
befriend(actor, subscribed)
befriend(actor, unsubscribed)
subscribed.subscribe()

# Going free
actor.rpc('set_free', is_free=True)
check('friend with a device is told', subscribed.queued('free') == 1, subscribed.queued())
check('friend without a device gets no row', unsubscribed.queued() == 0)
check('stranger gets no row', outsider.queued() == 0)
payload = sql(f"select data from private.notifications where recipient = '{subscribed.id}'")[0]['data']
check('payload has the name and raw time', payload['name'] == 'alice' and payload['until'], payload)

actor.rpc('set_times', from_at=None, until_at=soon(30))
check('changing the time while on tells nobody', subscribed.queued('free') == 1)
actor.rpc('set_free', is_free=False)
actor.rpc('set_free', is_free=True)
check('flipping off and on is held back by the cooldown', subscribed.queued('free') == 1)

# Both free
actor.rpc('set_free', is_free=False)
subscribed.rpc('set_free', is_free=True)
actor.rpc('set_free', is_free=True)
check('someone already on hears "free too"', subscribed.queued('both_free') == 1)
subscribed.rpc('set_free', is_free=False)
actor.rpc('set_free', is_free=False)

# Mutes
subscribed.rpc('set_friend_notify', friend=actor.id, enabled=False)
actor.rpc('set_times', from_at=soon(60), until_at=soon(120))
check('a muted friend sends nothing', subscribed.queued('free_later') == 0)
actor.rpc('set_free', is_free=False)
subscribed.rpc('set_friend_notify', friend=actor.id, enabled=True)
actor.rpc('set_times', from_at=soon(60), until_at=soon(120))
check('unmuting lets it through, as "free later"', subscribed.queued('free_later') == 1)
actor.rpc('set_free', is_free=False)

# Plans
actor.rpc('create_plan', at=soon(600), note='everyone')
check('a plan for everyone is told', subscribed.queued('plan') == 1)
_, group = actor.rpc('create_group', group_name='Others')
actor.rpc('create_plan', at=soon(600), note='not you', audience=group)
check('a group plan skips people outside it', subscribed.queued('plan') == 1)
actor.rpc('set_group_member', target=group, friend=subscribed.id, included=True)
actor.rpc('create_plan', at=soon(600), note='you too', audience=group)
check('a group plan reaches its members', subscribed.queued('plan') == 2)

# Nudges
_, result = actor.rpc('nudge', friend=subscribed.id)
check('a nudge is sent', result == 'sent', result)
check('a nudge is queued', subscribed.queued('nudge') == 1)
_, result = actor.rpc('nudge', friend=subscribed.id)
check('asking again soon is refused', result == 'too_soon', result)
check('...and not queued', subscribed.queued('nudge') == 1)
status, _ = outsider.rpc('nudge', friend=subscribed.id)
check('a stranger cannot nudge', status >= 400, status)
_, home = post('/rest/v1/rpc/get_home', {}, subscribed.token)
check('home shows who asked', [p['id'] for p in home['nudges']] == [actor.id], home['nudges'])
subscribed.rpc('set_free', is_free=True)
_, home = post('/rest/v1/rpc/get_home', {}, subscribed.token)
check('going free answers it', home['nudges'] == [], home['nudges'])
subscribed.rpc('set_free', is_free=False)

# Hourly cap
sql(f"""insert into private.notifications (recipient, actor, kind, data, sent_at)
        select '{subscribed.id}', '{actor.id}', 'filler', '{{}}', now() from generate_series(1, 12)""")
actor.rpc('create_plan', at=soon(600), note='over the cap')
check('the hourly cap holds', subscribed.queued('plan') == 2, subscribed.queued('plan'))
sql(f"delete from private.notifications where kind = 'filler' and recipient = '{subscribed.id}'")

# Who can touch the queue
status, _ = subscribed.rpc('claim_notifications', batch_size=1)
check('users cannot claim the queue', status >= 400, status)
status, _ = post('/rest/v1/rpc/claim_notifications', {'batch_size': 1})
check('visitors cannot claim the queue', status >= 400, status)
status, _ = subscribed.rpc('finish_notifications', sent_ids=[], dead_endpoints=[f'https://push.invalid/{unsubscribed.id}'])
check('users cannot delete subscriptions through the sender', status >= 400, status)

# Signing out drops the device
subscribed.rpc('delete_push_subscription', sub_endpoint=f'https://push.invalid/{actor.id}')
count = sql(f"select count(*) from private.push_subscriptions where user_id = '{subscribed.id}'")[0]['count']
check("you can't remove another person's device by guessing", count == 1, count)

if os.environ.get('SENDER_DEPLOYED'):
    status, _ = post('/functions/v1/send-notifications', {}, headers={'x-dispatch-secret': 'wrong'})
    check('sender refuses the wrong secret', status == 403, status)

    # A properly signed send to a real push service, for a device that doesn't
    # exist. Being told it's gone proves the signing and encryption worked.
    dead = 'https://fcm.googleapis.com/fcm/send/freern-test-device-that-does-not-exist'
    sql(f"delete from private.push_subscriptions where user_id = '{subscribed.id}'")
    status, _ = subscribed.rpc('save_push_subscription', sub_endpoint=dead,
                               sub_p256dh='BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
                               sub_auth='tBHItJI5svbpez7KI4CCXg')
    assert status < 300
    actor.rpc('create_plan', at=soon(600), note='to a dead device')
    secret = sql("select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret'")[0]['decrypted_secret']
    status, result = post('/functions/v1/send-notifications', {}, headers={'x-dispatch-secret': secret})
    check('sender runs', status == 200, result)
    gone = sql(f"select count(*) from private.push_subscriptions where endpoint = '{dead}'")[0]['count']
    print('     sender said', result)
    check('a device the push service rejects is removed', gone == 0, gone)

print(f'\n{failures} FAILED' if failures else '\nall passed')
sys.exit(1 if failures else 0)
