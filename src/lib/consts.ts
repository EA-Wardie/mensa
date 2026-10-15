import { homedir } from "node:os";

export const HOME_DIRECTORY: string = homedir();

export const USER_CONFIG_PATH: string = `${HOME_DIRECTORY}/.config/mensa/config.toml`;

export const LOGS_PATH: string = `${HOME_DIRECTORY}/.local/state/mensa/logs`;
