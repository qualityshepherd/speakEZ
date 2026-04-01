import { unit as test } from '../testpup.js'
import { handleOG } from '../../worker/og.js'

// URL validation — rejects before any fetch or HTMLRewriter
test('GET /api/og: IPv6 loopback is blocked', async t => {
  const req = new Request('http://x/api/og?url=http://[::1]/secret')
  const res = await handleOG(req, {})
  t.is(res.status, 400)
})

test('GET /api/og: IPv6 private range is blocked', async t => {
  const req = new Request('http://x/api/og?url=http://[fc00::1]/secret')
  const res = await handleOG(req, {})
  t.is(res.status, 400)
})

test('GET /api/og: IPv6 link-local is blocked', async t => {
  const req = new Request('http://x/api/og?url=http://[fe80::1]/secret')
  const res = await handleOG(req, {})
  t.is(res.status, 400)
})

test('GET /api/og: YouTube oEmbed failure returns empty, no page fallback', async t => {
  let calls = 0
  const mockFetch = async () => { calls++; return new Response('', { status: 404 }) }
  const req = new Request('http://x/api/og?url=https://www.youtube.com/watch?v=abc123')
  const res = await handleOG(req, {}, mockFetch)
  t.is(res.status, 200)
  t.is(calls, 1) // only oEmbed, no page fallback
})

test('GET /api/og: redirect to internal IP is blocked', async t => {
  let calls = 0
  const mockFetch = async (url) => {
    calls++
    return new Response('', { status: 301, headers: { Location: 'http://192.168.1.1/secret' } })
  }
  const req = new Request('http://x/api/og?url=https://example.com/page')
  const res = await handleOG(req, {}, mockFetch)
  t.is(calls, 1) // blocked after first call, did not follow redirect
  const body = await res.json()
  t.ok(!body.title) // no content from internal host
})

test('GET /api/og: redirect to non-http scheme is blocked', async t => {
  let calls = 0
  const mockFetch = async () => {
    calls++
    return new Response('', { status: 301, headers: { Location: 'file:///etc/passwd' } })
  }
  const req = new Request('http://x/api/og?url=https://example.com/page')
  const res = await handleOG(req, {}, mockFetch)
  t.is(calls, 1)
  const body = await res.json()
  t.ok(!body.title)
})

test('GET /api/og: missing url returns 400', async t => {
  const req = new Request('http://x/api/og')
  const res = await handleOG(req, {})
  t.is(res.status, 400)
})

test('GET /api/og: invalid url string returns 400', async t => {
  const req = new Request('http://x/api/og?url=not-a-url')
  const res = await handleOG(req, {})
  t.is(res.status, 400)
})

test('GET /api/og: non-http protocol returns 400', async t => {
  const req = new Request('http://x/api/og?url=ftp://example.com')
  const res = await handleOG(req, {})
  t.is(res.status, 400)
})

test('GET /api/og: localhost is blocked', async t => {
  const req = new Request('http://x/api/og?url=http://localhost/secret')
  const res = await handleOG(req, {})
  t.is(res.status, 400)
})

test('GET /api/og: internal IP is blocked', async t => {
  const req = new Request('http://x/api/og?url=http://192.168.1.1/')
  const res = await handleOG(req, {})
  t.is(res.status, 400)
})
