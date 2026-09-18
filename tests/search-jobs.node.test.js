import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { searchParams } from '../src/schemas/searchParamsSchema.js';
import { JobStore } from '../src/state/store.js';
import {
  buildCommandArgs,
  searchJobsHandler,
} from '../src/tools/search-jobs.js';

async function withEnv(name, value, fn) {
  const oldValue = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    if (oldValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = oldValue;
    }
  }
}

function makeFakeDocker(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobspy-test-'));
  const script = path.join(dir, 'fake-docker.sh');
  fs.writeFileSync(script, body, { mode: 0o755 });
  return { dir, script };
}

test('siteNames requires and normalizes exactly one source', () => {
  const schema = z.object(searchParams);

  assert.equal(schema.parse({ siteNames: ['LinkedIn'] }).siteNames, 'linkedin');
  assert.equal(schema.parse({ siteNames: 'ZipRecruiter' }).siteNames, 'zip_recruiter');
  assert.throws(
    () => schema.parse({ siteNames: 'indeed,linkedin' }),
    /Exactly one site is required/,
  );
  assert.throws(() => schema.parse({ siteNames: 'monster' }), /Invalid site name/);
  assert.throws(() => schema.parse({}), /Required/);
});

test('search schema uses bounded request-saving defaults', () => {
  const schema = z.object(searchParams);
  const parsed = schema.parse({ siteNames: 'indeed' });

  assert.equal(parsed.resultsWanted, 10);
  assert.equal(parsed.offset, 0);
  assert.equal(parsed.hoursOld, null);
  assert.equal(parsed.withDescription, true);
  assert.equal(parsed.linkedinFetchDescription, true);
  assert.equal(schema.parse({ siteNames: 'linkedin', withDescription: false }).withDescription, false);
  assert.equal(parsed.verbose, 0);
  assert.equal(parsed.format, 'json');
  assert.throws(
    () => z.object(searchParams).parse({ siteNames: 'indeed', resultsWanted: 11 }),
    /less than or equal to 10/,
  );
});

test('buildCommandArgs keeps multi-word values as single argv entries', () => {
  const args = buildCommandArgs({
    siteNames: 'indeed,linkedin',
    searchTerm: 'python ai',
    location: 'remote',
    countryIndeed: 'USA',
    format: 'json',
  });

  assert.deepEqual(args, [
    '--site_name',
    'indeed,linkedin',
    '--search_term',
    'python ai',
    '--location',
    'remote',
    '--country_indeed',
    'USA',
    '--format',
    'json',
  ]);
  assert.equal(args.some((arg) => arg.includes('"')), false);
  assert.ok(buildCommandArgs({ linkedinFetchDescription: true }).includes('--linkedin_fetch_description'));
  assert.equal(buildCommandArgs({ linkedinFetchDescription: false }).includes('--linkedin_fetch_description'), false);
});

test('searchJobsHandler returns parsed jobs from child stdout', async () => {
  const { dir, script } = makeFakeDocker(`#!/bin/sh
printf '%s\n' '[{"site":"indeed","job_url":"https://example.com/job","date_posted":1725465600000}]'
`);

  try {
    const result = await withEnv('DOCKER_CMD', script, () =>
      searchJobsHandler({
        siteNames: 'indeed',
        searchTerm: 'python ai',
        location: 'remote',
        resultsWanted: 1,
        timeout: 1000,
      }, { store: new JobStore(path.join(dir, 'state.json')) }),
    );

    assert.equal(result.count, 1);
    assert.equal(result.source, 'indeed');
    assert.equal(result.offset, 0);
    assert.equal(result.pageSize, 1);
    assert.equal(result.returned, 1);
    assert.equal(result.paginationSupported, true);
    assert.equal(result.hasMore, true);
    assert.equal(result.nextOffset, 1);
    assert.equal(result.jobs[0].site, 'indeed');
    assert.equal(result.jobs[0].jobUrl, 'https://example.com/job');
    assert.equal(result.jobs[0].datePosted, '2024-09-04T16:00:00.000Z');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('LinkedIn descriptions and applicant counts are cached and failures are explicit', async () => {
  const { dir, script } = makeFakeDocker(`#!/bin/sh
COUNT_FILE="$0.count"
printf '%s\n' "$*" >> "$0.args"
if [ -f "$COUNT_FILE" ]; then
  printf '%s\n' '[{"site":"linkedin","job_url":"https://www.linkedin.com/jobs/view/backend-12345","title":"Engineer","company":"Acme","description":null}]'
else
  touch "$COUNT_FILE"
  printf '%s\n' '[{"site":"linkedin","job_url":"https://www.linkedin.com/jobs/view/backend-12345","title":"Engineer","company":"Acme","description":"Cached description"}]'
fi
`);
  const store = new JobStore(path.join(dir, 'state.json'));
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return new Response('<html>Be among the first 25 applicants · 3 hours ago</html>');
  };

  try {
    const first = await withEnv('DOCKER_CMD', script, () => searchJobsHandler({
      siteNames: 'linkedin',
      searchTerm: 'backend',
      location: 'remote',
      resultsWanted: 1,
      timeout: 1000,
    }, { store, fetchImpl }));
    const second = await withEnv('DOCKER_CMD', script, () => searchJobsHandler({
      siteNames: 'linkedin',
      searchTerm: 'platform',
      location: 'remote',
      resultsWanted: 1,
      timeout: 1000,
      withDescription: false,
    }, { store, fetchImpl }));

    assert.equal(first.jobs[0].descriptionFetchFailed, false);
    assert.equal(first.jobs[0].applicantCount, 25);
    assert.equal(first.jobs[0].isApplicantThreshold, true);
    assert.equal(second.jobs[0].description, 'Cached description');
    assert.equal(second.jobs[0].descriptionFetchFailed, false);
    assert.equal(fetchCalls, 1);
    const commandLines = fs.readFileSync(`${script}.args`, 'utf8').trim().split('\n');
    assert.match(commandLines[0], /--linkedin_fetch_description/);
    assert.doesNotMatch(commandLines[1], /--linkedin_fetch_description/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing requested LinkedIn description is flagged without failing the search', async () => {
  const { dir, script } = makeFakeDocker(`#!/bin/sh
printf '%s\n' '[{"site":"linkedin","job_url":"https://linkedin.com/jobs/view/999","description":null}]'
`);
  const store = new JobStore(path.join(dir, 'state.json'));
  try {
    const result = await withEnv('JOBSPY_AUTO_ENRICH_APPLICANTS', 'false', () => withEnv(
      'DOCKER_CMD',
      script,
      () => searchJobsHandler({
        siteNames: 'linkedin', searchTerm: 'backend', location: 'remote', timeout: 1000,
      }, { store }),
    ));
    assert.equal(result.jobs[0].description, null);
    assert.equal(result.jobs[0].descriptionFetchFailed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty-result circuit opens after two distinct terms and persists', async () => {
  const { dir, script } = makeFakeDocker(`#!/bin/sh
printf '%s\n' '[]'
`);
  const statePath = path.join(dir, 'state.json');
  const store = new JobStore(statePath);

  try {
    const first = await withEnv('DOCKER_CMD', script, () => searchJobsHandler({
      siteNames: 'glassdoor', searchTerm: 'python', location: 'Paraguay', timeout: 1000,
    }, { store }));
    const second = await withEnv('DOCKER_CMD', script, () => searchJobsHandler({
      siteNames: 'glassdoor', searchTerm: 'golang', location: 'Paraguay', timeout: 1000,
    }, { store }));
    const skipped = await searchJobsHandler({
      siteNames: 'glassdoor', searchTerm: 'java', location: 'Paraguay', timeout: 1000,
    }, { store: new JobStore(statePath) });

    assert.equal(first.circuitOpen, false);
    assert.equal(second.circuitOpen, true);
    assert.equal(second.throttleScore, 50);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.jobs.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('searchJobsHandler rejects unsupported or conflicting pagination before spawning', async () => {
  await assert.rejects(
    () => searchJobsHandler({
      siteNames: 'zip_recruiter',
      searchTerm: 'engineer',
      offset: 10,
    }),
    /does not support offset pagination/,
  );
  await assert.rejects(
    () => searchJobsHandler({
      siteNames: 'indeed',
      searchTerm: 'engineer',
      hoursOld: 24,
      isRemote: true,
    }),
    /Indeed accepts only one filter group/,
  );
  await assert.rejects(
    () => searchJobsHandler({
      siteNames: 'linkedin',
      searchTerm: 'engineer',
      hoursOld: 24,
      easyApply: true,
    }),
    /LinkedIn does not support hoursOld and easyApply together/,
  );
});

test('searchJobsHandler surfaces stderr and exit code on child failure', async () => {
  const { dir, script } = makeFakeDocker(`#!/bin/sh
printf '%s\n' 'ExceptionGroup: unhandled errors in a TaskGroup (1 sub-exception)' >&2
printf '%s\n' 'inner: linkedin returned 999' >&2
exit 1
`);

  try {
    let error;
    try {
      await withEnv('DOCKER_CMD', script, () =>
        searchJobsHandler({
          siteNames: 'linkedin',
          searchTerm: 'python ai',
          location: 'remote',
          resultsWanted: 1,
          timeout: 1000,
        }),
      );
    } catch (caught) {
      error = caught;
    }

    assert.ok(error instanceof Error);
    assert.match(error.message, /JobSpy process failed \(exit 1\)/);
    assert.match(error.message, /stderr: ExceptionGroup/);
    assert.match(error.message, /inner: linkedin returned 999/);
    assert.match(error.message, /hint: JobSpy raised an ExceptionGroup/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
