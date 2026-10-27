#!/bin/bash
# Mensa.app's executable. Spotlight and Finder start it without a terminal, so it
# opens mensa in the terminal named by `terminal` in the config, or Terminal.
set -u

BIN="$(cd "$(dirname "$0")" && pwd -P)/Mensa"
CONFIG="$HOME/.config/mensa/config.toml"
TERMINAL_APP="Terminal"

# Read the top level `terminal` key, in double or single quotes, stopping at the first table.
if [[ -f "$CONFIG" ]]; then
  KEY='^[[:space:]]*terminal[[:space:]]*=[[:space:]]*'
  CONFIGURED="$(sed -n -e '/^[[:space:]]*\[/q' -e "s/${KEY}\"\([^\"]*\)\".*/\1/p" -e "s/${KEY}'\([^']*\)'.*/\1/p" "$CONFIG" | head -n 1)"
  if [[ -n "$CONFIGURED" ]]; then
    TERMINAL_APP="$CONFIGURED"
  fi
fi

open_in() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
    ghostty) open -na "$1" --args -e "$BIN" ;;
    alacritty) open -na "$1" --args -e "$BIN" ;;
    kitty) open -na "$1" --args "$BIN" ;;
    wezterm) open -na "$1" --args start -- "$BIN" ;;
    *) open -a "$1" "$BIN" ;;
  esac
}

open_in "$TERMINAL_APP" 2>/dev/null || open -a Terminal "$BIN"
