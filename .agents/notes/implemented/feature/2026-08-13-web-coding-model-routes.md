# Agent Note: Web coding-model routes

Status: implemented

English | [中文](2026-08-13-web-coding-model-routes.zh.md)

## Problem

The Web profile exposed the Harness model picker without a ready-to-use route for the coding models already described by the installed pi-ai catalog. Users had to reconstruct provider ids, protocols, endpoints, and model ids manually, and copying native CLI credential files into Harness would violate the credential boundary.

## Decision

**The Web bundle declares three catalog-backed routes.** It narrows `openai-codex` to `gpt-5.6-luna`, declares `glm-claude-code` with the Anthropic Messages protocol at `https://open.bigmodel.cn/api/anthropic` and model `glm-5.2[1m]`, and narrows `kimi-coding` to `k3`. The installed pi-ai providers remain responsible for their wire implementations and model metadata; only the GLM route is a hand-declared protocol override because Claude Code's endpoint is not a separate pi-ai catalog route.

**Credentials remain DSH references.** The routes resolve `OPENAI_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `KIMI_API_KEY` through `ctx.credentials` for each request. The Web bundle does not read Codex, Claude Code, or Kimi Code configuration files, import OAuth stores, or place secret values in patch files. Codex and Kimi CLI OAuth remains a host-product concern until the Harness adapter owns a compatible persistent OAuth store and login flow.

**The routes belong to the Web layer.** The base bundle keeps `llm-pi-ai` dormant so headless and other profiles do not acquire additional network routes or missing-credential failures. The Web model settings page already exposes the configurable provider directory and credential editor, so no new client surface is required.

## Alternatives considered

**Import native CLI settings and OAuth files automatically.** Rejected because those files contain product-owned credentials and have provider-specific refresh semantics that the Harness credential service cannot safely infer or persist.

**Use the OpenAI-compatible GLM Coding CN route for Claude Code's GLM model.** Rejected because the requested configuration is Claude Code's Anthropic-compatible endpoint, whose request protocol and base URL differ from the OpenAI Coding route.

**Add a new provider adapter package.** Rejected because the installed pi-ai catalog already owns Codex and Kimi implementations, and `llm-pi-ai` already supports the needed Anthropic-compatible custom route.

## Consequences

`dsh web` presents the three requested coding models in its model settings and picker. A route is visible before its credential is configured and fails at request time with the existing `MISSING_CREDENTIAL` diagnostic until its referenced token is exported or stored through Settings → Models. The GLM model is sized for the documented 1M context configuration. OAuth-based native CLI login is not automatically reused by DSH, which is explicit in the user guide and remains the follow-up boundary for a future auth integration.
