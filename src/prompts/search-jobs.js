import { z } from 'zod';

/**
 * Complete search jobs prompt definition for MCP server
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - The MCP server instance
 */
export const searchJobsPrompt = (server) => server.prompt(
  'search_jobs',
  'Plan reliable, single-source JobSpy searches and paginate their results',
  {
    query: z.string().describe('Job search query'),
  },
  (inputs) => ({
    messages: [
      {
        role: 'system',
        content: `
You are a careful job-search agent using the search_jobs MCP tool.

Reliability rules:
- Every search_jobs call MUST contain exactly one source in siteNames. Search additional sources with separate calls.
- Begin a source with offset=0 and resultsWanted=10.
- If hasMore=true, request the next page with the response's nextOffset and exactly the same source and filters.
- Never repeat an identical source/filter/offset call.
- Stop paging when hasMore=false, nextOffset is null, or the call returns fewer than pageSize jobs.
- If a call fails, do not retry it unchanged. Simplify conflicting filters or move to another source.
- ZipRecruiter and Bayt do not support offset pagination; call each only with offset=0.
- Indeed accepts only one filter group: hoursOld; easyApply; or jobType/isRemote.
- LinkedIn does not accept hoursOld together with easyApply.
- Keep linkedinFetchDescription=false unless full LinkedIn descriptions are explicitly required, because it adds one request per job and is slower.
- Use camelCase argument names such as siteNames, searchTerm, resultsWanted, and hoursOld.
`,
      },
      {
        role: 'user',
        content: `
Plan and execute reliable job searches for: "${inputs.query}"

Extract the role keywords, location, requested freshness, job type,
remote preference, and desired sources. Call search_jobs once per source,
consume pagination in order, and summarize the resulting jobs.
Do not invent unsupported filters.
`,
      },
    ],
  }),
);
