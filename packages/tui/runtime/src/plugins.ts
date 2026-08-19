import type {
  TuiCommandContribution,
  TuiPanelContribution,
  TuiPluginDefinition,
  TuiPluginSnapshot,
} from './types.ts'

/** Registry error raised when trusted plugin capabilities are invalid. */
export class TuiPluginError extends Error {
  /** @param message - the invariant or duplicate registration failure. */
  constructor(message: string) {
    super(message)
    this.name = 'TuiPluginError'
  }
}

/**
 * Process-local registry for renderer-neutral TUI plugin contributions.
 * Registration is explicit and returns a disposer so HMR and shell teardown
 * remove the exact contribution they installed.
 */
export class TuiPluginRegistry {
  private readonly definitions = new Map<string, TuiPluginSnapshot>()

  /**
   * Register one plugin and return a disposer for that exact id.
   * @param definition - trusted plugin metadata and contributions.
   * @returns an idempotent disposer.
   */
  register(definition: TuiPluginDefinition): () => void {
    const snapshot = normalizePlugin(definition)
    if (this.definitions.has(snapshot.id)) throw new TuiPluginError(`TUI plugin already registered: ${snapshot.id}`)
    this.definitions.set(snapshot.id, snapshot)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.definitions.delete(snapshot.id)
    }
  }

  /**
   * Return a stable, sorted snapshot for inclusion in TUI state.
   * @returns immutable plugin capability entries.
   */
  snapshot(): readonly TuiPluginSnapshot[] {
    return [...this.definitions.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(plugin => ({
        ...plugin,
        commands: [...plugin.commands],
        panels: plugin.panels.map(panel => ({ ...panel, rows: [...panel.rows] })),
      }))
  }
}

function normalizePlugin(definition: TuiPluginDefinition): TuiPluginSnapshot {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(definition.id)) {
    throw new TuiPluginError(`TUI plugin id must be lower-kebab or namespaced: ${definition.id}`)
  }
  if (definition.version.trim().length === 0) throw new TuiPluginError(`TUI plugin version is empty: ${definition.id}`)
  const commands = normalizeCommands(definition.id, definition.commands ?? [])
  const panels = normalizePanels(definition.id, definition.panels ?? [])
  return { id: definition.id, version: definition.version, commands, panels }
}

function normalizeCommands(pluginId: string, commands: readonly TuiCommandContribution[]): readonly TuiCommandContribution[] {
  const seen = new Set<string>()
  return commands.map(command => {
    if (!command.id.startsWith(`${pluginId}.`)) {
      throw new TuiPluginError(`TUI command must be namespaced by ${pluginId}: ${command.id}`)
    }
    if (command.label.trim().length === 0) throw new TuiPluginError(`TUI command label is empty: ${command.id}`)
    if (seen.has(command.id)) throw new TuiPluginError(`duplicate TUI command: ${command.id}`)
    seen.add(command.id)
    return {
      id: command.id,
      label: command.label.trim(),
      ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
    }
  })
}

function normalizePanels(pluginId: string, panels: readonly TuiPanelContribution[]): readonly TuiPanelContribution[] {
  const seen = new Set<string>()
  return panels.map(panel => {
    if (!panel.id.startsWith(`${pluginId}.`)) {
      throw new TuiPluginError(`TUI panel must be namespaced by ${pluginId}: ${panel.id}`)
    }
    if (panel.title.trim().length === 0) throw new TuiPluginError(`TUI panel title is empty: ${panel.id}`)
    if (seen.has(panel.id)) throw new TuiPluginError(`duplicate TUI panel: ${panel.id}`)
    seen.add(panel.id)
    return { id: panel.id, title: panel.title.trim(), rows: panel.rows.map(row => row) }
  })
}
