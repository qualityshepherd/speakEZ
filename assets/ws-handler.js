import { state, session } from './state.js'
import { renderSidebar, sidebarAuth, refreshUnread, dmRooms, threadRooms, switchChannel } from './sidebar.js'
import {
  messagesEl, renderMessage, renderReactions, renderLoadMore, prependMessage,
  _scrollToBottom, setHistoryHasMore, oldestTs, oldestId, resetHistory, initLastRead
} from './message-render.js'
import { chatInput, sendBtn } from './ui-helpers.js'
import { renderText } from './text-utils.js'

const isTouchDevice = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches

let reconnectTimer = null

const typingEl = document.getElementById('typing-indicator')
const typingUsers = new Map()
const pendingLeaves = new Map()

const renderTyping = () => {
  const names = [...typingUsers.values()].map(u => u.name || 'someone')
  if (!names.length) { typingEl.textContent = ''; return }
  const joined = names.length === 1
    ? names[0]
    : names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`
  typingEl.textContent = `${joined} ${names.length === 1 ? 'is' : 'are'} typing…`
}

export const connect = (room = state.activeChannelId) => {
  clearTimeout(reconnectTimer)
  if (state.ws) {
    state.ws.onclose = null; state.ws.onerror = null; state.ws.onmessage = null
    if (state.ws.readyState !== WebSocket.CLOSED) state.ws.close()
  }
  const reconnecting = room === state.activeChannelId && (oldestTs !== null || oldestId !== null)
  const atBottom = !reconnecting || messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 50
  initLastRead(state.reads[room] || 0)
  if (!reconnecting) { resetHistory() }
  if (!reconnecting) state.onlineMembers.clear()
  typingUsers.forEach(u => clearTimeout(u.timer)); typingUsers.clear(); renderTyping()
  if (!reconnecting) messagesEl.innerHTML = '<div class="chat-spinner"><img src="/favicon.png" class="chat-spinner-img" alt=""></div>'
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  state.ws = new WebSocket(`${proto}//${location.host}/api/ws?token=${encodeURIComponent(session.token)}&room=${encodeURIComponent(room)}`)

  state.ws.addEventListener('open', () => {
    chatInput.disabled = false
    sendBtn.disabled = false
    const focused = document.activeElement
    if (!isTouchDevice() && (!focused || focused === document.body || focused === chatInput)) chatInput.focus()
    refreshUnread()
    fetch('/api/dm', { headers: sidebarAuth() })
      .then(res => res.ok ? res.json() : null)
      .then(fresh => {
        if (!fresh) return
        let changed = false
        for (const room of fresh) {
          if (!dmRooms.find(r => r.id === room.id)) { dmRooms.push(room); changed = true }
        }
        if (changed) renderSidebar()
      }).catch(() => {})
    const ping = setInterval(() => {
      if (state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'ping' }))
      else clearInterval(ping)
    }, 10000)
    state.ws.addEventListener('close', () => clearInterval(ping), { once: true })
  })

  state.ws.addEventListener('message', e => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'message') renderMessage(msg)
      else if (msg.type === 'delete' && msg.id) {
        document.querySelector(`[data-id="${CSS.escape(msg.id)}"]`)?.remove()
      } else if (msg.type === 'reactions' && msg.msgId) {
        renderReactions(msg.msgId, msg.reactions)
      } else if (msg.type === 'edited' && msg.id) {
        const textEl = document.querySelector(`[data-id="${msg.id}"] .msg-text`)
        if (textEl) {
          textEl.innerHTML = renderText(msg.text)
          if (!textEl.nextSibling?.classList?.contains('msg-edited')) {
            const tag = document.createElement('span')
            tag.className = 'msg-edited'
            tag.textContent = '(edited)'
            textEl.after(tag)
          }
        }
      } else if (msg.type === 'typing' && msg.from?.pubkey) {
        const { pubkey, name } = msg.from
        clearTimeout(typingUsers.get(pubkey)?.timer)
        const timer = setTimeout(() => { typingUsers.delete(pubkey); renderTyping() }, 3000)
        typingUsers.set(pubkey, { name, timer })
        renderTyping()
      } else if (msg.type === 'presence') {
        pendingLeaves.forEach(t => clearTimeout(t)); pendingLeaves.clear()
        state.onlineMembers.clear()
        for (const m of (msg.members || [])) {
          if (m.pubkey) { state.onlineMembers.set(m.pubkey, m); state.allMembers.set(m.pubkey, m) }
        }
        import('./app.js').then(({ renderOnline }) => renderOnline())
      } else if (msg.type === 'join' && msg.from?.pubkey) {
        const pending = pendingLeaves.get(msg.from.pubkey)
        if (pending) { clearTimeout(pending); pendingLeaves.delete(msg.from.pubkey) }
        state.onlineMembers.set(msg.from.pubkey, msg.from)
        state.allMembers.set(msg.from.pubkey, msg.from)
        import('./app.js').then(({ renderOnline }) => renderOnline())
      } else if (msg.type === 'leave' && msg.pubkey) {
        if (pendingLeaves.has(msg.pubkey)) clearTimeout(pendingLeaves.get(msg.pubkey))
        pendingLeaves.set(msg.pubkey, setTimeout(() => {
          pendingLeaves.delete(msg.pubkey)
          state.onlineMembers.delete(msg.pubkey)
          import('./app.js').then(({ renderOnline }) => renderOnline())
        }, 5000))
      } else if (msg.type === 'profile' && msg.pubkey) {
        const updated = { pubkey: msg.pubkey, name: msg.name, avatar: msg.avatar }
        state.allMembers.set(msg.pubkey, updated)
        if (state.onlineMembers.has(msg.pubkey)) state.onlineMembers.set(msg.pubkey, updated)
        import('./app.js').then(({ renderOnline }) => renderOnline())
      } else if (msg.type === 'dm_notify') {
        fetch('/api/dm', { headers: sidebarAuth() })
          .then(res => res.ok ? res.json() : null)
          .then(fresh => {
            if (!fresh) return
            for (const room of fresh) {
              if (!dmRooms.find(r => r.id === room.id)) dmRooms.push(room)
            }
            renderSidebar()
            refreshUnread()
          }).catch(() => {})
      } else if (msg.type === 'thread_notify') {
        fetch('/api/threads', { headers: sidebarAuth() })
          .then(res => res.ok ? res.json() : null)
          .then(fresh => {
            if (!fresh) return
            for (const t of fresh) {
              if (!threadRooms.find(r => r.id === t.id)) threadRooms.push(t)
            }
            renderSidebar()
          }).catch(() => {})
      } else if (msg.type === 'thread_deleted') {
        const idx = threadRooms.findIndex(t => t.id === msg.id)
        if (idx !== -1) threadRooms.splice(idx, 1)
        if (state.activeChannelId === msg.id) switchChannel('general')
        renderSidebar()
      } else if (msg.type === 'reload_sidebar') {
        import('./sidebar.js').then(({ loadSidebar }) => loadSidebar())
      } else if (msg.type === 'history_start') {
        setHistoryHasMore(!!msg.hasMore)
        messagesEl.querySelector('.chat-spinner')?.remove()
        if (!msg.hasMore && !messagesEl.querySelector('[data-id]')) {
          messagesEl.innerHTML = '<div class="empty">nothing here yet.<br>say something.</div>'
        }
        renderLoadMore()
        const hash = location.hash
        if (hash.startsWith('#msg-')) {
          const target = document.getElementById(hash.slice(1))
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' })
            target.style.outline = '1px solid var(--accent)'
            setTimeout(() => { target.style.outline = '' }, 1500)
          }
        }
        if (atBottom) _scrollToBottom()
      } else if (msg.type === 'history_chunk') {
        setHistoryHasMore(!!msg.hasMore)
        for (const envelope of (msg.messages || [])) {
          try { prependMessage(JSON.parse(envelope)) } catch {}
        }
        for (const r of (msg.reactions || [])) renderReactions(r.msgId, r.reactions)
        renderLoadMore()
        if (!msg.hasMore && atBottom) {
          _scrollToBottom()
          const imgs = [...messagesEl.querySelectorAll('img')]
          if (imgs.length) {
            Promise.all(imgs.map(img => img.complete
              ? Promise.resolve()
              : new Promise(resolve => {
                img.onload = resolve
                img.onerror = resolve
              })))
              .then(() => { _scrollToBottom() })
          }
        }
      }
    } catch {}
  })

  state.ws.addEventListener('close', () => {
    chatInput.disabled = true
    sendBtn.disabled = true
    state.onlineMembers.clear()
    import('./app.js').then(({ renderOnline }) => renderOnline())
    typingUsers.forEach(u => clearTimeout(u.timer)); typingUsers.clear(); renderTyping()
    reconnectTimer = setTimeout(() => connect(state.activeChannelId), 1000)
  })

  state.ws.addEventListener('error', () => { if (state.ws.readyState !== WebSocket.CLOSED) state.ws.close() })
}

const reconnectIfDead = () => {
  if (!state.ws || state.ws.readyState === WebSocket.CLOSED || state.ws.readyState === WebSocket.CLOSING) {
    clearTimeout(reconnectTimer)
    connect(state.activeChannelId)
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnectIfDead() })
window.addEventListener('online', reconnectIfDead)
document.addEventListener('focusin', e => {
  if (e.target.matches('input, textarea') && state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'ping' }))
  }
})
