# Volume-backed storage plan

## Scope

One Okanemo installation serves one business dataset to browsers on the same computer. The nine business record collections move from browser `localStorage` to a server-owned SQLite database stored in a Docker named volume. Browser-only preferences such as dark mode can remain local.

## Startup and migration

- The Docker service listens on `127.0.0.1` and serves both the app and its data API from one origin.
- An empty server shows a setup choice: import an existing Okanemo JSON backup or start fresh. Nothing silently copies data from a browser origin.
- The import accepts the existing backup format, validates the dataset, and replaces the server dataset only after confirmation. A later restore makes a backup of the current server dataset before replacing it.
- Starting fresh creates the normal default accounts. Existing data migrations and derived-data replay must run before the imported dataset becomes writable.

## Saves and multiple tabs

- SQLite stores one complete dataset snapshot with a monotonically increasing revision. A save is atomic and succeeds only when its expected revision matches the stored revision.
- The browser shows a rejected or unavailable save clearly and keeps entered form values available for recovery. It never reports a failed save as successful.
- An idle tab reloads the latest dataset when it regains focus. An open form is preserved; its eventual save still checks the revision, so it cannot silently overwrite a newer change.
- The existing business calculations continue to produce a complete, internally consistent dataset before each save.

## Backup and recovery

- A host folder receives one dated backup per day, retains 30 daily copies, and receives an extra backup before restore or Clear All Data.
- Backups can be restored through the app after validation and strong confirmation. Clear All Data remains available with strong confirmation and a pre-clear backup.
- The operator copies the backup folder off-device. A Docker volume and a backup folder on the same computer do not protect against loss of that computer.

## Verification

- Recreating the app container with the same volume preserves all nine record collections.
- A browser with a fresh profile sees the same dataset; a stale tab cannot overwrite a newer save.
- An unavailable database blocks edits and displays an error; an open form keeps its entered values.
- Import, restore, daily backup, pre-restore backup, and pre-clear backup can each be exercised with a small dataset and checked for full recovery.
