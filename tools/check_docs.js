/**
 * check_docs.js
 * Fails when the documentation disagrees with the code.
 *
 * Run with Node from the repo root: `node tools/check_docs.js`
 *
 * Docs in this repo have drifted repeatedly and silently: GM_GUIDE said "Two tabs" when
 * there were four, dashboard/README's file list was missing two files, AGENTS.md listed a
 * deployment that had been deleted, and HEALTH_CHECKS.md documented 43 checks of which 22
 * existed. None of that is anyone's fault; prose has no compiler. This is the compiler.
 *
 * It runs in Node rather than Apps Script because it needs the filesystem, which is also
 * why it cannot live in Tests.js. It lives in tools/ rather than dashboard/ because
 * .claspignore is a whitelist that re-admits *.js: a Node script sitting in dashboard/
 * gets swept into the Apps Script project, where require() does not exist.
 */
const fs = require('fs');
const path = require('path');
const { scanSensitive, formatSensitive } = require('./sensitive');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
function fail(what, detail) {
  failures++;
  console.log('  FAIL  ' + what + '\n        ' + detail);
}
function ok(what) { console.log('  ok    ' + what); }

// ---------------------------------------------------------------- health checks
// Every id in HEALTH_CATALOGUE must appear in the implemented table, and nothing may
// claim to be implemented that is not. Planned checks live under their own heading and
// are matched separately, so a backlog cannot masquerade as behaviour.
(function healthChecks() {
  const code = read('dashboard/HealthCheck.js');
  const doc = read('docs/HEALTH_CHECKS.md');

  const implemented = new Set();
  const re = /^\s{2}([A-Z]\d+):\s*\{\s*severity:\s*'(\w+)'/gm;
  let m;
  while ((m = re.exec(code))) implemented.add(m[1] + '/' + m[2]);

  // The doc's implemented tables are everything before the "Not yet implemented" heading.
  const split = doc.indexOf('## Not yet implemented');
  if (split === -1) {
    fail('HEALTH_CHECKS.md has no "Not yet implemented" heading',
      'Planned checks are indistinguishable from real ones without it.');
    return;
  }
  const documented = new Set();
  const rowRe = /^\|\s*([A-Z]\d+)\s*\|\s*(\w+)\s*\|/gm;
  let r;
  const head = doc.slice(0, split);
  while ((r = rowRe.exec(head))) documented.add(r[1] + '/' + r[2]);

  const missing = [...implemented].filter(x => !documented.has(x));
  const extra = [...documented].filter(x => !implemented.has(x));
  if (missing.length) {
    fail('checks implemented but not documented as such',
      missing.sort().join(', ') + ' — add a row, with the severity the code uses.');
  }
  if (extra.length) {
    fail('checks documented as implemented but absent from HEALTH_CATALOGUE',
      extra.sort().join(', ') + ' — move to "Not yet implemented", or fix the severity.');
  }
  if (!missing.length && !extra.length) {
    ok(implemented.size + ' health checks: ids and severities match HEALTH_CHECKS.md');
  }
})();

// ---------------------------------------------------------------- dashboard file list
// The file table lives in AGENTS.md, the developer guide, since dashboard/ became code only.
(function fileList() {
  const doc = read('AGENTS.md');
  const actual = fs.readdirSync(path.join(ROOT, 'dashboard'))
    .filter(f => /\.(js|html)$/.test(f));
  const undocumented = actual.filter(f => doc.indexOf('`' + f + '`') === -1)
    // The three UI files are documented as one grouped row.
    .filter(f => !/^(Index|Stylesheet|JavaScript)\.html$/.test(f) ||
                 doc.indexOf('Index/Stylesheet/JavaScript.html') === -1);
  if (undocumented.length) {
    fail('dashboard files absent from the file table in AGENTS.md', undocumented.join(', '));
  } else {
    ok('every dashboard file appears in the AGENTS.md file table');
  }
})();

// ---------------------------------------------------------------- UI tab count
(function tabs() {
  const index = read('dashboard/Index.html');
  const guide = read('docs/USER_GUIDE.md');
  const n = (index.match(/data-view="/g) || []).length;
  const words = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven' };
  if (guide.indexOf('## ' + words[n] + ' tabs') === -1) {
    fail('USER_GUIDE.md does not describe the right number of tabs',
      'Index.html has ' + n + ' tabs, so the heading should read "## ' + words[n] + ' tabs".');
  } else {
    ok('USER_GUIDE.md agrees with Index.html on ' + n + ' tabs');
  }
})();

// ---------------------------------------------------------------- Funding_info keys
// Any key the code reads must be documented, or nobody knows to fill it in.
(function metaKeys() {
  const cfg = read('dashboard/Config.js');
  const doc = read('docs/BUDGET_SHEET_TEMPLATE.md');
  const block = cfg.slice(cfg.indexOf('META: {'), cfg.indexOf('},', cfg.indexOf('META: {')));
  const keys = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const missing = keys.filter(k => {
    const title = k.replace(/\b\w/g, c => c.toUpperCase());   // "exclusivity group" -> "Exclusivity Group"
    return doc.toLowerCase().indexOf('`' + k.toLowerCase() + '`') === -1 &&
           doc.indexOf('`' + title + '`') === -1;
  });
  if (missing.length) {
    fail('Funding_info keys read by code but undocumented', missing.join(', '));
  } else {
    ok(keys.length + ' Funding_info keys read by Config.META are all documented');
  }
})();

// ---------------------------------------------------------------- dead references
// Files the docs point at must exist. This is what caught create_quarterly_budgets.js
// being referenced five times after it was deleted.
const DOCS = ['README.md', 'AGENTS.md', '.agents/skills/SKILL.md',
  'docs/USER_GUIDE.md', 'docs/BUDGET_SHEET_TEMPLATE.md', 'docs/HEALTH_CHECKS.md',
  'docs/DESIGN.md'];

(function deadRefs() {
  const docs = DOCS;
  // Files deleted on purpose, which the docs still name because the lesson outlived the
  // code. SKILL.md's "two files both defined getFolderByName" is still worth knowing even
  // though one of them is gone. Listed explicitly so a genuinely broken reference to a file
  // someone expected to exist still fails.
  const RETIRED_FILES = new Set([
    'create_quarterly_budgets.js',   // retired 2026-08-11, quarterly generation moved into the cockpit
    'loader-budgets-template.js',    // remote code loader, removed 2026-08-10
    'loader_template.js',            // remote code loader, removed 2026-08-10
    'create_xero_budget_project.js', // removed 2026-09-29, the cockpit ported what it needed
    'general_valid_accounts.js',     // removed 2026-09-29, served the retired *Account column
    'variance_funding_source.js',    // removed 2026-09-29, served the retired *Account column
    'funding-aggregator.js'          // removed 2026-09-29, the cockpit's Overview replaced it
  ]);

  // Every file in the repo, by basename, so a bare mention in prose resolves.
  const allFiles = new Set();
  (function walk(dir) {
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(e => {
      if (e.name === '.git' || e.name === 'node_modules') return;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel); else allFiles.add(e.name);
    });
  })('.');

  const dead = [];
  docs.forEach(d => {
    if (!fs.existsSync(path.join(ROOT, d))) return;   // deleted docs are not broken docs
    const text = read(d);
    // Any backticked token that looks like a repo file path.
    [...text.matchAll(/`([A-Za-z0-9_./-]+\.(?:js|html|json|md|xlsx|csv))`/g)].forEach(m => {
      const ref = m[1];
      // URL fragments, and the one legitimate shorthand for the three grouped UI files.
      if (/^https?:|refs\/heads\//.test(ref)) return;
      if (ref === 'Index/Stylesheet/JavaScript.html') return;
      // A bare basename in prose is fine if that file exists anywhere in the repo.
      if (allFiles.has(path.basename(ref))) return;
      if (RETIRED_FILES.has(path.basename(ref))) return;
      dead.push(d + ' -> ' + ref);
    });
  });
  if (dead.length) {
    fail(dead.length + ' reference(s) to files that do not exist',
      [...new Set(dead)].join('\n        '));
  } else {
    ok('every file referenced by the docs exists');
  }
})();

// ---------------------------------------------------------------- relative links
// A backticked name only has to exist somewhere; a markdown link has to resolve from the
// page it is on, and moving a doc between folders breaks exactly those. Checked when the
// docs moved into docs/, so the move could not strand a reader on a dead link.
(function links() {
  const broken = [];
  DOCS.forEach(d => {
    if (!fs.existsSync(path.join(ROOT, d))) return;
    const dir = path.dirname(d);
    [...read(d).matchAll(/\]\(([^)\s]+)\)/g)].forEach(m => {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) return;
      const file = target.split('#')[0];
      if (!file) return;
      if (!fs.existsSync(path.join(ROOT, dir, file))) broken.push(d + ' -> ' + target);
    });
  });
  if (broken.length) {
    fail(broken.length + ' relative link(s) that do not resolve', broken.join('\n        '));
  } else {
    ok('every relative link in the docs resolves');
  }
})();

// ---------------------------------------------------------------- sensitive content
// The public/private boundary, enforced. See tools/sensitive.js for the rule and why
// precision is the signal. The same scanner runs in the commit-msg hook and in CI, so a
// figure cannot reach the repository through a file, a commit message, or a merge.
//
// This scans everything textual rather than a named list. It used to hold a list of
// eleven files, which excluded the scanner's own source, every .html client file, and by
// construction every file anyone would add later. On 2026-09-21 it was the scanner's own
// docblock that carried an unrounded figure, and the list is why nothing noticed. An
// allowlist cannot guard a repository: the leak is always in the file you did not list.
(function sensitive() {
  const TEXT = /\.(md|js|html|json|ya?ml|txt|csv|sh)$/i;
  const SKIP = /(^|[\\/])(\.git|node_modules|\.clasp\.json)([\\/]|$)/;

  const files = [];
  (function walk(dir) {
    fs.readdirSync(path.join(ROOT, dir || '.'), { withFileTypes: true }).forEach(e => {
      const rel = dir ? dir + '/' + e.name : e.name;
      if (SKIP.test(rel)) return;
      if (e.isDirectory()) return walk(rel);
      // .githooks/pre-commit and friends are shell scripts with no extension.
      if (!TEXT.test(rel) && !/^\.githooks\//.test(rel)) return;
      files.push(rel);
    });
  })('');

  const findings = [];
  files.forEach(f => findings.push(...scanSensitive(read(f), f)));
  if (findings.length) {
    const indented = formatSensitive(findings).trim().split(String.fromCharCode(10))
      .join(String.fromCharCode(10) + '        ');
    fail(findings.length + ' possible piece(s) of content in a structure repo', indented);
  } else {
    ok('no amounts, personal emails or account numbers in ' + files.length + ' text file(s)');
  }
})();

console.log();
if (failures) {
  console.log(failures + ' documentation check(s) failed');
  process.exitCode = 1;
} else {
  console.log('documentation agrees with the code');
}
