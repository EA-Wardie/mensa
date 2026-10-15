import * as nanostores from "nanostores";

export const $menuOpen = nanostores.atom<boolean>(false);

export const $dialogOpen = nanostores.atom<boolean>(false);

export const $notice = nanostores.atom<string>("");
