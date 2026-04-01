// Web Push implementation — RFC 8030 + RFC 8291 (aes128gcm) + RFC 8292 (VAPID)

const b64url = buf => {
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

const fromB64url = s =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

const cat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0))
  let off = 0; for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}

const te = new TextEncoder()

async function hmac (key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

async function hkdfExpand (prk, info, len) {
  const out = new Uint8Array(len)
  let t = new Uint8Array(0); let off = 0
  for (let i = 1; off < len; i++) {
    t = await hmac(prk, cat(t, info, new Uint8Array([i])))
    out.set(t.slice(0, Math.min(t.length, len - off)), off)
    off += t.length
  }
  return out
}

async function encryptPayload (subscription, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const serverKP = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKP.publicKey))
  const clientPubKey = await crypto.subtle.importKey(
    'raw', fromB64url(subscription.keys.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, true, []
  )
  const clientPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', clientPubKey))
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPubKey }, serverKP.privateKey, 256
  ))
  const authSecret = fromB64url(subscription.keys.auth)

  const prkKey = await hmac(authSecret, ecdhSecret)
  const ikm = await hkdfExpand(prkKey, cat(te.encode('WebPush: info\x00'), clientPubRaw, serverPubRaw), 32)

  const prkSalt = await hmac(salt, ikm)
  const cek = await hkdfExpand(prkSalt, te.encode('Content-Encoding: aes128gcm\x00'), 16)
  const nonce = await hkdfExpand(prkSalt, te.encode('Content-Encoding: nonce\x00'), 12)

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey,
    cat(te.encode(plaintext), new Uint8Array([2]))
  ))

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false)
  return cat(salt, rs, new Uint8Array([65]), serverPubRaw, ciphertext)
}

async function vapidJwt (endpoint, privateKeyJwk, subject) {
  const origin = new URL(endpoint).origin
  const hdr = b64url(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const pay = b64url(te.encode(JSON.stringify({ aud: origin, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject })))
  const key = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])

  const derSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${hdr}.${pay}`)))
  const rLen = derSig[3]
  const rStart = 4 + (rLen === 33 ? 1 : 0)
  const sLenIdx = 4 + rLen
  const sLen = derSig[sLenIdx + 1]
  const sStart = sLenIdx + 2 + (sLen === 33 ? 1 : 0)

  const rawSig = new Uint8Array(64)
  rawSig.set(derSig.slice(rStart, rStart + 32), 0)
  rawSig.set(derSig.slice(sStart, sStart + 32), 32)

  const sig = b64url(rawSig)
  return `${hdr}.${pay}.${sig}`
}

export async function sendPush (subscription, payload, env) {
  if (!env.VAPID_PRIVATE_KEY_JWK || !env.VAPID_PUBLIC_KEY) return
  try {
    const jwk = JSON.parse(env.VAPID_PRIVATE_KEY_JWK)
    const subject = env.VAPID_SUBJECT || 'mailto:speakez@example.com'
    const jwt = await vapidJwt(subscription.endpoint, jwk, subject)
    const body = await encryptPayload(subscription, JSON.stringify(payload))
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: '86400'
      },
      body
    })

    if (res.status === 410 || res.status === 404) return { expired: true }
    if (!res.ok) return { error: true }

    return { ok: true }
  } catch {
    return { error: true }
  }
}
