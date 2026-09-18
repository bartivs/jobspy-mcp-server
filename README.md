# JobSpy MCP Server

A Model Context Protocol (MCP) server that enables AI assistants like Claude to search for jobs across multiple job listing platforms using the [JobSpy](https://github.com/Bunsly/JobSpy) tool.

## Features

- Search Indeed, LinkedIn, Glassdoor, Google, ZipRecruiter, Bayt, or Naukri
- Search exactly one source per call so failures and offsets stay source-specific
- Page supported sources with explicit `offset`, `nextOffset`, and `hasMore` metadata
- Filter by search terms, location, time frames, and more
- Get structured JSON job data that AI models can easily process
- Fetch LinkedIn descriptions by default, cache descriptions/applicant counts for six hours, and expose failed enrichment explicitly
- Learn empty/throttled source-location combinations with a persistent circuit breaker
- Query Greenhouse, Lever, Ashby, Workable, and SmartRecruiters public boards directly
- Persist seen jobs, applications, source health, and resume hashes across runs
- Multiple transport options: stdio for Claude integration, SSE for web clients

## Prerequisites

- Node.js 18+
- Docker (for running the JobSpy scraper inside a container)

## Installation

```bash
# Clone the repository
git clone https://github.com/borgius/jobspy-mcp-server.git
cd jobspy-mcp-server

# Install dependencies
npm install

# Build the JobSpy Docker image
docker compose build jobspy-scraper
```

## Configuration

### Environment Variables

| Variable              | Description                          | Default            |
|-----------------------|--------------------------------------|--------------------|
| `ENABLE_SSE`          | Use SSE transport (vs stdio)         | `0`                |
| `JOBSPY_PORT`         | HTTP server port (SSE mode)          | `9423`             |
| `JOBSPY_HOST`         | HTTP server host (SSE mode)          | `0.0.0.0`          |
| `JOBSPY_DOCKER_IMAGE` | Docker image tag for JobSpy scraper  | `jobspy`           |
| `LOG_LEVEL`           | Winston log level                    | `info`             |
| `JOBSPY_STATE_PATH`   | Persistent JSON state/cache path     | `data/jobspy-state.json` |
| `JOBSPY_CIRCUIT_COOLDOWN_MS` | Empty-source circuit cooldown | `21600000` (6h) |
| `JOBSPY_AUTO_ENRICH_APPLICANTS` | Enrich LinkedIn rows automatically | `true` |
| `JOBSPY_APPLICANT_CONCURRENCY` | Concurrent LinkedIn page fetches | `3` |

Defaults are in `.env` (committed).

## Usage

### Docker Compose (recommended for SSE)

```bash
docker compose up -d
```

The server listens on `http://localhost:9423`. The `jobspy-scraper` container stays alive and the Node server calls `python main.py` inside it on demand through the mounted Docker socket.

### Direct (for Claude Desktop stdio)

```bash
npm start       # ENABLE_SSE=0
npm run dev     # nodemon with auto-restart
```

## Connecting external apps

### Claude Desktop (stdio)

```json
{
  "mcpServers": {
    "jobspy": {
      "command": "node",
      "args": ["/path/to/jobspy-mcp-server/src/index.js"],
      "env": {
        "ENABLE_SSE": "0"
      }
    }
  }
}
```

### Claude Code (SSE)

```json
{
  "mcpServers": {
    "jobspy": {
      "type": "sse",
      "url": "http://localhost:9423/sse"
    }
  }
}
```

### LiteLLM

```yaml
# config.yaml
model_list:
  - model_name: jobspy
    litellm_params:
      model: mcp
      mcp_servers:
        jobspy:
          transport: sse
          url: http://host.docker.internal:9423/sse
```

LiteLLM connects via SSE and can call `search_jobs` as a tool through the OpenAI-compatible `/chat/completions` endpoint.

### curl (direct API)

The `POST /api` endpoint bypasses the MCP protocol and returns results directly. It accepts snake_case or camelCase keys, but still requires exactly one source:

```bash
curl -X POST http://localhost:9423/api \
  -H "Content-Type: application/json" \
  -d '{
    "search_term": "software engineer",
    "location": "San Francisco, CA",
    "site_names": "indeed",
    "results_wanted": 10,
    "offset": 0
  }'
```

### Web clients (MCP SSE)

The server exposes standard MCP SSE endpoints:

| Endpoint         | Purpose                                      |
|------------------|----------------------------------------------|
| `GET /sse`       | SSE connection stream (MCP transport)        |
| `POST /messages` | Send MCP JSON-RPC messages to the server     |
| `POST /api`      | Direct JSON API (bypasses MCP)               |
| `GET /health`    | Health check                                 |

```javascript
// Connect via MCP SDK
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const transport = new SSEClientTransport(new URL('http://localhost:9423/sse'));
const client = new Client({ name: 'web-app', version: '1.0' });
await client.connect(transport);

const result = await client.request(
  { method: 'tools/call', params: { name: 'search_jobs', arguments: { searchTerm: 'engineer', siteNames: 'indeed', resultsWanted: 10, offset: 0 } } },
  resultSchema
);
```

### Available Tools

#### search_jobs

Searches exactly one job source per call. To search several sources, call the tool separately for each source.

MCP arguments use camelCase. The direct `/api` endpoint also accepts snake_case and normalizes it to camelCase.

**Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| siteNames | string or one-item array | **Required. Exactly one of:** indeed, linkedin, zip_recruiter, glassdoor, google, bayt, naukri | — |
| searchTerm | string | Job title or keywords | "software engineer" |
| location | string | Location for job search | "remote" |
| googleSearchTerm | string | Optional Google-specific query | null |
| resultsWanted | integer | Page size for the selected source (1-10) | 10 |
| hoursOld | integer | Optional maximum job age; see filter restrictions below | null |
| countryIndeed | string | Country for Indeed and Glassdoor | "USA" |
| withDescription | boolean | Fetch LinkedIn descriptions; set false to opt out | true |
| linkedinFetchDescription | boolean | Deprecated alias for withDescription | true |
| format | string | MCP output format; only `json` is accepted | "json" |
| distance | integer | Search radius in miles (0-500) | 50 |
| jobType | string | fulltime, parttime, internship, contract | null |
| isRemote | boolean | Remote jobs only | false |
| easyApply | boolean | Jobs hosted on the board site | false |
| offset | integer | Zero-based offset for supported sources | 0 |
| verbose | integer | 0=errors, 1=warnings, 2=all logs | 0 |
| linkedinCompanyIds | string | Comma-separated LinkedIn company IDs | null |
| enforceAnnualSalary | boolean | Convert wages to annual salary | false |
| descriptionFormat | string | markdown or html | "markdown" |
| proxies | string | Comma-separated proxy list | null |
| caCert | string | CA cert path for proxies | null |
| timeout | integer | Search timeout in ms (1000-120000) | 120000 |

**Pagination:** begin with `offset: 0`. If the response has `hasMore: true`, repeat the same source and filters with its `nextOffset`. Stop when `hasMore` is false. ZipRecruiter and Bayt only support `offset: 0`; pagination on other sources remains best-effort because JobSpy delegates to changing third-party job boards.

**Filter restrictions:** Indeed accepts only one of `hoursOld`, `easyApply`, or the `jobType`/`isRemote` group. LinkedIn does not accept `hoursOld` together with `easyApply`. Invalid combinations fail immediately with actionable guidance.

### Additional tools

- `extract_applicant_count(jobUrl)` returns `jobId`, `applicantCount`, `postedAgeHours`, and `isThreshold`.
- `get_greenhouse_jobs`, `get_lever_jobs`, `get_ashby_jobs`, `get_workable_jobs`, and `get_smartrecruiters_jobs` proxy public first-party job-board APIs into one stable shape.
- `store_upsert_job`, `store_mark_applied`, and `store_get_unapplied_for_company` provide cross-run job/apply memory.
- `store_update_profile_snapshot` SHA-256 hashes resume text and reports whether it changed.

LinkedIn search results are automatically enriched with applicant data. Page-fetch failures are isolated per job through `applicantFetchFailed`; missing requested descriptions use `descriptionFetchFailed`. Two empty searches with different terms open a persistent source/location circuit for the configured cooldown and subsequent calls return `skipped: true` without spawning JobSpy.

**Example usage with Claude:**

```
Find senior software engineer jobs in Boston posted in the last 24 hours. Search LinkedIn and Indeed separately and paginate each source without repeating an offset.
```

## Docker Compose

```bash
docker compose up -d          # start both services
docker compose logs -f        # tail logs
docker compose down           # stop
docker compose build          # rebuild after changes
```

## Development

```bash
npm run dev     # nodemon auto-restart
npm run lint    # ESLint
```

### Test

Run the automated checks:

```bash
npm test
npm run lint
```

## License

MIT
