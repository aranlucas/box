/// <reference types="node" />

import { error } from 'node:console';
import process from 'node:process';

const [title, ...extraArgs] = process.argv.slice(2);
// These are the default types accepted by the GitHub PR title check.
const conventionalTitle =
  /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\(.*\))?!?: .*\S.*$/;

if (!title || extraArgs.length > 0 || conventionalTitle.exec(title)?.[0] !== title) {
  error('Use a Conventional Commit subject in the form type(scope): description.');
  error('Example: perf(app): speed up app lists and preference storage');
  error('Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert');
  process.exitCode = 1;
}
