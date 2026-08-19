#!/usr/bin/env node
/** Portable package-bin wrapper for the `omdsh` shorthand. */

process.env.DSH_EXECUTABLE_NAME = 'omdsh'
await import('./bin.ts')

export {}
