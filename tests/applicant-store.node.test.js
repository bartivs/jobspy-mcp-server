import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  extractApplicantCountHandler,
  extractLinkedInJobId,
  parseApplicantPage,
} from '../src/tools/applicant-count.js';
import { JobStore } from '../src/state/store.js';
import {
  storeGetUnappliedForCompanyHandler,
  storeMarkAppliedHandler,
  storeUpdateProfileSnapshotHandler,
  storeUpsertJobHandler,
} from '../src/tools/store.js';

test('applicant parser handles exact counts, thresholds, IDs, and age', () => {
  const exact = parseApplicantPage(
    '<meta content="Backend role · 1,234 applicants"><div>Posted 2 days ago</div>',
    'https://www.linkedin.com/jobs/view/backend-engineer-987654/',
  );
  const threshold = parseApplicantPage(
    '<div>Be among the first 25 applicants</div><div>18 minutes ago</div>',
    'https://linkedin.com/jobs/search/?currentJobId=123',
  );

  assert.equal(extractLinkedInJobId('https://linkedin.com/jobs/view/test-55'), '55');
  assert.deepEqual(exact, {
    jobId: '987654', applicantCount: 1234, postedAgeHours: 48, isThreshold: false,
  });
  assert.deepEqual(threshold, {
    jobId: '123', applicantCount: 25, postedAgeHours: 0.3, isThreshold: true,
  });
});

test('applicant extraction caches LinkedIn page results', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobspy-store-'));
  const store = new JobStore(path.join(dir, 'state.json'));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('<div>7 applicants</div><div>1 hour ago</div>');
  };
  try {
    const params = { jobUrl: 'https://linkedin.com/jobs/view/444', timeout: 1000 };
    const first = await extractApplicantCountHandler(params, { store, fetchImpl });
    const second = await extractApplicantCountHandler(params, { store, fetchImpl });
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(second.applicantCount, 7);
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('persistent store tracks jobs, applications, and resume changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobspy-store-'));
  const filePath = path.join(dir, 'state.json');
  const store = new JobStore(filePath);
  try {
    storeUpsertJobHandler({
      jobId: 'job-1', url: 'https://example.test/1', company: 'Acme', role: 'Engineer', applicantCount: 4,
    }, { store });
    storeUpsertJobHandler({
      jobId: 'job-2', url: 'https://example.test/2', company: 'Acme', role: 'SRE', applicantCount: null,
    }, { store });
    storeMarkAppliedHandler({ jobId: 'job-1', channel: 'company-site', appliedAt: '2026-01-01T00:00:00.000Z' }, { store });

    const reloaded = new JobStore(filePath);
    const unapplied = storeGetUnappliedForCompanyHandler({ company: 'acme' }, { store: reloaded });
    assert.deepEqual(unapplied.map((job) => job.jobId), ['job-2']);
    assert.equal(reloaded.state.applyLog.length, 1);
    assert.equal(reloaded.state.jobsSeen['job-1'].applicantCountAtFirstSeen, 4);

    const initial = storeUpdateProfileSnapshotHandler({ rawText: 'Python', topSkills: ['Python'] }, { store: reloaded });
    const unchanged = storeUpdateProfileSnapshotHandler({ rawText: 'Python', topSkills: ['Python'] }, { store: reloaded });
    const changed = storeUpdateProfileSnapshotHandler({ rawText: 'Python and Go', topSkills: ['Python', 'Go'] }, { store: reloaded });
    assert.equal(initial.changed, true);
    assert.equal(unchanged.changed, false);
    assert.equal(changed.changed, true);
    assert.notEqual(changed.snapshot.rawTextHash, initial.snapshot.rawTextHash);
    assert.equal(changed.snapshot.rawTextHash.length, 64);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
