import { unit as test } from '../testpup.js'
import { calcBackoffDelay } from '../../assets/lib/ws-utils.js'

// — calcBackoffDelay —

test('calcBackoffDelay: attempt 1 → 2000ms', t => {
  t.is(calcBackoffDelay(1), 2000)
})

test('calcBackoffDelay: attempt 2 → 4000ms', t => {
  t.is(calcBackoffDelay(2), 4000)
})

test('calcBackoffDelay: attempt 3 → 8000ms', t => {
  t.is(calcBackoffDelay(3), 8000)
})

test('calcBackoffDelay: attempt 4 → 16000ms', t => {
  t.is(calcBackoffDelay(4), 16000)
})

test('calcBackoffDelay: attempt 5 → capped at 30000ms', t => {
  t.is(calcBackoffDelay(5), 30000)
})

test('calcBackoffDelay: high attempt stays capped', t => {
  t.is(calcBackoffDelay(20), 30000)
})

test('calcBackoffDelay: custom cap respected', t => {
  t.is(calcBackoffDelay(3, 5000), 5000)
})

test('calcBackoffDelay: attempt 0 → 1000ms', t => {
  t.is(calcBackoffDelay(0), 1000)
})
