import { unit as test } from '../testpup.js'
import {
  rollDie, rollStandard, rollNamed,
  parseStandard, parseNamed, parseRepeater, parseDiceCommand
} from '../../assets/lib/dice.js'

// — rollDie —

test('rollDie: returns integer between 1 and sides inclusive', async t => {
  for (let i = 0; i < 100; i++) {
    const r = rollDie(6)
    t.ok(Number.isInteger(r) && r >= 1 && r <= 6)
  }
})

test('rollDie: d20 stays in range', async t => {
  for (let i = 0; i < 100; i++) {
    const r = rollDie(20)
    t.ok(r >= 1 && r <= 20)
  }
})

// — rollStandard —

test('rollStandard: output contains die notation', async t => {
  const r = rollStandard(2, 6)
  t.match(r, /2d6/)
})

test('rollStandard: output contains bracketed rolls', async t => {
  const r = rollStandard(1, 6)
  t.match(r, /\[.*\]/)
})

test('rollStandard: output contains arrow', async t => {
  const r = rollStandard(1, 6)
  t.match(r, /⟵/)
})

test('rollStandard: positive modifier shown as +N', async t => {
  const r = rollStandard(1, 6, 3)
  t.match(r, /\+3/)
})

test('rollStandard: negative modifier shown as -N', async t => {
  const r = rollStandard(1, 6, -2)
  t.match(r, /-2/)
})

test('rollStandard: zero modifier omitted', async t => {
  const r = rollStandard(1, 6, 0)
  t.ok(!r.match(/[+-]\d+ 1d6/))
})

test('rollStandard: sum is within valid range', async t => {
  for (let i = 0; i < 50; i++) {
    const r = rollStandard(3, 6)
    const sum = parseInt(r)
    t.ok(sum >= 3 && sum <= 18)
  }
})

// — rollNamed —

test('rollNamed: returns die face character', async t => {
  const r = rollNamed(6)
  t.ok(['⚀','⚁','⚂','⚃','⚄','⚅'].some(f => r.includes(f)))
})

test('rollNamed: returns result symbol', async t => {
  const r = rollNamed(6)
  t.ok(['🗡️','⚖️','💀'].some(s => r.includes(s)))
})

test('rollNamed: contains d6n', async t => {
  const r = rollNamed(6)
  t.match(r, /d6n/)
})

test('rollNamed: non-6 sides returns error string', async t => {
  const r = rollNamed(8)
  t.match(r, /only supports d6n/)
})

// — parseStandard —

test('parseStandard: d6 returns result', async t => {
  t.ok(parseStandard('d6') !== null)
})

test('parseStandard: 2d10 returns result', async t => {
  t.ok(parseStandard('2d10') !== null)
})

test('parseStandard: 1d20+5 returns result with modifier', async t => {
  const r = parseStandard('1d20+5')
  t.ok(r !== null)
  t.match(r, /\+5/)
})

test('parseStandard: 2d6-1 returns result with negative modifier', async t => {
  const r = parseStandard('2d6-1')
  t.ok(r !== null)
  t.match(r, /-1/)
})

test('parseStandard: case insensitive', async t => {
  t.ok(parseStandard('D6') !== null)
})

test('parseStandard: invalid input returns null', async t => {
  t.is(parseStandard('hello'), null)
  t.is(parseStandard(''), null)
  t.is(parseStandard('d6n'), null)
})

// — parseNamed —

test('parseNamed: d6n returns named result', async t => {
  const r = parseNamed('d6n')
  t.ok(r !== null)
  t.match(r, /d6n/)
})

test('parseNamed: case insensitive', async t => {
  t.ok(parseNamed('D6N') !== null)
})

test('parseNamed: d8n returns error string (only d6n supported)', async t => {
  const r = parseNamed('d8n')
  t.ok(r !== null)
  t.match(r, /only supports d6n/)
})

test('parseNamed: non-named input returns null', async t => {
  t.is(parseNamed('d6'), null)
  t.is(parseNamed('hello'), null)
})

// — parseRepeater —

test('parseRepeater: 3#d6 returns 3 lines', async t => {
  const r = parseRepeater('3#d6')
  t.ok(r !== null)
  t.is(r.split('\n').length, 3)
})

test('parseRepeater: 2#2d6 returns 2 lines', async t => {
  const r = parseRepeater('2#2d6')
  t.is(r.split('\n').length, 2)
})

test('parseRepeater: non-repeater returns null', async t => {
  t.is(parseRepeater('d6'), null)
  t.is(parseRepeater('hello'), null)
})

// — parseDiceCommand —

test('parseDiceCommand: routes d6 to standard', async t => {
  t.ok(parseDiceCommand('d6') !== null)
})

test('parseDiceCommand: routes d6n to named', async t => {
  const r = parseDiceCommand('d6n')
  t.ok(r !== null)
  t.match(r, /d6n/)
})

test('parseDiceCommand: routes 3#d6 to repeater', async t => {
  const r = parseDiceCommand('3#d6')
  t.is(r.split('\n').length, 3)
})

test('parseDiceCommand: trims whitespace', async t => {
  t.ok(parseDiceCommand('  d6  ') !== null)
})

test('parseDiceCommand: invalid input returns null', async t => {
  t.is(parseDiceCommand('hello'), null)
  t.is(parseDiceCommand(''), null)
})
