import { unit as test } from '../testpup.js'
import { isAdminPubkey, sanitizeDescription } from '../../worker/auth.js'

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

// — isAdminPubkey —

test('isAdminPubkey: returns true when pubkey in ADMINS', t => {
  t.ok(isAdminPubkey('pk-admin', { ADMINS: 'pk-admin' }))
})

test('isAdminPubkey: returns false when pubkey not in ADMINS', t => {
  t.falsy(isAdminPubkey('pk-user', { ADMINS: 'pk-admin' }))
})

test('isAdminPubkey: works with comma-separated list', t => {
  t.ok(isAdminPubkey('pk2', { ADMINS: 'pk1, pk2, pk3' }))
})

test('isAdminPubkey: trims whitespace around pubkeys', t => {
  t.ok(isAdminPubkey('pk-admin', { ADMINS: '  pk-admin  ' }))
})

test('isAdminPubkey: returns false when ADMINS is empty string', t => {
  t.falsy(isAdminPubkey('pk-admin', { ADMINS: '' }))
})

test('isAdminPubkey: returns false when ADMINS is undefined', t => {
  t.falsy(isAdminPubkey('pk-admin', {}))
})

test('isAdminPubkey: returns false when pubkey is empty string', t => {
  t.falsy(isAdminPubkey('', { ADMINS: 'pk-admin' }))
})
