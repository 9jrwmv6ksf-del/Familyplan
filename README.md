# 🏡 Familyplan

Ein kinderfreundlicher Familienorganiser als Web-App (PWA). Alle Geräte der Familie
sehen dieselben Daten – live synchronisiert, und auch ohne Internet nutzbar.

## Funktionen

| Bereich | Was es kann |
|---|---|
| 🏠 **Heute** | Übersicht mit Terminen, Ämtli, Essen und Punktestand des Tages |
| 📅 **Kalender** | Monatsansicht mit farbigen Punkten pro Person, Termine mit Uhrzeit oder ganztags, Wiederholungen (täglich, wöchentlich an bestimmten Tagen, monatlich, jährlich), einzelne Tage einer Serie auslassen |
| ✅ **Ämtli** | Aufgaben mit Symbol, zuständiger Person und Punkten; einmalig, wiederkehrend oder „irgendwann“; Filter pro Person; beim Abhaken „Wer hat's gemacht?“ mit Konfetti 🎉 |
| 🛒 **Einkauf** | Gemeinsame Einkaufsliste zum Abhaken, doppelte Einträge werden erkannt |
| 🍽️ **Essen** | Wochenplan (Mittag/Abend) mit Zutaten; Zutaten einer Mahlzeit oder der ganzen Woche mit einem Tipp auf die Einkaufsliste; bekannte Gerichte werden vorgeschlagen |
| 👨‍👩‍👧 **Familie** | Personen mit Tier-Avatar und Farbe, Rangliste der Woche, Bonuspunkte vergeben und Punkte gegen Belohnungen einlösen 🎁 |

- **Echtzeit-Sync** zwischen allen Geräten (Server-Sent Events)
- **Offline-Modus**: Änderungen werden lokal gespeichert und später übertragen (Anzeige oben rechts)
- **Installierbar** als App auf Handy/Tablet („Zum Startbildschirm hinzufügen“)
- **Heller und dunkler Modus** automatisch
- **Kein Login** – gedacht fürs Heimnetz (siehe Sicherheit)

## Starten

Voraussetzung: **Node.js 22.13 oder neuer**. Es gibt keine weiteren Abhängigkeiten – `npm install` ist nicht nötig.

```bash
npm start
```

Dann im Browser <http://localhost:3000> öffnen. Andere Geräte im selben WLAN erreichen die App über
`http://<IP-des-Rechners>:3000`.

Einstellungen über Umgebungsvariablen:

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `HOST` | `0.0.0.0` | Netzwerk-Adresse |
| `DATA_DIR` | `./data` | Ordner für die SQLite-Datenbank |

### Mit Docker (z. B. auf Raspberry Pi oder NAS)

```bash
docker compose up -d
```

Die Daten liegen dann im Ordner `./data`.

## Erste Schritte

1. Unter **Familie** alle Personen anlegen (Kinder sammeln automatisch Punkte).
2. Unter **Ämtli** Aufgaben anlegen, z. B. „Tisch decken“, täglich, 2 Punkte.
3. Termine im **Kalender** eintragen und das **Essen** der Woche planen.
4. Auf jedem Gerät die Seite öffnen und zum Startbildschirm hinzufügen.

## Sicherheit

Es gibt absichtlich **keinen Login**. Jeder, der den Server erreicht, kann alles sehen und ändern.
Betreibe Familyplan daher nur im **Heimnetz** oder hinter einem VPN (z. B. Tailscale/WireGuard).
Für die Installation als App außerhalb von `localhost` verlangen Browser **HTTPS** –
z. B. über einen Reverse-Proxy wie Caddy oder über Tailscale HTTPS.

**Backup:** einfach den Ordner `data/` kopieren.

## Technik

- `server/server.js` – Node-Server ohne Abhängigkeiten: statische Dateien, eingebautes `node:sqlite`,
  Sync-API (`GET /api/changes`, `POST /api/ops`, `GET /api/stream`)
- `public/` – die PWA in reinem JavaScript (ES-Module, kein Build-Schritt)
  - `js/store.js` – lokaler Speicher + Offline-Warteschlange + Sync
  - `js/dates.js` – Datums- und Wiederholungslogik
  - `js/app.js` – Oberfläche
  - `sw.js` – Service Worker für den Offline-Betrieb
- Konflikte werden nach „letzte Änderung gewinnt“ pro Eintrag gelöst.

Bei Änderungen an den Dateien in `public/` die `VERSION` in `public/sw.js` erhöhen.

## Tests

```bash
npm test
```
