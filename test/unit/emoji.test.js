import { unit as test } from '../testpup.js'
import { searchEmoji } from '../../assets/lib/emoji.js'

test('searchEmoji: returns empty for query under 2 chars', t => {
  t.deepEqual(searchEmoji(''), [])
  t.deepEqual(searchEmoji('a'), [])
})

test('searchEmoji: finds by primary name', t => {
  const r = searchEmoji('fire')
  t.ok(r.some(x => x.e === '🔥'))
})

test('searchEmoji: finds by alias', t => {
  const r = searchEmoji('thumbs')
  t.ok(r.some(x => x.e === '👍'))
  t.ok(r.some(x => x.e === '👎'))
})

test('searchEmoji: case insensitive', t => {
  const lower = searchEmoji('fire')
  const upper = searchEmoji('FIRE')
  t.deepEqual(lower.map(x => x.e), upper.map(x => x.e))
})

test('searchEmoji: exact match ranks before prefix before contains', t => {
  // 'joy' should rank 😂 (alias: joy) before things that merely contain 'joy'
  const r = searchEmoji('joy')
  t.ok(r.length > 0)
  t.is(r[0].e, '😂')
})

test('searchEmoji: caps results at 8', t => {
  // 'smile' matches many
  const r = searchEmoji('sm')
  t.ok(r.length <= 8)
})

test('searchEmoji: unknown query returns empty', t => {
  t.deepEqual(searchEmoji('xyznotanemoji'), [])
})

test('searchEmoji: each result has e and name fields', t => {
  const r = searchEmoji('fire')
  t.ok(r.length > 0)
  for (const item of r) {
    t.ok(typeof item.e === 'string' && item.e.length > 0)
    t.ok(typeof item.name === 'string' && item.name.length > 0)
  }
})

test('searchEmoji: roll finds dice and eye roll', t => {
  const r = searchEmoji('roll')
  t.ok(r.some(x => x.e === '🎲'))
  t.ok(r.some(x => x.e === '🙄'))
})
