/* Einstellungsfenster: alle Änderungen wirken sofort (Live-Vorschau). */
(function () {
  'use strict';

  const S = window.Erledigungen.settings;
  const modal = document.getElementById('settingsModal');
  const EASE = 'cubic-bezier(.2, .9, .25, 1)';
  const motion = () =>
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.motion !== 'reduced';

  const ICON = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function previewBg(p) {
    if (p.o === 0) return p.bg;
    const a = Math.min(1, Math.max(0.35, p.o));
    const [b1, b2, b3, b4] = p.blobs.map((c) => hexA(c, a));
    return [
      `radial-gradient(circle at 15% 15%, ${b1} 0, transparent 60%)`,
      `radial-gradient(circle at 92% 30%, ${b2} 0, transparent 55%)`,
      `radial-gradient(circle at 60% 110%, ${b3} 0, transparent 60%)`,
      `radial-gradient(circle at 0% 100%, ${b4} 0, transparent 55%)`,
      p.bg,
    ].join(', ');
  }

  function group(key, options, extraClass) {
    return `<div class="opt-group ${extraClass || ''}" role="radiogroup" data-key="${key}">${options
      .map(
        ([value, label, cls]) =>
          `<button class="opt ${cls || ''}" type="button" role="radio" data-value="${value}">${label}</button>`
      )
      .join('')}</div>`;
  }

  function build() {
    modal.innerHTML = `
      <div class="modal-scrim" data-close></div>
      <div class="modal-sheet glass" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" tabindex="-1">
        <header class="modal-head">
          <div>
            <h2 id="settingsTitle">Einstellungen</h2>
            <p>Änderungen wirken sofort.</p>
          </div>
          <button class="icon-btn" type="button" data-close title="Schließen" aria-label="Schließen">${ICON.close}</button>
        </header>

        <div class="modal-body scroll">
          <section class="set-section sync-section" id="syncSection">
            <h3>Synchronisierung</h3>
            <div class="sync-view" data-sync-view="off">
              <p class="sync-intro">Melde dich an, um deine Notizen auf allen Geräten zu haben. Du bekommst einen Code per E-Mail – ohne Passwort.</p>
              <form class="sync-form" data-form="email" novalidate>
                <input class="text-input" type="email" name="email" placeholder="deine@email.de" autocomplete="email" autocapitalize="off" spellcheck="false" required>
                <button class="new-btn" type="submit">Code senden</button>
              </form>
              <form class="sync-form" data-form="code" novalidate hidden>
                <input class="text-input code-input" type="text" name="code" placeholder="Code aus der E-Mail" inputmode="numeric" autocomplete="one-time-code" maxlength="10">
                <button class="new-btn" type="submit">Anmelden</button>
              </form>
              <div class="sync-msg-row">
                <p class="sync-msg" role="status"></p>
                <button class="link-btn" type="button" data-sync-back hidden>Andere E-Mail</button>
              </div>
            </div>
            <div class="sync-view" data-sync-view="on" hidden>
              <div class="sync-account">
                <span class="sync-dot"></span>
                <div class="sync-account-text">
                  <strong class="sync-email"></strong>
                  <span class="set-hint sync-status"></span>
                </div>
              </div>
              <div class="sync-actions">
                <button class="ghost-btn" type="button" data-sync-now>Jetzt synchronisieren</button>
                <button class="ghost-btn" type="button" data-sign-out>Abmelden</button>
              </div>
            </div>
            <p class="sync-intro" data-sync-view="unavailable" hidden>Synchronisierung ist nicht verfügbar (Konfiguration fehlt).</p>
          </section>

          <section class="set-section">
            <h3>Erscheinungsbild</h3>
            ${group('mode', [
              ['system', ICON.auto + 'Automatisch'],
              ['light', ICON.sun + 'Hell'],
              ['dark', ICON.moon + 'Dunkel'],
            ], 'wide')}
          </section>

          <section class="set-section">
            <h3>Hintergrund</h3>
            <div class="theme-grid" role="radiogroup" data-key="background">
              ${S.THEMES.map(
                (t) => `<button class="theme-card" type="button" role="radio" data-value="${t.id}">
                  <span class="theme-preview" data-preview="${t.id}"><span class="theme-check">${ICON.check}</span></span>
                  <span class="theme-name">${esc(t.name)}</span>
                  <span class="theme-desc">${esc(t.desc)}</span>
                </button>`
              ).join('')}
            </div>
            <div class="set-row range-row">
              <label class="set-label" for="setIntensity">Farbintensität</label>
              <output id="setIntensityOut" for="setIntensity"></output>
            </div>
            <input class="range" id="setIntensity" type="range" min="0" max="100" step="1">
          </section>

          <section class="set-section">
            <h3>Glas</h3>
            ${group('glass', [
              ['clear', 'Klar'],
              ['frosted', 'Milchig'],
              ['solid', 'Massiv'],
            ], 'wide')}
          </section>

          <section class="set-section">
            <h3>Text</h3>
            <div class="set-row stack">
              <span class="set-label">Schriftgröße</span>
              ${group('textSize', [
                ['s', '<span style="font-size:12px">A</span>'],
                ['m', '<span style="font-size:15px">A</span>'],
                ['l', '<span style="font-size:18px">A</span>'],
              ])}
            </div>
            <div class="set-row stack">
              <span class="set-label">Schrift im Editor</span>
              ${group('editorFont', [
                ['system', 'System'],
                ['serif', 'Serif', 'opt-font-serif'],
                ['mono', 'Mono', 'opt-font-mono'],
              ])}
            </div>
          </section>

          <section class="set-section">
            <h3>Bewegung &amp; Layout</h3>
            <div class="set-row">
              <span class="set-label">Animationen reduzieren<span class="set-hint">Keine Übergänge und Effekte</span></span>
              <button class="switch" type="button" role="switch" data-switch="reduceMotion" aria-label="Animationen reduzieren"></button>
            </div>
            <div class="set-row">
              <span class="set-label">Kompakte Ansicht<span class="set-hint">Kleinere Karten, mehr auf einen Blick</span></span>
              <button class="switch" type="button" role="switch" data-switch="compact" aria-label="Kompakte Ansicht"></button>
            </div>
          </section>
        </div>

        <footer class="modal-foot">
          <span class="note">Darstellung gilt nur für dieses Gerät.</span>
          <button class="ghost-btn" type="button" data-reset>Zurücksetzen</button>
        </footer>
      </div>`;
  }

  function sync() {
    const s = S.get();
    const theme = S.resolvedTheme();

    modal.querySelectorAll('[data-key]').forEach((grp) => {
      const value = s[grp.dataset.key];
      grp.querySelectorAll('[data-value]').forEach((btn) => {
        const on = btn.dataset.value === value;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-checked', String(on));
      });
    });

    modal.querySelectorAll('[data-preview]').forEach((el) => {
      const t = S.THEMES.find((x) => x.id === el.dataset.preview);
      el.style.background = previewBg(t[theme]);
      el.classList.toggle('light', theme === 'light');
    });

    const range = modal.querySelector('#setIntensity');
    if (document.activeElement !== range) range.value = s.intensity;
    range.style.setProperty('--p', s.intensity + '%');
    range.disabled = s.background === 'solid';
    modal.querySelector('#setIntensityOut').textContent = range.disabled ? '—' : s.intensity + ' %';

    modal.querySelectorAll('[data-switch]').forEach((sw) => {
      sw.setAttribute('aria-checked', String(s[sw.dataset.switch] === true));
    });
  }

  /* ---------- Öffnen / Schließen ---------- */

  let opener = null;
  let closing = false;

  function open() {
    if (!modal.hidden) return;
    opener = document.activeElement;
    sync();
    modal.hidden = false;
    closing = false;
    const sheet = modal.querySelector('.modal-sheet');
    sheet.focus({ preventScroll: true });
    if (!motion()) return;
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    modal.querySelector('.modal-scrim').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
    sheet.animate(
      mobile
        ? [{ transform: 'translateY(100%)' }, { transform: 'none' }]
        : [{ opacity: 0, transform: 'translateY(18px) scale(.96)' }, { opacity: 1, transform: 'none' }],
      { duration: 460, easing: EASE }
    );
  }

  function close() {
    if (modal.hidden || closing) return;
    closing = true;
    const finish = () => {
      if (!closing) return;
      closing = false;
      modal.hidden = true;
      modal.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
    if (!motion()) return finish();
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    modal.querySelector('.modal-scrim').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    const anim = modal.querySelector('.modal-sheet').animate(
      mobile
        ? [{ transform: 'none' }, { transform: 'translateY(100%)' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px) scale(.97)' }],
      { duration: 240, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }
    );
    anim.onfinish = finish;
    setTimeout(finish, 400);
  }

  /* ---------- Ereignisse ---------- */

  build();

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="settings"]')) open();
  });

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return close();
    if (e.target.closest('[data-reset]')) return S.reset();
    const sw = e.target.closest('[data-switch]');
    if (sw) {
      const key = sw.dataset.switch;
      return S.set({ [key]: !S.get()[key] });
    }
    const opt = e.target.closest('[data-value]');
    const grp = opt && opt.closest('[data-key]');
    if (opt && grp) S.set({ [grp.dataset.key]: opt.dataset.value });
  });

  modal.querySelector('#setIntensity').addEventListener('input', (e) => {
    S.set({ intensity: Number(e.target.value) });
  });

  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // Fokus im Fenster halten
      const items = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, true);

  S.subscribe(() => {
    if (!modal.hidden) sync();
  });

  /* ======================================================================
     Synchronisierung
     ====================================================================== */

  const SYNC = window.Erledigungen.sync;
  const section = modal.querySelector('#syncSection');
  const emailForm = section.querySelector('[data-form="email"]');
  const codeForm = section.querySelector('[data-form="code"]');
  const msg = section.querySelector('.sync-msg');
  const backBtn = section.querySelector('[data-sync-back]');
  let pendingEmail = '';
  let busy = false;

  const STATUS_TEXT = {
    synced: 'Synchronisiert',
    syncing: 'Synchronisiert …',
    offline: 'Offline – Änderungen werden später übertragen',
    error: 'Fehler beim Synchronisieren',
  };

  function friendlyError(err) {
    const m = String((err && err.message) || err || '');
    if (/rate limit|security purposes|only request this after/i.test(m)) return 'Zu viele Versuche – bitte in ein paar Minuten erneut.';
    if (/expired|invalid/i.test(m) && /token|otp/i.test(m)) return 'Der Code ist falsch oder abgelaufen.';
    if (/email.*invalid|invalid.*email/i.test(m)) return 'Diese E-Mail-Adresse ist ungültig.';
    if (/upsert_notes|relation .*notes|schema cache/i.test(m)) return 'Die Datenbank ist noch nicht eingerichtet (supabase/schema.sql ausführen).';
    if (/fetch|network|load failed/i.test(m)) return 'Keine Verbindung zum Server.';
    return m || 'Unbekannter Fehler.';
  }

  function setMsg(text, kind) {
    msg.textContent = text || '';
    msg.dataset.kind = kind || '';
  }

  function relTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60e3) return 'gerade eben';
    if (diff < 3600e3) return `vor ${Math.floor(diff / 60e3)} Min.`;
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  }

  function renderSync() {
    const st = SYNC ? SYNC.getState() : { status: 'unavailable' };
    const view = st.status === 'unavailable' ? 'unavailable' : st.user ? 'on' : 'off';
    section.querySelectorAll('[data-sync-view]').forEach((el) => {
      el.hidden = el.dataset.syncView !== view;
    });
    if (view === 'on') {
      section.querySelector('.sync-email').textContent = st.user.email;
      section.dataset.status = st.status;
      let text = STATUS_TEXT[st.status] || '';
      if (st.status === 'synced' && st.lastSyncedAt) text += ' · ' + relTime(st.lastSyncedAt);
      if (st.status === 'error' && st.error) text = friendlyError(st.error);
      section.querySelector('.sync-status').textContent = text;
    } else if (view === 'off') {
      emailForm.hidden = !!pendingEmail;
      codeForm.hidden = !pendingEmail;
      backBtn.hidden = !pendingEmail;
    }
  }

  function setBusy(form, on) {
    busy = on;
    form.querySelectorAll('input, button').forEach((el) => {
      el.disabled = on;
    });
  }

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !SYNC || !SYNC.enabled) return;
    const email = emailForm.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMsg('Bitte eine gültige E-Mail-Adresse eingeben.', 'error');
      return;
    }
    setBusy(emailForm, true);
    setMsg('Code wird gesendet …');
    try {
      await SYNC.sendCode(email);
      pendingEmail = email;
      setMsg(`Code an ${email} gesendet. Schau in dein Postfach (auch im Spam).`, 'ok');
      renderSync();
      codeForm.code.value = '';
      codeForm.code.focus();
    } catch (err) {
      setMsg(friendlyError(err), 'error');
    } finally {
      setBusy(emailForm, false);
    }
  });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !pendingEmail) return;
    const code = codeForm.code.value.replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(code)) {
      setMsg('Bitte den Code aus der E-Mail eingeben.', 'error');
      return;
    }
    setBusy(codeForm, true);
    setMsg('Anmelden …');
    try {
      await SYNC.verifyCode(pendingEmail, code);
      pendingEmail = '';
      setMsg('');
      renderSync();
    } catch (err) {
      setMsg(friendlyError(err), 'error');
    } finally {
      setBusy(codeForm, false);
    }
  });

  backBtn.addEventListener('click', () => {
    pendingEmail = '';
    setMsg('');
    renderSync();
  });

  section.querySelector('[data-sync-now]').addEventListener('click', () => SYNC && SYNC.syncNow());
  section.querySelector('[data-sign-out]').addEventListener('click', async () => {
    if (SYNC) await SYNC.signOut();
    renderSync();
  });

  if (SYNC) SYNC.subscribe(renderSync);
  renderSync();
  setInterval(() => {
    if (!modal.hidden) renderSync();
  }, 30e3);
})();
