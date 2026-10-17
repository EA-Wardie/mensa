# mensa

Terminal database client for Postgres and MySQL, built with `@opentui/core` and `nanostores` on Bun. Linux and macOS. The README documents every feature, key and config option.

## Commands

- `bun run dev` runs the app with watch mode.
- `bun run build` compiles a binary per target in `TARGETS` to `dist/mensa-<os>-<arch>` and copies `install.sh` and the icon beside them. It needs `bun install --os="*" --cpu="*"`, so OpenTUI's native package for each target is installed. `install.sh` picks the binary from `uname`.
- `bun run format` runs Biome. Run `bunx tsc --noEmit` and `bunx biome check src/` before finishing a change. There are no tests.

## Architecture

- `src/main.ts` creates the renderer via `makeApp` and registers the keyboard shortcuts. It subscribes to `$screen` and swaps the root `App`'s child between `ConnectionsScreen` and `DatabaseScreen`, destroying the old one, so each screen starts fresh.
- `DatabaseScreen` lays out `TableSidebar | TableTabs, DataGrid, DatabaseFooter`.
- `lib/context.ts` exports the renderer as `ctx`, which every component imports.
- `lib/store.ts` holds all shared state as nanostores atoms: `$screen`, `$connections`, `$selectedConnection`, `$connecting`, `$connection`, `$schema`, `$tables`, `$selectedTable`, `$openTables` (tab order), `$activeTable`, `$tableData` (a `TableData` union of loading, loaded and error per open table), `$sorts` (the sort each open table asked for, while the loaded `TableData` has the sort its rows have), `$selectedRows` (each open table's selected row as an index into its loaded rows, cleared when new rows load), the computed `$activeTableData`, `$dialogOpen` and `$notice` for footer messages. `setEntry` replaces or removes one entry of a record atom. `$connecting` holds the connection being made. Components subscribe to atoms directly and pass the unbinds to `unbindOnDestroy()` from `lib/lifetime.ts`, since screens are destroyed.
- `lib/database.ts` is the only module that touches the `Bun.SQL` client: `openClient`, `loadTable`, `forgetTable` and `closeClient`. Values are always parameters. A connection's `driver` is also its Bun adapter, and picks a `Dialect` with the identifier quote, the text cast for each column's data type and the schema whose tables are listed (`public`, or MySQL's `DATABASE()`). Loaded `TableData` keeps the column types. Names are quoted with the dialect's `quote` and passed through `sql.unsafe`, because `sql()` splits identifiers on dots.
- `lib/session.ts` has `connect` and `disconnect`, which open or close the client and set the store, the remembered connection and the tabs. They clear `$notice`, and changing screens doesn't. `Q` only calls `closeClient` and `flushState`, so it keeps the remembered connection and doesn't rebuild the start screen.
- `lib/tabs.ts` has `openTable`, `closeTable`, `cycleTable`, `sortTable`, `selectRow`, `restoreTabs` and `resetTabs`. `sortTable` cycles a column through asc, desc and none, and reloads the table with `ORDER BY`. Each saves the tabs itself, and a tab loads the first time it becomes active. Activating a tab also sets `$selectedTable`, so the sidebar follows the tabs.
- Components are classes with a static `make()` returning an OpenTUI renderable, built imperatively. `List<T>` and `DataGrid` instead extend `core.Renderable` and draw only the visible rows in `renderSelf`, so large tables stay fast. `List` takes its items and selection as atoms. `loadTable` casts every column to text, so values arrive as the database formats them. `lib/grid.ts` measures and fits a table's cells once per load, caching by the rows array. `DataGrid` draws them, scrolls columns with a `HorizontalScrollBar` child that draws a half block thumb, and exposes scroll methods through `DataGrid.current` for the shortcuts.
- `Confirmation.make()` opens a modal dialog on `ctx.root` and sets `$dialogOpen`, which pauses the global shortcuts until it closes. `Return` confirms and `Escape` cancels. `C` and `Q` use it.
- `TableTabs` holds a `TabBar` renderable that draws fixed width tabs with a close icon, scrolls the fewest tabs needed to keep the active one in view, and maps clicks to tabs with `hitAt()`. The rule under the tabs is drawn by `DataGrid`, so it can join the column separators.
- `lib/shortcuts.ts` has one `SHORTCUTS` table of keys, aliases, the `screen` they apply to and actions. A shortcut without a `screen` applies to every screen. Buttons call `SHORTCUTS.x.run()` and `shortcutLabel()`, so new actions belong in this table. Shortcuts are ignored while a dialog is open or an input is focused.
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
- This includes `/code-review` and `/simplify`. Tell any subagents they start to load these skills too.
