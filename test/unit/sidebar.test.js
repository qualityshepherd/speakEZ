import { unit as test } from '../testpup.js'
import { isOwnerPubkey, isKvAdmin, sanitizeDescription, sanitizeNote, canCloseThread, countPresenceByRoom } from '../../worker/auth.js'

// — sanitizeDescription —

test('sanitizeDescription: plain text passes through', t => {
  t.is(sanitizeDescription('hello world'), 'hello world')
})

test('sanitizeDescription: trims whitespace', t => {
  t.is(sanitizeDescription('  hello  '), 'hello')
})

test('sanitizeDescription: max 160 chars', t => {
  const long = 'a'.repeat(200)
  t.is(sanitizeDescription(long).length, 160)
})

test('sanitizeDescription: strips newlines', t => {
  t.is(sanitizeDescription('line1\nline2'), 'line1 line2')
})

test('sanitizeDescription: strips control characters', t => {
  t.is(sanitizeDescription('hello\x00world'), 'hello world')
})

test('sanitizeDescription: empty string returns empty string', t => {
  t.is(sanitizeDescription(''), '')
})

test('sanitizeDescription: null returns empty string', t => {
  t.is(sanitizeDescription(null), '')
})

test('sanitizeDescription: undefined returns empty string', t => {
  t.is(sanitizeDescription(undefined), '')
})

test('sanitizeDescription: collapses extra whitespace', t => {
  t.is(sanitizeDescription('hello   world'), 'hello world')
})

// — isOwnerPubkey —

test('isOwnerPubkey: returns true when pubkey matches OWNER', t => {
  t.ok(isOwnerPubkey('pk-owner', { OWNER: 'pk-owner' }))
})

test('isOwnerPubkey: returns false when pubkey does not match OWNER', t => {
  t.falsy(isOwnerPubkey('pk-other', { OWNER: 'pk-owner' }))
})

test('isOwnerPubkey: trims whitespace from OWNER value', t => {
  t.ok(isOwnerPubkey('pk-owner', { OWNER: '  pk-owner  ' }))
})

test('isOwnerPubkey: returns false when OWNER is empty string', t => {
  t.falsy(isOwnerPubkey('pk-owner', { OWNER: '' }))
})

test('isOwnerPubkey: returns false when OWNER is undefined', t => {
  t.falsy(isOwnerPubkey('pk-owner', {}))
})

test('isOwnerPubkey: returns false when pubkey is empty string', t => {
  t.falsy(isOwnerPubkey('', { OWNER: 'pk-owner' }))
})

test('isOwnerPubkey: returns false when pubkey is null', t => {
  t.falsy(isOwnerPubkey(null, { OWNER: 'pk-owner' }))
})

// — canCloseThread —

const THREAD = { id: 't1', name: 'topic', createdBy: 'pk-creator', ts: 1 }

test('canCloseThread: creator can close their own thread', t => {
  t.ok(canCloseThread('pk-creator', THREAD, {}))
})

test('canCloseThread: owner can close any thread', t => {
  t.ok(canCloseThread('pk-owner', THREAD, { OWNER: 'pk-owner' }))
})

test('canCloseThread: kv admin can close any thread', t => {
  t.ok(canCloseThread('pk-admin', THREAD, {}, ['pk-admin']))
})

test('canCloseThread: non-creator non-admin cannot close', t => {
  t.falsy(canCloseThread('pk-other', THREAD, { OWNER: 'pk-owner' }, []))
})

test('canCloseThread: returns false for null thread', t => {
  t.falsy(canCloseThread('pk-creator', null, {}))
})

// — sanitizeNote —

test('sanitizeNote: plain text passes through', t => {
  t.is(sanitizeNote('Jesse, podcast co-host'), 'Jesse, podcast co-host')
})

test('sanitizeNote: trims whitespace', t => {
  t.is(sanitizeNote('  hello  '), 'hello')
})

test('sanitizeNote: max 300 chars', t => {
  const long = 'a'.repeat(400)
  t.is(sanitizeNote(long).length, 300)
})

test('sanitizeNote: preserves newlines', t => {
  t.is(sanitizeNote('line1\nline2'), 'line1\nline2')
})

test('sanitizeNote: normalizes \\r\\n to \\n', t => {
  t.is(sanitizeNote('line1\r\nline2'), 'line1\nline2')
})

test('sanitizeNote: strips control characters', t => {
  t.is(sanitizeNote('hello\x00world'), 'helloworld')
})

test('sanitizeNote: empty string returns empty string', t => {
  t.is(sanitizeNote(''), '')
})

test('sanitizeNote: null returns empty string', t => {
  t.is(sanitizeNote(null), '')
})

test('sanitizeNote: undefined returns empty string', t => {
  t.is(sanitizeNote(undefined), '')
})

// — isKvAdmin —

test('isKvAdmin: returns true when pubkey in list', t => {
  t.ok(isKvAdmin('pk-admin', ['pk-admin']))
})

test('isKvAdmin: returns false when pubkey not in list', t => {
  t.falsy(isKvAdmin('pk-user', ['pk-admin']))
})

test('isKvAdmin: returns false for empty list', t => {
  t.falsy(isKvAdmin('pk-admin', []))
})

test('isKvAdmin: returns false for null list', t => {
  t.falsy(isKvAdmin('pk-admin', null))
})

test('isKvAdmin: returns false for undefined list', t => {
  t.falsy(isKvAdmin('pk-admin', undefined))
})

test('isKvAdmin: returns false for empty pubkey', t => {
  t.falsy(isKvAdmin('', ['pk-admin']))
})

test('isKvAdmin: returns false for null pubkey', t => {
  t.falsy(isKvAdmin(null, ['pk-admin']))
})

test('isKvAdmin: works with multiple entries', t => {
  t.ok(isKvAdmin('pk2', ['pk1', 'pk2', 'pk3']))
})

// — countPresenceByRoom —

const key = (name) => ({ name })

test('countPresenceByRoom: single user in one room', t => {
  const counts = countPresenceByRoom([key('presence:general:pk1')])
  t.is(counts['general'], 1)
})

test('countPresenceByRoom: multiple users in same room', t => {
  const counts = countPresenceByRoom([
    key('presence:voice:pk1'),
    key('presence:voice:pk2'),
    key('presence:voice:pk3')
  ])
  t.is(counts['voice'], 3)
})

test('countPresenceByRoom: users spread across rooms', t => {
  const counts = countPresenceByRoom([
    key('presence:room-a:pk1'),
    key('presence:room-b:pk2'),
    key('presence:room-a:pk3')
  ])
  t.is(counts['room-a'], 2)
  t.is(counts['room-b'], 1)
})

test('countPresenceByRoom: empty list returns empty object', t => {
  const counts = countPresenceByRoom([])
  t.is(Object.keys(counts).length, 0)
})

test('countPresenceByRoom: malformed keys (wrong segment count) are ignored', t => {
  const counts = countPresenceByRoom([
    key('presence:onlytwo'),
    key('presence:room:pk1:extra'),
    key('presence:room:pk2')
  ])
  t.is(counts['onlytwo'], undefined)
  t.is(counts['room'], 1)
})

test('countPresenceByRoom: room with no users returns undefined (not 0)', t => {
  const counts = countPresenceByRoom([key('presence:voice:pk1')])
  t.is(counts['other'], undefined)
})
