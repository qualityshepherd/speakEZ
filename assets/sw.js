self.addEventListener('fetch', e => e.respondWith(fetch(e.request)))

self.addEventListener('push', e => {
  const data = e.data?.json?.() || {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'speakEZ', {
      body: data.body || '',
      icon: '/favicon.png',
      badge: '/favicon.png',
      tag: data.tag || 'speakez',
      data: { url: data.url || '/' },
      renotify: true
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus()
      }
      return clients.openWindow(e.notification.data?.url || '/')
    })
  )
})
