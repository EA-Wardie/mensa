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

- Postgres and MySQL connections from a config file, with production ones marked by a red dot and listed last.
- The last connection reopens on start, and each connection remembers its open tabs.
- A sidebar of the schema's tables and views.
- Tabs for tables and queries.
- A fast grid of up to `row_limit` rows, with type and key icons on the columns.
- Sorting by one column at a time, done by the database before the row limit applies.
- Keyboard focus that moves between the sidebar and the rows with `Tab`.
- Marking several rows to copy them together.
- A read only row view with pretty printed, highlighted JSON.
- A row editor that saves only the changed columns, matched by primary key.
- Copying a cell, a row or the marked rows as CSV or JSON, and copying table and column names.
- Deleting rows, and truncating or dropping tables, after confirming.
- Query tabs with a SQL editor and a results grid, on their own connection, so transactions last across runs.
- Errors in the footer until the next action, with the line and column of a Postgres SQL error.
- A themeable UI with first party mouse support.

## Limitations

- Inserts and other changes beyond editing and deleting rows are made with a query.
- Editing on Postgres needs version 12 or later.
- Views and tables without a primary key are read only. So are generated columns and MySQL binary, bit and spatial values.
- Values are shown as the database formats them as text. Binary is shown as hex.
- Truncating or dropping a table that others reference fails with the database's error.

## Controls

| Key | Where | Action |
|---|---|---|
| `Up` / `K`, `Down` / `J` | Everywhere | Move the selection in the list, or in the focused pane: the tables or the rows, which the row view follows |
| `Return` / `L` | Connections | Connect |
| `Tab` | Tables | Move the focus between the tables and the rows |
| `Return` | Tables | Open the selected table in a tab, or switch to it, and focus its rows |
| `]`, `[` | Tables | Next and previous tab |
| `X` | Tables | Close the active tab |
| `PageUp`, `PageDown`, `Home`, `End` | Tables | Scroll the rows |
| `Left` / `H`, `Right` / `L` | Tables | Scroll the columns |
| `Space` | Tables | Mark or unmark the selected row, then select the next |
| `Escape` | Tables | Close the row view, or clear the marks, or the selected row |
| `V` | Tables | View the selected row, in a table or a query tab |
| `E` | Tables | Edit the selected row, or the SQL in a query tab |
| `N` | Tables | Open a new query tab |
| `R` | Tables | Reload the active table, or rerun the active query |
| `Ctrl+R` | Tables | List the tables again |
| `Tab`, `Shift+Tab` | Editor | Next and previous field |
| `Up` / `K`, `Down` / `J` | Editor | Pick from a boolean or enum list |
| `Ctrl+N` | Editor | Toggle the field's `NULL` |
| `Ctrl+S` | Editor | Save the changed columns |
| `Escape` | Editor | Close, asking first if there are unsaved changes |
| `Ctrl+Return`, `Alt+Return` | Query | Run the SQL. `Ctrl+Return` also works outside the editor. Terminals without the kitty keyboard protocol send `Ctrl+Return` as `Return`, so use `Alt+Return` there. |
| `Escape` | Query | Leave the SQL, so the other keys work again |
| `C` | Tables | Close the connection, after confirming |
| `Q` | Everywhere | Quit, after confirming |
| `Return`, `Escape` | Confirmation | Confirm or cancel |
| `Escape` | Menu | Close the menu |

Mouse controls:

- Double click a connection to connect, or a table to open it.
- Click a tab to switch to it. Close it with its close button or a middle click. The `+` opens a query tab.
- Click a row to select it, and double click a cell to view its row.
- `Ctrl+click` a row to mark or unmark it.
- Click a column header to cycle its sort: ascending, descending, none.
- In the editor, double click a cell of its row to focus that column's field.
- The wheel scrolls lists, tabs and rows. Shift with the wheel scrolls the columns. Scrollbars can be dragged.
- The footer's buttons refresh, truncate or close the active tab.
- Right click for a menu:
  - A row: View, Edit, Delete, Copy cell, and Copy row or the marked rows as CSV or JSON.
  - A query result row: View and the copies.
  - A column header: Copy name.
  - A tab: Copy name, Close and Close all.
  - A table in the sidebar: Refresh, Copy name, Truncate and Delete.
  - The database name, or its menu button: New query, Refresh, Switch, Close, Truncate all and Drop all.

## Installation

Released for Linux on x86_64 and macOS on Apple silicon. Building needs [Bun](https://bun.com) 1.4.4 or later.

```bash
bun install --os="*" --cpu="*"
bun run build
bun run install:linux # or install:macos
```

`bun install --os="*" --cpu="*"` installs OpenTUI's native library for every platform, since the build compiles both `dist/mensa-linux-x64` and `dist/mensa-darwin-arm64`. It also wraps `mensa-darwin-arm64` in `dist/Mensa.app`.

`install:linux` installs the binary to `~/.local/bin/mensa` and adds a desktop entry to `~/.local/share/applications`.

`install:macos` installs `Mensa.app` to `~/Applications`, where Spotlight finds it, and links `~/.local/bin/mensa` to its binary. It removes the quarantine attribute and signs the binary ad hoc, so a downloaded copy runs. Opening the app runs mensa in Terminal, or the terminal set by `terminal` in the config.

`bun run archive` packs the releases, each with its install script as `install.sh`: `dist/Release-linux-x64 <version>.tar.xz` with the binary and icon, and `dist/Release-darwin-arm64 <version>.zip` with `Mensa.app`. It needs `zip` installed. Extract one and run `install.sh`.

## Development

```bash
bun run dev
```

## Configuration

mensa reads `~/.config/mensa/config.toml`. Every option is optional. Invalid entries are logged and skipped, as is a connection whose name is already taken. A production connection may share its name with one that isn't, such as a local and a live copy of the same database.

```toml
# Rows loaded per table.
row_limit = 1000

# Milliseconds between the clicks of a double click.
double_click_timeout = 250

# Where error logs are written, one JSONL file per day.
logs_path = "~/.local/state/mensa/logs"

# macOS only: the terminal Mensa.app opens in. Terminal by default.
# Also iTerm, Ghostty, kitty, WezTerm or Alacritty. Must come before the first [table].
terminal = "Terminal"

# A connection takes a url…
[[connections]]
name = "Local"
url = "postgres://user:password@localhost:5432/app"

# …or separate fields. port defaults to 5432 for Postgres and 3306 for MySQL, goes up to 65535, and overrides a url's port.
[[connections]]
name = "Staging"
host = "db.example.com"
port = 5432
user = "app"
password = "secret"
database = "app"
ssl = "require" # disable, allow, prefer, require, verify-ca or verify-full
# Marks the connection with a red dot and lists it with the other production
# connections. Defaults to false.
production = true

# driver is postgres (the default) or mysql, which a mysql://, mysql2:// or mariadb:// url implies.
# MySQL needs a database. Its ssl defaults to prefer unless the url sets ssl or sslmode,
# since MySQL 8 refuses a password over an unencrypted connection by default.
[[connections]]
name = "Shop"
driver = "mysql"
host = "localhost"
user = "root"
password = "secret"
database = "shop"
# Only for a trusted local server without TLS: lets mensa fetch the server's key to send the password,
# which someone on the network could replace to read it. Defaults to false.
# allow_public_key_retrieval = true

[theme]
bg = "#0C0C0C"      # or "transparent"
fg = "#fafafa"
border = "#d4d4d4"
success = "#16a34a"
danger = "#dc2626"
warning = "#eab308"  # the primary key icon, #a16207 by default on a light bg
accent = "#0369a1"  # marked rows
# surface defaults to an opaque bg
# scrollbar, the grid's scrollbar thumbs, blended faintly over the borders, defaults to fg

# JSON in the row view. These are the defaults on a dark bg, and
# #0A3069, #0550AE and #CF222E on a light one (or a dark fg with a transparent bg).
[theme.syntax]
string = "#A5D6FF"
number = "#79C0FF"
constant = "#FF7B72" # true, false and null
```

Passwords are stored in plain text, so keep the config readable only by you (`chmod 600`).

The last connection and each connection's open tabs are remembered by name, and whether it's production, in `~/.local/state/mensa/state.json`. Credentials are never written there.

## License

[MIT](LICENSE.md)
