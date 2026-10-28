/*
 * SMASH. – database-koppeling voor de losse website (Render).
 *
 * De app is gebouwd op een Firestore-achtige database (collection/doc/where/get/set/...).
 * Binnen Claude levert window.claude die database. Buiten Claude (op Render) bestaat
 * window.claude niet, dus bootsen we hier dezelfde functies na bovenop Supabase.
 *
 * Alles staat in één tabel "docs":
 *   path  = volledig pad, bv. "players/abc" of "plannen/X/reacties/Y"
 *   coll  = alles vóór de laatste "/", bv. "players"
 *   data  = de inhoud van het document (JSON)
 */
(function () {
  'use strict';
  if (window.claude) return; // binnen Claude: gebruik de echte database

  var cfg = window.SMASH_CONFIG || {};
  window.SMASH_STANDALONE = true;

  var sb = null;
  function client() {
    if (sb) return sb;
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseKey) {
      throw new Error('Supabase is nog niet ingesteld (config.js).');
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return sb;
  }

  // ---------- hulpjes ----------
  function cleanPath(p) { return String(p || '').replace(/^\/+|\/+$/g, ''); }
  function splitPath(p) {
    p = cleanPath(p);
    var i = p.lastIndexOf('/');
    if (i <= 0) throw new Error('Ongeldig documentpad: ' + p);
    return { path: p, coll: p.slice(0, i), id: p.slice(i + 1) };
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function newId() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var out = '';
    var arr = new Uint8Array(20);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    for (var i = 0; i < arr.length; i++) out += chars[arr[i] % chars.length];
    return out;
  }
  function check(res) {
    if (res.error) throw new Error(res.error.message || 'Databasefout');
    return res.data;
  }
  function sameValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a == b;
    if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
    return false;
  }

  // ---------- snapshots ----------
  function makeDocSnap(id, path, data) {
    var exists = data != null;
    return {
      id: id,
      exists: exists,
      ref: docRef(path),
      data: function () { return exists ? clone(data) : undefined; },
      get: function (field) { return exists && data ? clone(data[field]) : undefined; }
    };
  }
  function makeQuerySnap(rows) {
    var docs = rows.map(function (r) { var s = splitPath(r.path); return makeDocSnap(s.id, s.path, r.data); });
    return {
      docs: docs,
      empty: docs.length === 0,
      size: docs.length,
      forEach: function (fn, thisArg) { docs.forEach(fn, thisArg); }
    };
  }

  // ---------- live-updates (onSnapshot) via korte polling ----------
  var listeners = [];
  var POLL_MS = 3000;
  function refreshAll() { listeners.forEach(function (l) { l.refresh(); }); }
  function listen(fetchFn, onNext, onError) {
    var last = null, stopped = false, busy = false, timer = null;
    var l = {
      refresh: function () {
        if (stopped || busy) return;
        busy = true;
        fetchFn().then(function (snap) {
          busy = false;
          if (stopped) return;
          var key = JSON.stringify(snap.raw);
          if (key !== last) { last = key; onNext(snap.snap); }
        }, function (err) {
          busy = false;
          if (!stopped && typeof onError === 'function') onError(err);
        });
      }
    };
    listeners.push(l);
    l.refresh();
    timer = setInterval(l.refresh, POLL_MS);
    return function unsubscribe() {
      stopped = true;
      clearInterval(timer);
      listeners = listeners.filter(function (x) { return x !== l; });
    };
  }

  // ---------- documenten ----------
  async function readDoc(path) {
    var rows = check(await client().from('docs').select('path,data').eq('path', path).limit(1));
    return rows && rows.length ? rows[0].data : null;
  }
  async function writeDoc(path, coll, data) {
    check(await client().from('docs').upsert(
      { path: path, coll: coll, data: data, updated_at: new Date().toISOString() },
      { onConflict: 'path' }
    ));
  }

  function docRef(path) {
    var p = splitPath(path);
    return {
      id: p.id,
      path: p.path,
      get: async function () { return makeDocSnap(p.id, p.path, await readDoc(p.path)); },
      set: async function (data, opts) {
        var next = clone(data) || {};
        if (opts && opts.merge) {
          var cur = await readDoc(p.path);
          next = Object.assign({}, cur || {}, next);
        }
        await writeDoc(p.path, p.coll, next);
        refreshAll();
      },
      update: async function (patch) {
        var cur = await readDoc(p.path);
        if (cur == null) throw new Error('Document bestaat niet: ' + p.path);
        await writeDoc(p.path, p.coll, Object.assign({}, cur, clone(patch) || {}));
        refreshAll();
      },
      delete: async function () {
        check(await client().from('docs').delete().eq('path', p.path));
        refreshAll();
      },
      onSnapshot: function (onNext, onError) {
        return listen(async function () {
          var data = await readDoc(p.path);
          return { raw: data, snap: makeDocSnap(p.id, p.path, data) };
        }, onNext, onError);
      }
    };
  }

  // ---------- collecties & queries ----------
  function query(coll, filters, order, max) {
    async function fetchRows() {
      var all = [], from = 0, PAGE = 1000;
      for (;;) {
        var q = client().from('docs').select('path,data').eq('coll', coll);
        filters.forEach(function (f) {
          var o = {};
          if (f.op === '==') { o[f.field] = f.value; q = q.contains('data', o); }
          else if (f.op === 'array-contains') { o[f.field] = [f.value]; q = q.contains('data', o); }
        });
        var rows = check(await q.order('path').range(from, from + PAGE - 1));
        all = all.concat(rows || []);
        if (!rows || rows.length < PAGE) break;
        from += PAGE;
      }
      // exacte controle (zoals Firestore)
      all = all.filter(function (r) {
        var d = r.data || {};
        return filters.every(function (f) {
          var v = d[f.field];
          if (f.op === '==') return sameValue(v, f.value);
          if (f.op === 'array-contains') return Array.isArray(v) && v.some(function (x) { return sameValue(x, f.value); });
          if (f.op === '!=') return !sameValue(v, f.value);
          if (f.op === '<') return v < f.value;
          if (f.op === '<=') return v <= f.value;
          if (f.op === '>') return v > f.value;
          if (f.op === '>=') return v >= f.value;
          if (f.op === 'in') return Array.isArray(f.value) && f.value.some(function (x) { return sameValue(v, x); });
          return true;
        });
      });
      if (order.length) {
        all.sort(function (a, b) {
          for (var i = 0; i < order.length; i++) {
            var o = order[i];
            var x = (a.data || {})[o.field], y = (b.data || {})[o.field];
            if (x === y) continue;
            if (x == null) return o.dir === 'desc' ? 1 : -1;
            if (y == null) return o.dir === 'desc' ? -1 : 1;
            var c = x < y ? -1 : 1;
            return o.dir === 'desc' ? -c : c;
          }
          return 0;
        });
      }
      if (max != null) all = all.slice(0, max);
      return all;
    }
    return {
      where: function (field, op, value) { return query(coll, filters.concat([{ field: field, op: op, value: value }]), order, max); },
      orderBy: function (field, dir) { return query(coll, filters, order.concat([{ field: field, dir: dir === 'desc' ? 'desc' : 'asc' }]), max); },
      limit: function (n) { return query(coll, filters, order, n); },
      get: async function () { return makeQuerySnap(await fetchRows()); },
      onSnapshot: function (onNext, onError) {
        return listen(async function () {
          var rows = await fetchRows();
          return { raw: rows, snap: makeQuerySnap(rows) };
        }, onNext, onError);
      }
    };
  }

  function collectionRef(path) {
    var coll = cleanPath(path);
    var base = query(coll, [], [], null);
    base.id = coll.split('/').pop();
    base.path = coll;
    base.doc = function (id) { return docRef(coll + '/' + (id || newId())); };
    base.add = async function (data) {
      var ref = docRef(coll + '/' + newId());
      await ref.set(data);
      return ref;
    };
    return base;
  }

  var db = {
    collection: function (path) { return collectionRef(path); },
    doc: function (path) { return docRef(path); }
  };

  // ---------- "user": wie kijkt er ----------
  function viewerId() {
    try {
      var id = localStorage.getItem('smash_viewer_id');
      if (!id) { id = 'v-' + newId(); localStorage.setItem('smash_viewer_id', id); }
      return id;
    } catch (e) { return null; }
  }
  var user = {
    id: async function () { return viewerId(); },
    isOwner: async function () {
      var owners = (cfg.ownerEmails || []).map(function (e) { return String(e).toLowerCase().trim(); });
      if (!owners.length) return false;
      var email = null;
      try { email = localStorage.getItem('padel_session_email'); } catch (e) {}
      return !!email && owners.indexOf(String(email).toLowerCase().trim()) !== -1;
    }
  };

  // Lege database? Zet dan eenmalig de clublijst (clubs-seed.json) erin.
  var seeded = null;
  function seedClubsOnce() {
    if (seeded) return seeded;
    seeded = (async function () {
      var have = check(await client().from('docs').select('path').eq('coll', 'clubs').limit(1));
      if (have && have.length) return;
      var res = await fetch('clubs-seed.json', { cache: 'no-store' });
      if (!res.ok) return;
      var clubs = await res.json();
      var now = new Date().toISOString();
      var rows = Object.keys(clubs).map(function (id) {
        return { path: 'clubs/' + id, coll: 'clubs', data: clubs[id], updated_at: now };
      });
      check(await client().from('docs').upsert(rows, { onConflict: 'path', ignoreDuplicates: true }));
    })().catch(function (e) { console.error('Clubs vullen mislukt:', e); });
    return seeded;
  }

  window.claude = {
    use: async function (name) {
      if (name === 'db') {
        try { client(); } catch (e) { console.error(e); return null; }
        await seedClubsOnce();
        return db;
      }
      if (name === 'user') return user;
      return null; // 'sample', 'downloads' e.d. bestaan alleen binnen Claude
    }
  };
})();
