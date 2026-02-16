# oasys-tui

To install dependencies:

```bash
bun install
```

To run:

```bash
bun dev
```

## Database (`data/oasys.sqlite`)

- **Directory**: The `data/` folder is created automatically on first run (see `src/server/utils/drizzle.ts`).
- **File**: The SQLite file `data/oasys.sqlite` is created when the app first connects (libsql creates it if missing).
- **Schema**: Tables are created automatically on server startup via embedded init SQL (`src/server/db/init.sql.ts`), so no manual setup is required for the compiled CLI or for `bun dev`.

For development you can still use **`bun run drizzle-setup`** (`drizzle-kit push`) to sync the schema from `src/server/db/schema.ts` to the DB; after changing the schema, update `init.sql.ts` to match (or re-run `drizzle-kit generate` and copy the generated SQL into `init.sql.ts` with `CREATE TABLE IF NOT EXISTS`).

## Build and release

Build standalone executables for all platforms (macOS, Linux, Windows):

```bash
bun run build
```

Outputs zip files in `dist/`: `oasys-darwin-arm64.zip`, `oasys-darwin-x64.zip`, `oasys-linux-x64.zip`, `oasys-linux-arm64.zip`, `oasys-windows-x64.zip`.

### Releasing

1. Push a version tag to trigger the GitHub Action (e.g. `v1.0.0`). The workflow builds all platforms and creates a GitHub Release with the zip artifacts attached.
2. Set the default repo in `install.sh`: change `GITHUB_REPO="${GITHUB_REPO:-YOUR_ORG/oasys}"` to your `owner/repo`.
3. Users can install with:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/oasys/main/oasys-tui/install.sh | bash
   ```

   Or host `install.sh` on your own domain (e.g. `https://opencode.ai/install`) and serve the same script; it will download binaries from the GitHub Release.

This project was created using `bun create tui`. [create-tui](https://git.new/create-tui) is the easiest way to get started with OpenTUI.
