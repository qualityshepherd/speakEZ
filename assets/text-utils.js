import { esc } from './utils.js'

export const URL_RE = /https?:\/\/[^\s<>"']+|\/api\/upload\/[^\s<>"']+/g
export const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|svg)(\?[^\s]*)?$/i
export const AUDIO_EXT_RE = /\.(webm|ogg|m4a|mp3|wav)(\?[^\s]*)?$/i
export const isImageUrl = u => IMG_EXT_RE.test(u) || (u.startsWith('/api/upload/') && !AUDIO_EXT_RE.test(u))
export const isAudioUrl = u => AUDIO_EXT_RE.test(u)

export const mentionHtml = (html) =>
  html.replace(/@([\w.-]+)/g, (_, n) => `<span class="mention">@${esc(n)}</span>`)

export const customEmojiMap = new Map()

export const fetchCustomEmoji = async () => {
  const list = await (await fetch('/api/emoji')).json()
  customEmojiMap.clear()
  for (const e of list) customEmojiMap.set(e.name, e.url)
  document.querySelectorAll('.msg-text').forEach(el => {
    if (/:([a-zA-Z0-9_-]+):/.test(el.innerHTML)) { el.innerHTML = customEmojiHtml(el.innerHTML) }
  })
}

export const customEmojiHtml = (html) =>
  html.replace(/:([a-zA-Z0-9_-]+):/g, (match, name) => {
    const url = customEmojiMap.get(name)
    return url ? `<img class="custom-emoji" src="${url}" alt=":${name}:" title=":${name}:">` : match
  })

export const dieFaceHtml = (html) =>
  html.replace(/[⚀⚁⚂⚃⚄⚅]/g, c => `<span style="font-size:1.35em;line-height:1;vertical-align:-0.1em">${c}</span>`)

export const EMOTICONS = [
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
export const EMOTICON_LOOKUP = new Map(EMOTICONS)
export const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const EMOTICON_RE = new RegExp(
  '(^|[\\s(\'"])(' + EMOTICONS.map(([k]) => escRe(k) + (k === ':/' || k === ':-/' ? '(?!/)' : '')).join('|') + ')(?=[\\s.,!?;:\'"]|$)',
  'gm'
)

export const replaceEmoticons = (text) => {
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

export const preprocess = (text) => {
  const withEmoticons = replaceEmoticons(text)
  return withEmoticons.replace(URL_RE, (url, offset) => {
    if (/\]\($/.test(withEmoticons.slice(0, offset))) return url
    if (isImageUrl(url)) return `![](${url})`
    if (isAudioUrl(url)) return `[audio](${url})`
    return url
  })
}

export const postprocess = (html) => {
  return html
    .replace(/<a href="([^"]+)"[^>]*>audio<\/a>/g, (_, src) =>
      `<div class="msg-audio-player" data-src="${src}"><button class="audio-play-btn" aria-label="Play"><svg viewBox="0 0 10 10" width="11" height="11" fill="currentColor"><polygon points="1,0.5 9.5,5 1,9.5"/></svg></button><div class="audio-scrub"><div class="audio-scrub-track"><div class="audio-scrub-fill"></div></div><div class="audio-scrub-thumb"></div></div><span class="audio-time">0:00</span><a class="audio-dl-btn" href="${src}" download aria-label="Download"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-14 9v2h14v-2H5z"/></svg></a></div>`)
    .replace(/<a href="([^"]+)"/g, (_, href) =>
      `<a href="${href}" target="_blank" rel="noopener noreferrer"`)
    .replace(/<img src="([^"]+)" alt="([^"]*)"/g, (_, src, alt) =>
      `<img class="msg-img" src="${src}" alt="${alt}" loading="lazy" data-lightbox="${src}"`)
}

export const renderText = (text) =>
  customEmojiHtml(dieFaceHtml(mentionHtml(postprocess(marked.parse(preprocess(text), { async: false })))))

export const giphyGifUrl = (url) => {
  const m = url.match(/^https?:\/\/(?:www\.)?giphy\.com\/gifs\/([^/?#]+)/)
  if (!m) return null
  return `https://media.giphy.com/media/${m[1].split('-').pop()}/giphy.gif`
}

export const isTenorUrl = (url) => /^https?:\/\/(?:www\.)?tenor\.com\/view\//.test(url)
