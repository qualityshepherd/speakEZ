import { session } from './state.js'

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

export const notifyIfNeeded = (from, text, replyTo) => {
  if (from.pubkey === session.pubkey) return
  const myName = localStorage.getItem('name')
  const mentioned = (myName && text.toLowerCase().includes('@' + myName.toLowerCase())) ||
                    text.includes('@' + session.pubkey.slice(0, 8))
  const replied = replyTo?.from?.pubkey === session.pubkey
  if (!mentioned && !replied) return
  playMentionSound()
  if (document.hidden) { titleUnread++; updateTitle() }
}
