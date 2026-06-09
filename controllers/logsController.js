const {
  list,
  getFilterOptions,
  ACTION_INDEX,
  GROUP_LABELS,
  COLOR_CLASSES,
} = require('../utils/logger');

exports.index = async (req, res) => {
  const action = (req.query.action || '').trim() || null;
  const actor = (req.query.actor || '').trim() || null;
  const group = (req.query.group || '').trim() || null;

  const from = normalizeDate(req.query.from, false);
  const to   = normalizeDate(req.query.to,   true);

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = 25;
  const tenantId = req.tenantId;

  const [{ items, hasMore }, options] = await Promise.all([
    list({ action, actor, from, to, tenantId, page, pageSize }),
    getFilterOptions(tenantId),
  ]);

  const filtered = group
    ? items.filter((it) => {
        const meta = ACTION_INDEX[it.action];
        return meta && meta.group === group;
      })
    : items;

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
    req,
    filters: { action, actor, group, from: req.query.from || '', to: req.query.to || '' },
    options,
    groupLabels: GROUP_LABELS,
  });
};

function normalizeDate(value, isEnd) {
  if (!value) return null;
  const s = String(value).trim();
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
