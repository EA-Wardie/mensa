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

- Postgres and MySQL connections defined in a user config file, listed on the start screen. A connection that fails is reported in the footer.
- The tables and views in the `public` schema on Postgres, or the connection's database on MySQL, listed in a sidebar once connected.
- Table data in a scrollable grid, with the first `row_limit` rows (1000 by default) of each table. The footer shows the row and column count, and `(first 1000)` when the table has more rows than that.
- An icon before each column name. Primary key columns have a yellow key and foreign key columns a white one, in the text colour, and a column in both shows the primary key's. Other columns have a muted icon for their type: text, integer, decimal, boolean (also MySQL's `tinyint(1)`), date, time, timestamp, interval, JSON, UUID, enum, binary, array, spatial, network, XML, or a generic one for other types. A Postgres domain shows its base type's icon. The columns and keys are read again on every load, so changes made elsewhere show after a sort or reload.
- Sort a table by one column at a time, ascending or descending, with a chevron in the sorted column's header. The chevron is muted while the sorted rows load. The database sorts the whole table by the column's type before the row limit applies, so the grid shows the true first rows. A column the database can't sort, such as Postgres `json`, is reported in the footer and the rows stay as they were.
- Select a row in the grid by clicking it. Each tab keeps its selected row until its rows reload, such as after a sort.
- Edit a row in a sidebar by double clicking one of its cells, or with `E` on the selected row. Every column has a field: an input, or a textarea for long and multi-line text, a list to pick from for booleans and enums, and a textarea with the value pretty printed for JSON, which must parse before it saves. A nullable column has a `NULL` toggle, so an empty text and the text `NULL` stay strings. Save writes only the columns that changed, matched by the primary key, and the grid shows the row as the database stored it. Rows of views and of tables without a primary key open read only. Generated columns are read only, as are MySQL binary, bit and spatial values. Editing on Postgres needs version 12 or later.
- Delete a row, truncate or drop a table or view, and truncate or drop every table in the schema, from context menus. Each asks first, and the schema wide ones ask twice. Truncating restarts a Postgres table's identity columns, as MySQL does. Truncating or dropping one table that others reference fails with the database's error rather than emptying or changing them, while the schema wide ones handle the references between the schema's tables. On Postgres, a table or view outside the schema that depends on one inside it stops them, so nothing outside the schema changes. Rows of views and of tables without a primary key can't be deleted.
- Switch to another connection from the database name's menu.
- Several tables open at once, as tabs with a close button. The sidebar selects the active tab's table. Each tab remembers its scroll position, and each connection remembers its open tabs.
- Values shown as the database formats them as text, so a date has no time and a Postgres `timestamptz` is in the session's time zone. MySQL binary and blob values are shown as hex, such as `0x00FF`, bits in binary, such as `101`, and spatial values as text, such as `POINT(1 2)`. `NULL` is shown in muted italics. Newlines, tabs and other control characters in values and names are shown as symbols.
- mensa reopens the last connection on start. Closing it with `C` makes the next start show the list instead.
- Closing the connection returns to the start screen.
- A themeable UI, configurable through a user config file.
- First party mouse support.

This version can edit and delete existing rows, but can't insert rows or run queries.

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
| `E` | Tables | Edit the selected row |
| `Tab`, `Shift+Tab` | Editor | Next and previous field |
| `Up` / `K`, `Down` / `J` | Editor | Pick from a boolean or enum list |
| `Ctrl+N` | Editor | Toggle the field's `NULL` |
| `Ctrl+S` | Editor | Save the changed columns |
| `Escape` | Editor | Close, asking first when there are unsaved changes |
| `C` | Tables | Close the connection, after confirming |
| `Q` | Everywhere | Quit, after confirming |
| `Return`, `Escape` | Confirmation | Confirm or cancel. The second confirmation for truncating or dropping every table needs a click instead of `Return`. |
| `Escape` | Menu | Close the menu |

Mouse controls:

- Double click a connection to connect, or a table to open it.
- Click a tab to switch to it. Click its close button or middle click it to close it. The wheel scrolls the tabs when they don't all fit.
- Click a row to select it. `Escape` clears the selection.
- Double click a cell to edit its row, with that column's field focused. Click a field to focus it, and a field's `NULL` to toggle it. While the editor is open, other keys are paused and clicking a row doesn't change the selection. Sorting, switching or closing the tab, or opening another table asks first when the row has unsaved changes.
- Click a column header to sort by it. Each click moves it from no sort to ascending, then descending, then back to no sort. Sorting another column replaces the current sort.
- The mouse wheel scrolls the lists and the grid's rows. Shift with the wheel, or a horizontal wheel, scrolls the grid's columns. You can also drag the scrollbars.
- The close button in the sidebar header closes the connection.
- Right click to open a menu, and click an item to choose it. Clicking outside the menu or `Escape` closes it, and other keys are paused while it's open.
  - A row: Edit opens it in the editor, and Delete deletes it. Right clicking selects the row, unless the editor is open.
  - A tab: Close closes the active tab, and Close all closes every tab. Right clicking a tab switches to it first.
  - A table in the sidebar: Truncate deletes all its rows, and Delete drops it, or the view.
  - The database name in the sidebar header: Switch lists the other connections to switch to. Truncate all empties every table, and Drop all drops every table and view.

## Installation

Runs on Linux and macOS, on x86_64 and arm64. Building requires [Bun](https://bun.com).

```bash
bun install --os="*" --cpu="*"
bun run build
bun run install:app
```

`bun install --os="*" --cpu="*"` installs OpenTUI's native library for every platform, since the build compiles a binary for each one: `dist/mensa-linux-x64`, `mensa-linux-arm64`, `mensa-darwin-x64` and `mensa-darwin-arm64`.

`bun run archive` then packs `dist/mensa-darwin-arm64` and `dist/mensa-linux-x64`, each with the install script and the icon, into `dist/Release-darwin-arm64 <version>.tar.xz` and `dist/Release-linux-x64 <version>.tar.xz` for a release. Extract one and run `install.sh` from it.

The install script picks the binary for your system and installs it to `~/.local/bin/mensa`. On Linux it also adds a desktop entry to `~/.local/share/applications`. On macOS it removes the quarantine attribute, so a downloaded binary can run.

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

# …or separate fields. port defaults to 5432 for Postgres and 3306 for MySQL, must be at most 65535, and overrides the port in a url when set.
[[connections]]
name = "Staging"
host = "db.example.com"
port = 5432
user = "app"
password = "secret"
database = "app"
ssl = "require" # disable, allow, prefer, require, verify-ca or verify-full

# driver is postgres or mysql. It defaults to postgres, or mysql for a mysql://, mysql2:// or mariadb:// url.
# MySQL needs a database, in the url or as database. ssl defaults to prefer, unless the url sets ssl or sslmode,
# since MySQL 8 refuses a password over an unencrypted connection by default.
[[connections]]
name = "Shop"
driver = "mysql"
host = "localhost"
user = "root"
password = "secret"
database = "shop"
# Only for a trusted local server without TLS: lets mensa fetch the server's key to send the password,
# which someone on the network could replace with their own to read the password. Defaults to false.
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

Passwords are stored in plain text in the config file, so keep it readable only by you (`chmod 600`).

The last connection, and the open tabs of each connection, are remembered by name in `~/.local/state/mensa/state.json`. Credentials are never written there.

## License

[MIT](LICENSE.md)
