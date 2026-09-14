# FlightDeck Scheduler

A self-hosted, mobile-first flight and ground-crew scheduling application. FlightDeck imports weekly employee availability and pasted airline schedules, supports manual flight and crew changes, and automatically fills configurable lead and agent requirements.

## Start

1. Copy `.env.example` to `.env`.
2. Replace both password values with long, unique random values.
3. Run `docker compose up -d`.
4. Open `http://localhost:3000` and sign in with the configured admin account.

The application uses published Node and PostgreSQL images; Compose does not build an image. Source code is mounted into the Node container, so recreating or restarting the app container picks up code changes. Dependencies are installed into a Docker-managed volume when the container starts.

## Persistent and private data

- `data/postgres/` contains the database.
- `data/backups/` contains nightly PostgreSQL backups and manual JSON backups.
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
- Do not expose PostgreSQL publicly.
- There is no public account registration. Administrators create scheduler and viewer accounts.
- Discord issue notifications are enabled by setting `DISCORD_WEBHOOK_URL`.
