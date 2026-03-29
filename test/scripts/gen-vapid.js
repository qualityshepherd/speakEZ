#!/usr/bin/env node
// Generate VAPID keys for Web Push. Run once, then set as Worker secrets:
//   wrangler secret put VAPID_PUBLIC_KEY
//   wrangler secret put VAPID_PRIVATE_KEY_JWK
//   wrangler secret put VAPID_SUBJECT   (e.g. mailto:you@example.com)

import { webcrypto } from 'node:crypto'

const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pub = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url')
const priv = JSON.stringify(await webcrypto.subtle.exportKey('jwk', kp.privateKey))

console.log('\nVAPID_PUBLIC_KEY (base64url uncompressed P-256):')
console.log(pub)
console.log('\nVAPID_PRIVATE_KEY_JWK (JSON — keep secret!):')
console.log(priv)
console.log('\nRun:')
console.log(`  echo '${pub}' | wrangler secret put VAPID_PUBLIC_KEY`)
console.log(`  echo '${priv}' | wrangler secret put VAPID_PRIVATE_KEY_JWK`)
console.log('  echo \'mailto:you@example.com\' | wrangler secret put VAPID_SUBJECT')
