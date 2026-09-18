import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STATE_PATH = process.env.JOBSPY_STATE_PATH || path.resolve('data/jobspy-state.json');
const DESCRIPTION_TTL_MS = 6 * 60 * 60 * 1000;
const APPLICANT_TTL_MS = 6 * 60 * 60 * 1000;

function emptyState() {
  return {
    version: 1,
    jobsSeen: {},
    sourceThrottle: {},
    candidateProfileSnapshot: null,
    applyLog: [],
    descriptionCache: {},
    applicantCache: {},
  };
}

function normalizeState(value) {
  const initial = emptyState();
  if (!value || typeof value !== 'object') {
    return initial;
  }
  return {
    ...initial,
    ...value,
    jobsSeen: value.jobsSeen || {},
    sourceThrottle: value.sourceThrottle || {},
    applyLog: Array.isArray(value.applyLog) ? value.applyLog : [],
    descriptionCache: value.descriptionCache || {},
    applicantCache: value.applicantCache || {},
  };
}

function isoNow(now) {
  return new Date(now).toISOString();
}

export function normalizeLocationKey(location) {
  return String(location || 'remote').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeSearchTerm(term) {
  return String(term || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export class JobStore {
  constructor(filePath = DEFAULT_STATE_PATH) {
    this.filePath = filePath;
    this.state = this.#read();
  }

  #read() {
    try {
      return normalizeState(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Unable to read JobSpy state ${this.filePath}: ${error.message}`);
      }
      return emptyState();
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  reload() {
    this.state = this.#read();
    return this;
  }

  getDescription(jobId, now = Date.now()) {
    const cached = this.state.descriptionCache[jobId];
    if (!cached || cached.expiresAt <= now) {
      return null;
    }
    return cached.description;
  }

  setDescription(jobId, description, now = Date.now(), ttlMs = DESCRIPTION_TTL_MS) {
    if (!jobId || !description) {
      return;
    }
    this.state.descriptionCache[jobId] = { description, expiresAt: now + ttlMs };
    this.#save();
  }

  getApplicant(jobId, now = Date.now()) {
    const cached = this.state.applicantCache[jobId];
    if (!cached || cached.expiresAt <= now) {
      return null;
    }
    return cached.value;
  }

  setApplicant(jobId, value, now = Date.now(), ttlMs = APPLICANT_TTL_MS) {
    if (!jobId) {
      return;
    }
    this.state.applicantCache[jobId] = { value, expiresAt: now + ttlMs };
    this.#save();
  }

  throttleKey(source, location) {
    return `${source}::${normalizeLocationKey(location)}`;
  }

  getThrottle(source, location) {
    return this.state.sourceThrottle[this.throttleKey(source, location)] || null;
  }

  shouldSkipSource(source, location, now = Date.now()) {
    const entry = this.getThrottle(source, location);
    return Boolean(entry?.openUntil && Date.parse(entry.openUntil) > now);
  }

  recordSourceResult({ source, location, searchTerm, count, now = Date.now(), cooldownMs = 6 * 60 * 60 * 1000 }) {
    const key = this.throttleKey(source, location);
    const term = normalizeSearchTerm(searchTerm);
    const previous = this.state.sourceThrottle[key] || {
      source,
      locationKey: normalizeLocationKey(location),
      throttleScore: 0,
      consecutiveEmpty: 0,
      lastEmptyTerm: null,
      openUntil: null,
    };
    const next = { ...previous, lastUpdated: isoNow(now) };

    if (count > 0) {
      next.consecutiveEmpty = 0;
      next.lastEmptyTerm = null;
      next.openUntil = null;
      next.throttleScore = Math.max(0, Number(next.throttleScore || 0) - 25);
    } else if (term && term !== previous.lastEmptyTerm) {
      next.consecutiveEmpty = Number(previous.consecutiveEmpty || 0) + 1;
      next.lastEmptyTerm = term;
      next.throttleScore = Math.min(100, Number(previous.throttleScore || 0) + 25);
      if (next.consecutiveEmpty >= 2) {
        next.openUntil = isoNow(now + cooldownMs);
      }
    }

    this.state.sourceThrottle[key] = next;
    this.#save();
    return next;
  }

  upsertJob(job, now = Date.now()) {
    if (!job.jobId) {
      throw new Error('jobId is required');
    }
    const timestamp = isoNow(now);
    const previous = this.state.jobsSeen[job.jobId] || {};
    const value = {
      ...previous,
      ...job,
      jobId: job.jobId,
      firstSeen: previous.firstSeen || timestamp,
      lastSeen: timestamp,
      applicantCountAtFirstSeen: previous.applicantCountAtFirstSeen ?? job.applicantCount ?? null,
      appliedAt: previous.appliedAt || job.appliedAt || null,
    };
    this.state.jobsSeen[job.jobId] = value;
    this.#save();
    return value;
  }

  markApplied(jobId, channel = 'unknown', appliedAt = new Date().toISOString()) {
    const job = this.state.jobsSeen[jobId];
    if (!job) {
      throw new Error(`Unknown jobId: ${jobId}`);
    }
    job.appliedAt = appliedAt;
    const entry = { jobId, appliedAt, channel, responseStatus: null, responseDate: null };
    this.state.applyLog.push(entry);
    this.#save();
    return entry;
  }

  getUnappliedForCompany(company) {
    const wanted = String(company).trim().toLowerCase();
    return Object.values(this.state.jobsSeen)
      .filter((job) => String(job.company || '').trim().toLowerCase() === wanted && !job.appliedAt)
      .sort((left, right) => String(right.firstSeen).localeCompare(String(left.firstSeen)));
  }

  updateProfileSnapshot({ resumeUrl = null, rawText, topSkills = [] }, now = Date.now()) {
    if (!String(rawText || '').trim()) {
      throw new Error('rawText is required');
    }
    const rawTextHash = crypto.createHash('sha256').update(rawText).digest('hex');
    const previous = this.state.candidateProfileSnapshot;
    const changed = !previous || previous.rawTextHash !== rawTextHash;
    const snapshot = {
      resumeUrl,
      fetchedAt: isoNow(now),
      rawTextHash,
      topSkills,
    };
    this.state.candidateProfileSnapshot = snapshot;
    this.#save();
    return { changed, previousHash: previous?.rawTextHash || null, snapshot };
  }
}

let singleton;
let singletonPath;

export function getJobStore() {
  const configuredPath = process.env.JOBSPY_STATE_PATH || DEFAULT_STATE_PATH;
  if (!singleton || singletonPath !== configuredPath) {
    singleton = new JobStore(configuredPath);
    singletonPath = configuredPath;
  }
  return singleton;
}
