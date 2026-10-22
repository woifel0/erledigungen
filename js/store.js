/*
 * Datenschicht von Erledigungen.
 *
 * - Speichert alle Notizen lokal (localStorage).
 * - Gleicht offene Tabs/Fenster live ab (storage-Event).
 * - Ist für echten Live-Sync (z. B. Handy <-> Mac) vorbereitet:
 *   Jede Notiz trägt updatedAt + updatedBy, Löschungen bleiben als
 *   "Tombstone" erhalten, und Konflikte werden per "last write wins"
 *   gelöst. Ein Sync-Adapter wird über store.useSync(adapter) angehängt
 *   (siehe README.md).
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'erledigungen.notes.v1';
  const DEVICE_KEY = 'erledigungen.device';
  const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000;

  const FOLDERS = [
    { id: 'todo', name: 'Nicht angefangen', color: '#ff375f' },
    { id: 'doing', name: 'In Arbeit', color: '#ff9f0a' },
    { id: 'done', name: 'Fertig', color: '#30d158' },
  ];
  const FOLDER_IDS = FOLDERS.map((f) => f.id);

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function num(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function loadDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = uid();
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return uid();
    }
  }

  function normalize(raw) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
    const now = Date.now();
    return {
      id: raw.id,
      title: typeof raw.title === 'string' ? raw.title : '',
      body: typeof raw.body === 'string' ? raw.body : '',
      folder: FOLDER_IDS.includes(raw.folder) ? raw.folder : 'todo',
      createdAt: num(raw.createdAt, now),
      updatedAt: num(raw.updatedAt, now),
      openedAt: num(raw.openedAt, 0),
      deleted: raw.deleted === true,
      updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : '',
    };
  }

  // true, wenn a gegenüber b gewinnt (neuere Änderung; bei Gleichstand entscheidet das Gerät)
  function wins(a, b) {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
    return a.updatedBy > b.updatedBy;
  }

  function sameNote(a, b) {
    return (
      a.title === b.title &&
      a.body === b.body &&
      a.folder === b.folder &&
      a.createdAt === b.createdAt &&
      a.updatedAt === b.updatedAt &&
      a.openedAt === b.openedAt &&
      a.deleted === b.deleted &&
      a.updatedBy === b.updatedBy
    );
  }

  function lastUsed(note) {
    return Math.max(note.openedAt, note.updatedAt);
  }

  class NoteStore {
    constructor() {
      this.notes = new Map();
      this.listeners = new Set();
      this.adapters = [];
      this.deviceId = loadDeviceId();
      this.saveOk = true;
      if (!this._load()) this._seed();
      this._listenOtherTabs();
    }

    /* ---------- Lesen ---------- */

    get(id) {
      const note = this.notes.get(id);
      return note && !note.deleted ? note : null;
    }

    list() {
      return [...this.notes.values()].filter((n) => !n.deleted);
    }

    inFolder(folder) {
      return this.list()
        .filter((n) => n.folder === folder)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    recent() {
      return this.list().sort((a, b) => lastUsed(b) - lastUsed(a));
    }

    count(folder) {
      let n = 0;
      for (const note of this.notes.values()) {
        if (!note.deleted && note.folder === folder) n++;
      }
      return n;
    }

    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    /* ---------- Schreiben ---------- */

    create(folder, opts) {
      const now = Date.now();
      const note = {
        id: uid(),
        title: '',
        body: '',
        folder: FOLDER_IDS.includes(folder) ? folder : 'todo',
        createdAt: now,
        updatedAt: now,
        openedAt: now,
        deleted: false,
        updatedBy: this.deviceId,
      };
      this._commit([note], 'create', opts);
      return note;
    }

    update(id, patch, opts) {
      const cur = this.get(id);
      if (!cur) return null;
      const next = { ...cur };
      let changed = false;
      if (typeof patch.title === 'string' && patch.title !== cur.title) {
        next.title = patch.title;
        changed = true;
      }
      if (typeof patch.body === 'string' && patch.body !== cur.body) {
        next.body = patch.body;
        changed = true;
      }
      if (FOLDER_IDS.includes(patch.folder) && patch.folder !== cur.folder) {
        next.folder = patch.folder;
        changed = true;
      }
      if (!changed) return cur;
      next.updatedAt = Math.max(Date.now(), cur.updatedAt + 1);
      next.updatedBy = this.deviceId;
      this._commit([next], patch.folder ? 'move' : 'update', opts);
      return next;
    }

    move(id, folder, opts) {
      return this.update(id, { folder }, opts);
    }

    markOpened(id, opts) {
      const cur = this.get(id);
      if (!cur) return;
      this._commit([{ ...cur, openedAt: Date.now() }], 'open', opts);
    }

    remove(id, opts) {
      const cur = this.get(id);
      if (!cur) return;
      const tombstone = {
        ...cur,
        title: '',
        body: '',
        deleted: true,
        updatedAt: Math.max(Date.now(), cur.updatedAt + 1),
        updatedBy: this.deviceId,
      };
      this._commit([tombstone], 'delete', opts);
    }

    /* ---------- Sync ---------- */

    /**
     * Hängt einen Sync-Adapter an.
     * adapter.connect({ apply, snapshot }) wird einmal aufgerufen:
     *   apply(notes)  -> entfernte Änderungen einspielen
     *   snapshot()    -> alle lokalen Notizen inkl. Tombstones
     * adapter.push(notes) wird bei jeder lokalen Änderung aufgerufen.
     */
    useSync(adapter) {
      this.adapters.push(adapter);
      adapter.connect({
        apply: (notes) => this.applyRemote(notes),
        snapshot: () => [...this.notes.values()].map((n) => ({ ...n })),
      });
    }

    applyRemote(rawList) {
      if (!Array.isArray(rawList)) return;
      const changed = [];
      for (const raw of rawList) {
        const incoming = normalize(raw);
        if (!incoming) continue;
        const cur = this.notes.get(incoming.id);
        if (!cur) {
          this.notes.set(incoming.id, incoming);
          changed.push(incoming.id);
          continue;
        }
        const winner = wins(incoming, cur) ? incoming : cur;
        const merged = { ...winner, openedAt: Math.max(incoming.openedAt, cur.openedAt) };
        if (sameNote(merged, cur)) continue;
        this.notes.set(merged.id, merged);
        changed.push(merged.id);
      }
      if (!changed.length) return;
      this._persist();
      this._emit({ type: 'remote', ids: changed, origin: 'remote', saved: this.saveOk });
    }

    /* ---------- intern ---------- */

    _commit(notes, type, opts) {
      for (const n of notes) this.notes.set(n.id, n);
      this._persist();
      if (!(opts && opts.silent)) {
        this._emit({ type, ids: notes.map((n) => n.id), origin: 'local', saved: this.saveOk });
      }
      for (const adapter of this.adapters) {
        try {
          adapter.push(notes.map((n) => ({ ...n })));
        } catch (e) {
          console.error('Sync-Push fehlgeschlagen', e);
        }
      }
    }

    _emit(change) {
      for (const fn of this.listeners) {
        try {
          fn(change);
        } catch (e) {
          console.error(e);
        }
      }
    }

    _read() {
      let raw = null;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch (e) {
        return null;
      }
      if (!raw) return null;
      try {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.notes)) return data.notes;
      } catch (e) {
        /* fällt unten in die Sicherung */
      }
      // Beschädigte Daten niemals stillschweigend überschreiben: Kopie sichern.
      try {
        localStorage.setItem(STORAGE_KEY + '.backup-' + Date.now(), raw);
      } catch (e) {
        /* ignorieren */
      }
      return null;
    }

    _load() {
      const list = this._read();
      if (!list) return false;
      const cutoff = Date.now() - TOMBSTONE_TTL;
      for (const raw of list) {
        const n = normalize(raw);
        if (!n) continue;
        if (n.deleted && n.updatedAt < cutoff) continue;
        this.notes.set(n.id, n);
      }
      return true;
    }

    _persist() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: 1, notes: [...this.notes.values()] })
        );
        this.saveOk = true;
      } catch (e) {
        console.warn('Speichern fehlgeschlagen', e);
        this.saveOk = false;
      }
      return this.saveOk;
    }

    _listenOtherTabs() {
      global.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY || !e.newValue) return;
        try {
          const data = JSON.parse(e.newValue);
          if (data && Array.isArray(data.notes)) this.applyRemote(data.notes);
        } catch (err) {
          /* ignorieren */
        }
      });
    }

    _seed() {
      const now = Date.now();
      const h = 3600e3;
      const d = 24 * h;
      const items = [
        [
          'todo',
          'Willkommen bei Erledigungen',
          'Zieh Notizen mit der Maus – oder am Handy mit langem Drücken – auf einen anderen Ordner. Die Akzentfarbe passt sich automatisch an.\n\nRot = Nicht angefangen\nOrange = In Arbeit\nGrün = Fertig\n\nDie Spalten lassen sich einklappen und an ihren Kanten in der Breite ziehen. Ein Doppelklick auf eine Kante setzt die Breite zurück.',
          0,
        ],
        [
          'todo',
          'Steuererklärung 2026',
          'Belege sammeln: Handwerkerrechnungen, Spendenquittungen, Fahrtkosten. Termin beim Steuerberater ausmachen.',
          2 * h,
        ],
        [
          'doing',
          'Umzug planen',
          'Kartons besorgen, Umzugshelfer fragen, Nachsendeauftrag bei der Post stellen, Internet ummelden.',
          5 * h,
        ],
        [
          'doing',
          'Präsentation Q4',
          'Folien für das Team-Meeting vorbereiten. Zahlen aus dem Dashboard übernehmen und drei Kernaussagen formulieren.',
          d,
        ],
        ['done', 'Auto zum TÜV', 'Erledigt – Plakette bis 2028. Nächster Ölwechsel in 10.000 km.', 3 * d],
      ];
      for (const [folder, title, body, age] of items) {
        const t = now - age;
        const note = {
          id: uid(),
          title,
          body,
          folder,
          createdAt: t - h,
          updatedAt: t,
          openedAt: 0,
          deleted: false,
          updatedBy: this.deviceId,
        };
        this.notes.set(note.id, note);
      }
      this._persist();
    }
  }

  global.Erledigungen = Object.assign(global.Erledigungen || {}, { NoteStore, FOLDERS, lastUsed });
})(window);
