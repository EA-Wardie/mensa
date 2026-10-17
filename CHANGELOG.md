# Changelog

## 0.2.0

### Added

- MySQL connections. A connection's `driver` is `postgres` or `mysql`, and defaults to `postgres`, or `mysql` for a `mysql://`, `mysql2://` or `mariadb://` url. MySQL lists the tables and views of the connection's database, so it needs one, in the url or as `database`, and its port defaults to 3306. Its `ssl` defaults to `prefer`, unless the url sets `ssl` or `sslmode`, since MySQL 8 refuses a password over an unencrypted connection by default. `allow_public_key_retrieval = true` lets it send a password without TLS, for trusted local servers. Binary and blob values are shown as hex, bits in binary and spatial values as WKT text. Sorting, the row limit and tabs work as they do for Postgres.

### Changed

- The sidebar names the schema when it has no tables, such as `No tables in shop`.

### Internal

- `lib/database.ts` keeps a `Dialect` per driver, with its identifier quote, its text cast for each data type, and the schema it lists as an expression, `'public'` or MySQL's `DATABASE()`, which connecting selects to check the connection. The open client, its dialect and its schema are kept together. The driver names are Bun's adapter names, and each driver's default port, ssl and need for a database sit in one table in `lib/config.ts`. `information_schema` columns are aliased, since MySQL names them in capitals. Loaded `TableData` keeps each column's data type, so a re-sort casts the same way. `$schema` holds the listed schema, and is empty when listing the tables failed, so the sidebar says `Could not list tables` instead of `No tables in …`.

## 0.1.1

### Added

- Clicking a row in the grid selects it, shown in the selection colour. Clicking it again keeps it selected, and `Escape` clears it. Each tab keeps its own selected row, and new rows clear it, such as after a sort. A failed sort keeps it.

### Changed

- Dragging the grid's horizontal scrollbar no longer highlights the row under the mouse.

### Internal

- `$selectedRows` holds each open table's selected row as an index into its loaded rows, ready for an editing sidebar to read. `loadTable` clears it when new rows arrive, and closing the tab or the connection forgets it.
- `DataGrid` is split up. `lib/grid.ts` measures and fits a table's cells, and `HorizontalScrollBar` is a child renderable that draws the thumb and handles its clicks and drags, with the same sizes as `ScrollBarRenderable`.
- Removed the unused `Divider` and `Spacer` components, and `expandHome` is no longer exported.

## 0.1.0

### Added

- Postgres connections from `[[connections]]` entries in `~/.config/mensa/config.toml`, each with a `url` or `host`, `port`, `user`, `password`, `database` and `ssl`. A `url` keeps its own port unless `port` is set. Invalid entries, including a port above 65535, connections with a name that is already taken, and an invalid `row_limit` or `double_click_timeout`, are logged and the defaults are used.
- A start screen listing the connections. `Return`, `L` or a double click connects, and a failed connection is reported in the footer.
- A database screen with the tables and views in the `public` schema in a sidebar, and the first `row_limit` rows (1000 by default) of a table in a grid. The footer adds `(first 1000)` only when the table has more rows. A failure to list the tables is reported in the footer.
- Open tables as tabs. `[` and `]` or a click switches tabs, and `X`, the tab's close button or a middle click closes them. The wheel or the `‹` and `›` arrows scroll the tabs when they don't all fit. Switching to a tab that failed to load loads it again. Each tab keeps its scroll position.
- A grid that scrolls rows with the wheel, `PageUp`, `PageDown`, `Home` and `End`, and columns with shift and the wheel, a horizontal wheel, `H`, `L` and the arrow keys. `NULL` is shown in muted italics, and other values as Postgres formats them as text. Newlines, tabs and other control characters in values, table and column names, connection names and error messages are shown as symbols, so they can't send escape sequences to the terminal.
- Clicking a column header sorts the table by that column. Each click moves it from no sort to ascending, then descending, then back to no sort. The sorted column shows a chevron for its direction, muted until the sorted rows arrive. The tab then starts at the top, also if another tab was shown in the meantime. A table has one sort, so sorting a new column replaces the old one. The sort lasts until the tab closes. A column that can't be sorted is reported in the footer and the rows stay as they were.
- `C` or the sidebar's close button closes the connection and returns to the start screen. `Q` quits, also while a connection is still being made. Closing and quitting ask for confirmation first: `Return` confirms and `Escape` cancels.
- Each connection's open tabs and active tab are saved, and reopened when it connects. Tables that no longer exist are skipped. Only the active tab loads straight away, and the others load when they are first shown.
- The last connection is reopened on start. `C` forgets it, and `Q` keeps it. If it fails, the start screen shows the error with that connection selected.

### Internal

- Project scaffold based on filet: renderer, theme and logging config, keyboard shortcut table and base components.
- `lib/database.ts` holds the single `Bun.SQL` client. Table names are quoted by hand, since `sql()` splits identifiers on dots, and rows are read with `.values()`, taking column names from `information_schema.columns`. `lib/session.ts` connects and disconnects, and sets the store.
- A table's columns are read first, then its rows with every column cast to `::text`. Each load keeps the client it started with and drops its result if the connection was closed or replaced, or the tab was closed, in the meantime. It fetches `row_limit + 1` rows to know whether the table has more.
- Sorting reloads the tab with `ORDER BY`, so Postgres sorts the whole table before the row limit. The column is qualified with the table, since a bare name would mean the `::text` output column and sort numbers and dates as text. A re-sort reuses the loaded columns, so it costs one query. `$sorts` holds the sort each tab asked for, and the loaded data holds the sort its rows have. The chevron is muted while the two differ. A re-sort keeps the old rows on screen until the new ones arrive, and drops a result once a newer sort has been asked for. A failed sort goes back to the rows' sort and sets a notice, which the next load of that table clears. Closing the connection forgets it. Every header keeps room for the chevron, so the chevron never shifts a header. A table with more rows than `row_limit` can still change its column widths when sorted, since the widths fit the rows shown.
- `List` is a generic virtual list built on filet's `DirentList`, used for both connections and tables. `DataGrid` renders only the visible rows and columns, and measures and fits a table's cells once per load.
- `DataGrid` draws the rule under the tabs, so the column separators join it with `┬`, and a rule with `┴` under the last row when the rows don't fill the view. It draws its horizontal scrollbar itself, as lower half blocks (`▄`), so it looks as thin as the vertical one, on the bottom row and only when the columns overflow. Clicking the track centres the thumb on the click, and the thumb can be dragged.
- `TableTabs` draws its own tabs, since `TabSelectRenderable` can't hold buttons or take mouse input.
- A connection `url` the URL parser rejects is shown without its password.
- `Confirmation` is filet's dialog, with a `confirmLabel`.
- `NoticeText` is the footer line shared by both screens.
- Shortcuts are scoped to a screen, so the same key can do different things on each screen.
- `Q` closes the client without resetting the UI, and waits at most `QUIT_TIMEOUT` (500 ms) for it to close before exiting. Bun's SQL `close()` waits for a pending connect to time out, and the pool could keep the process alive.
- `state.json` writes are debounced and chained, so they land in order, and `Q` flushes any pending write. Saved tabs of connections no longer in the config are dropped on load.
