# JobSpy MCP Server — Agent Guide

## Quick start

```bash
npm install
npm start               # stdio mode (for Claude Desktop)
ENABLE_SSE=1 npm start  # SSE mode (Express on :9423)
npm run dev             # nodemon auto-restart
npm run lint            # ESLint flat config (eslint.config.cjs)
```

## Architecture

- **Single ESM package** (`"type": "module"`). Entrypoint: `src/index.js`.
- Wraps the **Python JobSpy** tool via `docker run --rm jobspy <args>` using `execSync` (see `src/tools/search-jobs.js:176`).
- JobSpy container is expected to exist locally (built from `./jobspy/` or the `jobspy-scraper` Compose service).
- **Two transport modes** controlled by `ENABLE_SSE` env var:
  - **stdio** (`ENABLE_SSE=0`, default): connect via `StdioServerTransport` — used by Claude Desktop.
  - **SSE** (`ENABLE_SSE=1`): Express on `JOBSPY_HOST:JOBSPY_PORT` (default `0.0.0.0:9423`). Endpoints: `GET /sse`, `POST /messages`, `POST /api`, `GET /health`.
- `POST /api` is a shortcut that calls `searchJobsHandler` directly (bypasses MCP protocol).
- `searchJobsTool` registers an MCP tool; `searchJobsHandler` is the shared implementation used by both the tool and `/api`.

## Key files

| Path | Role |
|------|------|
| `src/index.js` | Server bootstrap, transport setup, graceful shutdown |
| `src/tools/search-jobs.js` | `search_jobs` tool + `searchJobsHandler` + Docker exec logic |
| `src/schemas/searchParamsSchema.js` | Zod param schema for `search_jobs` |
| `src/schemas/jobSchema.js` | Zod schemas for job result objects |
| `src/sseManager.js` | SSE transport lifecycle + progress notifications |
| `src/prompts/` | MCP prompt templates (`search_jobs`, `job_recommendations`, `resume_feedback`) |
| `src/logger.js` | Winston logger (JSON format, colorized console transport) |
| `tests/jobSchema.test.js` | **Runs with `node` (not Jest)** — uses `require` (CommonJS), `describe`/`test` globals not wired to any runner. Expects `../../jobSpy/jobs.json`. |
| `compose.yaml` | Docker Compose with `jobspy-scraper` + Node server (Docker socket mounted) |

## Gotchas

- **`npm test` is a placeholder** (`exit 1`). The test file `tests/jobSchema.test.js` uses `require()` + `describe()`/`test()` globals with no test framework configured. It's not runnable without manual setup.
- **.env is committed** with defaults (`ENABLE_SSE=1`, `JOBSPY_PORT=9423`).
- **Tests require external data** at `../../jobSpy/jobs.json` (relative to the repo root, from the system prompt — outside this repo).
- **VS Code settings** (`settings.json`) reference `.eslintrc.json` but the actual config is `eslint.config.cjs` (ESLint flat config). The settings are stale.
- **`searchJobsHandler` filters out `0` and `""` values** from params before validation (line 154-166 of `search-jobs.js`), which means `resultsWanted: 0` and `hoursOld: 0` are silently stripped. However, the Zod schema transforms `0` back to defaults (20 and 72 respectively).
- **Progress notifications** only work in SSE mode (via `sseManager.notificationProgress`), not stdio.
- **No typecheck** step exists — only lint.
- **Lint**: `eslint src/` (ESLint 9 flat config). Fix with `npm run lint:fix`.
- **`jobspy-scraper` compose service uses `command: tail -f /dev/null`** — it stays alive as a no-op so the Docker socket-based `docker run --rm jobspy` calls from the Node server work. It does NOT run `main.py` on startup.
- **`restart: unless-stopped`** is set on `jobspy-mcp-server` in compose.yaml. The `depends_on` was removed — the Node server calls the scraper image on-demand via the Docker socket, it doesn't need the scraper container running.
- **Prompt schemas must be raw shapes**, not `z.object()` wrappers. The SDK's `server.prompt()` expects `{ query: z.string() }`, not `z.object({ query: z.string() })`. See `src/prompts/` for examples.
