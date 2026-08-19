/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-agent-composition-preview`.
 * @module @deepseek-ai/dsh-agent-composition-preview/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-composition-preview'

/** Cordis companion plugin name. */
export const name = 'agent-composition-preview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no event stream or mutable runtime
 * data — it is a pure read over the tools, system-prompt, session-projection,
 * and agent-preset registries, and those registries own identity, shadowing,
 * and disposal. Its one process-level claim (projecting leaves no global
 * registrations) is asserted per smoke run rather than observed here, because
 * the claim is about one read's effect, not an ongoing relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
