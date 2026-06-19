# JobSpy MCP Server

A Model Context Protocol (MCP) server that enables AI assistants like Claude to search for jobs across multiple job listing platforms using the [JobSpy](https://github.com/Bunsly/JobSpy) tool.

## Features

- Search for jobs across multiple platforms (Indeed, LinkedIn, Glassdoor, etc.)
- Filter by search terms, location, time frames, and more
- Get structured job data that AI models can easily process
- Format results as JSON or CSV
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

Defaults are in `.env` (committed).

## Usage

### Docker Compose (recommended for SSE)

```bash
docker compose up -d
```

The server listens on `http://localhost:9423`. The `jobspy-scraper` container stays alive and the Node server calls it on-demand via `docker run --rm jobspy` through the mounted Docker socket.

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

The `POST /api` endpoint bypasses the MCP protocol and returns results directly:

```bash
curl -X POST http://localhost:9423/api \
  -H "Content-Type: application/json" \
  -d '{
    "search_term": "software engineer",
    "location": "San Francisco, CA",
    "site_names": "indeed,linkedin",
    "results_wanted": 5
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
  { method: 'tools/call', params: { name: 'search_jobs', arguments: { search_term: 'engineer', site_names: 'indeed' } } },
  resultSchema
);
```

### Available Tools

#### search_jobs

Searches for jobs across various job listing websites.

**Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| site_names | string | Comma-separated list of sites (indeed,linkedin,zip_recruiter,glassdoor,google,bayt,naukri) | "indeed" |
| search_term | string | Search term for jobs | "software engineer" |
| location | string | Location for job search | "remote" |
| google_search_term | string | Google specific search term | null |
| results_wanted | integer | Number of results wanted | 20 |
| hours_old | integer | How many hours old jobs can be | 72 |
| country_indeed | string | Country for Indeed search | "USA" |
| linkedin_fetch_description | boolean | Fetch LinkedIn job descriptions (slower) | true |
| format | string | Output format (json or csv) | "json" |
| distance | integer | Search radius in miles | 50 |
| job_type | string | fulltime, parttime, internship, contract | null |
| is_remote | boolean | Remote jobs only | false |
| easy_apply | boolean | Jobs hosted on the board site | false |
| offset | integer | Search result offset | 0 |
| verbose | integer | 0=errors, 1=warnings, 2=all logs | 2 |
| linkedin_company_ids | string | Comma-separated LinkedIn company IDs | null |
| enforce_annual_salary | boolean | Convert wages to annual salary | false |
| description_format | string | markdown or html | "markdown" |
| proxies | string | Comma-separated proxy list | null |
| ca_cert | string | CA cert path for proxies | null |
| timeout | integer | Job search timeout in ms | 120000 |

**Example usage with Claude:**

```
I need to find senior software engineer jobs in Boston posted in the last 24 hours on both LinkedIn and Indeed.
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

### Test (curl)

The `POST /api` endpoint returns results directly (bypasses MCP):

```bash
curl -X POST http://localhost:9423/api \
  -H "Content-Type: application/json" \
  -d '{
    "search_term": "software engineer",
    "location": "San Francisco, CA",
    "site_names": "indeed,linkedin",
    "results_wanted": 5
  }'
```

> **Note**: `npm test` is a placeholder. The test file at `tests/jobSchema.test.js` uses CommonJS `require`/`describe` with no test framework configured and depends on an external `../../jobSpy/jobs.json` file.  

## License

MIT
