/**
 * `dsh plugin manifest` — CLI-authored plugin package metadata.
 *
 * The package file records the four plugin faces, compatibility posture,
 * requested permissions, and the files a tarball must carry. `init` is the
 * only writer; `validate` is read-only and `pack` validates before delegating
 * archive creation to pnpm.
 * @module @deepseek-ai/dsh/plugin-manifest
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const MANIFEST_FILE = 'dsh.plugin.json'
const SCHEMA = 'dsh.plugin.manifest.v0'

/** The output renderers accepted by the command adapter. */
export type PluginManifestOutput = 'summary' | 'agent' | 'json'

/** The resolved `dsh plugin manifest` command. */
export interface PluginManifestOptions {
  command: 'init' | 'validate' | 'pack'
  path: string
  outDir?: string
  output: PluginManifestOutput
}

/** One four-face plugin descriptor persisted by `init`. */
interface PluginManifest {
  schema: typeof SCHEMA
  id: string
  version: string
  faces: {
    host: { entry: string }
    client: { entry: string }
    composition: { patch: string }
    observation: { kind: 'toolview' | 'conversation-node' | 'none' }
  }
  compatibility: { dsh_api_range: string; experimental: boolean }
  permissions: string[]
  files: string[]
}

/** A package manifest's fields needed to derive the plugin metadata. */
interface PackageJson {
  name?: unknown
  version?: unknown
  files?: unknown
  scripts?: unknown
  dsh?: { bundle?: { patch?: unknown }; client?: unknown }
}

/** The stable projection every output renderer consumes. */
interface PluginManifestProjection {
  spec_version: '1.0'
  command: 'plugin.manifest.init' | 'plugin.manifest.validate' | 'plugin.manifest.pack'
  status: 'success' | 'failed'
  summary: string
  facts: {
    package: string
    manifest: typeof MANIFEST_FILE
    schema?: typeof SCHEMA
    files?: number
    tarball?: string
    sha256?: string
  }
  actions: readonly { readonly name: string; readonly command: string }[]
  evidence: readonly string[]
  confidence: number
  data?: {
    schema: typeof SCHEMA
    id: string
    version: string
    files: readonly string[]
    tarball?: { readonly name: string; readonly sha256: string }
  }
  error?: { readonly code: string; readonly message: string }
}

/** Process streams, replaceable by focused command tests. */
export const internals: { stdout: { write(chunk: string): unknown }; stderr: { write(chunk: string): unknown } } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Report one predictable validation failure without leaking a host path. */
class PluginManifestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** A package root after its realpath and lstat checks have passed. */
interface PackageRoot {
  path: string
  realpath: string
}

/** Whether a package-relative file name stays inside the package root. */
function isSafeFileName(value: string): boolean {
  return value !== ''
    && !value.includes('\\')
    && !isAbsolute(value)
    && !value.split('/').includes('..')
    && !/[?*[\]]/.test(value)
}

/** Convert a package-relative path to the normalized form used in metadata. */
function packageRelativePath(value: string): string {
  const withoutPrefix = value.replace(/^\.\//, '')
  return withoutPrefix.endsWith('/') ? withoutPrefix.slice(0, -1) : withoutPrefix
}

/** Prove that a resolved realpath remains below the package root. */
function assertContained(root: PackageRoot, candidate: string, code: string): void {
  let candidateRealpath: string
  try {
    candidateRealpath = realpathSync(candidate)
  } catch {
    throw new PluginManifestError(code, 'package candidate is unavailable')
  }
  const within = relative(root.realpath, candidateRealpath)
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new PluginManifestError(code, 'package candidate escapes the package root')
  }
}

/** Reject symlinked path components, including a symlinked parent directory. */
function assertNoSymlinkComponents(root: PackageRoot, normalized: string, code: string): void {
  let current = root.path
  for (const segment of normalized.split('/')) {
    current = join(current, segment)
    let entry
    try {
      entry = lstatSync(current)
    } catch {
      throw new PluginManifestError(code, 'declared package file is missing')
    }
    if (entry.isSymbolicLink()) throw new PluginManifestError(code, 'symlink package files are not allowed')
  }
}

/** Prove that a package path is a regular, non-symlink file. */
function regularFile(root: PackageRoot, value: string, code: string): string {
  const normalized = packageRelativePath(value)
  if (!isSafeFileName(normalized)) throw new PluginManifestError(code, 'package file must be relative and literal')
  assertNoSymlinkComponents(root, normalized, code)
  const candidate = join(root.path, normalized)
  let entry
  try {
    entry = lstatSync(candidate)
  } catch {
    throw new PluginManifestError(code, 'declared package file is missing')
  }
  if (entry.isSymbolicLink()) throw new PluginManifestError(code, 'symlink package files are not allowed')
  if (!entry.isFile()) throw new PluginManifestError(code, 'declared package file must be regular')
  assertContained(root, candidate, code)
  return normalized
}

/** Read a package-relative face path that exists in the declared package. */
function faceFile(root: PackageRoot, value: unknown, field: string): string {
  const file = nonEmptyString(value, 'plugin_manifest_faces_invalid', field)
  return `./${regularFile(root, file, 'plugin_manifest_faces_invalid')}`
}

/** Read JSON as an object, rejecting malformed metadata with a stable code. */
function readObject(file: string, code: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new PluginManifestError(code, 'plugin metadata is not valid JSON')
  }
}

/** Convert a generated or parsed value to a non-empty string. */
function nonEmptyString(value: unknown, code: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new PluginManifestError(code, `${field} is required`)
  return value
}

/** Validate an npm package name without consulting a permission registry. */
function npmPackageName(value: unknown): string {
  const name = nonEmptyString(value, 'package_name_invalid', 'package.json name')
  const part = '[a-z0-9](?:[a-z0-9._~-]*[a-z0-9])?'
  if (!new RegExp(`^(?:@${part}/${part}|${part})$`).test(name)) {
    throw new PluginManifestError('package_name_invalid', 'package.json name is not a safe npm package name')
  }
  return name
}

/** Validate the npm version identifier used to bind the archive identity. */
function npmVersion(value: unknown): string {
  const version = nonEmptyString(value, 'package_version_invalid', 'package.json version')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new PluginManifestError('package_version_invalid', 'package.json version is not a safe npm version')
  }
  return version
}

/** Validate a permission identifier without inventing or consulting a registry. */
function permissionIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9._:-]{0,63}$/.test(value)) {
    throw new PluginManifestError('plugin_manifest_permissions_invalid', 'permissions must use safe identifiers')
  }
  return value
}

/** Prove that the package root is a real directory, not a symlink. */
function packageRoot(input: string): PackageRoot {
  const path = resolve(input)
  let entry
  try {
    entry = lstatSync(path)
  } catch {
    throw new PluginManifestError('plugin_package_missing', 'package.json is missing from the plugin package')
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new PluginManifestError('plugin_package_invalid', 'plugin package root must be a real directory')
  }
  return { path, realpath: realpathSync(path) }
}

/** Read one package JSON only after its path passed source-boundary checks. */
function packageJson(root: PackageRoot): PackageJson {
  const file = join(root.path, 'package.json')
  try {
    regularFile(root, 'package.json', 'package_package_json_invalid')
  } catch (error) {
    if (error instanceof PluginManifestError && error.message === 'declared package file is missing') {
      throw new PluginManifestError('plugin_package_missing', 'package.json is missing from the plugin package')
    }
    throw error
  }
  return readObject(file, 'package_package_json_invalid') as unknown as PackageJson
}

/** Escape one literal glob segment for the regular expression compiler. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Compile the package.json `files` subset used by plugin packages. */
function globMatcher(pattern: string): RegExp {
  const segments = packageRelativePath(pattern).split('/')
  let source = '^'
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    const previous = segments[index - 1]
    if (segment === '**') {
      if (index > 0 && previous !== '**') source += '/'
      source += index === segments.length - 1 ? '.*' : '(?:[^/]+/)*'
      continue
    }
    if (index > 0 && previous !== '**') source += '/'
    source += escapeRegExp(segment).replace(/\\\*/g, '[^/]*').replace(/\\\?/g, '[^/]')
  }
  return new RegExp(`${source}$`)
}

/** Whether an npm `files` entry contains a glob metacharacter. */
function hasGlob(value: string): boolean {
  return /[*?\[]/.test(value)
}

/** Walk one selected package directory, rejecting symlinks and special files. */
function walkRegularFiles(root: PackageRoot, directory: string, result: Set<string>): void {
  const entry = lstatSync(directory)
  if (entry.isSymbolicLink()) throw new PluginManifestError('plugin_manifest_files_invalid', 'symlink package files are not allowed')
  if (!entry.isDirectory()) throw new PluginManifestError('plugin_manifest_files_invalid', 'package file selector is not a directory')
  assertContained(root, directory, 'plugin_manifest_files_invalid')
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === '.git') continue
    const child = join(directory, name)
    const childEntry = lstatSync(child)
    if (childEntry.isSymbolicLink()) {
      throw new PluginManifestError('plugin_manifest_files_invalid', 'symlink package files are not allowed')
    }
    if (childEntry.isDirectory()) {
      walkRegularFiles(root, child, result)
      continue
    }
    if (!childEntry.isFile()) throw new PluginManifestError('plugin_manifest_files_invalid', 'package files must be regular')
    assertContained(root, child, 'plugin_manifest_files_invalid')
    result.add(packageRelativePath(relative(root.path, child)))
  }
}

/** Enumerate actual regular files selected by package.json `files` entries. */
function expandPackageFiles(root: PackageRoot, files: readonly string[] | undefined): string[] {
  const result = new Set<string>()
  for (const raw of files ?? []) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new PluginManifestError('plugin_manifest_files_invalid', 'package.json files entries must be non-empty strings')
    }
    const selector = packageRelativePath(raw)
    if (isAbsolute(selector) || selector.includes('\\') || selector.split('/').includes('..') || (!isSafeFileName(selector) && !hasGlob(selector))) {
      throw new PluginManifestError('plugin_manifest_files_invalid', 'package.json files entries must be package-relative')
    }
    if (hasGlob(selector)) {
      const matcher = globMatcher(selector)
      const walk = (directory: string): void => {
        const entry = lstatSync(directory)
        if (entry.isSymbolicLink()) return
        if (!entry.isDirectory()) return
        for (const name of readdirSync(directory)) {
          if (name === 'node_modules' || name === '.git') continue
          const child = join(directory, name)
          const childEntry = lstatSync(child)
          if (childEntry.isSymbolicLink()) {
            const childRelative = packageRelativePath(relative(root.path, child))
            if (matcher.test(childRelative)) {
              throw new PluginManifestError('plugin_manifest_files_invalid', 'symlink package files are not allowed')
            }
            continue
          }
          if (childEntry.isDirectory()) walk(child)
          else if (childEntry.isFile()) {
            const childRelative = packageRelativePath(relative(root.path, child))
            if (matcher.test(childRelative)) {
              assertContained(root, child, 'plugin_manifest_files_invalid')
              result.add(childRelative)
            }
          } else if (matcher.test(packageRelativePath(relative(root.path, child)))) {
            throw new PluginManifestError('plugin_manifest_files_invalid', 'package files must be regular')
          }
        }
      }
      walk(root.path)
      continue
    }
    const candidate = join(root.path, selector)
    let entry
    try {
      entry = lstatSync(candidate)
    } catch {
      continue
    }
    if (entry.isDirectory()) walkRegularFiles(root, candidate, result)
    else result.add(regularFile(root, selector, 'plugin_manifest_files_invalid'))
  }
  return [...result].sort()
}

/** Derive a first manifest from the package's public npm metadata. */
function initialManifest(root: PackageRoot, packageJson: PackageJson): PluginManifest {
  const id = npmPackageName(packageJson.name)
  const version = npmVersion(packageJson.version)
  const packageFiles = packageJson.files === undefined
    ? undefined
    : Array.isArray(packageJson.files) && packageJson.files.every(value => typeof value === 'string')
      ? packageJson.files as string[]
      : (() => {
        throw new PluginManifestError('plugin_manifest_files_invalid', 'package.json files must be a string array')
      })()
  const patch = typeof packageJson.dsh?.bundle?.patch === 'string' ? packageJson.dsh.bundle.patch : undefined
  const host = faceFile(root, './lib/index.js', 'faces.host.entry')
  const client = faceFile(root, './lib/client.js', 'faces.client.entry')
  const composition = faceFile(root, patch ?? './cordis.patch.yml', 'faces.composition.patch')
  const files = new Set(expandPackageFiles(root, packageFiles))
  for (const file of ['package.json', host, client, composition]) files.add(packageRelativePath(file))
  try {
    files.add(regularFile(root, 'README.md', 'plugin_manifest_files_invalid'))
  } catch (error) {
    if (!(error instanceof PluginManifestError) || error.message !== 'declared package file is missing') throw error
  }
  return {
    schema: SCHEMA,
    id,
    version,
    faces: {
      host: { entry: host },
      client: { entry: client },
      composition: { patch: composition },
      observation: { kind: 'none' },
    },
    compatibility: { dsh_api_range: '^0.1.0', experimental: true },
    permissions: [],
    files: [MANIFEST_FILE, ...[...files].sort()],
  }
}

/** Require an ordinary object field. */
function objectField(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = record[field]
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new PluginManifestError('plugin_manifest_invalid', `${field} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Parse and validate one manifest before packing or reporting it. */
function validateManifest(root: PackageRoot, packageJsonValue: PackageJson): PluginManifest {
  const manifestFile = join(root.path, MANIFEST_FILE)
  regularFile(root, MANIFEST_FILE, 'plugin_manifest_missing')
  const raw = readObject(manifestFile, 'plugin_manifest_invalid')
  if (raw.schema !== SCHEMA) throw new PluginManifestError('plugin_manifest_schema_invalid', `schema must be ${SCHEMA}`)
  const faces = objectField(raw, 'faces')
  const host = objectField(faces, 'host')
  const client = objectField(faces, 'client')
  const composition = objectField(faces, 'composition')
  const observation = objectField(faces, 'observation')
  const compatibility = objectField(raw, 'compatibility')
  const permissions = raw.permissions
  const files = raw.files
  if (!Array.isArray(permissions) || !permissions.every(permission => typeof permission === 'string')) {
    throw new PluginManifestError('plugin_manifest_permissions_invalid', 'permissions must be a string array')
  }
  const checkedPermissions = permissions.map(permissionIdentifier)
  if (new Set(checkedPermissions).size !== checkedPermissions.length) {
    throw new PluginManifestError('plugin_manifest_permissions_invalid', 'permissions must not repeat')
  }
  if (!Array.isArray(files) || !files.every(file => typeof file === 'string' && isSafeFileName(file))) {
    throw new PluginManifestError('plugin_manifest_files_invalid', 'files must be package-relative file names')
  }
  if (new Set(files).size !== files.length) {
    throw new PluginManifestError('plugin_manifest_files_invalid', 'files must not repeat')
  }
  const observationKind = observation.kind
  if (observationKind !== 'toolview' && observationKind !== 'conversation-node' && observationKind !== 'none') {
    throw new PluginManifestError('plugin_manifest_observation_invalid', 'observation.kind is invalid')
  }
  const manifest: PluginManifest = {
    schema: SCHEMA,
    id: npmPackageName(raw.id),
    version: npmVersion(raw.version),
    faces: {
      host: { entry: faceFile(root, host.entry, 'faces.host.entry') },
      client: { entry: faceFile(root, client.entry, 'faces.client.entry') },
      composition: { patch: faceFile(root, composition.patch, 'faces.composition.patch') },
      observation: { kind: observationKind },
    },
    compatibility: {
      dsh_api_range: nonEmptyString(compatibility.dsh_api_range, 'plugin_manifest_compatibility_invalid', 'compatibility.dsh_api_range'),
      experimental: (() => {
        if (typeof compatibility.experimental !== 'boolean') {
          throw new PluginManifestError('plugin_manifest_compatibility_invalid', 'compatibility.experimental must be a boolean')
        }
        return compatibility.experimental
      })(),
    },
    permissions: checkedPermissions,
    files: files.map(file => regularFile(root, file, 'plugin_manifest_package_file_missing')),
  }
  if (manifest.id !== npmPackageName(packageJsonValue.name) || manifest.version !== npmVersion(packageJsonValue.version)) {
    throw new PluginManifestError('plugin_manifest_identity_mismatch', 'manifest id/version must match package.json')
  }
  const required = [manifest.faces.host.entry, manifest.faces.client.entry, manifest.faces.composition.patch, MANIFEST_FILE, 'package.json']
  for (const file of required) {
    if (!manifest.files.includes(packageRelativePath(file))) {
      throw new PluginManifestError('plugin_manifest_files_invalid', 'manifest files must include every plugin face')
    }
  }
  return manifest
}

/** Render a success projection in the requested output mode. */
function agentValue(value: string): string {
  return /^[A-Za-z0-9._:/<>-]+$/.test(value) ? value : JSON.stringify(value)
}

function writeProjection(mode: PluginManifestOutput, projection: PluginManifestProjection): void {
  if (mode === 'json') {
    internals.stdout.write(`${JSON.stringify({ mode: 'json', ...projection })}\n`)
    return
  }
  if (mode === 'agent') {
    const lines = [
      'spec_version=1.0',
      'mode=agent',
      `command=${projection.command}`,
      `status=${projection.status}`,
      `fact.package=${projection.facts.package}`,
      `fact.manifest=${projection.facts.manifest}`,
      ...projection.facts.schema === undefined ? [] : [`fact.schema=${projection.facts.schema}`],
      ...projection.facts.files === undefined ? [] : [`fact.files=${String(projection.facts.files)}`],
      ...projection.facts.tarball === undefined ? [] : [`fact.tarball=${projection.facts.tarball}`],
      ...projection.facts.sha256 === undefined ? [] : [`fact.sha256=${projection.facts.sha256}`],
      ...projection.actions.map(action => `action.${action.name}=${action.command}`),
      ...projection.error === undefined ? [] : [`error.code=${projection.error.code}`, `error.message=${agentValue(projection.error.message)}`],
    ]
    internals.stdout.write(`${lines.join('\n')}\n`)
    return
  }
  internals.stdout.write(`Status: ${projection.summary}\nPackage: ${projection.facts.package}\n`)
  if (projection.facts.tarball !== undefined && projection.facts.sha256 !== undefined) {
    internals.stdout.write(`Tarball: ${projection.facts.tarball}\nSHA-256: ${projection.facts.sha256}\n`)
  }
  const next = projection.actions[0]
  if (next !== undefined) internals.stdout.write(`Recommended next step: ${next.command}\n`)
}

/** Build a success result without exposing the user-supplied package path. */
function success(
  command: PluginManifestOptions['command'],
  manifest: PluginManifest,
  tarball?: { name: string; sha256: string },
): PluginManifestProjection {
  const normalized = `plugin.manifest.${command}` as PluginManifestProjection['command']
  return {
    spec_version: '1.0',
    command: normalized,
    status: 'success',
    summary: command === 'init' ? 'Plugin manifest initialized.' : command === 'pack' ? 'Plugin tarball validated and packed.' : 'Plugin manifest is valid.',
    facts: {
      package: '<package-dir>', manifest: MANIFEST_FILE, schema: manifest.schema, files: manifest.files.length,
      ...tarball === undefined ? {} : { tarball: tarball.name, sha256: tarball.sha256 },
    },
    actions: command === 'init'
      ? [{ name: 'validate', command: 'dsh plugin manifest validate --path <package-dir>' }]
      : command === 'validate'
        ? [{ name: 'pack', command: 'dsh plugin manifest pack --path <package-dir> --out-dir <directory>' }]
        : [],
    evidence: [MANIFEST_FILE, ...tarball === undefined ? [] : [tarball.name]],
    confidence: 1,
    data: {
      schema: manifest.schema, id: manifest.id, version: manifest.version, files: manifest.files,
      ...tarball === undefined ? {} : { tarball },
    },
  }
}

/** Run tar with shell execution disabled and return only its stdout. */
function tarCommand(args: string[]): string {
  return tarBytes(args).toString('utf8')
}

/** Run tar for binary content without allowing shell interpretation. */
function tarBytes(args: string[]): Buffer {
  const result = spawnSync('tar', args, { encoding: 'buffer', shell: false })
  if (result.error !== undefined || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball could not be inspected')
  }
  return result.stdout
}

/** Hash one byte sequence for the source-to-stage and stage-to-archive binding. */
function contentDigest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Canonicalize parsed JSON so key ordering cannot weaken metadata comparison. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Normalize package-manager lifecycle stripping before comparing package metadata. */
function packagedPackageJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const record = { ...(value as Record<string, unknown>) }
  if ('scripts' in record) record.scripts = {}
  return record
}

/** Reject archive member paths that are not canonical package-relative names. */
function normalizeArchiveMember(value: string): string {
  const member = value.endsWith('\r') ? value.slice(0, -1) : value
  const withoutTrailingSlash = member.endsWith('/') ? member.slice(0, -1) : member
  const segments = withoutTrailingSlash.split('/')
  if (segments[0] !== 'package' || segments.some(segment => segment === '' || segment === '.' || segment === '..')
    || member.includes('\\') || member.includes('\0') || isAbsolute(member)) {
    throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball contains an unsafe member path')
  }
  return member.endsWith('/') ? `${withoutTrailingSlash}/` : member
}

/** Verify member names, member types, and the manifest/package binding in a tarball. */
function validateArchive(archiveFile: string, manifest: PluginManifest, stage: string): void {
  const members = tarCommand(['-tzf', archiveFile])
    .split(/\r?\n/)
    .filter(member => member !== '')
    .map(normalizeArchiveMember)
  if (new Set(members).size !== members.length) {
    throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball contains duplicate members')
  }

  const verbose = tarCommand(['-tvzf', archiveFile]).split(/\r?\n/).filter(line => line !== '')
  for (const line of verbose) {
    const type = line[0]
    if (type !== '-' && type !== 'd') {
      throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball contains a symlink or hardlink')
    }
  }

  const expected = new Set([
    ...manifest.files.map(file => `package/${packageRelativePath(file)}`),
    `package/${MANIFEST_FILE}`,
    `package/package.json`,
    `package/${packageRelativePath(manifest.faces.host.entry)}`,
    `package/${packageRelativePath(manifest.faces.client.entry)}`,
    `package/${packageRelativePath(manifest.faces.composition.patch)}`,
  ])
  for (const member of expected) {
    if (!members.includes(member)) {
      throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball is missing a declared package file')
    }
    const line = verbose.find(entry => entry.endsWith(` ${member}`))
    if (line === undefined || line[0] !== '-') {
      throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball declared file is not regular')
    }
  }
  for (const member of members.filter(candidate => !candidate.endsWith('/'))) {
    if (!expected.has(member)) {
      throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball contains an undeclared package file')
    }
  }

  for (const file of manifest.files) {
    const normalized = packageRelativePath(file)
    if (normalized === 'package.json') continue
    const stagedFile = join(stage, normalized)
    const archivedFile = tarBytes(['-xOf', archiveFile, `package/${normalized}`])
    if (contentDigest(archivedFile) !== contentDigest(readFileSync(stagedFile))) {
      throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball content does not match the validated package snapshot')
    }
  }

  let archivedPackage: unknown
  let archivedManifest: unknown
  try {
    archivedPackage = JSON.parse(tarCommand(['-xOf', archiveFile, 'package/package.json'])) as Record<string, unknown>
    archivedManifest = JSON.parse(tarCommand(['-xOf', archiveFile, `package/${MANIFEST_FILE}`])) as Record<string, unknown>
  } catch {
    throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball metadata is not valid JSON')
  }
  let stagedPackage: unknown
  try {
    stagedPackage = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8')) as unknown
  } catch {
    throw new PluginManifestError('plugin_manifest_pack_invalid', 'staged package metadata is not valid JSON')
  }
  if (canonicalJson(packagedPackageJson(archivedPackage)) !== canonicalJson(packagedPackageJson(stagedPackage))
    || canonicalJson(archivedManifest) !== canonicalJson(manifest)) {
    throw new PluginManifestError('plugin_manifest_pack_invalid', 'packed tarball metadata does not match the manifest')
  }
}

/** Snapshot source bytes immediately after validation and before staging. */
function snapshotSourceFiles(root: PackageRoot, manifest: PluginManifest): Map<string, string> {
  const snapshot = new Map<string, string>()
  for (const file of manifest.files) {
    const normalized = packageRelativePath(file)
    if (normalized === 'package.json' || normalized === MANIFEST_FILE) continue
    snapshot.set(normalized, contentDigest(readFileSync(join(root.path, normalized))))
  }
  return snapshot
}

/** Stage exactly the validated files so pnpm cannot broaden the package boundary. */
function stagePackage(root: PackageRoot, packageJsonValue: PackageJson, manifest: PluginManifest, snapshot: ReadonlyMap<string, string>): string {
  const stage = mkdtempSync(join(tmpdir(), 'dsh-plugin-pack-'))
  try {
    for (const file of manifest.files) {
      const normalized = packageRelativePath(file)
      const target = join(stage, normalized)
      mkdirSync(dirname(target), { recursive: true })
      if (normalized === 'package.json') {
        writeFileSync(target, `${JSON.stringify({ ...packageJsonValue, files: manifest.files }, null, 2)}\n`)
      } else if (normalized === MANIFEST_FILE) {
        writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`)
      } else {
        try {
          copyFileSync(join(root.path, normalized), target)
        } catch {
          throw new PluginManifestError('plugin_manifest_pack_invalid', 'plugin package changed while it was being staged')
        }
        const expectedDigest = snapshot.get(normalized)
        if (expectedDigest === undefined || contentDigest(readFileSync(target)) !== expectedDigest) {
          throw new PluginManifestError('plugin_manifest_pack_invalid', 'plugin package changed while it was being staged')
        }
      }
    }
    return stage
  } catch (error) {
    rmSync(stage, { force: true, recursive: true })
    throw error
  }
}

/** Ensure the requested output directory is absolute and not itself a symlink. */
function outputDirectory(input: string): string {
  const outDir = resolve(input)
  try {
    const entry = lstatSync(outDir)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new PluginManifestError('plugin_manifest_out_dir_invalid', '--out-dir must be a real directory')
    }
  } catch (error) {
    if (error instanceof PluginManifestError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new PluginManifestError('plugin_manifest_out_dir_invalid', '--out-dir is not available')
    }
    mkdirSync(outDir, { recursive: true })
    const entry = lstatSync(outDir)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new PluginManifestError('plugin_manifest_out_dir_invalid', '--out-dir must be a real directory')
    }
  }
  return outDir
}

/** Snapshot existing tarballs so an output path cannot be mistaken for a new pack. */
function tarballSnapshot(outDir: string): Map<string, string> {
  const snapshot = new Map<string, string>()
  for (const name of readdirSync(outDir)) {
    if (!name.endsWith('.tgz')) continue
    const file = join(outDir, name)
    const entry = lstatSync(file)
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new PluginManifestError('plugin_manifest_out_dir_invalid', 'output tarballs must be regular files')
    }
    snapshot.set(name, createHash('sha256').update(readFileSync(file)).digest('hex'))
  }
  return snapshot
}

/** Pack with pnpm in a staged directory, then bind and verify the archive. */
function pack(root: PackageRoot, packageJsonValue: PackageJson, manifest: PluginManifest, outDir: string): { name: string; sha256: string } {
  const snapshot = snapshotSourceFiles(root, manifest)
  const stage = stagePackage(root, packageJsonValue, manifest, snapshot)
  try {
    const before = tarballSnapshot(outDir)
    let result = spawnSync('pnpm', ['pack', '--ignore-scripts', '--pack-destination', outDir], {
      cwd: stage,
      encoding: 'utf8',
      shell: false,
    })
    if (typeof result.stderr === 'string' && /Unknown option:\s*['"]ignore-scripts['"]/.test(result.stderr)) {
      result = spawnSync('pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', outDir], {
        cwd: stage,
        encoding: 'utf8',
        env: { ...process.env, npm_config_ignore_scripts: 'true' },
        shell: false,
      })
    }
    if (result.error !== undefined || result.status !== 0) {
      throw new PluginManifestError('plugin_manifest_pack_failed', 'pnpm could not create the plugin tarball')
    }
    const after = tarballSnapshot(outDir)
    const changedTarballs = [...after.entries()]
      .filter(([name, digest]) => before.get(name) !== digest)
      .map(([name]) => name)
    const candidates = changedTarballs.length > 0 ? changedTarballs : [...after.keys()]
    const validTarballs = candidates.filter(name => {
      try {
        validateArchive(join(outDir, name), manifest, stage)
        return true
      } catch {
        return false
      }
    })
    if (validTarballs.length !== 1) throw new PluginManifestError('plugin_manifest_pack_invalid', 'pnpm did not create exactly one tarball')
    const tarball = validTarballs[0]!
    const tarballFile = join(outDir, tarball)
    validateArchive(tarballFile, manifest, stage)
    const sha256 = createHash('sha256').update(readFileSync(tarballFile)).digest('hex')
    return { name: tarball, sha256 }
  } finally {
    rmSync(stage, { force: true, recursive: true })
  }
}

/** Run one manifest lifecycle command and render exactly one requested mode. */
export function runPluginManifest(options: PluginManifestOptions): number {
  try {
    const root = packageRoot(options.path)
    const packageJsonValue = packageJson(root)
    if (options.command === 'init') {
      const manifest = initialManifest(root, packageJsonValue)
      const manifestFile = join(root.path, MANIFEST_FILE)
      let descriptor: number | undefined
      try {
        descriptor = openSync(manifestFile, 'wx', 0o644)
        writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new PluginManifestError('plugin_manifest_exists', `${MANIFEST_FILE} already exists`)
        }
        throw new PluginManifestError('plugin_manifest_write_failed', 'plugin manifest could not be created')
      } finally {
        if (descriptor !== undefined) closeSync(descriptor)
      }
      writeProjection(options.output, success(options.command, manifest))
      return 0
    }
    const manifest = validateManifest(root, packageJsonValue)
    const tarball = options.command === 'pack'
      ? pack(root, packageJsonValue, manifest, outputDirectory(nonEmptyString(options.outDir, 'plugin_manifest_out_dir_missing', '--out-dir')))
      : undefined
    writeProjection(options.output, success(options.command, manifest, tarball))
    return 0
  } catch (error) {
    const failure = error instanceof PluginManifestError
      ? error
      : new PluginManifestError('plugin_manifest_failed', 'plugin manifest command failed')
    const projection: PluginManifestProjection = {
      spec_version: '1.0',
      command: `plugin.manifest.${options.command}` as PluginManifestProjection['command'],
      status: 'failed',
      summary: 'Plugin manifest command failed.',
      facts: { package: '<package-dir>', manifest: MANIFEST_FILE },
      actions: [], evidence: [], confidence: 1,
      error: { code: failure.code, message: failure.message },
    }
    if (options.output === 'json') writeProjection('json', projection)
    else if (options.output === 'agent') writeProjection('agent', projection)
    else internals.stderr.write(`dsh: ${failure.message}\n`)
    return 1
  }
}
