# oasys

**oasys** is a terminal UI (TUI) AI assistant that runs in your terminal. Chat with Google Gemini, or use **Terminal Agent** mode to let the AI run shell commands on your machine with full context (OS, CPU, memory, etc.).

- **Chat** — Normal conversational AI with optional web search and “thinking” (reasoning) mode.
- **Terminal Agent** — AI can run commands in your environment, see output, and iterate. Great for scripting, debugging, and system tasks.

Conversations are stored locally (SQLite). Built with [OpenTUI](https://git.new/create-tui), React, and [Bun](https://bun.sh).

## Install

### From GitHub (recommended)

Install the latest release binary (macOS, Linux, Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/purplem0n/oasys/main/oasys-tui/install.sh | bash
```

The script installs to `~/.local/bin` by default. Ensure that directory is in your `PATH`, or set a custom install directory:

```bash
OASYS_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/purplem0n/oasys/main/oasys-tui/install.sh | bash
```

To install a specific version (e.g. `v0.0.22`):

```bash
curl -fsSL https://raw.githubusercontent.com/purplem0n/oasys/main/oasys-tui/install.sh | bash -s -- v0.0.22
```

### From source

You need [Bun](https://bun.sh) installed.

```bash
git clone https://github.com/purplem0n/oasys.git
cd oasys/oasys-tui
bun install
bun run dev
```

To build a standalone executable for your platform:

```bash
cd oasys-tui
bun run build
```

Outputs are in `dist/` (e.g. `oasys-darwin-arm64.zip`).

## Usage

1. Run the app:
   ```bash
   oasys
   ```
   (Or `./oasys` if you installed the binary elsewhere and didn’t add it to `PATH`.)

2. **First run:** You’ll be prompted to set a **Google AI (Gemini) API key**. Get one at [Google AI Studio](https://aistudio.google.com/apikey). You can change it later with `/setup`.

3. Use the slash commands in the input bar:
   - **`/new`** — Start a new chat
   - **`/mode`** — Switch between **Chat** and **Terminal Agent**
   - **`/setup`** — Set or change your Google AI API key
   - **`/model`** — Choose a Gemini model
   - **`/history`** — Open past conversations
   - **`/thinking`** — Toggle reasoning/thinking mode
   - **`/websearch`** — Toggle web search

In **Terminal Agent** mode, the AI can run commands on your machine and see the results; you can approve or reject suggested commands.

## Requirements

- **Google AI (Gemini) API key** — Required for chat and agent. Free tier is available.
- **macOS, Linux, or Windows** — Pre-built binaries are published for common architectures (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64).

## Development

The TUI and API live in the `oasys-tui/` directory. See [oasys-tui/README.md](oasys-tui/README.md) for:

- Database (SQLite in `data/oasys.sqlite`, auto-created)
- Drizzle schema and migrations
- Build and release (CI builds all platforms and attaches zips to GitHub Releases)

## License

See repository for license information.

## Links

- **Repository:** [github.com/purplem0n/oasys](https://github.com/purplem0n/oasys)
- **Releases:** [Releases](https://github.com/purplem0n/oasys/releases)
