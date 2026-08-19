import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships the `dsh` entry and a tiny `omdsh` alias wrapper referenced
 * by package.json `bin`.
 * The root tsc emits the `lib/types` entries, so this override points at the
 * launcher and alias wrappers there; their reachable mode modules bundle with
 * the launcher entry.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/omdsh.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
