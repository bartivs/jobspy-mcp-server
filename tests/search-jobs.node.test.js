import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
      }),
    );

    assert.equal(result.count, 1);
    assert.equal(result.jobs[0].site, 'indeed');
    assert.equal(result.jobs[0].jobUrl, 'https://example.com/job');
    assert.equal(result.jobs[0].datePosted, '2024-09-04T16:00:00.000Z');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
