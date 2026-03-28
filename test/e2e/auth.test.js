import { e2e } from '../testpup.js'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) globalThis.crypto = webcrypto

const BASE_URL = process.env.BASE_URL || 'https://speakez.brine.dev'
const DOMAIN = process.env.TEST_DOMAIN || new URL(BASE_URL).hostname
const PASSPHRASE = process.env.TEST_PASSPHRASE

if (!PASSPHRASE) throw new Error('TEST_PASSPHRASE not set')

// — unauthenticated redirects —

e2e('e2e: unauthed /: redirects to login', async t => {
  await t.goto(`${BASE_URL}/`)
  await t.waitFor('#phrase')
  t.ok((await t.url()).includes('login'))
})

e2e('e2e: unauthed /me: redirects to login', async t => {
  await t.goto(`${BASE_URL}/me`)
  await t.waitFor('#phrase')
  t.ok((await t.url()).includes('login'))
})

// — login flow —

e2e('e2e: login: valid passphrase logs in and lands on app', async t => {
  const { deriveKeypair, signChallenge } = await import('../../assets/lib/keys.js')
  const domain = DOMAIN

  await t.goto(`${BASE_URL}/login`)
  await t.waitFor('#phrase')

  const challenge = await t.eval(async () => {
    const res = await fetch('/api/challenge')
    return (await res.json()).challenge
  })

  const { pubkey, privateKey } = await deriveKeypair(PASSPHRASE, domain)
  const sig = await signChallenge(challenge, privateKey)

  const result = await t.eval(async ({ pubkey, challenge, sig }) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey, challenge, sig })
    })
    return { status: res.status, body: await res.json() }
  }, { pubkey, challenge, sig })

  t.is(result.status, 200)
  t.ok(result.body.token)

  await t.eval(({ token, pubkey }) => {
    localStorage.setItem('session', JSON.stringify({ token, pubkey }))
  }, { token: result.body.token, pubkey })

  await t.goto(`${BASE_URL}/`)
  await t.waitFor('#messages')
  t.ok(await t.exists('#messages'))
})

e2e('e2e: login: wrong passphrase shows error', async t => {
  const { deriveKeypair, signChallenge } = await import('../../assets/lib/keys.js')
  const domain = DOMAIN

  await t.goto(`${BASE_URL}/login`)
  await t.waitFor('#phrase')

  const challenge = await t.eval(async () => {
    const res = await fetch('/api/challenge')
    return (await res.json()).challenge
  })

  const { pubkey, privateKey } = await deriveKeypair('definitely wrong passphrase', domain)
  const sig = await signChallenge(challenge, privateKey)

  const status = await t.eval(async ({ pubkey, challenge, sig }) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey, challenge, sig })
    })
    return res.status
  }, { pubkey, challenge, sig })

  t.is(status, 404)
})
