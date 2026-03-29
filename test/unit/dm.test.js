import { unit as test } from '../testpup.js'
import { dmPairKey, isRoomMember } from '../../worker/dm.js'

// — dmPairKey —

test('dmPairKey: same result regardless of argument order', t => {
  t.is(dmPairKey('pk1', 'pk2'), dmPairKey('pk2', 'pk1'))
})

test('dmPairKey: different pairs produce different keys', t => {
  t.not(dmPairKey('pk1', 'pk2'), dmPairKey('pk1', 'pk3'))
})

test('dmPairKey: includes both pubkeys', t => {
  const key = dmPairKey('alice', 'bob')
  t.ok(key.includes('alice'))
  t.ok(key.includes('bob'))
})

test('dmPairKey: two different orderings produce identical keys', t => {
  const a = dmPairKey('zzz', 'aaa')
  const b = dmPairKey('aaa', 'zzz')
  t.is(a, b)
})

// — isRoomMember —

test('isRoomMember: returns true when pubkey in members', t => {
  t.ok(isRoomMember({ members: ['pk1', 'pk2'] }, 'pk1'))
})

test('isRoomMember: returns false when pubkey not in members', t => {
  t.falsy(isRoomMember({ members: ['pk1', 'pk2'] }, 'pk3'))
})

test('isRoomMember: returns false for null room', t => {
  t.falsy(isRoomMember(null, 'pk1'))
})

test('isRoomMember: returns false for undefined room', t => {
  t.falsy(isRoomMember(undefined, 'pk1'))
})

test('isRoomMember: returns false for missing members array', t => {
  t.falsy(isRoomMember({}, 'pk1'))
})

test('isRoomMember: returns false when members is not an array', t => {
  t.falsy(isRoomMember({ members: 'pk1' }, 'pk1'))
})
