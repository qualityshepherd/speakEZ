import { state, session } from './state.js'
import { fmtSecs, fmtDuration } from './utils.js'
import { chatInput, resizeInput } from './ui-helpers.js'

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

const lightbox = document.getElementById('img-lightbox')
const lightboxImg = document.getElementById('img-lightbox-img')
document.addEventListener('click', e => {
  const src = e.target.dataset?.lightbox
  if (src) { lightboxImg.src = src; lightbox.classList.add('open'); return }
  if (e.target === lightbox || e.target === lightboxImg) lightbox.classList.remove('open')
})
document.addEventListener('keydown', e => { if (e.key === 'Escape') lightbox.classList.remove('open') })

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

new MutationObserver(() => {
  uploadBtn.disabled = chatInput.disabled
  recordBtn.disabled = chatInput.disabled
}).observe(chatInput, { attributes: true, attributeFilter: ['disabled'] })
