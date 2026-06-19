const CACHE_NAME = 'memo-app-v1';
const urlsToCache = [
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Only handle same-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(response => {
          // Don't cache non-successful responses
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
  );
});

// Handle push notifications (for alarm reminders)
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '📝 备忘录提醒';
  const options = {
    body: data.body || '您有新的提醒',
    icon: data.icon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📝</text></svg>',
    badge: '📝',
    tag: data.tag || 'memo',
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: data.data || {}
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes('/workspace/memo-app/') && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow('/workspace/memo-app/index.html');
      }
    })
  );
});

// Periodic background sync for alarm checks (if supported)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'alarm-check') {
    event.waitUntil(checkAlarmsAndNotify());
  }
});

async function checkAlarmsAndNotify() {
  // This runs in service worker context
  // The main page handles alarm checking, this is a fallback
  const db = await openDatabase();
  const alarms = await getAllAlarms(db);
  const now = Date.now();
  
  for (const alarm of alarms) {
    if (!alarm.triggered) {
      const at = new Date(alarm.time).getTime();
      if (at <= now) {
        alarm.triggered = true;
        await updateAlarm(db, alarm);
        self.registration.showNotification('📝 备忘录提醒', {
          body: alarm.body || '您有提醒',
          tag: `alarm-${alarm.id}`,
          requireInteraction: true,
          vibrate: [200, 100, 200]
        });
      }
    }
  }
}

// IndexedDB helpers in service worker
function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('MemoDB_v1', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function getAllAlarms(database) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('alarms', 'readonly');
    const req = tx.objectStore('alarms').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function updateAlarm(database, alarm) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('alarms', 'readwrite');
    const req = tx.objectStore('alarms').put(alarm);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
