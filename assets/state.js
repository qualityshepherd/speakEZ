export const session = JSON.parse(localStorage.getItem('session') || 'null')
if (!session) { location.href = '/login.html'; throw new Error() }
document.documentElement.classList.remove('no-session')

export const state = {
  isAdmin: false,
  ws: null,
  activeChannelId: 'general',
  activeVoiceChannel: null,
  allMembers: new Map(),
  onlineMembers: new Map(),
  reads: JSON.parse(localStorage.getItem('reads') || '{}')
}

export const saveRead = (channelId, ts) => {
  if (!state.reads[channelId] || ts > state.reads[channelId]) {
    state.reads[channelId] = ts
    localStorage.setItem('reads', JSON.stringify(state.reads))
  }
}
