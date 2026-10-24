# mensa

Terminal database client for Postgres and MySQL, built with `@opentui/core` and `nanostores` on Bun. Linux and macOS. The README documents every feature, key and config option.

## Commands

- `bun run dev` runs the app with watch mode.
- `bun run build` compiles a binary per target in `TARGETS` to `dist/mensa-<os>-<arch>` and copies `install.sh` and the icon beside them. It needs `bun install --os="*" --cpu="*"`, so OpenTUI's native package for each target is installed. `install.sh` picks the binary from `uname`.
- `bun run archive` packs the built `darwin-arm64` and `linux-x64` binaries, each with `install.sh` and the icon, into `dist/Release-<platform> <version>.tar.xz`. It needs `bun run build` first.
- `bun run format` runs Biome. Run `bunx tsc --noEmit` and `bunx biome check src/` before finishing a change. There are no tests.

## Architecture

- `src/main.ts` creates the renderer via `makeApp` and registers the keyboard shortcuts. It subscribes to `$screen` and swaps the root `App`'s child between `ConnectionsScreen` and `DatabaseScreen`, destroying the old one, so each screen starts fresh.
- `DatabaseScreen` lays out `TableSidebar | TableTabs, DataGrid, DatabaseFooter | RowEditor`. `RowEditor.host()` is an empty box that builds the editor from `$editor`.
- `lib/context.ts` exports the renderer as `ctx`, which every component imports.
- `lib/store.ts` holds all shared state as nanostores atoms: `$screen`, `$connections`, `$selectedConnection`, `$connecting`, `$connection`, `$schema`, `$tables`, `$selectedTable`, `$openTables` (tab order), `$activeTable`, `$tableData` (a `TableData` union of loading, loaded and error per open table), `$sorts` (the sort each open table asked for, while the loaded `TableData` has the sort its rows have), `$selectedRows` (each open table's selected row as an index into its loaded rows, cleared when new rows load), the computed `$activeTableData`, `$editor` and `$editorDirty` for the row editor, `$dialogOpen` and `$notice` for footer messages. `setEntry` replaces or removes one entry of a record atom, and `moveSelection` steps a selection atom through an items atom. `$connecting` holds the connection being made. Components subscribe to atoms directly and pass the unbinds to `unbindOnDestroy()` from `lib/lifetime.ts`, since screens are destroyed.
- `lib/database.ts` is the only module that touches the `Bun.SQL` client: `openClient`, `loadTable`, `forgetTable` and `closeClient`. Values are always parameters. A connection's `driver` is also its Bun adapter, and picks a `Dialect` with the identifier quote, the text cast for each column's data type and the schema whose tables are listed (`public`, or MySQL's `DATABASE()`). Loaded `TableData` keeps the column types. Names are quoted with the dialect's `quote` and passed through `sql.unsafe`, because `sql()` splits identifiers on dots. The dialect's `describe` reads the table's `TableMeta` on its first load, kept in the loaded `TableData` as `meta`. `updateRow` saves the changed columns, matched by the primary key, with each value placed by the dialect's `param` (a cast from text on Postgres), and puts the stored row into a new rows array. `deleteRow` matches a row the same way, through `matchRow` and `matchKey`, and leaves it out of a new rows array. `truncateTable` and `dropTable` look the relation up first, so a view is dropped with `DROP VIEW`, and don't cascade. `dropTable` and `dropAll` take what they dropped out of `$tables`. `truncateAll` and `dropAll` name every table in one statement where the dialect can (the dialect's `truncate` builds the statements), without `CASCADE`, so nothing outside the schema changes, and go through the dialect's `runAll`: one transaction on Postgres, and a reserved connection with foreign key checks off on MySQL, closed if they can't be turned back on. A failed `dropAll` lists the tables again, since MySQL may have dropped some. Each table's latest load has a token in `loads`, and `loadTable` keeps its result only while its token is current: a newer load replaces it, and `discardRows`, `forgetTable` and `closeClient` remove it.
- `lib/session.ts` has `connect` and `disconnect`, which open or close the client and set the store, the remembered connection and the tabs. They clear `$notice`, and changing screens doesn't. `Q` only calls `closeClient` and `flushState`, so it keeps the remembered connection and doesn't rebuild the start screen.
- `lib/tabs.ts` has `openTable`, `closeTable`, `cycleTable`, `sortTable`, `selectRow`, `restoreTabs` and `resetTabs`. `sortTable` cycles a column through asc, desc and none, and reloads the table with `ORDER BY`. Each saves the tabs itself, and a tab loads the first time it becomes active. Activating a tab also sets `$selectedTable`, so the sidebar follows the tabs.
- Components are classes with a static `make()` returning an OpenTUI renderable, built imperatively. `List<T>` and `DataGrid` instead extend `core.Renderable` and draw only the visible rows in `renderSelf`, so large tables stay fast. `List` takes its items and selection as atoms. `loadTable` casts every column to text, so values arrive as the database formats them. `lib/grid.ts` measures and fits a table's cells once per load, caching by the rows array. `DataGrid` draws them, scrolls columns with a `HorizontalScrollBar` child that draws a half block thumb, and exposes scroll methods through `DataGrid.current` for the shortcuts.
- `lib/actions.ts` has the context menus' destructive actions, `deleteRowAt`, `truncateTableNamed`, `dropTableNamed`, `truncateAllTables`, `dropAllTables` and `switchTo`. Each is a `confirmWrite`: `confirmDiscardIf` when it would replace the edited rows, then a `Confirmation`, and a second, `deliberate` one for the schema wide ones. They show errors in `$notice` and reload tables only while the same connection is open. `tabs.ts` adds `closeAllTables`, `reloadTable` and `reloadOpenTables`, and closes the tabs of tables that leave `$tables` through its own listener, which also moves the sidebar's selection. `session.ts` adds `switchConnection`.
- `lib/editor.ts` has `editRow`, `closeEditor`, `editorData`, `isSameRow`, `confirmDiscard` and `confirmDiscardIf`. The editor stays open only while its table is active with the rows array it was opened on, and the module's own `$tableData` and `$activeTable` listeners close it once anything replaces the rows. Actions that leave the row go through `confirmDiscard`, which closes the editor first, asking when it has unsaved changes. `editRow` does this itself for another row.
- `lib/clicks.ts` has `DoubleClick`, which `List` and `DataGrid` use to tell double clicks by `double_click_timeout`.
- `RowEditor` builds a field per column with `makeField` from `EditorField.ts`, picked from the column's `ColumnEdit`: `TextField` (an input, or a textarea for long, multi-line and json values), `ChoiceField` (a `List` for bools and enums) or `ReadOnlyField`. Its own `ctx.keyInput` listener takes `Escape`, `Tab`, `Ctrl+S` and `Ctrl+N` with `preventDefault`, before the focused field sees them. Blur the focused field before destroying it, since the renderer keeps pointing at a destroyed one. Inputs need a large `maxLength`, since the default of 1000 cuts values. Only the root renderable can listen for layout changes, so scroll after the renderer's `frame` event instead.
- `Confirmation.make()` opens a modal dialog on `ctx.root` and sets `$dialogOpen`, which pauses the global shortcuts until it closes. It takes the focus while it's open and gives it back when it closes. `Return` confirms and `Escape` cancels. `C`, `Q` and the row editor's discard prompt use it. A `deliberate` one ignores `Return`, and clicks for the double click timeout after it opens.
- `Menu.make()` opens a context menu at the mouse from `MenuItem` data, built into `MenuButton`s that act on mouse up, with `"divider"` entries drawn as a `Divider` between groups. It sets `$dialogOpen` like `Confirmation`, takes the focus, and closes on `Escape` or a click outside. Choosing an item closes the menu before the item runs, so it can open a `Confirmation` or another menu. `DataGrid`, `TabBar`, `TableSidebar` and `List` (through `onMenu`) open menus on a right click.
- `TableTabs` holds a `TabBar` renderable that draws fixed width tabs with a close icon, scrolls the fewest tabs needed to keep the active one in view, and maps clicks to tabs with `hitAt()`. The rule under the tabs is drawn by `DataGrid`, so it can join the column separators.
- `lib/shortcuts.ts` has one `SHORTCUTS` table of keys, aliases, the `screen` they apply to and actions. A shortcut without a `screen` applies to every screen. Buttons call `SHORTCUTS.x.run()` and `shortcutLabel()`, so new actions belong in this table. Shortcuts are ignored while a dialog or the row editor is open, or an input or textarea is focused (`ctx.currentFocusedEditor`). The editor's keys live in `RowEditor`, since they apply to it rather than to a screen.
- `lib/config.ts` loads `~/.config/mensa/config.toml` with top level await. It parses `connections`, `row_limit` and `double_click_timeout`, and derives the whole theme from a few base colours.
- `lib/consts.ts` holds paths and fixed values.
- `lib/state.ts` keeps app state in `~/.local/state/mensa/state.json`, loaded with top level await: the last connection's name and each connection's open and active tabs. `connect` saves the name, `disconnect` clears it, and `main.ts` reconnects on start. Saves are debounced by `STATE_SAVE_DELAY`, and `Q` calls `flushState()` before exiting.
- `NoticeText` is the footer line shared by both screens: `$notice` in the danger colour, or else a fallback text.
- Text from the database or the config goes through `displayText()` from `lib/format.ts` before it is drawn, so control characters can't reach the terminal.
- `lib/log.ts` writes errors as JSONL, one file per day, to `~/.local/state/mensa/logs`. Use `logError` and set `$notice` for user facing failures.

## Conventions

- Explicit type annotations on variables, parameters and return types, including callbacks.
- Tabs and double quotes, as enforced by Biome. `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on.
- When behaviour changes, update the README and `CHANGELOG.md`. Version lives in `package.json`.
- Work happens on `dev` and is merged into `main` by PR.

## Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Skills

- When reviewing, simplifying or writing TypeScript in `src/`, load the `typescript-expert` skill, and `typescript-advanced-types` for type-level work.
- When working with `@opentui/core`, such as components in `src/components/`, rendering, layout, input, colours or the renderer in `src/lib/context.ts`, load the `opentui` skill.
- When changing or reviewing the queries or a `Dialect` in `src/lib/database.ts`, load `postgresql-code-review` for Postgres and `mysql` for MySQL.
- This includes `/code-review` and `/simplify`. Before reviewing, load every skill above that matches a file in the diff, such as `opentui` for a component and `postgresql-code-review` and `mysql` for a change to `database.ts`. Name the matching skills in each subagent's prompt, so it loads them before reading the code.
