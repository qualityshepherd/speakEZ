import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.resolve(__dirname, '../../assets')
const AXE = path.resolve(__dirname, '../../node_modules/axe-core/axe.min.js')

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
}

let server, browser, baseUrl

before(async () => {
  server = await new Promise(resolve => {
    const s = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x')
      let file = path.join(ASSETS, url.pathname === '/' ? '/index.html' : url.pathname)
      try {
        const body = await readFile(file)
        const ext = path.extname(file)
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' })
        res.end(body)
      } catch {
        res.writeHead(404); res.end()
      }
    })
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address()
  baseUrl = `http://127.0.0.1:${port}`

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
})

after(async () => {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
})

const fakeSession = JSON.stringify({
  token: 'test-token',
  pubkey: 'a'.repeat(64),
  name: 'Tester',
  avatar: ''
})

const axeRun = async (page) => {
  await page.addScriptTag({ path: AXE })
  return page.evaluate(() =>
    new Promise((resolve, reject) =>
      axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] } },
        (err, r) => err ? reject(err) : resolve(r))
    )
  )
}

const formatViolations = (violations) =>
  violations.map(v =>
    `[${v.impact}] ${v.id}: ${v.description}\n` +
    v.nodes.slice(0, 3).map(n => `  → ${n.target.join(', ')}`).join('\n')
  ).join('\n\n')

const runAxeTest = async (pathname, { injectSession = false, waitFor = null } = {}) => {
  const page = await browser.newPage()
  try {
    if (injectSession) {
      await page.evaluateOnNewDocument((s) => {
        localStorage.setItem('session', s)
        localStorage.setItem('name', 'Tester')
      }, fakeSession)
    }

    // Block WS and API calls that would fail without a real server
    await page.setRequestInterception(true)
    page.on('request', req => {
      const url = req.url()
      if (url.includes('/api/') || url.startsWith('ws')) req.abort()
      else req.continue()
    })

    await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'domcontentloaded' })
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 3000 }).catch(() => {})

    const results = await axeRun(page)
    const violations = results.violations.filter(v => v.impact !== 'minor')
    assert.strictEqual(
      violations.length, 0,
      `axe violations on ${pathname}:\n\n${formatViolations(violations)}`
    )
  } finally {
    await page.close()
  }
}

test('axe: login.html', () => runAxeTest('/login.html'))
test('axe: invite.html', () => runAxeTest('/invite.html'))
test('axe: index.html',  () => runAxeTest('/index.html', { injectSession: true, waitFor: '#messages' }))
