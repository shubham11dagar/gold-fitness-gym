self.addEventListener('fetch', (event) => {
  // Basic pass-through fetch handler for PWA installation criteria
  event.respondWith(fetch(event.request));
});
