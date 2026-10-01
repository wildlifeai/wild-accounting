/**
 * WebApp.js
 * Web-app entry point and the server-side functions the client calls via
 * google.script.run. Setup and diagnostics run from the editor: XeroClient.js for the
 * Xero connection, Snapshot.js for the refresh trigger, Probe.js for dry runs.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Wildlife.ai Funding Cockpit')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Allow Index.html to pull in Stylesheet.html / JavaScript.html partials. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Return the current user's email, trying getActiveUser first then getEffectiveUser. */
function getCurrentUserEmail_() {
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}
  if (!email) {
    try { email = Session.getEffectiveUser().getEmail(); } catch (e) {}
  }
  return email || '';
}

/** Return a snapshot filtered to the current user's authorized projects. */
function getFilteredSnapshot_() {
  const snap = getSnapshot();
  if (!snap) return null;
  // Staleness and the trigger are judged now, not at the last refresh: see
  // serveTimeHealth. readSnapshot_ parses the file afresh on every call, so this is a
  // private object and adding to it leaks into nothing.
  const late = serveTimeHealth({
    now: new Date(),
    generatedAt: snap.generatedAt,
    triggerInstalled: refreshTriggerInstalled_(),
    refreshHours: CONFIG.REFRESH_TRIGGER_HOURS
  });
  if (late.length) {
    snap.health = late.concat(snap.health || []).sort(healthOrder_);
    snap.dataFlags = healthToFlags(snap.health);
  }
  const email = getCurrentUserEmail_();
  const out = filterSnapshotForProjects_(snap, getUserPermissions(email));
  if (out) out._userEmail = email;
  return out;
}

/**
 * System findings a project-scoped user still needs, because each one means the numbers
 * they are looking at are stale. Everything else that carries no project is org-wide:
 * D1 and D2 are organisation dollar totals, F5 counts every source in the org.
 */
const SCOPED_VISIBLE_SYSTEM_CHECKS = { F1: true, F2: true, F3: true, F7: true };

/**
 * Reduce a snapshot to the projects a user may see. Pure over its inputs, so the
 * project-lead persona can be exercised without a second Google account.
 *
 * `allowedProjects` is ['*'] for full access, [] for none, or a list of project names.
 */
function filterSnapshotForProjects_(snap, allowedProjects) {
  if (!snap) return null;
  allowedProjects = allowedProjects || [];

  // If full access, return everything. Deliberately not a copy: the snapshot is large
  // and the admin path runs on every load.
  if (allowedProjects.length === 1 && allowedProjects[0] === '*') {
    snap._accessLevel = 'admin';
    return snap;
  }

  // If no access at all, return an empty shell
  if (allowedProjects.length === 0) {
    return {
      generatedAt: snap.generatedAt,
      xeroConnected: snap.xeroConnected,
      currentQuarter: snap.currentQuarter,
      coverage: snap.coverage,
      totals: { budget: 0, secured: 0, actual: 0, unsecuredGap: 0,
                budgetFY: 0, securedFY: 0, actualFY: 0, unsecuredGapFY: 0 },
      projects: [],
      fundingSources: [],
      breakdownRows: [],
      tracking: [],
      timeline: [],
      health: [],
      dataFlags: [],
      _accessLevel: 'none'
    };
  }

  const filteredSnap = JSON.parse(JSON.stringify(snap));

  // Runway is the whole organisation's position, secured money against all spend. A
  // project lead's own numbers are theirs to see; the organisation's balance is not.
  delete filteredSnap.runway;

  if (filteredSnap.projects) {
    filteredSnap.projects = filteredSnap.projects.filter(r => allowedProjects.includes(r.project));
  }

  if (filteredSnap.fundingSources) {
    filteredSnap.fundingSources = filteredSnap.fundingSources.filter(r => allowedProjects.includes(r.project));
  }

  if (filteredSnap.breakdownRows) {
    filteredSnap.breakdownRows = filteredSnap.breakdownRows.filter(r => allowedProjects.includes(r.project));
  }

  if (filteredSnap.tracking) {
    filteredSnap.tracking = filteredSnap.tracking.filter(t => {
      t.milestones = (t.milestones || []).filter(m => allowedProjects.includes(m.project));
      return t.milestones.length > 0;
    });
  }

  if (filteredSnap.timeline) {
    filteredSnap.timeline = filteredSnap.timeline.filter(t => allowedProjects.includes(t.project));
  }

  // Health findings name their funding source, its owner's email, the dollars at risk and
  // a link straight to the sheet. Unfiltered, the panel showed a project lead every budget
  // in the organisation. This was invisible while dataFlags was never populated; once
  // HealthCheck started filling it, it became a live leak.
  if (filteredSnap.health) {
    filteredSnap.health = filteredSnap.health.filter(function (f) {
      return f.project ? allowedProjects.indexOf(f.project) !== -1
                       : !!SCOPED_VISIBLE_SYSTEM_CHECKS[f.id];
    });
  }
  // Derive the legacy flags from the filtered findings, so the two cannot disagree.
  filteredSnap.dataFlags = healthToFlags(filteredSnap.health || []);

  // Totals over the lead's projects, by the same function as the organisation's.
  filteredSnap.totals = orgTotals_(filteredSnap.projects || []);

  filteredSnap._accessLevel = 'filtered';
  return filteredSnap;
}

/** Client API: the cached snapshot (fast). */
function apiGetSnapshot() {
  return getFilteredSnapshot_();
}

/** Client API: force a rebuild ("Refresh now" button). */
function apiRefresh() {
  refreshSnapshot(); // build and cache the full snapshot
  return getFilteredSnapshot_(); // return only the allowed projects to the client
}

/**
 * Client API: the current refresh phase, polled by the browser while apiRefresh is
 * outstanding. Deliberately does no Drive or Xero work and takes no lock, so it can
 * answer while a refresh holds the script lock.
 *
 * Returns null when nothing is running. Carries no project data, so it needs no
 * permission filtering: the phase names are sheet names the poller already triggered.
 */
function apiRefreshProgress() {
  return readRefreshProgress_();
}

/** Client API: is Xero connected, and the auth URL if not. */
function apiXeroStatus() {
  const service = getXeroService();
  return { connected: service.hasAccess(),
    authUrl: service.hasAccess() ? null : service.getAuthorizationUrl() };
}

/** Client API: list of project names for the planner dropdown. */
function apiListProjects() {
  const snap = getFilteredSnapshot_();
  const names = {};
  (snap.timeline || []).forEach(t => (names[t.project] = true));
  return Object.keys(names).sort();
}

/** Client API: timeline data for the planner, filtered to one project. */
function apiGetTimeline(projectName) {
  const snap = getFilteredSnapshot_();
  return (snap.timeline || []).filter(t => t.project === projectName);
}

/**
 * Client API: the entities selectable in the tracking dropdown.
 * The General project (aggregated across funding sources) is listed first,
 * followed by each funding source. Each entry: { id, label, type }.
 */
function apiListSources() {
  const snap = getFilteredSnapshot_();
  const entries = [];
  const hasGeneral = (snap.tracking || []).some(t =>
    (t.milestones || []).some(m => m.project === CONFIG.GENERAL_PROJECT));
  if (hasGeneral) {
    entries.push({ id: 'project:' + CONFIG.GENERAL_PROJECT,
      label: CONFIG.GENERAL_PROJECT + ' (project)', type: 'project' });
  }
  (snap.tracking || []).forEach(t => entries.push({
    id: t.source, label: t.source + ' (' + t.status + ' · ' + t.project + ')',
    type: 'source' }));
  return entries;
}

/**
 * Client API: the quarterly tracking grid for one entity id (a funding source
 * name, or 'project:<Name>'), with the live forecast layered on. Or an array of ids.
 */
function apiGetTracking(ids, measure) {
  const snap = getFilteredSnapshot_();
  const currentQi = quarterSortNum(snap.currentQuarter || currentQuarterLabel());
  return composeTracking(resolveEntity_(snap, ids), currentQi, measure);
}

/** Build the entity (source or aggregated project) the tracking grid renders. */
function resolveEntity_(snap, ids) {
  if (!Array.isArray(ids)) ids = [ids];
  const tracking = snap.tracking || [];
  
  if (ids.length === 1 && ids[0].indexOf('project:') === 0) {
    const projectName = ids[0].substring('project:'.length);
    const milestones = [];
    const sheetUrls = [];
    tracking.forEach(t => {
      (t.milestones || []).forEach(m => {
        if (m.project === projectName) milestones.push(m);
      });
      if (t.sheetUrl) sheetUrls.push({ source: t.source, url: t.sheetUrl });
    });

    // General's contribution from each source, by that source's Contribution policy:
    // the policy's share of its income on milestones not already General's. Income only.
    // This used to copy whole sources across, cost and all, so on the Cost measure every
    // contributing project's spend appeared a second time under General.
    if (projectName === CONFIG.GENERAL_PROJECT) {
      milestones.push.apply(milestones, contributionMilestones_(tracking));
    }

    if (!milestones.length) throw new Error('No milestones for project: ' + projectName);
    return { id: ids[0], label: projectName + ' (project)', type: 'project',
      project: projectName, milestones: milestones, sheetUrls: sheetUrls };
  }
  
  if (ids.length === 1) {
    const src = tracking.filter(t => t.source === ids[0])[0];
    if (!src) throw new Error('Unknown funding source: ' + ids[0]);
    return { id: ids[0], label: ids[0], type: 'source', source: ids[0], status: src.status,
      project: src.project, milestones: src.milestones,
      sheetUrls: src.sheetUrl ? [{ source: src.source, url: src.sheetUrl }] : [] };
  }
  
  // Multiple sources selected
  const milestones = [];
  const sheetUrls = [];
  ids.forEach(id => {
    const src = tracking.filter(t => t.source === id)[0];
    if (src && src.milestones) {
      milestones.push(...src.milestones);
      if (src.sheetUrl) sheetUrls.push({ source: src.source, url: src.sheetUrl });
    }
  });
  
  return { id: ids.join(','), label: 'Multiple sources selected', type: 'composite',
    project: 'Multiple', milestones: milestones, sheetUrls: sheetUrls };
}

/** Add values from source map into target map (mutates target). */
function addMaps_(target, source) {
  if (!source) return;
  Object.keys(source).forEach(function (k) {
    target[k] = (target[k] || 0) + (source[k] || 0);
  });
}

/**
 * General's contribution rows for the tracking view: per source, its policy's share of the
 * income on milestones not already General's. Income layers only, because a contribution
 * is income to General, not spend. Pure over the tracking entries, so it can be tested.
 */
function contributionMilestones_(tracking) {
  var out = [];
  (tracking || []).forEach(function (t) {
    var rate = t.contributionRate || 0;
    if (!rate) return;
    var items = (t.milestones || []).filter(function (m) {
      return m.project !== CONFIG.GENERAL_PROJECT;
    });
    var incBase = {}, incAct = {}, incFc = {}, fcQuarters = {};
    items.forEach(function (m) {
      addMaps_(incBase, m.incomeBaseline);
      addMaps_(incAct, m.incomeActual);
      Object.keys(m.incomeForecast || {}).forEach(function (q) { fcQuarters[q] = true; });
    });
    // Where any milestone has an income forecast, the row's figure is each milestone's own
    // forecastOrBaseline_, summed. Summing the entries alone would let one milestone's
    // forecast erase another's budget for that quarter.
    Object.keys(fcQuarters).forEach(function (q) {
      incFc[q] = items.reduce(function (s, m) {
        return s + forecastOrBaseline_(m.incomeForecast, m.incomeBaseline, q);
      }, 0);
    });
    if (!Object.keys(incBase).length && !Object.keys(incAct).length &&
        !Object.keys(incFc).length) return;
    var share = function (map) { return roundMapValues_(scaleMap_(map, rate)); };
    out.push({
      item: t.source + '_contrib', milestone: contributionMilestone_(t.source),
      source: t.source, project: CONFIG.GENERAL_PROJECT,
      baseline: {}, actual: {}, costForecast: {},
      incomeBaseline: share(incBase), incomeActual: share(incAct),
      incomeForecast: share(incFc), forecastComment: ''
    });
  });
  return out;
}
