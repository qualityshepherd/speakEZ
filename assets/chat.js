import { searchEmoji } from '../../../../../lib/emoji.js'
import { parseDiceCommand } from '../../../../../lib/dice.js'
import { state, session, saveRead } from './state.js'
import { esc, fmtTime, avatarColor, fmtDuration, fmtSecs } from './utils.js'
import { renderSidebar, sidebarAuth, refreshUnread, dmRooms, showCtx } from './sidebar.js'

// — Text processing —
const URL_RE = /https?:\/\/[^\s<>"']+|\/api\/upload\/[^\s<>"']+/g
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|svg)(\?[^\s]*)?$/i
const AUDIO_EXT_RE = /\.(webm|ogg|m4a|mp3|wav)(\?[^\s]*)?$/i
const isImageUrl = u => IMG_EXT_RE.test(u) || (u.startsWith('/api/upload/') && !AUDIO_EXT_RE.test(u))
const isAudioUrl = u => AUDIO_EXT_RE.test(u)

const mentionHtml = (html) =>
  html.replace(/@([\w.-]+)/g, (_, n) => `<span class="mention">@${esc(n)}</span>`)

export const customEmojiMap = new Map()

export const fetchCustomEmoji = async () => {
  const list = await (await fetch('/api/emoji')).json()
  customEmojiMap.clear()
  for (const e of list) customEmojiMap.set(e.name, e.url)
  document.querySelectorAll('.msg-text').forEach(el => {
    if (/:([a-zA-Z0-9_-]+):/.test(el.innerHTML)) { el.innerHTML = customEmojiHtml(el.innerHTML) }
  })
}

const customEmojiHtml = (html) =>
  html.replace(/:([a-zA-Z0-9_-]+):/g, (match, name) => {
    const url = customEmojiMap.get(name)
    return url ? `<img class="custom-emoji" src="${url}" alt=":${name}:" title=":${name}:">` : match
  })

const dieFaceHtml = (html) =>
  html.replace(/[⚀⚁⚂⚃⚄⚅]/g, c => `<span style="font-size:1.35em;line-height:1;vertical-align:-0.1em">${c}</span>`)

const EMOTICONS = [
  ['>:-(', '😠'], [">:'-(", '😭'], ['>:-)', '😈'],
  ['>:(', '😠'], [">:'(", '😭'], ['>:)', '😈'],
  [":'-(", '😭'], [":'(", '😭'],
  [':-D', '😄'], [':-)', '🙂'], [':-(', '😞'],
  [':-P', '😛'], [':-p', '😛'], [':-|', '😐'],
  [':-/', '😕'], [':-O', '😮'], [':-o', '😮'],
  [':-*', '😘'], [';-)', '😉'], ['B-)', '😎'],
  [':D', '😄'], [':)', '🙂'], [':(', '😞'],
  [':P', '😛'], [':p', '😛'], [':|', '😐'],
  [':/', '😕'], [':O', '😮'], [':o', '😮'],
  [':*', '😘'], [';)', '😉'], ['B)', '😎'],
  ['=D', '😄'], ['=)', '🙂'], ['=(', '😞'],
  ['XD', '😆'], ['^_^', '😊'], ['-_-', '😑'],
  ['O_O', '😱'], ['o_o', '😳'], ['<3', '❤️']
]
const EMOTICON_LOOKUP = new Map(EMOTICONS)
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const EMOTICON_RE = new RegExp(
  '(^|[\\s(\'"])(' + EMOTICONS.map(([k]) => escRe(k) + (k === ':/' || k === ':-/' ? '(?!/)' : '')).join('|') + ')(?=[\\s.,!?;:\'"]|$)',
  'gm'
)

const replaceEmoticons = (text) => {
  const chunks = []
  const PROTECT_RE = /(`+[\s\S]*?`+|https?:\/\/\S+|\/api\/upload\/\S+)/g
  let last = 0; let pm
  while ((pm = PROTECT_RE.exec(text)) !== null) {
    if (pm.index > last) chunks.push([false, text.slice(last, pm.index)])
    chunks.push([true, pm[0]])
    last = pm.index + pm[0].length
  }
  if (last < text.length) chunks.push([false, text.slice(last)])
  return chunks.map(([skip, s]) => skip ? s : s.replace(EMOTICON_RE, (_, pre, em) => pre + (EMOTICON_LOOKUP.get(em) ?? em))).join('')
}

const preprocess = (text) => {
  const withEmoticons = replaceEmoticons(text)
  return withEmoticons.replace(URL_RE, (url, offset) => {
    if (/\]\($/.test(withEmoticons.slice(0, offset))) return url
    if (isImageUrl(url)) return `![](${url})`
    if (isAudioUrl(url)) return `[audio](${url})`
    return url
  })
}

const postprocess = (html) => {
  return html
    .replace(/<a href="([^"]+)"[^>]*>audio<\/a>/g, (_, src) =>
      `<div class="msg-audio-player" data-src="${src}"><button class="audio-play-btn" aria-label="Play"><svg viewBox="0 0 10 10" width="11" height="11" fill="currentColor"><polygon points="1,0.5 9.5,5 1,9.5"/></svg></button><div class="audio-scrub"><div class="audio-scrub-track"><div class="audio-scrub-fill"></div></div><div class="audio-scrub-thumb"></div></div><span class="audio-time">0:00</span><a class="audio-dl-btn" href="${src}" download aria-label="Download"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-14 9v2h14v-2H5z"/></svg></a></div>`)
    .replace(/<a href="([^"]+)"/g, (_, href) =>
      `<a href="${href}" target="_blank" rel="noopener noreferrer"`)
    .replace(/<img src="([^"]+)" alt="([^"]*)"/g, (_, src, alt) =>
      `<img class="msg-img" src="${src}" alt="${alt}" loading="lazy" data-lightbox="${src}"`)
}

const renderText = (text) =>
  customEmojiHtml(dieFaceHtml(mentionHtml(postprocess(marked.parse(preprocess(text), { async: false })))))

// — OG previews —
const ogCache = new Map()
const fetchOGPreviews = async (msgEl, text) => {
  const urls = [...text.matchAll(/https?:\/\/[^\s<>"']+/g)]
    .map(m => m[0])
    .filter(u => !isImageUrl(u))
  if (!urls.length) return
  const token = session?.token
  if (!token) return
  const msgBody = msgEl.querySelector('.msg-body')
  if (!msgBody) return
  for (const url of urls.slice(0, 1)) {
    try {
      let og = ogCache.get(url)
      if (!og) {
        const res = await fetch(`/api/og?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) continue
        og = await res.json()
        ogCache.set(url, og)
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
    } catch {}
  }
}

// — Chat state —
export const messagesEl = document.getElementById('messages')
const chatInput = document.getElementById('chat-input')
const sendBtn = document.getElementById('send')

let lastPubkey = null
let lastTs = 0
let lastReadTs = 0
let unreadDividerShown = false
let historyHasMore = false
let oldestTs = null
let oldestId = null
let replyTo = null

// — Message rendering —
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
  if (id) el.dataset.id = id
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
  messagesEl.scrollTop = messagesEl.scrollHeight
  if (Date.now() - ts < 10000) notifyIfNeeded(from, text, msgReplyTo)
  fetchOGPreviews(el, text)
}

const renderLoadMore = () => {
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

const prependMessage = (msg) => {
  if (msg.id && document.querySelector(`[data-id="${CSS.escape(msg.id)}"]`)) return
  const { id, from, text, ts, replyTo: msgReplyTo } = msg
  if (!oldestTs || ts < oldestTs || (ts === oldestTs && id < oldestId)) { oldestTs = ts; oldestId = id }

  const isOwn = from.pubkey === session.pubkey
  const isDice = text.includes('⟵') || /[⚀-⚅]/.test(text)
  const el = document.createElement('div')
  el.className = 'msg-row'
  if (id) el.dataset.id = id
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

// — Audio player —
const SVG_PLAY = '<svg viewBox="0 0 10 10" width="11" height="11" fill="currentColor"><polygon points="1,0.5 9.5,5 1,9.5"/></svg>'
const SVG_PAUSE = '<svg viewBox="0 0 10 10" width="11" height="11" fill="currentColor"><rect x="1" y="0.5" width="3.2" height="9"/><rect x="5.8" y="0.5" width="3.2" height="9"/></svg>'
const audioPlayers = new WeakMap()

const initAudioPlayer = (player) => {
  if (audioPlayers.has(player)) return
  const audio = new Audio(player.dataset.src)
  audio.preload = 'metadata'
  audioPlayers.set(player, audio)
  const fill = player.querySelector('.audio-scrub-fill')
  const thumb = player.querySelector('.audio-scrub-thumb')
  const time = player.querySelector('.audio-time')
  const btn = player.querySelector('.audio-play-btn')
  const updateProgress = () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0
    fill.style.width = pct + '%'
    if (thumb) thumb.style.left = pct + '%'
    time.textContent = fmtSecs(audio.currentTime)
  }
  audio.addEventListener('loadedmetadata', () => { time.textContent = fmtSecs(audio.duration) })
  audio.addEventListener('timeupdate', updateProgress)
  audio.addEventListener('play', () => { btn.innerHTML = SVG_PAUSE })
  audio.addEventListener('pause', () => { btn.innerHTML = SVG_PLAY })
  audio.addEventListener('ended', () => {
    btn.innerHTML = SVG_PLAY
    fill.style.width = '0%'
    if (thumb) thumb.style.left = '0%'
    audio.currentTime = 0
    time.textContent = fmtSecs(audio.duration)
  })
}

document.addEventListener('click', e => {
  const playBtn = e.target.closest('.audio-play-btn')
  if (playBtn) {
    const player = playBtn.closest('.msg-audio-player')
    initAudioPlayer(player)
    const audio = audioPlayers.get(player)
    audio.paused ? audio.play() : audio.pause()
  }
})

let _scrubActive = null
const _scrubSeek = (scrub, clientX) => {
  const player = scrub.closest('.msg-audio-player')
  initAudioPlayer(player)
  const audio = audioPlayers.get(player)
  if (!audio) return
  const doSeek = () => {
    const r = scrub.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    audio.currentTime = pct * audio.duration
    const fill = scrub.querySelector('.audio-scrub-fill')
    const thumb = scrub.querySelector('.audio-scrub-thumb')
    const time = player.querySelector('.audio-time')
    if (fill) fill.style.width = (pct * 100) + '%'
    if (thumb) thumb.style.left = (pct * 100) + '%'
    if (time) time.textContent = fmtSecs(audio.currentTime)
  }
  if (audio.readyState >= 1) doSeek()
  else audio.addEventListener('loadedmetadata', doSeek, { once: true })
}
document.addEventListener('mousedown', e => {
  const scrub = e.target.closest('.audio-scrub')
  if (!scrub) return
  e.preventDefault()
  _scrubActive = scrub
  _scrubSeek(scrub, e.clientX)
})
document.addEventListener('mousemove', e => { if (_scrubActive) _scrubSeek(_scrubActive, e.clientX) })
document.addEventListener('mouseup', () => { _scrubActive = null })
document.addEventListener('touchstart', e => {
  const scrub = e.target.closest('.audio-scrub')
  if (!scrub) return
  _scrubActive = scrub
  _scrubSeek(scrub, e.touches[0].clientX)
}, { passive: true })
document.addEventListener('touchmove', e => {
  if (_scrubActive) _scrubSeek(_scrubActive, e.touches[0].clientX)
}, { passive: true })
document.addEventListener('touchend', () => { _scrubActive = null })

// — Message actions —
const SVG_REPLY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>'
const SVG_EDIT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>'
const SVG_DELETE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>'

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

const bindMessageActions = (el, id, from, text, ts, isOwn, isDice) => {
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
    { label: 'React', action: () => showReactInput(id, el) },
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
  actions.appendChild(mkBtn('Add reaction', '☺', '', () => showReactInput(id, el)))
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

const makeReactAddBtn = (msgId, msgEl) => {
  const btn = document.createElement('button')
  btn.className = 'reaction-add'
  btn.textContent = '☺'
  btn.title = 'Add reaction'
  btn.addEventListener('click', () => showReactInput(msgId, msgEl))
  return btn
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

// — Emoji picker —
const pickerEl = document.getElementById('emoji-picker')
let pickerResults = []; let pickerIdx = 0; let pickerMode = null; let pickerMsgId = null; let pickerColonPos = -1
let reactInputEl = null

export const hidePicker = () => { pickerEl.style.display = 'none'; pickerResults = []; pickerMode = null }

const renderPicker = (anchorEl) => {
  if (!pickerResults.length) { hidePicker(); return }
  pickerEl.innerHTML = ''
  pickerResults.forEach(({ e, name }, i) => {
    const btn = document.createElement('button')
    btn.className = `picker-item${i === pickerIdx ? ' active' : ''}`
    btn.setAttribute('role', 'option')
    btn.setAttribute('aria-selected', i === pickerIdx ? 'true' : 'false')
    const preview = customEmojiMap.has(name)
      ? `<img src="${customEmojiMap.get(name)}" style="width:1.2em;height:1.2em;vertical-align:-0.2em;object-fit:contain">`
      : `<span>${e}</span>`
    btn.innerHTML = `${preview}<span>${name}</span>`
    btn.addEventListener('mousedown', ev => { ev.preventDefault(); selectPicker(i) })
    pickerEl.appendChild(btn)
  })
  pickerEl.style.display = 'block'
  const rect = anchorEl.getBoundingClientRect()
  const h = pickerEl.offsetHeight || 260
  pickerEl.style.left = Math.min(rect.left, window.innerWidth - 210) + 'px'
  pickerEl.style.top = (rect.top - h - 4) + 'px'
}

const movePicker = (dir) => {
  pickerIdx = Math.max(0, Math.min(pickerResults.length - 1, pickerIdx + dir))
  pickerEl.querySelectorAll('.picker-item').forEach((el, i) => {
    el.classList.toggle('active', i === pickerIdx)
    el.setAttribute('aria-selected', i === pickerIdx ? 'true' : 'false')
  })
}

const selectPicker = (idx) => {
  const { e } = pickerResults[idx]
  if (pickerMode === 'input') {
    const pos = chatInput.selectionStart
    const val = chatInput.value
    chatInput.value = val.slice(0, pickerColonPos) + e + ' ' + val.slice(pos)
    const newPos = pickerColonPos + [...e].length + 1
    chatInput.setSelectionRange(newPos, newPos)
    chatInput.focus()
  } else if (pickerMode === 'react') {
    if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'react', msgId: pickerMsgId, emoji: e }))
    reactInputEl?.remove(); reactInputEl = null
  }
  hidePicker()
}

const showPicker = (results, anchorEl, mode, msgId = null, colonPos = -1) => {
  pickerResults = results; pickerIdx = 0; pickerMode = mode; pickerMsgId = msgId; pickerColonPos = colonPos
  renderPicker(anchorEl)
}

const showReactInput = (msgId, msgEl) => {
  hidePicker()
  reactInputEl?.remove()
  reactInputEl = document.createElement('div')
  reactInputEl.className = 'react-input-wrap'
  const inp = document.createElement('input')
  inp.className = 'react-input'
  inp.placeholder = ':emoji...'
  inp.type = 'text'
  reactInputEl.appendChild(inp)
  msgEl.insertAdjacentElement('afterend', reactInputEl)
  inp.focus()
  inp.addEventListener('input', () => {
    const q = inp.value.replace(/^:/, '').trim()
    if (q.length < 2) { hidePicker(); return }
    const custom = [...customEmojiMap.entries()]
      .filter(([name]) => name.includes(q.toLowerCase()))
      .map(([name]) => ({ e: `:${name}:`, name }))
    const results = [...searchEmoji(q), ...custom]
    if (!results.length) { hidePicker(); return }
    showPicker(results, inp, 'react', msgId)
  })
  inp.addEventListener('keydown', e => {
    if (pickerEl.style.display !== 'none') {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePicker(1); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); movePicker(-1); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && pickerResults.length)) { e.preventDefault(); selectPicker(pickerIdx); return }
    }
    if (e.key === 'Escape') { hidePicker(); reactInputEl?.remove(); reactInputEl = null }
  })
  inp.addEventListener('blur', () => setTimeout(() => {
    if (pickerEl.style.display === 'none') { reactInputEl?.remove(); reactInputEl = null }
  }, 150))
}

// — Replies —
const replyBar = document.getElementById('reply-bar')
const replyBarText = document.getElementById('reply-bar-text')

const setReply = (msg) => {
  replyTo = { id: msg.id, from: msg.from, text: msg.text }
  replyBarText.textContent = `${msg.from.name || msg.from.pubkey.slice(0, 8)}: ${msg.text}`
  replyBar.style.display = 'flex'
  chatInput.focus()
}

export const clearReply = () => {
  replyTo = null
  replyBar.style.display = 'none'
}

document.getElementById('reply-cancel').addEventListener('click', clearReply)

// — WebSocket —
const isTouchDevice = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches

export const connect = (room = state.activeChannelId) => {
  clearTimeout(reconnectTimer)
  if (state.ws) {
    state.ws.onclose = null; state.ws.onerror = null; state.ws.onmessage = null
    if (state.ws.readyState !== WebSocket.CLOSED) state.ws.close()
  }
  const reconnecting = room === state.activeChannelId && (oldestTs !== null || oldestId !== null)
  lastPubkey = null; lastTs = 0
  lastReadTs = state.reads[room] || 0
  unreadDividerShown = false
  if (!reconnecting) { historyHasMore = false; oldestTs = null; oldestId = null }
  state.onlineMembers.clear()
  typingUsers.forEach(u => clearTimeout(u.timer)); typingUsers.clear(); renderTyping()
  messagesEl.innerHTML = '<div class="chat-spinner"><img src="/favicon.png" class="chat-spinner-img" alt=""></div>'
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  state.ws = new WebSocket(`${proto}//${location.host}/api/ws?token=${encodeURIComponent(session.token)}&room=${encodeURIComponent(room)}`)

  state.ws.addEventListener('open', () => {
    chatInput.disabled = false
    sendBtn.disabled = false
    if (!isTouchDevice()) chatInput.focus()
    refreshUnread()
    const ping = setInterval(() => {
      if (state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'ping' }))
      else clearInterval(ping)
    }, 30000)
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
        state.onlineMembers.clear()
        for (const m of (msg.members || [])) {
          if (m.pubkey) { state.onlineMembers.set(m.pubkey, m); state.allMembers.set(m.pubkey, m) }
        }
        import('./app.js').then(({ renderOnline }) => renderOnline())
      } else if (msg.type === 'join' && msg.from?.pubkey) {
        state.onlineMembers.set(msg.from.pubkey, msg.from)
        state.allMembers.set(msg.from.pubkey, msg.from)
        import('./app.js').then(({ renderOnline }) => renderOnline())
      } else if (msg.type === 'leave' && msg.pubkey) {
        state.onlineMembers.delete(msg.pubkey)
        import('./app.js').then(({ renderOnline }) => renderOnline())
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
      } else if (msg.type === 'reload_sidebar') {
        import('./sidebar.js').then(({ loadSidebar }) => loadSidebar())
      } else if (msg.type === 'history_start') {
        historyHasMore = !!msg.hasMore
        messagesEl.querySelector('.chat-spinner')?.remove()
        if (!msg.hasMore && !messagesEl.querySelector('[data-id]')) {
          messagesEl.innerHTML = '<div class="empty">nothing here yet.<br>say something.</div>'
        }
        renderLoadMore()
      } else if (msg.type === 'history_chunk') {
        historyHasMore = !!msg.hasMore
        for (const envelope of (msg.messages || [])) {
          try { prependMessage(JSON.parse(envelope)) } catch {}
        }
        for (const r of (msg.reactions || [])) renderReactions(r.msgId, r.reactions)
        renderLoadMore()
        if (!historyHasMore) messagesEl.scrollTop = messagesEl.scrollHeight
      }
    } catch {}
  })

  state.ws.addEventListener('close', () => {
    chatInput.disabled = true
    sendBtn.disabled = true
    state.onlineMembers.clear()
    import('./app.js').then(({ renderOnline }) => renderOnline())
    typingUsers.forEach(u => clearTimeout(u.timer)); typingUsers.clear(); renderTyping()
    reconnectTimer = setTimeout(() => connect(state.activeChannelId), 3000)
  })

  state.ws.addEventListener('error', () => { if (state.ws.readyState !== WebSocket.CLOSED) state.ws.close() })
}

let reconnectTimer = null

// — Typing indicator —
const typingEl = document.getElementById('typing-indicator')
const typingUsers = new Map()

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

let typingTimer = null
const sendTyping = () => {
  if (state.ws?.readyState !== WebSocket.OPEN) return
  state.ws.send(JSON.stringify({ type: 'typing' }))
}

export const sendMessage = () => {
  const raw = chatInput.value.trim()
  if (!raw || state.ws?.readyState !== WebSocket.OPEN) return
  clearTimeout(typingTimer); typingTimer = null
  const diceResult = parseDiceCommand(raw)
  const text = diceResult ?? raw
  state.ws.send(JSON.stringify({ text, ...(replyTo ? { replyTo } : {}) }))
  chatInput.value = ''
  chatInput.style.height = 'auto'
  clearReply()
  if (dmRooms.find(r => r.id === state.activeChannelId)) {
    fetch(`/api/dm/${state.activeChannelId}/notify`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.token}` }
    }).catch(() => {})
  }
}

const resizeInput = () => {
  chatInput.style.height = 'auto'
  chatInput.style.height = Math.min(chatInput.scrollHeight, 192) + 'px'
}

// — @mention picker —
const mentionPickerEl = document.getElementById('mention-picker')
let mentionStart = -1
let mentionIdx = 0
let mentionResults = []

const hideMentionPicker = () => {
  mentionPickerEl.style.display = 'none'
  mentionResults = []
  mentionStart = -1
}

const renderMentionPicker = (items) => {
  mentionResults = items
  mentionIdx = 0
  mentionPickerEl.innerHTML = ''
  if (!items.length) { hideMentionPicker(); return }
  items.forEach((m, i) => {
    const div = document.createElement('div')
    div.className = `mention-picker-item${i === 0 ? ' active' : ''}`
    div.textContent = '@' + (m.name || m.pubkey.slice(0, 8))
    div.setAttribute('role', 'option')
    div.addEventListener('mousedown', e => { e.preventDefault(); insertMention(i) })
    mentionPickerEl.appendChild(div)
  })
  mentionPickerEl.style.display = 'block'
}

const moveMentionPicker = (dir) => {
  if (!mentionResults.length) return
  mentionPickerEl.children[mentionIdx]?.classList.remove('active')
  mentionIdx = (mentionIdx + dir + mentionResults.length) % mentionResults.length
  mentionPickerEl.children[mentionIdx]?.classList.add('active')
  mentionPickerEl.children[mentionIdx]?.scrollIntoView({ block: 'nearest' })
}

const insertMention = (idx) => {
  const m = mentionResults[idx]
  if (!m) return
  const name = m.name || m.pubkey.slice(0, 8)
  const val = chatInput.value
  const before = val.slice(0, mentionStart)
  const after = val.slice(chatInput.selectionStart)
  chatInput.value = before + '@' + name + ' ' + after
  const newPos = before.length + name.length + 2
  chatInput.setSelectionRange(newPos, newPos)
  hideMentionPicker()
  chatInput.focus()
}

chatInput.addEventListener('input', () => {
  resizeInput()
  const val = chatInput.value
  if (val.trim()) {
    clearTimeout(typingTimer)
    typingTimer = setTimeout(() => { sendTyping(); typingTimer = null }, 400)
  }
  const pos = chatInput.selectionStart
  const before = val.slice(0, pos)

  const atIdx = before.lastIndexOf('@')
  if (atIdx !== -1 && (atIdx === 0 || /\s/.test(val[atIdx - 1])) && !/\s/.test(before.slice(atIdx + 1))) {
    const query = before.slice(atIdx + 1).toLowerCase()
    mentionStart = atIdx
    const matches = [...state.allMembers.values()].filter(m => {
      const name = (m.name || m.pubkey.slice(0, 8)).toLowerCase()
      return name.startsWith(query)
    })
    renderMentionPicker(matches)
  } else {
    hideMentionPicker()
  }

  const colonIdx = before.lastIndexOf(':')
  if (colonIdx === -1) { hidePicker(); return }
  const query = before.slice(colonIdx + 1)
  if (query.length < 2 || /\s/.test(query)) { hidePicker(); return }
  const builtIn = searchEmoji(query)
  const q = query.toLowerCase()
  const custom = [...customEmojiMap.entries()]
    .filter(([name]) => name.includes(q))
    .map(([name]) => ({ e: `:${name}:`, name }))
  const results = [...builtIn, ...custom]
  if (!results.length) { hidePicker(); return }
  showPicker(results, chatInput, 'input', null, colonIdx)
})

sendBtn.addEventListener('click', sendMessage)
chatInput.addEventListener('keydown', e => {
  if (mentionPickerEl.style.display !== 'none') {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveMentionPicker(1); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveMentionPicker(-1); return }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && mentionResults.length)) { e.preventDefault(); insertMention(mentionIdx); return }
    if (e.key === 'Escape') { hideMentionPicker(); return }
  }
  if (pickerEl.style.display !== 'none') {
    if (e.key === 'ArrowDown') { e.preventDefault(); movePicker(1); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); movePicker(-1); return }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && pickerResults.length)) { e.preventDefault(); selectPicker(pickerIdx); return }
    if (e.key === 'Escape') { hidePicker(); return }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
})

// — Image upload —
const uploadBtn = document.getElementById('upload-btn')
const fileInput = document.getElementById('file-input')
const chatArea = document.getElementById('chat-area')

const uploadAndInsert = async (file) => {
  if (!file || !file.type.startsWith('image/')) return
  const token = session?.token
  if (!token) return
  const msgId = crypto.randomUUID()
  const start = chatInput.selectionStart
  const end = chatInput.selectionEnd
  const before = chatInput.value.slice(0, start)
  const after = chatInput.value.slice(end)
  const placeholder = '![uploading…]()'
  chatInput.value = before + placeholder + after
  chatInput.setSelectionRange(start + placeholder.length, start + placeholder.length)
  resizeInput()
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type, 'X-Message-Id': msgId },
      body: file
    })
    if (!res.ok) { chatInput.value = before + after; resizeInput(); return }
    const { url } = await res.json()
    const md = `![](${url})`
    const current = chatInput.value
    const placeholderIdx = current.indexOf(placeholder)
    if (placeholderIdx !== -1) {
      chatInput.value = current.slice(0, placeholderIdx) + md + current.slice(placeholderIdx + placeholder.length)
      chatInput.setSelectionRange(placeholderIdx + md.length, placeholderIdx + md.length)
    } else {
      chatInput.value = current + md
    }
    resizeInput()
    chatInput.focus()
  } catch {
    chatInput.value = before + after
    resizeInput()
  }
}

uploadBtn.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (file) uploadAndInsert(file)
})

chatInput.addEventListener('paste', e => {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      uploadAndInsert(item.getAsFile())
      return
    }
  }
})

let dragCounter = 0
chatArea.addEventListener('dragenter', e => {
  if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) {
    e.preventDefault()
    dragCounter++
    chatArea.classList.add('drag-over')
  }
})
chatArea.addEventListener('dragleave', () => {
  dragCounter--
  if (dragCounter <= 0) { dragCounter = 0; chatArea.classList.remove('drag-over') }
})
chatArea.addEventListener('dragover', e => e.preventDefault())
chatArea.addEventListener('drop', e => {
  e.preventDefault()
  dragCounter = 0
  chatArea.classList.remove('drag-over')
  const file = [...(e.dataTransfer.files || [])].find(f => f.type.startsWith('image/'))
  if (file) uploadAndInsert(file)
})

// — Image lightbox —
const lightbox = document.getElementById('img-lightbox')
const lightboxImg = document.getElementById('img-lightbox-img')
document.addEventListener('click', e => {
  const src = e.target.dataset?.lightbox
  if (src) { lightboxImg.src = src; lightbox.classList.add('open'); return }
  if (e.target === lightbox || e.target === lightboxImg) lightbox.classList.remove('open')
})
document.addEventListener('keydown', e => { if (e.key === 'Escape') lightbox.classList.remove('open') })

// — Voice memo —
const recordBtn = document.getElementById('record-btn')
const recordTimer = document.getElementById('record-timer')
let mediaRec = null; let recChunks = []; let recStart = null; let recTimerInterval = null
let recCtx = null; let recGain = null

const stopRecording = () => {
  if (!mediaRec || mediaRec.state !== 'recording') return
  if (recGain && recCtx) {
    recGain.gain.setTargetAtTime(0, recCtx.currentTime, 0.08)
  }
  setTimeout(() => { if (mediaRec) mediaRec.stop() }, 420)
}

recordBtn.addEventListener('click', async () => {
  if (mediaRec && mediaRec.state === 'recording') {
    stopRecording()
    return
  }

  let rawStream
  try {
    rawStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    return
  }

  recCtx = new AudioContext()
  const src = recCtx.createMediaStreamSource(rawStream)
  recGain = recCtx.createGain()
  recGain.gain.setValueAtTime(0, recCtx.currentTime)
  const dest = recCtx.createMediaStreamDestination()
  src.connect(recGain)
  recGain.connect(dest)

  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
    .find(t => MediaRecorder.isTypeSupported(t)) || ''

  recChunks = []
  mediaRec = new MediaRecorder(dest.stream, mimeType ? { mimeType } : {})

  mediaRec.addEventListener('dataavailable', e => { if (e.data.size) recChunks.push(e.data) })

  mediaRec.addEventListener('start', () => {
    recGain.gain.setTargetAtTime(1, recCtx.currentTime, 0.05)
    recStart = Date.now()
    recordBtn.classList.add('recording')
    recordBtn.title = 'Stop recording'
    recordTimer.style.display = 'inline'
    recordTimer.textContent = '0:00'
    recTimerInterval = setInterval(() => {
      recordTimer.textContent = fmtDuration(Date.now() - recStart)
      if (Date.now() - recStart >= 4.2 * 60 * 1000) stopRecording()
    }, 500)
  })

  mediaRec.addEventListener('stop', async () => {
    clearInterval(recTimerInterval)
    recordBtn.classList.remove('recording')
    recordBtn.title = 'Voice memo'
    recordTimer.style.display = 'none'
    rawStream.getTracks().forEach(t => t.stop())
    try { recCtx.close() } catch {}
    recCtx = null; recGain = null; mediaRec = null

    const blob = new Blob(recChunks, { type: mimeType.split(';')[0] || 'audio/webm' })
    recChunks = []
    if (blob.size < 1000) return

    const token = session?.token
    if (!token) return
    const msgId = crypto.randomUUID()
    recordBtn.disabled = true
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type, 'X-Message-Id': msgId },
        body: blob
      })
      if (!res.ok) return
      const { url } = await res.json()
      if (state.ws?.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'message', text: url, id: msgId }))
      }
    } catch {} finally {
      recordBtn.disabled = false
    }
  })

  mediaRec.start()
})

// mirror disabled state onto upload + record buttons
new MutationObserver(() => {
  uploadBtn.disabled = chatInput.disabled
  recordBtn.disabled = chatInput.disabled
}).observe(chatInput, { attributes: true, attributeFilter: ['disabled'] })

// — Search —
const searchBar = document.getElementById('search-bar')
const searchInput = document.getElementById('search-input')
const searchBtn = document.getElementById('search-btn')
const searchClose = document.getElementById('search-close')
let searchDebounce = null

const openSearch = () => {
  searchBar.classList.add('open')
  searchBtn.style.display = 'none'
  document.getElementById('room-name').style.display = 'none'
  searchInput.focus()
}

export const closeSearch = () => {
  searchBar.classList.remove('open')
  searchBtn.style.display = ''
  document.getElementById('room-name').style.display = ''
  searchInput.value = ''
  clearTimeout(searchDebounce)
  const sr = document.getElementById('search-results')
  if (sr) { sr.remove(); messagesEl.style.display = '' }
}

const runSearch = async (q) => {
  let sr = document.getElementById('search-results')
  if (!q.trim()) {
    if (sr) { sr.remove(); messagesEl.style.display = '' }
    return
  }
  if (!sr) {
    sr = document.createElement('div')
    sr.id = 'search-results'
    sr.className = 'search-results'
    messagesEl.insertAdjacentElement('afterend', sr)
    messagesEl.style.display = 'none'
  }
  sr.innerHTML = '<div class="search-empty">searching...</div>'
  try {
    const res = await fetch(`/api/channel/${state.activeChannelId}/search?q=${encodeURIComponent(q)}`, { headers: sidebarAuth() })
    const results = await res.json()
    sr.innerHTML = ''
    if (!results.length) { sr.innerHTML = '<div class="search-empty">no results</div>'; return }
    for (const m of results) {
      const el = document.createElement('div')
      el.className = 'search-result'
      const highlighted = esc(m.text).replace(new RegExp(esc(q), 'gi'), s => `<mark>${s}</mark>`)
      el.innerHTML = `<div class="search-result-meta">${esc(m.from?.name || 'unknown')} · ${fmtTime(m.ts)}</div><div class="search-result-text">${highlighted}</div>`
      sr.appendChild(el)
    }
  } catch {
    sr.innerHTML = '<div class="search-empty">something went wrong.</div>'
  }
}

searchBtn.addEventListener('click', openSearch)
searchClose.addEventListener('click', closeSearch)
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => runSearch(searchInput.value), 300)
})
searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch() })

// — Notification sound + title —
const playMentionSound = () => {
  try {
    const ctx = new AudioContext()
    const play = (freq, time) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.frequency.value = freq; o.type = 'sine'
      g.gain.setValueAtTime(0, time)
      g.gain.linearRampToValueAtTime(0.25, time + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.4)
      o.start(time); o.stop(time + 0.4)
    }
    const t = ctx.currentTime
    play(420, t); play(660, t + 0.1)
  } catch {}
}

let titleUnread = 0
const updateTitle = () => { document.title = titleUnread > 0 ? `(${titleUnread}) speakEZ` : (localStorage.getItem('workspaceName') || 'speakEZ') }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { titleUnread = 0; updateTitle() } })

const notifyIfNeeded = (from, text, replyTo) => {
  if (from.pubkey === session.pubkey) return
  const myName = localStorage.getItem('name')
  const mentioned = (myName && text.toLowerCase().includes('@' + myName.toLowerCase())) ||
                    text.includes('@' + session.pubkey.slice(0, 8))
  const replied = replyTo?.from?.pubkey === session.pubkey
  if (!mentioned && !replied) return
  playMentionSound()
  if (document.hidden) { titleUnread++; updateTitle() }
}
