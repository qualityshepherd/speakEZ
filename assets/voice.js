import { state, session } from './state.js'
import { esc, avatarColor } from './utils.js'
import { renderSidebar, sidebarData } from './sidebar.js'

let ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }

const refreshTurnCredentials = async () => {
  try {
    const res = await fetch('/api/turn', { headers: { Authorization: `Bearer ${session.token}` } })
    if (!res.ok) return
    const { iceServers } = await res.json()
    if (iceServers?.length) ICE_CONFIG = { iceServers }
  } catch {}
}

export let voiceWs = null
let localStream = null
let localCtx = null
let remoteCtx = null
let localVideoStream = null
let videoEnabled = false
let avatarCanvasTrack = null
let muted = false
let audioInputs = []
let audioOutputs = []
let activeOutputId = null
let activeDeviceId = null
let loopbackSrc = null

export const voiceMembers = new Map()
export const peerConns = new Map()
export const peerGains = new Map()
export const peerGainValues = new Map()
export const peerVideoTracks = new Map()
export const sessionTracks = new Map()
export const hiddenVideoPeers = new Set()

const SESSION_MIME = (() => {
  const prefer = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return prefer.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm'
})()

let audioConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
let gateThreshold = 0.7
let gateGain = null
let gatedStream = null
let gateOpen = false
let gateHoldTimer = null

const speakingSet = new Set()
let speakInterval = null
const analysers = new Map()

const voiceBar = document.getElementById('voice-bar')
const voiceBarCh = document.getElementById('voice-bar-channel')
const voiceBarMems = document.getElementById('voice-bar-members')
const voiceMuteBtn = document.getElementById('voice-mute-btn')
const voiceMuteIcon = document.getElementById('voice-mute-icon')
export const voiceRecBtn = document.getElementById('voice-rec-btn')
const voiceCamBtn = document.getElementById('voice-cam-btn')
const voiceLeaveBtn = document.getElementById('voice-leave-btn')
const voiceDevWrap = document.getElementById('voice-device-wrap')
const voiceDevBtn = document.getElementById('voice-device-btn')
const voiceDevMenu = document.getElementById('voice-device-menu')
const voiceFloat = document.getElementById('voice-float')
const voiceGrid = document.getElementById('voice-grid')

const SVG_MIC_ON = '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>'
const SVG_MIC_OFF = '<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>'

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

// — Avatar canvas track for recording while camera off —
export const makeAvatarCanvasTrack = () => {
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

// — Voice avatar (bar) —
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

export const renderVoiceBar = () => {
  if (!state.activeVoiceChannel) {
    voiceBar.style.display = 'none'
    document.body.classList.remove('in-voice')
    renderSidebar()
    return
  }
  voiceBar.style.display = 'flex'
  document.body.classList.add('in-voice')
  requestAnimationFrame(() => document.documentElement.style.setProperty('--voice-bar-h', voiceBar.offsetHeight + 'px'))
  const ch = sidebarData.channels.find(c => c.id === state.activeVoiceChannel)
  voiceBarCh.textContent = ch?.name || state.activeVoiceChannel
  voiceBarMems.innerHTML = ''
  const me = { pubkey: session.pubkey, name: localStorage.getItem('name'), avatar: localStorage.getItem('avatar') }
  for (const m of [me, ...voiceMembers.values()]) voiceBarMems.appendChild(makeVoiceAvatar(m))
  for (const [pubkey, track] of peerVideoTracks) addVideo(pubkey, track)
  renderVoiceFloat()
  renderSidebar()
}

// — Local audio pipeline —
const setupLocalPipeline = (stream) => {
  if (localCtx) { try { localCtx.close() } catch {} }
  localCtx = new AudioContext({ sampleRate: 48000 })
  const src = localCtx.createMediaStreamSource(stream)
  const analyser = localCtx.createAnalyser()
  analyser.fftSize = 512
  gateGain = localCtx.createGain()
  gateGain.gain.value = 0
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
      if (gateGain && localCtx) {
        const shouldOpen = rms > gateThreshold && !muted
        if (shouldOpen) {
          clearTimeout(gateHoldTimer); gateHoldTimer = null
          if (!gateOpen) {
            gateOpen = true
            gateGain.gain.setTargetAtTime(1, localCtx.currentTime, 0.005)
          }
        } else if (gateOpen && !gateHoldTimer) {
          gateHoldTimer = setTimeout(() => {
            gateHoldTimer = null
            gateOpen = false
            if (gateGain && localCtx) gateGain.gain.setTargetAtTime(0, localCtx.currentTime, 0.15)
          }, 300)
        }
      }
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

// — Remote audio —
const addAudio = (pubkey, stream) => {
  removeAudio(pubkey)
  if (!remoteCtx) return
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

// — Video —
export const addVideo = (pubkey, track) => {
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

export const removeVideo = (pubkey) => {
  peerVideoTracks.delete(pubkey)
  const wrap = voiceBarMems.querySelector(`[data-pubkey="${pubkey}"]`)
  if (!wrap) return
  wrap.querySelector('.voice-video')?.remove()
  wrap.querySelector('.voice-video-overlay')?.remove()
  wrap.classList.remove('has-video', 'video-hidden')
  requestAnimationFrame(() => document.documentElement.style.setProperty('--voice-bar-h', voiceBar.offsetHeight + 'px'))
  renderGrid()
}

export const toggleCamera = async () => {
  const recording = sessionTracks.size > 0
  if (videoEnabled) {
    videoEnabled = false
    voiceCamBtn.classList.remove('active')
    if (recording && localVideoStream) {
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

// — Peers —
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
    if (e.candidate && voiceWs?.readyState === WebSocket.OPEN) {
      voiceWs.send(JSON.stringify({ type: 'signal', to: pubkey, data: { ice: e.candidate } }))
    }
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
      if (voiceWs?.readyState === WebSocket.OPEN) {
        voiceWs.send(JSON.stringify({ type: 'signal', to: pubkey, data: { sdp: offer } }))
      }
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
    if (voiceWs?.readyState === WebSocket.OPEN) {
      voiceWs.send(JSON.stringify({ type: 'signal', to: from, data: { sdp: answer } }))
    }
  } else if (data.sdp?.type === 'answer') {
    await peerConns.get(from)?.setRemoteDescription(data.sdp).catch(() => {})
  } else if (data.ice) {
    await peerConns.get(from)?.addIceCandidate(data.ice).catch(() => {})
  }
}

// — Stream restart —
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

// — Session recording —
const startTrackRecording = (pubkey, sourceNode, name, videoTrack) => {
  if (!remoteCtx || sessionTracks.has(pubkey)) return
  const dest = remoteCtx.createMediaStreamDestination()
  sourceNode.connect(dest)

  // Canvas for stable video — falls back to avatar when camera off
  const canvas = document.createElement('canvas')
  canvas.width = 320; canvas.height = 240
  const ctx2d = canvas.getContext('2d')
  const color = avatarColor(pubkey)
  const drawAvatar = () => {
    ctx2d.fillStyle = '#1a1a1a'; ctx2d.fillRect(0, 0, 320, 240)
    ctx2d.fillStyle = color; ctx2d.beginPath(); ctx2d.arc(160, 95, 58, 0, Math.PI * 2); ctx2d.fill()
    ctx2d.fillStyle = '#fff'; ctx2d.font = 'bold 54px sans-serif'
    ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle'
    ctx2d.fillText((name || '?')[0].toUpperCase(), 160, 95)
  }
  let liveVideo = false
  let frameTimer = null
  if (videoTrack && videoTrack.readyState !== 'ended') {
    const vid = document.createElement('video')
    vid.muted = true; vid.autoplay = true; vid.playsInline = true
    vid.srcObject = new MediaStream([videoTrack])
    vid.play().catch(() => {})
    liveVideo = true
    videoTrack.addEventListener('ended', () => { liveVideo = false })
    frameTimer = setInterval(() => {
      if (liveVideo && vid.readyState >= 2) ctx2d.drawImage(vid, 0, 0, 320, 240)
      else drawAvatar()
    }, 1000 / 30)
  } else {
    drawAvatar()
    frameTimer = setInterval(drawAvatar, 1000)
  }

  const canvasTrack = canvas.captureStream(30).getVideoTracks()[0]
  const recStream = new MediaStream([...dest.stream.getAudioTracks(), canvasTrack])
  const mimeType = SESSION_MIME
  const rec = new MediaRecorder(recStream, { mimeType })
  const chunks = []
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  rec.onstop = () => {
    clearInterval(frameTimer)
    const blob = new Blob(chunks, { type: rec.mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const safeName = name.replace(/[^a-z0-9]/gi, '_').slice(0, 30)
    a.href = url; a.download = `speakez-${state.activeVoiceChannel || 'session'}-${ts}-${safeName}.webm`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    sessionTracks.delete(pubkey)
    if (sessionTracks.size === 0) { voiceRecBtn.classList.remove('recording'); renderVoiceBar() }
  }
  rec.start()
  sessionTracks.set(pubkey, { dest, rec, chunks })
}

export const startSessionRecording = () => {
  if (!remoteCtx || sessionTracks.size > 0) return
  if (gatedStream) {
    const localSrc = remoteCtx.createMediaStreamSource(gatedStream)
    const localVideo = localVideoStream?.getVideoTracks()[0]
    startTrackRecording('__local__', localSrc, session.member?.name || localStorage.getItem('name') || 'me', localVideo)
  }
  for (const [pubkey, gainNode] of peerGains) {
    const name = voiceMembers.get(pubkey)?.name || pubkey.slice(0, 8)
    startTrackRecording(pubkey, gainNode, name, peerVideoTracks.get(pubkey))
  }
  voiceRecBtn.classList.add('recording')
  renderVoiceBar()
}

export const stopSessionRecording = () => {
  for (const { rec } of sessionTracks.values()) {
    if (rec.state !== 'inactive') rec.stop()
  }
}

// — Leave —
export const leaveVoice = () => {
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
  voiceMembers.clear()
  voiceDevWrap.style.display = 'none'; voiceDevMenu.style.display = 'none'
  state.activeVoiceChannel = null
  renderVoiceBar()
}

// — Device menu —
const populateDevices = async () => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    audioInputs = devices.filter(d => d.kind === 'audioinput')
    audioOutputs = devices.filter(d => d.kind === 'audiooutput')
  } catch {}
  voiceDevWrap.style.display = ''
}

const selectOutput = async (deviceId) => {
  activeOutputId = deviceId
  buildDevMenu()
  if (remoteCtx?.setSinkId) {
    try { await remoteCtx.setSinkId(deviceId) } catch {}
  }
}

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

// — Join —
export const joinVoice = async (channelId) => {
  if (state.activeVoiceChannel === channelId) return
  if (state.activeVoiceChannel) leaveVoice()
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
  state.activeVoiceChannel = channelId
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  voiceWs = new WebSocket(`${proto}//${location.host}/api/ws?token=${encodeURIComponent(session.token)}&room=${encodeURIComponent(channelId)}`)

  voiceWs.addEventListener('message', e => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'presence') {
        for (const m of (msg.members || [])) if (m.pubkey) { voiceMembers.set(m.pubkey, m); initPeer(m.pubkey, m, true) }
        renderVoiceBar()
      } else if (msg.type === 'join' && msg.from?.pubkey && msg.from.pubkey !== session.pubkey) {
        voiceMembers.set(msg.from.pubkey, msg.from)
        renderVoiceBar()
        if (session.pubkey > msg.from.pubkey) {
          setTimeout(() => {
            if (!peerConns.has(msg.from.pubkey) && state.activeVoiceChannel) {
              initPeer(msg.from.pubkey, voiceMembers.get(msg.from.pubkey) || msg.from, true)
            }
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
  voiceWs.addEventListener('close', () => { if (state.activeVoiceChannel) leaveVoice() })
  renderVoiceBar()
}

// — Mute —
voiceMuteBtn.addEventListener('click', () => {
  muted = !muted
  localStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
  voiceMuteIcon.innerHTML = muted ? SVG_MIC_OFF : SVG_MIC_ON
  voiceMuteBtn.classList.toggle('muted', muted)
  voiceMuteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute')
})

const renderVoiceFloat = () => {} // retired

// — Grid overlay —
let gridOpen = false

const renderGrid = () => {
  if (!gridOpen) return
  document.getElementById('vg-ch').textContent = (sidebarData.channels.find(c => c.id === state.activeVoiceChannel)?.name || state.activeVoiceChannel)
  const tilesEl = document.getElementById('vg-tiles')
  tilesEl.innerHTML = ''
  const me = { pubkey: session.pubkey, name: localStorage.getItem('name'), avatar: localStorage.getItem('avatar'), isSelf: true }
  const members = [me, ...voiceMembers.values()]
  const cols = members.length <= 1 ? 1 : members.length <= 4 ? 2 : 3
  tilesEl.style.setProperty('--vg-cols', cols)
  for (const m of members) {
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

const openGrid = () => { gridOpen = true; voiceGrid.classList.add('open'); renderGrid() }
const closeGrid = () => { gridOpen = false; voiceGrid.classList.remove('open') }

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
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
  if (state.activeVoiceChannel) { e.preventDefault(); e.returnValue = '' }
})
