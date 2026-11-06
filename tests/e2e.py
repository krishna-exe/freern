import json, os, pathlib, random, string, sys
from playwright.sync_api import sync_playwright, expect
# Two-to-three person run through the real UI. Needs the real project for live
# updates, and a dev server: npm run dev -- --port 5199
# Usage: python tests/e2e.py SCREENSHOT_DIR   (then scripts/clean_test_users.py)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'scripts'))
from db import sql

H = sys.argv[1]; URL = os.environ.get('E2E_URL', 'http://localhost:5199/')
t = ''.join(random.choices(string.ascii_lowercase, k=4))
a, b, c = f'e2ea_{t}', f'e2eb_{t}', f'e2ec_{t}'
LONG = 'Sam With A Really Very Long Display Name'
expect.set_options(timeout=15000)

def signup(p, handle, name):
    p.get_by_label('User ID').fill(handle)
    p.get_by_label('Your name').fill(name)
    p.get_by_label('Password').fill('hunter22')
    p.get_by_role('button', name='Create account').click()
    expect(p.get_by_role('navigation')).to_be_visible()

def tab(p, name):
    p.get_by_role('navigation').get_by_role('button', name=name).click()

def set_switch(p, on):
    switch = p.get_by_role('switch')
    if (switch.get_attribute('aria-checked') == 'true') != on:
        switch.click()
    expect(switch).to_have_attribute('aria-checked', 'true' if on else 'false')

def no_scroll(p, label):
    assert p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'h-scroll on {label}'

with sync_playwright() as pw:
    br = pw.chromium.launch()
    phone = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
    # A fixed timezone, to prove notification times follow the phone's.
    ca = br.new_context(**phone, timezone_id='Asia/Kolkata', locale='en-GB'); cb = br.new_context(**phone, color_scheme='dark'); cc = br.new_context(**phone)
    ca.grant_permissions(['clipboard-read', 'clipboard-write'])
    pa = ca.new_page(); pb = cb.new_page(); pc = cc.new_page()
    errs = []
    for p in (pa, pb, pc):
        p.on('pageerror', lambda e: errs.append(str(e)))

    pa.goto(URL)
    pa.get_by_role('button', name='New here?').click()
    pa.get_by_label('User ID').fill('A!')
    pa.get_by_label('Your name').fill('x'); pa.get_by_label('Password').fill('hunter22')
    pa.get_by_role('button', name='Create account').click()
    expect(pa.get_by_role('alert')).to_contain_text('3–20')
    signup(pa, a, 'Krishna')
    expect(pa.get_by_text('See who’s free')).to_be_visible()
    pa.screenshot(path=f'{H}/t1-empty-now.png')
    assert pa.locator('[placeholder]').count() == 0
    print('ok signup, empty state')

    # Switch flips before the network answers
    sw = pa.get_by_role('switch')
    held = []
    pa.route('**/rpc/set_free', lambda r: held.append(r))
    sw.click()
    expect(sw).to_have_attribute('aria-checked', 'true', timeout=1000)
    assert held, 'write was not attempted'
    print('ok optimistic: on while request is still pending')
    held[0].continue_()
    pa.unroute('**/rpc/set_free')
    pa.wait_for_timeout(3000)
    assert sw.get_attribute('aria-checked') == 'true', 'switch flipped back after saving: ' + sw.inner_text()
    print('ok switch stays on after the save lands')

    # A failed write puts the switch back and says so
    pa.route('**/rpc/set_free', lambda r: r.fulfill(status=500, content_type='application/json', body='{"message":"boom"}'))
    sw.click()
    expect(pa.get_by_role('alert')).to_contain_text('boom')
    expect(sw).to_have_attribute('aria-checked', 'true')
    pa.unroute('**/rpc/set_free')
    print('ok failed write restores switch and shows error')
    sw.click()
    expect(sw).to_have_attribute('aria-checked', 'false')

    # Quick durations
    with pa.expect_response('**/rpc/set_times') as saved:
        pa.get_by_role('button', name='1 hr').click()
    assert saved.value.ok, saved.value.text()
    expect(sw).to_have_attribute('aria-checked', 'true')
    expect(sw).to_contain_text('Turns off at')
    pa.reload()
    expect(pa.get_by_role('switch')).to_have_attribute('aria-checked', 'true')
    print('ok 1 hr chip persisted')

    # Share link, friend lands on Friends with ID filled in
    sw = pa.get_by_role('switch')
    tab(pa, 'Friends')
    pa.evaluate('delete navigator.share')
    pa.get_by_role('button', name='Share link').click()
    expect(pa.get_by_role('button', name='Link copied')).to_be_visible()
    link = pa.evaluate('navigator.clipboard.readText()')
    assert link.endswith(f'#/add/{a}'), link

    pb.goto(link)
    expect(pb.get_by_text(f'@{a} wants to add you')).to_be_visible()
    signup(pb, b, 'Aayush')
    expect(pb.get_by_role('heading', name='Friends')).to_be_visible()
    expect(pb.get_by_label('Friend’s user ID')).to_have_value(a)
    assert '#/add' not in pb.url
    pb.get_by_role('button', name='Add', exact=True).click()
    expect(pb.get_by_role('status')).to_contain_text('Request sent')
    expect(pb.get_by_text('Waiting on')).to_be_visible()
    expect(pb.locator('.row', has_text=a)).not_to_contain_text('till')
    print('ok invite landed on Friends, request sent, no status while pending')

    # Badge appears live on the other person
    tab(pa, 'Now')
    expect(pa.get_by_role('navigation').get_by_role('button', name='Friends, 1 new')).to_be_visible()
    print('ok request badge live')
    tab(pa, 'Friends')
    pa.screenshot(path=f'{H}/t2-friends-request.png')
    pa.locator('.row', has_text='Aayush').get_by_role('button', name='Accept').click()
    expect(pa.get_by_text('Requests')).to_have_count(0)
    expect(pa.get_by_role('navigation').get_by_role('button', name='Friends', exact=True)).to_be_visible()

    # Friend sees on, live; Remove is hidden until tapped
    tab(pb, 'Now')
    row = pb.locator('.row.is-on', has_text='Krishna')
    expect(row).to_contain_text('till')
    print('ok friend on:', row.inner_text().replace('\n', ' | '))
    assert pa.get_by_role('button', name='Remove Aayush').count() == 0
    pb.wait_for_timeout(6000)  # subscription settles

    # Live off
    tab(pa, 'Now')
    pa.get_by_role('switch').click()
    expect(pa.get_by_role('switch')).to_have_attribute('aria-checked', 'false')
    expect(pb.get_by_text('Nobody’s free right now.')).to_be_visible()
    print('ok live off')

    # Custom window -> free later -> clear
    pa.get_by_role('button', name='Custom').click()
    later = pa.evaluate("() => { const d = new Date(Date.now() + 3*3600e3); return [d, new Date(d.getTime()+3600e3)].map(x => String(x.getHours()).padStart(2,'0')+':'+String(x.getMinutes()).padStart(2,'0')) }")
    pa.get_by_label('From').fill(later[0]); pa.get_by_label('To', exact=True).fill(later[1])
    pa.screenshot(path=f'{H}/t3-custom.png')
    pa.get_by_role('button', name='Save').click()
    expect(pa.get_by_role('switch')).to_have_attribute('aria-checked', 'false')
    expect(pa.get_by_role('switch')).to_contain_text('Tap to go on now')
    expect(pb.get_by_text('Free later')).to_be_visible()
    print('ok free later:', pb.locator('.row', has_text='Krishna').locator('.when').inner_text())
    pa.get_by_role('button', name='Clear').click()
    expect(pb.get_by_text('Free later')).to_have_count(0)
    print('ok cleared')

    # Plans: compact until asked for, badge, join, leave, delete
    tab(pa, 'Plans')
    expect(pa.get_by_text('No plans yet')).to_be_visible()
    assert pa.get_by_label('When').count() == 0
    pa.screenshot(path=f'{H}/t4-plans-empty.png')
    pa.get_by_role('button', name='New plan').click()
    pa.get_by_role('button', name='Tomorrow').click()
    expect(pa.get_by_label('When')).to_have_value(pa.evaluate("() => { const d = new Date(Date.now() + 86400e3); const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T19:00` }"))
    expect(pa.get_by_role('button', name='Tomorrow')).to_have_attribute('aria-pressed', 'true')
    pa.screenshot(path=f'{H}/s2-plan-form.png')
    when = pa.evaluate("() => { const d = new Date(Date.now() + 3*86400e3); const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T19:00` }")
    plan_note = f'chai? {t}'
    pa.get_by_label('When').fill(when); pa.get_by_label('What for (optional)').fill(plan_note)
    pa.get_by_role('button', name='Post plan').click()
    expect(pa.locator('.plan', has_text='Your plan')).to_contain_text(plan_note)
    assert pa.get_by_label('When').count() == 0
    expect(pb.get_by_role('navigation').get_by_role('button', name='Plans, 1 new')).to_be_visible()
    print('ok plan badge live')
    pb.screenshot(path=f'{H}/t5-now-badge-dark.png')
    tab(pb, 'Plans')
    fp = pb.locator('.plan', has_text=plan_note)
    expect(fp).to_contain_text('Krishna')
    tab(pb, 'Now')
    expect(pb.get_by_role('navigation').get_by_role('button', name='Plans', exact=True)).to_be_visible()
    pb.reload()
    expect(pb.get_by_role('navigation').get_by_role('button', name='Plans', exact=True)).to_be_visible()
    print('ok plan badge clears and stays cleared after reload')
    tab(pb, 'Plans')
    fp = pb.locator('.plan', has_text=plan_note)
    fp.get_by_role('button', name='I’m in').click()
    expect(fp.get_by_role('button', name='I’m in')).to_have_attribute('aria-pressed', 'true')
    host_plan = pa.locator('.plan', has_text='Your plan')
    expect(host_plan).to_contain_text('In: Aayush')
    fp.get_by_role('button', name='Can’t make it').click()
    expect(host_plan).to_contain_text('Can’t: Aayush')
    expect(host_plan).to_contain_text('Nobody’s in yet')
    pb.screenshot(path=f'{H}/s2-plans-dark.png')
    fp.get_by_role('button', name='Can’t make it').click()
    expect(host_plan).not_to_contain_text('Can’t: Aayush')
    print('ok in, can\'t, take back, live')

    # A plan stays while it's happening, then goes
    sql(f"update public.plans set starts_at = now() - interval '1 hour' where note = '{plan_note}'")
    pb.reload()
    tab(pb, 'Plans')
    fp = pb.locator('.plan', has_text=plan_note)
    expect(fp).to_contain_text('Happening now')
    fp.get_by_role('button', name='I’m in').click()
    expect(fp.get_by_role('button', name='I’m in')).to_have_attribute('aria-pressed', 'true')
    sql(f"update public.plans set starts_at = now() - interval '3 hours' where note = '{plan_note}'")
    pb.reload()
    tab(pb, 'Plans')
    expect(pb.get_by_text('No plans yet')).to_be_visible()
    sql(f"update public.plans set starts_at = now() + interval '3 days' where note = '{plan_note}'")
    print('ok happening now, then gone')

    # Third friend with a long name, for layout
    pc.goto(link)
    signup(pc, c, LONG)
    pc.get_by_role('button', name='Add', exact=True).click()
    expect(pc.get_by_role('status')).to_contain_text('Request sent')
    tab(pa, 'Friends')
    pa.locator('.row', has_text='Sam').get_by_role('button', name='Accept').click()
    expect(pa.get_by_text('Requests')).to_have_count(0)
    tab(pc, 'Now')
    pc.get_by_role('button', name='2 hrs').click()
    expect(pc.get_by_role('switch')).to_have_attribute('aria-checked', 'true')
    tab(pb, 'Now')
    pb.get_by_role('switch').click()
    expect(pb.get_by_role('switch')).to_have_attribute('aria-checked', 'true')
    pa.reload()
    expect(pa.locator('.row.is-on')).to_have_count(2)
    pa.screenshot(path=f'{H}/t8-now-light.png')
    tab(pa, 'Friends')
    expect(pa.locator('.friend')).to_have_count(2)
    assert pa.get_by_role('button', name='Remove Aayush').count() == 0
    pa.locator('.friend', has_text='Aayush').get_by_role('button').first.click()
    pa.screenshot(path=f'{H}/t9-friends-light.png', full_page=True)

    # Every tab holds at phone-narrow width
    pa.set_viewport_size({'width': 320, 'height': 640})
    for name in ('Friends', 'Plans', 'Now'):
        tab(pa, name)
        pa.wait_for_timeout(200)
        no_scroll(pa, name)
        pa.screenshot(path=f'{H}/t10-narrow-{name}.png')
    tab(pa, 'Plans')
    pa.get_by_role('button', name='New plan').click()
    no_scroll(pa, 'plan form')
    pa.screenshot(path=f'{H}/t11-narrow-planform.png')
    pa.get_by_role('button', name='Cancel').click()
    tab(pa, 'Now')
    pa.get_by_role('button', name='Custom').click()
    no_scroll(pa, 'custom form')
    pa.get_by_role('button', name='Cancel').click()
    pa.set_viewport_size({'width': 390, 'height': 844})
    print('ok 320px on every tab')

    # Last element isn't trapped under the fixed nav
    tab(pa, 'Friends')
    pa.evaluate('window.scrollTo(0, document.body.scrollHeight)')
    box = pa.get_by_role('button', name='Sign out').bounding_box()
    nav = pa.get_by_role('navigation').bounding_box()
    assert box['y'] + box['height'] <= nav['y'], (box, nav)
    print('ok sign out clears the nav')

    # Picture: pick, friend sees it live, back to initials
    tab(pb, 'Friends')
    pb.wait_for_timeout(3000)
    pa.get_by_role('button', name='Change picture').click()
    assert pa.get_by_role('group', name='Profile picture').get_by_role('button').count() == 21
    pa.screenshot(path=f'{H}/t12-picker.png', full_page=True)
    pa.get_by_role('button', name='Fox').click()
    expect(pa.locator('.profile .avatar')).to_have_text('🦊')
    expect(pb.locator('.friend', has_text='Krishna').locator('.avatar')).to_have_text('🦊')
    pb.screenshot(path=f'{H}/t13-friends-dark.png', full_page=True)
    print('ok picture shows for friend, live')
    pa.get_by_role('button', name='Change picture').click()
    expect(pa.get_by_role('button', name='Fox')).to_have_attribute('aria-pressed', 'true')
    pa.set_viewport_size({'width': 320, 'height': 640})
    no_scroll(pa, 'picker')
    pa.set_viewport_size({'width': 390, 'height': 844})
    pa.get_by_role('button', name='Initials').click()
    expect(pa.locator('.profile .avatar')).to_have_text('K')
    print('ok back to initials')

    # Note: add, friend sees it live, survives the switch, edit, expires, clear
    tab(pa, 'Now')
    pa.get_by_role('button', name='Add a note').click()
    box = pa.get_by_label('Your note')
    box.fill('x' * 80)
    assert len(box.input_value()) == 60
    pa.screenshot(path=f'{H}/t14-note-form.png')
    box.fill('down for chai, only calls tho')
    pa.get_by_role('button', name='Save').click()
    expect(pa.locator('.my-note')).to_contain_text('down for chai')
    fr = pb.locator('.friend', has_text='Krishna')
    expect(fr.locator('.friend-note')).to_have_text('down for chai, only calls tho')
    print('ok note shows for friend, live, while off')
    tab(pb, 'Now')
    pa.get_by_role('switch').click()
    expect(pb.locator('.row.is-on', has_text='Krishna').locator('.friend-note')).to_contain_text('down for chai')
    pb.screenshot(path=f'{H}/t15-now-note-dark.png')
    pa.screenshot(path=f'{H}/t16-now-note-light.png')
    pa.get_by_role('switch').click()
    expect(pa.locator('.my-note')).to_contain_text('down for chai')
    pa.get_by_role('button', name='Edit').click()
    expect(pa.get_by_label('Your note')).to_have_value('down for chai, only calls tho')
    pa.get_by_label('Your note').fill('आज free हूँ 🎉')
    pa.get_by_role('button', name='Save').click()
    expect(pa.locator('.my-note')).to_contain_text('आज free हूँ')
    tab(pb, 'Friends')
    expect(pb.locator('.friend', has_text='Krishna').locator('.friend-note')).to_contain_text('आज free हूँ')
    print('ok edit, unicode')
    pa.evaluate('''() => { const r = Date.now; Date.now = () => r() + 25 * 3600 * 1000;
                           document.dispatchEvent(new Event('visibilitychange')) }''')
    expect(pa.locator('.my-note')).to_have_count(0)
    expect(pa.get_by_role('button', name='Add a note')).to_be_visible()
    print('ok note gone after 24 hours')
    pa.reload()
    tab(pa, 'Now')
    pa.get_by_role('button', name='Clear').click()
    expect(pa.get_by_role('button', name='Add a note')).to_be_visible()
    expect(pb.locator('.friend', has_text='Krishna').locator('.friend-note')).to_have_count(0)
    print('ok clear, live')
    pa.set_viewport_size({'width': 320, 'height': 640})
    no_scroll(pa, 'note')
    pa.set_viewport_size({'width': 390, 'height': 844})

    # Delete has an undo window instead of a pop-up
    tab(pa, 'Plans')
    host_plan = pa.locator('.plan', has_text='Your plan')
    host_plan.get_by_role('button', name='Delete').click()
    expect(pa.get_by_text('No plans yet')).to_be_visible()
    pa.screenshot(path=f'{H}/s2-toast.png')
    pa.get_by_role('button', name='Undo').click()
    expect(host_plan).to_be_visible()
    pa.wait_for_timeout(6000)
    pa.reload()
    tab(pa, 'Plans')
    expect(host_plan).to_be_visible()
    print('ok undo keeps the plan')
    host_plan.get_by_role('button', name='Delete').click()
    expect(pa.get_by_role('button', name='Undo')).to_be_visible()
    pa.wait_for_timeout(6000)
    expect(pa.get_by_role('button', name='Undo')).to_have_count(0)
    pa.reload()
    tab(pa, 'Plans')
    expect(pa.get_by_text('No plans yet')).to_be_visible()
    print('ok plan deleted after the undo window')

    # Pull to refresh
    tab(pa, 'Now')
    with pa.expect_response('**/rpc/get_home') as refreshed:
        pa.evaluate('''() => {
          const fire = (type, y) => window.dispatchEvent(new TouchEvent(type, {
            touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: document.body, clientY: y })],
          }))
          fire('touchstart', 100); fire('touchmove', 300); fire('touchend', 300)
        }''')
    assert refreshed.value.ok
    print('ok pull to refresh')

    # Auto-off on the client
    tab(pa, 'Now')
    pa.get_by_role('switch').click()
    expect(pa.get_by_role('switch')).to_have_attribute('aria-checked', 'true')
    pa.evaluate('''() => { const r = Date.now; Date.now = () => r() + 3 * 3600 * 1000;
                           document.dispatchEvent(new Event('visibilitychange')) }''')
    expect(pa.get_by_role('switch')).to_have_attribute('aria-checked', 'false')
    print('ok auto-off')
    pa.reload()

    # Not found keeps the form open
    tab(pa, 'Friends')
    pa.get_by_role('button', name='Add friend').click()
    pa.get_by_label('Friend’s user ID').fill('nobody_here_x')
    pa.get_by_role('button', name='Add', exact=True).click()
    expect(pa.get_by_role('status')).to_contain_text('No one has the ID')
    expect(pa.get_by_label('Friend’s user ID')).to_have_value('nobody_here_x')
    pa.get_by_role('button', name='Cancel').click()
    print('ok not found')

    # A failed save with no connection puts the switch back
    tab(pa, 'Now')
    expect(pa.get_by_role('switch')).to_be_visible()
    before = pa.get_by_role('switch').get_attribute('aria-checked')
    pa.route('**/rest/v1/rpc/**', lambda r: r.abort())
    pa.get_by_role('switch').click()
    expect(pa.get_by_role('alert')).to_be_visible()
    expect(pa.get_by_role('switch')).to_have_attribute('aria-checked', before)
    pa.unroute('**/rest/v1/rpc/**')
    pa.reload()
    print('ok switch restored when offline')

    # Recovery code: offered until you have one, shown once
    card = pa.locator('.recovery')
    expect(card).to_contain_text('recovery code')
    pa.screenshot(path=f'{H}/s3-recovery-prompt.png')
    pa.get_by_role('button', name='Get a recovery code').click()
    code_box = pa.locator('.recovery-code')
    expect(code_box).to_be_visible()
    recovery_code = code_box.inner_text()
    pa.screenshot(path=f'{H}/s3-recovery-code.png')
    pa.get_by_role('button', name='I’ve saved it').click()
    expect(card).to_have_count(0)
    pa.reload()
    expect(pa.get_by_role('navigation')).to_be_visible()
    assert card.count() == 0
    print('ok recovery code shown once, prompt gone')

    # Edit name, live for friends
    tab(pa, 'Friends')
    tab(pb, 'Friends')
    pa.get_by_role('button', name='Edit name').click()
    pa.get_by_label('Your name').fill('Krishna R')
    pa.get_by_role('button', name='Save').click()
    expect(pa.locator('.profile .name')).to_have_text('Krishna R')
    expect(pb.locator('.friend', has_text='Krishna R')).to_be_visible()
    pa.screenshot(path=f'{H}/s3-friends.png', full_page=True)
    print('ok edit name, live')

    # Block: gone both ways, reversible, and they can't re-request
    fr = pb.locator('.friend', has_text='Krishna R')
    fr.get_by_role('button').first.click()
    pb.get_by_role('button', name='Block Krishna R').click()
    expect(pb.get_by_text('Blocked Krishna R')).to_be_visible()
    expect(pb.get_by_role('heading', name='Blocked')).to_have_count(0)
    pb.get_by_role('button', name='Undo').click()
    expect(fr).to_be_visible()
    fr.get_by_role('button').first.click()
    pb.get_by_role('button', name='Block Krishna R').click()
    pb.wait_for_timeout(6000)
    expect(pb.get_by_role('heading', name='Blocked')).to_be_visible()
    expect(pa.locator('.friend', has_text='Aayush')).to_have_count(0)
    pa.get_by_role('button', name='Add friend').click()
    pa.get_by_label('Friend’s user ID').fill(b)
    pa.get_by_role('button', name='Add', exact=True).click()
    expect(pa.get_by_role('status')).to_contain_text('No one has the ID')
    pa.get_by_role('button', name='Cancel').click()
    pb.get_by_role('button', name='Unblock Krishna R').click()
    expect(pb.get_by_role('heading', name='Blocked')).to_have_count(0)
    print('ok block, undo, cannot re-request, unblock')
    # Back to friends for the steps below
    pa.get_by_role('button', name='Add friend').click()
    pa.get_by_label('Friend’s user ID').fill(b)
    pa.get_by_role('button', name='Add', exact=True).click()
    expect(pa.get_by_role('status')).to_contain_text('Request sent')
    pb.locator('.row', has_text='Krishna R').get_by_role('button', name='Accept').click()
    expect(pa.locator('.friend', has_text='Aayush')).to_be_visible()

    # WhatsApp and usual times show for friends
    pa.get_by_role('button', name='WhatsApp & free times').click()
    pa.get_by_label('WhatsApp number (optional)').fill('12')
    pa.get_by_role('button', name='Save').click()
    expect(pa.get_by_role('alert')).to_contain_text('country code')
    pa.get_by_label('WhatsApp number (optional)').fill('+91 98765 43210')
    pa.get_by_label('Usually free (optional)').fill('weekdays after 9 PM')
    pa.get_by_role('button', name='Save').click()
    expect(pa.get_by_label('Usually free (optional)')).to_have_count(0)
    friend_row = pb.locator('.friend', has_text='Krishna R')
    expect(friend_row).to_contain_text('Usually weekdays after 9 PM')
    friend_row.get_by_role('button').first.click()
    link = friend_row.get_by_role('link', name='Message Krishna R on WhatsApp')
    assert link.get_attribute('href').startswith('https://wa.me/919876543210?text='), link.get_attribute('href')
    pb.screenshot(path=f'{H}/s4-friends-dark.png', full_page=True)
    tab(pa, 'Now')
    set_switch(pa, True)
    tab(pb, 'Now')
    now_link = pb.locator('.row', has_text='Krishna R').get_by_role('link', name='Message Krishna R on WhatsApp')
    expect(now_link).to_be_visible()
    pb.screenshot(path=f'{H}/s4-now-message-dark.png')
    pb.set_viewport_size({'width': 320, 'height': 640})
    no_scroll(pb, 'row with message')
    pb.set_viewport_size({'width': 390, 'height': 844})
    set_switch(pa, False)
    tab(pa, 'Friends')
    tab(pb, 'Friends')
    print('ok message link and usual times')

    # Groups: a plan only reaches who's in the group
    pa.get_by_role('button', name='New group').click()
    pa.get_by_label('Group name').fill('College')
    pa.get_by_role('button', name='Create').click()
    pa.get_by_label('Aayush', exact=True).check()
    expect(pa.locator('.groups')).to_contain_text('1 person')
    pa.screenshot(path=f'{H}/s4-group.png', full_page=True)
    tab(pa, 'Plans')
    pa.get_by_role('button', name='New plan').click()
    pa.get_by_label('When').fill(when)
    pa.get_by_label('What for (optional)').fill('group plan')
    pa.get_by_label('Who’s it for').select_option(label='College')
    pa.get_by_role('button', name='Post plan').click()
    expect(pa.locator('.plan', has_text='group plan')).to_contain_text('Your plan · College')
    tab(pb, 'Plans')
    expect(pb.locator('.plan', has_text='group plan')).to_be_visible()
    expect(pb.locator('.plan', has_text='group plan')).not_to_contain_text('College')
    tab(pc, 'Plans')
    pc.wait_for_timeout(1500)
    expect(pc.locator('.plan', has_text='group plan')).to_have_count(0)
    tab(pc, 'Now')
    print('ok group plan reaches only its members')
    tab(pa, 'Friends')
    pa.locator('.groups .row-button').click()
    pa.once('dialog', lambda d: d.accept())
    pa.locator('.groups').get_by_role('button', name='Delete group').click()
    expect(pa.locator('.groups')).to_have_count(0)
    tab(pb, 'Friends')

    # "Free too" appears only when you're both on
    tab(pa, 'Now')
    set_switch(pa, False)
    expect(pa.locator('.both-free')).to_have_count(0)
    set_switch(pa, True)
    expect(pa.locator('.both-free')).to_contain_text('free too')
    print('ok free too:', pa.locator('.both-free').inner_text())
    pa.screenshot(path=f'{H}/s5-both-free.png')
    set_switch(pa, False)

    # "You free?": asked once, shows on their Now, answered by going on
    tab(pb, 'Now')
    set_switch(pb, False)
    tab(pa, 'Friends')
    row = pa.locator('.friend', has_text='Aayush')
    row.get_by_role('button').first.click()
    pa.screenshot(path=f'{H}/s5-friend-open.png', full_page=True)
    row.get_by_role('button', name='You free?').click()
    expect(pa.get_by_role('status')).to_contain_text('Asked Aayush')
    banner = pb.locator('.banner', has_text='Krishna R asked if you’re free')
    expect(banner).to_be_visible()
    pb.screenshot(path=f'{H}/s5-nudged-dark.png')
    row.get_by_role('button', name='You free?').click()
    expect(pa.get_by_role('status')).to_contain_text('already asked')
    set_switch(pb, True)
    expect(banner).to_have_count(0)
    print('ok nudge, repeat refused, answered by going on')

    # Notify me is remembered per friend
    toggle = row.get_by_label('Notify me')
    expect(toggle).to_be_checked()
    toggle.uncheck()
    pa.wait_for_timeout(800)
    pa.reload()
    tab(pa, 'Friends')
    row = pa.locator('.friend', has_text='Aayush')
    row.get_by_role('button').first.click()
    expect(row.get_by_label('Notify me')).not_to_be_checked()
    row.get_by_role('button').first.click()
    print('ok notify me remembered')

    # Friends who are on come first
    pa.reload()
    tab(pa, 'Friends')
    pb_off = pb.get_by_role('switch')
    tab(pb, 'Now')
    if pb_off.get_attribute('aria-checked') == 'true':
        pb_off.click()
    expect(pa.locator('.friend').first).to_contain_text('Sam')
    print('ok friends who are on come first')

    # Remove has an undo window, and sign out carries out a waiting removal
    row = pa.locator('.friend', has_text='Aayush')
    row.get_by_role('button').first.click()
    pa.get_by_role('button', name='Remove Aayush').click()
    expect(pa.locator('.friend')).to_have_count(1)
    expect(pa.get_by_text('Removed Aayush')).to_be_visible()
    pa.get_by_role('button', name='Undo').click()
    expect(pa.locator('.friend')).to_have_count(2)
    pa.locator('.friend', has_text='Aayush').get_by_role('button').first.click()
    pa.get_by_role('button', name='Remove Aayush').click()
    expect(pa.locator('.friend')).to_have_count(1)
    print('ok remove with undo')
    pa.get_by_role('button', name='Sign out').click()
    expect(pa.get_by_role('button', name='New here?')).to_be_visible()
    pa.get_by_label('User ID', exact=True).fill(a); pa.get_by_label('Password').fill('wrongpass')
    pa.get_by_role('button', name='Sign in').click()
    expect(pa.get_by_role('alert')).to_contain_text('Wrong user ID or password')
    pa.get_by_label('Password').fill('hunter22')
    pa.get_by_role('button', name='Sign in').click()
    expect(pa.get_by_role('navigation')).to_be_visible()
    tab(pa, 'Friends')
    expect(pa.locator('.friend')).to_have_count(1)
    print('ok sign out carried out the removal / signin')

    # Forgot password, using the code saved above
    if os.environ.get('FUNCTIONS_DEPLOYED'):
        pa.get_by_role('navigation').wait_for()
        tab(pa, 'Friends')
        pa.get_by_role('button', name='Sign out').click()
        pa.get_by_role('button', name='Forgot password?').click()
        pa.get_by_label('User ID').fill(a)
        pa.get_by_label('Recovery code').fill('AAAAA-BBBBB')
        pa.get_by_label('New password').fill('hunter33')
        pa.get_by_role('button', name='Change password').click()
        expect(pa.get_by_role('alert')).to_contain_text('don’t match')
        pa.screenshot(path=f'{H}/s3-reset.png')
        pa.get_by_label('Recovery code').fill(recovery_code)
        pa.get_by_role('button', name='Change password').click()
        expect(pa.get_by_text('Password changed')).to_be_visible()
        pa.get_by_label('User ID', exact=True).fill(a); pa.get_by_label('Password').fill('hunter33')
        pa.get_by_role('button', name='Sign in').click()
        expect(pa.get_by_role('navigation')).to_be_visible()
        print('ok reset password with recovery code')

    # Delete account: needs your ID typed, and sends you to sign in
    tab(pc, 'Friends')
    pc.get_by_role('button', name='Delete account').click()
    confirm = pc.get_by_role('button', name='Delete my account')
    expect(confirm).to_be_disabled()
    pc.get_by_label('Your user ID').fill('wrong')
    expect(confirm).to_be_disabled()
    pc.screenshot(path=f'{H}/s3-delete.png', full_page=True)
    pc.get_by_label('Your user ID').fill(c)
    confirm.click()
    expect(pc.get_by_role('button', name='New here?')).to_be_visible()
    expect(pa.locator('.friend', has_text='Sam')).to_have_count(0)
    pc.get_by_label('User ID', exact=True).fill(c); pc.get_by_label('Password').fill('hunter22')
    pc.get_by_role('button', name='Sign in').click()
    expect(pc.get_by_role('alert')).to_contain_text('Wrong user ID or password')
    print('ok delete account')

    # The app is installable, and the service worker turns a push into a notification
    assert pa.request.get(URL + 'manifest.webmanifest').json()['display'] == 'standalone'
    for icon in ('icon-192', 'icon-512', 'maskable-512', 'apple-touch-icon'):
        assert pa.request.get(f'{URL}icons/{icon}.png').ok, icon
    # Headless Chromium always refuses notification permission, so catch the call
    # that would display it. Real display and subscribing need a real phone.
    scope = pa.evaluate('navigator.serviceWorker.ready.then((r) => r.scope)')
    worker = next(w for w in ca.service_workers if w.url.endswith('/sw.js'))
    worker.evaluate('''() => {
      self.shown = []
      self.registration.showNotification = (title, options) => {
        self.shown.push({ title, body: options.body, tag: options.tag })
        return Promise.resolve()
      }
    }''')
    cdp = ca.new_cdp_session(pa)
    registrations = []
    cdp.on('ServiceWorker.workerRegistrationUpdated', lambda e: registrations.extend(e['registrations']))
    cdp.send('ServiceWorker.enable')
    pa.wait_for_timeout(800)
    registration_id = next(r['registrationId'] for r in registrations if r['scopeURL'] == scope)
    samples = [
        ('free', {'name': 'Aayush', 'until': '2026-11-06T15:30:00Z'}, 'Aayush is free', '21:00'),
        ('both_free', {'name': 'Aayush', 'until': '2026-11-06T15:30:00Z'}, 'Aayush is free too', '21:00'),
        ('free_later', {'name': 'Aayush', 'from': '2026-11-06T14:30:00Z', 'until': '2026-11-06T15:30:00Z'}, 'Aayush is free later', '20:00'),
        ('plan', {'name': 'Aayush', 'at': '2026-11-09T13:30:00Z', 'note': 'chai?'}, 'Aayush posted a plan', 'chai?'),
        ('nudge', {'name': 'Aayush'}, 'Aayush asked if you’re free', 'Tap to answer'),
    ]
    for kind, data, title, body_has in samples:
        cdp.send('ServiceWorker.deliverPushMessage', {
            'origin': URL.rstrip('/'), 'registrationId': registration_id,
            'data': json.dumps({**data, 'kind': kind, 'actor': 'test'}),
        })
        pa.wait_for_timeout(300)
        note = worker.evaluate('self.shown.at(-1)')
        assert note['title'] == title and body_has in note['body'] and note['tag'] == f'{kind}:test', (kind, note)
        print(f"ok push {kind}: {note['title']} / {note['body']}")

    # Settings explains why notifications aren't available here
    tab(pa, 'Friends')
    pa.get_by_role('button', name='Notifications').click()
    expect(pa.locator('.settings-panel')).to_contain_text('blocked')
    pa.screenshot(path=f'{H}/s5-settings.png', full_page=True)
    print('ok notifications setting')

    print('page errors:', errs)
    br.close()
