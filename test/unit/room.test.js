import { unit as test } from '../testpup.js'
import { canModify, toggleEmoji, sanitizeFtsQuery, parseMentions } from '../../worker/room.js'

test('canModify: owner can modify their own message', t => {
  t.ok(canModify('pk1', 'pk1', ''))
})

test('canModify: non-owner cannot modify', t => {
  t.falsy(canModify('pk2', 'pk1', ''))
})

test('canModify: admin can modify anyone\'s message', t => {
  t.ok(canModify('admin', 'pk1', 'admin'))
})

test('canModify: admin cannot modify if not in list', t => {
  t.falsy(canModify('pk2', 'pk1', 'admin'))
})

test('canModify: works with comma-separated admin list', t => {
  t.ok(canModify('admin2', 'pk1', 'admin1, admin2, admin3'))
})

test('canModify: empty admins string', t => {
  t.falsy(canModify('pk2', 'pk1', ''))
})

test('canModify: undefined admins', t => {
  t.falsy(canModify('pk2', 'pk1', undefined))
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
