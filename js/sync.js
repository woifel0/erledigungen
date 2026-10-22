/*
 * Geräte-Sync über Supabase.
 *
 * - Lokale Änderungen landen in einer Warteschlange (überlebt Neuladen und
 *   Offline-Phasen) und werden gebündelt hochgeladen.
 * - Änderungen anderer Geräte kommen live per Realtime; beim Start, beim
 *   Zurückkehren in die App und nach Verbindungsabbrüchen wird alles
 *   Verpasste nachgeladen.
 * - Konflikte: neuere Änderung gewinnt – im Browser (store.js) und auf dem
 *   Server (upsert_notes) nach derselben Regel.
 */
(function (global) {
  'use strict';

  const E = global.Erledigungen;
  const cfg = global.ERLEDIGUNGEN_CONFIG;
  const listeners = new Set();

  const state = { status: 'off', user: null, error: null, lastSyncedAt: null, recovery: false };

  function emit() {
    document.documentElement.dataset.sync = state.status;
    for (const fn of listeners) {
      try {
        fn({ ...state });
      } catch (e) {
        console.error(e);
      }
    }
  }

  const api = {
    enabled: false,
    getState: () => ({ ...state }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  E.sync = api;

  if (!cfg || !global.supabase || !E.store) {
    state.status = 'unavailable';
    emit();
    return;
  }

  const PENDING_KEY = 'erledigungen.sync.pending.v1';
  const CURSOR_KEY = 'erledigungen.sync.cursor.v1';
  const PAGE = 1000;
  const BATCH = 200;

  const client = global.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'erledigungen.auth',
    },
  });

  /* ---------- Hilfen ---------- */

  function readJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignorieren */
    }
  }

  const stamp = (n) => `${n.updatedAt}:${n.openedAt}`;

  function toRow(n) {
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      folder: n.folder,
      created_at: n.createdAt,
      updated_at: n.updatedAt,
      opened_at: n.openedAt,
      deleted: n.deleted,
      updated_by: n.updatedBy,
    };
  }

  function fromRow(r) {
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      folder: r.folder,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      openedAt: Number(r.opened_at),
      deleted: r.deleted === true,
      updatedBy: r.updated_by,
    };
  }

  function setStatus(status, error) {
    state.status = status;
    state.error = error || null;
    if (status === 'synced') state.lastSyncedAt = Date.now();
    emit();
  }

  function isNetworkError(err) {
    if (!navigator.onLine) return true;
    const msg = String((err && (err.message || err)) || '');
    return /fetch|network|load failed|timeout/i.test(msg);
  }

  /* ---------- Warteschlange ---------- */

  const pending = new Map(Object.entries(readJSON(PENDING_KEY, {})));
  const savePending = () => writeJSON(PENDING_KEY, Object.fromEntries(pending));

  let store = null; // { apply, snapshot }
  let flushTimer = 0;
  let retryTimer = 0;
  let retryDelay = 2000;
  let flushing = null;
  let running = null;
  let channel = null;

  E.store.useSync({
    connect(handle) {
      store = handle;
    },
    push(notes) {
      for (const n of notes) pending.set(n.id, stamp(n));
      savePending();
      scheduleFlush();
    },
  });

  function scheduleFlush() {
    if (!state.user) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flush().catch(handleError);
    }, 500);
  }

  function handleError(err) {
    console.warn('Sync-Fehler', err);
    if (!state.user) return;
    if (isNetworkError(err)) setStatus('offline');
    else setStatus('error', (err && err.message) || 'Unbekannter Fehler');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => syncNow(), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  }

  // Lädt alle wartenden Notizen hoch (in Paketen).
  function flush() {
    if (flushing) return flushing;
    // .finally läuft immer asynchron – die Sperre wird also sicher erst danach gelöst
    flushing = doFlush().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  async function doFlush() {
    while (state.user && pending.size) {
      if (!navigator.onLine) throw new Error('offline');
      if (state.status !== 'syncing') setStatus('syncing');
      const notes = new Map(store.snapshot().map((n) => [n.id, n]));
      const rows = [];
      const sent = new Map();
      for (const [id, st] of pending) {
        const n = notes.get(id);
        if (!n) {
          pending.delete(id);
          continue;
        }
        rows.push(toRow(n));
        sent.set(id, st);
        if (rows.length >= BATCH) break;
      }
      if (rows.length) {
        const { error } = await client.rpc('upsert_notes', { items: rows });
        if (error) throw error;
      }
      // Nur entfernen, was sich während des Hochladens nicht erneut geändert hat
      for (const [id, st] of sent) {
        if (pending.get(id) === st) pending.delete(id);
      }
      savePending();
    }
    retryDelay = 2000;
    if (state.user && !running) setStatus('synced');
  }

  // Holt alles, was seit dem letzten Mal auf dem Server geändert wurde.
  async function pull() {
    const cursor = readJSON(CURSOR_KEY, null);
    const full = !cursor || cursor.userId !== state.user.id;
    // 10 s Überlappung gegen knappe Zeitfenster; doppelte Zeilen sind harmlos.
    const since = full ? null : new Date(Date.parse(cursor.at) - 10000).toISOString();
    let maxAt = full ? null : cursor.at;

    for (let from = 0; ; from += PAGE) {
      let q = client
        .from('notes')
        .select('id,title,body,folder,created_at,updated_at,opened_at,deleted,updated_by,server_updated_at')
        .order('server_updated_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (since) q = q.gte('server_updated_at', since);
      const { data, error } = await q;
      if (error) throw error;
      if (data.length) {
        store.apply(data.map(fromRow));
        for (const r of data) {
          if (!maxAt || Date.parse(r.server_updated_at) > Date.parse(maxAt)) maxAt = r.server_updated_at;
        }
      }
      if (data.length < PAGE) break;
    }

    if (full) {
      // Erste Verbindung dieses Geräts: alles Lokale einmal mit hochladen
      for (const n of store.snapshot()) pending.set(n.id, stamp(n));
      savePending();
    }
    writeJSON(CURSOR_KEY, { userId: state.user.id, at: maxAt || new Date(0).toISOString() });
  }

  function bumpCursor(at) {
    const cursor = readJSON(CURSOR_KEY, null);
    if (!cursor || cursor.userId !== state.user.id) return;
    if (Date.parse(at) > Date.parse(cursor.at)) writeJSON(CURSOR_KEY, { userId: cursor.userId, at });
  }

  function syncNow() {
    if (!state.user) return Promise.resolve();
    if (running) return running;
    clearTimeout(retryTimer);
    if (!navigator.onLine) {
      setStatus('offline');
      return Promise.resolve();
    }
    setStatus('syncing');
    running = (async () => {
      await pull();
      await flush();
      if (state.user) setStatus('synced');
    })()
      .catch(handleError)
      .finally(() => {
        running = null;
      });
    return running;
  }

  /* ---------- Realtime ---------- */

  function subscribeRealtime() {
    unsubscribeRealtime();
    const uid = state.user.id;
    channel = client
      .channel('notes-' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` }, (payload) => {
        const r = payload.new;
        if (!r || !r.id || !state.user) return;
        store.apply([fromRow(r)]);
        if (r.server_updated_at) bumpCursor(r.server_updated_at);
      })
      .subscribe((status) => {
        // Nach (Wieder-)Verbindung Verpasstes nachholen
        if (status === 'SUBSCRIBED') syncNow();
      });
  }

  function unsubscribeRealtime() {
    if (channel) {
      client.removeChannel(channel);
      channel = null;
    }
  }

  /* ---------- Anmeldung ---------- */

  function start(user) {
    state.user = { id: user.id, email: user.email || '' };
    subscribeRealtime();
    syncNow();
  }

  function stop() {
    unsubscribeRealtime();
    clearTimeout(retryTimer);
    clearTimeout(flushTimer);
    state.user = null;
    // Nächste Anmeldung gleicht wieder vollständig ab
    try {
      localStorage.removeItem(CURSOR_KEY);
    } catch (e) {
      /* ignorieren */
    }
    setStatus('off');
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      // Über den Link "Passwort zurücksetzen" gekommen: neues Passwort abfragen
      state.recovery = true;
      setTimeout(() => {
        emit();
        document.dispatchEvent(new CustomEvent('erledigungen:open-settings'));
      }, 0);
    }
    const user = session && session.user ? session.user : null;
    const sameUser = user && state.user && user.id === state.user.id;
    if (sameUser) return; // z. B. Token-Erneuerung
    // Supabase empfiehlt, im Callback nichts direkt abzuwarten
    setTimeout(() => {
      if (user) {
        if (state.user) stop();
        start(user);
      } else if (state.user || state.status !== 'off') {
        stop();
      } else {
        emit();
      }
    }, 0);
  });

  global.addEventListener('online', () => syncNow());
  global.addEventListener('offline', () => {
    if (state.user) setStatus('offline');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });

  /* ---------- Öffentliche Schnittstelle ---------- */

  Object.assign(api, {
    enabled: true,
    syncNow,
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    // Liefert true, wenn direkt angemeldet; false, wenn erst die E-Mail bestätigt werden muss.
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      return !!data.session;
    },
    async resetPassword(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
      if (error) throw error;
    },
    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      state.recovery = false;
      emit();
    },
    async signOut() {
      await client.auth.signOut({ scope: 'local' });
    },
  });

  emit();
})(window);
