/**
 * Commander adapter for the `dsh` command line.
 *
 * The launcher parses only what it owns — which profile to boot, which extra
 * patch overlays to apply, and the config dumps — and hands **everything after
 * its own flags** to the booted tree verbatim, where injected app plugins parse
 * their own flag families and print their own `--help` (see
 * `@deepseek-ai/dsh-cmdline`). Launcher flags therefore come first: the first
 * token this parser does not recognize starts the inner arguments, so
 * `dsh tui --demo` starts the built-in loopback TUI, and `dsh --profile web -h`
 * prints the web app's help, not this launcher's.
 *
 * `web` is a hardcoded alias for `--profile web`; `tui` starts the built-in
 * renderer-neutral terminal shell; `plugin` manages a profile's plugin
 * dependencies by forwarding to pnpm. The installed `omdsh` executable is a
 * shorthand for `dsh tui`.
 * @module @deepseek-ai/dsh/args
 */

import { Command, CommanderError } from 'commander'

/** Boot a named profile and hand it the invocation's inner arguments. */
interface ProfileInvocation {
  mode: 'profile'
  profile: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
  /** Everything after the launcher's own flags, verbatim, for injected app plugins. */
  args: string[]
}

/** Start the built-in TUI shell without requiring a checked-in profile tree. */
interface TuiInvocation {
  mode: 'tui'
  profile: 'tui'
  /** Extra overlays reserved for a future service-backed profile adapter. */
  patches: string[]
  /** TUI-owned flags and command arguments. */
  args: string[]
}

/** Print a composed profile tree and exit without booting. */
interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  defaultOnly: boolean
  patches: string[]
}

/** Manage a profile's plugins: forward `args` to pnpm inside the profile directory. */
interface PluginInvocation {
  mode: 'plugin'
  profile: string
  /** Raw pnpm arguments, verbatim. */
  args: string[]
}

/** Author, inspect, or pack one plugin package manifest. */
interface PluginManifestInvocation {
  mode: 'plugin-manifest'
  /** The manifest lifecycle operation. */
  command: 'init' | 'validate' | 'pack'
  /** Plugin package directory, as supplied by the developer. */
  path: string
  /** Destination directory for a packed tarball. */
  outDir?: string
  /** The requested renderer for the shared command projection. */
  output: 'summary' | 'agent' | 'json'
}

/** Project one agent preset's composition: `dsh composition preview|smoke`. */
interface CompositionInvocation {
  mode: 'composition'
  /** Which projection command ran. */
  command: 'preview' | 'smoke'
  /** The profile whose roster to project; `web` is the in-box profile composing one. */
  profile: string
  /** The preset to project, or the roster's default when omitted. */
  preset?: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
  /** Print the machine envelope instead of a human summary. */
  json: boolean
}

/** The resolved `dsh` invocation. Help, version, and errors exit inside {@link parseDshArgs}. */
export type DshInvocation = ProfileInvocation | TuiInvocation | DumpConfigInvocation | PluginInvocation | PluginManifestInvocation | CompositionInvocation

/** Launcher flags shared by the default command and the `web` alias. */
interface BootOptions {
  patch?: string[]
  dumpConfig?: boolean
  dumpDefaultConfig?: boolean
}

/**
 * Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
 * variadic — a variadic `--patch` would swallow the inner arguments.
 */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/** The launcher's own help text; each app prints its own. */
const HELP_EXAMPLES = `
Examples:
  dsh --profile web                          boot the web profile (same as: dsh web)
  dsh --profile headless "run the tests"     answer one task, print the result, and exit
  dsh --profile tui --demo                   start the built-in local loopback TUI
  dsh tui --once "hello"                     print one deterministic TUI frame
  dsh tui --demo                             start the local loopback TUI service
  omdsh --once "hello"                       one-shot TUI interaction (the oh-my-dsh shorthand)
  dsh --profile web --help                   the web app's own flags and help
  dsh plugin --profile tui add <package>     install a plugin into the tui profile
`

/**
 * Resolve a boot or dump invocation from the launcher flags and the leftover
 * inner arguments.
 * @param program - the command whose options were parsed (the root, or the `web` alias).
 * @param profile - the profile these flags boot.
 * @param options - the launcher flags commander collected.
 * @param args - the leftover arguments, in argv order.
 * @returns the resolved invocation.
 */
function resolveBoot(program: Command, profile: string, options: BootOptions, args: string[]): DshInvocation {
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  if (options.dumpConfig !== true && options.dumpDefaultConfig !== true) {
    if (profile === 'tui') return { mode: 'tui', profile: 'tui', patches, args }
    return { mode: 'profile', profile, patches, args }
  }
  if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
    program.error('error: --dump-config and --dump-default-config are mutually exclusive')
  }
  // The dump is boot-free: it never runs app command-line providers, so it
  // cannot show what those flags would decide, and printing a tree that differs
  // from the same invocation's boot would mislead.
  if (args.length > 0) {
    program.error(`error: config dumps take no app arguments, got ${args.map(argument => JSON.stringify(argument)).join(' ')}`)
  }
  const defaultOnly = options.dumpDefaultConfig === true
  if (defaultOnly && patches.length > 0) {
    program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
  }
  return { mode: 'dump-config', profile, defaultOnly, patches }
}

/**
 * Resolve argv into one invocation, or print and exit for help, version, or an
 * error.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `--version`.
 * @returns the resolved invocation.
 */
export function parseDshArgs(argv: readonly string[], version: string): DshInvocation {
  let resolved: DshInvocation | undefined
  // Annotated, not inferred: the actions below call back into `program`, and an
  // inferred type would be circular through its own chain.
  const program: Command = new Command()
  program
    .name('dsh')
    .version(version, '-V, --version', 'output the version number')
    .description('dsh: boot a DeepSeek Harness profile — an ordered stack of plugin-bundle patch layers under your own overrides.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    // The launcher's flags come first and end at the first token it does not
    // know; everything from there on belongs to the booted app, including
    // its -h. `dsh -h` with no profile still prints this help, below.
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the booted profile\'s app (see: dsh --profile <name> --help)')
    .option('--profile <name>', 'the profile under $DSH_HOME/profiles to boot')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .action((args: string[], options: BootOptions & { profile?: string }) => {
      // With the app owning -h, the launcher's own help is what a bare
      // `dsh -h` (no profile to hand it to) must print.
      if (options.profile === undefined) {
        if (args.some(argument => argument === '-h' || argument === '--help')) program.help()
        program.error('error: --profile <name> is required')
      }
      const profile = options.profile
      if (profile === '') program.error('error: --profile needs a name')
      resolved = resolveBoot(program, profile, options, args)
    })

  /** Reject parent options supplied before a subcommand. */
  const rejectParentOptions = (command: string): void => {
    const parent = program.opts<BootOptions & { profile?: string }>()
    if (parent.profile !== undefined || parent.patch !== undefined
      || parent.dumpConfig !== undefined || parent.dumpDefaultConfig !== undefined) {
      program.error(`error: ${command} takes none of parent --profile, --patch, --dump-config, or --dump-default-config`)
    }
  }

  const web = program.command('web').description('boot the web profile (alias of --profile web); the web app\'s own flags follow')
  web
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the web app (see: dsh web --help)')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed web-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the web profile\'s bundle layers (no user layer) and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('web')
      resolved = resolveBoot(web, 'web', options, args)
    })

  const tui = program.command('tui')
    .description('start the renderer-neutral terminal UI; TUI flags follow (try: dsh tui --demo)')
  tui
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the TUI shell (see: dsh tui --help)')
    .option('--patch <path>', 'reserve an extra patch-list overlay for a service-backed TUI (repeatable)', collect)
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('tui')
      resolved = resolveBoot(tui, 'tui', options, args)
    })

  const plugin = program.command('plugin').description('manage a profile\'s plugins, or author and validate plugin package manifests')
  plugin
    .option('--profile <name>', 'the profile whose plugins to manage (initialized on first use)')
    .allowUnknownOption()
    .argument('[args...]', 'pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)')
    .action((args: string[], options: { profile?: string }) => {
      rejectParentOptions('plugin')
      if (options.profile === undefined || options.profile === '') program.error('error: --profile needs a name')
      if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')
      resolved = { mode: 'plugin', profile: options.profile, args }
    })

  interface PluginManifestOptions {
    path?: string
    outDir?: string
    agent?: boolean
    json?: boolean
  }

  /** Register one manifest operation over the common output mode flags. */
  const manifestSub = (parent: Command, command: PluginManifestInvocation['command']): void => {
    const manifestCommand = parent.requiredOption('--path <package-dir>', 'the plugin package directory')
    if (command === 'pack') manifestCommand.requiredOption('--out-dir <directory>', 'directory receiving the tarball')
    manifestCommand
      .option('--agent', 'print stable key=value facts for automation')
      .option('--json', 'print one stable JSON envelope')
      .action((options: PluginManifestOptions) => {
        rejectParentOptions(`plugin manifest ${command}`)
        if (options.path === undefined || options.path === '') parent.error('error: --path needs a package directory')
        if (options.agent === true && options.json === true) parent.error('error: --agent and --json are mutually exclusive')
        const outDir = options.outDir
        if (command === 'pack' && (outDir === undefined || outDir === '')) parent.error('error: --out-dir needs a directory')
        resolved = {
          mode: 'plugin-manifest',
          command,
          path: options.path,
          ...command === 'pack' ? { outDir } : {},
          output: options.json === true ? 'json' : options.agent === true ? 'agent' : 'summary',
        }
      })
  }
  const manifest = plugin.command('manifest').description('generate, validate, and pack plugin package metadata')
  manifestSub(manifest.command('init').description('generate dsh.plugin.json from a package manifest'), 'init')
  manifestSub(manifest.command('validate').description('validate dsh.plugin.json and its package files without modifying them'), 'validate')
  const pack = manifest.command('pack').description('validate a plugin package and write a verified tarball')
  manifestSub(pack, 'pack')

  interface CompositionOptions {
    profile?: string
    preset?: string
    patch?: string[]
    json?: boolean
  }

  /** Declare one `dsh composition <command>` subcommand over the shared flag family. */
  const compositionSub = (parent: Command, command: 'preview' | 'smoke', summary: string): void => {
    parent
      .description(summary)
      .option('--profile <name>', 'the profile whose preset roster to project (initialized on first use; must compose one)', 'web')
      .option('--preset <id>', 'the preset to project; the roster\'s default when omitted')
      .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
      .option('--json', 'print the machine envelope (dsh.composition.*.v0) instead of a human summary')
      .action((options: CompositionOptions) => {
        rejectParentOptions(`composition ${command}`)
        const profile = options.profile ?? 'web'
        if (profile === '') program.error('error: --profile needs a name')
        if (options.preset === '') program.error('error: --preset needs an id')
        resolved = {
          mode: 'composition',
          command,
          profile,
          ...options.preset === undefined ? {} : { preset: options.preset },
          patches: options.patch ?? [],
          json: options.json === true,
        }
      })
  }
  const composition = program.command('composition')
    .description('project one agent preset\'s composition facts (tools, prompt sections, units, permissions, health, drift) without starting a session')
  compositionSub(composition.command('preview'), 'preview', 'print one preset\'s dsh.composition.preview.v0 composition facts')
  compositionSub(composition.command('smoke'), 'smoke', 'mount, project, and verify cleanup, printing the redacted dsh.composition.smoke.v0 report')

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  if (resolved === undefined) throw new Error('dsh: no invocation resolved')
  return resolved
}

/**
 * Normalize argv for the installed executable aliases.
 *
 * Keeping this pure makes shell/package-manager alias behavior testable without
 * mutating process.argv or invoking a terminal.
 * @param argv - arguments after the Node binary and executable path.
 * @param executableName - basename of the invoked executable, such as `dsh` or `omdsh`.
 * @returns argv with `tui` inserted for the `omdsh` shorthand.
 */
export function normalizeDshArgv(argv: readonly string[], executableName: string): readonly string[] {
  const isOmdsh = executableName === 'omdsh' || executableName === 'omdsh.js' || executableName === 'omdsh.mjs'
  return isOmdsh ? ['tui', ...argv] : [...argv]
}
