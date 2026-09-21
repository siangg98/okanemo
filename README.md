<p align="center">
  <img src="brand/logo.png" alt="Okanemo logo" width="160" />
</p>

<h1 align="center">Okanemo</h1>

<p align="center">A self-hosted bookkeeping app for small businesses.</p>

Okanemo helps a small business track purchasing, inventory, sales, and finances in one place. One local server stores a shared business dataset in SQLite. The Docker setup keeps that database in a named volume.

## Stack

- React 18 (hooks + Context API)
- Vite 5
- Chart.js + react-chartjs-2
- lucide-react

## Docker

To show Okanemo as one Docker Desktop row named `okanemo`, use the standalone launcher:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker-standalone.ps1
```

The launcher preserves the data volume from an existing Compose installation, removes its Compose container without deleting the volume, and starts one standalone container named `okanemo`.

Open <http://127.0.0.1:8888>. On first launch, choose **Import Backup** to move existing data, or **Start Fresh**. The Compose file binds only to this computer's loopback address. The database is in the `okanemo-data` volume; dated backups are in `./backups` on the host. Copy that folder to another device regularly. Settings can restore both JSON exports and stored backups.

Removing the container leaves the named volume in place. Removing the volume deletes the working database, so keep the host backup folder separately.

Compose remains available with `docker compose up --build -d`. Docker Desktop groups every Compose project by design and displays its service as a nested row, even when the project contains only one container.

## Local development

```bash
npm install
npm run server    # storage API on http://127.0.0.1:8080
npm run dev       # in a second terminal; UI on http://localhost:5173
```

## Commands

```bash
npm run dev       # start dev server
npm run server    # start local storage server
npm run build     # production build -> dist/
npm test          # storage API integration test
npm run lint      # eslint (0 warnings allowed)
npm run format    # prettier over src/**/*.{js,jsx,css}
```

## Project structure

```
src/
  App.jsx                    # Root: tab-based navigation, dark mode
  main.jsx                   # Entry point
  context/AppContext.jsx     # Global store, migrations, and server save queue
  hooks/useApp.js            # useContext(AppContext) shorthand
  utils/                     # Constants, formatting/cost math, data migrations
  components/
    Sidebar.jsx, TopBar.jsx
    pages/                   # One file per tab (Dashboard, Sales, Inventory, ...)
    shared/                  # Reusable UI components
```

## Data model

State is split into nine slices — suppliers, reloads, orders, shipments, products, sales, expenses, accounts, transfers — stored together as one versioned SQLite snapshot. Money flows through a five-stage purchasing pipeline: **reload** (convert currency into a wallet) → **order** (purchase against that wallet) → **shipment** (consolidate purchases) → **arrival** (freeze landed cost per unit) → **sale** (FIFO draw from cost batches). Account-to-account moves sit outside that pipeline: a transfer just moves MYR between two MYR accounts, so it is neither income nor spending.

## Backup & restore

Settings → Backup & Restore exports and imports a JSON snapshot. The server also makes one dated SQLite backup per day, keeps 30 daily copies, and makes extra copies before restore or Clear All Data. These files live in `./backups` on the host. A host folder on the same computer does not protect against disk or computer failure; copy it off-device.
