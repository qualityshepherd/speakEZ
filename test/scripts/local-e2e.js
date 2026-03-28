import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 8787
const BASE_URL = `http://localhost:${PORT}`

const wrangler = spawn('npx', ['wrangler', 'dev', '--remote', '--port', PORT], {
  stdio: ['ignore', 'pipe', 'pipe']
})

let ready = false

const waitReady = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('wrangler did not start in time')), 30000)
  const check = (data) => {
    if (data.toString().includes('Ready on')) {
      clearTimeout(timeout)
      ready = true
      resolve()
    }
  }
  wrangler.stdout.on('data', check)
  wrangler.stderr.on('data', check)
  wrangler.on('exit', (code) => {
    if (!ready) { clearTimeout(timeout); reject(new Error(`wrangler exited with ${code}`)) }
  })
})

let exitCode = 1
try {
  await waitReady
  await sleep(500)

  const tests = spawn('node', ['--test', '--test-reporter', 'spec', 'test/e2e/**/*.test.js'], {
    stdio: 'inherit',
    env: { ...process.env, BASE_URL, TEST_DOMAIN: process.env.TEST_DOMAIN || 'speakez.brine.dev' }
  })

  exitCode = await new Promise(resolve => tests.on('exit', resolve))
} finally {
  wrangler.kill()
}

process.exit(exitCode)
