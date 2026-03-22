# accal - Skydiving Dropzone Calendar

A web application for managing skydiving dropzone schedules. Admins create jump days, configure required roles (pilot, manifest, drop zone leader, etc.), and club members sign up for the roles they're qualified for. The calendar shows at a glance which days are fully staffed, partially filled, or missing critical roles.

## Features

- **Calendar view** with color-coded status per jump day (full / partial / empty)
- **Role-based signups** — users can only sign up for roles they hold
- **Configurable roles** — admins set labels, requirement levels (required / limiting / optional), and min/max per day
- **Jump day cancellation** with optional reason, email notifications, and reversibility
- **User management** — admin can assign roles, delete users (DSGVO-compliant anonymization)
- **Multiple auth methods** — Google & GitHub OAuth, magic link email, passkeys (WebAuthn)
- **iCal import** — bulk-create jump days from `.ics` files

## Tech Stack

| Layer     | Technology                              |
| --------- | --------------------------------------- |
| Frontend  | Svelte 5 (runes, SPA)                   |
| Backend   | Hono (Node.js)                          |
| Database  | SQLite via better-sqlite3 + Drizzle ORM |
| Auth      | Arctic (OAuth), WebAuthn, magic links   |
| Toolchain | Vite+ (`vp`) monorepo                   |

## Project Structure

```
apps/web/        # Svelte 5 SPA (calendar UI)
apps/server/     # Hono API server (Node.js + SQLite)
packages/shared/ # Shared types & constants
```

## Prerequisites

- Node.js >= 22.12.0
- [Vite+](https://vite.plus) (`vp`) CLI installed globally
- pnpm 10.x (managed via `packageManager` field)

## Development Setup

1. **Install dependencies:**

   ```bash
   vp install
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` to set at least one auth provider (Google/GitHub OAuth credentials) or SMTP settings for magic link login. For local development the defaults work with passkey auth out of the box.

3. **Start the dev servers:**

   ```bash
   vp run dev
   ```

   This runs both the API server (port 3000) and the Vite dev server (port 5173) concurrently. The frontend proxies `/api` requests to the backend.

   You can also run them separately:

   ```bash
   vp run dev:web      # frontend only (port 5173)
   vp run dev:server   # backend only (port 3000)
   ```

4. **Open the app:** visit `http://localhost:5173`

   The first user to sign up automatically becomes an admin.

## Testing

```bash
vp test              # run all tests
vp test --coverage   # with coverage report
```

## Linting & Type Checking

```bash
vp check             # format, lint, and type check
vp check --fix       # auto-fix formatting issues
```

## Production Build

```bash
vp run build -r      # build all packages
```

A Docker setup is available via the included `Dockerfile`.

## Environment Variables

See [`.env.example`](.env.example) for all available options including OAuth, SMTP, WebAuthn, and database configuration.
