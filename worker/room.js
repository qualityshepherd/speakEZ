export const toggleEmoji = (reactions, pubkey, emoji) => {
  const next = { ...reactions, [emoji]: [...(reactions[emoji] || [])] }
  const idx = next[emoji].indexOf(pubkey)
  if (idx === -1) next[emoji].push(pubkey)
  else next[emoji].splice(idx, 1)
  if (next[emoji].length === 0) delete next[emoji]
  return next
}

export const canModify = (pubkey, msgFromPubkey, admins = '') =>
  pubkey === msgFromPubkey || admins.split(',').map(s => s.trim()).filter(Boolean).includes(pubkey)

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
  }

  async _ensureAlarm () {
    const alarm = await this.state.storage.getAlarm()
    if (!alarm) await this.state.storage.setAlarm(nextMidnight())
  }

  async fetch (req) {
    await this._ensureAlarm()

    const url = new URL(req.url)
    const doJson = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

    if (req.method === 'GET' && url.pathname.endsWith('/last')) {
      const history = await this.state.storage.list({ prefix: 'msg:', reverse: true, limit: 1 })
      const entry = history.values().next().value
      if (!entry) return doJson({ ts: 0 })
      try { return doJson({ ts: JSON.parse(entry).ts }) } catch { return doJson({ ts: 0 }) }
    }

    if (req.method === 'GET' && url.pathname.endsWith('/search')) {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim()
      if (!q) return doJson([])
      const history = await this.state.storage.list({ prefix: 'msg:' })
      const results = []
      for (const envelope of history.values()) {
        let m
        try { m = JSON.parse(envelope) } catch { continue }
        if (m.text?.toLowerCase().includes(q)) results.push(m)
      }
      results.sort((a, b) => b.ts - a.ts)
      return doJson(results.slice(0, 50))
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
      name:   req.headers.get('X-Member-Name')   || '',
      avatar: req.headers.get('X-Member-Avatar')  || ''
    }
    server.serializeAttachment(attachment)

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
          if (!canModify(pubkey, m.from?.pubkey, this.env.ADMINS)) return
        }
        if (m.id === parsed.id || m.replyTo?.id === parsed.id) toDelete.push({ key, id: m.id })
      }
      if (toDelete.length) {
        for (const { key, id } of toDelete) {
          await this.state.storage.delete(key)
          await this.state.storage.delete(`react:${id}`)
          const broadcast = JSON.stringify({ type: 'delete', id })
          for (const peer of this.state.getWebSockets()) {
            try { peer.send(broadcast) } catch {}
          }
        }
      } else {
        const broadcast = JSON.stringify({ type: 'delete', id: parsed.id })
        for (const peer of this.state.getWebSockets()) {
          try { peer.send(broadcast) } catch {}
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
          if (!canModify(pubkey, m.from?.pubkey, this.env.ADMINS)) return
          m.text = text.slice(0, 2000)
          m.edited = true
          await this.state.storage.put(key, JSON.stringify(m))
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
    const id = crypto.randomUUID()
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

    for (const peer of this.state.getWebSockets()) {
      try { peer.send(envelope) } catch {}
    }
  }

  async alarm () {
    const date = new Date().toISOString().slice(0, 10)

    if (!this.env.BACKUP) {
      console.error('R2 binding missing — skipping backup')
      await this.state.storage.setAlarm(nextMidnight())
      return
    }

    try {
      const history = await this.state.storage.list({ prefix: 'msg:' })
      const messages = []
      for (const envelope of history.values()) {
        try { messages.push(JSON.parse(envelope)) } catch {}
      }

      await this.env.BACKUP.put(
        `backups/${date}.json`,
        JSON.stringify(messages),
        { httpMetadata: { contentType: 'application/json' } }
      )
      console.log(`Backed up ${messages.length} messages → backups/${date}.json`)
    } catch (err) {
      console.error('R2 backup failed:', err)
      await this.state.storage.setAlarm(nextMidnight())
      return
    }

    await this.state.storage.setAlarm(nextMidnight())
  }

  async webSocketClose (ws, code, reason) {
    try { ws.close(code, reason) } catch {}
    const { pubkey } = ws.deserializeAttachment()
    if (pubkey) {
      const leave = JSON.stringify({ type: 'leave', pubkey })
      for (const peer of this.state.getWebSockets()) {
        try { peer.send(leave) } catch {}
      }
    }
  }

  async webSocketError (ws) {
    try { ws.close(1011, 'error') } catch {}
    const { pubkey } = ws.deserializeAttachment()
    if (pubkey) {
      const leave = JSON.stringify({ type: 'leave', pubkey })
      for (const peer of this.state.getWebSockets()) {
        try { peer.send(leave) } catch {}
      }
    }
  }
}
