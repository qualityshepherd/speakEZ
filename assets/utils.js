export const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const fmtTime = ts => {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return 'Today at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export const pubkeyHue = (pubkey) => {
  let hash = 0
  for (let i = 0; i < pubkey.length; i++) hash = (hash * 31 + pubkey.charCodeAt(i)) >>> 0
  return hash % 360
}

export const avatarColor = (pubkey) => `hsl(${pubkeyHue(pubkey)}, 45%, 40%)`

export const initial = (n) => n ? n.trim()[0].toUpperCase() : '?'

export const fmtDuration = (ms) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const fmtSecs = s => isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00'
