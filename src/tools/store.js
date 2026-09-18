import { z } from 'zod';

import { getJobStore } from '../state/store.js';

export function storeUpsertJobHandler(params, dependencies = {}) {
  return (dependencies.store || getJobStore()).upsertJob(params);
}

export function storeMarkAppliedHandler(params, dependencies = {}) {
  return (dependencies.store || getJobStore()).markApplied(
    params.jobId,
    params.channel,
    params.appliedAt,
  );
}

export function storeGetUnappliedForCompanyHandler(params, dependencies = {}) {
  return (dependencies.store || getJobStore()).getUnappliedForCompany(params.company);
}

export function storeUpdateProfileSnapshotHandler(params, dependencies = {}) {
  return (dependencies.store || getJobStore()).updateProfileSnapshot(params);
}

function jsonTool(server, name, description, schema, handler) {
  return server.tool(name, description, schema, async (params) => {
    try {
      const result = await handler(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
}

export function storeTools(server) {
  jsonTool(server, 'store_upsert_job', 'Persist a seen job and return its first/last-seen state.', {
    jobId: z.string().min(1),
    url: z.string().url(),
    company: z.string().min(1),
    role: z.string().min(1),
    applicantCount: z.number().int().min(0).nullable().default(null),
  }, storeUpsertJobHandler);
  jsonTool(server, 'store_mark_applied', 'Mark a persisted job as applied and append its apply log.', {
    jobId: z.string().min(1),
    channel: z.string().min(1).default('unknown'),
    appliedAt: z.string().datetime().optional(),
  }, storeMarkAppliedHandler);
  jsonTool(server, 'store_get_unapplied_for_company', 'Return seen, unapplied jobs for one company.', {
    company: z.string().min(1),
  }, storeGetUnappliedForCompanyHandler);
  jsonTool(server, 'store_update_profile_snapshot', 'Hash resume text and report whether the candidate profile changed.', {
    resumeUrl: z.string().url().nullable().default(null),
    rawText: z.string().min(1),
    topSkills: z.array(z.string()).default([]),
  }, storeUpdateProfileSnapshotHandler);
}
