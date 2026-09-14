# FlightDeck Scheduler

A self-hosted, mobile-first flight and ground-crew scheduling application. FlightDeck imports weekly employee availability and pasted airline schedules, supports manual flight and crew changes, and automatically fills configurable lead and agent requirements.

## Start

1. Run `npm install`.
2. Run `npm start`.
3. Open `http://localhost:3000`.
4. On the first start, read the generated login from `data/initial-admin-password.txt`.

The database is embedded in the Node process and created automatically in `data/flightdeck.pgdata`. No database server, Docker service, database URL, or `.env` file is required. Migrations run automatically on every startup.

## Local npm development

For automatic restart after source changes, use:

```bash
npm run dev
```

The app listens on all network interfaces. To test from a phone on the same network, use the computer's LAN address and ensure the firewall permits the application port, for example `http://192.168.1.20:3000`.

## Docker deployment

Run `docker compose up -d`. Compose uses a published Node image and does not build an image. It runs the same `npm start` command and mounts the same `data` directory for persistence. Configuration through `.env` is optional; see `.env.example` for available overrides.

## Persistent and private data

- `data/flightdeck.pgdata/` contains the embedded database.
- `data/backups/` contains nightly and manual compressed database backups.
- `private/` is ignored by Git and intended for source schedules and screenshots.

Nightly backups retain the latest 30 days. Copy the entire `data` directory to separate storage regularly; a backup kept only on the same server is not protection from disk failure.

## Initial workflow

1. In Administration, define each airline's minimum lead/agent requirements and work window.
2. In People, import a Monday–Sunday employee schedule and review the extracted records.
3. In Import flights, paste an airline message, confirm inferred turns, and import it.
4. Open the Flight board and run auto-scheduling. Understaffed turns are shown in red.
5. Add locked manual assignments from the board as needed.

Image imports use OCR and always require review. Excel/CSV imports are more reliable when their first column contains the employee name followed by start/end column pairs for Monday through Sunday.

## Production notes

- Put the app behind a TLS-enabled reverse proxy and set `COOKIE_SECURE=true`.
- There is no public account registration. Administrators create scheduler and viewer accounts.
- Discord issue notifications are enabled by setting `DISCORD_WEBHOOK_URL`.
