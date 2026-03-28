import { unit as test } from '../testpup.js'
import { canModify, toggleEmoji } from '../../worker/room.js'

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
