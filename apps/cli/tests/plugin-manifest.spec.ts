/**
 * Official plugin-manifest command coverage: the metadata is CLI-authored,
 * validation does not rewrite it, and every output renderer receives the same
 * safe projection.
 */

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDshArgs } from '../src/args.ts'
import { internals, runPluginManifest } from '../src/plugin-manifest.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/** Create one minimum package whose four generated faces have real files. */
async function packageFixture(packageFields: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-plugin-manifest-'))
  directories.push(directory)
  await mkdir(join(directory, 'lib'))
  await Promise.all([
    writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@example/hello-plugin', version: '0.1.0', ...packageFields })),
    writeFile(join(directory, 'README.md'), '# Hello plugin\n'),
    writeFile(join(directory, 'cordis.patch.yml'), 'inject: []\n'),
    writeFile(join(directory, 'lib/index.js'), 'export {}\n'),
    writeFile(join(directory, 'lib/client.js'), 'export {}\n'),
  ])
  return directory
}

/** Capture stdout and stderr without exercising the process-global streams. */
function capture(): { stdout: () => string; stderr: () => string } {
  let stdout = ''
  let stderr = ''
  internals.stdout = { write: chunk => { stdout += chunk } }
  internals.stderr = { write: chunk => { stderr += chunk } }
  return { stdout: () => stdout, stderr: () => stderr }
}

describe('dsh plugin manifest', () => {
  it('resolves the additive manifest grammar without changing profile-plugin forwarding', () => {
    expect(parseDshArgs(['plugin', 'manifest', 'init', '--path', 'plugin'], '1.2.3'))
      .toEqual({ mode: 'plugin-manifest', command: 'init', path: 'plugin', output: 'summary' })
    expect(parseDshArgs(['plugin', 'manifest', 'pack', '--path', 'plugin', '--out-dir', 'out', '--agent'], '1.2.3'))
      .toEqual({ mode: 'plugin-manifest', command: 'pack', path: 'plugin', outDir: 'out', output: 'agent' })
    expect(parseDshArgs(['plugin', '--profile', 'web', 'add', 'example'], '1.2.3'))
      .toEqual({ mode: 'plugin', profile: 'web', args: ['add', 'example'] })
  })

  it('generates metadata through init and validates it without rewriting', async () => {
    const directory = await packageFixture()
    const output = capture()

    expect(runPluginManifest({ command: 'init', path: directory, output: 'summary' })).toBe(0)
    expect(output.stdout()).toContain('Plugin manifest initialized.')
    const before = await readFile(join(directory, 'dsh.plugin.json'), 'utf8')

    const json = capture()
    expect(runPluginManifest({ command: 'validate', path: directory, output: 'json' })).toBe(0)
    expect(JSON.parse(json.stdout())).toMatchObject({
      mode: 'json', spec_version: '1.0', command: 'plugin.manifest.validate', status: 'success',
      data: { schema: 'dsh.plugin.manifest.v0', id: '@example/hello-plugin' },
    })
    expect(await readFile(join(directory, 'dsh.plugin.json'), 'utf8')).toBe(before)
  })

  it('expands package.json files globs into a self-validating manifest', async () => {
    const directory = await packageFixture({ files: ['lib/**'] })
    await mkdir(join(directory, 'library'))
    await writeFile(join(directory, 'library/secret.js'), 'throw new Error(\"must not be packed\")\n')
    const output = capture()

    expect(runPluginManifest({ command: 'init', path: directory, output: 'summary' })).toBe(0)
    expect(runPluginManifest({ command: 'validate', path: directory, output: 'json' })).toBe(0)
    const manifest = JSON.parse(await readFile(join(directory, 'dsh.plugin.json'), 'utf8')) as { files: string[] }
    expect(manifest.files).toContain('lib/index.js')
    expect(manifest.files).not.toContain('library/secret.js')
    expect(output.stderr()).toBe('')
  })

  it.skipIf(process.platform === 'win32')('rejects symlinked package files before authoring metadata', async () => {
    const directory = await packageFixture({ files: ['lib/**'] })
    await symlink(join(directory, 'lib/index.js'), join(directory, 'lib/linked.js'))
    const output = capture()

    expect(runPluginManifest({ command: 'init', path: directory, output: 'summary' })).toBe(1)
    expect(output.stderr()).not.toContain(directory)
    expect(await readFile(join(directory, 'dsh.plugin.json')).catch(() => undefined)).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('does not run package lifecycle scripts while packing', async () => {
    const directory = await packageFixture()
    const marker = join(directory, 'prepack-ran')
    const packageFile = join(directory, 'package.json')
    const packageJson = JSON.parse(await readFile(packageFile, 'utf8')) as Record<string, unknown>
    packageJson.scripts = { prepack: "node -e \"require('node:fs').writeFileSync(process.env.DSH_PREPACK_MARKER, 'ran')\"" }
    await writeFile(packageFile, `${JSON.stringify(packageJson)}\n`)
    const previous = process.env.DSH_PREPACK_MARKER
    process.env.DSH_PREPACK_MARKER = marker
    try {
      expect(runPluginManifest({ command: 'init', path: directory, output: 'summary' })).toBe(0)
      expect(runPluginManifest({ command: 'pack', path: directory, outDir: join(directory, 'out'), output: 'json' })).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.DSH_PREPACK_MARKER
      else process.env.DSH_PREPACK_MARKER = previous
    }
    expect(await readFile(marker).catch(() => undefined)).toBeUndefined()
  })

  it('renders stable agent facts and redacts an invalid package path', async () => {
    const directory = await packageFixture()
    expect(runPluginManifest({ command: 'init', path: directory, output: 'summary' })).toBe(0)

    const agent = capture()
    expect(runPluginManifest({ command: 'validate', path: directory, output: 'agent' })).toBe(0)
    expect(agent.stdout()).toContain('spec_version=1.0\nmode=agent\ncommand=plugin.manifest.validate\nstatus=success\n')
    expect(agent.stdout()).not.toContain(directory)

    const missing = capture()
    expect(runPluginManifest({ command: 'validate', path: join(directory, 'missing'), output: 'summary' })).toBe(1)
    expect(missing.stderr()).not.toContain(directory)
    expect(missing.stderr()).toBe('dsh: package.json is missing from the plugin package\n')
  })

  it('packs one manifest-bearing tarball and returns a digest', async () => {
    const directory = await packageFixture()
    const outputDir = join(directory, 'out')
    expect(runPluginManifest({ command: 'init', path: directory, output: 'summary' })).toBe(0)

    const json = capture()
    const status = runPluginManifest({ command: 'pack', path: directory, outDir: outputDir, output: 'json' })
    expect(status).toBe(0)
    const result = JSON.parse(json.stdout()) as { mode: string; status: string; data: { tarball: { name: string; sha256: string } } }
    expect(result).toMatchObject({ mode: 'json', status: 'success' })
    expect(result.data.tarball.name).toMatch(/\.tgz$/)
    expect(result.data.tarball.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('recognizes a deterministic tarball when packing repeatedly into the same directory', async () => {
    const directory = await packageFixture()
    const outputDir = join(directory, 'out')
    expect(runPluginManifest({ command: 'init', path: directory, output: 'summary' })).toBe(0)

    const first = capture()
    expect(runPluginManifest({ command: 'pack', path: directory, outDir: outputDir, output: 'json' })).toBe(0)
    const firstResult = JSON.parse(first.stdout()) as { data: { tarball: { name: string; sha256: string } } }

    const second = capture()
    expect(runPluginManifest({ command: 'pack', path: directory, outDir: outputDir, output: 'json' })).toBe(0)
    const secondResult = JSON.parse(second.stdout()) as { data: { tarball: { name: string; sha256: string } } }
    expect(secondResult.data.tarball).toEqual(firstResult.data.tarball)
  })
})
