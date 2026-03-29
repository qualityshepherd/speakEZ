import { searchEmoji } from '../../../../../lib/emoji.js'
import { parseDiceCommand } from '../../../../../lib/dice.js'

marked.use({ gfm: true, breaks: true })

const session = JSON.parse(localStorage.getItem('session') || 'null')
if (!session) { location.href = '/login.html'; throw new Error() }

const avatarImgSm = document.getElementById('avatar-img-sm')
const avatarPlaceholderSm = document.getElementById('avatar-placeholder-sm')
const meBtn = document.getElementById('me-btn')
const modal = document.getElementById('me-modal')
const modalAvatarImg = document.getElementById('modal-avatar-img')
const modalAvatarPlaceholder = document.getElementById('modal-avatar-placeholder')
const modalAvatarEl = document.getElementById('modal-avatar')
const modalNameEl = document.getElementById('modal-name')
const modalPubkey = document.getElementById('modal-pubkey')
const modalCopy = document.getElementById('modal-copy')
const modalSave = document.getElementById('modal-save')
const modalLogout = document.getElementById('modal-logout')
const modalMsg = document.getElementById('modal-msg')

const initial = (n) => n ? n.trim()[0].toUpperCase() : '?'

const setMsg = (text, type = 'muted') => {
  modalMsg.className = `modal-msg ${type}`
  modalMsg.textContent = text
}

const refreshHeader = () => {
  const name = localStorage.getItem('name')
  const avatar = localStorage.getItem('avatar')
  meBtn.textContent = name || 'me'
  avatarPlaceholderSm.textContent = initial(name)
  avatarPlaceholderSm.style.background = avatarColor(session.pubkey)
  if (avatar) {
    avatarImgSm.src = avatar
    avatarImgSm.style.display = 'block'
    avatarPlaceholderSm.style.display = 'none'
    avatarImgSm.onerror = () => {
      avatarImgSm.style.display = 'none'
      avatarPlaceholderSm.style.display = 'flex'
    }
  } else {
    avatarImgSm.style.display = 'none'
    avatarPlaceholderSm.style.display = 'flex'
  }
}

const updateModalAvatar = (url) => {
  modalAvatarPlaceholder.textContent = initial(modalNameEl.value)
  if (url) {
    modalAvatarImg.src = url
    modalAvatarImg.style.display = 'block'
    modalAvatarPlaceholder.style.display = 'none'
    modalAvatarImg.onerror = () => {
      modalAvatarImg.style.display = 'none'
      modalAvatarPlaceholder.style.display = 'flex'
    }
  } else {
    modalAvatarImg.style.display = 'none'
    modalAvatarPlaceholder.style.display = 'flex'
  }
}

const openModal = () => {
  modalNameEl.value = localStorage.getItem('name') || ''
  modalAvatarEl.value = localStorage.getItem('avatar') || ''
  modalPubkey.textContent = session.pubkey || '—'
  modalMsg.textContent = ''
  updateModalAvatar(modalAvatarEl.value)
  modal.style.display = 'flex'
  modalNameEl.focus()
  if (typeof refreshNotifyUI === 'function') refreshNotifyUI()
}

const closeModal = () => { modal.style.display = 'none' }

meBtn.addEventListener('click', openModal)
document.getElementById('me-close').addEventListener('click', closeModal)
modal.addEventListener('click', e => { if (e.target === modal) closeModal() })
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.style.display !== 'none') closeModal() })

modalAvatarEl.addEventListener('input', () => updateModalAvatar(modalAvatarEl.value))
modalNameEl.addEventListener('input', () => { modalAvatarPlaceholder.textContent = initial(modalNameEl.value) })

// Avatar drag-and-drop / click upload
const avatarDropTarget = document.getElementById('avatar-drop-target')
const avatarFileInput = document.getElementById('avatar-file-input')

const uploadAvatar = async (file) => {
  if (!file || !file.type.startsWith('image/')) return
  const token = session?.token
  if (!token) return
  setMsg('uploading...', 'muted')
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type },
      body: file
    })
    if (!res.ok) { setMsg('upload failed.', 'danger'); return }
    const { url } = await res.json()
    modalAvatarEl.value = url
    updateModalAvatar(url)
    setMsg('')
  } catch { setMsg('upload failed.', 'danger') }
}

avatarDropTarget.addEventListener('click', () => avatarFileInput.click())
avatarFileInput.addEventListener('change', () => {
  const file = avatarFileInput.files?.[0]
  avatarFileInput.value = ''
  if (file) uploadAvatar(file)
})
avatarDropTarget.addEventListener('dragover', e => { e.preventDefault(); avatarDropTarget.classList.add('drag-over') })
avatarDropTarget.addEventListener('dragleave', e => { if (!avatarDropTarget.contains(e.relatedTarget)) avatarDropTarget.classList.remove('drag-over') })
avatarDropTarget.addEventListener('drop', e => {
  e.preventDefault()
  avatarDropTarget.classList.remove('drag-over')
  const file = e.dataTransfer.files?.[0]
  if (file) uploadAvatar(file)
})

modalCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(session.pubkey || '').then(() => {
    modalCopy.textContent = 'copied!'
    setTimeout(() => { modalCopy.textContent = 'copy' }, 1500)
  })
})

modalSave.addEventListener('click', async () => {
  const name = modalNameEl.value.trim()
  const avatar = modalAvatarEl.value.trim()
  modalSave.disabled = true
  setMsg('saving...')
  try {
    const res = await fetch('/api/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ name: name || null, avatar: avatar || null })
    })
    if (res.status === 401) { location.href = '/login.html'; return }
    if (!res.ok) { setMsg('something went wrong.', 'danger'); modalSave.disabled = false; return }
    if (name) localStorage.setItem('name', name)
    else localStorage.removeItem('name')
    if (avatar) localStorage.setItem('avatar', avatar)
    else localStorage.removeItem('avatar')
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'profile', name: name || null, avatar: avatar || null }))
    refreshHeader()
    setMsg('saved.', 'ok')
  } catch {
    setMsg('something went wrong.', 'danger')
  }
  modalSave.disabled = false
})

modalLogout.addEventListener('click', () => {
  localStorage.clear()
  location.href = '/login.html'
})

// — Push notifications —
const notifyField = document.getElementById('notify-field')
const notifyBox = document.getElementById('modal-notify')
const notifyMsg = document.getElementById('notify-msg')
let swReg = null
let vapidPublicKey = null

const initServiceWorker = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  try {
    swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    const res = await fetch('/api/push/key', { headers: { Authorization: `Bearer ${session.token}` } })
    if (res.ok) vapidPublicKey = (await res.json()).publicKey
    else notifyField.style.display = 'none'
  } catch {}
}

const urlB64toUint8 = str => {
  const b = (str + '==='.slice((str.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b), c => c.charCodeAt(0))
}

const refreshNotifyUI = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  if (!vapidPublicKey) return
  notifyField.style.display = ''
  const perm = Notification.permission
  if (perm === 'denied') {
    notifyBox.checked = false
    notifyBox.disabled = true
    notifyMsg.textContent = 'notifications blocked in browser settings'
    return
  }
  notifyBox.disabled = false
  if (!swReg) return
  const sub = await swReg.pushManager.getSubscription()
  notifyBox.checked = !!sub
}

const subscribe = async () => {
  if (!swReg || !vapidPublicKey) return
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') { await refreshNotifyUI(); return }
  try {
    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64toUint8(vapidPublicKey)
    })
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify(sub.toJSON())
    })
    notifyMsg.textContent = ''
  } catch { notifyMsg.textContent = 'subscription failed'; notifyBox.checked = false }
}

const unsubscribe = async () => {
  if (!swReg) return
  const sub = await swReg.pushManager.getSubscription()
  if (sub) {
    await sub.unsubscribe()
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}` }
    }).catch(() => {})
  }
}

notifyBox.addEventListener('change', async () => {
  notifyBox.disabled = true
  notifyBox.checked ? await subscribe() : await unsubscribe()
  await refreshNotifyUI()
})

initServiceWorker()

// — Mobile sidebar —
const sidebar = document.getElementById('sidebar')
const backdrop = document.getElementById('sidebar-backdrop')
const hamburger = document.getElementById('hamburger')

const openSidebar = () => { sidebar.classList.add('open'); backdrop.classList.add('open') }
const closeSidebar = () => { sidebar.classList.remove('open'); backdrop.classList.remove('open') }

hamburger.addEventListener('click', openSidebar)
backdrop.addEventListener('click', closeSidebar)

// — Invite modal —
const inviteModal = document.getElementById('invite-modal')
const inviteList = document.getElementById('invite-list')
const inviteModalMsg = document.getElementById('invite-modal-msg')

const setInviteMsg = (text, type = 'muted') => {
  inviteModalMsg.className = `invite-modal-msg ${type}`
  inviteModalMsg.textContent = text
}

const fmtExpiry = (expires) => {
  const diff = expires - Date.now()
  if (diff <= 0) return 'expired'
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'expires < 1h'
  if (h < 24) return `expires in ${h}h`
  return `expires in ${Math.floor(h / 24)}d`
}

const renderInviteList = (invites) => {
  inviteList.innerHTML = ''
  const fresh = invites.filter(i => i.status === 'fresh')
  const rest = invites.filter(i => i.status !== 'fresh')
  const all = [...fresh, ...rest]
  if (!all.length) {
    inviteList.innerHTML = '<div class="invite-empty">no invites yet</div>'
    return
  }
  for (const invite of all) {
    const link = `${location.origin}/invite.html?code=${invite.code}`
    const row = document.createElement('div')
    row.className = 'invite-row'
    const statusLabel = invite.status === 'fresh'
      ? `<span class="invite-meta invite-status-fresh">${fmtExpiry(invite.expires)}</span>`
      : invite.status === 'used'
        ? '<span class="invite-meta invite-status-used">used</span>'
        : '<span class="invite-meta invite-status-expired">expired</span>'
    row.innerHTML = `
      <span class="invite-code">${esc(invite.code.split('_')[1] ?? invite.code)}</span>
      ${statusLabel}
      ${invite.status === 'fresh' ? '<button class="invite-copy-btn" aria-label="Copy invite link">copy</button>' : ''}
      <button class="invite-del-btn" aria-label="Delete invite">×</button>
    `
    if (invite.status === 'fresh') {
      row.querySelector('.invite-copy-btn').addEventListener('click', (e) => {
        navigator.clipboard.writeText(link).then(() => {
          e.target.textContent = 'copied!'
          setTimeout(() => { e.target.textContent = 'copy' }, 1500)
        })
      })
    }
    row.querySelector('.invite-del-btn').addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/invite/${invite.code}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.token}` }
        })
        if (res.status === 401) { location.href = '/login.html'; return }
        row.remove()
        if (!inviteList.querySelector('.invite-row')) {
          inviteList.innerHTML = '<div class="invite-empty">no invites yet</div>'
        }
      } catch {
        setInviteMsg('failed to delete.', 'danger')
      }
    })
    inviteList.appendChild(row)
  }
}

let cachedInvites = []

const loadInvites = async () => {
  try {
    const res = await fetch('/api/invite', { headers: { Authorization: `Bearer ${session.token}` } })
    if (res.status === 401) { location.href = '/login.html'; return }
    if (!res.ok) { setInviteMsg('failed to load invites.', 'danger'); return }
    cachedInvites = await res.json()
    renderInviteList(cachedInvites)
  } catch {
    setInviteMsg('something went wrong.', 'danger')
  }
}

const openInviteModal = async () => {
  inviteList.innerHTML = ''
  inviteModalMsg.textContent = ''
  inviteModal.style.display = 'flex'
  await loadInvites()
}

const closeInviteModal = () => { inviteModal.style.display = 'none' }

const logoBtn = document.getElementById('logo-btn')
const logoMenu = document.getElementById('logo-menu')
const closeLogoMenu = () => { logoMenu.style.display = 'none'; logoBtn.setAttribute('aria-expanded', 'false') }
logoBtn.addEventListener('click', e => {
  e.stopPropagation()
  const open = logoMenu.style.display !== 'none'
  if (open) { closeLogoMenu() } else { logoMenu.style.display = 'block'; logoBtn.setAttribute('aria-expanded', 'true') }
})
document.getElementById('logo-menu-rename').addEventListener('click', () => {
  closeLogoMenu()
  const current = logoBtn.textContent
  const input = document.createElement('input')
  input.value = current
  input.style.cssText = 'font:inherit;font-weight:600;color:var(--accent);background:none;border:none;border-bottom:1px solid var(--accent);outline:none;width:8rem;font-size:var(--text-lg);padding:0'
  logoBtn.replaceWith(input)
  input.focus(); input.select()
  const commit = async () => {
    const val = input.value.trim()
    input.replaceWith(logoBtn)
    if (!val || val === current) return
    try {
      const res = await fetch('/api/boot', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ workspaceName: val }) })
      if (res.ok) { logoBtn.textContent = val; document.title = val }
    } catch {}
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { input.replaceWith(logoBtn) } })
  input.addEventListener('blur', commit)
})
document.getElementById('logo-menu-invite').addEventListener('click', () => { closeLogoMenu(); openInviteModal() })
document.addEventListener('click', e => { if (!logoBtn.contains(e.target)) closeLogoMenu() })

document.getElementById('invite-close').addEventListener('click', closeInviteModal)
inviteModal.addEventListener('click', e => { if (e.target === inviteModal) closeInviteModal() })
document.addEventListener('keydown', e => { if (e.key === 'Escape' && inviteModal.style.display !== 'none') closeInviteModal() })

document.getElementById('invite-generate').addEventListener('click', async () => {
  const btn = document.getElementById('invite-generate')
  btn.disabled = true
  setInviteMsg('generating...')
  try {
    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` }
    })
    if (res.status === 401) { location.href = '/login.html'; return }
    if (!res.ok) { setInviteMsg('failed to create invite.', 'danger'); btn.disabled = false; return }
    setInviteMsg('')
    const newInvite = await res.json()
    cachedInvites = [{ ...newInvite, status: 'fresh' }, ...cachedInvites.filter(i => i.code !== newInvite.code)]
    renderInviteList(cachedInvites)
  } catch {
    setInviteMsg('something went wrong.', 'danger')
  }
  btn.disabled = false
})

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

const closeSearch = () => {
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
    const res = await fetch(`/api/channel/${activeChannelId}/search?q=${encodeURIComponent(q)}`, { headers: sidebarAuth() })
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

// — Member profile popover —
let popoverEl = null

const closePopover = () => { popoverEl?.remove(); popoverEl = null }

const showMemberPopover = (member, anchorEl) => {
  closePopover()
  popoverEl = document.createElement('div')
  popoverEl.className = 'member-popover'
  const color = avatarColor(member.pubkey)
  const avatarHtml = member.avatar
    ? `<img class="member-popover-avatar" src="${esc(member.avatar)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : ''
  const canKick = isAdmin && member.pubkey !== session.pubkey
  const canDm = member.pubkey !== session.pubkey
  const dmIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>'
  popoverEl.innerHTML = `
    ${avatarHtml}
    <div class="member-popover-placeholder" style="background:${color};${member.avatar ? 'display:none' : ''}">${esc((member.name || '?')[0].toUpperCase())}</div>
    <div class="member-popover-name">${esc(member.name || 'unknown')}</div>
    <div class="member-popover-key" title="click to copy">${esc(member.pubkey)}</div>
    <div class="member-popover-actions">
      ${canDm ? `<button class="member-popover-action member-popover-dm" title="Message">${dmIcon}</button>` : ''}
      ${canKick ? '<button class="member-popover-action member-popover-kick" title="Kick" style="color:#CC0000"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M2 22L2 14L6 10L19 2C21 0 24 2 22 6L14 15L18 15L18 21Q18 23 16 23L4 23Q2 23 2 22Z"/></svg></button>' : ''}
    </div>`

  popoverEl.querySelector('.member-popover-key').addEventListener('click', () => {
    navigator.clipboard.writeText(member.pubkey).then(() => {
      popoverEl.querySelector('.member-popover-key').textContent = 'copied!'
      setTimeout(closePopover, 1200)
    })
  })

  popoverEl.querySelector('.member-popover-dm')?.addEventListener('click', async () => {
    closePopover()
    try {
      const res = await fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ members: [member.pubkey] })
      })
      if (!res.ok) return
      const room = await res.json()
      if (!dmRooms.find(r => r.id === room.id)) dmRooms.push(room)
      switchChannel(room.id)
      renderSidebar()
    } catch {}
  })

  if (canKick) {
    popoverEl.querySelector('.member-popover-kick').addEventListener('click', async () => {
      if (!confirm(`kick ${member.name || member.pubkey.slice(0, 8)}?`)) return
      try {
        const res = await fetch(`/api/kick/${member.pubkey}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.token}` }
        })
        if (res.ok) {
          allMembers.delete(member.pubkey)
          onlineMembers.delete(member.pubkey)
          renderOnline()
          closePopover()
        }
      } catch {}
    })
  }

  document.body.appendChild(popoverEl)

  const rect = anchorEl.getBoundingClientRect()
  const pw = popoverEl.offsetWidth || 220
  let left = rect.right + 8
  if (left + pw > window.innerWidth - 8) left = rect.left - pw - 8
  let top = rect.top
  if (top + popoverEl.offsetHeight + 8 > window.innerHeight) top = window.innerHeight - popoverEl.offsetHeight - 8
  popoverEl.style.left = left + 'px'
  popoverEl.style.top = Math.max(8, top) + 'px'
}

document.addEventListener('click', e => {
  if (popoverEl && !popoverEl.contains(e.target)) closePopover()
})
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopover() })

// — Sidebar —
const voiceIcon = '<svg viewBox="0 0 24 24" width="1.3em" height="1.3em" fill="currentColor" style="display:block"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>'

let sidebarData = { categories: [], channels: [{ id: 'general', name: 'general', type: 'text', category: null }] }
let dmRooms = []

const sidebarAuth = () => ({ Authorization: `Bearer ${session.token}` })

let activeChannelId = 'general'
const collapsed = new Set()
const unreadChannels = new Set()

const refreshUnread = async () => {
  const roomIds = [
    ...sidebarData.channels.filter(c => c.type === 'text' && c.id !== activeChannelId).map(c => c.id),
    ...dmRooms.filter(r => r.id !== activeChannelId).map(r => r.id)
  ]
  for (const roomId of roomIds) {
    try {
      const res = await fetch(`/api/channel/${roomId}/last`, { headers: sidebarAuth() })
      if (!res.ok) continue
      const { ts } = await res.json()
      if (ts && ts > (reads[roomId] || 0)) unreadChannels.add(roomId)
      else unreadChannels.delete(roomId)
    } catch {}
  }
  renderSidebar()
}

const loadSidebar = async () => {
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
  const activeCh = sidebarData.channels.find(c => c.id === activeChannelId)
  if (activeCh) document.getElementById('room-name').textContent = activeCh.name
}

const renderSidebar = () => {
  const nav = document.getElementById('sidebar-nav')
  nav.innerHTML = ''

  // uncategorized channels first
  for (const ch of sidebarData.channels.filter(c => !c.category)) {
    nav.appendChild(makeChannel(ch))
  }

  // categories
  for (const cat of sidebarData.categories) {
    const isCollapsed = collapsed.has(cat.id)
    const wrap = document.createElement('div')
    wrap.className = 'category'

    const header = document.createElement('div')
    header.className = 'category-header'
    header.innerHTML = `
      <span class="category-chevron${isCollapsed ? ' collapsed' : ''}">▾</span>
      <span class="category-name">${esc(cat.name)}</span>
      ${isAdmin ? '<button class="category-add" title="add channel">+</button>' : ''}
      ${isAdmin ? '<button class="category-del" title="delete category">×</button>' : ''}`

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
    if (isAdmin) header.addEventListener('contextmenu', e => showCtx(e, [
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
      if (name === null) return // cancelled
      const res = await apiPost('/api/dm', { members: [], name: name || null })
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

const makeDmItem = (room) => {
  const el = document.createElement('div')
  el.className = `channel-item${room.id === activeChannelId ? ' active' : ''}`
  const other = room.members.find(p => p !== session?.pubkey)
  const displayName = room.name || (other ? (allMembers.get(other)?.name || other.slice(0, 8)) : 'DM')
  const unread = unreadChannels.has(room.id) ? '<span class="channel-unread" aria-label="unread messages"></span>' : ''
  el.innerHTML = `<span class="channel-icon" style="font-style:normal">@</span><span class="channel-name">${esc(displayName)}</span>${unread}<button class="channel-del dm-leave-btn" title="Leave DM"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 2 0 00-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z"/></svg></button>`
  el.addEventListener('click', e => {
    if (e.target.classList.contains('channel-del')) return
    switchChannel(room.id)
  })
  el.querySelector('.channel-del').addEventListener('click', async e => {
    e.stopPropagation()
    if (room.id === activeChannelId) switchChannel('general')
    await fetch(`/api/dm/${room.id}`, { method: 'DELETE', headers: sidebarAuth() })
    dmRooms = dmRooms.filter(r => r.id !== room.id)
    renderSidebar()
  })
  return el
}

// — context menu —
const ctxMenu = document.getElementById('ctx-menu')

const showCtx = (e, items) => {
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

const apiPatch = async (path, body) => {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...sidebarAuth() },
    body: JSON.stringify(body)
  })
  if (res.ok) { sidebarData = await res.json(); renderSidebar() }
}

const apiDelete = async (path) => {
  const res = await fetch(path, { method: 'DELETE', headers: sidebarAuth() })
  if (res.ok) { sidebarData = await res.json(); renderSidebar() }
}

const apiPost = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sidebarAuth() },
    body: JSON.stringify(body)
  })
  if (res.ok) { sidebarData = await res.json(); renderSidebar() }
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

const makeChannel = (ch) => {
  const el = document.createElement('div')
  el.className = `channel-item${ch.type === 'voice' ? ' voice' : ''}${ch.id === activeChannelId ? ' active' : ''}`
  const icon = ch.type === 'voice'
    ? `<span class="channel-icon">${voiceIcon}</span>`
    : '<span class="channel-icon">#</span>'
  const del = isAdmin && ch.id !== 'general' ? '<button class="channel-del" title="delete">×</button>' : ''
  const unread = unreadChannels.has(ch.id) ? '<span class="channel-unread" aria-label="unread messages"></span>' : ''
  el.innerHTML = `${icon}<span class="channel-name">${esc(ch.name)}</span>${unread}${del}`
  if (ch.type === 'voice') {
    const membersSpan = document.createElement('span')
    membersSpan.className = 'voice-members'
    if (activeVoiceChannel === ch.id) membersSpan.textContent = `${voiceMembers.size + 1}`
    el.querySelector('.channel-name').after(membersSpan)
    el.classList.toggle('active', activeVoiceChannel === ch.id)
    el.addEventListener('click', e => {
      if (e.target.classList.contains('channel-del')) return
      joinVoice(ch.id)
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
    if (ch.id === activeChannelId) switchChannel('general')
    await apiDelete(`/api/sidebar/channel/${ch.id}`)
  })
  if (isAdmin) {
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
          if (ch.id === activeChannelId) switchChannel('general')
          await apiDelete(`/api/sidebar/channel/${ch.id}`)
        }
      }
    ]))
  }
  return el
}

const switchChannel = (id) => {
  if (id === activeChannelId) return
  closeSidebar()
  activeChannelId = id
  unreadChannels.delete(id)
  const ch = sidebarData.channels.find(c => c.id === id)
  const dm = dmRooms.find(r => r.id === id)
  const dmName = dm
    ? (dm.name || (() => {
        const other = dm.members.find(p => p !== session?.pubkey)
        return other ? (allMembers.get(other)?.name || other.slice(0, 8)) : 'DM'
      })())
    : null
  document.getElementById('room-name').textContent = ch?.name || dmName || id
  closeSearch()
  messagesEl.innerHTML = ''
  renderSidebar()
  connect(id)
}

// — Emoji picker —
const pickerEl = document.getElementById('emoji-picker')
let pickerResults = []; let pickerIdx = 0; let pickerMode = null; let pickerMsgId = null; let pickerColonPos = -1
let reactInputEl = null

const hidePicker = () => { pickerEl.style.display = 'none'; pickerResults = []; pickerMode = null }

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
  pickerEl.querySelectorAll('.picker-item').forEach((el, i) => { el.classList.toggle('active', i === pickerIdx); el.setAttribute('aria-selected', i === pickerIdx ? 'true' : 'false') })
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
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'react', msgId: pickerMsgId, emoji: e }))
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
let replyTo = null

const setReply = (msg) => {
  replyTo = { id: msg.id, from: msg.from, text: msg.text }
  replyBarText.textContent = `${msg.from.name || msg.from.pubkey.slice(0, 8)}: ${msg.text}`
  replyBar.style.display = 'flex'
  chatInput.focus()
}

const clearReply = () => {
  replyTo = null
  replyBar.style.display = 'none'
}

document.getElementById('reply-cancel').addEventListener('click', clearReply)

// — WebSocket —
const chatInput = document.getElementById('chat-input')
const sendBtn = document.getElementById('send')
const messagesEl = document.getElementById('messages')

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtTime = ts => {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return 'Today at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// deterministic color from pubkey — same person always gets same color
const pubkeyHue = (pubkey) => {
  let hash = 0
  for (let i = 0; i < pubkey.length; i++) hash = (hash * 31 + pubkey.charCodeAt(i)) >>> 0
  return hash % 360
}
const avatarColor = (pubkey) => `hsl(${pubkeyHue(pubkey)}, 45%, 40%)`

let lastPubkey = null
let lastTs = 0
let lastReadTs = 0
let unreadDividerShown = false
let historyHasMore = false
let oldestTs = null
let oldestId = null

const reads = JSON.parse(localStorage.getItem('reads') || '{}')
const saveRead = (channelId, ts) => {
  if (!reads[channelId] || ts > reads[channelId]) {
    reads[channelId] = ts
    localStorage.setItem('reads', JSON.stringify(reads))
  }
}

const onlineMembers = new Map()
const allMembers = new Map()

const fetchBoot = async () => {
  if (!session?.token) return
  try {
    const res = await fetch('/api/boot', { headers: { Authorization: `Bearer ${session.token}` } })
    if (!res.ok) return
    const d = await res.json()
    isAdmin = !!d.isAdmin
    if (d.name) localStorage.setItem('name', d.name)
    else localStorage.removeItem('name')
    if (d.avatar) localStorage.setItem('avatar', d.avatar)
    else localStorage.removeItem('avatar')
    if (d.workspaceName) {
      logoBtn.textContent = d.workspaceName
      document.title = d.workspaceName
    }
    document.getElementById('logo-menu-rename').style.display = isAdmin ? '' : 'none'
    document.getElementById('add-category').style.display = isAdmin ? '' : 'none'
    document.getElementById('add-channel').style.display = isAdmin ? '' : 'none'
    refreshHeader()
    for (const m of (d.members || [])) allMembers.set(m.pubkey, m)
    renderOnline()
  } catch {}
}

const renderOnline = () => {
  const el = document.getElementById('online-list')
  if (!el) return
  el.innerHTML = ''

  const makeMemberRow = (pubkey, member, isOnline) => {
    const { name, avatar } = member
    const row = document.createElement('div')
    row.className = `online-member${isOnline ? '' : ' offline'}`
    const color = avatarColor(pubkey)
    const label = name || pubkey.slice(0, 8)
    const initial = (name || '?')[0].toUpperCase()
    const avatarInner = avatar
      ? `<img class="online-avatar-sm" src="${esc(avatar)}" alt="" onerror="this.outerHTML='<div class=\\'online-avatar-placeholder\\' style=\\'background:${color}\\'>${esc(initial)}</div>'">`
      : `<div class="online-avatar-placeholder" style="background:${color}">${initial}</div>`
    const dot = isOnline ? '<span class="online-dot"></span>' : ''
    row.innerHTML = `<div class="online-avatar-wrap">${avatarInner}${dot}</div><span class="online-member-name">${esc(label)}</span>`
    row.addEventListener('click', e => { e.stopPropagation(); showMemberPopover({ pubkey, name, avatar }, row) })
    return row
  }

  const merged = new Map([...allMembers, ...onlineMembers])
  if (!merged.size) return

  const title = document.createElement('div')
  title.className = 'online-section-title'
  title.textContent = `members — ${onlineMembers.size}/${merged.size}`
  el.appendChild(title)

  for (const [pubkey, member] of merged) {
    const isOnline = onlineMembers.has(pubkey)
    if (isOnline) el.appendChild(makeMemberRow(pubkey, member, true))
  }
  for (const [pubkey, member] of merged) {
    const isOnline = onlineMembers.has(pubkey)
    if (!isOnline) el.appendChild(makeMemberRow(pubkey, member, false))
  }
}

const URL_RE = /https?:\/\/[^\s<>"']+|\/api\/upload\/[^\s<>"']+/g
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|svg)(\?[^\s]*)?$/i
const AUDIO_EXT_RE = /\.(webm|ogg|m4a|mp3|wav)(\?[^\s]*)?$/i
const isImageUrl = u => IMG_EXT_RE.test(u) || (u.startsWith('/api/upload/') && !AUDIO_EXT_RE.test(u))
const isAudioUrl = u => AUDIO_EXT_RE.test(u)

const mentionHtml = (html) =>
  html.replace(/@([\w.-]+)/g, (_, n) => `<span class="mention">@${esc(n)}</span>`)

const customEmojiMap = new Map()
const fetchCustomEmoji = async () => {
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

// Text emoticon → emoji (sorted longest-first to avoid partial matches)
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
// :/ and :-/ should not match inside URLs (://)
const EMOTICON_RE = new RegExp(
  '(^|[\\s(\'"])(' + EMOTICONS.map(([k]) => escRe(k) + (k === ':/' || k === ':-/' ? '(?!/)' : '')).join('|') + ')(?=[\\s.,!?;:\'"]|$)',
  'gm'
)
const replaceEmoticons = (text) => {
  // Protect code spans and URLs from replacement
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

// Convert bare image URLs to markdown image syntax before marked processes them
const preprocess = (text) => {
  const withEmoticons = replaceEmoticons(text)
  return withEmoticons.replace(URL_RE, (url, offset) => {
    // Skip URLs already inside markdown image/link syntax: ![]( or [](
    if (/\]\($/.test(withEmoticons.slice(0, offset))) return url
    if (isImageUrl(url)) return `![](${url})`
    if (isAudioUrl(url)) return `[audio](${url})`
    return url
  })
}

// Post-process marked output: add classes/attrs to links and images
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
  for (const url of urls.slice(0, 1)) { // one preview per message
    try {
      let og = ogCache.get(url)
      if (!og) {
        const res = await fetch(`/api/og?url=${encodeURIComponent(url)}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
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

const renderMessage = ({ id, from, text, ts, replyTo: msgReplyTo }) => {
  if (id && document.querySelector(`[data-id="${CSS.escape(id)}"]`)) {
    if (!oldestTs || ts < oldestTs || (ts === oldestTs && id < oldestId)) { oldestTs = ts; oldestId = id }
    return
  }
  clearTimeout(pendingEmptyTimer)
  const empty = messagesEl.querySelector('.empty')
  if (empty) empty.remove()

  if (!unreadDividerShown && lastReadTs > 0 && ts > lastReadTs) {
    unreadDividerShown = true
    const div = document.createElement('div')
    div.className = 'unread-divider'
    div.textContent = 'new'
    messagesEl.appendChild(div)
  }
  saveRead(activeChannelId, ts)

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
    const avatarSrc = isDice ? '/images/dice/6.svg' : (allMembers.get(from.pubkey)?.avatar || from.avatar || null)
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
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); target.style.outline = '1px solid var(--accent)'; setTimeout(() => { target.style.outline = '' }, 1200) }
  })

  if (id) bindMessageActions(el, id, from, text, ts, isOwn)

  messagesEl.appendChild(el)
  messagesEl.scrollTop = messagesEl.scrollHeight

  if (Date.now() - ts < 10000) notifyIfNeeded(from, text, msgReplyTo)

  // OG preview for non-image URLs
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
    if (!oldestTs || !oldestId || ws?.readyState !== WebSocket.OPEN) return
    btn.disabled = true
    btn.textContent = 'loading...'
    ws.send(JSON.stringify({ type: 'load_history', beforeTs: oldestTs, beforeId: oldestId }))
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
  const currentMember = allMembers.get(from.pubkey)
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
  bindMessageActions(el, id, from, text, ts, isOwn)

  const btn = document.getElementById('load-more-btn')
  btn ? btn.after(el) : messagesEl.prepend(el)
  fetchOGPreviews(el, text)
}

// — Custom audio player —
const SVG_PLAY = '<svg viewBox="0 0 10 10" width="11" height="11" fill="currentColor"><polygon points="1,0.5 9.5,5 1,9.5"/></svg>'
const SVG_PAUSE = '<svg viewBox="0 0 10 10" width="11" height="11" fill="currentColor"><rect x="1" y="0.5" width="3.2" height="9"/><rect x="5.8" y="0.5" width="3.2" height="9"/></svg>'
const audioPlayers = new WeakMap()
const fmtSecs = s => isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00'

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
    // Force visual update — timeupdate doesn't reliably fire when paused
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
document.addEventListener('mousemove', e => {
  if (_scrubActive) _scrubSeek(_scrubActive, e.clientX)
})
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

const SVG_REPLY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>'
const SVG_EDIT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>'
const SVG_DELETE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>'

const bindMessageActions = (el, id, from, text, ts, isOwn) => {
  const avatarCol = el.querySelector('.msg-avatar-col')
  if (avatarCol) {
    avatarCol.style.cursor = 'pointer'
    avatarCol.addEventListener('click', e => {
      e.stopPropagation()
      const member = allMembers.get(from.pubkey) || from
      showMemberPopover(member, avatarCol)
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
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'delete', id }))
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
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'react', msgId: id, emoji }))
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
    actions.appendChild(mkBtn('Delete', SVG_DELETE, 'danger', () => {
      if (!confirmDelete()) return
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'delete', id }))
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
  // auto-size
  const resize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px' }
  ta.addEventListener('input', resize)
  ta.focus()
  ta.setSelectionRange(ta.value.length, ta.value.length)
  resize()
  const commit = () => {
    ta.removeEventListener('blur', commit)
    const newText = ta.value.trim()
    if (newText && newText !== currentText && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'edit', id, text: newText }))
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

const renderReactions = (msgId, reactions) => {
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
    pill.title = pubkeys.map(pk => pk === session?.pubkey ? 'You' : (allMembers.get(pk)?.name || pk.slice(0, 8))).join(', ')
    pill.addEventListener('click', () => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'react', msgId, emoji }))
    })
    pillsEl.appendChild(pill)
  }
  pillsEl.appendChild(makeReactAddBtn(msgId, msgEl))
}

let ws = null
let reconnectTimer = null
let pendingEmptyTimer = null
const isTouchDevice = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches

const connect = (room = activeChannelId) => {
  clearTimeout(reconnectTimer)
  clearTimeout(pendingEmptyTimer)
  if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; if (ws.readyState !== WebSocket.CLOSED) ws.close() }
  const reconnecting = room === activeChannelId && (oldestTs !== null || oldestId !== null)
  lastPubkey = null; lastTs = 0
  lastReadTs = reads[room] || 0
  unreadDividerShown = false
  if (!reconnecting) { historyHasMore = false; oldestTs = null; oldestId = null }
  onlineMembers.clear()
  typingUsers.forEach(u => clearTimeout(u.timer)); typingUsers.clear(); renderTyping()
  pendingEmptyTimer = setTimeout(() => {
    if (!messagesEl.querySelector('[data-id]')) {
      messagesEl.innerHTML = '<div class="empty">nothing here yet.<br>say something.</div>'
    }
  }, 600)
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${proto}//${location.host}/api/ws?token=${encodeURIComponent(session.token)}&room=${encodeURIComponent(room)}`)

  ws.addEventListener('open', () => {
    chatInput.disabled = false
    sendBtn.disabled = false
    if (!isTouchDevice()) chatInput.focus()
    refreshUnread()
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
      else clearInterval(ping)
    }, 30000)
    ws.addEventListener('close', () => clearInterval(ping), { once: true })
  })

  ws.addEventListener('message', e => {
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
        onlineMembers.clear()
        for (const m of (msg.members || [])) if (m.pubkey) { onlineMembers.set(m.pubkey, m); allMembers.set(m.pubkey, m) }
        renderOnline()
      } else if (msg.type === 'join' && msg.from?.pubkey) {
        onlineMembers.set(msg.from.pubkey, msg.from)
        allMembers.set(msg.from.pubkey, msg.from)
        renderOnline()
      } else if (msg.type === 'leave' && msg.pubkey) {
        onlineMembers.delete(msg.pubkey)
        renderOnline()
      } else if (msg.type === 'profile' && msg.pubkey) {
        const updated = { pubkey: msg.pubkey, name: msg.name, avatar: msg.avatar }
        allMembers.set(msg.pubkey, updated)
        if (onlineMembers.has(msg.pubkey)) onlineMembers.set(msg.pubkey, updated)
        renderOnline()
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
        loadSidebar()
      } else if (msg.type === 'history_start') {
        historyHasMore = !!msg.hasMore
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

  ws.addEventListener('close', () => {
    chatInput.disabled = true
    sendBtn.disabled = true
    onlineMembers.clear(); renderOnline()
    typingUsers.forEach(u => clearTimeout(u.timer)); typingUsers.clear(); renderTyping()
    reconnectTimer = setTimeout(() => connect(activeChannelId), 3000)
  })

  ws.addEventListener('error', () => { if (ws.readyState !== WebSocket.CLOSED) ws.close() })
}

// — Typing indicator —
const typingEl = document.getElementById('typing-indicator')
const typingUsers = new Map() // pubkey → {name, timer}

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
  if (ws?.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'typing' }))
}

const sendMessage = () => {
  const raw = chatInput.value.trim()
  if (!raw || ws?.readyState !== WebSocket.OPEN) return
  clearTimeout(typingTimer); typingTimer = null
  const diceResult = parseDiceCommand(raw)
  const text = diceResult ?? raw
  ws.send(JSON.stringify({ text, ...(replyTo ? { replyTo } : {}) }))
  chatInput.value = ''
  chatInput.style.height = 'auto'
  clearReply()
  if (dmRooms.find(r => r.id === activeChannelId)) {
    fetch(`/api/dm/${activeChannelId}/notify`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.token}` }
    }).catch(() => {})
  }
}

const resizeInput = () => {
  chatInput.style.height = 'auto'
  chatInput.style.height = Math.min(chatInput.scrollHeight, 192) + 'px'
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

  // @mention autocomplete
  const atIdx = before.lastIndexOf('@')
  if (atIdx !== -1 && (atIdx === 0 || /\s/.test(val[atIdx - 1])) && !/\s/.test(before.slice(atIdx + 1))) {
    const query = before.slice(atIdx + 1).toLowerCase()
    mentionStart = atIdx
    const matches = [...allMembers.values()].filter(m => {
      const name = (m.name || m.pubkey.slice(0, 8)).toLowerCase()
      return name.startsWith(query)
    })
    renderMentionPicker(matches)
  } else {
    hideMentionPicker()
  }

  // emoji picker
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

// Upload image and insert markdown at cursor (allows mixing with text)
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
    if (!res.ok) {
      chatInput.value = before + after
      resizeInput()
      return
    }
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

// paste image
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

// drag & drop
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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') lightbox.classList.remove('open')
})

// mirror chat input disabled state onto upload button
new MutationObserver(() => {
  uploadBtn.disabled = chatInput.disabled
  recordBtn.disabled = chatInput.disabled
}).observe(chatInput, { attributes: true, attributeFilter: ['disabled'] })

// — Voice memo —
const recordBtn = document.getElementById('record-btn')
const recordTimer = document.getElementById('record-timer')
let mediaRec = null; let recChunks = []; let recStart = null; let recTimerInterval = null
let recCtx = null; let recGain = null

const fmtDuration = (ms) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const stopRecording = () => {
  if (!mediaRec || mediaRec.state !== 'recording') return
  // fade out over 300ms then stop
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

  // route through Web Audio for fade in/out
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
    // fade in over ~150ms
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
    if (blob.size < 1000) return // too short, discard

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
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'message', text: url, id: msgId }))
      }
    } finally {
      recordBtn.disabled = chatInput.disabled
    }
  })

  mediaRec.start()
})

// — @mention autocomplete —
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

loadSidebar()
let isAdmin = false

fetchCustomEmoji()
connect()
refreshHeader()
fetchBoot()

// — Notification sound —
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

// — Tab title unread —
let titleUnread = 0
const updateTitle = () => { document.title = titleUnread > 0 ? `(${titleUnread}) speakEZ` : 'speakEZ' }
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

// — Voice —
let ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }
const refreshTurnCredentials = async () => {
  try {
    const res = await fetch('/api/turn', { headers: { Authorization: `Bearer ${session.token}` } })
    if (!res.ok) return
    const { iceServers } = await res.json()
    if (iceServers?.length) ICE_CONFIG = { iceServers }
  } catch {}
}
let voiceWs = null
let localStream = null
let localCtx = null
let remoteCtx = null
let activeVoiceChannel = null
let muted = false
const sessionTracks = new Map() // pubkey → { dest, rec, chunks }
const SESSION_MIME = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
const peerConns = new Map() // pubkey → RTCPeerConnection
const voiceMembers = new Map() // pubkey → member info
const peerGains = new Map() // pubkey → GainNode
const peerGainValues = new Map() // pubkey → dB value (persists across calls)

let audioConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
let gateThreshold = 0.7

const voiceBar = document.getElementById('voice-bar')
const voiceBarCh = document.getElementById('voice-bar-channel')
const voiceBarMems = document.getElementById('voice-bar-members')
const voiceMuteBtn = document.getElementById('voice-mute-btn')
const voiceMuteIcon = document.getElementById('voice-mute-icon')
const voiceRecBtn = document.getElementById('voice-rec-btn')
const voiceCamBtn = document.getElementById('voice-cam-btn')
const voiceLeaveBtn = document.getElementById('voice-leave-btn')
const voiceDevWrap = document.getElementById('voice-device-wrap')
const voiceDevBtn = document.getElementById('voice-device-btn')
const voiceDevMenu = document.getElementById('voice-device-menu')

let localVideoStream = null
let videoEnabled = false
let avatarCanvasTrack = null

const makeAvatarCanvasTrack = () => {
  const name = localStorage.getItem('name') || session.pubkey.slice(0, 8)
  const color = avatarColor(session.pubkey)
  const canvas = document.createElement('canvas')
  canvas.width = 320; canvas.height = 240
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, 320, 240)
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(160, 95, 58, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 54px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(name[0].toUpperCase(), 160, 95)
  ctx.font = '18px sans-serif'
  ctx.fillText(name, 160, 190)
  return canvas.captureStream(5).getVideoTracks()[0]
}
const hiddenVideoPeers = new Set()
const peerVideoTracks = new Map() // pubkey → MediaStreamTrack
let activeDeviceId = null

const SVG_MIC_ON = '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>'
const SVG_MIC_OFF = '<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>'

const speakingSet = new Set()
let speakInterval = null
const analysers = new Map() // pubkey → { analyser }

// — Volume popover —
let volPopoverPubkey = null
const closeVolPopover = () => {
  document.getElementById('voice-vol-popover')?.remove()
  volPopoverPubkey = null
}
const openVolPopover = (wrap, pubkey) => {
  if (volPopoverPubkey === pubkey) { closeVolPopover(); return }
  closeVolPopover()
  volPopoverPubkey = pubkey
  const db = peerGainValues.get(pubkey) ?? 0
  const pop = document.createElement('div')
  pop.id = 'voice-vol-popover'
  pop.className = 'voice-vol-popover'
  pop.innerHTML = `<label>${esc(voiceMembers.get(pubkey)?.name || pubkey.slice(0, 8))}</label>
    <input type="range" min="-60" max="6" step="1" value="${db}">
    <span class="vol-val">${db >= 0 ? '+' : ''}${db} dB</span>`
  wrap.style.position = 'relative'
  wrap.appendChild(pop)
  const slider = pop.querySelector('input')
  const valEl = pop.querySelector('.vol-val')
  slider.addEventListener('input', () => {
    const v = +slider.value
    peerGainValues.set(pubkey, v)
    valEl.textContent = `${v >= 0 ? '+' : ''}${v} dB`
    const g = peerGains.get(pubkey)
    if (g) g.gain.value = Math.pow(10, v / 20)
  })
  pop.addEventListener('click', e => e.stopPropagation())
}
document.addEventListener('click', closeVolPopover)

const makeVoiceAvatar = (m) => {
  const wrap = document.createElement('div')
  wrap.className = 'voice-avatar-wrap'
  if (m.pubkey !== session.pubkey) wrap.classList.add('peer')
  wrap.dataset.pubkey = m.pubkey
  const color = avatarColor(m.pubkey)
  wrap.style.setProperty('--av-color', color)
  const initial = (m.name || '?')[0].toUpperCase()
  const img = m.avatar
    ? `<img class="voice-avatar" src="${esc(m.avatar)}" alt="" onerror="this.outerHTML='<div class=\\'voice-avatar-placeholder\\' style=\\'background:${color}\\'>${esc(initial)}</div>'">`
    : `<div class="voice-avatar-placeholder" style="background:${color}">${initial}</div>`
  const name = document.createElement('div')
  name.className = 'voice-avatar-name'
  name.textContent = m.name || m.pubkey.slice(0, 8)
  wrap.innerHTML = img
  if (sessionTracks.size > 0) {
    const dot = document.createElement('div')
    dot.className = 'voice-rec-dot'
    wrap.appendChild(dot)
  }
  wrap.appendChild(name)
  wrap.addEventListener('click', e => {
    e.stopPropagation()
    openGrid()
  })
  return wrap
}

const renderVoiceBar = () => {
  if (!activeVoiceChannel) { voiceBar.style.display = 'none'; document.body.classList.remove('in-voice'); renderSidebar(); return }
  voiceBar.style.display = 'flex'; document.body.classList.add('in-voice')
  requestAnimationFrame(() => document.documentElement.style.setProperty('--voice-bar-h', voiceBar.offsetHeight + 'px'))
  const ch = sidebarData.channels.find(c => c.id === activeVoiceChannel)
  voiceBarCh.textContent = ch?.name || activeVoiceChannel
  voiceBarMems.innerHTML = ''
  const me = { pubkey: session.pubkey, name: localStorage.getItem('name'), avatar: localStorage.getItem('avatar') }
  for (const m of [me, ...voiceMembers.values()]) voiceBarMems.appendChild(makeVoiceAvatar(m))
  for (const [pubkey, track] of peerVideoTracks) addVideo(pubkey, track)
  renderVoiceFloat()
  renderSidebar()
}

// Local audio pipeline: analyser + noise gate → gatedStream sent to peers
let gateGain = null
let gatedStream = null
let gateOpen = false
let gateHoldTimer = null

const setupLocalPipeline = (stream) => {
  if (localCtx) { try { localCtx.close() } catch {} }
  localCtx = new AudioContext({ sampleRate: 48000 })
  const src = localCtx.createMediaStreamSource(stream)
  const analyser = localCtx.createAnalyser()
  analyser.fftSize = 512
  gateGain = localCtx.createGain()
  gateGain.gain.value = 0 // start closed (silent until voice detected)
  const dest = localCtx.createMediaStreamDestination()
  src.connect(analyser)
  src.connect(gateGain)
  gateGain.connect(dest)
  gatedStream = dest.stream
  gateOpen = false
  clearTimeout(gateHoldTimer); gateHoldTimer = null
  analysers.set(session.pubkey, { analyser })
}

const stopLocalPipeline = () => {
  analysers.delete(session.pubkey)
  speakingSet.delete(session.pubkey)
  clearTimeout(gateHoldTimer); gateHoldTimer = null
  gateGain = null; gatedStream = null; gateOpen = false
  if (localCtx) { try { localCtx.close() } catch {}; localCtx = null }
}

const tickSpeaking = () => {
  const data = new Uint8Array(512)
  for (const [pubkey, { analyser }] of analysers) {
    analyser.getByteTimeDomainData(data)
    const rms = Math.sqrt(data.reduce((s, v) => s + (v - 128) ** 2, 0) / data.length)
    const isSelf = pubkey === session.pubkey
    const speaking = rms > gateThreshold && (!isSelf || !muted)
    const wrap = voiceBarMems.querySelector(`[data-pubkey="${pubkey}"]`)
    wrap?.classList.toggle('speaking', speaking)
    voiceFloat.querySelector(`[data-pubkey="${pubkey}"]`)?.classList.toggle('speaking', speaking)
    document.querySelector(`#vg-tiles [data-pubkey="${pubkey}"]`)?.classList.toggle('speaking', speaking)
    if (isSelf) {
      // Drive the actual audio gate (attack → hold → release)
      if (gateGain && localCtx) {
        const shouldOpen = rms > gateThreshold && !muted
        if (shouldOpen) {
          // Voice detected: open immediately, cancel any pending close
          clearTimeout(gateHoldTimer); gateHoldTimer = null
          if (!gateOpen) {
            gateOpen = true
            gateGain.gain.setTargetAtTime(1, localCtx.currentTime, 0.005) // 5ms attack
          }
        } else if (gateOpen && !gateHoldTimer) {
          // Below threshold: hold for 300ms before releasing
          gateHoldTimer = setTimeout(() => {
            gateHoldTimer = null
            gateOpen = false
            if (gateGain && localCtx) gateGain.gain.setTargetAtTime(0, localCtx.currentTime, 0.15) // 150ms release
          }, 300)
        }
      }
      // Update visual meter + live RMS readout
      const fill = document.getElementById('vlf')
      if (fill) {
        fill.style.width = Math.min(100, rms / 10 * 100) + '%'
        fill.style.background = rms > gateThreshold ? 'var(--accent)' : 'var(--muted)'
      }
      const vrms = document.getElementById('vrms')
      if (vrms) vrms.textContent = rms.toFixed(1)
    }
  }
}

// Remote audio: route through Web Audio for per-peer gain control + speaking detection
const addAudio = (pubkey, stream) => {
  removeAudio(pubkey)
  if (!remoteCtx) return // should be created in joinVoice; bail if somehow missing
  const src = remoteCtx.createMediaStreamSource(stream)
  const gainNode = remoteCtx.createGain()
  gainNode.gain.value = Math.pow(10, (peerGainValues.get(pubkey) ?? 0) / 20)
  const analyser = remoteCtx.createAnalyser()
  analyser.fftSize = 512
  src.connect(analyser)
  src.connect(gainNode)
  gainNode.connect(remoteCtx.destination)
  if (sessionTracks.size > 0) {
    const name = voiceMembers.get(pubkey)?.name || pubkey.slice(0, 8)
    startTrackRecording(pubkey, gainNode, name)
  }
  analysers.set(pubkey, { analyser })
  peerGains.set(pubkey, gainNode)
}

const removeAudio = (pubkey) => {
  analysers.delete(pubkey)
  speakingSet.delete(pubkey)
  peerGains.delete(pubkey)
}

const addVideo = (pubkey, track) => {
  peerVideoTracks.set(pubkey, track)
  const wrap = voiceBarMems.querySelector(`[data-pubkey="${pubkey}"]`)
  if (!wrap) return
  let vid = wrap.querySelector('.voice-video')
  if (!vid) {
    vid = document.createElement('video')
    vid.className = 'voice-video'
    vid.autoplay = true
    vid.playsInline = true
    wrap.insertBefore(vid, wrap.firstChild)
  }
  vid.srcObject = new MediaStream([track])
  if (pubkey === session.pubkey) { vid.muted = true; vid.style.transform = 'scaleX(-1)' }
  wrap.classList.add('has-video')
  if (hiddenVideoPeers.has(pubkey)) wrap.classList.add('video-hidden')
  // Name overlay — avatar + name snug at bottom-left corner of the tile
  wrap.querySelector('.voice-video-overlay')?.remove()
  const m = pubkey === session.pubkey
    ? { name: localStorage.getItem('name'), avatar: localStorage.getItem('avatar') }
    : voiceMembers.get(pubkey)
  const color = avatarColor(pubkey)
  const initial = ((m?.name || '?')[0]).toUpperCase()
  const overlay = document.createElement('div')
  overlay.className = 'voice-video-overlay'
  const av = document.createElement('div')
  av.className = 'voice-video-mini-av'
  av.style.background = color
  if (m?.avatar) {
    const img = document.createElement('img')
    img.src = m.avatar; img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover'
    img.onerror = () => { img.remove(); av.textContent = initial }
    av.appendChild(img)
  } else { av.textContent = initial }
  const nameTag = document.createElement('span')
  nameTag.className = 'voice-video-name-tag'
  nameTag.textContent = m?.name || pubkey.slice(0, 8)
  overlay.appendChild(av)
  overlay.appendChild(nameTag)
  wrap.appendChild(overlay)
  requestAnimationFrame(() => document.documentElement.style.setProperty('--voice-bar-h', voiceBar.offsetHeight + 'px'))
  renderGrid()
}

const removeVideo = (pubkey) => {
  peerVideoTracks.delete(pubkey)
  const wrap = voiceBarMems.querySelector(`[data-pubkey="${pubkey}"]`)
  if (!wrap) return
  wrap.querySelector('.voice-video')?.remove()
  wrap.querySelector('.voice-video-overlay')?.remove()
  wrap.classList.remove('has-video', 'video-hidden')
  requestAnimationFrame(() => document.documentElement.style.setProperty('--voice-bar-h', voiceBar.offsetHeight + 'px'))
  renderGrid()
}

const toggleCamera = async () => {
  const recording = sessionTracks.size > 0
  if (videoEnabled) {
    videoEnabled = false
    voiceCamBtn.classList.remove('active')
    if (recording && localVideoStream) {
      // Disable camera track (black in recording), send avatar canvas to peers
      localVideoStream.getVideoTracks().forEach(t => { t.enabled = false })
      avatarCanvasTrack = makeAvatarCanvasTrack()
      for (const pc of peerConns.values()) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(avatarCanvasTrack).catch(() => {})
      }
    } else {
      localVideoStream?.getTracks().forEach(t => t.stop())
      localVideoStream = null
      for (const [pubkey, pc] of peerConns) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) {
          pc.removeTrack(sender)
          pc.createOffer().then(o => { pc.setLocalDescription(o); voiceWs?.send(JSON.stringify({ type: 'signal', to: pubkey, data: { sdp: o } })) }).catch(() => {})
        }
      }
    }
    removeVideo(session.pubkey)
  } else {
    if (recording && localVideoStream) {
      // Re-enable camera, swap avatar canvas back to real track on peers
      localVideoStream.getVideoTracks().forEach(t => { t.enabled = true })
      const vt = localVideoStream.getVideoTracks()[0]
      for (const pc of peerConns.values()) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(vt).catch(() => {})
      }
      avatarCanvasTrack?.stop(); avatarCanvasTrack = null
      videoEnabled = true
      voiceCamBtn.classList.add('active')
      addVideo(session.pubkey, vt)
    } else {
      try { localVideoStream = await navigator.mediaDevices.getUserMedia({ video: true }) } catch { return }
      videoEnabled = true
      voiceCamBtn.classList.add('active')
      const vt = localVideoStream.getVideoTracks()[0]
      addVideo(session.pubkey, vt)
      for (const [pubkey, pc] of peerConns) {
        pc.addTrack(vt, localVideoStream)
        pc.createOffer().then(o => { pc.setLocalDescription(o); voiceWs?.send(JSON.stringify({ type: 'signal', to: pubkey, data: { sdp: o } })) }).catch(() => {})
      }
    }
  }
}

const closePeer = (pubkey) => {
  peerConns.get(pubkey)?.close()
  peerConns.delete(pubkey)
  removeAudio(pubkey)
  voiceMembers.delete(pubkey)
}

const initPeer = (pubkey, member, initiator) => {
  if (peerConns.has(pubkey)) return
  const pc = new RTCPeerConnection(ICE_CONFIG)
  peerConns.set(pubkey, pc)
  voiceMembers.set(pubkey, member)

  const sendStream = gatedStream || localStream
  sendStream?.getTracks().forEach(t => pc.addTrack(t, sendStream))
  if (videoEnabled && localVideoStream) {
    const vt = localVideoStream.getVideoTracks()[0]
    if (vt) pc.addTrack(vt, localVideoStream)
  }

  pc.ontrack = e => {
    if (e.track.kind === 'audio') addAudio(pubkey, e.streams[0])
    else if (e.track.kind === 'video') addVideo(pubkey, e.track)
  }
  pc.onicecandidate = e => {
    if (e.candidate && voiceWs?.readyState === WebSocket.OPEN) { voiceWs.send(JSON.stringify({ type: 'signal', to: pubkey, data: { ice: e.candidate } })) }
  }
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState)) closePeer(pubkey)
    if (pc.connectionState === 'connected') {
      pc.getSenders().forEach(sender => {
        if (sender.track?.kind !== 'audio') return
        const params = sender.getParameters()
        if (!params.encodings?.length) params.encodings = [{}]
        params.encodings[0].maxBitrate = 128000
        sender.setParameters(params).catch(() => {})
      })
    }
  }

  if (initiator) {
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer)
      if (voiceWs?.readyState === WebSocket.OPEN) { voiceWs.send(JSON.stringify({ type: 'signal', to: pubkey, data: { sdp: offer } })) }
    }).catch(() => {})
  }
  renderVoiceBar()
}

const handleVoiceSignal = async (from, data) => {
  if (data.sdp?.type === 'offer') {
    const member = voiceMembers.get(from) || { pubkey: from }
    if (!peerConns.has(from)) initPeer(from, member, false)
    const pc = peerConns.get(from)
    await pc.setRemoteDescription(data.sdp)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    if (voiceWs?.readyState === WebSocket.OPEN) { voiceWs.send(JSON.stringify({ type: 'signal', to: from, data: { sdp: answer } })) }
  } else if (data.sdp?.type === 'answer') {
    await peerConns.get(from)?.setRemoteDescription(data.sdp).catch(() => {})
  } else if (data.ice) {
    await peerConns.get(from)?.addIceCandidate(data.ice).catch(() => {})
  }
}

// Restart stream with current constraints + optional new deviceId
const restartStream = async (deviceId) => {
  const useId = deviceId !== undefined ? deviceId : activeDeviceId
  const constraints = {
    audio: { ...audioConstraints, sampleRate: 48000, ...(useId ? { deviceId: { exact: useId } } : {}) },
    video: false
  }
  try {
    const newStream = await navigator.mediaDevices.getUserMedia(constraints)
    stopLocalPipeline()
    localStream?.getTracks().forEach(t => t.stop())
    localStream = newStream
    activeDeviceId = newStream.getAudioTracks()[0]?.getSettings()?.deviceId || useId
    setupLocalPipeline(localStream)
    if (loopbackSrc) {
      try { loopbackSrc.disconnect() } catch {}
      loopbackSrc = remoteCtx.createMediaStreamSource(gatedStream)
      loopbackSrc.connect(remoteCtx.destination)
    }
    const rawTrack = localStream.getAudioTracks()[0]
    if (rawTrack) rawTrack.enabled = !muted
    const gatedTrack = gatedStream?.getAudioTracks()[0]
    if (gatedTrack) {
      for (const pc of peerConns.values()) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
        if (sender) sender.replaceTrack(gatedTrack).catch(() => {})
      }
    }
    buildDevMenu()
  } catch {}
}

const startTrackRecording = (pubkey, sourceNode, name) => {
  if (!remoteCtx || sessionTracks.has(pubkey)) return
  const dest = remoteCtx.createMediaStreamDestination()
  sourceNode.connect(dest)
  const videoTrack = pubkey === '__local__'
    ? localVideoStream?.getVideoTracks()[0]
    : peerVideoTracks.get(pubkey)
  const recStream = videoTrack
    ? new MediaStream([dest.stream.getAudioTracks()[0], videoTrack])
    : dest.stream
  const videoMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm'
  const mimeType = videoTrack ? videoMime : SESSION_MIME
  const rec = new MediaRecorder(recStream, { mimeType })
  const chunks = []
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: rec.mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const safeName = name.replace(/[^a-z0-9]/gi, '_').slice(0, 30)
    a.href = url; a.download = `speakez-${activeVoiceChannel || 'session'}-${ts}-${safeName}.webm`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    sessionTracks.delete(pubkey)
    if (sessionTracks.size === 0) { voiceRecBtn.classList.remove('recording'); renderVoiceBar() }
  }
  rec.start()
  sessionTracks.set(pubkey, { dest, rec, chunks })
}

const startSessionRecording = () => {
  if (!remoteCtx || sessionTracks.size > 0) return
  if (gatedStream) {
    const localSrc = remoteCtx.createMediaStreamSource(gatedStream)
    startTrackRecording('__local__', localSrc, session.member?.name || 'me')
  }
  for (const [pubkey, gainNode] of peerGains) {
    const name = voiceMembers.get(pubkey)?.name || pubkey.slice(0, 8)
    startTrackRecording(pubkey, gainNode, name)
  }
  voiceRecBtn.classList.add('recording')
  renderVoiceBar()
}

const stopSessionRecording = () => {
  for (const { rec } of sessionTracks.values()) {
    if (rec.state !== 'inactive') rec.stop()
  }
}

const leaveVoice = () => {
  stopSessionRecording()
  clearInterval(speakInterval); speakInterval = null
  closeVolPopover()
  if (voiceWs) { voiceWs.onclose = null; voiceWs.close(); voiceWs = null }
  for (const pk of [...peerConns.keys()]) closePeer(pk)
  stopLocalPipeline()
  localStream?.getTracks().forEach(t => t.stop()); localStream = null
  localVideoStream?.getTracks().forEach(t => t.stop()); localVideoStream = null
  videoEnabled = false; voiceCamBtn.classList.remove('active')
  peerVideoTracks.clear()
  avatarCanvasTrack?.stop(); avatarCanvasTrack = null
  closeGrid()
  renderVoiceFloat()
  if (loopbackSrc) { try { loopbackSrc.disconnect() } catch {}; loopbackSrc = null }
  if (remoteCtx) { try { remoteCtx.close() } catch {}; remoteCtx = null }
  peerGains.clear()
  voiceMembers.clear(); voiceDevWrap.style.display = 'none'; voiceDevMenu.style.display = 'none'
  activeVoiceChannel = null
  renderVoiceBar()
}

let audioInputs = []
let audioOutputs = []
let activeOutputId = null
const populateDevices = async () => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    audioInputs = devices.filter(d => d.kind === 'audioinput')
    audioOutputs = devices.filter(d => d.kind === 'audiooutput')
  } catch {}
  voiceDevWrap.style.display = '' // always show cog while in voice
}

const selectOutput = async (deviceId) => {
  activeOutputId = deviceId
  buildDevMenu()
  if (remoteCtx?.setSinkId) {
    try { await remoteCtx.setSinkId(deviceId) } catch {}
  }
}

let loopbackSrc = null
const toggleLoopback = () => {
  if (loopbackSrc) {
    try { loopbackSrc.disconnect() } catch {}
    loopbackSrc = null
  } else {
    if (!remoteCtx || !gatedStream) return
    loopbackSrc = remoteCtx.createMediaStreamSource(gatedStream)
    loopbackSrc.connect(remoteCtx.destination)
  }
  buildDevMenu()
}

const buildDevMenu = () => {
  const canSink = !!(window.AudioContext?.prototype?.setSinkId)
  const micsHtml = audioInputs.length > 1
    ? `
    <div class="voice-dsp-section">Microphone</div>
    ${audioInputs.map(d =>
      `<div class="voice-device-item voice-input-item${d.deviceId === activeDeviceId ? ' active' : ''}" data-id="${esc(d.deviceId)}">${esc(d.label || 'Mic ' + d.deviceId.slice(0, 4))}</div>`
    ).join('')}`
    : ''
  const outsHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.35rem 0.75rem 0.25rem;">
      <span class="voice-dsp-section" style="padding:0">Output</span>
      <button id="voice-test-btn" style="background:none;border:none;cursor:pointer;padding:2px;color:${loopbackSrc ? 'var(--accent)' : 'var(--muted)'};" title="${loopbackSrc ? 'Stop loopback' : 'Hear yourself'}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h1v-8H4v-1c0-4.42 3.58-8 8-8s8 3.58 8 8v1h-2v8h1c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/></svg>
      </button>
    </div>
    ${(canSink && audioOutputs.length > 1)
? audioOutputs.map(d =>
      `<div class="voice-device-item voice-output-item${d.deviceId === activeOutputId ? ' active' : ''}" data-id="${esc(d.deviceId)}">${esc(d.label || 'Speaker ' + d.deviceId.slice(0, 4))}</div>`
    ).join('')
: ''}`
  voiceDevMenu.innerHTML = `
    <div class="voice-dsp-section">DSP</div>
    <label class="voice-dsp-row"><input type="checkbox" data-dsp="echoCancellation"${audioConstraints.echoCancellation ? ' checked' : ''}> Echo Cancellation</label>
    <label class="voice-dsp-row"><input type="checkbox" data-dsp="noiseSuppression"${audioConstraints.noiseSuppression ? ' checked' : ''}> Noise Suppression</label>
    <div class="voice-level-wrap">
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <div class="voice-level-track" style="flex:1">
          <div class="voice-level-fill" id="vlf"></div>
          <div class="voice-level-gate" id="vlg" style="left:${Math.min(100, gateThreshold / 10 * 100)}%"></div>
        </div>
        <span id="vrms" style="font-size:0.75rem;color:var(--muted);min-width:2.5rem;text-align:right">—</span>
      </div>
    </div>
    <div class="voice-dsp-slider-row">
      <span>Gate</span>
      <input type="range" id="vgs" min="0" max="10" step="0.1" value="${gateThreshold}">
      <span id="vgv">${gateThreshold}</span>
    </div>
    ${micsHtml}${outsHtml}`
  voiceDevMenu.querySelectorAll('[data-dsp]').forEach(el =>
    el.addEventListener('change', () => {
      audioConstraints = { ...audioConstraints, [el.dataset.dsp]: el.checked }
      restartStream()
    })
  )
  const gs = voiceDevMenu.querySelector('#vgs'); const gv = voiceDevMenu.querySelector('#vgv'); const vlg = voiceDevMenu.querySelector('#vlg')
  gs?.addEventListener('input', () => {
    gateThreshold = +gs.value
    gv.textContent = gateThreshold % 1 ? gateThreshold.toFixed(1) : gateThreshold
    if (vlg) vlg.style.left = Math.min(100, gateThreshold / 10 * 100) + '%'
  })
  voiceDevMenu.querySelectorAll('.voice-input-item').forEach(el =>
    el.addEventListener('click', () => restartStream(el.dataset.id))
  )
  voiceDevMenu.querySelectorAll('.voice-output-item').forEach(el =>
    el.addEventListener('click', () => selectOutput(el.dataset.id))
  )
  voiceDevMenu.querySelector('#voice-test-btn')?.addEventListener('click', toggleLoopback)
}

voiceDevBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  const open = voiceDevMenu.style.display !== 'none'
  if (open) { voiceDevMenu.style.display = 'none'; return }
  buildDevMenu()
  voiceDevMenu.style.display = ''
})
voiceDevMenu.addEventListener('click', e => e.stopPropagation())
document.addEventListener('click', () => { voiceDevMenu.style.display = 'none' })

const joinVoice = async (channelId) => {
  if (activeVoiceChannel === channelId) return
  if (activeVoiceChannel) leaveVoice()
  await refreshTurnCredentials()
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { ...audioConstraints, sampleRate: 48000 },
      video: false
    })
  } catch {
    alert('Microphone access denied.'); return
  }
  activeDeviceId = localStream.getAudioTracks()[0]?.getSettings()?.deviceId || null
  remoteCtx = new AudioContext()
  await remoteCtx.resume()
  setupLocalPipeline(localStream)
  speakInterval = setInterval(tickSpeaking, 80)
  await populateDevices()
  activeVoiceChannel = channelId
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  voiceWs = new WebSocket(`${proto}//${location.host}/api/ws?token=${encodeURIComponent(session.token)}&room=${encodeURIComponent(channelId)}`)

  voiceWs.addEventListener('message', e => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'presence') {
        // We're the new joiner — initiate to everyone already here
        for (const m of (msg.members || [])) if (m.pubkey) { voiceMembers.set(m.pubkey, m); initPeer(m.pubkey, m, true) }
        renderVoiceBar()
      } else if (msg.type === 'join' && msg.from?.pubkey && msg.from.pubkey !== session.pubkey) {
        // They just joined — they'll send us an offer via their presence. Don't initiate.
        // Simultaneous join: higher pubkey initiates after 1.5s if still no PC.
        voiceMembers.set(msg.from.pubkey, msg.from)
        renderVoiceBar()
        if (session.pubkey > msg.from.pubkey) {
          setTimeout(() => {
            if (!peerConns.has(msg.from.pubkey) && activeVoiceChannel) { initPeer(msg.from.pubkey, voiceMembers.get(msg.from.pubkey) || msg.from, true) }
          }, 1500)
        }
      } else if (msg.type === 'leave' && msg.pubkey) {
        closePeer(msg.pubkey); renderVoiceBar()
      } else if (msg.type === 'signal') {
        handleVoiceSignal(msg.from, msg.data)
      } else if (msg.type === 'profile' && msg.pubkey && voiceMembers.has(msg.pubkey)) {
        voiceMembers.set(msg.pubkey, { ...voiceMembers.get(msg.pubkey), name: msg.name, avatar: msg.avatar })
        renderVoiceBar()
      }
    } catch {}
  })
  voiceWs.addEventListener('close', () => { if (activeVoiceChannel) leaveVoice() })
  renderVoiceBar()
}

voiceMuteBtn.addEventListener('click', () => {
  muted = !muted
  localStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
  voiceMuteIcon.innerHTML = muted ? SVG_MIC_OFF : SVG_MIC_ON
  voiceMuteBtn.classList.toggle('muted', muted)
  voiceMuteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute')
})

// — Floating avatar cluster —
const voiceFloat = document.getElementById('voice-float')

const renderVoiceFloat = () => {} // #voice-float retired; expand is now the grid button in the voice bar

// — Grid overlay —
const voiceGrid = document.getElementById('voice-grid')
let gridOpen = false

const renderGrid = () => {
  if (!gridOpen) return
  document.getElementById('vg-ch').textContent = (sidebarData.channels.find(c => c.id === activeVoiceChannel)?.name || activeVoiceChannel)
  const tilesEl = document.getElementById('vg-tiles')
  tilesEl.innerHTML = ''
  const me = { pubkey: session.pubkey, name: localStorage.getItem('name'), avatar: localStorage.getItem('avatar'), isSelf: true }
  const allMembers = [me, ...voiceMembers.values()]
  const cols = allMembers.length <= 1 ? 1 : allMembers.length <= 4 ? 2 : 3
  tilesEl.style.setProperty('--vg-cols', cols)
  for (const m of allMembers) {
    const tile = document.createElement('div')
    tile.className = 'vg-tile'
    tile.dataset.pubkey = m.pubkey
    tile.style.setProperty('--av-color', avatarColor(m.pubkey))
    const videoTrack = m.isSelf ? localVideoStream?.getVideoTracks()[0] : peerVideoTracks.get(m.pubkey)
    if (videoTrack && !hiddenVideoPeers.has(m.pubkey)) {
      const vid = document.createElement('video')
      vid.autoplay = true; vid.playsInline = true; vid.muted = !!m.isSelf
      if (m.isSelf) vid.style.transform = 'scaleX(-1)'
      vid.srcObject = new MediaStream([videoTrack])
      tile.appendChild(vid)
    } else {
      const av = document.createElement('div')
      av.className = 'vg-avatar'
      av.style.background = avatarColor(m.pubkey)
      av.textContent = (m.name || '?')[0].toUpperCase()
      tile.appendChild(av)
    }
    const nameEl = document.createElement('div')
    nameEl.className = 'vg-name'
    nameEl.textContent = (m.name || m.pubkey.slice(0, 8)) + (m.isSelf ? ' (you)' : '')
    tile.appendChild(nameEl)
    if (!m.isSelf) {
      tile.addEventListener('click', e => {
        e.stopPropagation()
        if (tile.querySelector('video')) {
          if (hiddenVideoPeers.has(m.pubkey)) { hiddenVideoPeers.delete(m.pubkey) } else { hiddenVideoPeers.add(m.pubkey) }
          renderGrid()
        } else {
          openVolPopover(tile, m.pubkey)
        }
      })
    }
    tilesEl.appendChild(tile)
  }
}

const openGrid = () => {
  gridOpen = true
  voiceGrid.classList.add('open')
  renderGrid()
}
const closeGrid = () => {
  gridOpen = false
  voiceGrid.classList.remove('open')
}
const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    // requestFullscreen on documentElement works better on Android; falls back to voiceGrid
    ;(document.documentElement.requestFullscreen?.() ?? voiceGrid.requestFullscreen?.())?.catch(() => {})
  } else {
    document.exitFullscreen?.()
  }
}

document.getElementById('vg-close-btn').addEventListener('click', closeGrid)
document.getElementById('vg-fs-btn').addEventListener('click', toggleFullscreen)

document.getElementById('voice-grid-btn').addEventListener('click', openGrid)
voiceCamBtn.addEventListener('click', toggleCamera)
voiceRecBtn.addEventListener('click', () => {
  sessionTracks.size > 0 ? stopSessionRecording() : startSessionRecording()
})
voiceLeaveBtn.addEventListener('click', leaveVoice)

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && gridOpen && !document.fullscreenElement) closeGrid()
  if ((e.key === 'f' || e.key === 'F') && gridOpen && !e.ctrlKey && !e.metaKey) toggleFullscreen()
})

window.addEventListener('beforeunload', e => {
  if (activeVoiceChannel) { e.preventDefault(); e.returnValue = '' }
})
