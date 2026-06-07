// Activity log viewer. Admin-only by design (it can reveal other users'
// actions, IPs, and emails). Backed by utils/logger.

const {
  list,
  getFilterOptions,
  ACTION_INDEX,
  GROUP_LABELS,
  COLOR_CLASSES,
} = require('../utils/logger');

/**
 * Render the log feed. Query params supported:
 *   action  — exact action key (e.g. 'student.create')
 *   actor   — actor user id
 *   group   — restrict to a group ('students', 'rooms', …)
 *   from    — ISO date or YYYY-MM-DD; inclusive
 *   to      — ISO date or YYYY-MM-DD; inclusive
 *   page    — 1-based page number
 *
 * Validation is deliberately loose: the form is for humans, not for
 * blocking attackers, so anything weird just shows up empty.
 */
exports.index = async (req, res) => {
  const action = (req.query.action || '').trim() || null;
  const actor = (req.query.actor || '').trim() || null;
  const group = (req.query.group || '').trim() || null;

  // Normalize the date inputs — accept 'YYYY-MM-DD' from the date input
  // and turn it into an ISO range that covers the whole day.
  const from = normalizeDate(req.query.from, false);
  const to   = normalizeDate(req.query.to,   true);

  // If a group filter is set, expand it to all of that group's action
  // keys. We do that in JS instead of Firestore because we don't have a
  // 'group' field on the log doc — only `action`.
  let effectiveAction = action;
  if (!effectiveAction && group) {
    // Filter in memory after the query. We can't restrict the Firestore
    // query, but the page size keeps it cheap.
  }

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = 25;

  const [{ items, hasMore }, options] = await Promise.all([
    list({ action, actor, from, to, page, pageSize }),
    getFilterOptions(),
  ]);

  // Group post-filter: drop items that don't belong to the chosen group.
  const filtered = group
    ? items.filter((it) => {
        const meta = ACTION_INDEX[it.action];
        return meta && meta.group === group;
      })
    : items;

  // Decorate each item with display metadata so the view stays dumb.
  const decorated = filtered.map((it) => {
    const meta = ACTION_INDEX[it.action] || {
      label: it.action,
      icon: 'bi-circle',
      color: 'ink',
    };
    const color = COLOR_CLASSES[meta.color] || COLOR_CLASSES.ink;
    return {
      ...it,
      meta,
      color,
      // Pre-format the timestamp for the view.
      when: formatRelative(it.createdAt),
      whenAbsolute: formatAbsolute(it.createdAt),
    };
  });

  res.render('logs/index', {
    title: 'Activity Log',
    items: decorated,
    hasMore,
    page,
    pageSize,
    // The view's pageUrl() helper needs the original query string so
    // paginated links preserve active filters — pass req through.
    req,
    filters: { action, actor, group, from: req.query.from || '', to: req.query.to || '' },
    options,
    groupLabels: GROUP_LABELS,
  });
};

// ---------- helpers ----------

/**
 * Convert a date-input value into an ISO timestamp covering the start or
 * end of the day. `isEnd = true` pushes to 23:59:59.999Z.
 */
function normalizeDate(value, isEnd) {
  if (!value) return null;
  const s = String(value).trim();
  // Accept either 'YYYY-MM-DD' or a full ISO string.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m) return null;
  const day = m[1];
  const iso = isEnd ? `${day}T23:59:59.999Z` : `${day}T00:00:00.000Z`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function formatAbsolute(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 5)        return 'just now';
  if (diffSec < 60)       return `${diffSec}s ago`;
  const min = Math.round(diffSec / 60);
  if (min < 60)           return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)            return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30)           return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12)            return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}
