import { esc, fmtTime, avatarColor } from './utils.js'
import { state, session, saveRead } from './state.js'
import { showCtx } from './sidebar.js'
import { renderText, customEmojiMap, giphyGifUrl, isTenorUrl, isImageUrl } from './text-utils.js'
import { notifyIfNeeded } from './notifications.js'

export const messagesEl = document.getElementById('messages')

let lastPubkey = null
let lastTs = 0
let lastReadTs = 0
let unreadDividerShown = false
let replyTo = null

export let historyHasMore = false
export let oldestTs = null
export let oldestId = null

export const setHistoryHasMore = (v) => { historyHasMore = v }
export const setOldestTs = (v) => { oldestTs = v }
export const setOldestId = (v) => { oldestId = v }
export const resetHistory = () => { historyHasMore = false; oldestTs = null; oldestId = null }
export const initLastRead = (ts) => { lastReadTs = ts; unreadDividerShown = false; lastPubkey = null; lastTs = 0 }

export const SVG_REPLY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>'
export const SVG_LINK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>'
export const SVG_EDIT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>'
export const SVG_DELETE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>'

export const _scrollToBottom = () => {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight
  })
}

export const _observeImgForScroll = (img) => {
  const trigger = () => _scrollToBottom()
  if (img.complete && img.naturalHeight > 0) {
    requestAnimationFrame(trigger)
  } else {
    img.addEventListener('load', trigger, { once: true })
    img.addEventListener('error', trigger, { once: true })
  }
}

const insertGifEmbed = (gifUrl, msgBody) => {
  const img = document.createElement('img')
  img.className = 'msg-img giphy-embed'
  img.src = gifUrl
  img.alt = ''
  img.setAttribute('data-lightbox', gifUrl)
  const reactRow = msgBody.querySelector('.msg-reactions')
  reactRow ? msgBody.insertBefore(img, reactRow) : msgBody.appendChild(img)
  _observeImgForScroll(img)
}

const ogCache = new Map()
const fetchOGPreviews = async (msgEl, text) => {
  const urls = [...text.matchAll(/https?:\/\/[^\s<>"']+/g)]
    .map(m => m[0])
    .filter(u => !isImageUrl(u))
  if (!urls.length) return
  const msgBody = msgEl.querySelector('.msg-body')
  if (!msgBody) return
  for (const url of urls.slice(0, 1)) {
    try {
      const gifUrl = giphyGifUrl(url)
      if (gifUrl) {
        insertGifEmbed(gifUrl, msgBody)
        continue
      }
      const token = session?.token
      if (!token) continue
      let og = ogCache.get(url)
      if (!og) {
        const res = await fetch(`/api/og?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) continue
        og = await res.json()
        ogCache.set(url, og)
      }
      if (isTenorUrl(url) && og.image) {
        insertGifEmbed(og.image, msgBody)
        continue
      }
      if (!og.title && !og.image) continue
      const card = document.createElement('a')
      card.className = 'og-card'
      card.href = url
      card.target = '_blank'
      card.rel = 'noopener noreferrer'
      card.innerHTML = (og.image ? `<img class="og-thumb" src="${esc(og.image)}" alt="" loading="lazy" onerror="this.remove()">` : '') +
        '<div class="og-body">' +
        (og.site_name ? `<div class="og-site">${esc(og.site_name)}</div>` : '') +
        (og.title ? `<div class="og-title">${esc(og.title)}</div>` : '') +
        (og.description ? `<div class="og-desc">${esc(og.description)}</div>` : '') +
        '</div>'
      const reactRow = msgBody.querySelector('.msg-reactions')
      reactRow ? msgBody.insertBefore(card, reactRow) : msgBody.appendChild(card)
      const thumb = card.querySelector('img.og-thumb')
      if (thumb) _observeImgForScroll(thumb)
    } catch {}
  }
}

const replyBar = document.getElementById('reply-bar')
const replyBarText = document.getElementById('reply-bar-text')

export const setReply = (msg) => {
  replyTo = { id: msg.id, from: msg.from, text: msg.text }
  replyBarText.textContent = `${msg.from.name || msg.from.pubkey.slice(0, 8)}: ${msg.text}`
  replyBar.style.display = 'flex'
  document.getElementById('chat-input').focus()
}

export const clearReply = () => {
  replyTo = null
  replyBar.style.display = 'none'
}

export const getReplyTo = () => replyTo

document.getElementById('reply-cancel').addEventListener('click', clearReply)

const showDiceBotModal = () => {
  let modal = document.getElementById('dice-bot-modal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'dice-bot-modal'
    modal.className = 'me-modal'
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center'
    modal.innerHTML = `
      <div class="me-modal-inner" style="max-width:340px;width:90%">
        <button class="ghost me-close" id="dice-bot-close" style="position:absolute;top:12px;right:12px">✕</button>
        <div style="text-align:center;padding:24px 16px 16px">
          <img src="/images/dice/6.svg" style="width:64px;height:64px;margin-bottom:12px">
          <div style="font-size:1.1em;font-weight:600;margin-bottom:4px">🎲 Dice Bot</div>
          <div style="font-size:.85em;color:var(--muted);margin-bottom:16px">A bot that rolls dice for you.</div>
          <div style="font-size:.8em;color:var(--muted);text-align:left;line-height:1.6">
            Type a roll expression and hit send:<br>
            <code>d20</code> · <code>2d6+3</code> · <code>d6n</code> · <code>3#d6</code>
          </div>
        </div>
      </div>`
    document.body.appendChild(modal)
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none' })
    modal.querySelector('#dice-bot-close').addEventListener('click', () => { modal.style.display = 'none' })
  }
  modal.style.display = 'flex'
}

const confirmDelete = () => confirm('Delete this message?')

const startEdit = (msgEl, id, currentText) => {
  const textEl = msgEl.querySelector('.msg-text')
  if (!textEl) return
  const ta = document.createElement('textarea')
  ta.value = currentText
  ta.className = 'edit-input'
  ta.setAttribute('aria-label', 'Edit message')
  ta.rows = 1
  textEl.replaceWith(ta)
  const resize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px' }
  ta.addEventListener('input', resize)
  ta.focus()
  ta.setSelectionRange(ta.value.length, ta.value.length)
  resize()
  const commit = () => {
    ta.removeEventListener('blur', commit)
    const newText = ta.value.trim()
    if (newText && newText !== currentText && state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'edit', id, text: newText }))
    }
    if (ta.parentNode) ta.replaceWith(textEl)
  }
  const cancel = () => {
    ta.removeEventListener('blur', commit)
    if (ta.parentNode) ta.replaceWith(textEl)
  }
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
  })
  ta.addEventListener('blur', commit)
}

export const makeReactAddBtn = (msgId, msgEl) => {
  const btn = document.createElement('button')
  btn.className = 'reaction-add'
  btn.textContent = '☺'
  btn.title = 'Add reaction'
  btn.addEventListener('click', () => import('./ui-helpers.js').then(({ showReactInput }) => showReactInput(msgId, msgEl)))
  return btn
}

export const bindMessageActions = (el, id, from, text, ts, isOwn, isDice) => {
  const avatarCol = el.querySelector('.msg-avatar-col')
  if (avatarCol) {
    avatarCol.style.cursor = 'pointer'
    avatarCol.addEventListener('click', e => {
      e.stopPropagation()
      if (isDice) { showDiceBotModal(); return }
      import('./app.js').then(({ showMemberPopover }) => {
        const member = state.allMembers.get(from.pubkey) || from
        showMemberPopover(member, avatarCol)
      })
    })
  }

  el.addEventListener('contextmenu', e => showCtx(e, [
    { label: 'Reply', action: () => setReply({ id, from, text, ts }) },
    { label: 'React', action: () => import('./ui-helpers.js').then(({ showReactInput }) => showReactInput(id, el)) },
    { label: 'Edit', action: () => startEdit(el, id, text) },
    {
      label: 'Delete',
      danger: true,
      action: () => {
        if (!confirmDelete()) return
        if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'delete', id }))
      }
    }
  ]))
  const actions = document.createElement('div')
  actions.className = 'msg-actions'
  const mkBtn = (title, svg, cls, onClick) => {
    const b = document.createElement('button')
    b.className = `msg-action-btn${cls ? ' ' + cls : ''}`
    b.title = title; b.setAttribute('aria-label', title)
    b.innerHTML = svg
    b.addEventListener('click', e => { e.stopPropagation(); onClick() })
    return b
  }
  const mkQuickReact = (emoji, name) => {
    const b = document.createElement('button')
    b.className = 'msg-action-btn'
    b.title = name; b.setAttribute('aria-label', name)
    b.textContent = emoji
    b.addEventListener('click', e => {
      e.stopPropagation()
      if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'react', msgId: id, emoji }))
    })
    return b
  }
  actions.appendChild(mkQuickReact('🧡', 'orange heart'))
  actions.appendChild(mkQuickReact('💯', '100'))
  actions.appendChild(mkQuickReact('☝️', 'this'))
  actions.appendChild(mkBtn('Add reaction', '☺', '', () => import('./ui-helpers.js').then(({ showReactInput }) => showReactInput(id, el))))
  actions.appendChild(mkBtn('Copy link', SVG_LINK, '', () => {
    navigator.clipboard.writeText(`${location.origin}${location.pathname}#msg-${id}`).then(() => {
      const btn = el.querySelector('[title="Copy link"]')
      if (btn) { btn.style.opacity = '1'; setTimeout(() => { btn.style.opacity = '' }, 1200) }
    })
  }))
  actions.appendChild(mkBtn('Reply', SVG_REPLY, '', () => setReply({ id, from, text, ts })))
  if (isOwn) {
    actions.appendChild(mkBtn('Edit', SVG_EDIT, '', () => startEdit(el, id, text)))
  }
  if (isOwn || state.isAdmin) {
    actions.appendChild(mkBtn('Delete', SVG_DELETE, 'danger', () => {
      if (!confirmDelete()) return
      if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'delete', id }))
    }))
  }
  el.appendChild(actions)
  const reactRow = document.createElement('div')
  reactRow.className = 'msg-reactions'
  reactRow.appendChild(makeReactAddBtn(id, el))
  el.querySelector('.msg-body').appendChild(reactRow)
}

export const renderMessage = ({ id, from, text, ts, replyTo: msgReplyTo }) => {
  if (id && document.querySelector(`[data-id="${CSS.escape(id)}"]`)) {
    if (!oldestTs || ts < oldestTs || (ts === oldestTs && id < oldestId)) { oldestTs = ts; oldestId = id }
    return
  }
  messagesEl.querySelector('.empty, .chat-spinner')?.remove()

  if (!unreadDividerShown && lastReadTs > 0 && ts > lastReadTs) {
    unreadDividerShown = true
    const div = document.createElement('div')
    div.className = 'unread-divider'
    div.textContent = 'new'
    messagesEl.appendChild(div)
  }
  saveRead(state.activeChannelId, ts)

  if (!oldestTs || ts < oldestTs || (ts === oldestTs && id < oldestId)) { oldestTs = ts; oldestId = id }
  const isOwn = from.pubkey === session.pubkey
  const isDice = text.includes('⟵') || /[⚀-⚅]/.test(text)
  const isConsecutive = from.pubkey === lastPubkey && (ts - lastTs) < 5 * 60 * 1000
  lastPubkey = from.pubkey
  lastTs = ts

  const el = document.createElement('div')
  el.className = `msg-row${isConsecutive ? ' consecutive' : ''}`
  if (id) { el.dataset.id = id; el.id = 'msg-' + id }
  const displayName = esc(from.name || from.pubkey.slice(0, 8))
  const initial = (from.name || '?')[0].toUpperCase()
  const color = avatarColor(from.pubkey)

  const replyQuote = msgReplyTo
    ? `<div class="msg-reply" data-reply-id="${esc(msgReplyTo.id)}"><span class="msg-reply-author">${esc(msgReplyTo.from?.name || msgReplyTo.from?.pubkey?.slice(0, 8) || '?')}</span>${esc(msgReplyTo.text)}</div>`
    : ''

  if (isConsecutive) {
    el.innerHTML = `<div class="msg-avatar-spacer"></div><div class="msg-body">${replyQuote}<div class="msg-text">${renderText(text)}</div></div>`
  } else {
    const avatarSrc = isDice ? '/images/dice/6.svg' : (state.allMembers.get(from.pubkey)?.avatar || from.avatar || null)
    const avatarHtml = avatarSrc
      ? `<img class="msg-avatar" src="${esc(avatarSrc)}" alt="${initial}" onerror="this.outerHTML='<div class=\\'msg-avatar-placeholder\\' style=\\'background:${color}\\'>${esc(initial)}</div>'">`
      : `<div class="msg-avatar-placeholder" style="background:${color}">${initial}</div>`
    el.innerHTML = `
      <div class="msg-avatar-col">${avatarHtml}</div>
      <div class="msg-body">
        ${replyQuote}
        <div class="msg-header">
          <span class="msg-author${isOwn ? ' own' : ''}">${displayName}</span>
          <span class="msg-ts">${fmtTime(ts)}</span>
        </div>
        <div class="msg-text">${renderText(text)}</div>
      </div>`
  }

  el.querySelector('.msg-reply')?.addEventListener('click', () => {
    const target = document.querySelector(`[data-id="${CSS.escape(msgReplyTo?.id)}"]`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      target.style.outline = '1px solid var(--accent)'
      setTimeout(() => { target.style.outline = '' }, 1200)
    }
  })

  if (id) bindMessageActions(el, id, from, text, ts, isOwn, isDice)
  messagesEl.appendChild(el)
  _scrollToBottom()
  if (Date.now() - ts < 10000) notifyIfNeeded(from, text, msgReplyTo)
  fetchOGPreviews(el, text)
}

export const renderLoadMore = () => {
  const existing = document.getElementById('load-more-btn')
  if (!historyHasMore) { existing?.remove(); return }
  if (existing) return
  const btn = document.createElement('button')
  btn.id = 'load-more-btn'
  btn.className = 'ghost load-more'
  btn.textContent = '↑ load older messages'
  btn.addEventListener('click', () => {
    if (!oldestTs || !oldestId || state.ws?.readyState !== WebSocket.OPEN) return
    btn.disabled = true
    btn.textContent = 'loading...'
    state.ws.send(JSON.stringify({ type: 'load_history', beforeTs: oldestTs, beforeId: oldestId }))
  })
  messagesEl.prepend(btn)
}

export const prependMessage = (msg) => {
  if (msg.id && document.querySelector(`[data-id="${CSS.escape(msg.id)}"]`)) return
  const { id, from, text, ts, replyTo: msgReplyTo } = msg
  if (!oldestTs || ts < oldestTs || (ts === oldestTs && id < oldestId)) { oldestTs = ts; oldestId = id }

  const isOwn = from.pubkey === session.pubkey
  const isDice = text.includes('⟵') || /[⚀-⚅]/.test(text)
  const el = document.createElement('div')
  el.className = 'msg-row'
  if (id) { el.dataset.id = id; el.id = 'msg-' + id }
  const currentMember = state.allMembers.get(from.pubkey)
  const displayName = esc(currentMember?.name || from.name || from.pubkey.slice(0, 8))
  const color = avatarColor(from.pubkey)
  const initial = (currentMember?.name || from.name || '?')[0].toUpperCase()
  const avatarSrc = isDice ? '/images/dice/6.svg' : (currentMember?.avatar || from.avatar || null)
  const avatarHtml = avatarSrc
    ? `<img class="msg-avatar" src="${esc(avatarSrc)}" alt="${initial}" onerror="this.outerHTML='<div class=\\'msg-avatar-placeholder\\' style=\\'background:${color}\\'>${esc(initial)}</div>'">`
    : `<div class="msg-avatar-placeholder" style="background:${color}">${initial}</div>`
  const replyHtml = msgReplyTo
    ? `<div class="msg-reply" data-reply-id="${esc(msgReplyTo.id)}"><span class="msg-reply-author">${esc(msgReplyTo.from?.name || msgReplyTo.from?.pubkey?.slice(0, 8) || '?')}</span>${esc(String(msgReplyTo.text || '').slice(0, 80))}</div>`
    : ''
  el.innerHTML = `
    <div class="msg-avatar-col">${avatarHtml}</div>
    <div class="msg-body">
      ${replyHtml}
      <div class="msg-header">
        <span class="msg-author${isOwn ? ' own' : ''}">${displayName}</span>
        <span class="msg-ts">${fmtTime(ts)}</span>
      </div>
      <div class="msg-text${isDice ? ' dice' : ''}">${renderText(text)}</div>
    </div>`
  bindMessageActions(el, id, from, text, ts, isOwn, isDice)
  const btn = document.getElementById('load-more-btn')
  btn ? btn.after(el) : messagesEl.prepend(el)
  fetchOGPreviews(el, text)
}

export const renderReactions = (msgId, reactions) => {
  const msgEl = document.querySelector(`[data-id="${msgId}"]`)
  if (!msgEl) return
  const body = msgEl.querySelector('.msg-body')
  if (!body) return
  let pillsEl = msgEl.querySelector('.msg-reactions')
  if (!pillsEl) { pillsEl = document.createElement('div'); pillsEl.className = 'msg-reactions'; body.appendChild(pillsEl) }
  pillsEl.innerHTML = ''
  for (const [emoji, pubkeys] of Object.entries(reactions)) {
    if (!pubkeys.length) continue
    const pill = document.createElement('button')
    pill.className = `reaction-pill${pubkeys.includes(session.pubkey) ? ' own' : ''}`
    const emojiHtml = customEmojiMap.has(emoji.replace(/^:|:$/g, ''))
      ? `<img src="${customEmojiMap.get(emoji.replace(/^:|:$/g, ''))}" style="width:1.3em;height:1.3em;vertical-align:-0.25em;object-fit:contain">`
      : emoji
    pill.innerHTML = `<span class="pe">${emojiHtml}</span>${pubkeys.length > 1 ? `<span>${pubkeys.length}</span>` : ''}`
    pill.title = pubkeys.map(pk => pk === session?.pubkey ? 'You' : (state.allMembers.get(pk)?.name || pk.slice(0, 8))).join(', ')
    pill.addEventListener('click', () => {
      if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'react', msgId, emoji }))
    })
    pillsEl.appendChild(pill)
  }
  pillsEl.appendChild(makeReactAddBtn(msgId, msgEl))
}
