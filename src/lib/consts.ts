import { homedir } from "node:os";

export const HOME_DIRECTORY: string = homedir();

export const USER_CONFIG_PATH: string = `${HOME_DIRECTORY}/.config/mensa/config.toml`;

export const LOGS_PATH: string = `${HOME_DIRECTORY}/.local/state/mensa/logs`;

export const STATE_PATH: string = `${HOME_DIRECTORY}/.local/state/mensa/state.json`;

export const DATABASE_ICON: string = "󰆼";

export const APP_TITLE: string = "📒 Mensa";

// The start screen's title, in the ANSI Shadow figlet font.
export const APP_LOGO: string = [
	"███╗   ███╗███████╗███╗   ██╗███████╗ █████╗ ",
	"████╗ ████║██╔════╝████╗  ██║██╔════╝██╔══██╗",
	"██╔████╔██║█████╗  ██╔██╗ ██║███████╗███████║",
	"██║╚██╔╝██║██╔══╝  ██║╚██╗██║╚════██║██╔══██║",
	"██║ ╚═╝ ██║███████╗██║ ╚████║███████║██║  ██║",
	"╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝",
].join("\n");

// Marks a connection as production or not by its colour.
export const CONNECTION_DOT: string = "●";

// The footer's mark while a production connection is open.
export const PRODUCTION_LABEL: string = "[PROD]";

export const DEFAULT_ROW_LIMIT: number = 1000;

export const DEFAULT_POSTGRES_PORT: number = 5432;

export const DEFAULT_MYSQL_PORT: number = 3306;

export const MAX_PORT: number = 65535;

export const DEFAULT_DOUBLE_CLICK_TIMEOUT: number = 250;

export const CONNECTION_TIMEOUT: number = 10;

export const SIDEBAR_WIDTH: number = 42;

export const CONNECTIONS_WIDTH: number = 72;

// A tab is as wide as its name needs, and at least this wide.
export const TAB_MIN_WIDTH: number = 16;

export const EDITOR_WIDTH: number = 48;

// The query editor's share of a query tab's height, and its fewest rows.
export const QUERY_EDITOR_HEIGHT: `${number}%` = "40%";

export const QUERY_EDITOR_MIN_ROWS: number = 4;

export const MENU_WIDTH: number = 30;

// Longer values are edited in a textarea, which wraps them.
export const INPUT_MAX_LENGTH: number = 200;

export const TEXTAREA_MIN_ROWS: number = 3;

export const TEXTAREA_MAX_ROWS: number = 10;

export const CHOICE_MAX_ROWS: number = 6;

// The row view shows this much of a value, so a huge one doesn't stall it.
export const VIEW_MAX_LENGTH: number = 100_000;

// varchar columns longer than this are edited in a textarea.
export const LONG_TEXT_LENGTH: number = 255;

export const MAX_COLUMN_WIDTH: number = 40;

export const ELLIPSIS: string = "…";

// Box drawing, for lines that join the borders they meet.
export const SEPARATOR: string = "│";

export const TOP_TEE: string = "┬";

export const CROSS: string = "┼";

export const BOTTOM_TEE: string = "┴";

export const RIGHT_TEE: string = "┤";

// How strongly a scrollbar's thumb tints the rule it runs along, while it
// isn't in use and while it is.
export const THUMB_IDLE_ALPHA: number = 0.2;

export const THUMB_ACTIVE_ALPHA: number = 0.5;

// How long a scrollbar's thumb stays in use after a scroll, in milliseconds.
export const THUMB_TIMEOUT: number = 1000;

export const CLOSE_ICON: string = "󰅖";

export const ADD_ICON: string = "󰐕";

export const REFRESH_ICON: string = "󰑐";

export const QUERY_ICON: string = "󰆍";

export const RUN_ICON: string = "󰐊";

export const EDIT_ICON: string = "󰏫";

// Pretty printed JSON's indent, in the editor, the view and copied rows.
export const JSON_INDENT: string = "  ";

export const VIEW_ICON: string = "󰈈";

export const COPY_ICON: string = "󰆏";

export const DELETE_ICON: string = "󰆴";

export const TRUNCATE_ICON: string = "󰃢";

export const SWITCH_ICON: string = "󰓡";

export const MENU_ICON: string = "󰍜";

export const KEY_ICON: string = "󰌋";

export const SAVE_ICON: string = "󰆓";

export const SORT_ASC_ICON: string = "󰅃";

export const SORT_DESC_ICON: string = "󰅀";

export const CANCEL_ICON: string = "";

export const CONFIRM_ICON: string = "";

export const QUIT_TIMEOUT: number = 500;

export const STATE_SAVE_DELAY: number = 250;
