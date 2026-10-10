// app.js — the phone trial's page (W2.T6, design 3.10's untried phone features). Throwaway; nothing in the product
// uses it. No build step, no external scripts.
(function () {
  'use strict';
  var T = self.BMTrial;
  var $ = function (id) { return document.getElementById(id); };
  var STORE_DB = 'bm-storage-test';
  var RECORDS = 20, PHOTOS = 5;
  var MB = 1024 * 1024;

  // ---------- views ----------
  function show(view) {
    var known = false;
    document.querySelectorAll('[data-view]').forEach(function (s) {
      var on = s.getAttribute('data-view') === view;
      s.hidden = !on;
      known = known || on;
    });
    if (!known) return show('home');
    if (view === 'results') renderResults();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { location.hash = b.getAttribute('data-go'); });
  });
  window.addEventListener('hashchange', function () { show(location.hash.slice(1) || 'home'); });

  function env() {
    var ua = navigator.userAgent;
    return {
      ua: ua,
      ios: T.iosVersion(ua),
      safari: T.safariVersion(ua),
      standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      permission: typeof Notification === 'undefined' ? 'not available' : Notification.permission,
      maxActions: typeof Notification !== 'undefined' && typeof Notification.maxActions === 'number' ? Notification.maxActions : 'unknown',
    };
  }

  function errText(e) { return e && e.name ? e.name + ': ' + e.message : String(e); }

  /** Share as plain text (the share sheet: Mail), falling back to Copy. */
  function shareText(title, text, button) {
    if (navigator.share) {
      return navigator.share({ title: title, text: text }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        return copy();
      });
    }
    return copy();
    function copy() {
      var done = function () { button.textContent = 'Copied. Paste it into an email to yourself.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(done, function (e) { button.textContent = 'Could not copy: ' + errText(e); });
      button.textContent = 'Select the text above and copy it.';
    }
  }

  // ---------- service worker ----------
  var swReady = 'serviceWorker' in navigator
    ? navigator.serviceWorker.register('sw.js', { scope: './' }).then(function () { return navigator.serviceWorker.ready; })
    : Promise.reject(new Error('This browser has no service workers'));
  swReady.catch(function () {});

  // ---------- subscribe ----------
  function keyBytes(text) {
    var b64 = text.trim().replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b64 + '==='.slice((b64.length + 3) % 4));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function sameKey(a, b) {
    if (!a || a.byteLength !== b.byteLength) return false;
    var x = new Uint8Array(a);
    for (var i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
    return true;
  }

  $('subscribe-btn').addEventListener('click', function () {
    var status = $('subscribe-status');
    status.textContent = 'Working…';
    var key;
    fetch('vapid-public.txt', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('vapid-public.txt is missing from the site (the PC step "init" writes it)'); return r.text(); })
      .then(function (text) { key = keyBytes(text); if (key.length !== 65) throw new Error('vapid-public.txt is not a P-256 public key'); })
      .then(function () {
        if (typeof Notification === 'undefined' || !('PushManager' in window)) throw new Error('No push here. Open the app from its Home Screen icon (iOS 16.4 or later).');
        return Notification.requestPermission();
      })
      .then(function (p) { if (p !== 'granted') throw new Error('Notifications are ' + p + '. Allow them in Settings > Notifications > Phone Trial.'); return swReady; })
      .then(function (reg) {
        return reg.pushManager.getSubscription().then(function (old) {
          if (old && sameKey(old.options && old.options.applicationServerKey, key)) return old;
          return (old ? old.unsubscribe() : Promise.resolve()).then(function () {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          });
        });
      })
      .then(function (sub) {
        var text = JSON.stringify(sub.toJSON(), null, 1);
        status.textContent = 'Notifications are on. Share this text to your email:';
        $('subscription').textContent = text;
        $('subscription').hidden = false;
        var btn = $('subscription-share');
        btn.hidden = false;
        btn.onclick = function () { shareText('Phone trial subscription', text, btn); };
      })
      .catch(function (e) { status.textContent = 'Did not work: ' + errText(e); status.className = 'warn'; });
  });

  // ---------- results ----------
  function renderResults() {
    var pre = $('results-text');
    return Promise.all([T.pushes(), T.clicks()]).then(function (r) {
      pre.textContent = T.resultsText(r[0], r[1], env());
    }, function (e) { pre.textContent = 'Could not read the log: ' + errText(e); });
  }
  $('results-share').addEventListener('click', function () {
    var btn = $('results-share');
    renderResults().then(function () { shareText('Phone trial results', $('results-text').textContent, btn); });
  });

  // ---------- storage test (its own database; nothing else opens it) ----------
  function idb(r) {
    return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error); }; });
  }
  function openStore() {
    var r = indexedDB.open(STORE_DB, 1);
    r.onupgradeneeded = function () {
      var db = r.result;
      ['records', 'photos', 'meta'].forEach(function (name) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      });
    };
    return idb(r);
  }
  function getAll(db, store) { return idb(db.transaction(store, 'readonly').objectStore(store).getAll()); }

  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }
  function sha256(blob) {
    return new Response(blob).arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(hex);
  }

  /** One photo-sized JPEG of random noise, 2-3 MB: the size is measured and the picture redrawn bigger or smaller. */
  function noiseJpeg(n) {
    var area = 1.6e6; // pixels; a first guess, corrected from the measured size
    function draw(tries) {
      var w = Math.round(Math.sqrt(area * 4 / 3)), h = Math.round(w * 3 / 4);
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      var img = ctx.createImageData(w, h);
      var px = img.data, chunk = new Uint8Array(65536);
      for (var i = 0; i < px.length; i += 65536) {
        crypto.getRandomValues(chunk);
        px.set(chunk.subarray(0, Math.min(65536, px.length - i)), i);
      }
      for (var a = 3; a < px.length; a += 4) px[a] = 255;
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 120px sans-serif'; ctx.fillText('Photo ' + n, 40, 160);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('the canvas made no JPEG')); }, 'image/jpeg', 0.92);
      }).then(function (blob) {
        canvas.width = 1; canvas.height = 1; // let iOS free the canvas memory
        if ((blob.size >= 2 * MB && blob.size <= 3 * MB) || tries >= 4) return { blob: blob, width: w, height: h };
        area = area * (2.5 * MB / blob.size);
        return draw(tries + 1);
      });
    }
    return draw(1);
  }

  function storageText(lines) { return ['Storage test (W2.T6)'].concat(lines).join('\n'); }
  function estimateLine(est) {
    return est ? 'storage used ' + (est.usage / MB).toFixed(1) + ' MB of ' + (est.quota / MB).toFixed(0) + ' MB allowed' : 'estimate not available';
  }

  $('storage-run').addEventListener('click', function () {
    var btn = $('storage-run'), status = $('storage-status');
    btn.disabled = true;
    var db, made = new Date().toISOString(), photos = [], meta = {};
    openStore().then(function (d) { db = d; return idb(db.transaction('meta', 'readonly').objectStore('meta').get('run')); })
      .then(function (old) {
        if (old) { status.textContent = 'Already run on ' + old.date + '. It runs only once. Do not run it again.'; status.className = 'warn'; throw null; }
        var chain = Promise.resolve();
        for (var n = 1; n <= PHOTOS; n++) (function (n) {
          chain = chain.then(function () {
            status.textContent = 'Making photo ' + n + ' of ' + PHOTOS + '…';
            return noiseJpeg(n);
          }).then(function (p) {
            return sha256(p.blob).then(function (h) {
              photos.push({ id: 'photo-' + n, blob: p.blob, bytes: p.blob.size, width: p.width, height: p.height, sha256: h, made: made });
            });
          });
        })(n);
        return chain;
      })
      .then(function () {
        status.textContent = 'Saving…';
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(['records', 'photos'], 'readwrite');
          for (var i = 1; i <= RECORDS; i++) {
            tx.objectStore('records').put({ id: 'record-' + (i < 10 ? '0' : '') + i, made: made, text: 'Unsent tap ' + i + ' of ' + RECORDS + ': job marked done' });
          }
          photos.forEach(function (p) { tx.objectStore('photos').put(p); });
          tx.oncomplete = resolve;
          tx.onerror = function () { reject(tx.error); };
          tx.onabort = function () { reject(tx.error || new Error('the save was stopped (storage full?)')); };
        });
      })
      .then(function () {
        status.textContent = 'Asking the iPhone to keep it…';
        if (!navigator.storage || !navigator.storage.persist) return 'not available';
        return navigator.storage.persist().then(function (a) { return a ? 'yes (kept)' : 'no (may be cleaned up)'; }, function (e) { return 'error: ' + errText(e); });
      })
      .then(function (answer) {
        meta.persist = answer;
        return navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(function () { return null; }) : null;
      })
      .then(function (est) {
        var e = env();
        meta = { id: 'run', date: made, persist: meta.persist, estimate: est ? { usage: est.usage, quota: est.quota } : null, ios: e.ios, ua: e.ua,
          records: RECORDS, photos: photos.map(function (p) { return { id: p.id, bytes: p.bytes, sha256: p.sha256 }; }) };
        return idb(db.transaction('meta', 'readwrite').objectStore('meta').put(meta));
      })
      .then(function () {
        var text = storageText([
          'Run on ' + meta.date + ' (iOS from the browser: ' + (meta.ios || '?') + ')',
          'Saved ' + RECORDS + ' records and ' + PHOTOS + ' photos (' + photos.map(function (p) { return (p.bytes / MB).toFixed(2) + ' MB'; }).join(', ') + ')',
          'Asked the iPhone to keep it (persist): ' + meta.persist,
          'Estimate: ' + estimateLine(meta.estimate),
          'Photo fingerprints (SHA-256):',
        ].concat(meta.photos.map(function (p) { return '  ' + p.id + ' ' + p.sha256; })));
        status.textContent = '';
        $('storage-text').textContent = text;
        $('storage-text').hidden = false;
        var share = $('storage-share');
        share.hidden = false;
        share.onclick = function () { shareText('Phone trial storage test', text, share); };
        $('storage-done').hidden = false;
        $('storage-back').hidden = true;
      })
      .catch(function (e) {
        if (e === null) return;
        status.textContent = 'Did not finish: ' + errText(e);
        status.className = 'warn';
        btn.disabled = false;
      })
      .then(function () { if (db) db.close(); });
  });

  $('read-run').addEventListener('click', function () {
    var pre = $('read-text'), db, records, photos, meta;
    pre.hidden = false;
    pre.textContent = 'Reading…';
    openStore().then(function (d) { db = d; return Promise.all([getAll(db, 'records'), getAll(db, 'photos'), getAll(db, 'meta')]); })
      .then(function (r) {
        records = r[0]; photos = r[1]; meta = r[2].filter(function (m) { return m.id === 'run'; })[0] || null;
        return Promise.all(photos.map(function (p) {
          return (p.blob instanceof Blob ? sha256(p.blob) : Promise.resolve('no picture')).then(function (h) {
            var saved = meta ? (meta.photos.filter(function (m) { return m.id === p.id; })[0] || {}).sha256 : null;
            return { id: p.id, ok: h === p.sha256 && (saved == null || saved === h), hash: h };
          });
        }));
      })
      .then(function (checks) {
        return (navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(function () { return null; }) : Promise.resolve(null))
          .then(function (est) {
            var good = checks.filter(function (c) { return c.ok; }).length;
            var survived = records.length + photos.length;
            var text = storageText([
              'Read on ' + new Date().toISOString() + ' (iOS from the browser: ' + (T.iosVersion(navigator.userAgent) || '?') + ')',
              'Run on: ' + (meta ? meta.date : 'unknown (the run note is gone)'),
              'Records: ' + records.length + ' of ' + RECORDS,
              'Photos: ' + photos.length + ' of ' + PHOTOS + '; fingerprints matching: ' + good + ' of ' + PHOTOS,
              'Survived: ' + survived + ' of ' + (RECORDS + PHOTOS) + (survived === RECORDS + PHOTOS && good === PHOTOS ? ' (all kept)' : ' (SOMETHING WAS LOST)'),
              'Asked to keep it then: ' + (meta ? meta.persist : 'unknown'),
              'Estimate now: ' + estimateLine(est),
            ].concat(checks.map(function (c) { return '  ' + c.id + ' ' + (c.ok ? 'matches' : 'DIFFERS') + ' ' + c.hash; })));
            pre.textContent = text;
            var share = $('read-share');
            share.hidden = false;
            share.onclick = function () { shareText('Phone trial storage read', text, share); };
          });
      })
      .catch(function (e) { pre.textContent = 'Could not read: ' + errText(e); })
      .then(function () { if (db) db.close(); });
  });

  // ---------- passkey (for the desktop-app trial under Electron) ----------
  function rand(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
  $('passkey-run').addEventListener('click', function () {
    var pre = $('passkey-text');
    pre.hidden = false;
    var lines = ['Passkey check on ' + location.host + ', ' + new Date().toISOString(), 'User agent: ' + navigator.userAgent];
    var say = function (l) { lines.push(l); pre.textContent = lines.join('\n'); };
    say('Making a passkey…');
    if (!window.PublicKeyCredential || !navigator.credentials) { say('RESULT: no passkeys here (PublicKeyCredential is missing)'); return; }
    navigator.credentials.create({ publicKey: {
      rp: { id: location.hostname, name: 'Phone Trial' },
      user: { id: rand(16), name: 'phone-trial', displayName: 'Phone trial' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      timeout: 120000,
    } }).then(function (cred) {
      say('Made: yes (id ' + cred.id.slice(0, 16) + '…, type ' + cred.type + ')');
      say('Signing in with it…');
      return navigator.credentials.get({ publicKey: {
        rpId: location.hostname, challenge: rand(32), userVerification: 'preferred', timeout: 120000,
        allowCredentials: [{ type: 'public-key', id: cred.rawId }],
      } });
    }).then(function (got) {
      say('Signed in: yes (same passkey: ' + (got && got.id ? 'yes' : '?') + ')');
      say('RESULT: the passkey works here');
    }, function (e) {
      say('RESULT: did not work: ' + errText(e));
    });
  });

  // ---------- start ----------
  var e = env();
  $('env-line').textContent = (e.ios ? 'iOS ' + e.ios + ' (as the browser reports it)' : 'Not an iPhone') + ' · ' + (e.standalone ? 'opened from the Home Screen' : 'opened in the browser');
  $('install-note').hidden = !(e.ios && !e.standalone);
  show(location.hash.slice(1) || 'home');
})();
