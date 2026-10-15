<p align="center">
  <img src="assets/icon.png" alt="mensa icon" width="128">
</p>

# mensa

Terminal app with first party mouse support. Built with OpenTUI on Bun.

## Disclaimers

- LLMs were used during development for research, prototyping, refactoring, and some code generation.
- This is beta software and bugs should be expected. Use at your own risk.
- A Nerd Font is required for icon support.

## Features

- `Q` quits.
- A themeable UI, configurable through a user config file.
- First party mouse support.

## Installation

Requires x86_64 Linux and [Bun](https://bun.com).

```bash
bun install
bun run build
bun run install:app
```

This installs the binary to `~/.local/bin/mensa` and a desktop entry to `~/.local/share/applications`.

## Development

```bash
bun run dev
```

## Configuration

mensa reads `~/.config/mensa/config.toml`. Every option is optional.

```toml
# Where error logs are written, one JSONL file per day.
logs_path = "~/.local/state/mensa/logs"

[theme]
bg = "#0C0C0C"      # or "transparent"
fg = "#fafafa"
border = "#d4d4d4"
success = "#16a34a"
danger = "#dc2626"
accent = "#0369a1"
# surface defaults to an opaque bg
```

## License

[MIT](LICENSE.md)
