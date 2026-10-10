// sw.js — the phone trial's service worker (W2.T6). Shows every push, logs it, sets the icon number from the
// payload, and logs which button (if any) a tap on a push used. Throwaway; nothing in the product uses it.
importScripts('shared.js');

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

function setBadge(badge) {
  if (typeof badge !== 'number') return Promise.resolve(null);
  var nav = self.navigator;
  if (badge > 0 && nav.setAppBadge) return nav.setAppBadge(badge).then(function () { return 'set to ' + badge; }, function (e) { return 'refused: ' + e.name + ': ' + e.message; });
  if (badge === 0 && nav.clearAppBadge) return nav.clearAppBadge().then(function () { return 'cleared'; }, function (e) { return 'refused: ' + e.name + ': ' + e.message; });
  return Promise.resolve('not available here');
}

function show(payload) {
  var options = {
    body: payload.body || '',
    tag: String(payload.id || ''),
    icon: 'icon-192.png',
    data: { id: payload.id, kind: payload.kind },
  };
  if (Array.isArray(payload.actions)) {
    options.actions = payload.actions;
    return self.registration.showNotification(payload.title || 'Phone trial', options)
      .then(function () { return 'shown with ' + payload.actions.length + ' buttons asked (maxActions ' + maxActions() + ')'; },
        function (e) {
          delete options.actions;
          return self.registration.showNotification(payload.title || 'Phone trial', options)
            .then(function () { return 'buttons refused (' + e.name + ': ' + e.message + '), shown without them'; });
        });
  }
  return self.registration.showNotification(payload.title || 'Phone trial', options).then(function () { return null; });
}

function maxActions() {
  return self.Notification && typeof self.Notification.maxActions === 'number' ? self.Notification.maxActions : 'unknown';
}

self.addEventListener('push', function (event) {
  var arrival = Date.now();
  var payload;
  try { payload = event.data ? event.data.json() : {}; } catch (e) {
    payload = { title: 'Phone trial push', body: event.data ? event.data.text() : '', kind: 'unreadable' };
  }
  var shown = show(payload).catch(function (e) { return 'not shown: ' + e.name + ': ' + e.message; });
  event.waitUntil(Promise.all([shown, setBadge(payload.badge)]).then(function (r) {
    return self.BMTrial.logPush(payload, arrival, { actionsResult: r[0], badgeResult: r[1], maxActions: maxActions() });
  }));
});

self.addEventListener('notificationclick', function (event) {
  var n = event.notification;
  n.close();
  var data = n.data || {};
  event.waitUntil(self.BMTrial.logClick({ at: Date.now(), pushId: data.id || n.tag || '?', kind: data.kind || '?', action: event.action || '' })
    .then(function () { return self.clients.matchAll({ type: 'window', includeUncontrolled: true }); })
    .then(function (list) {
      var url = new URL('./#results', self.registration.scope).href;
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) { if ('navigate' in list[i]) list[i].navigate(url); return list[i].focus(); }
      }
      return self.clients.openWindow(url);
    }));
});
