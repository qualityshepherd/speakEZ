const INTERNAL_HOST = /^(localhost$|127\.|0\.0\.0\.0|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|\[)/

export const giphyGifUrl = (url) => {
  const m = url.match(/^https?:\/\/(?:www\.)?giphy\.com\/gifs\/([^/?#]+)/)
  if (!m) return null
  const id = m[1].split('-').pop()
  return `https://media.giphy.com/media/${id}/giphy.gif`
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const fetchPageOG = async (target, fetchFn) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)

  let res
  try {
    res = await fetchFn(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' },
      redirect: 'manual',
      signal: ctrl.signal
    })
  } finally {
    clearTimeout(timer)
  }

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || ''
    let locUrl
    try { locUrl = new URL(loc) } catch { return {} }
    if (!['http:', 'https:'].includes(locUrl.protocol)) return {}
    if (INTERNAL_HOST.test(locUrl.hostname)) return {}
    return fetchPageOG(locUrl.href, fetchFn)
  }

  if (!res.ok) return {}

  const og = { title: null, description: null, image: null, site_name: null }
  let titleText = ''

  await new HTMLRewriter()
    .on('meta', {
      element (el) {
        const prop = el.getAttribute('property')
        const name = el.getAttribute('name')
        const content = el.getAttribute('content')
        if (!content) return
        if (prop === 'og:title') og.title = content
        else if (prop === 'og:description') og.description = content
        else if (prop === 'og:image') og.image = content
        else if (prop === 'og:site_name') og.site_name = content
        else if (name === 'description' && !og.description) og.description = content
      }
    })
    .on('title', {
      text (chunk) { titleText += chunk.text }
    })
    .transform(res)
    .text()

  if (!og.title && titleText.trim()) og.title = titleText.trim()
  return og
}

const YOUTUBE_HOST = /^(www\.|m\.)?youtube\.com$|^youtu\.be$/

export const isTenorUrl = (url) => /^https?:\/\/(?:www\.)?tenor\.com\/view\//.test(url)

const fetchYouTubeOG = async (target, fetchFn) => {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`
  const res = await fetchFn(oembedUrl)
  if (!res.ok) return {}
  const data = await res.json()
  return {
    title: data.title || null,
    description: null,
    image: data.thumbnail_url || null,
    site_name: data.provider_name || 'YouTube'
  }
}

export const handleOG = async (req, env, fetchFn = fetch) => {
  const url = new URL(req.url)
  const target = url.searchParams.get('url')
  if (!target) return json({ error: 'missing url' }, 400)

  let targetUrl
  try { targetUrl = new URL(target) } catch { return json({ error: 'invalid url' }, 400) }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) return json({ error: 'invalid url' }, 400)
  if (INTERNAL_HOST.test(targetUrl.hostname)) return json({ error: 'invalid url' }, 400)

  try {
    const og = YOUTUBE_HOST.test(targetUrl.hostname)
      ? await fetchYouTubeOG(target, fetchFn)
      : await fetchPageOG(target, fetchFn)
    return json(og)
  } catch {
    return json({})
  }
}
