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

- Postgres and MySQL connections from a config file, listed on the start screen. Failed connections are reported in the footer.
- A sidebar with the tables and views in Postgres's `public` schema, or the MySQL connection's database. Its refresh button, or `Ctrl+R`, lists them again and closes the tabs of tables that are gone.
- Table data in a scrollable grid, up to `row_limit` rows (1000 by default). The footer shows the row and column count, and `(first 1000)` when there are more. The refresh button at the left of the footer, or `R`, reloads the active table or reruns the active query.
- An icon before each column name: a yellow key for primary keys, a white key for foreign keys (primary wins when a column is both), and otherwise a muted icon for the type. Types: text, integer, decimal, boolean (and MySQL's `tinyint(1)`), date, time, timestamp, interval, JSON, UUID, enum, binary, array, spatial, network, XML, or a generic icon. Postgres domains use their base type's icon. A `*` after the name marks a `NOT NULL` column. Columns and keys are read on every load, so outside schema changes show after a sort or reload.
- Sort by one column at a time, ascending or descending, shown by a chevron in the header (muted while loading). The database sorts the whole table before the row limit applies, so you see the true first rows. A column that can't be sorted, such as Postgres `json`, is reported in the footer and the rows stay as they were.
- Click a row to select it. Each tab keeps its selection until its rows reload.
- Edit a row in a sidebar by double clicking a cell, or with `E` on the selected row. Fields are inputs, textareas for long or multi-line text, lists for booleans and enums, and pretty printed textareas for JSON, which must parse to save. Nullable columns have a `NULL` toggle, so empty text and the text `NULL` stay strings. Saving writes only the changed columns, matched by primary key, and the grid shows the row as stored. Views and tables without a primary key open read only, as do generated columns and MySQL binary, bit and spatial values. Editing on Postgres needs version 12 or later.
- Delete a row, truncate or drop a table or view, or truncate or drop every table in the schema, from context menus, each after confirming. Truncating restarts Postgres identity columns, as MySQL does. Truncating or dropping a table that others reference fails with the database's error, while the schema wide actions handle references between the schema's tables. On Postgres, a dependent table or view outside the schema stops them, so nothing outside it changes. Rows of views and of tables without a primary key can't be deleted.
- Switch connections from the database name's menu.
- Errors stay in the footer until the next action, such as switching tabs, sorting, refreshing, running a query or saving.
- Tabs for several open tables, each as wide as its name (with a minimum) and with a close button. When they overflow, they reach the `+` at the edge and the last is cut there. The sidebar follows the active tab. Each tab keeps its scroll position, and each connection remembers its open tabs.
- Query tabs, opened with the `+` after the tabs, `N`, or New query in the database name's menu. Each has a SQL editor, a Run button and a results grid. A run may hold several `;` separated statements, and the grid shows the last one that returned rows, as text like table tabs, up to `row_limit` rows, with the full count in the footer. MySQL bit and spatial values, and binary values that aren't text, are shown as hex. A statement without rows shows its kind and, for writes, the rows changed. Results are read only.
- A failed run shows the database's error in place of the rows. On Postgres it also gives the line and column and moves the cursor there. The error is muted once the SQL changes. After a statement without rows, such as `CREATE TABLE`, the sidebar lists the tables again, and after a possible write the open tables reload when shown.
- Query tabs share their own connection, so a transaction or `SET` lasts across runs and tabs without reaching table tabs. Closing the connection rolls back an open transaction. Each connection remembers its query tabs and their SQL, but not results. Closing a query tab with SQL asks first.
- Values appear as the database formats them as text, so a date has no time and a Postgres `timestamptz` is in the session's time zone. MySQL binary and blob values are shown as hex (`0x00FF`), bits in binary (`101`) and spatial values as text (`POINT(1 2)`). `NULL` is muted italics. Control characters in values and names are shown as symbols.
- The last connection reopens on start. Closing it with `C` shows the list on the next start instead.
- Closing the connection returns to the start screen.
- A themeable UI, set in the config file.
- First party mouse support.

Existing rows can be edited and deleted in the grid. Other changes, such as inserts, are made with a query.

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
| `Escape` | Tables | Clear the selected row |
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
- Click a tab to switch to it, and its close button or a middle click to close it. The wheel scrolls tabs that don't fit. The `+` after the tabs opens a query tab.
- In a query tab, click the SQL to edit it and Run to run it. Click a result row to select it.
- Click a row to select it. `Escape` clears the selection.
- Double click a cell to edit its row, with that column's field focused. Click a field to focus it, or its `NULL` to toggle it. While the editor is open, other keys are paused and clicks don't change the selection. Sorting, switching or closing the tab, or opening another table asks first if the row has unsaved changes.
- Click a column header to cycle its sort: ascending, descending, none. Sorting another column replaces the current sort.
- The wheel scrolls the lists and the grid's rows, and Shift with the wheel, or a horizontal wheel, scrolls the columns. Scrollbars can be dragged.
- The sidebar header's close button closes the connection, and its refresh button lists the tables again.
- The footer's buttons act on the active tab: refresh reloads the table or reruns the query, truncate empties the table after confirming, and close closes the tab. They show only while a tab is open, and truncate only for a table tab.
- Right click for a menu. Clicking outside it or `Escape` closes it, and other keys are paused while it's open.
  - A row: Edit opens it in the editor, and Delete deletes it. Copy as CSV copies the column names and the row as two lines, with NULL as an empty field. Copy as JSON copies one object keyed by column name, with numbers, booleans and JSON values typed, NULL as `null` and the rest as strings. Numbers keep the database's digits. Copies go to the system clipboard, or the terminal's (OSC 52) without one. Right clicking selects the row, unless the editor is open.
  - A tab: Close closes the active tab, and Close all closes every tab. Right clicking a tab switches to it first.
  - A table in the sidebar: Truncate deletes all its rows, and Delete drops the table or view.
  - The database name in the sidebar header: New query opens a query tab, Switch lists the other connections, Truncate all empties every table, and Drop all drops every table and view.

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

mensa reads `~/.config/mensa/config.toml`. Every option is optional. Invalid entries are logged and skipped, as is a connection whose name is already taken.

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
accent = "#0369a1"
# surface defaults to an opaque bg
```

Passwords are stored in plain text, so keep the config readable only by you (`chmod 600`).

The last connection and each connection's open tabs are remembered by name in `~/.local/state/mensa/state.json`. Credentials are never written there.

## License

[MIT](LICENSE.md)
