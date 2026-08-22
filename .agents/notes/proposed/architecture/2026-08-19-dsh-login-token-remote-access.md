# Agent Note: DSH login-token remote access

Status: proposed

## Problem

`dsh web` historically bound only loopback and rejected `--host 0.0.0.0` because the `/api` Host/Origin fence is reachability protection, not authentication. Remote Web and a future remote TUI need a first-party login-token mechanism that does not depend on an external enterprise control plane.

## Proposal

Add a built-in bearer-token gate to `@deepseek-ai/dsh-client-connection`:

- `ConnectionConfig.tokenAuth` accepts opaque tokens with optional scopes (`web`, `tui`, `admin`; default `admin`).
- Every `/api` HTTP request and both WebSocket downlinks require a valid token when `tokenAuth` is configured.
- Tokens may arrive as `Authorization: Bearer`, `x-dsh-access-token`, or the `__Host-dsh-access-token` cookie.
- An `admin`-scoped token unlocks the privileged method set that otherwise remains loopback-only.

The web CLI now accepts `--token <token>` and allows `--host 0.0.0.0` only when a token is supplied via the flag or `DSH_ACCESS_TOKEN`. A new `dsh auth token create/list/revoke` family stores only SHA-256 token hashes under the DSH home.

This slice covers first-party token auth for remote Web, operator token create/list/revoke, and the same bearer surface a future remote TUI can reuse. It does not add OAuth/SSO, TLS/WSS termination, or a persistent server-side verifier: the gate compares configured plaintext tokens and keeps the hash store as the operator management layer.

## Alternatives considered

**Leave remote bind blocked until an external identity plane exists.** Rejected. Loopback-only Web already blocks LAN and remote TUI work; waiting for OAuth would keep `--host 0.0.0.0` unsupported with no first-party path.

**Treat `trustedHosts` as authentication.** Rejected. That list is a DNS-rebinding fence. Using it as a login would authorize any caller who can present a declared Host.

**Require an operator reverse-proxy or enterprise SSO before any remote bind.** Rejected as the only path. A reverse proxy remains the recommended TLS terminator, but a built-in token gate is the smallest first-party admission layer that does not invent a second identity product.

**Persist and verify only token hashes at request time.** Deferred. The current slice stores hashes for operator management and compares configured plaintext tokens at the gate so the first remote-Web path stays local and inspectable.

## Acceptance criteria

- `--host 0.0.0.0` is accepted only when `--token` or `DSH_ACCESS_TOKEN` supplies a token.
- When `tokenAuth` is configured, every `/api` HTTP request and both WebSocket downlinks require a valid token; missing or invalid tokens receive `401` or a rejected upgrade.
- An `admin`-scoped token may reach the privileged method set that otherwise stays loopback-only.
- `dsh auth token create/list/revoke` stores only SHA-256 hashes under the DSH home.
- Focused specs stay green: `token-auth.host.spec.ts`, `startup.spec.ts`, `auth-store.spec.ts`, and `args.spec.ts`.

## Risks

A configured plaintext token is a bearer secret. Logging, traces, and fixtures must not echo it; the hash store is the only durable operator record.

The gate is admission, not transport security. Production remote bind still needs TLS at a reverse proxy; this change does not terminate TLS or replace network isolation.

An `admin` token unlocks the privileged method set across the LAN. Operators who share a web-scoped token must not reuse it as admin.
