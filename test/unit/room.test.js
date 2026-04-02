import { unit as test } from '../testpup.js'
import { canModify, toggleEmoji, sanitizeFtsQuery, parseMentions, getInvitableMentions } from '../../worker/room.js'

test('canModify: sender can modify their own message', t => {
  t.ok(canModify('pk1', 'pk1'))
})

test('canModify: stranger cannot modify', t => {
  t.falsy(canModify('pk2', 'pk1'))
})

test('canModify: owner can modify anyone\'s message', t => {
  t.ok(canModify('pk-owner', 'pk1', 'pk-owner'))
})

test('canModify: owner check is exact match', t => {
  t.falsy(canModify('pk-other', 'pk1', 'pk-owner'))
})

test('canModify: kv admin can modify anyone\'s message', t => {
  t.ok(canModify('pk-admin', 'pk1', '', ['pk-admin']))
})

test('canModify: kv admin not in list cannot modify', t => {
  t.falsy(canModify('pk-other', 'pk1', '', ['pk-admin']))
})

test('canModify: no owner no kvAdmins', t => {
  t.falsy(canModify('pk2', 'pk1', ''))
})

test('toggleEmoji: adds reaction', t => {
  const result = toggleEmoji({}, 'pk1', '👍')
  t.deepEqual(result, { '👍': ['pk1'] })
})

test('toggleEmoji: toggles off when same user reacts again', t => {
  const result = toggleEmoji({ '👍': ['pk1'] }, 'pk1', '👍')
  t.deepEqual(result, {})
})

test('toggleEmoji: multiple users on same emoji', t => {
  const result = toggleEmoji({ '👍': ['pk1'] }, 'pk2', '👍')
  t.deepEqual(result, { '👍': ['pk1', 'pk2'] })
})

test('toggleEmoji: does not mutate original', t => {
  const original = { '👍': ['pk1'] }
  toggleEmoji(original, 'pk2', '👍')
  t.deepEqual(original, { '👍': ['pk1'] })
})

test('toggleEmoji: removes emoji key when last reaction removed', t => {
  const result = toggleEmoji({ '👍': ['pk1'], '❤️': ['pk2'] }, 'pk1', '👍')
  t.deepEqual(result, { '❤️': ['pk2'] })
})

// — sanitizeFtsQuery —

test('sanitizeFtsQuery: plain text passes through', t => {
  t.is(sanitizeFtsQuery('hello world'), 'hello world')
})

test('sanitizeFtsQuery: strips double quotes', t => {
  t.is(sanitizeFtsQuery('say "hello"'), 'say hello')
})

test('sanitizeFtsQuery: strips asterisk', t => {
  t.is(sanitizeFtsQuery('run*'), 'run')
})

test('sanitizeFtsQuery: strips FTS5 operators', t => {
  t.is(sanitizeFtsQuery('a+b-c^d'), 'a b c d')
})

test('sanitizeFtsQuery: strips parens', t => {
  t.is(sanitizeFtsQuery('(hello OR world)'), 'hello OR world')
})

test('sanitizeFtsQuery: collapses extra whitespace', t => {
  t.is(sanitizeFtsQuery('hello   world'), 'hello world')
})

test('sanitizeFtsQuery: trims leading/trailing whitespace', t => {
  t.is(sanitizeFtsQuery('  hello  '), 'hello')
})

test('sanitizeFtsQuery: empty string returns empty string', t => {
  t.is(sanitizeFtsQuery(''), '')
})

// — parseMentions —

const members = [
  { pubkey: 'pk-alice', name: 'Alice' },
  { pubkey: 'pk-bob', name: 'Bob Smith' },
  { pubkey: 'pk-carol', name: 'carol' }
]

test('parseMentions: exact name match', t => {
  t.deepEqual(parseMentions('hey @Alice', members), ['pk-alice'])
})

test('parseMentions: case-insensitive', t => {
  t.deepEqual(parseMentions('hey @alice', members), ['pk-alice'])
})

test('parseMentions: first word of multi-word name', t => {
  t.deepEqual(parseMentions('@Bob check this', members), ['pk-bob'])
})

test('parseMentions: multiple mentions', t => {
  t.deepEqual(parseMentions('@Alice and @carol', members), ['pk-alice', 'pk-carol'])
})

test('parseMentions: no match returns empty array', t => {
  t.deepEqual(parseMentions('hello everyone', members), [])
})

test('parseMentions: unknown handle returns empty array', t => {
  t.deepEqual(parseMentions('@nobody', members), [])
})

test('parseMentions: duplicate mention deduped', t => {
  t.deepEqual(parseMentions('@Alice @Alice', members), ['pk-alice'])
})

test('parseMentions: empty text returns empty array', t => {
  t.deepEqual(parseMentions('', members), [])
})

test('parseMentions: empty members returns empty array', t => {
  t.deepEqual(parseMentions('@Alice', []), [])
})

// — getInvitableMentions —
const MEMBERS = [
  { pubkey: 'pk-brine', name: 'brine' },
  { pubkey: 'pk-otto', name: 'otto' },
  { pubkey: 'pk-alice', name: 'alice' }
]

test('getInvitableMentions: returns non-member pubkey for @mention', t => {
  t.deepEqual(getInvitableMentions('@brine hello', MEMBERS, ['pk-otto'], 'pk-otto'), ['pk-brine'])
})

test('getInvitableMentions: already-member is excluded', t => {
  t.deepEqual(getInvitableMentions('@brine hello', MEMBERS, ['pk-otto', 'pk-brine'], 'pk-otto'), [])
})

test('getInvitableMentions: sender is excluded', t => {
  t.deepEqual(getInvitableMentions('@otto hello', MEMBERS, ['pk-otto'], 'pk-otto'), [])
})

test('getInvitableMentions: no mentions returns empty', t => {
  t.deepEqual(getInvitableMentions('hello world', MEMBERS, ['pk-otto'], 'pk-otto'), [])
})

test('getInvitableMentions: unknown handle returns empty', t => {
  t.deepEqual(getInvitableMentions('@nobody', MEMBERS, ['pk-otto'], 'pk-otto'), [])
})

test('getInvitableMentions: multiple mentions', t => {
  const result = getInvitableMentions('@brine @alice hi', MEMBERS, ['pk-otto'], 'pk-otto')
  t.ok(result.includes('pk-brine'))
  t.ok(result.includes('pk-alice'))
  t.is(result.length, 2)
})
