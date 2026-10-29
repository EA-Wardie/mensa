# Changelog

## 0.2.9

### Added

- A `scrollbar` theme colour for the grid's scrollbar thumbs, which defaults to `accent`, so they stand out from the borders they run along.
- Refresh in a table's menu in the sidebar opens the table, or loads its rows again if it's open, asking first when the edited row has unsaved changes.

### Changed

- The sidebar header's refresh and close buttons are replaced by a menu button, which opens the database name's menu. The menu now also has Refresh (`Ctrl+R`) and Close (`C`). Right clicking the name still opens it.
- The grid is always closed off by a bottom border, which is also the footer's top border, joined to the columns. The horizontal scrollbar runs along it as a heavier line, and the vertical one along the right border, so neither takes a row or column of its own.
- Scrolled all the way right, the last column's separator is the right border, with no blank column after it.
- Tabs scroll by cells, so scrolled to the end the last tab meets the `+` with no gap, and the first one shown may be cut at the left. The wheel and the arrows step a tab at a time. Clicking the active tab while it's cut brings it into view.

### Fixed

- In a full grid, the column separators ended without a border above the footer or the horizontal scrollbar.

### Internal

- `HorizontalScrollBar` is now `RuleScrollBar`, for either orientation. It draws only its thumb, as `━` or `┃`, in a post-process pass after the frame, so it stays one solid line over the joins and the footer's divider, and `GridView` uses it for both scrollbars. The vertical one sits on the parent's right border, at `right: -1`.
- `GridView` draws the footer's top border as its last row, and `┤` where its rules meet the right border. The footer has only a bottom border, and a query's error keeps a bottom border in place of the grid.
- `refreshTable` in `lib/tabs.ts` shows a table and reloads it if it was open.

## 0.2.8

### Added

- `Mensa.app` for macOS, installed to `~/Applications` so Spotlight finds it. Opening it runs mensa in Terminal, or the terminal set by the new `terminal` config option (iTerm, Ghostty, kitty, WezTerm or Alacritty). `~/.local/bin/mensa` links to its binary.
- `bun run install:linux` and `bun run install:macos`, replacing `install:app`.

### Changed

- Releases are Linux on x86_64, as a `tar.xz`, and macOS on Apple silicon, as a `zip` holding `Mensa.app`. Each has its own `install.sh`. The build compiles only these two binaries.
- The macOS install removes the quarantine attribute, signs the binary ad hoc, and keeps the old app if the new one can't be moved into place.
- The README is shorter.

### Internal

- The install scripts are `scripts/linstall.sh` and `scripts/minstall.sh`, archived as `install.sh`. `scripts/launcher.sh` is the app's executable, and opens the `Mensa` binary beside it in a terminal.
- `src/build.ts` builds `dist/Mensa.app` with `Info.plist` from `assets/Info.plist`, filled with the version and a build number of major × 100 + minor × 10 + patch. `src/archive.ts` stages each release so its script can be renamed, and needs `zip`.

## 0.2.7

### Added

- A refresh button in the sidebar header, or `Ctrl+R`, lists the tables again, which closes the tabs of tables that are gone. A divider splits it and the close button from the database name.
- A refresh button at the left of the footer, or `R`, loads the active table again, or runs the active query again. It asks first when the edited row has unsaved changes. A divider splits it from the footer text.
- Truncate and close buttons in the footer, after refresh, act on the active tab. Truncate asks first. The buttons are shown only while a tab is open, and truncate only for a table tab.
- Copy as CSV and Copy as JSON in a row's menu. CSV has the column names and the row. JSON is one object keyed by column name, with numbers (keeping the database's digits), booleans and JSON values typed, and NULL as `null`.
- A `*` after a table's column name marks it `NOT NULL`. Query results have no marks.

### Changed

- The sidebar is wider, 42 columns instead of 34.
- Truncate all and drop all ask once, like the other writes, and `Return` confirms them.
- A tab is as wide as its name, at least 16 columns, so long table names aren't cut.

### Fixed

- Errors in the footer stayed until the connection closed. They now clear on the next action, such as switching tabs, sorting, refreshing, running a query, saving a row or confirming a write.
- On narrow screens the tabs left a gap before the edge of the bar. Tabs that don't all fit now reach the `+` at the edge, with the last one cut there.

### Internal

- `refreshTables` resolves to its error, or null, and `refreshSchema` in `lib/actions.ts` shows it. `refreshActiveTab` in `lib/tabs.ts` reloads the active table or runs the active query.
- A `joined` vertical `Divider` meets its parent's top and bottom borders with tees.
- `lib/clipboard.ts` copies through OpenTUI's clipboard service, the host's clipboard or else OSC 52, and is disposed on quit. `lib/export.ts` formats a row as CSV or JSON.
- `Confirmation` no longer has a `deliberate` option, and `confirmWrite` no longer takes a `warning`.
- `clearNotice` in `lib/store.ts` clears `$notice`, and each action calls it as it starts. A failed sort's notice is no longer tracked separately, since the next action clears it. `errorMessage` and `isJson` moved to `lib/format.ts`, and the box drawing tees to `lib/consts.ts`.
- `TabBar` sizes each tab from its label, clips the tabs at the `+` with a scissor rect, and scrolls to the earliest first tab from which the rest fit.

## 0.2.6

### Added

- Query tabs. The `+` after the last tab, `N` or New query in the database name's menu opens one, named `Query 1`, `Query 2` and so on. It has a SQL editor in the top 40% and the results below, in the same grid as table tabs, with each column's type icon. `Ctrl+Return`, `Alt+Return` in the editor or the Run button runs the SQL, and `Escape` leaves the editor, so the other keys work again. `Ctrl+Return` runs it from outside the editor too. `E` goes back into it. A new query tab starts in the editor.
- A run can hold several statements separated by `;`. The grid shows the last statement that returned columns, with values as the database formats them as text, an empty result with its column names, and duplicate column names, such as `a.id, b.id`, as separate columns. MySQL bit and spatial values, and binary values that aren't text, are shown as hex. The first `row_limit` rows are shown, and the footer gives the total, the column count and how long the run took. A statement that returns no rows shows its kind, such as `INSERT`, and the rows it wrote. MySQL doesn't name its statements, so it shows `Done`, with the rows only when there are some.
- A failed run shows the database's error in place of the rows. On Postgres it gives the line and column, and moves the cursor there. Editing the SQL mutes the error and marks it as from the last run.
- Query tabs share one connection of their own, so a transaction or a `SET` lasts from one run to the next and table tabs don't see it until it commits. Closing the connection rolls back a transaction left open.
- After a run with a statement that returned no rows, such as `CREATE TABLE`, the sidebar lists the tables again, which closes the tabs of dropped tables, and after a statement that may have written the open tables load again when shown.
- Each connection remembers its query tabs and their SQL in `state.json`, along with its table tabs. Closing a query tab with SQL in it asks first.

### Changed

- The tab bar is always shown once connected, so the `+` is there with no tabs open.
- `[`, `]`, `X` and the tab menu's Close all cover query tabs too, and the scroll keys scroll a query's results.
- Building needs Bun 1.4.4 or later, which reports the columns of a result read as raw text.

### Internal

- `$tabs` holds the open tabs as `{ kind: "table" }` or `{ kind: "query" }` objects, compared by reference, and `$activeTab` the shown one. `$openTables` and `$activeTable` are now computed from them, so what only cares about tables reads them unchanged. `$querySql` holds each query tab's SQL, which nothing subscribes to, so typing redraws nothing, and `$queryResults` its last result. `state.json` saves the tabs in order with the active one's index, and still reads the old table names.
- `runQuery` in `lib/database.ts` runs the SQL on the client's `queries` pool of one connection with `.simple().raw()` and names the columns from Bun's `columns`. Postgres reads the kind of each result type from `pg_type`, the way `describe` does, once per type on each connection, so a domain shows its base type's icon, and MySQL maps the protocol's type codes. A run's token drops its result once a newer run, closing the tab or closing the connection replaces it, like a table load's. Errors from the user's SQL aren't logged. It resolves to a `RunOutcome`. Since Postgres tags `CREATE TABLE AS` as `SELECT`, a run with a statement that returned no rows lists the tables, and an unchanged list leaves `$tables` as it is.
- `QueryView.host()` also shows or hides the table `DataGrid` and sets `GridView.current`, and holds the one key listener for the shown query. Closing tabs, with its prompts, is in `lib/actions.ts`.
- `GridView` holds what `DataGrid` drew and scrolled, with hooks for the message, the selection, the header's marker and clicks. `DataGrid` keeps the table's sort, selection, editing and menu, and `ResultGrid` shows a query's rows. `GridView.current` is the shown grid, which the shortcuts scroll. `lib/grid.ts` makes a grid from any `GridSource`, with `meta` null for a query's rows.
- `QueryView.host()` keeps a view per open query tab, so each keeps its cursor, undo history and scroll, and shows the active one.

## 0.2.5

### Added

- Icons in the grid's column headers. Primary key columns have a yellow key and foreign key columns a white one, in the text colour, and a column in both shows the primary key's. The yellow is the new `warning` theme colour, a darker yellow by default on a light background. Other columns have a muted icon for their type, such as text, integer, decimal, boolean, date, time, timestamp, JSON, UUID or enum. A Postgres domain shows its base type's icon.

### Changed

- The tab bar's menu opens only when right clicking a tab, not the empty bar beside the tabs or its scroll arrows.
- A table's columns and keys are read again on every load, including sorts and reloads, so changes made in another tool show without reopening the tab.

## 0.2.4

### Added

- Context menus, opened by right clicking. Clicking outside a menu or `Escape` closes it, and the shortcuts pause while one is open.
- A row's menu has Edit, which opens it in the editor, and Delete, which deletes it after confirming. The row is matched by its primary key, so rows of views and of tables without one can't be deleted.
- The tab bar's menu has Close and Close all. Right clicking a tab switches to it first.
- A sidebar table's menu has Truncate, which deletes all its rows, and Delete, which drops the table or view, each after confirming. A table that others reference fails with the database's error rather than emptying or changing them. Truncating restarts a Postgres table's identity columns, as MySQL does.
- The database name's menu has Switch, which lists the other connections to switch to, and Truncate all and Drop all, which empty every table or drop every table and view in the schema. Each asks twice, and the second confirmation needs a click on its button rather than `Return`, which it ignores at first so a double click can't confirm it. References between the schema's tables don't stop them: Postgres truncates or drops them all in one statement, in one transaction, and MySQL turns off foreign key checks on one connection. A table or view outside the schema that depends on one inside it stops them on Postgres instead, so nothing outside the schema changes.

### Changed

- The sidebar shows "No tables" once the last one is dropped.
- `bun run archive` packs the Apple silicon macOS binary, `dist/mensa-darwin-arm64`, into `dist/Release-darwin-arm64 <version>.tar.xz`, instead of the Intel one.

## 0.2.3

### Added

- `bun run archive` packs the built macOS and Linux x64 binaries, each with the install script and the icon, into `dist/Release-darwin-x64 <version>.tar.xz` and `dist/Release-linux-x64 <version>.tar.xz`, with the version from `package.json`. It stops with a message when `bun run build` hasn't made the files yet.
- A row editor. Double clicking a cell, or `E` on the selected row, opens the row in a sidebar beside the grid, with the clicked column's field focused and scrolled into view. Each column gets a field by its type: an input, a textarea for long or multi-line text, a list for booleans and enums (MySQL's `tinyint(1)` shows `1 true` and `0 false`), and a textarea with JSON pretty printed. JSON must parse before it saves, and only reindenting it isn't a change. A nullable column has a `NULL` toggle, also `Ctrl+N`, so an empty text and the text `NULL` stay strings. `Tab` and `Shift+Tab` move between fields, `Ctrl+S` or Save saves, and `Escape`, Cancel or the close button close it, asking first when there are unsaved changes. Save writes only the changed columns, matched by the primary key, and puts the row the database stored in the grid, keeping the scroll and the selection. A database error, such as a value too long for its column, shows in the sidebar and keeps the edits.
- Rows of views, of tables without a primary key and of tables whose key can't be matched (a MySQL binary key) open read only, with a note saying why. Generated and identity always columns are read only, as are MySQL binary, bit and spatial values, and values with control characters other than tabs and newlines.

### Changed

- While the editor is open, its keys are its own, so the other shortcuts, including `Q` and `C`, wait until it closes. Clicking a row doesn't change the selection, which stays on the edited row.
- Sorting, switching to another tab, closing the edited tab and opening another table from the sidebar ask before discarding unsaved changes to the row.
- A focused textarea pauses the shortcuts too, not only an input.

### Fixed

- The selected and hovered rows fill the grid's full width while the rows fit and the vertical scrollbar is hidden, instead of stopping one column short of the right edge.

### Internal

- Each `Dialect` has `describe`, which reads what the editor needs from the catalog: the type to show and the type to cast to, nullability, enum labels, generated columns, the primary key in key order and why a table can't be saved. Postgres reads `pg_catalog`, and MySQL `information_schema`, taking the key from the `PRIMARY` index, since `column_key` says `PRI` for a unique key too. It runs alongside the column list on a table's first load, and its result is kept in the loaded `TableData` as `meta`. When it fails, `meta` has no columns and says why the rows are read only.
- `updateRow` builds one `UPDATE` of the changed columns with every value as a parameter. On Postgres each is cast from text to the column's type without its length, since a cast to `varchar(5)` would cut a longer value instead of failing, and the row comes back with `RETURNING`. `char(n)` and `bit(n)` are cast to `bpchar` and `varbit`, since `character` and `bit` without a length mean a length of 1. MySQL selects the row again by its new key, since its affected row count leaves out rows that matched without changing. The row is put into a new rows array, so the grid remeasures it.
- `$editor` holds the edited table, its rows array, the row and the column to focus, and `$editorDirty` whether it has unsaved changes. The editor stays open only while its table is active with the same rows array, so a reload, a sort, a saved row, closing the tab or the connection all close it. `lib/editor.ts` closes it through its own store listeners, and has `confirmDiscard`, which closes the editor before an action that leaves its row, asking first when it has changes. It closes a clean editor too, since a sort keeps the old rows on screen while it loads. The editor tracks which fields changed as each one does, so a keystroke only checks its own field.
- `Confirmation` takes the focus while it's open and gives it back when it closes, instead of the shortcuts blurring it.
- `DoubleClick` in `lib/clicks.ts` tells double clicks for both `List` and `DataGrid`, and `moveSelection` moved to `lib/store.ts`, so choice fields use it too.
- `reformatJson` in `lib/format.ts` reindents JSON without parsing it, so large numbers and `1.0` keep their digits. It copies strings and literals whole, and a field compacts its original once, since it runs on every keystroke.

## 0.2.2

### Changed

- The database screen's sidebar starts with a `📒 Mensa` header above the connection's name. The start screen's title uses the same `📒` icon instead of the database icon.
- Switching tabs selects the tab's table in the sidebar, scrolling it into view. This also happens when closing a tab switches to another, and when saved tabs reopen. Closing the last tab keeps the sidebar's selection.

### Fixed

- A table with no rows ends its column separators with `┴` on the rule under the column names, instead of crossing it with `┼`.

## 0.2.1

### Added

- macOS and arm64 builds. `bun run build` compiles `dist/mensa-linux-x64`, `mensa-linux-arm64`, `mensa-darwin-x64` and `mensa-darwin-arm64`, and needs `bun install --os="*" --cpu="*"` first, so OpenTUI's native library is there for each platform. The install script picks the binary for the system it runs on. On macOS it removes the quarantine attribute and skips the desktop entry and icon.

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
