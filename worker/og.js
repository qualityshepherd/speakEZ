const INTERNAL_HOST = /^(localhost$|127\.|0\.0\.0\.0|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const fetchPageOG = async (target, fetchFn) => {
  const res = await fetchFn(target, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' } })
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

const fetchYouTubeOG = async (target, fetchFn) => {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`
  const res = await fetchFn(oembedUrl)
  if (!res.ok) return null
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
      ? (await fetchYouTubeOG(target, fetchFn) ?? await fetchPageOG(target, fetchFn))
      : await fetchPageOG(target, fetchFn)
    return json(og)
  } catch {
    return json({})
  }
}
