import { homedir } from "node:os";

export const HOME_DIRECTORY: string = homedir();

export const USER_CONFIG_PATH: string = `${HOME_DIRECTORY}/.config/mensa/config.toml`;

export const LOGS_PATH: string = `${HOME_DIRECTORY}/.local/state/mensa/logs`;

export const STATE_PATH: string = `${HOME_DIRECTORY}/.local/state/mensa/state.json`;

export const DATABASE_ICON: string = "󰆼";

export const APP_TITLE: string = "📒 Mensa";

export const DEFAULT_ROW_LIMIT: number = 1000;

export const DEFAULT_POSTGRES_PORT: number = 5432;

export const DEFAULT_MYSQL_PORT: number = 3306;

export const MAX_PORT: number = 65535;

export const DEFAULT_DOUBLE_CLICK_TIMEOUT: number = 250;

export const CONNECTION_TIMEOUT: number = 10;

export const SIDEBAR_WIDTH: number = 34;

export const CONNECTIONS_WIDTH: number = 72;

export const TAB_WIDTH: number = 24;

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

// varchar columns longer than this are edited in a textarea.
export const LONG_TEXT_LENGTH: number = 255;

export const MAX_COLUMN_WIDTH: number = 40;

export const ELLIPSIS: string = "…";

export const CLOSE_ICON: string = "󰅖";

export const ADD_ICON: string = "󰐕";

export const QUERY_ICON: string = "󰆍";

export const RUN_ICON: string = "󰐊";

export const EDIT_ICON: string = "󰏫";

export const DELETE_ICON: string = "󰆴";

export const TRUNCATE_ICON: string = "󰃢";

export const SWITCH_ICON: string = "󰓡";

export const KEY_ICON: string = "󰌋";

export const SAVE_ICON: string = "󰆓";

export const SORT_ASC_ICON: string = "󰅃";

export const SORT_DESC_ICON: string = "󰅀";

export const CANCEL_ICON: string = "";

export const CONFIRM_ICON: string = "";

export const QUIT_TIMEOUT: number = 500;

export const STATE_SAVE_DELAY: number = 250;
