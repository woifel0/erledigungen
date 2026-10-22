/*
 * Darstellungs-Einstellungen. Wird im <head> geladen, damit Theme und
 * Hintergrund schon vor dem ersten Zeichnen stimmen (kein Aufblitzen).
 * Einstellungen gelten pro Gerät und werden nicht mitsynchronisiert.
 */
(function (global) {
  'use strict';

  const KEY = 'erledigungen.settings.v1';

  // Hintergründe: eine Quelle für die echte Darstellung und die Vorschauen.
  const THEMES = [
    {
      id: 'calm',
      name: 'Ruhig',
      desc: 'Gedämpft, kaum Farbe',
      dark: { bg: '#0c0d12', blobs: ['#4a2a36', '#4a3a24', '#1f3d2e', '#2a2f52'], o: 0.9, blur: 130 },
      light: { bg: '#f2f3f6', blobs: ['#f6d3da', '#f7e3c8', '#d3ecdb', '#d8dcf5'], o: 0.9, blur: 130 },
    },
    {
      id: 'mist',
      name: 'Nebel',
      desc: 'Weiche Pastelltöne',
      dark: { bg: '#0d0f16', blobs: ['#8a5a9e', '#4f6fa8', '#3f7f7a', '#6a5aa8'], o: 0.45, blur: 130 },
      light: { bg: '#eef0f7', blobs: ['#e7c6f0', '#c9d8f5', '#c6ebe4', '#d8cff5'], o: 0.85, blur: 130 },
    },
    {
      id: 'midnight',
      name: 'Mitternacht',
      desc: 'Tiefes Blau',
      dark: { bg: '#060816', blobs: ['#2b2f8f', '#4b237a', '#0f5a7a', '#182464'], o: 0.75, blur: 110 },
      light: { bg: '#e9eefb', blobs: ['#c3cffd', '#dccdfb', '#bfe7f3', '#cdd6f8'], o: 0.9, blur: 110 },
    },
    {
      id: 'aurora',
      name: 'Aurora',
      desc: 'Kräftig und bunt',
      dark: { bg: '#05060a', blobs: ['#ff2d55', '#ff8a00', '#22c55e', '#5e5ce6'], o: 0.62, blur: 90 },
      light: { bg: '#eceff6', blobs: ['#ff2d55', '#ff8a00', '#22c55e', '#5e5ce6'], o: 0.42, blur: 90 },
    },
    {
      id: 'solid',
      name: 'Einfarbig',
      desc: 'Ganz ohne Verlauf',
      dark: { bg: '#101117', blobs: ['#101117', '#101117', '#101117', '#101117'], o: 0, blur: 90 },
      light: { bg: '#f2f3f6', blobs: ['#f2f3f6', '#f2f3f6', '#f2f3f6', '#f2f3f6'], o: 0, blur: 90 },
    },
  ];

  const OPTIONS = {
    mode: ['system', 'light', 'dark'],
    background: THEMES.map((t) => t.id),
    glass: ['clear', 'frosted', 'solid'],
    textSize: ['s', 'm', 'l'],
    editorFont: ['system', 'serif', 'mono'],
  };

  const DEFAULTS = {
    mode: 'system',
    background: 'calm',
    intensity: 60,
    glass: 'frosted',
    textSize: 'm',
    editorFont: 'system',
    reduceMotion: false,
    compact: false,
  };

  const mqLight = global.matchMedia('(prefers-color-scheme: light)');
  const listeners = new Set();

  function sanitize(raw) {
    const s = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return s;
    for (const key of Object.keys(OPTIONS)) {
      if (OPTIONS[key].includes(raw[key])) s[key] = raw[key];
    }
    if (Number.isFinite(raw.intensity)) s.intensity = Math.min(100, Math.max(0, Math.round(raw.intensity)));
    if (typeof raw.reduceMotion === 'boolean') s.reduceMotion = raw.reduceMotion;
    if (typeof raw.compact === 'boolean') s.compact = raw.compact;
    return s;
  }

  function load() {
    try {
      return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null'));
    } catch (e) {
      return sanitize(null);
    }
  }

  let current = load();

  function resolvedTheme() {
    if (current.mode === 'system') return mqLight.matches ? 'light' : 'dark';
    return current.mode;
  }

  function themeById(id) {
    return THEMES.find((t) => t.id === id) || THEMES[0];
  }

  function apply() {
    const root = document.documentElement;
    const theme = resolvedTheme();
    const palette = themeById(current.background)[theme];

    root.dataset.theme = theme;
    root.dataset.bg = current.background;
    root.dataset.glass = current.glass;
    root.dataset.text = current.textSize;
    root.dataset.font = current.editorFont;
    root.dataset.motion = current.reduceMotion ? 'reduced' : 'full';
    root.dataset.compact = String(current.compact);

    // Intensität 60 entspricht dem vorgesehenen Wert des Themes.
    const opacity = Math.min(1, palette.o * (current.intensity / 60));
    root.style.setProperty('--bg', palette.bg);
    palette.blobs.forEach((c, i) => root.style.setProperty(`--b${i + 1}`, c));
    root.style.setProperty('--blob-o', String(Math.round(opacity * 1000) / 1000));
    root.style.setProperty('--blob-blur', palette.blur + 'px');

    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', palette.bg);
    });
  }

  function emit() {
    for (const fn of listeners) {
      try {
        fn({ ...current });
      } catch (e) {
        console.error(e);
      }
    }
  }

  function set(patch) {
    current = sanitize({ ...current, ...patch });
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch (e) {
      /* nur für diese Sitzung */
    }
    apply();
    emit();
  }

  mqLight.addEventListener('change', () => {
    if (current.mode !== 'system') return;
    apply();
    emit();
  });

  // Andere Fenster übernehmen Änderungen sofort
  global.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = load();
    apply();
    emit();
  });

  apply();

  global.Erledigungen = Object.assign(global.Erledigungen || {}, {
    settings: {
      THEMES,
      DEFAULTS,
      get: () => ({ ...current }),
      set,
      reset: () => set(DEFAULTS),
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      resolvedTheme,
    },
  });
})(window);
