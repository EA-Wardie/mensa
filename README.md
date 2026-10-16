<p align="center">
  <img src="assets/icon.png" alt="mensa icon" width="128">
</p>

# mensa

Terminal database client with first party mouse support. Built with OpenTUI on Bun.

## Disclaimers

- LLMs were used during development for research, prototyping, refactoring, and some code generation.
- This is beta software and bugs should be expected. Use at your own risk.
- A Nerd Font is required for icon support.

## Features

- Postgres connections defined in a user config file, listed on the start screen. A connection that fails is reported in the footer.
- The tables and views in the `public` schema, listed in a sidebar once connected.
- Table data in a scrollable grid, with the first `row_limit` rows (1000 by default) of each table. The footer shows the row and column count, and `(first 1000)` when the table has more rows than that.
- Several tables open at once, as tabs with a close button. Each tab remembers its scroll position, and each connection remembers its open tabs.
- Values shown as Postgres formats them as text, so a date has no time and a `timestamptz` is in the session's time zone. `NULL` is shown in muted italics. Newlines, tabs and other control characters in values and names are shown as symbols.
- mensa reopens the last connection on start. Closing it with `C` makes the next start show the list instead.
- Closing the connection returns to the start screen.
- A themeable UI, configurable through a user config file.
- First party mouse support.

This version only displays data. It can't edit data or run queries.

## Controls

| Key | Where | Action |
|---|---|---|
| `Up` / `K`, `Down` / `J` | Everywhere | Move the selection in the list |
| `Return` / `L` | Connections | Connect |
| `Return` | Tables | Open the selected table in a tab, or switch to it |
| `]`, `[` | Tables | Next and previous tab |
| `X` | Tables | Close the active tab |
| `PageUp`, `PageDown`, `Home`, `End` | Tables | Scroll the rows |
| `Left` / `H`, `Right` / `L` | Tables | Scroll the columns |
| `C` | Tables | Close the connection, after confirming |
| `Q` | Everywhere | Quit, after confirming |
| `Return`, `Escape` | Confirmation | Confirm or cancel |

Mouse controls:

- Double click a connection to connect, or a table to open it.
- Click a tab to switch to it. Click its close button or middle click it to close it. The wheel scrolls the tabs when they don't all fit.
- The mouse wheel scrolls the lists and the grid's rows. Shift with the wheel, or a horizontal wheel, scrolls the grid's columns. You can also drag the scrollbars.
- The close button in the sidebar header closes the connection.

## Installation

Requires x86_64 Linux and [Bun](https://bun.com).

```bash
bun install
bun run build
bun run install:app
```

This installs the binary to `~/.local/bin/mensa` and a desktop entry to `~/.local/share/applications`.

## Development

```bash
bun run dev
```

## Configuration

mensa reads `~/.config/mensa/config.toml`. Every option is optional. Invalid entries are logged and skipped. Connection names must be unique, so a later connection with a name that is already taken is skipped.

```toml
# Rows loaded per table.
row_limit = 1000

# Milliseconds between the clicks of a double click.
double_click_timeout = 250

# Where error logs are written, one JSONL file per day.
logs_path = "~/.local/state/mensa/logs"

# A connection takes a url…
[[connections]]
name = "Local"
url = "postgres://user:password@localhost:5432/app"

# …or separate fields. port defaults to 5432, must be at most 65535, and overrides the port in a url when set.
[[connections]]
name = "Staging"
host = "db.example.com"
port = 5432
user = "app"
password = "secret"
database = "app"
ssl = "require" # disable, allow, prefer, require, verify-ca or verify-full

[theme]
bg = "#0C0C0C"      # or "transparent"
fg = "#fafafa"
border = "#d4d4d4"
success = "#16a34a"
danger = "#dc2626"
accent = "#0369a1"
# surface defaults to an opaque bg
```

Passwords are stored in plain text in the config file, so keep it readable only by you (`chmod 600`).

The last connection, and the open tabs of each connection, are remembered by name in `~/.local/state/mensa/state.json`. Credentials are never written there.

## License

[MIT](LICENSE.md)
