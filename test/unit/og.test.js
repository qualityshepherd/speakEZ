import { unit as test } from '../testpup.js'
import { handleOG } from '../../worker/og.js'

// URL validation — rejects before any fetch or HTMLRewriter

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
