# Agent Note: Enterprise access-ticket transport canary

Status: implemented

English | [中文](2026-08-13-enterprise-access-ticket-transport-canary.zh.md)

## Problem

The Web connection carrier previously used only Host and Origin reachability checks. Those checks defend DNS rebinding and cross-site browser traffic but do not select an authenticated tenant, workspace, runtime generation, or browser connection generation for an enterprise deployment.

## Decision

**`@deepseek-ai/dsh-client-connection` has an opt-in `accessTicket` Host configuration.** The configuration accepts a pure server-side `AccessTicketVerifier`; it receives an opaque value from `x-dsh-access-ticket` or `__Host-dsh-access-ticket` and returns an authoritative immutable binding. DSH does not parse OAuth or provider credentials, contact an identity provider, record a token, or grant an implicit remote mode. Omitting the configuration preserves the existing local-only behavior.

**The `dsh_web_v1` profile authorizes exactly three carriers after the existing browser-trust fence.** The verifier receives `/api` as `http`, `/api/events.mux` as `events.mux`, and `/api/events.host` as `events.host`; no generic WebSocket path is accepted. An accepted binding contains `sid`, `principal`, `tenant`, `workspace`, `runtimeRef`, `runtimeGeneration`, `connectionGeneration`, `audience`, exact `origin`, `expiresAt`, and `jti`. The gate rejects missing, expired, malformed, audience-mismatched, origin-mismatched, and verifier-denied bindings. It treats verifier failures as indistinguishable denials.

**The WebSocket pair has one fail-closed generation with hard expiry.** The gate keys the live pair by `connectionGeneration`, fingerprints the scope excluding `jti`, tracks a `jti` separately, and permits one live generation per `sid`. A duplicate stream, changed scope, `jti` reuse across a generation, or different connection generation for the same session tears down the established sibling and rejects the new upgrade. On first admission, an internal timer at `expiresAt` closes both downlinks and consumes their JTIs even if no carrier makes a later request; generation failure and plugin disposal clear the timer. This compensates for the downlink-only carrier having no browser application message with which to perform a second pairing exchange.

## Control-plane adapter mapping

The upstream control-plane adapter exchanges the opaque ticket once and caches returned claims only for the exact `connectionGeneration` and requested `dsh_web_v1` carriers. `SessionID`, `OperatorID`, `TenantID`, `WorkspaceID`, `RuntimeRef`, `Generation`, `Audience`, `Origin`, `ConnectionKind`, `JTI`, and `ExpiresAt` map to the DSH binding fields. `ConnectionKind` constrains the verifier request's `http`, `events.mux`, or `events.host` carrier.

`MembershipRevision`/`ScopeRevision`, `InstallationID`, `ReleaseDigest`, and `PolicyRevision` remain verifier-owned preconditions. The connection package has no authoritative installation, release, membership, or policy projection against which to compare them. That omission is a documented compatibility gap: this canary does not claim a direct production Aigora-to-DSH closure.

## Alternatives considered

**Parse provider OAuth credentials in DSH.** Rejected because provider-token refresh, user login state, and identity authority belong to the control plane, while this package owns only browser transport admission.

**Use `jti` as the WebSocket pair key.** Rejected because two valid tickets with different JTIs could otherwise create the mux and host sides under different connection generations. `connectionGeneration` owns the pair; `jti` remains a replay correlation key.

**Enable tickets for remote Web by default.** Rejected because an unconfigured verifier cannot authenticate a deployment. Local mode remains explicit until an enterprise composition supplies a verifier.

## Consequences

The package can compose against a keyless fake control-plane adapter and rejects invalid bindings before API dispatch or upgrade negotiation. The canary does not provide OS isolation, tenant data isolation, sandbox lifecycle, OAuth login, persistence, an issuer implementation, or distributed replay storage. A production owner must provide an atomic exchange/revocation authority, a cookie policy, durable replay semantics, and local projections or an authoritative adapter decision for the deferred installation/release/policy fields.

## Testing

Focused host tests cover missing, expired, scope-mismatched, and replayed tickets; cookie transport; every `dsh_web_v1` HTTP and upgrade entry; pair teardown; hard expiry without a later request, sibling closure, consumed-JTI rejection, gate-disposal cleanup, different JTI/different generation denial through a real `ws` upgrade; and the unchanged local default.

The subproject command `pnpm run test:evidence:access-ticket` runs the keyless ticket tests, host typecheck, and the complete client/host suite with an explicit local timeout, then generates redacted evidence under `temp/integration-test-runs/<run-id>/`. The generated record is focused/local only and does not claim OAuth provider, sandbox, cloud Agent, deployment, or production acceptance.
