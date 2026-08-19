# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the product launcher for profiles: ordered stacks of plugin-bundle patch layers under the user's own overrides. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh web` | Alias of `--profile web`. |
| `dsh tui` | Start the renderer-neutral terminal UI. `dsh --profile tui` resolves to the same built-in shell. |
| `omdsh` | Installed shorthand for `dsh tui`; use `omdsh --demo` for the local loopback service. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |
| `dsh composition preview \| smoke --preset <id> [--json]` | Project one agent preset's composition facts (web profile by default) without starting a session; exit 1 on refusal or, for smoke, detected residue. |

The invoking directory is the default workspace root. The `web` and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../packages/boot/cmdline/README.md)). Launcher flags therefore come first, and the first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh tui --demo --once "hello"       # one local loopback prompt, no credentials or model call
omdsh --demo                         # start the interactive TUI
dsh --profile headless "run the tests"
dsh composition preview --preset standard --json   # one dsh.composition.preview.v0 envelope, no session, no model call
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

## First TUI session

The first CLI slice is intentionally safe to run locally: `--demo` connects the
TUI to an in-process loopback service that echoes prompts. It exercises the
composer, queue/steer mode, interrupt path, event cursor, and cleanup without
reading provider credentials. A real DSH service adapter will replace this
loopback port in the next implementation slice.

```sh
dsh tui --demo
omdsh --demo
omdsh --demo --once "check the TUI wiring"
```

Inside the TUI, `Enter` sends, `Ctrl+C` interrupts or quits when idle, `Ctrl+G`
detaches the view, and colon commands such as `:help`, `:mode steer`, `:clear`,
and `:q` provide quick interaction. When stdout is not a TTY, use `--once` for
a deterministic frame suitable for scripts and smoke tests.

## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer).

The tree composes over an empty root:
- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
