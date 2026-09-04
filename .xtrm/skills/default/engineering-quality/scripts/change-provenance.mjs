#!/usr/bin/env node
// Deterministic, read-only Git provenance collector for causal debugging.
// It deliberately does NOT choose a culprit: it returns candidate change evidence for
// the reasoning layer to correlate with runtime/code-path evidence.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

function usage(message) {
  if (message) console.error(message);
  console.error(`Usage:
  change-provenance.mjs [--repo <path>] [--path <repo-path>] [--since <git-date>] [--until <git-date>] [--max <n>]
  change-provenance.mjs [--repo <path>] --sha <commit>

Outputs JSON. Requires only git.`);
  process.exit(message ? 64 : 0);
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), max: 40 };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const take = () => {
      const next = argv[++i];
      if (!next) usage(`missing value after ${value}`);
      return next;
    };
    if (value === '--help' || value === '-h') usage();
    else if (value === '--repo') args.repo = take();
    else if (value === '--path') args.path = take();
    else if (value === '--since') args.since = take();
    else if (value === '--until') args.until = take();
    else if (value === '--max') args.max = Number(take());
    else if (value === '--sha') args.sha = take();
    else usage(`unknown argument: ${value}`);
  }
  if (!Number.isInteger(args.max) || args.max < 1 || args.max > 500) usage('--max must be an integer from 1 to 500');
  if (args.sha && (args.since || args.until || args.path)) usage('--sha cannot be combined with --since/--until/--path');
  return args;
}

function git(repo, args, options = {}) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 << 20,
      ...options,
    }).trimEnd();
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }
}

function metadata(repo, sha) {
  const field = (format) => git(repo, ['show', '-s', `--format=${format}`, sha]);
  const nameStatus = git(repo, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', sha]);
  const files = nameStatus
    ? nameStatus.split('\n').filter(Boolean).map((line) => {
        const parts = line.split('\t');
        const status = parts[0];
        if (status.startsWith('R') || status.startsWith('C')) {
          return { status, from: parts[1], path: parts[2] };
        }
        return { status, path: parts[1] };
      })
    : [];

  return {
    sha: field('%H'),
    parents: field('%P').split(/\s+/).filter(Boolean),
    author: { name: field('%an'), email: field('%ae') },
    authored_at: field('%aI'),
    committed_at: field('%cI'),
    subject: field('%s'),
    body: field('%B'),
    files,
  };
}

const args = parseArgs(process.argv.slice(2));
const repo = git(args.repo, ['rev-parse', '--show-toplevel']);
const head = git(repo, ['rev-parse', 'HEAD']);

let shas;
if (args.sha) {
  shas = [git(repo, ['rev-parse', `${args.sha}^{commit}`])];
} else {
  const logArgs = ['log', `--max-count=${args.max}`, '--format=%H'];
  if (args.since) logArgs.push(`--since=${args.since}`);
  if (args.until) logArgs.push(`--until=${args.until}`);
  if (args.path) logArgs.push('--', args.path);
  const output = git(repo, logArgs);
  shas = output ? output.split('\n').filter(Boolean) : [];
}

const result = {
  schema_version: 1,
  repo,
  observed_head: head,
  query: {
    ...(args.sha ? { sha: args.sha } : {}),
    ...(args.path ? { path: args.path } : {}),
    ...(args.since ? { since: args.since } : {}),
    ...(args.until ? { until: args.until } : {}),
    ...(!args.sha ? { max: args.max } : {}),
  },
  commits: shas.map((sha) => metadata(repo, sha)),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
