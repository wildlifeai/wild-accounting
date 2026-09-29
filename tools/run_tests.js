/**
 * run_tests.js
 * Runs dashboard/Tests.js headlessly under Node, so the suite is available to CI and to
 * anyone without the Apps Script IDE open.
 *
 * Tests.js is the canonical copy and runs unchanged in the IDE via Run > runTests. This
 * only supplies the globals Apps Script provides for free: the files share one scope
 * there, and Logger exists. Nothing here stubs Drive or Xero, because nothing in the
 * suite touches them, which is the property that makes it worth running on every push.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DASH = path.join(__dirname, '..', 'dashboard');

// Apps Script has no modules: every file shares one global scope. `const CONFIG = {...}`
// at the top level of one file is visible to all the others. Under Node each eval'd
// string gets its own scope, so those two declarations are promoted to globals by hand.
const ORDER = ['Config.js', 'ForecastEngine.js', 'Permissions.js', 'BudgetReader.js',
  'XeroClient.js', 'HealthCheck.js', 'TrackingBuilder.js', 'Aggregator.js',
  'WebApp.js', 'Snapshot.js', 'Tests.js'];

global.Logger = { log: () => {} };

let src = '';
ORDER.forEach(f => {
  const p = path.join(DASH, f);
  if (!fs.existsSync(p)) throw new Error('missing ' + f + '; update ORDER in run_tests.js');
  src += '\n// ==== ' + f + '\n' + fs.readFileSync(p, 'utf8')
    .replace('const CONFIG =', 'global.CONFIG =')
    .replace('const HEALTH_CATALOGUE =', 'global.HEALTH_CATALOGUE =');
});

// Indirect eval, not eval(): under 'use strict' a direct eval gets its own scope and the
// function declarations never escape it. Apps Script has no such isolation, so this is
// also the more faithful simulation.
(0, eval)(src);

const runTests = global.runTests;
if (typeof runTests !== 'function') throw new Error('runTests() not found in Tests.js');
const results = runTests();
const failed = results.filter(r => r.indexOf('FAIL') === 0);

failed.forEach(r => console.log(r));
console.log((results.length - failed.length) + '/' + results.length + ' passed');
process.exitCode = failed.length ? 1 : 0;
