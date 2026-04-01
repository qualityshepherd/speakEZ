import { state, session } from './state.js'
import { esc, avatarColor, initial } from './utils.js'
import { renderSidebar, loadSidebar, switchChannel, dmRooms, unreadChannels } from './sidebar.js'
import { connect, fetchCustomEmoji } from './chat.js'
// voice.js loaded for side effects (registers DOM listeners)
import './voice.js'

marked.use({ gfm: true, breaks: true })

// — Me modal —
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

const setMsg = (text, type = 'muted') => {
  modalMsg.className = `modal-msg ${type}`
  modalMsg.textContent = text
}

export const refreshHeader = () => {
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
  refreshNotifyUI()
}

const closeModal = () => { modal.style.display = 'none' }

meBtn.addEventListener('click', openModal)
document.getElementById('me-close').addEventListener('click', closeModal)
modal.addEventListener('click', e => { if (e.target === modal) closeModal() })
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.style.display !== 'none') closeModal() })

modalAvatarEl.addEventListener('input', () => updateModalAvatar(modalAvatarEl.value))
modalNameEl.addEventListener('input', () => { modalAvatarPlaceholder.textContent = initial(modalNameEl.value) })

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
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'profile', name: name || null, avatar: avatar || null }))
    }
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
  } catch {
    notifyMsg.textContent = 'subscription failed'
    notifyBox.checked = false
  }
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

// — Logo menu —
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
      const res = await fetch('/api/boot', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ workspaceName: val })
      })
      if (res.ok) { logoBtn.textContent = val; document.title = val }
    } catch {}
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { input.replaceWith(logoBtn) }
  })
  input.addEventListener('blur', commit)
})
document.getElementById('logo-menu-invite').addEventListener('click', () => { closeLogoMenu(); openInviteModal() })
document.addEventListener('click', e => { if (!logoBtn.contains(e.target)) closeLogoMenu() })

// — Member popover —
let popoverEl = null

export const closePopover = () => { popoverEl?.remove(); popoverEl = null }

export const showMemberPopover = (member, anchorEl) => {
  closePopover()
  popoverEl = document.createElement('div')
  popoverEl.className = 'member-popover'
  const color = avatarColor(member.pubkey)
  const avatarHtml = member.avatar
    ? `<img class="member-popover-avatar" src="${esc(member.avatar)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : ''
  const canKick = state.isAdmin && member.pubkey !== session.pubkey
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
          state.allMembers.delete(member.pubkey)
          state.onlineMembers.delete(member.pubkey)
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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePopover()
  if (e.key === 'Escape' && e.shiftKey) {
    const now = Date.now()
    for (const id of unreadChannels) state.reads[id] = now
    unreadChannels.clear()
    renderSidebar()
  }
})

// — Online list —
export const renderOnline = () => {
  const el = document.getElementById('online-list')
  if (!el) return
  el.innerHTML = ''

  const makeMemberRow = (pubkey, member, isOnline) => {
    const { name, avatar } = member
    const row = document.createElement('div')
    row.className = `online-member${isOnline ? '' : ' offline'}`
    const color = avatarColor(pubkey)
    const label = name || pubkey.slice(0, 8)
    const ini = (name || '?')[0].toUpperCase()
    const avatarInner = avatar
      ? `<img class="online-avatar-sm" src="${esc(avatar)}" alt="" onerror="this.outerHTML='<div class=\\'online-avatar-placeholder\\' style=\\'background:${color}\\'>${esc(ini)}</div>'">`
      : `<div class="online-avatar-placeholder" style="background:${color}">${ini}</div>`
    const dot = isOnline ? '<span class="online-dot"></span>' : ''
    row.innerHTML = `<div class="online-avatar-wrap">${avatarInner}${dot}</div><span class="online-member-name">${esc(label)}</span>`
    row.addEventListener('click', e => { e.stopPropagation(); showMemberPopover({ pubkey, name, avatar }, row) })
    return row
  }

  const merged = new Map([...state.allMembers, ...state.onlineMembers])
  if (!merged.size) return

  const title = document.createElement('div')
  title.className = 'online-section-title'
  title.textContent = `members — ${state.onlineMembers.size}/${merged.size}`
  el.appendChild(title)

  for (const [pubkey, member] of merged) {
    if (state.onlineMembers.has(pubkey)) el.appendChild(makeMemberRow(pubkey, member, true))
  }
  for (const [pubkey, member] of merged) {
    if (!state.onlineMembers.has(pubkey)) el.appendChild(makeMemberRow(pubkey, member, false))
  }
}

// — Boot —
export const fetchBoot = async () => {
  if (!session?.token) return
  try {
    const res = await fetch('/api/boot', { headers: { Authorization: `Bearer ${session.token}` } })
    if (!res.ok) return
    const d = await res.json()
    state.isAdmin = !!d.isAdmin
    if (d.name) localStorage.setItem('name', d.name)
    else localStorage.removeItem('name')
    if (d.avatar) localStorage.setItem('avatar', d.avatar)
    else localStorage.removeItem('avatar')
    if (d.workspaceName) {
      logoBtn.textContent = d.workspaceName
      document.title = d.workspaceName
      localStorage.setItem('workspaceName', d.workspaceName)
    }
    document.getElementById('logo-menu-rename').style.display = state.isAdmin ? '' : 'none'
    document.getElementById('add-category').style.display = state.isAdmin ? '' : 'none'
    document.getElementById('add-channel').style.display = state.isAdmin ? '' : 'none'
    refreshHeader()
    for (const m of (d.members || [])) state.allMembers.set(m.pubkey, m)
    renderOnline()
  } catch {}
}

// — Init —
loadSidebar()
fetchCustomEmoji()
connect()
refreshHeader()
fetchBoot()
