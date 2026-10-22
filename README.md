# Erledigungen

Schlanke Notiz-App mit drei Status-Ordnern – **Nicht angefangen** (rot), **In Arbeit** (orange), **Fertig** (grün) – im Liquid-Glass-Design. Reines HTML/CSS/JavaScript, kein Build-Schritt.

## Starten

`index.html` doppelklicken – fertig. Für die Handy-Ansicht im WLAN einen kleinen Server starten:

```bash
python3 -m http.server 4173
```

Dann am Handy `http://<IP-deines-Macs>:4173` öffnen und über „Zum Home-Bildschirm“ als App ablegen.

## Bedienung

- **Übersicht** (Startbildschirm): zuletzt verwendete Notizen als Raster, links die drei Ordner.
- **Verschieben**: Notiz auf einen Ordner ziehen (Maus) bzw. lange drücken und ziehen (Touch). Alternativ der Farb-Umschalter oben im Editor.
- **Spalten**: Kanten zwischen den Spalten ziehen = Breite ändern, weit nach links ziehen = einklappen, Doppelklick = Standardbreite. Ein-/Ausblenden auch über die Knöpfe oben links im Editor.
- **Löschen**: Papierkorb zweimal klicken.
- **Einstellungen** (Regler-Symbol in der Übersicht/Seitenleiste): Hell/Dunkel/Automatisch, fünf Hintergründe mit Farbintensität, Glas-Stärke, Schriftgröße und -art im Editor, Animationen reduzieren, kompakte Ansicht. Gelten pro Gerät.
- Leere, nie bearbeitete Notizen werden beim Verlassen automatisch verworfen.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Struktur |
| `styles.css` | Design, Animationen, Handy-Layout |
| `js/store.js` | Datenschicht (Speichern, Sync-Vorbereitung) |
| `js/settings.js` | Darstellungs-Einstellungen und Hintergrund-Themes |
| `js/settings-panel.js` | Einstellungsfenster |
| `js/app.js` | Oberfläche, Drag & Drop, Spaltenbreiten |

## Live-Sync (Handy ⇄ Mac)

Aktuell liegen die Daten lokal im Browser; mehrere offene Fenster gleichen sich bereits live ab. Die Datenschicht ist für echten Geräte-Sync vorbereitet:

- jede Notiz hat `id`, `updatedAt`, `updatedBy` (Gerät) und `openedAt`
- Löschungen bleiben 30 Tage als Tombstone (`deleted: true`) erhalten, damit sie sich auf andere Geräte übertragen
- Konflikte: die neuere Änderung gewinnt („last write wins“)

Ein Backend (z. B. Supabase, Firebase oder ein eigener Server) wird über einen Adapter angeschlossen:

```js
Erledigungen.store.useSync({
  connect({ apply, snapshot }) {
    // 1. snapshot() einmal hochladen, Server-Stand per apply(notes) einspielen
    // 2. Echtzeit-Kanal abonnieren und eingehende Notizen an apply(...) geben
  },
  push(notes) {
    // geänderte Notizen (inkl. Tombstones) per upsert an den Server senden
  },
});
```

Als Tabelle reicht eine Zeile pro Notiz mit genau den Feldern oben.
