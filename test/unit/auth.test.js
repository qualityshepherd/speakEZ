import { webcrypto } from 'node:crypto'

import { unit as test } from '../testpup.js'
import {
  deriveKeypair,
  signChallenge,
  verifyChallenge,
  makeInvite,
  isInviteValid,
  makeSession,
  isSessionValid,
  scorePassphrase,
  toHex,
  isValidToken
} from '../../worker/auth.js'
if (!globalThis.crypto) globalThis.crypto = webcrypto

test('deriveKeypair: same phrase yields same pubkey', async t => {
  const a = await deriveKeypair('correct horse battery staple')
  const b = await deriveKeypair('correct horse battery staple')
  t.is(a.pubkey, b.pubkey)
})

test('deriveKeypair: different phrase yields different pubkey', async t => {
  const a = await deriveKeypair('correct horse battery staple')
  const b = await deriveKeypair('incorrect pony battery staple')
  t.not(a.pubkey, b.pubkey)
})

test('deriveKeypair: returns pubkey string', async t => {
  const { pubkey } = await deriveKeypair('some passphrase here')
  t.ok(typeof pubkey === 'string' && pubkey.length > 0)
})

test('verifyChallenge: valid signature returns true', async t => {
  const phrase = 'the quick brown fox jumps over the lazy dog'
  const { privateKey, pubkey } = await deriveKeypair(phrase)
  const challenge = 'random-challenge-abc123'
  const sig = await signChallenge(challenge, privateKey)
  t.ok(await verifyChallenge(challenge, sig, pubkey))
})

test('verifyChallenge: wrong challenge returns false', async t => {
  const { privateKey, pubkey } = await deriveKeypair('my secret phrase')
  const sig = await signChallenge('challenge-one', privateKey)
  t.falsy(await verifyChallenge('challenge-two', sig, pubkey))
})

test('verifyChallenge: wrong pubkey returns false', async t => {
  const { privateKey } = await deriveKeypair('my secret phrase')
  const { pubkey: wrongPubkey } = await deriveKeypair('different phrase')
  const sig = await signChallenge('challenge', privateKey)
  t.falsy(await verifyChallenge('challenge', sig, wrongPubkey))
})

test('verifyChallenge: tampered sig returns false', async t => {
  const { privateKey, pubkey } = await deriveKeypair('my secret phrase')
  const sig = await signChallenge('challenge', privateKey)
  const tampered = sig.slice(0, -4) + 'aaaa'
  t.falsy(await verifyChallenge('challenge', tampered, pubkey))
})

test('makeInvite: returns code and expires', t => {
  const invite = makeInvite()
  t.ok(typeof invite.code === 'string' && invite.code.length > 0)
  t.ok(typeof invite.expires === 'number')
})

test('makeInvite: expires ~48hrs from now', t => {
  const before = Date.now()
  const invite = makeInvite()
  const after = Date.now()
  const fortyEightHours = 48 * 60 * 60 * 1000
  t.ok(invite.expires >= before + fortyEightHours)
  t.ok(invite.expires <= after + fortyEightHours)
})

test('isInviteValid: fresh unused invite is valid', t => {
  const invite = makeInvite()
  t.ok(isInviteValid(invite))
})

test('isInviteValid: used invite is invalid', t => {
  const invite = { ...makeInvite(), used: true }
  t.falsy(isInviteValid(invite))
})

test('isInviteValid: expired invite is invalid', t => {
  const invite = { code: 'x', expires: Date.now() - 1000, used: false }
  t.falsy(isInviteValid(invite))
})

test('isInviteValid: missing invite is invalid', t => {
  t.falsy(isInviteValid(null))
  t.falsy(isInviteValid(undefined))
})

test('makeSession: returns token and expires', t => {
  const session = makeSession()
  t.ok(typeof session.token === 'string' && session.token.length > 0)
  t.ok(typeof session.expires === 'number')
})

test('makeSession: default TTL is 7 days', t => {
  const before = Date.now()
  const session = makeSession()
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  t.ok(session.expires >= before + sevenDays)
})

test('makeSession: custom TTL respected', t => {
  const before = Date.now()
  const oneDay = 24 * 60 * 60 * 1000
  const session = makeSession(oneDay)
  t.ok(session.expires >= before + oneDay)
})

test('isSessionValid: fresh session is valid', t => {
  t.ok(isSessionValid(makeSession()))
})

test('isSessionValid: expired session is invalid', t => {
  t.falsy(isSessionValid({ token: 'x', expires: Date.now() - 1000 }))
})

test('isSessionValid: missing session is invalid', t => {
  t.falsy(isSessionValid(null))
  t.falsy(isSessionValid(undefined))
})

test('scorePassphrase: weak phrase returns score 0 or 1', t => {
  const { score } = scorePassphrase('password')
  t.ok(score <= 1)
})

test('scorePassphrase: strong phrase returns score 3 or 4', t => {
  const { score } = scorePassphrase('correct horse battery staple from the sky')
  t.ok(score >= 3)
})

test('scorePassphrase: flavor text matches score', t => {
  t.is(scorePassphrase('abc').flavor, 'your dog could guess this')
  t.is(scorePassphrase('Correct horse battery staple from the sky at night').flavor, 'heat death of the universe. nice.')
})

test('toHex: brine.dev encodes correctly', t => {
  t.is(toHex('brine.dev'), '6272696e652e646576')
})

test('toHex: empty string returns empty', t => {
  t.is(toHex(''), '')
})

test('toHex: different domains produce different hex', t => {
  t.not(toHex('brine.dev'), toHex('other.dev'))
})

test('isValidToken: valid token passes', t => {
  const token = makeInvite('brine.dev').code
  t.ok(isValidToken(token, 'brine.dev'))
})

test('isValidToken: wrong domain prefix fails', t => {
  const token = makeInvite('brine.dev').code
  t.falsy(isValidToken(token, 'other.dev'))
})

test('isValidToken: no separator fails', t => {
  t.falsy(isValidToken('6272696e652e646576abc123', 'brine.dev'))
})

test('isValidToken: rand part wrong length fails', t => {
  const prefix = toHex('brine.dev')
  t.falsy(isValidToken(prefix + '_tooshort', 'brine.dev'))
})

test('isValidToken: invalid chars in rand fails', t => {
  const prefix = toHex('brine.dev')
  const badRand = '!@#$%^&*()!@#$%^&*()!@#$%^&*()!@#$%^&*()+='
  t.falsy(isValidToken(prefix + '_' + badRand, 'brine.dev'))
})

test('isValidToken: null fails', t => {
  t.falsy(isValidToken(null, 'brine.dev'))
})

test('isValidToken: undefined fails', t => {
  t.falsy(isValidToken(undefined, 'brine.dev'))
})

test('isValidToken: empty string fails', t => {
  t.falsy(isValidToken('', 'brine.dev'))
})

test('deriveKeypair: same phrase different domain = different pubkey', async t => {
  const a = await deriveKeypair('correct horse battery staple', 'brine.dev')
  const b = await deriveKeypair('correct horse battery staple', 'other.dev')
  t.not(a.pubkey, b.pubkey)
})
