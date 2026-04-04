import { sendPush } from './push.js'
import { broadcastToRooms } from './auth.js'

export const sanitizeFtsQuery = (q) => {
  const specials = '"*+-().[]:^$|\\'
  return specials
    .split('')
    .reduce((acc, char) => acc.split(char).join(' '), q.slice(0, 200))
    .replace(/\s+/g, ' ')
    .trim()
}

export const parseMentions = (text, members) => {
  const handles = (text.match(/@(\S+)/g) || []).map(m => m.slice(1).toLowerCase())
  if (!handles.length) return []
  const found = []
  for (const member of members) {
    const name = (member.name || '').toLowerCase()
    const firstName = name.split(' ')[0]
    if (handles.some(h => h === name || h === firstName)) {
      if (!found.includes(member.pubkey)) found.push(member.pubkey)
    }
  }
  return found
}

export const toggleEmoji = (reactions, pubkey, emoji) => {
  const next = { ...reactions, [emoji]: [...(reactions[emoji] || [])] }
  const idx = next[emoji].indexOf(pubkey)
  if (idx === -1) next[emoji].push(pubkey)
  else next[emoji].splice(idx, 1)
  if (next[emoji].length === 0) delete next[emoji]
  return next
}

export const getInvitableMentions = (text, allMembers, roomMembers, senderPubkey) =>
  parseMentions(text, allMembers).filter(pk => pk !== senderPubkey && !roomMembers.includes(pk))

export const canModify = (pubkey, msgFromPubkey, owner = '', kvAdmins = []) =>
  pubkey === msgFromPubkey || (owner && pubkey === owner.trim()) || (Array.isArray(kvAdmins) && kvAdmins.includes(pubkey))

const nextMidnight = () => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

export class ChatRoom {
  constructor (state, env) {
    this.state = state
    this.env = env
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    )
  }

  async _ensureAlarm () {
    const alarm = await this.state.storage.getAlarm()
    if (!alarm) await this.state.storage.setAlarm(nextMidnight())
  }

  _ensureSchema () {
    if (this._schemaReady) return
    const sql = this.state.storage.sql
    sql.exec(`CREATE TABLE IF NOT EXISTS msgs (
      id TEXT UNIQUE NOT NULL,
      ts INTEGER NOT NULL,
      envelope TEXT NOT NULL
    )`)
    sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS msgs_fts USING fts5(
      text,
      content='msgs',
      content_rowid='rowid'
    )`)
    this._schemaReady = true
  }

  async _backfillFts () {
    const migrated = await this.state.storage.get('fts_migrated_v1')
    if (migrated) return
    const sql = this.state.storage.sql
    const history = await this.state.storage.list({ prefix: 'msg:' })
    for (const envelope of history.values()) {
      try {
        const m = JSON.parse(envelope)
        if (!m.id || !m.ts || typeof m.text !== 'string') continue
        sql.exec('INSERT OR IGNORE INTO msgs(id, ts, envelope) VALUES (?, ?, ?)', m.id, m.ts, envelope)
        const rows = [...sql.exec('SELECT rowid FROM msgs WHERE id = ?', m.id)]
        if (rows[0]) sql.exec('INSERT INTO msgs_fts(rowid, text) VALUES (?, ?)', rows[0].rowid, m.text)
      } catch {}
    }
    await this.state.storage.put('fts_migrated_v1', true)
  }

  _ftsInsert (id, ts, envelope, text) {
    const sql = this.state.storage.sql
    sql.exec('INSERT OR IGNORE INTO msgs(id, ts, envelope) VALUES (?, ?, ?)', id, ts, envelope)
    const rows = [...sql.exec('SELECT rowid FROM msgs WHERE id = ?', id)]
    if (rows[0]) sql.exec('INSERT INTO msgs_fts(rowid, text) VALUES (?, ?)', rows[0].rowid, text)
  }

  _ftsDelete (id) {
    const sql = this.state.storage.sql
    const rows = [...sql.exec('SELECT rowid FROM msgs WHERE id = ?', id)]
    if (!rows[0]) return
    sql.exec('INSERT INTO msgs_fts(msgs_fts, rowid, text) VALUES(\'delete\', ?, ?)', rows[0].rowid, '')
    sql.exec('DELETE FROM msgs WHERE id = ?', id)
  }

  _ftsUpdate (id, newText, newEnvelope) {
    const sql = this.state.storage.sql
    const rows = [...sql.exec('SELECT rowid FROM msgs WHERE id = ?', id)]
    if (!rows[0]) return
    const rowid = rows[0].rowid
    sql.exec('INSERT INTO msgs_fts(msgs_fts, rowid, text) VALUES(\'delete\', ?, ?)', rowid, '')
    sql.exec('INSERT INTO msgs_fts(rowid, text) VALUES (?, ?)', rowid, newText)
    sql.exec('UPDATE msgs SET envelope = ? WHERE id = ?', newEnvelope, id)
  }

  async fetch (req) {
    await this._ensureAlarm()
    this._ensureSchema()
    await this._backfillFts()

    const url = new URL(req.url)
    const doJson = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

    if (req.method === 'POST' && url.pathname.endsWith('/purge')) {
      const msgs = await this.state.storage.list({ prefix: 'msg:' })
      const reacts = await this.state.storage.list({ prefix: 'react:' })
      const keys = [...msgs.keys(), ...reacts.keys()]
      for (const k of keys) await this.state.storage.delete(k)
      try { this.state.storage.sql.exec('DELETE FROM msgs'); this.state.storage.sql.exec('DELETE FROM msgs_fts') } catch {}
      await this.state.storage.delete('fts_migrated_v1')
      this._schemaReady = false
      this.getWebSockets?.()?.forEach(ws => { try { ws.send(JSON.stringify({ type: 'purged' })) } catch {} })
      return doJson({ ok: true, deleted: keys.length })
    }

    if (req.method === 'GET' && url.pathname.endsWith('/last')) {
      const history = await this.state.storage.list({ prefix: 'msg:', reverse: true, limit: 1 })
      const entry = history.values().next().value
      if (!entry) return doJson({ ts: 0 })
      try { return doJson({ ts: JSON.parse(entry).ts }) } catch { return doJson({ ts: 0 }) }
    }

    if (req.method === 'GET' && url.pathname.endsWith('/search')) {
      const q = sanitizeFtsQuery(url.searchParams.get('q') || '')
      if (!q) return doJson([])
      try {
        const rows = [...this.state.storage.sql.exec(
          `SELECT m.envelope FROM msgs m
           INNER JOIN msgs_fts ON msgs_fts.rowid = m.rowid
           WHERE msgs_fts MATCH ?
           ORDER BY m.ts DESC LIMIT 50`,
          q
        )]
        return doJson(rows.map(r => JSON.parse(r.envelope)))
      } catch {
        return doJson([])
      }
    }

    if (req.method === 'POST' && url.pathname.endsWith('/internal/setup-private')) {
      await this.state.storage.put('room_private', true)
      await this.state.storage.put('room_last_activity', Date.now())
      return new Response('ok')
    }

    if (req.method === 'POST' && url.pathname.endsWith('/internal/broadcast')) {
      const message = await req.text()
      for (const ws of this.state.getWebSockets()) {
        try { ws.send(message) } catch {}
      }
      return new Response('ok')
    }

    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('not found', { status: 404 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.state.acceptWebSocket(server)
    const attachment = {
      pubkey: req.headers.get('X-Member-Pubkey') || '',
      name: req.headers.get('X-Member-Name') || '',
      avatar: req.headers.get('X-Member-Avatar') || ''
    }
    server.serializeAttachment(attachment)

    // Store room ID on first connect so push logic can find it
    if (!this._roomId) {
      this._roomId = req.headers.get('X-Room-Id') || ''
      if (this._roomId) this.state.storage.put('room_id', this._roomId).catch(() => {})
    }

    // send current presence list to new connection (excludes self)
    const members = this.state.getWebSockets()
      .filter(ws => ws !== server)
      .map(ws => ws.deserializeAttachment())
      .filter(a => a.pubkey)
    try { server.send(JSON.stringify({ type: 'presence', members })) } catch {}

    // broadcast join to all peers (including new connection)
    const join = JSON.stringify({ type: 'join', from: attachment })
    for (const peer of this.state.getWebSockets()) {
      try { peer.send(join) } catch {}
    }

    // replay last 50 messages to the new connection
    const history = await this.state.storage.list({ prefix: 'msg:', reverse: true, limit: 51 })
    const entries = [...history]
    const hasMore = entries.length === 51
    const page = hasMore ? entries.slice(0, 50) : entries
    for (const [, envelope] of page.reverse()) {
      try { server.send(envelope) } catch {}
    }
    const msgIds = page.map(([, v]) => { try { return JSON.parse(v).id } catch { return null } }).filter(Boolean)
    const reacts = await this.state.storage.list({ prefix: 'react:' })
    for (const [key, json] of reacts) {
      if (msgIds.includes(key.slice(6))) {
        try { server.send(JSON.stringify({ type: 'reactions', msgId: key.slice(6), reactions: JSON.parse(json) })) } catch {}
      }
    }
    try { server.send(JSON.stringify({ type: 'history_start', hasMore })) } catch {}

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage (ws, msg) {
    let parsed
    try { parsed = JSON.parse(msg) } catch { return }

    if (parsed.type === 'ping') {
      try { ws.send(JSON.stringify({ type: 'pong' })) } catch {}
      return
    }

    if (parsed.type === 'signal') {
      const { to, data } = parsed
      if (!to || !data) return
      const { pubkey } = ws.deserializeAttachment()
      if (!pubkey) return
      const target = this.state.getWebSockets().find(w => w.deserializeAttachment().pubkey === to)
      if (target) try { target.send(JSON.stringify({ type: 'signal', from: pubkey, data })) } catch {}
      return
    }

    if (parsed.type === 'load_history') {
      const { beforeTs, beforeId } = parsed
      if (!beforeTs || !beforeId) return
      const end = `msg:${beforeTs}:${beforeId}`
      const result = await this.state.storage.list({ prefix: 'msg:', end, reverse: true, limit: 51 })
      const entries = [...result]
      const hasMore = entries.length === 51
      const page = hasMore ? entries.slice(0, 50) : entries
      const messages = page.reverse().map(([, v]) => v)
      const msgIds = page.map(([, v]) => { try { return JSON.parse(v).id } catch { return null } }).filter(Boolean)
      const reacts = await this.state.storage.list({ prefix: 'react:' })
      const reactions = []
      for (const [key, json] of reacts) {
        if (msgIds.includes(key.slice(6))) reactions.push({ msgId: key.slice(6), reactions: JSON.parse(json) })
      }
      try { ws.send(JSON.stringify({ type: 'history_chunk', messages, reactions, hasMore })) } catch {}
      return
    }

    if (parsed.type === 'react') {
      const { msgId, emoji } = parsed
      if (!msgId || !emoji) return
      const { pubkey } = ws.deserializeAttachment()
      const key = `react:${msgId}`
      const current = toggleEmoji(JSON.parse(await this.state.storage.get(key) || '{}'), pubkey, emoji)
      await this.state.storage.put(key, JSON.stringify(current))
      const broadcast = JSON.stringify({ type: 'reactions', msgId, reactions: current })
      for (const peer of this.state.getWebSockets()) {
        try { peer.send(broadcast) } catch {}
      }
      return
    }

    if (parsed.type === 'delete') {
      if (!parsed.id || typeof parsed.id !== 'string') return
      const { pubkey } = ws.deserializeAttachment()
      const history = await this.state.storage.list({ prefix: 'msg:' })
      const toDelete = []
      for (const [key, envelope] of history) {
        let m
        try { m = JSON.parse(envelope) } catch { continue }
        if (m.id === parsed.id) {
          if (!canModify(pubkey, m.from?.pubkey, this.env.OWNER)) return
        }
        if (m.id === parsed.id || m.replyTo?.id === parsed.id) toDelete.push({ key, id: m.id })
      }
      if (toDelete.length) {
        for (const { key, id } of toDelete) {
          await this.state.storage.delete(key)
          await this.state.storage.delete(`react:${id}`)
          this._ftsDelete(id)
          const broadcast = JSON.stringify({ type: 'delete', id })
          for (const peer of this.state.getWebSockets()) {
            try { peer.send(broadcast) } catch {}
          }
        }
      }
      return
    }

    if (parsed.type === 'profile') {
      const att = ws.deserializeAttachment()
      if (!att.pubkey) return
      const updated = { ...att, name: parsed.name || att.name, avatar: parsed.avatar || att.avatar }
      ws.serializeAttachment(updated)
      const broadcast = JSON.stringify({ type: 'profile', pubkey: att.pubkey, name: updated.name, avatar: updated.avatar })
      for (const peer of this.state.getWebSockets()) {
        try { peer.send(broadcast) } catch {}
      }
      return
    }

    if (parsed.type === 'typing') {
      const { pubkey, name, avatar } = ws.deserializeAttachment()
      const broadcast = JSON.stringify({ type: 'typing', from: { pubkey, name, avatar } })
      for (const peer of this.state.getWebSockets()) {
        if (peer === ws) continue
        try { peer.send(broadcast) } catch {}
      }
      return
    }

    if (parsed.type === 'edit') {
      const { id, text } = parsed
      if (!id || typeof id !== 'string' || !text || typeof text !== 'string') return
      const { pubkey } = ws.deserializeAttachment()
      const history = await this.state.storage.list({ prefix: 'msg:' })
      for (const [key, envelope] of history) {
        let m
        try { m = JSON.parse(envelope) } catch { continue }
        if (m.id === id) {
          if (!canModify(pubkey, m.from?.pubkey, this.env.OWNER)) return
          m.text = text.slice(0, 2000)
          m.edited = true
          const newEnvelope = JSON.stringify(m)
          await this.state.storage.put(key, newEnvelope)
          this._ftsUpdate(id, m.text, newEnvelope)
          const broadcast = JSON.stringify({ type: 'edited', id, text: m.text })
          for (const peer of this.state.getWebSockets()) {
            try { peer.send(broadcast) } catch {}
          }
          return
        }
      }
      return
    }

    if (!parsed?.text || typeof parsed.text !== 'string') return

    const { pubkey, name, avatar } = ws.deserializeAttachment()
    const ts = Date.now()
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    const id = (typeof parsed.id === 'string' && UUID_RE.test(parsed.id)) ? parsed.id : crypto.randomUUID()
    const replyTo = parsed.replyTo && typeof parsed.replyTo.id === 'string'
      ? { id: parsed.replyTo.id, from: parsed.replyTo.from, text: String(parsed.replyTo.text || '').slice(0, 100) }
      : undefined
    const envelope = JSON.stringify({
      type: 'message',
      id,
      from: { pubkey, name, avatar },
      text: parsed.text.slice(0, 2000),
      ts,
      ...(replyTo ? { replyTo } : {})
    })

    await this.state.storage.put(`msg:${ts}:${id}`, envelope)
    this.state.storage.put('room_last_activity', Date.now()).catch(() => {})
    this._ftsInsert(id, ts, envelope, parsed.text.slice(0, 2000))

    for (const peer of this.state.getWebSockets()) {
      try { peer.send(envelope) } catch {}
    }

    // Push notifications — fire and forget
    this._pushDmNotify(pubkey, name, parsed.text).catch(() => {})
    this._pushMentionNotify(pubkey, name, parsed.text).catch(() => {})
    this._dmInviteMentioned(pubkey, parsed.text.slice(0, 2000)).catch(() => {})
  }

  async _pushMentionNotify (senderPubkey, senderName, text) {
    const members = await this.env.KV.get('members', { type: 'json' })
    if (!members?.length) return
    const mentioned = parseMentions(text, members)
    if (!mentioned.length) return
    const connected = new Set(
      this.state.getWebSockets().map(ws => ws.deserializeAttachment()?.pubkey).filter(Boolean)
    )
    const title = `@mention from ${senderName || senderPubkey.slice(0, 8)}`
    const body = text.slice(0, 120)
    for (const pubkey of mentioned) {
      if (pubkey === senderPubkey || connected.has(pubkey)) continue
      const sub = await this.env.KV.get(`push:${pubkey}`, { type: 'json' })
      if (!sub) continue
      const result = await sendPush(sub, { title, body, url: '/', tag: `mention-${pubkey}` }, this.env)
      if (result?.expired) await this.env.KV.delete(`push:${pubkey}`)
    }
  }

  async _dmInviteMentioned (senderPubkey, text) {
    const roomId = this._roomId || await this.state.storage.get('room_id')
    if (!roomId) return
    const dmRoom = await this.env.KV.get(`dm:${roomId}`, { type: 'json' })
    if (!dmRoom) return
    const allMembers = await this.env.KV.get('members', { type: 'json' })
    if (!allMembers?.length) return
    const toInvite = getInvitableMentions(text, allMembers, dmRoom.members, senderPubkey)
    if (!toInvite.length) return
    for (const pubkey of toInvite) {
      const existing = (await this.env.KV.get(`dm-pending:${pubkey}`, { type: 'json' })) || []
      if (!existing.includes(roomId)) {
        existing.push(roomId)
        await this.env.KV.put(`dm-pending:${pubkey}`, JSON.stringify(existing))
      }
    }
    // Broadcast after KV write so invited users' GET /api/dm sees the key
    if (!this.env.CHAT_ROOM) return
    const sidebar = await this.env.KV.get('sidebar', { type: 'json' }) || { channels: [{ id: 'general' }] }
    const msg = JSON.stringify({ type: 'dm_notify' })
    for (const ch of (sidebar.channels || [])) {
      try {
        const stub = this.env.CHAT_ROOM.get(this.env.CHAT_ROOM.idFromName(ch.id))
        await stub.fetch(new Request('https://internal/internal/broadcast', { method: 'POST', body: msg }))
      } catch {}
    }
  }

  async _pushDmNotify (senderPubkey, senderName, text) {
    const roomId = this._roomId || await this.state.storage.get('room_id')
    if (!roomId) return
    const dmRoom = await this.env.KV.get(`dm:${roomId}`, { type: 'json' })
    if (!dmRoom) return // not a DM room
    const connected = new Set(
      this.state.getWebSockets().map(ws => ws.deserializeAttachment()?.pubkey).filter(Boolean)
    )
    const title = senderName || senderPubkey.slice(0, 8)
    const body = text.slice(0, 120)
    for (const memberPubkey of dmRoom.members) {
      if (memberPubkey === senderPubkey || connected.has(memberPubkey)) continue
      const sub = await this.env.KV.get(`push:${memberPubkey}`, { type: 'json' })
      if (!sub) continue
      const result = await sendPush(sub, { title, body, url: '/', tag: `dm-${roomId}` }, this.env)
      if (result?.expired) await this.env.KV.delete(`push:${memberPubkey}`)
    }
  }

  async alarm () {
    const date = new Date().toISOString().slice(0, 10)
    const MAX_MSGS = 10000

    const isPrivate = await this.state.storage.get('room_private')
    if (isPrivate) {
      const lastActivity = await this.state.storage.get('room_last_activity') || 0
      if (Date.now() - lastActivity > 30 * 24 * 60 * 60 * 1000) {
        await this.state.storage.deleteAll()
        return // room gone, no alarm rescheduled
      }
      await this.state.storage.setAlarm(nextMidnight())
      return // private rooms skip backup
    }

    if (!this.env.BACKUP) {
      console.error('R2 binding missing — skipping backup')
      await this.state.storage.setAlarm(nextMidnight())
      return
    }

    try {
      const history = await this.state.storage.list({ prefix: 'msg:' })
      const reacts = await this.state.storage.list({ prefix: 'react:' })
      const messages = []
      for (const envelope of history.values()) {
        try { messages.push(JSON.parse(envelope)) } catch {}
      }
      const reactions = {}
      for (const [key, json] of reacts) {
        try { reactions[key.slice(6)] = JSON.parse(json) } catch {}
      }

      await this.env.BACKUP.put(
        `backups/${date}.json`,
        JSON.stringify({ messages, reactions }),
        { httpMetadata: { contentType: 'application/json' } }
      )
      console.log(`Backed up ${messages.length} messages, ${Object.keys(reactions).length} reactions → backups/${date}.json`)

      if (messages.length > MAX_MSGS) {
        this._ensureSchema()
        const keys = [...history.keys()]
        const toDelete = keys.slice(0, messages.length - MAX_MSGS)
        for (const key of toDelete) {
          const id = key.split(':')[2]
          await this.state.storage.delete(key)
          await this.state.storage.delete(`react:${id}`)
          this._ftsDelete(id)
        }
        console.log(`Pruned ${toDelete.length} old messages → ${MAX_MSGS} cap`)
      }
    } catch (err) {
      console.error('R2 backup failed:', err)
      await this.state.storage.setAlarm(nextMidnight())
      return
    }

    await this.state.storage.setAlarm(nextMidnight())
  }

  async _onDisconnect (ws, closeWs, code, reason) {
    try { if (closeWs) ws.close(code, reason) } catch {}
    const { pubkey } = ws.deserializeAttachment()
    if (pubkey) {
      const otherSessions = this.state.getWebSockets().filter(s => {
        if (s === ws) return false
        try { return s.deserializeAttachment().pubkey === pubkey } catch { return false }
      })
      if (otherSessions.length === 0) {
        const roomId = this._roomId || await this.state.storage.get('room_id')
        if (roomId && this.env.KV) {
          await this.env.KV.delete(`presence:${roomId}:${pubkey}`).catch(() => {})
          const sidebar = await this.env.KV.get('sidebar', { type: 'json' }).catch(() => null)
          const ch = (sidebar?.channels || []).find(c => c.id === roomId)
          if (ch?.type === 'voice') {
            broadcastToRooms(JSON.stringify({ type: 'reload_sidebar' }), this.env).catch(() => {})
          }
        }
      }
      const leave = JSON.stringify({ type: 'leave', pubkey })
      for (const peer of this.state.getWebSockets()) {
        try { peer.send(leave) } catch {}
      }
    }
    const isPrivate = await this.state.storage.get('room_private')
    if (isPrivate && this.state.getWebSockets().length === 0) {
      await this.state.storage.deleteAll()
    }
  }

  async webSocketClose (ws, code, reason) {
    await this._onDisconnect(ws, true, code, reason)
  }

  async webSocketError (ws) {
    await this._onDisconnect(ws, true, 1011, 'error')
  }
}
