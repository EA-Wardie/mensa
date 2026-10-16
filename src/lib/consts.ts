import { homedir } from "node:os";

export const HOME_DIRECTORY: string = homedir();

export const USER_CONFIG_PATH: string = `${HOME_DIRECTORY}/.config/mensa/config.toml`;

export const LOGS_PATH: string = `${HOME_DIRECTORY}/.local/state/mensa/logs`;

export const STATE_PATH: string = `${HOME_DIRECTORY}/.local/state/mensa/state.json`;

export const DATABASE_ICON: string = "󰆼";

export const APP_TITLE: string = `${DATABASE_ICON} Mensa`;

export const DEFAULT_ROW_LIMIT: number = 1000;

export const DEFAULT_PORT: number = 5432;

export const MAX_PORT: number = 65535;

export const DEFAULT_DOUBLE_CLICK_TIMEOUT: number = 250;

export const CONNECTION_TIMEOUT: number = 10;

export const SIDEBAR_WIDTH: number = 34;

export const CONNECTIONS_WIDTH: number = 72;

export const TAB_WIDTH: number = 24;

export const MAX_COLUMN_WIDTH: number = 40;

export const ELLIPSIS: string = "…";

export const CLOSE_ICON: string = "󰅖";

export const CANCEL_ICON: string = "";

export const CONFIRM_ICON: string = "";

export const QUIT_TIMEOUT: number = 500;

export const STATE_SAVE_DELAY: number = 250;
