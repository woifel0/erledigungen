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

## Sync zwischen Geräten (Supabase)

Anmeldung in den Einstellungen mit E-Mail und Passwort. Danach werden alle Notizen live zwischen allen angemeldeten Geräten abgeglichen. Offline wird weitergeschrieben und später übertragen; bei Konflikten gewinnt die neuere Änderung (in der App und auf dem Server nach derselben Regel). Löschungen werden als Tombstone (`deleted: true`) übertragen.

| Datei | Inhalt |
|---|---|
| `js/config.js` | Supabase-URL und öffentlicher anon-Key |
| `js/sync.js` | Warteschlange, Hoch-/Nachladen, Realtime, Anmeldung |
| `supabase/schema.sql` | Tabelle, Zugriffsregeln (nur eigene Notizen), Konflikt-Funktion |
| `sw.js` | Offline-Start der App |

### Einmalige Einrichtung in Supabase

1. **SQL Editor** → Inhalt von `supabase/schema.sql` einfügen → *Run* (erledigt).
2. **Authentication → URL Configuration**: *Site URL* auf die GitHub-Pages-Adresse setzen, damit Bestätigungs- und Passwort-Links dort landen.

Hinweis: Ohne eigenen Mailserver verschickt Supabase nur wenige E-Mails pro Stunde und nur an Adressen von Mitgliedern des Supabase-Teams.
