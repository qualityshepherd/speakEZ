import { handleAuth, memberByToken, broadcastToRooms } from './auth.js'
import { isRoomMember } from './dm.js'
import { handleOG } from './og.js'
import { ChatRoom } from './room.js'

export { ChatRoom }

export const emojiKeyToName = (key) => key.replace(/\.[^.]+$/, '')
export const emojiKeyToUrl = (key) => `/emoji/${key}`

const AUTH_PATHS = ['/api/invite/', '/api/register', '/api/challenge', '/api/login', '/api/kick', '/api/invite', '/api/me', '/api/members', '/api/sidebar', '/api/upload', '/api/boot', '/api/turn', '/api/dm', '/api/threads', '/api/admin/', '/api/push/']
const OG_PATH = '/api/og'
const PAGES = ['/admin', '/login', '/me', '/invite']

export default {
  async scheduled (event, env, ctx) {
    const url = `https://${env.DOMAIN}/api/health`
    const res = await fetch(url).catch(e => ({ ok: false, status: 0, _err: e.message }))
    if (!res.ok) {
      console.error(`[health] check failed status=${res.status} url=${url}`)
    } else {
      const body = await res.json().catch(() => ({}))
      const missing = Object.entries(body).filter(([k, v]) => v === 'missing').map(([k]) => k)
      if (missing.length) console.error(`[health] missing bindings: ${missing.join(', ')}`)
      else console.log(`[health] ok ts=${body.ts}`)
    }
  },

  async fetch (req, env, ctx) {
    const url = new URL(req.url)
    const path = url.pathname

    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
      return new Response('method not allowed', { status: 405 })
    }

    if (path === '/api/health') {
      return new Response(JSON.stringify({
        kv: env.KV ? 'ok' : 'missing',
        r2: env.BACKUP ? 'ok' : 'missing',
        do: env.CHAT_ROOM ? 'ok' : 'missing',
        ts: Date.now()
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    if (AUTH_PATHS.some(p => path.startsWith(p))) {
      return handleAuth(req, env, url.hostname)
    }

    if (path === OG_PATH) {
      return handleOG(req, env)
    }

    if (path === '/api/emoji') {
      if (!env.BACKUP) return new Response('[]', { headers: { 'Content-Type': 'application/json' } })
      const list = await env.BACKUP.list({ prefix: 'emoji/' })
      const emoji = list.objects
        .filter(o => o.key !== 'emoji/')
        .map(o => ({
          name: emojiKeyToName(o.key.slice(6)), // strip 'emoji/'
          url: emojiKeyToUrl(o.key.slice(6))
        }))
      return new Response(JSON.stringify(emoji), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } })
    }

    if (path.startsWith('/emoji/')) {
      if (!env.BACKUP) return new Response('not found', { status: 404 })
      const rawKey = decodeURIComponent(path.slice(7))
      if (!rawKey || rawKey.includes('..') || rawKey.includes('/') || rawKey.includes('\x00')) return new Response('not found', { status: 404 })
      const key = 'emoji/' + rawKey
      const obj = await env.BACKUP.get(key)
      if (!obj) return new Response('not found', { status: 404 })
      const headers = new Headers()
      obj.writeHttpMetadata(headers)
      headers.set('Cache-Control', 'public, max-age=86400')
      return new Response(obj.body, { headers })
    }

    if (path.startsWith('/api/presence/') && req.method === 'GET') {
      const token = req.headers.get('authorization')?.replace('Bearer ', '')
      const found = await memberByToken(token, env.KV)
      if (!found) return new Response('unauthorized', { status: 401 })
      const room = path.slice('/api/presence/'.length)
      if (!room) return new Response('bad request', { status: 400 })
      const dmRoom = await env.KV.get(`dm:${room}`, { type: 'json' })
      if (dmRoom && !isRoomMember(dmRoom, found.pubkey)) return new Response('forbidden', { status: 403 })
      const list = await env.KV.list({ prefix: `presence:${room}:`, include: ['metadata'] })
      const members = list.keys.map(k => k.metadata).filter(Boolean)
      return new Response(JSON.stringify(members), { headers: { 'Content-Type': 'application/json' } })
    }

    const channelMatch = path.match(/^\/api\/channel\/([^/]+)\/.+$/)
    if (channelMatch) {
      const token = req.headers.get('authorization')?.replace('Bearer ', '')
      const found = await memberByToken(token, env.KV)
      if (!found) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      const roomId = channelMatch[1]
      const dmRoom = await env.KV.get(`dm:${roomId}`, { type: 'json' })
      if (dmRoom && !isRoomMember(dmRoom, found.pubkey)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      const id = env.CHAT_ROOM.idFromName(roomId)
      return env.CHAT_ROOM.get(id).fetch(req)
    }

    if (path === '/api/ws') {
      const token = url.searchParams.get('token')
      const found = await memberByToken(token, env.KV)
      if (!found) return new Response('unauthorized', { status: 401 })

      const room = url.searchParams.get('room') || 'general'

      const dmRoom = await env.KV.get(`dm:${room}`, { type: 'json' })
      if (dmRoom) {
        if (!isRoomMember(dmRoom, found.pubkey)) return new Response('forbidden', { status: 403 })
        ctx.waitUntil(env.KV.put(`dm:${room}`, JSON.stringify({ ...dmRoom, lastActivity: Date.now() })))
      }

      const presenceData = { pubkey: found.pubkey, name: found.member.name || '', avatar: found.member.avatar || '' }
      ctx.waitUntil(env.KV.put(`presence:${room}:${found.pubkey}`, '1', { expirationTtl: 180, metadata: presenceData }))
      if (url.searchParams.get('voice') === '1') {
        ctx.waitUntil(broadcastToRooms(JSON.stringify({ type: 'reload_sidebar' }), env))
      }

      const id = env.CHAT_ROOM.idFromName(room)
      const stub = env.CHAT_ROOM.get(id)

      const headers = new Headers(req.headers)
      headers.set('X-Member-Pubkey', found.pubkey)
      headers.set('X-Member-Name', found.member.name || '')
      headers.set('X-Member-Avatar', found.member.avatar || '')
      headers.set('X-Room-Id', room)

      return stub.fetch(new Request(req.url, { headers }))
    }

    if (PAGES.includes(path)) {
      return env.ASSETS.fetch(new Request(`${url.origin}${path}.html`, req))
    }

    return env.ASSETS.fetch(req)
  }
}
