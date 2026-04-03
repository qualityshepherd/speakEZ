import { searchEmoji } from './lib/emoji.js'
import { parseDiceCommand } from './lib/dice.js'
import { state, session } from './state.js'
import { dmRooms } from './sidebar.js'
import { customEmojiMap } from './text-utils.js'
import { clearReply, getReplyTo } from './message-render.js'

export const chatInput = document.getElementById('chat-input')
export const sendBtn = document.getElementById('send')

export const resizeInput = () => {
  chatInput.style.height = 'auto'
  chatInput.style.height = Math.min(chatInput.scrollHeight, 192) + 'px'
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
  const replyTo = getReplyTo()
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

export const showReactInput = (msgId, msgEl) => {
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
