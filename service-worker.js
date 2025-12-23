// Service Worker for Immunization Tracker PWA
const CACHE_NAME = 'immunization-tracker-v5.0';
const STATIC_CACHE = 'static-cache-v1';
const DYNAMIC_CACHE = 'dynamic-cache-v1';

// Files to cache on install
const STATIC_FILES = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png'
];

// External resources to cache
const EXTERNAL_RESOURCES = [
  'https://fonts.googleapis.com/icon?family=Material+Icons',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://unpkg.com/xlsx/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[Service Worker] Caching static assets');
      return cache.addAll(STATIC_FILES);
    }).then(() => {
      console.log('[Service Worker] Skip waiting on install');
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch event with network-first strategy for API calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip Firebase and external API requests (let them go through)
  if (url.href.includes('firebase') || 
      url.href.includes('googleapis.com') || 
      url.href.includes('gstatic.com')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // If network fails and it's a Firebase request, we can't serve offline
        return new Response(JSON.stringify({ 
          error: 'You are offline. Please connect to sync data.',
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  
  // Cache-first strategy for static assets
  if (url.origin === location.origin && 
      (url.pathname.endsWith('.html') || 
       url.pathname.endsWith('.css') || 
       url.pathname.endsWith('.js') ||
       url.pathname.includes('/icons/'))) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).then((fetchResponse) => {
          // Cache the new resource
          return caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(event.request.url, fetchResponse.clone());
            return fetchResponse;
          });
        });
      }).catch(() => {
        // If offline and not in cache, show offline page for HTML requests
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/offline.html');
        }
      })
    );
  }
  
  // Network-first strategy for data requests
  else if (url.pathname.includes('/api/') || url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        // Clone the response to cache it
        const responseClone = response.clone();
        caches.open(DYNAMIC_CACHE).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(() => {
        // If network fails, try cache
        return caches.match(event.request).then((response) => {
          if (response) {
            return response;
          }
          // Return offline data structure for immunization app
          return new Response(JSON.stringify({
            offline: true,
            message: 'You are offline. Data will sync when connected.',
            timestamp: new Date().toISOString(),
            children: [],
            defaulters: []
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
    );
  }
});

// Background sync for offline data
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-immunization-data') {
    console.log('[Service Worker] Background sync for immunization data');
    event.waitUntil(syncOfflineData());
  }
});

// Function to sync offline data when back online
async function syncOfflineData() {
  console.log('[Service Worker] Syncing offline data...');
  
  try {
    const cache = await caches.open(DYNAMIC_CACHE);
    const requests = await cache.keys();
    
    const pendingSync = requests.filter(req => 
      req.url.includes('/api/') || req.url.includes('/data/')
    );
    
    for (const request of pendingSync) {
      const response = await cache.match(request);
      if (response) {
        // Here you would implement your sync logic
        // For now, just log it
        console.log('[Service Worker] Syncing:', request.url);
        
        // Remove from cache after successful sync
        await cache.delete(request);
      }
    }
    
    console.log('[Service Worker] Sync complete');
    
    // Notify all clients that sync is complete
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        timestamp: new Date().toISOString()
      });
    });
    
  } catch (error) {
    console.error('[Service Worker] Sync error:', error);
  }
}

// Handle push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'New notification from Immunization Tracker',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      timestamp: Date.now()
    },
    actions: [
      {
        action: 'view',
        title: 'View'
      },
      {
        action: 'close',
        title: 'Close'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Immunization Tracker', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'close') {
    return;
  }
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        if (clientList.length > 0) {
          let client = clientList[0];
          for (let i = 0; i < clientList.length; i++) {
            if (clientList[i].focused) {
              client = clientList[i];
            }
          }
          return client.focus();
        }
        return self.clients.openWindow(event.notification.data.url || '/');
      })
  );
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_DATA') {
    // Cache data for offline use
    caches.open(DYNAMIC_CACHE).then((cache) => {
      const response = new Response(JSON.stringify(event.data.payload), {
        headers: { 'Content-Type': 'application/json' }
      });
      cache.put(event.data.url, response);
    });
  }
  
  if (event.data && event.data.type === 'REGISTER_SYNC') {
    self.registration.sync.register('sync-immunization-data')
      .then(() => {
        console.log('[Service Worker] Background sync registered');
      })
      .catch(err => {
        console.error('[Service Worker] Background sync registration failed:', err);
      });
  }
});

// Periodic sync (if browser supports it)
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'periodic-data-sync') {
      console.log('[Service Worker] Periodic sync triggered');
      event.waitUntil(syncOfflineData());
    }
  });
}