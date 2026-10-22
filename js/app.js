/* Oberfläche von Erledigungen: Ansichten, Editor, Drag & Drop, Spaltenbreiten. */
(function () {
  'use strict';

  const { NoteStore, FOLDERS, lastUsed } = window.Erledigungen;
  const store = new NoteStore();
  const FOLDER = Object.fromEntries(FOLDERS.map((f) => [f.id, f]));

  const LAYOUT_KEY = 'erledigungen.layout.v1';
  const PANES = {
    sidebar: { min: 190, max: 380, def: 248 },
    list: { min: 240, max: 560, def: 330 },
  };
  const EDITOR_MIN = 360;
  const EASE = 'cubic-bezier(.2, .9, .25, 1)';
  const mqMobile = window.matchMedia('(max-width: 760px)');
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motion = () => !mqReduce.matches && document.documentElement.dataset.motion !== 'reduced';
  const isMobile = () => mqMobile.matches;

  const $ = (sel) => document.querySelector(sel);
  const ui = {
    app: $('#app'),
    sidebar: $('#sidebar'),
    listPane: $('#listPane'),
    editorPane: $('#editorPane'),
    overviewPane: $('#overviewPane'),
    navOverview: $('#navOverview'),
    folderNav: $('#folderNav'),
    listTitle: $('#listTitle'),
    listCount: $('#listCount'),
    noteList: $('#noteList'),
    seg: $('#seg'),
    saveState: $('#saveState'),
    deleteBtn: $('#deleteBtn'),
    editorBody: $('#editorBody'),
    titleInput: $('#titleInput'),
    bodyInput: $('#bodyInput'),
    editorMeta: $('#editorMeta'),
    grid: $('#grid'),
    overviewSub: $('#overviewSub'),
  };

  // Die App startet immer in der Übersicht.
  const state = {
    view: 'overview',
    folder: 'todo',
    selectedId: null,
    editorOpen: false, // nur Handy: Editor-Blatt sichtbar
    layout: loadLayout(),
  };

  /* ======================================================================
     Hilfsfunktionen
     ====================================================================== */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function titleOf(n) {
    return n.title.trim() || 'Ohne Titel';
  }

  function excerptOf(n, max) {
    const text = n.body.replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return text.slice(0, max).replace(/\s+\S*$/, '') + ' …';
  }

  function plural(n) {
    return n === 1 ? '1 Notiz' : `${n} Notizen`;
  }

  const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
  const dateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
  const dateYearFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });

  function relTime(ts) {
    const now = new Date();
    const d = new Date(ts);
    const diff = now - d;
    if (diff < 60e3) return 'Gerade eben';
    if (diff < 3600e3) return `Vor ${Math.floor(diff / 60e3)} Min.`;
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startToday) return `Heute, ${timeFmt.format(d)}`;
    if (ts >= startToday - 864e5) return `Gestern, ${timeFmt.format(d)}`;
    return (d.getFullYear() === now.getFullYear() ? dateFmt : dateYearFmt).format(d);
  }

  function byId(id) {
    return `[data-id="${CSS.escape(id)}"]`;
  }

  /* ======================================================================
     Animationen
     ====================================================================== */

  function enter(...els) {
    if (!motion()) return;
    els.forEach((el, i) => {
      el.animate(
        [{ opacity: 0, transform: 'translateY(10px) scale(.985)' }, { opacity: 1, transform: 'none' }],
        { duration: 480, delay: i * 50, easing: EASE, fill: 'backwards' }
      );
    });
  }

  function stagger(container) {
    if (!motion()) return;
    [...container.children].forEach((child, i) => {
      if (i > 18) return;
      child.animate(
        [{ opacity: 0, transform: 'translateY(12px) scale(.97)' }, { opacity: 1, transform: 'none' }],
        { duration: 460, delay: 40 + i * 28, easing: EASE, fill: 'backwards' }
      );
    });
  }

  // FLIP: Elemente gleiten an ihre neue Position, neue Elemente blenden ein.
  function flip(container, mutate) {
    if (!motion()) {
      mutate();
      return;
    }
    const before = new Map();
    for (const child of container.children) {
      if (child.dataset.id) before.set(child.dataset.id, child.getBoundingClientRect());
    }
    mutate();
    for (const child of container.children) {
      const id = child.dataset.id;
      if (!id) continue;
      const b = before.get(id);
      if (!b) {
        child.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE });
        continue;
      }
      const a = child.getBoundingClientRect();
      const dx = b.left - a.left;
      const dy = b.top - a.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        child.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: EASE });
      }
    }
  }

  // mode 'nav' = Ansicht gewechselt (gestaffelt einblenden), sonst Datenänderung (FLIP)
  function paint(container, html, mode) {
    if (mode !== 'nav' && container._html === html) return;
    container._html = html;
    if (mode === 'nav') {
      container.innerHTML = html;
      container.scrollTop = 0;
      stagger(container);
    } else {
      flip(container, () => {
        container.innerHTML = html;
      });
    }
  }

  /* ======================================================================
     Layout: Breiten & Einklappen
     ====================================================================== */

  function loadLayout() {
    const def = { sidebarW: PANES.sidebar.def, listW: PANES.list.def, sidebarCollapsed: false, listCollapsed: false };
    try {
      const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        return {
          sidebarW: clamp(Number.isFinite(raw.sidebarW) ? raw.sidebarW : def.sidebarW, PANES.sidebar.min, PANES.sidebar.max),
          listW: clamp(Number.isFinite(raw.listW) ? raw.listW : def.listW, PANES.list.min, PANES.list.max),
          sidebarCollapsed: raw.sidebarCollapsed === true,
          listCollapsed: raw.listCollapsed === true,
        };
      }
    } catch (e) {
      /* Standard verwenden */
    }
    return def;
  }

  function saveLayout() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(state.layout));
    } catch (e) {
      /* ignorieren */
    }
  }

  function applyLayout() {
    const L = state.layout;
    let listW = L.listW;
    // In schmalen Fenstern bekommt der Editor trotzdem genug Platz.
    if (state.view === 'notes' && !L.listCollapsed && !isMobile()) {
      const avail = window.innerWidth - 28 - 28;
      const over = (L.sidebarCollapsed ? 0 : L.sidebarW) + listW + EDITOR_MIN - avail;
      if (over > 0) listW = Math.max(PANES.list.min, listW - over);
    }
    ui.app.style.setProperty('--sidebar-w', L.sidebarW + 'px');
    ui.app.style.setProperty('--list-w', listW + 'px');
    ui.app.classList.toggle('sidebar-collapsed', L.sidebarCollapsed);
    ui.app.classList.toggle('list-collapsed', L.listCollapsed);
    document.querySelectorAll('.toggle-btn').forEach((btn) => {
      const open = !L[btn.dataset.toggle + 'Collapsed'];
      btn.classList.toggle('on', open);
      btn.setAttribute('aria-pressed', String(open));
    });
  }

  function togglePane(name) {
    const key = name + 'Collapsed';
    state.layout[key] = !state.layout[key];
    saveLayout();
    applyLayout();
  }

  function initResizers() {
    document.querySelectorAll('.resizer').forEach((handle) => {
      const name = handle.dataset.resize;
      const lim = PANES[name];
      const key = name + 'W';
      const pane = name === 'sidebar' ? ui.sidebar : ui.listPane;

      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || isMobile()) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW = pane.getBoundingClientRect().width;
        let raw = startW;
        try {
          handle.setPointerCapture(e.pointerId);
        } catch (err) {
          /* ohne Capture weiter */
        }
        ui.app.classList.add('resizing');
        handle.classList.add('active');

        const move = (ev) => {
          raw = startW + (ev.clientX - startX);
          state.layout[key] = clamp(Math.round(raw), lim.min, lim.max);
          applyLayout();
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          ui.app.classList.remove('resizing');
          handle.classList.remove('active');
          // Weit über das Minimum hinaus gezogen = einklappen
          if (raw < lim.min - 70) {
            state.layout[key] = Math.max(lim.min, Math.round(startW));
            state.layout[name + 'Collapsed'] = true;
            applyLayout();
          }
          saveLayout();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });

      handle.addEventListener('dblclick', () => {
        state.layout[key] = lim.def;
        applyLayout();
        saveLayout();
      });
    });
  }

  /* ======================================================================
     Rendern
     ====================================================================== */

  function buildStatic() {
    ui.folderNav.innerHTML = FOLDERS.map(
      (f) => `<button class="folder" type="button" data-folder="${f.id}" data-drop-folder="${f.id}" style="--accent:${f.color}">
        <span class="folder-dot"></span>
        <span class="folder-name">${esc(f.name)}</span>
        <span class="folder-count" data-count></span>
      </button>`
    ).join('');

    ui.seg.innerHTML =
      '<span class="seg-thumb"></span>' +
      FOLDERS.map(
        (f) => `<button class="seg-btn" type="button" role="radio" aria-checked="false" data-set-folder="${f.id}" data-drop-folder="${f.id}" style="--accent:${f.color}" title="${esc(f.name)}">
          <span class="seg-dot"></span><span class="seg-label">${esc(f.name)}</span>
        </button>`
      ).join('');
  }

  function render(mode) {
    ui.app.dataset.view = state.view;
    ui.app.classList.toggle('editor-open', state.view === 'notes' && state.editorOpen);
    renderSidebar();
    if (state.view === 'overview') {
      renderOverview(mode);
    } else {
      renderList(mode);
      renderEditor();
    }
    applyLayout();
  }

  function renderSidebar() {
    ui.navOverview.classList.toggle('active', state.view === 'overview');
    ui.folderNav.querySelectorAll('.folder').forEach((btn) => {
      const id = btn.dataset.folder;
      btn.classList.toggle('active', state.view === 'notes' && state.folder === id);
      btn.querySelector('[data-count]').textContent = store.count(id);
    });
  }

  function listItemHTML(n) {
    const ex = excerptOf(n, 110);
    return `<article class="note-item${n.id === state.selectedId ? ' selected' : ''}" data-id="${esc(n.id)}" data-drag-note data-open-note tabindex="0" style="--accent:${FOLDER[n.folder].color}">
      <h3 class="note-item-title">${esc(titleOf(n))}</h3>
      <p class="note-item-excerpt">${ex ? esc(ex) : '<span class="muted">Kein weiterer Text</span>'}</p>
      <time class="note-item-time">${relTime(n.updatedAt)}</time>
    </article>`;
  }

  function cardHTML(n) {
    const f = FOLDER[n.folder];
    const ex = excerptOf(n, 200);
    return `<article class="card" data-id="${esc(n.id)}" data-drag-note data-open-note tabindex="0" style="--accent:${f.color}">
      <div class="card-top"><span class="chip"><span class="chip-dot"></span><span class="chip-name">${esc(f.name)}</span></span><time>${relTime(lastUsed(n))}</time></div>
      <h3 class="card-title">${esc(titleOf(n))}</h3>
      <p class="card-excerpt">${ex ? esc(ex) : '<span class="muted">Noch kein Text</span>'}</p>
    </article>`;
  }

  function renderList(mode) {
    const f = FOLDER[state.folder];
    const notes = store.inFolder(f.id);
    ui.listPane.style.setProperty('--accent', f.color);
    ui.listTitle.textContent = f.name;
    ui.listCount.textContent = plural(notes.length);
    const html = notes.length
      ? notes.map(listItemHTML).join('')
      : `<div class="empty-state small"><p>Keine Notizen in „${esc(f.name)}“.</p><button class="ghost-btn" type="button" data-action="new-note">Neue Notiz</button></div>`;
    paint(ui.noteList, html, mode);
  }

  function renderOverview(mode) {
    const notes = store.recent();
    ui.overviewSub.textContent = notes.length ? `Zuletzt verwendet · ${plural(notes.length)}` : 'Noch keine Notizen';
    const html = notes.length
      ? notes.map(cardHTML).join('')
      : `<div class="empty-state"><div class="empty-orb"></div><p>Hier erscheinen deine zuletzt verwendeten Notizen.</p><button class="ghost-btn" type="button" data-action="new-note">Erste Notiz anlegen</button></div>`;
    paint(ui.grid, html, mode);
  }

  /* ---------- Editor ---------- */

  let boundId = null;
  let dirty = false;
  let commitTimer = 0;

  function renderEditor() {
    const n = state.selectedId ? store.get(state.selectedId) : null;
    ui.editorPane.classList.toggle('is-empty', !n);
    if (!n) {
      boundId = null;
      dirty = false;
      resetDelete();
      return;
    }
    ui.editorPane.style.setProperty('--accent', FOLDER[n.folder].color);
    if (boundId !== n.id) {
      boundId = n.id;
      dirty = false;
      ui.titleInput.value = n.title;
      ui.bodyInput.value = n.body;
      ui.bodyInput.scrollTop = 0;
      resetDelete();
      setSaveState(store.saveOk ? 'saved' : 'error');
    } else if (!dirty) {
      // Änderungen aus anderen Fenstern übernehmen, ohne beim Tippen zu stören
      if (document.activeElement !== ui.titleInput && ui.titleInput.value !== n.title) ui.titleInput.value = n.title;
      if (document.activeElement !== ui.bodyInput && ui.bodyInput.value !== n.body) ui.bodyInput.value = n.body;
    }
    const i = FOLDERS.findIndex((f) => f.id === n.folder);
    ui.seg.style.setProperty('--i', i);
    ui.seg.querySelectorAll('.seg-btn').forEach((btn) => {
      const on = btn.dataset.setFolder === n.folder;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });
    ui.editorMeta.textContent = `Bearbeitet: ${relTime(n.updatedAt)} · Erstellt: ${dateYearFmt.format(new Date(n.createdAt))}`;
  }

  function setSaveState(s) {
    ui.saveState.dataset.state = s;
    ui.saveState.textContent = s === 'saving' ? 'Speichert …' : s === 'error' ? 'Nicht gespeichert' : 'Gespeichert';
  }

  function onEdit() {
    if (!boundId) return;
    dirty = true;
    setSaveState('saving');
    clearTimeout(commitTimer);
    commitTimer = setTimeout(flushEditor, 350);
  }

  function flushEditor() {
    clearTimeout(commitTimer);
    commitTimer = 0;
    if (!boundId || !dirty) return;
    dirty = false;
    store.update(boundId, { title: ui.titleInput.value, body: ui.bodyInput.value });
    setSaveState(store.saveOk ? 'saved' : 'error');
  }

  let deleteTimer = 0;
  function resetDelete() {
    clearTimeout(deleteTimer);
    ui.deleteBtn.classList.remove('confirm');
  }

  function deleteSelected() {
    const id = state.selectedId;
    if (!id) return;
    clearTimeout(commitTimer);
    dirty = false;
    const list = store.inFolder(state.folder);
    const idx = list.findIndex((n) => n.id === id);
    const next = list[idx + 1] || list[idx - 1] || null;
    if (isMobile()) {
      state.selectedId = null;
      state.editorOpen = false;
    } else {
      state.selectedId = next ? next.id : null;
    }
    store.remove(id);
  }

  /* ======================================================================
     Navigation
     ====================================================================== */

  // Verlässt die aktuelle Notiz: speichert und verwirft nie bearbeitete leere Notizen.
  function leaveCurrent(nextId) {
    flushEditor();
    const cur = state.selectedId ? store.get(state.selectedId) : null;
    if (cur && cur.id !== nextId && !cur.title.trim() && !cur.body.trim() && cur.updatedAt === cur.createdAt) {
      store.remove(cur.id, { silent: true });
      state.selectedId = null;
    }
  }

  function showOverview() {
    leaveCurrent(null);
    const changed = state.view !== 'overview';
    state.view = 'overview';
    state.editorOpen = false;
    render('nav');
    if (changed) enter(ui.overviewPane);
  }

  function showFolder(folder) {
    if (!FOLDER[folder]) return;
    leaveCurrent(null);
    const viewChanged = state.view !== 'notes';
    const changed = viewChanged || state.folder !== folder;
    state.view = 'notes';
    state.folder = folder;
    state.editorOpen = false;
    const sel = state.selectedId ? store.get(state.selectedId) : null;
    if (!sel || sel.folder !== folder) {
      const first = store.inFolder(folder)[0];
      state.selectedId = !isMobile() && first ? first.id : null;
    }
    render(changed ? 'nav' : 'data');
    if (viewChanged) enter(ui.listPane, ...(isMobile() ? [] : [ui.editorPane]));
  }

  function openNote(id, opts) {
    const n = store.get(id);
    if (!n) return;
    if (id !== state.selectedId) leaveCurrent(id);
    else flushEditor();
    const viewChanged = state.view !== 'notes';
    const folderChanged = state.folder !== n.folder;
    const noteChanged = state.selectedId !== id;
    state.view = 'notes';
    state.folder = n.folder;
    state.selectedId = id;
    state.editorOpen = true;
    store.markOpened(id, { silent: true });
    render(viewChanged || folderChanged ? 'nav' : 'data');

    if (viewChanged) {
      enter(ui.listPane, ...(isMobile() ? [] : [ui.editorPane]));
    } else if (noteChanged && motion() && !isMobile()) {
      ui.editorBody.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: EASE });
    }
    const item = ui.noteList.querySelector(byId(id));
    if (item) item.scrollIntoView({ block: 'nearest' });
    if (opts && opts.focus) {
      requestAnimationFrame(() => ui.titleInput.focus({ preventScroll: true }));
    }
  }

  function newNote() {
    leaveCurrent(null);
    const folder = state.view === 'notes' ? state.folder : 'todo';
    const n = store.create(folder, { silent: true });
    openNote(n.id, { focus: true });
  }

  function closeEditor() {
    leaveCurrent(null);
    state.editorOpen = false;
    render('data');
  }

  function setFolderOfSelected(folder) {
    const id = state.selectedId;
    const n = id ? store.get(id) : null;
    if (!n || n.folder === folder || !FOLDER[folder]) return;
    flushEditor();
    state.folder = folder; // Liste folgt der Notiz
    store.move(id, folder);
    celebrate(folder, id);
  }

  /* ======================================================================
     Drag & Drop (Maus sofort, Touch per langem Drücken)
     ====================================================================== */

  const drag = {
    p: null, // vorgemerkter Druck
    active: false,
    ghost: null,
    src: null,
    id: null,
    folder: null,
    offX: 0,
    offY: 0,
    target: null,
    lastX: 0,
    lastY: 0,
    peeked: false,
    suppressClick: false,
  };

  function cancelPending() {
    if (drag.p) {
      clearTimeout(drag.p.timer);
      drag.p.card.classList.remove('pressing');
    }
    drag.p = null;
  }

  function startDrag() {
    const p = drag.p;
    if (!p) return;
    clearTimeout(p.timer);
    const card = p.card;
    const note = store.get(p.id);
    if (!card.isConnected || !note) {
      cancelPending();
      return;
    }
    if (p.id === boundId) flushEditor();

    const r = card.getBoundingClientRect();
    const w = Math.min(r.width, 320);
    const ghost = card.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('selected', 'pressing');
    ['data-id', 'data-drag-note', 'data-open-note', 'tabindex'].forEach((a) => ghost.removeAttribute(a));
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = w + 'px';
    if (w === r.width) ghost.style.height = r.height + 'px';
    document.body.appendChild(ghost);

    drag.active = true;
    drag.ghost = ghost;
    drag.src = card;
    drag.id = p.id;
    drag.folder = note.folder;
    drag.offX = clamp(p.x - r.left, 16, w - 16);
    drag.offY = clamp(p.y - r.top, 16, Math.max(16, ghost.offsetHeight - 16));
    ghost.style.translate = `${drag.lastX - drag.offX}px ${drag.lastY - drag.offY}px`;

    card.classList.remove('pressing');
    card.classList.add('drag-source');
    document.body.classList.add('is-dragging');
    const sel = window.getSelection && window.getSelection();
    if (sel) sel.removeAllRanges();

    // Eingeklappte Ordner kurz einblenden, damit es ein Ziel gibt
    if (state.layout.sidebarCollapsed && !isMobile()) {
      drag.peeked = true;
      ui.app.classList.add('peek-sidebar');
    }
    if (p.touch && navigator.vibrate) navigator.vibrate(12);
    hitTest(drag.lastX, drag.lastY);
  }

  function hitTest(x, y) {
    const hit = document.elementFromPoint(x, y);
    let t = hit ? hit.closest('[data-drop-folder]') : null;
    if (t && t.dataset.dropFolder === drag.folder) t = null;
    if (t === drag.target) return;
    if (drag.target) drag.target.classList.remove('drop-hover');
    drag.target = t;
    if (t) t.classList.add('drop-hover');
  }

  function removeLater(ghost, anim, ms) {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ghost.remove();
    };
    if (anim) {
      anim.onfinish = finish;
      anim.oncancel = finish;
    }
    setTimeout(finish, ms + 150);
  }

  function endDrag(commit) {
    const { ghost, src, id } = drag;
    const target = commit ? drag.target : null;
    if (drag.target) drag.target.classList.remove('drop-hover');
    document.body.classList.remove('is-dragging');
    if (drag.peeked) ui.app.classList.remove('peek-sidebar');
    Object.assign(drag, { p: null, active: false, ghost: null, src: null, id: null, folder: null, target: null, peeked: false });
    drag.suppressClick = true;
    setTimeout(() => {
      drag.suppressClick = false;
    }, 120);

    const note = id ? store.get(id) : null;
    const folder = target ? target.dataset.dropFolder : null;

    if (note && folder && FOLDER[folder] && folder !== note.folder) {
      // In den Ordner hineinfliegen
      const tr = target.getBoundingClientRect();
      const w = ghost.offsetWidth;
      const h = ghost.offsetHeight;
      const dur = motion() ? 380 : 0;
      const anim = ghost.animate(
        [
          { translate: ghost.style.translate, scale: '1', opacity: 1 },
          { translate: `${tr.left + tr.width / 2 - w / 2}px ${tr.top + tr.height / 2 - h / 2}px`, scale: '0.12', opacity: 0 },
        ],
        { duration: dur, easing: 'cubic-bezier(.5, 0, .2, 1)', fill: 'forwards' }
      );
      removeLater(ghost, anim, dur);

      if (state.view === 'notes' && id === state.selectedId) state.folder = folder;
      store.move(id, folder);
      celebrate(folder, id);
    } else {
      // Zurück an den Ursprung
      const dur = motion() ? 320 : 0;
      let anim = null;
      if (src && src.isConnected) {
        const r = src.getBoundingClientRect();
        anim = ghost.animate(
          [
            { translate: ghost.style.translate, scale: '1', opacity: 1 },
            { translate: `${r.left}px ${r.top}px`, scale: String(r.width / ghost.offsetWidth), opacity: 0.4 },
          ],
          { duration: dur, easing: EASE, fill: 'forwards' }
        );
      } else {
        anim = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, fill: 'forwards' });
      }
      removeLater(ghost, anim, dur);
      setTimeout(() => src && src.classList.remove('drag-source'), dur);
    }
  }

  function celebrate(folder, id) {
    const color = FOLDER[folder].color;
    const btn = ui.folderNav.querySelector(`[data-folder="${folder}"]`);
    if (btn) {
      btn.classList.remove('drop-pulse');
      void btn.offsetWidth;
      btn.classList.add('drop-pulse');
      setTimeout(() => btn.classList.remove('drop-pulse'), 750);
    }
    if (!motion()) return;
    document.querySelectorAll(byId(id)).forEach((el) => {
      el.animate(
        [
          { boxShadow: `0 0 0 2px ${color}, 0 0 38px ${color}99` },
          { boxShadow: `0 0 0 0 ${color}00, 0 0 0 ${color}00` },
        ],
        { duration: 950, easing: 'ease-out' }
      );
    });
  }

  function initDrag() {
    document.addEventListener('pointerdown', (e) => {
      if (drag.active || drag.p) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const card = e.target.closest('[data-drag-note]');
      if (!card) return;
      drag.p = { id: card.dataset.id, card, x: e.clientX, y: e.clientY, pid: e.pointerId, touch: e.pointerType !== 'mouse', timer: 0 };
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (drag.p.touch) {
        card.classList.add('pressing');
        drag.p.timer = setTimeout(() => {
          if (drag.p && !drag.active) startDrag();
        }, 380);
      }
    });

    document.addEventListener(
      'pointermove',
      (e) => {
        const p = drag.p;
        if (!p || e.pointerId !== p.pid) return;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (!drag.active) {
          const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
          if (p.touch) {
            if (dist > 10) cancelPending(); // Finger scrollt
          } else if (dist > 6) {
            startDrag();
          }
          return;
        }
        e.preventDefault();
        drag.ghost.style.translate = `${e.clientX - drag.offX}px ${e.clientY - drag.offY}px`;
        hitTest(e.clientX, e.clientY);
      },
      { passive: false }
    );

    // Während eines Touch-Drags nicht scrollen
    document.addEventListener(
      'touchmove',
      (e) => {
        if (drag.active) e.preventDefault();
      },
      { passive: false }
    );

    document.addEventListener('pointerup', (e) => {
      if (!drag.p || e.pointerId !== drag.p.pid) return;
      if (drag.active) endDrag(true);
      else cancelPending();
    });

    document.addEventListener('pointercancel', (e) => {
      if (!drag.p || e.pointerId !== drag.p.pid) return;
      if (drag.active) endDrag(false);
      else cancelPending();
    });

    document.addEventListener('contextmenu', (e) => {
      if (drag.p || drag.active) e.preventDefault();
    });

    window.addEventListener('blur', () => {
      if (drag.active) endDrag(false);
      else cancelPending();
    });

    // Nach einem Drag keinen Klick auslösen
    document.addEventListener(
      'click',
      (e) => {
        if (drag.suppressClick) {
          e.preventDefault();
          e.stopPropagation();
          drag.suppressClick = false;
        }
      },
      true
    );
  }

  /* ======================================================================
     Ereignisse
     ====================================================================== */

  function initEvents() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action], [data-toggle], [data-folder], [data-set-folder], [data-open-note]');
      if (!t) return;
      if (t.dataset.toggle) return togglePane(t.dataset.toggle);
      if (t.dataset.action === 'overview') return showOverview();
      if (t.dataset.action === 'new-note') return newNote();
      if (t.dataset.action === 'close-editor') return closeEditor();
      if (t.dataset.folder) return showFolder(t.dataset.folder);
      if (t.dataset.setFolder) return setFolderOfSelected(t.dataset.setFolder);
      if (t.hasAttribute('data-open-note')) return openNote(t.dataset.id);
    });

    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t instanceof Element && t.hasAttribute('data-open-note')) {
        e.preventDefault();
        openNote(t.dataset.id);
      } else if (e.key === 'Escape' && isMobile() && state.editorOpen) {
        closeEditor();
      }
    });

    ui.titleInput.addEventListener('input', onEdit);
    ui.bodyInput.addEventListener('input', onEdit);
    ui.titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        ui.bodyInput.focus();
        ui.bodyInput.setSelectionRange(0, 0);
      }
    });
    ui.titleInput.addEventListener('blur', flushEditor);
    ui.bodyInput.addEventListener('blur', flushEditor);

    ui.deleteBtn.addEventListener('click', () => {
      if (!state.selectedId) return;
      if (!ui.deleteBtn.classList.contains('confirm')) {
        ui.deleteBtn.classList.add('confirm');
        clearTimeout(deleteTimer);
        deleteTimer = setTimeout(resetDelete, 3000);
        return;
      }
      resetDelete();
      deleteSelected();
    });

    store.subscribe((change) => {
      if (change.origin === 'remote' && state.selectedId) {
        const n = store.get(state.selectedId);
        if (!n) {
          state.selectedId = null;
          state.editorOpen = false;
        } else if (state.view === 'notes' && n.folder !== state.folder) {
          state.folder = n.folder;
        }
      }
      if (change.saved === false) setSaveState('error');
      render('data');
    });

    window.addEventListener('pagehide', flushEditor);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushEditor();
    });

    let resizeRaf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(applyLayout);
    });

    mqMobile.addEventListener('change', () => render('data'));

    // Relative Zeiten ("Vor 5 Min.") aktuell halten
    setInterval(() => {
      if (!drag.active && !document.hidden) render('data');
    }, 60e3);
  }

  /* ======================================================================
     Start
     ====================================================================== */

  buildStatic();
  initResizers();
  initDrag();
  initEvents();
  render('nav');
  enter(ui.sidebar, ui.overviewPane);

  // Für Erweiterungen (z. B. Live-Sync-Adapter) und zum Debuggen erreichbar
  window.Erledigungen.store = store;
})();
