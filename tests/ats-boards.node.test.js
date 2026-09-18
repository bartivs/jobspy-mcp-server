import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAshbyJobsHandler,
  getGreenhouseJobsHandler,
  getLeverJobsHandler,
  getSmartRecruitersJobsHandler,
  getWorkableJobsHandler,
} from '../src/tools/ats-boards.js';

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('first-party ATS handlers normalize provider responses', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('greenhouse')) {
      /* eslint-disable camelcase */
      return jsonResponse({
        name: 'Green Co',
        jobs: [{
          id: 1,
          title: 'Engineer',
          absolute_url: 'https://green/1',
          updated_at: '2026-01-02T00:00:00Z',
          location: { name: 'Remote' },
          departments: [{ name: 'R&D' }],
          content: 'Build',
        }],
      });
      /* eslint-enable camelcase */
    }
    if (String(url).includes('lever')) {
      return jsonResponse([{
        id: 'lev-1',
        text: 'SRE',
        hostedUrl: 'https://lever/1',
        createdAt: 1767312000000,
        categories: { location: 'LATAM', department: 'Engineering' },
        descriptionPlain: 'Operate',
      }]);
    }
    if (String(url).includes('ashby')) {
      return jsonResponse({
        organizationName: 'Ash Co',
        jobs: [{
          id: 'ash-1',
          title: 'Dev',
          location: 'Remote',
          jobUrl: 'https://ashby/1',
          publishedAt: '2026-01-02T00:00:00Z',
          department: 'Product',
        }],
      });
    }
    if (String(url).includes('workable')) {
      /* eslint-disable camelcase */
      return jsonResponse({
        name: 'Work Co',
        results: [{
          id: 'work-1',
          title: 'QA',
          url: 'https://work/1',
          published: '2026-01-02T00:00:00Z',
          location: { location_str: 'Asunción' },
          department: 'Quality',
        }],
      });
      /* eslint-enable camelcase */
    }
    return jsonResponse({
      content: [{
        id: 'smart-1',
        name: 'Lead',
        ref: 'https://smart/1',
        releasedDate: '2026-01-02T00:00:00Z',
        company: { name: 'Smart Co' },
        location: { fullLocation: 'Remote' },
        department: { label: 'Engineering' },
      }],
    });
  };

  const [greenhouse, lever, ashby, workable, smart] = await Promise.all([
    getGreenhouseJobsHandler({ token: 'green', content: true }, { fetchImpl }),
    getLeverJobsHandler({ company: 'leverco' }, { fetchImpl }),
    getAshbyJobsHandler({ company: 'ashco' }, { fetchImpl }),
    getWorkableJobsHandler({ subdomain: 'workco' }, { fetchImpl }),
    getSmartRecruitersJobsHandler({ companyId: 'smartco' }, { fetchImpl }),
  ]);

  for (const jobs of [greenhouse, lever, ashby, workable, smart]) {
    assert.equal(jobs.length, 1);
    assert.deepEqual(Object.keys(jobs[0]), [
      'id',
      'title',
      'company',
      'location',
      'url',
      'createdAt',
      'departments',
      'absolute_url',
      'description',
      'provider',
    ]);
    assert.equal(jobs[0].absolute_url, jobs[0].url);
  }
  assert.deepEqual(greenhouse[0].departments, ['R&D']);
  assert.equal(lever[0].createdAt, '2026-01-02T00:00:00.000Z');
  assert.equal(ashby[0].company, 'Ash Co');
  assert.equal(workable[0].location, 'Asunción');
  assert.equal(smart[0].provider, 'smartrecruiters');
  const workableRequest = requests.find((request) => request.url.includes('workable'));
  assert.equal(workableRequest.options.method, 'POST');
});
