import {
  deriveKeypair, signChallenge, verifyChallenge,
  toHex, isValidToken, makeSession, isSessionValid,
  makeInvite, isInviteValid, scorePassphrase
} from '../assets/lib/keys.js'

export {
  deriveKeypair, signChallenge, verifyChallenge,
  toHex, isValidToken, scorePassphrase,
  makeInvite, isInviteValid, makeSession, isSessionValid,
  memberByToken
}

export const UPLOAD_EXT_MAP = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav'
}

export const parseUploadContentType = (header) => (header || '').split(';')[0].trim()
export const getUploadExt = (contentType) => UPLOAD_EXT_MAP[contentType] || null

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

const adminAuthorized = (req, env) => {
  const auth = req.headers?.get?.('authorization')
  const token = auth?.replace('Bearer ', '')
  return !!token && token === env.ADMIN_SECRET
}

const isAdminPubkey = (pubkey, env) =>
  !!(env.ADMINS && env.ADMINS.split(',').map(s => s.trim()).filter(Boolean).includes(pubkey))

const memberByToken = async (token, kv) => {
  if (!token) return null
  const pubkey = await kv.get(`session:${token}`)
  if (!pubkey) return null
  const m = await kv.get(pubkey, { type: 'json' })
  if (!m || m.session?.token !== token || !isSessionValid(m.session)) return null
  return { pubkey, member: m }
}

const writeSessionIndex = async (token, pubkey, expires, kv) => {
  const ttl = Math.max(60, Math.ceil((expires - Date.now()) / 1000))
  await kv.put(`session:${token}`, pubkey, { expirationTtl: ttl })
}

const NON_MEMBER_PREFIXES = ['invite:', 'og:', 'session:', 'members']
const isNonMemberKey = k => NON_MEMBER_PREFIXES.some(p => k.startsWith(p)) || k === 'sidebar'

// Build members index from scratch (one-time migration, or recovery)
const buildMembersIndex = async (kv) => {
  const list = await kv.list({ prefix: '' })
  const members = []
  for (const key of (list.keys || [])) {
    if (isNonMemberKey(key.name)) continue
    const m = await kv.get(key.name, { type: 'json' })
    if (m) members.push({ pubkey: key.name, name: m.name || null, avatar: m.avatar || null })
  }
  await kv.put('members', JSON.stringify(members))
  return members
}

const getMembersIndex = async (kv) => {
  const members = await kv.get('members', { type: 'json' })
  return members ?? await buildMembersIndex(kv)
}

const updateMembersIndex = async (pubkey, { name, avatar }, kv) => {
  const members = await getMembersIndex(kv)
  const idx = members.findIndex(m => m.pubkey === pubkey)
  const entry = { pubkey, name: name || null, avatar: avatar || null }
  if (idx !== -1) members[idx] = entry
  else members.push(entry)
  await kv.put('members', JSON.stringify(members))
}

const removeFromMembersIndex = async (pubkey, kv) => {
  const members = await getMembersIndex(kv)
  await kv.put('members', JSON.stringify(members.filter(m => m.pubkey !== pubkey)))
}

const broadcastToRooms = async (message, env) => {
  if (!env.CHAT_ROOM) return
  try {
    const sidebar = await env.KV.get('sidebar', { type: 'json' }) || { channels: [{ id: 'general' }] }
    await Promise.all((sidebar.channels || []).map(async ch => {
      try {
        const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(ch.id))
        await stub.fetch(new Request('https://internal/internal/broadcast', { method: 'POST', body: message }))
      } catch (err) { console.error(`broadcast failed for channel ${ch.id}:`, err) }
    }))
  } catch (err) { console.error('broadcastToRooms failed:', err) }
}

export const handleAuth = async (req, env, domain) => {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method

  const requireSession = async () => {
    const token = req.headers?.get?.('authorization')?.replace('Bearer ', '')
    return memberByToken(token, env.KV)
  }

  const uploadMatch = path.match(/^\/api\/upload\/(.+)$/)
  if (method === 'GET' && uploadMatch) {
    if (!env.BACKUP) return json({ error: 'storage unavailable' }, 503)
    const obj = await env.BACKUP.get(`uploads/${uploadMatch[1]}`)
    if (!obj) return new Response('not found', { status: 404 })
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000'
      }
    })
  }

  if (method === 'POST' && path === '/api/upload') {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    if (!env.BACKUP) return json({ error: 'storage unavailable' }, 503)
    const contentType = parseUploadContentType(req.headers?.get?.('content-type'))
    const ext = getUploadExt(contentType)
    if (!ext) return json({ error: 'unsupported file type' }, 400)
    const body = await req.arrayBuffer()
    if (body.byteLength > 10 * 1024 * 1024) return json({ error: 'too large' }, 413)
    const key = `uploads/${crypto.randomUUID()}.${ext}`
    await env.BACKUP.put(key, body, { httpMetadata: { contentType } })
    return json({ url: `/api/upload/${key.slice(8)}` })
  }

  const inviteMatch = path.match(/^\/api\/invite\/validate\/(.+)$/)
  if (method === 'GET' && inviteMatch) {
    const code = inviteMatch[1]
    if (!isValidToken(code, domain)) return json({ error: 'invalid token' }, 400)
    const invite = await env.KV.get(`invite:${code}`, { type: 'json' })
    if (!invite) return json({ error: 'not found' }, 404)
    if (!isInviteValid(invite)) return json({ error: 'expired or used' }, 410)
    return json({ ok: true })
  }

  if (method === 'GET' && path === '/api/invite') {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    const list = await env.KV.list({ prefix: 'invite:' })
    const invites = []
    for (const key of (list.keys || [])) {
      const invite = await env.KV.get(key.name, { type: 'json' })
      if (!invite || !isValidToken(invite.code, domain)) continue
      const status = invite.used ? 'used' : invite.expires <= Date.now() ? 'expired' : 'fresh'
      invites.push({ ...invite, status })
    }
    invites.sort((a, b) => b.expires - a.expires)
    return json(invites)
  }

  const inviteDeleteMatch = path.match(/^\/api\/invite\/([^/]+)$/)
  if (method === 'DELETE' && inviteDeleteMatch) {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    const code = inviteDeleteMatch[1]
    const invite = await env.KV.get(`invite:${code}`, { type: 'json' })
    if (!invite) return json({ error: 'not found' }, 404)
    await env.KV.delete(`invite:${code}`)
    return json({ ok: true })
  }

  if (method === 'POST' && path === '/api/invite') {
    const memberFound = await requireSession()
    if (!memberFound && !adminAuthorized(req, env)) return json({ error: 'unauthorized' }, 401)
    const invite = makeInvite(domain)
    await env.KV.put(`invite:${invite.code}`, JSON.stringify(invite))
    return json(invite)
  }

  if (method === 'POST' && path === '/api/register') {
    const { code, pubkey, name } = await req.json()
    if (!isValidToken(code, domain)) return json({ error: 'invalid invite' }, 400)
    const invite = await env.KV.get(`invite:${code}`, { type: 'json' })
    if (!isInviteValid(invite)) return json({ error: 'invalid invite' }, 400)
    const existing = await env.KV.get(pubkey)
    if (existing) return json({ error: 'already registered' }, 409)
    const session = makeSession()
    await env.KV.put(pubkey, JSON.stringify({ createdAt: Date.now(), name: name || null, session }))
    await env.KV.put(`invite:${invite.code}`, JSON.stringify({ ...invite, used: true }))
    await writeSessionIndex(session.token, pubkey, session.expires, env.KV)
    await updateMembersIndex(pubkey, { name: name || null, avatar: null }, env.KV)
    return json({ token: session.token, expires: session.expires })
  }

  if (method === 'GET' && path === '/api/members') {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    return json(await getMembersIndex(env.KV))
  }

  if (method === 'GET' && path === '/api/challenge') {
    const buf = new Uint8Array(32)
    crypto.getRandomValues(buf)
    const challenge = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
    return json({ challenge })
  }

  if (method === 'POST' && path === '/api/login') {
    const { pubkey, challenge, sig } = await req.json()
    const member = await env.KV.get(pubkey, { type: 'json' })
    if (!member) return json({ error: 'not found' }, 404)
    const valid = await verifyChallenge(challenge, sig, pubkey)
    if (!valid) return json({ error: 'unauthorized' }, 401)
    const session = makeSession()
    await env.KV.put(pubkey, JSON.stringify({ ...member, session }))
    await writeSessionIndex(session.token, pubkey, session.expires, env.KV)
    return json({ token: session.token, expires: session.expires })
  }

  if (path === '/api/me') {
    const token = req.headers?.get?.('authorization')?.replace('Bearer ', '')
    const found = await memberByToken(token, env.KV)
    if (!found) return json({ error: 'unauthorized' }, 401)
    if (method === 'GET') {
      return json({ pubkey: found.pubkey, name: found.member.name, avatar: found.member.avatar, isAdmin: isAdminPubkey(found.pubkey, env) })
    }
    if (method === 'POST') {
      const { name, avatar } = await req.json()
      await env.KV.put(found.pubkey, JSON.stringify({ ...found.member, name: name || null, avatar: avatar || null }))
      await updateMembersIndex(found.pubkey, { name: name || null, avatar: avatar || null }, env.KV)
      await broadcastToRooms(JSON.stringify({ type: 'profile', pubkey: found.pubkey, name: name || null, avatar: avatar || null }), env)
      return json({ ok: true })
    }
  }

  const DEFAULT_SIDEBAR = {
    categories: [],
    channels: [{ id: 'general', name: 'general', type: 'text', category: null }]
  }

  if (path === '/api/sidebar') {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)

    if (method === 'GET') {
      const sidebar = await env.KV.get('sidebar', { type: 'json' }) || DEFAULT_SIDEBAR
      return json(sidebar)
    }
  }

  if (method === 'POST' && path === '/api/sidebar/category') {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    const { name } = await req.json()
    if (!name || typeof name !== 'string') return json({ error: 'invalid name' }, 400)
    const sidebar = await env.KV.get('sidebar', { type: 'json' }) || { ...DEFAULT_SIDEBAR }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)
    if (sidebar.categories.find(c => c.id === id)) return json({ error: 'exists' }, 409)
    sidebar.categories.push({ id, name: name.slice(0, 64) })
    await env.KV.put('sidebar', JSON.stringify(sidebar))
    await broadcastToRooms(JSON.stringify({ type: 'reload_sidebar' }), env)
    return json(sidebar)
  }

  if (method === 'POST' && path === '/api/sidebar/channel') {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    const { name, type, category } = await req.json()
    if (!name || typeof name !== 'string') return json({ error: 'invalid name' }, 400)
    if (!['text', 'voice'].includes(type)) return json({ error: 'invalid type' }, 400)
    const sidebar = await env.KV.get('sidebar', { type: 'json' }) || { ...DEFAULT_SIDEBAR }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)
    if (sidebar.channels.find(c => c.id === id)) return json({ error: 'exists' }, 409)
    sidebar.channels.push({ id, name: name.slice(0, 64), type, category: category || null })
    await env.KV.put('sidebar', JSON.stringify(sidebar))
    await broadcastToRooms(JSON.stringify({ type: 'reload_sidebar' }), env)
    return json(sidebar)
  }

  const categoryPatchMatch = path.match(/^\/api\/sidebar\/category\/(.+)$/)
  if (method === 'PATCH' && categoryPatchMatch) {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    const id = categoryPatchMatch[1]
    const { name } = await req.json()
    if (!name || typeof name !== 'string') return json({ error: 'invalid name' }, 400)
    const sidebar = await env.KV.get('sidebar', { type: 'json' }) || { ...DEFAULT_SIDEBAR }
    const cat = sidebar.categories.find(c => c.id === id)
    if (!cat) return json({ error: 'not found' }, 404)
    cat.name = name.slice(0, 64)
    await env.KV.put('sidebar', JSON.stringify(sidebar))
    await broadcastToRooms(JSON.stringify({ type: 'reload_sidebar' }), env)
    return json(sidebar)
  }

  const channelPatchMatch = path.match(/^\/api\/sidebar\/channel\/(.+)$/)
  if (method === 'PATCH' && channelPatchMatch) {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    const id = channelPatchMatch[1]
    const { name } = await req.json()
    if (!name || typeof name !== 'string') return json({ error: 'invalid name' }, 400)
    const sidebar = await env.KV.get('sidebar', { type: 'json' }) || { ...DEFAULT_SIDEBAR }
    const ch = sidebar.channels.find(c => c.id === id)
    if (!ch) return json({ error: 'not found' }, 404)
    ch.name = name.slice(0, 64)
    await env.KV.put('sidebar', JSON.stringify(sidebar))
    await broadcastToRooms(JSON.stringify({ type: 'reload_sidebar' }), env)
    return json(sidebar)
  }

  const categoryDeleteMatch = path.match(/^\/api\/sidebar\/category\/(.+)$/)
  if (method === 'DELETE' && categoryDeleteMatch) {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    const id = categoryDeleteMatch[1]
    const sidebar = await env.KV.get('sidebar', { type: 'json' }) || { ...DEFAULT_SIDEBAR }
    sidebar.categories = sidebar.categories.filter(c => c.id !== id)
    // move orphaned channels to uncategorized
    sidebar.channels = sidebar.channels.map(c => c.category === id ? { ...c, category: null } : c)
    await env.KV.put('sidebar', JSON.stringify(sidebar))
    await broadcastToRooms(JSON.stringify({ type: 'reload_sidebar' }), env)
    return json(sidebar)
  }

  const channelDeleteMatch = path.match(/^\/api\/sidebar\/channel\/(.+)$/)
  if (method === 'DELETE' && channelDeleteMatch) {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    const id = channelDeleteMatch[1]
    if (id === 'general') return json({ error: 'cannot delete general' }, 400)
    const sidebar = await env.KV.get('sidebar', { type: 'json' }) || { ...DEFAULT_SIDEBAR }
    sidebar.channels = sidebar.channels.filter(c => c.id !== id)
    await env.KV.put('sidebar', JSON.stringify(sidebar))
    await broadcastToRooms(JSON.stringify({ type: 'reload_sidebar' }), env)
    return json(sidebar)
  }

  const kickMatch = path.match(/^\/api\/kick\/(.+)$/)
  if (method === 'DELETE' && kickMatch) {
    const found = await requireSession()
    const sessionAdmin = found && isAdminPubkey(found.pubkey, env)
    if (!sessionAdmin && !adminAuthorized(req, env)) return json({ error: 'unauthorized' }, 401)
    const pubkey = kickMatch[1]
    if (found && pubkey === found.pubkey) return json({ error: 'cannot kick yourself' }, 400)
    const member = await env.KV.get(pubkey)
    if (!member) return json({ error: 'not found' }, 404)
    await env.KV.delete(pubkey)
    await removeFromMembersIndex(pubkey, env.KV)
    return json({ ok: true })
  }

  if (method === 'GET' && path === '/api/boot') {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    const [members, config] = await Promise.all([
      getMembersIndex(env.KV),
      env.KV.get('config', { type: 'json' })
    ])
    return json({
      pubkey: found.pubkey,
      name: found.member.name,
      avatar: found.member.avatar,
      isAdmin: isAdminPubkey(found.pubkey, env),
      workspaceName: config?.workspaceName || null,
      members
    })
  }

  if (method === 'PATCH' && path === '/api/boot') {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    if (!isAdminPubkey(found.pubkey, env)) return json({ error: 'forbidden' }, 403)
    const body = await req.json()
    const workspaceName = (body.workspaceName || '').trim().slice(0, 64)
    if (!workspaceName) return json({ error: 'name required' }, 400)
    const config = (await env.KV.get('config', { type: 'json' })) || {}
    config.workspaceName = workspaceName
    await env.KV.put('config', JSON.stringify(config))
    return json({ ok: true })
  }

  if (method === 'GET' && path === '/api/turn') {
    const found = await requireSession()
    if (!found) return json({ error: 'unauthorized' }, 401)
    if (!env.TURN_KEY_ID || !env.TURN_SECRET) return json({ error: 'turn not configured' }, 503)
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`,
      { method: 'POST', headers: { Authorization: `Bearer ${env.TURN_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }) }
    )
    if (!res.ok) return json({ error: 'failed to get turn credentials' }, 502)
    const creds = await res.json()
    return json(creds)
  }

  return json({ error: 'not found' }, 404)
}
