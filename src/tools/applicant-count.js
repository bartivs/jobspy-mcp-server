import { z } from 'zod';

import { fetchWithTimeout } from '../http.js';
import { getJobStore } from '../state/store.js';

export function extractLinkedInJobId(jobUrl) {
  try {
    const url = new URL(jobUrl);
    const pathMatch = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)(?:\/|$)/i);
    return pathMatch?.[1] || url.searchParams.get('currentJobId') || url.searchParams.get('jobId');
  } catch {
    return String(jobUrl).match(/(?:currentJobId=|\/jobs\/view\/(?:[^/]*-)?)(\d+)/i)?.[1] || null;
  }
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ');
}

function parseNumber(value) {
  return Number(String(value).replace(/,/g, ''));
}

export function parseApplicantPage(html, jobUrl, now = Date.now()) {
  const metadata = Array.from(String(html).matchAll(/\bcontent=["']([^"']+)["']/gi))
    .map((match) => match[1])
    .join(' ');
  const text = decodeHtml(`${html} ${metadata}`);
  const thresholdMatch = text.match(/be\s+among\s+the\s+first\s+([\d,]+)\s+applicants?/i);
  let exactMatch = null;
  const applicantPattern = /([\d,]+)\s+applicants?/gi;
  for (const match of text.matchAll(applicantPattern)) {
    const prefix = text.slice(Math.max(0, match.index - 30), match.index).toLowerCase();
    if (!/first\s*$/.test(prefix)) {
      exactMatch = match;
      break;
    }
  }

  let applicantCount = null;
  let isThreshold = false;
  if (exactMatch) {
    applicantCount = parseNumber(exactMatch[1]);
  } else if (thresholdMatch) {
    applicantCount = parseNumber(thresholdMatch[1]);
    isThreshold = true;
  }

  let postedAgeHours = null;
  const ageMatch = text.match(/(?:posted\s+)?(\d+)\s+(minute|hour|day|week)s?\s+ago/i);
  if (ageMatch) {
    const multipliers = { minute: 1 / 60, hour: 1, day: 24, week: 168 };
    postedAgeHours = Math.round(parseNumber(ageMatch[1]) * multipliers[ageMatch[2].toLowerCase()] * 100) / 100;
  } else if (/\bjust now\b/i.test(text)) {
    postedAgeHours = 0;
  } else {
    const dateMatch = html.match(/(?:datePosted|date-posted)["']?\s*(?:content|:|=)\s*["']([^"']+)/i);
    if (dateMatch && !Number.isNaN(Date.parse(dateMatch[1]))) {
      postedAgeHours = Math.max(0, Math.round(((now - Date.parse(dateMatch[1])) / 3600000) * 100) / 100);
    }
  }

  return {
    jobId: extractLinkedInJobId(jobUrl),
    applicantCount,
    postedAgeHours,
    isThreshold,
  };
}

export async function extractApplicantCountHandler({ jobUrl, timeout = 15000 }, dependencies = {}) {
  const store = dependencies.store || getJobStore();
  const jobId = extractLinkedInJobId(jobUrl);
  const cached = jobId ? store.getApplicant(jobId) : null;
  if (cached) {
    return { ...cached, cached: true };
  }

  const response = await fetchWithTimeout(
    jobUrl,
    { headers: { accept: 'text/html,application/xhtml+xml' } },
    timeout,
    dependencies.fetchImpl,
  );
  const parsed = parseApplicantPage(await response.text(), jobUrl, dependencies.now?.() || Date.now());
  if (jobId) {
    store.setApplicant(jobId, parsed);
  }
  return { ...parsed, cached: false };
}

export const extractApplicantCountTool = (server) => server.tool(
  'extract_applicant_count',
  'Extract LinkedIn applicant count/threshold and posting age. Returns null values when LinkedIn does not expose them.',
  {
    jobUrl: z.string().url().describe('LinkedIn job URL'),
    timeout: z.number().int().min(1000).max(30000).default(15000),
  },
  async (params) => {
    try {
      const result = await extractApplicantCountHandler(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  },
);
