# Changelog

## Unreleased

### Features

- Add source-line comments and full-source agent previews for rendered Markdown.
- Add `createMarkdownArtifactReview` and `previewSourceProposal` browser APIs.
- Teach the Codex and Claude Code adapters to return `replaceSource` proposals.

## 0.1.0 - 2026-08-28

### Features

- Add anchored section comments, whole-page feedback, and direct inline edits.
- Add harness-neutral request and patch contracts with in-place preview.
- Add server-side adapters for Codex and Claude Code.

### Fixes

- Make preview commit and rollback idempotent.
- Clear stale proposals before a replacement agent request.
- Reject internal attributes and sanitize additional executable HTML paths.
- Add keyboard selection for stable artifact sections.

### Documentation

- Add integration, protocol, contributing, and security guidance.
