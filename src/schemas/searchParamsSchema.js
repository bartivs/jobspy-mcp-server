import { z } from 'zod';

const validSites = new Set([
  'indeed',
  'linkedin',
  'zip_recruiter',
  'glassdoor',
  'google',
  'bayt',
  'naukri',
]);

function normalizeSiteNames(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value.join(',') : value)
        .split(',')
        .map((site) => site.trim().toLowerCase().replace(/[\s-]+/g, '_'))
        .map((site) => (site === 'ziprecruiter' ? 'zip_recruiter' : site))
        .filter(Boolean),
    ),
  ];
}

export const searchParams = {
  siteNames: z
    .union([
      z
        .string()
        .describe(
          'Exactly one job source: indeed, linkedin, zip_recruiter (or ziprecruiter), glassdoor, google, bayt, or naukri. Never pass a comma-separated list.',
        ),
      z
        .array(z.string()).max(1)
        .describe(
          'Exactly one job source in a one-item array. Multiple sources are not allowed; call search_jobs separately for each source.',
        ),
    ])
    .transform(normalizeSiteNames)
    .refine((sites) => sites.length === 1, {
      message:
        'Exactly one site is required per search_jobs call. Call the tool separately for each source.',
    })
    .refine((sites) => sites.every((site) => validSites.has(site)), {
      message:
        'Invalid site name. Allowed values: indeed, linkedin, zip_recruiter, glassdoor, google, bayt, naukri',
    })
    .transform(([site]) => site),
  searchTerm: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('Job title or keywords for this single-source search')
    .default('software engineer'),
  location: z
    .string()
    .trim()
    .max(200)
    .describe('Location for job search')
    .default('remote'),
  distance: z
    .number()
    .int()
    .min(0)
    .max(500)
    .describe('Distance in miles')
    .default(50),
  jobType: z
    .enum(['fulltime', 'parttime', 'internship', 'contract'])
    .nullable()
    .describe('Type of job')
    .default(null),
  googleSearchTerm: z
    .string()
    .nullable()
    .describe('Google specific search term')
    .default(null),
  resultsWanted: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe(
      'Page size for this one source (1-10). Start with 10; use nextOffset from the response for another page.',
    )
    .default(10),
  easyApply: z
    .boolean()
    .describe('Filter for jobs that are hosted on the job board site')
    .default(false),
  descriptionFormat: z
    .enum(['markdown', 'html'])
    .describe('Format type of the job descriptions')
    .default('markdown'),
  offset: z
    .number()
    .int()
    .min(0)
    .describe(
      'Zero-based source offset. Start at 0, then use nextOffset with unchanged source and filters. ZipRecruiter and Bayt do not support offsets above 0.',
    )
    .default(0),
  hoursOld: z
    .number()
    .int()
    .min(1)
    .nullable()
    .describe(
      'Optional maximum job age in hours. For Indeed, do not combine with easyApply, jobType, or isRemote. For LinkedIn, do not combine with easyApply.',
    )
    .default(null),
  verbose: z
    .number()
    .int()
    .min(0)
    .max(2)
    .describe(
      'Controls verbosity (0=errors only, 1=errors+warnings, 2=all logs)',
    )
    .default(0),
  countryIndeed: z
    .string()
    .describe('Country for Indeed search')
    .default('USA'),
  isRemote: z
    .any()
    .describe(
      'Whether to search for remote jobs only. Accepts any truthy value.',
    )
    .transform((val) => {
      // Convert any truthy value to boolean
      if (typeof val === 'string') {
        // For strings, check for common "true" values
        return ['true', 'yes', '1', 'on', 'y'].includes(val.toLowerCase());
      }
      // For other types, use Boolean conversion
      return Boolean(val);
    })
    .default(false),
  withDescription: z
    .boolean()
    .describe('Fetch LinkedIn descriptions. Defaults to true; set false for a faster search.')
    .default(true),
  linkedinFetchDescription: z
    .boolean()
    .describe(
      'Deprecated alias for withDescription. LinkedIn description fetching defaults to true.',
    )
    .default(true),
  linkedinCompanyIds: z
    .union([
      z.string().describe('Comma-separated list of LinkedIn company IDs'),
      z.array(z.number()).describe('Array of LinkedIn company IDs'),
    ])
    .nullable()
    .transform((val) => {
      if (typeof val === 'string') {
        return val;
      }
      if (Array.isArray(val)) {
        return val.join(',');
      }
      return val;
    })
    .default(null),
  enforceAnnualSalary: z
    .boolean()
    .describe('Converts wages to annual salary')
    .default(false),
  proxies: z
    .union([
      z.string().describe('Comma-separated list of proxies'),
      z.array(z.string()).describe('Array of proxies'),
    ])
    .nullable()
    .transform((val) => {
      if (typeof val === 'string') {
        return val;
      }
      if (Array.isArray(val)) {
        return val.join(',');
      }
      return val;
    })
    .default(null),
  caCert: z
    .string()
    .nullable()
    .describe('Path to CA Certificate file for proxies')
    .default(null),
  format: z
    .literal('json')
    .describe('MCP searches always return JSON')
    .default('json'),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(120000)
    .describe('Timeout in milliseconds for the job search process (1000-120000)')
    .default(120000),
};
