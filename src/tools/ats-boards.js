import { z } from 'zod';

import { fetchJson } from '../http.js';

function asArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(String);
  }
  return value ? [String(value)] : [];
}

function asIsoDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asLocation(value) {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.fullLocation || value.location_str || value.name || value.city || '';
}

function normalizedJob({ id, title, company, location, url, createdAt, departments, description, provider }) {
  return {
    id: String(id),
    title: title || '',
    company: company || '',
    location: asLocation(location),
    url,
    createdAt: asIsoDate(createdAt),
    departments: asArray(departments),
    // Keep the cross-provider contract's documented field name.
    // eslint-disable-next-line camelcase
    absolute_url: url,
    description: description || null,
    provider,
  };
}

function requireArray(value, provider) {
  if (!Array.isArray(value)) {
    throw new Error(`${provider} returned an unexpected response shape`);
  }
  return value;
}

export async function getGreenhouseJobsHandler({ token, content = true }, dependencies = {}) {
  const query = new URLSearchParams({ content: String(content) });
  const payload = await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?${query}`,
    {},
    15000,
    dependencies.fetchImpl,
  );
  return requireArray(payload.jobs, 'Greenhouse').map((job) => normalizedJob({
    id: job.id,
    title: job.title,
    company: payload.name || token,
    location: job.location?.name,
    url: job.absolute_url,
    createdAt: job.updated_at,
    departments: job.departments?.map((item) => item.name),
    description: content ? job.content : null,
    provider: 'greenhouse',
  }));
}

export async function getLeverJobsHandler({ company, mode = 'json' }, dependencies = {}) {
  const payload = await fetchJson(
    `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=${encodeURIComponent(mode)}`,
    {},
    15000,
    dependencies.fetchImpl,
  );
  return requireArray(payload, 'Lever').map((job) => normalizedJob({
    id: job.id,
    title: job.text,
    company,
    location: job.categories?.location,
    url: job.hostedUrl || job.applyUrl,
    createdAt: job.createdAt,
    departments: [job.categories?.department, job.categories?.team],
    description: job.descriptionPlain || job.description,
    provider: 'lever',
  }));
}

export async function getAshbyJobsHandler({ company }, dependencies = {}) {
  const payload = await fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}`,
    {},
    15000,
    dependencies.fetchImpl,
  );
  return requireArray(payload.jobs, 'Ashby').map((job) => normalizedJob({
    id: job.id || job.jobUrl,
    title: job.title,
    company: payload.organizationName || company,
    location: job.location,
    url: job.jobUrl || job.applyUrl,
    createdAt: job.publishedAt,
    departments: job.department,
    description: job.descriptionPlain || job.descriptionHtml,
    provider: 'ashby',
  }));
}

export async function getWorkableJobsHandler({ subdomain }, dependencies = {}) {
  const payload = await fetchJson(
    `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(subdomain)}/jobs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }),
    },
    15000,
    dependencies.fetchImpl,
  );
  const jobs = payload.results || payload.jobs;
  return requireArray(jobs, 'Workable').map((job) => {
    const url = job.url || `https://apply.workable.com/${subdomain}/j/${job.shortcode || job.id}/`;
    return normalizedJob({
      id: job.id || job.shortcode,
      title: job.title,
      company: payload.name || subdomain,
      location: job.location?.location_str || job.location?.city || job.location,
      url,
      createdAt: job.published || job.created_at,
      departments: job.department ? [job.department] : job.departments,
      description: job.description,
      provider: 'workable',
    });
  });
}

export async function getSmartRecruitersJobsHandler({ companyId }, dependencies = {}) {
  const payload = await fetchJson(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings?limit=100`,
    {},
    15000,
    dependencies.fetchImpl,
  );
  return requireArray(payload.content, 'SmartRecruiters').map((job) => {
    const url = job.ref || `https://jobs.smartrecruiters.com/${companyId}/${job.id}`;
    return normalizedJob({
      id: job.id,
      title: job.name,
      company: job.company?.name || companyId,
      location: job.location?.fullLocation || [job.location?.city, job.location?.country].filter(Boolean).join(', '),
      url,
      createdAt: job.releasedDate,
      departments: job.department?.label || job.function?.label,
      provider: 'smartrecruiters',
    });
  });
}

function boardTool(server, name, description, schema, handler) {
  return server.tool(name, description, schema, async (params) => {
    try {
      const jobs = await handler(params);
      return { content: [{ type: 'text', text: JSON.stringify({ count: jobs.length, jobs }, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
}

export function atsBoardTools(server) {
  boardTool(server, 'get_greenhouse_jobs', 'List jobs from a public Greenhouse board.', {
    token: z.string().min(1),
    content: z.boolean().default(true),
  }, getGreenhouseJobsHandler);
  boardTool(server, 'get_lever_jobs', 'List jobs from a public Lever board.', {
    company: z.string().min(1),
    mode: z.literal('json').default('json'),
  }, getLeverJobsHandler);
  boardTool(server, 'get_ashby_jobs', 'List jobs from a public Ashby board.', {
    company: z.string().min(1),
  }, getAshbyJobsHandler);
  boardTool(server, 'get_workable_jobs', 'List jobs from a public Workable board.', {
    subdomain: z.string().min(1),
  }, getWorkableJobsHandler);
  boardTool(server, 'get_smartrecruiters_jobs', 'List jobs from a public SmartRecruiters board.', {
    companyId: z.string().min(1),
  }, getSmartRecruitersJobsHandler);
}
