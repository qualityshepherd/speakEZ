import { state } from './state.js'
import { esc, fmtTime } from './utils.js'
import { sidebarAuth } from './sidebar.js'
import { messagesEl } from './message-render.js'

const searchBar = document.getElementById('search-bar')
const searchInput = document.getElementById('search-input')
const searchBtn = document.getElementById('search-btn')
const searchClose = document.getElementById('search-close')
let searchDebounce = null

export const openSearch = () => {
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
