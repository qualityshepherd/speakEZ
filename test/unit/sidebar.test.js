import { unit as test } from '../testpup.js'
import { isAdminPubkey } from '../../worker/auth.js'

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
