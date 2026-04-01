import { state, session } from './state.js'
import { esc } from './utils.js'
// voice and chat imported at bottom to handle circular refs at eval time
import * as voice from './voice.js'
import * as chat from './chat.js'

export const voiceIcon = '<svg viewBox="0 0 24 24" width="1.3em" height="1.3em" fill="currentColor" style="display:block"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>'

export let sidebarData = { categories: [], channels: [{ id: 'general', name: 'general', type: 'text', category: null }] }
export let dmRooms = []
export const collapsed = new Set()
export const unreadChannels = new Set()

const sidebarEl = document.getElementById('sidebar')
const backdrop = document.getElementById('sidebar-backdrop')
const hamburger = document.getElementById('hamburger')

export const openSidebar = () => { sidebarEl.classList.add('open'); backdrop.classList.add('open') }
export const closeSidebar = () => { sidebarEl.classList.remove('open'); backdrop.classList.remove('open') }

hamburger.addEventListener('click', openSidebar)
backdrop.addEventListener('click', closeSidebar)

export const sidebarAuth = () => ({ Authorization: `Bearer ${session.token}` })

// — Context menu —
const ctxMenu = document.getElementById('ctx-menu')

export const showCtx = (e, items) => {
  e.preventDefault()
  ctxMenu.innerHTML = ''
  for (const { label, action, danger, disabled } of items) {
    const btn = document.createElement('button')
    btn.className = `ctx-item${danger ? ' danger' : ''}`
    btn.setAttribute('role', 'menuitem')
    btn.textContent = label
    btn.disabled = !!disabled
    btn.addEventListener('click', () => { hideCtx(); action() })
    ctxMenu.appendChild(btn)
  }
  ctxMenu.style.display = 'block'
  const x = Math.min(e.clientX, window.innerWidth - 160)
  const y = Math.min(e.clientY, window.innerHeight - ctxMenu.offsetHeight - 8)
  ctxMenu.style.left = x + 'px'
  ctxMenu.style.top = y + 'px'
}

const hideCtx = () => { ctxMenu.style.display = 'none' }
document.addEventListener('click', hideCtx)
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx() })

// — API helpers —
export const apiPatch = async (path, body) => {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...sidebarAuth() },
    body: JSON.stringify(body)
  })
  if (res.ok) { sidebarData = await res.json(); renderSidebar() }
}

export const apiDelete = async (path) => {
  const res = await fetch(path, { method: 'DELETE', headers: sidebarAuth() })
  if (res.ok) { sidebarData = await res.json(); renderSidebar() }
}

export const apiPost = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sidebarAuth() },
    body: JSON.stringify(body)
  })
  if (res.ok) { sidebarData = await res.json(); renderSidebar() }
  return res
}

// — Unread —
export const refreshUnread = async () => {
  const roomIds = [
    ...sidebarData.channels.filter(c => c.type === 'text' && c.id !== state.activeChannelId).map(c => c.id),
    ...dmRooms.filter(r => r.id !== state.activeChannelId).map(r => r.id)
  ]
  for (const roomId of roomIds) {
    try {
      const res = await fetch(`/api/channel/${roomId}/last`, { headers: sidebarAuth() })
      if (!res.ok) continue
      const { ts } = await res.json()
      if (ts && ts > (state.reads[roomId] || 0)) unreadChannels.add(roomId)
      else unreadChannels.delete(roomId)
    } catch {}
  }
  renderSidebar()
}

export const loadSidebar = async () => {
  try {
    const [sidebarRes, dmRes] = await Promise.all([
      fetch('/api/sidebar', { headers: sidebarAuth() }),
      fetch('/api/dm', { headers: sidebarAuth() })
    ])
    if (sidebarRes.ok) sidebarData = await sidebarRes.json()
    if (dmRes.ok) dmRooms = await dmRes.json()
  } catch {}
  renderSidebar()
  refreshUnread()
  const activeCh = sidebarData.channels.find(c => c.id === state.activeChannelId)
  if (activeCh) {
    document.getElementById('room-prefix').textContent = '#'
    document.getElementById('room-name').textContent = activeCh.name
    setRoomDesc(activeCh.description || '')
  }
}

export const renderSidebar = () => {
  const nav = document.getElementById('sidebar-nav')
  nav.innerHTML = ''

  for (const ch of sidebarData.channels.filter(c => !c.category)) {
    nav.appendChild(makeChannel(ch))
  }

  for (const cat of sidebarData.categories) {
    const isCollapsed = collapsed.has(cat.id)
    const wrap = document.createElement('div')
    wrap.className = 'category'

    const header = document.createElement('div')
    header.className = 'category-header'
    header.innerHTML = `
      <span class="category-chevron${isCollapsed ? ' collapsed' : ''}">▾</span>
      <span class="category-name">${esc(cat.name)}</span>
      ${state.isAdmin ? '<button class="category-add" title="add channel">+</button>' : ''}
      ${state.isAdmin ? '<button class="category-del" title="delete category">×</button>' : ''}`

    header.querySelector('.category-add')?.addEventListener('click', async e => {
      e.stopPropagation()
      const name = prompt('channel name')?.trim()
      if (!name) return
      const type = confirm('voice channel? (cancel = text)') ? 'voice' : 'text'
      await apiPost('/api/sidebar/channel', { name, type, category: cat.id })
    })

    header.addEventListener('click', async e => {
      if (e.target.classList.contains('category-add')) return
      if (e.target.classList.contains('category-del')) {
        e.stopPropagation()
        if (!confirm(`delete "${cat.name}"? channels will move to uncategorized.`)) return
        await apiDelete(`/api/sidebar/category/${cat.id}`)
        return
      }
      if (isCollapsed) collapsed.delete(cat.id)
      else collapsed.add(cat.id)
      renderSidebar()
    })

    if (state.isAdmin) {
      header.addEventListener('contextmenu', e => showCtx(e, [
        {
          label: 'Rename',
          action: async () => {
            const name = prompt('new name', cat.name)?.trim()
            if (name && name !== cat.name) await apiPatch(`/api/sidebar/category/${cat.id}`, { name })
          }
        },
        {
          label: 'Delete',
          danger: true,
          action: async () => {
            if (!confirm(`delete "${cat.name}"? channels will move to uncategorized.`)) return
            await apiDelete(`/api/sidebar/category/${cat.id}`)
          }
        }
      ]))
    }

    wrap.appendChild(header)

    if (!isCollapsed) {
      for (const ch of sidebarData.channels.filter(c => c.category === cat.id)) {
        wrap.appendChild(makeChannel(ch))
      }
    }

    nav.appendChild(wrap)
  }

  // DMs section
  {
    const dmSection = document.createElement('div')
    dmSection.className = 'category'
    const dmHeader = document.createElement('div')
    dmHeader.className = 'category-header'
    dmHeader.innerHTML = '<span class="category-name">DIRECT MESSAGES</span><button class="category-add" title="new private room">+</button>'
    dmHeader.querySelector('.category-add').addEventListener('click', async e => {
      e.stopPropagation()
      const name = prompt('Room name (optional — you can invite people once you\'re in):')?.trim()
      if (name === null) return
      const res = await fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sidebarAuth() },
        body: JSON.stringify({ members: [], name: name || null })
      })
      if (!res.ok) return
      const room = await res.json()
      if (!dmRooms.find(r => r.id === room.id)) dmRooms.push(room)
      renderSidebar()
      switchChannel(room.id)
    })
    dmSection.appendChild(dmHeader)
    for (const room of dmRooms) dmSection.appendChild(makeDmItem(room))
    nav.appendChild(dmSection)
  }
}

export const makeDmItem = (room) => {
  const el = document.createElement('div')
  el.className = `channel-item${room.id === state.activeChannelId ? ' active' : ''}`
  const other = room.members.find(p => p !== session?.pubkey)
  const displayName = room.name || (other ? (state.allMembers.get(other)?.name || other.slice(0, 8)) : 'DM')
  const unread = unreadChannels.has(room.id) ? '<span class="channel-unread" aria-label="unread messages"></span>' : ''
  el.innerHTML = `<span class="channel-icon" style="font-style:normal">@</span><span class="channel-name">${esc(displayName)}</span>${unread}<button class="channel-del dm-leave-btn" title="Leave DM"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 2 0 00-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z"/></svg></button>`
  el.addEventListener('click', e => {
    if (e.target.classList.contains('channel-del')) return
    switchChannel(room.id)
  })
  el.querySelector('.channel-del').addEventListener('click', async e => {
    e.stopPropagation()
    if (room.id === state.activeChannelId) switchChannel('general')
    await fetch(`/api/dm/${room.id}`, { method: 'DELETE', headers: sidebarAuth() })
    dmRooms = dmRooms.filter(r => r.id !== room.id)
    renderSidebar()
  })
  return el
}

export const makeChannel = (ch) => {
  const el = document.createElement('div')
  el.className = `channel-item${ch.type === 'voice' ? ' voice' : ''}${ch.id === state.activeChannelId ? ' active' : ''}`
  const icon = ch.type === 'voice'
    ? `<span class="channel-icon">${voiceIcon}</span>`
    : '<span class="channel-icon">#</span>'
  const del = state.isAdmin && ch.id !== 'general' ? '<button class="channel-del" title="delete">×</button>' : ''
  const unread = unreadChannels.has(ch.id) ? '<span class="channel-unread" aria-label="unread messages"></span>' : ''
  el.innerHTML = `${icon}<span class="channel-name">${esc(ch.name)}</span>${unread}${del}`
  if (ch.type === 'voice') {
    const membersSpan = document.createElement('span')
    membersSpan.className = 'voice-members'
    if (state.activeVoiceChannel === ch.id) membersSpan.textContent = `${voice.voiceMembers.size + 1}`
    el.querySelector('.channel-name').after(membersSpan)
    el.classList.toggle('active', state.activeVoiceChannel === ch.id)
    el.addEventListener('click', e => {
      if (e.target.classList.contains('channel-del')) return
      voice.joinVoice(ch.id)
    })
  } else {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('channel-del')) return
      switchChannel(ch.id)
    })
  }
  el.querySelector('.channel-del')?.addEventListener('click', async e => {
    e.stopPropagation()
    if (!confirm(`delete #${ch.name}?`)) return
    if (ch.id === state.activeChannelId) switchChannel('general')
    await apiDelete(`/api/sidebar/channel/${ch.id}`)
  })
  if (state.isAdmin) {
    el.addEventListener('contextmenu', e => showCtx(e, [
      {
        label: 'Rename',
        action: async () => {
          const name = prompt('new name', ch.name)?.trim()
          if (name && name !== ch.name) await apiPatch(`/api/sidebar/channel/${ch.id}`, { name })
        }
      },
      {
        label: 'Delete',
        danger: true,
        disabled: ch.id === 'general',
        action: async () => {
          if (!confirm(`delete #${ch.name}?`)) return
          if (ch.id === state.activeChannelId) switchChannel('general')
          await apiDelete(`/api/sidebar/channel/${ch.id}`)
        }
      }
    ]))
  }
  return el
}

const roomDescEl = document.getElementById('room-desc')

export const setRoomDesc = (desc, editable) => {
  if (!roomDescEl) return
  roomDescEl.textContent = desc || ''
  const canEdit = editable !== undefined ? editable : state.isAdmin
  roomDescEl.classList.toggle('admin-editable', canEdit)
}

const DM_DESC_PLACEHOLDER = '@ someone to invite them, or use this as your private room'

roomDescEl?.addEventListener('click', () => {
  const ch = sidebarData.channels.find(c => c.id === state.activeChannelId)
  const dm = dmRooms.find(r => r.id === state.activeChannelId)
  if (!ch && !dm) return
  if (ch && !state.isAdmin) return
  const current = ch ? (ch.description || '') : (dm.description || '')
  const input = document.createElement('input')
  input.type = 'text'
  input.value = current
  input.maxLength = 160
  input.placeholder = ch ? 'channel description...' : DM_DESC_PLACEHOLDER
  input.style.cssText = 'font:inherit;font-size:inherit;color:var(--muted);background:none;border:none;border-bottom:1px solid var(--border);outline:none;width:100%;padding:0'
  roomDescEl.replaceWith(input)
  input.focus(); input.select()
  let committed = false
  const commit = async () => {
    if (committed) return
    committed = true
    const val = input.value.trim()
    input.replaceWith(roomDescEl)
    if (val === current) return
    if (ch) {
      await apiPatch(`/api/sidebar/channel/${ch.id}`, { description: val })
      ch.description = val
    } else {
      const res = await fetch(`/api/dm/${dm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...sidebarAuth() },
        body: JSON.stringify({ description: val })
      })
      if (res.ok) dm.description = val
    }
    setRoomDesc(val || (dm ? DM_DESC_PLACEHOLDER : ''))
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    else if (e.key === 'Escape') { committed = true; input.replaceWith(roomDescEl) }
  })
  input.addEventListener('blur', commit)
})

export const switchChannel = (id) => {
  if (id === state.activeChannelId) return
  closeSidebar()
  state.activeChannelId = id
  unreadChannels.delete(id)
  const ch = sidebarData.channels.find(c => c.id === id)
  const dm = dmRooms.find(r => r.id === id)
  const dmName = dm
    ? (dm.name || (() => {
        const other = dm.members.find(p => p !== session?.pubkey)
        return other ? (state.allMembers.get(other)?.name || other.slice(0, 8)) : 'DM'
      })())
    : null
  document.getElementById('room-prefix').textContent = dm ? '@' : '#'
  document.getElementById('room-name').textContent = ch?.name || dmName || id
  setRoomDesc(dm ? (dm.description || DM_DESC_PLACEHOLDER) : (ch?.description || ''), !!dm || state.isAdmin)
  chat.closeSearch()
  document.getElementById('messages').innerHTML = ''
  renderSidebar()
  chat.connect(id)
}

document.getElementById('add-category').addEventListener('click', async () => {
  const name = prompt('category name')?.trim()
  if (!name) return
  await apiPost('/api/sidebar/category', { name })
})

document.getElementById('add-channel').addEventListener('click', async () => {
  const name = prompt('channel name')?.trim()
  if (!name) return
  const type = confirm('voice channel? (cancel = text)') ? 'voice' : 'text'
  await apiPost('/api/sidebar/channel', { name, type, category: null })
})
