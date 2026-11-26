# Agents

See [CLAUDE.md](./CLAUDE.md) for project context, architecture, conventions, and gotchas. That file is the canonical AI-context doc for this repo; this file exists only as a pointer for tools that look for `AGENTS.md` by convention, so keep guidance there rather than here.

The block below is managed by `next dev`, which writes it into this file whenever it detects an AI agent and restores it if removed. The same text is in CLAUDE.md for Claude Code, which does not read this file.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
