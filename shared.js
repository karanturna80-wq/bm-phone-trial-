// shared.js — the phone trial's push log, used by the page and by the service worker (importScripts).
// Throwaway probe for W2.T6 (design 3.10's untried phone features); nothing in the product uses it.
//
// The push log lives in its own IndexedDB database ('bm-trial-log'). The storage test has a separate one
// ('bm-storage-test', app.js) that the log and the results view never open.
(function (scope) {
  'use strict';
  var LOG_DB = 'bm-trial-log';

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function openLog() {
    var r = indexedDB.open(LOG_DB, 1);
    r.onupgradeneeded = function () {
      var db = r.result;
      if (!db.objectStoreNames.contains('pushes')) db.createObjectStore('pushes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('clicks')) db.createObjectStore('clicks', { keyPath: 'n', autoIncrement: true });
    };
    return req(r);
  }

  function put(store, value) {
    return openLog().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function all(store) {
    return openLog().then(function (db) {
      return req(db.transaction(store, 'readonly').objectStore(store).getAll()).then(function (rows) { db.close(); return rows; });
    });
  }

  /** One push as logged: arrival and send time (ms), title, line count, badge and what setting it did. */
  function pushRecord(payload, arrival, extra) {
    var body = typeof payload.body === 'string' ? payload.body : '';
    return Object.assign({
      id: String(payload.id || ('push-' + arrival)),
      kind: String(payload.kind || 'unknown'),
      seq: payload.seq || 1,
      of: payload.of || 1,
      title: String(payload.title || ''),
      lines: body === '' ? 0 : body.split('\n').length,
      sentAt: typeof payload.sentAt === 'number' ? payload.sentAt : null,
      arrivedAt: arrival,
      badge: typeof payload.badge === 'number' ? payload.badge : null,
      actionsSent: Array.isArray(payload.actions) ? payload.actions.map(function (a) { return a.title; }) : [],
    }, extra || {});
  }

  /** Seconds from the PC's send to the phone's arrival, one decimal; null when the push carried no send time. */
  function delaySeconds(p) {
    return typeof p.sentAt === 'number' ? Math.round((p.arrivedAt - p.sentAt) / 100) / 10 : null;
  }

  /** "18.6" from an iPhone user agent, or null. */
  function iosVersion(ua) {
    var m = /(?:iPhone|iPad|CPU) OS (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua || '');
    return m ? m[1] + '.' + m[2] + (m[3] ? '.' + m[3] : '') : null;
  }
  function safariVersion(ua) {
    var m = /Version\/(\d+(?:\.\d+)*)/.exec(ua || '');
    return m ? m[1] : null;
  }

  function time(ms) { return ms == null ? '?' : new Date(ms).toLocaleTimeString('en-US', { hour12: false }); }

  /** The results as plain text: the same lines the results view shows. */
  function resultsText(pushes, clicks, env) {
    var lines = ['Phone trial results (W2.T6), ' + new Date().toISOString()];
    lines.push('iOS (from the browser): ' + (env.ios || 'not an iPhone') + '; Safari ' + (env.safari || '?'));
    lines.push('Opened from the Home Screen: ' + (env.standalone ? 'yes' : 'no') + '; notifications: ' + env.permission +
      '; buttons a push can carry (Notification.maxActions): ' + env.maxActions);
    lines.push('User agent: ' + env.ua);
    lines.push('');
    lines.push('Pushes logged: ' + pushes.length);
    pushes.slice().sort(function (a, b) { return a.arrivedAt - b.arrivedAt; }).forEach(function (p) {
      var d = delaySeconds(p);
      lines.push('- ' + p.kind + ' ' + p.seq + '/' + p.of + ' "' + p.title + '": sent ' + time(p.sentAt) + ', arrived ' + time(p.arrivedAt) +
        ', arrival - send ' + (d == null ? '?' : d + ' s') + ', lines ' + p.lines +
        (p.badge != null ? ', badge ' + p.badge + ' (' + (p.badgeResult || '?') + ')' : '') +
        (p.actionsSent.length ? ', buttons sent: ' + p.actionsSent.join(' | ') + ' (' + (p.actionsResult || '?') + ')' : ''));
    });
    var timing = pushes.filter(function (p) { return p.kind === 'timing'; }).map(delaySeconds).filter(function (d) { return d != null; });
    if (timing.length) {
      lines.push('Timing pushes: ' + timing.length + ' of 10 arrived; slowest ' + Math.max.apply(null, timing) + ' s; over 120 s: ' +
        timing.filter(function (d) { return d > 120; }).length);
    }
    lines.push('');
    lines.push('Taps on a push: ' + clicks.length);
    clicks.forEach(function (c) {
      lines.push('- ' + time(c.at) + ' on ' + c.pushId + ': ' + (c.action ? 'button "' + c.action + '"' : 'the push itself (no button)'));
    });
    return lines.join('\n');
  }

  scope.BMTrial = {
    logPush: function (payload, arrival, extra) { var rec = pushRecord(payload, arrival, extra); return put('pushes', rec).then(function () { return rec; }); },
    logClick: function (click) { return put('clicks', click); },
    pushes: function () { return all('pushes'); },
    clicks: function () { return all('clicks'); },
    delaySeconds: delaySeconds,
    iosVersion: iosVersion,
    safariVersion: safariVersion,
    resultsText: resultsText,
  };
})(self);
