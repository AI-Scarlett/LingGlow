#!/usr/bin/env node
// Explicitly opt-in only.  This file is intentionally excluded from npm test:
// it can quit and restart the locally installed Doubao after the operator has
// supplied both acknowledgement environment variables.
import fs from 'node:fs';
import {runDoubaoIsolatedQa} from '../src/doubao-isolated-qa.mjs';

const snapshot = JSON.parse(fs.readFileSync(
  new URL('../qa/doubao-static-2.19.9.json', import.meta.url),
  'utf8',
));

const evidence = await runDoubaoIsolatedQa({staticSnapshot: snapshot});
console.log(JSON.stringify(evidence));
