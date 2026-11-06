#!/usr/bin/env python3
"""Deletes accounts made by tests/. Patterns are exact, so real accounts are safe."""
from db import sql

TEST_USERS = r"email ~ '^(alice|bob|carol|dave|erin)_[a-z0-9]{6}@' or email ~ '^e2e[abc]_[a-z]{4}@'"

print('deleting', sql(f'select count(*) from auth.users where {TEST_USERS}')[0]['count'])
sql(f'delete from auth.users where {TEST_USERS}')
print('left', [row['handle'] for row in sql('select handle from public.profiles order by 1')])
