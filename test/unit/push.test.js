import { webcrypto } from 'node:crypto'
import { unit as test } from '../testpup.js'

// push.js uses globalThis.crypto — polyfill for Node
if (!globalThis.crypto) globalThis.crypto = webcrypto

const { sendPush } = await import('../../worker/push.js')

// — Generate a real VAPID key pair for tests —
const vapidKP = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
)
const VAPID_PUBLIC_KEY = Buffer.from(
  await webcrypto.subtle.exportKey('raw', vapidKP.publicKey)
).toString('base64url')
const VAPID_PRIVATE_KEY_JWK = JSON.stringify(
  await webcrypto.subtle.exportKey('jwk', vapidKP.privateKey)
)

// — Generate a fake push subscription (browser-side key pair) —
const subKP = await webcrypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
)
const subPublicRaw = Buffer.from(
  await webcrypto.subtle.exportKey('raw', subKP.publicKey)
).toString('base64url')
const authSecret = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('base64url')

const fakeSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/fake-token',
  keys: { p256dh: subPublicRaw, auth: authSecret }
}

const mockEnv = {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY_JWK,
  VAPID_SUBJECT: 'mailto:test@example.com'
}

test('sendPush: returns undefined when VAPID keys missing', async t => {
  const result = await sendPush(fakeSubscription, { title: 'hi', body: 'test' }, {})
  t.is(result, undefined)
})

test('sendPush: does not throw with valid keys (network will fail, not our code)', async t => {
  let threw = false
  try {
    // Will fail at the fetch() to the fake endpoint — that's expected.
    // We just verify our crypto code doesn't throw.
    await sendPush(fakeSubscription, { title: 'test', body: 'body', url: '/', tag: 'x' }, mockEnv)
  } catch {
    threw = true
  }
  t.falsy(threw)
})

test('sendPush: produces no output when env missing VAPID_PRIVATE_KEY_JWK', async t => {
  const result = await sendPush(fakeSubscription, { title: 'hi' }, { VAPID_PUBLIC_KEY })
  t.is(result, undefined)
})

test('sendPush: handles malformed subscription gracefully', async t => {
  let threw = false
  try {
    await sendPush({ endpoint: 'https://x.com', keys: { p256dh: 'bad', auth: 'bad' } }, { title: 'x' }, mockEnv)
  } catch {
    threw = true
  }
  t.falsy(threw)
})
