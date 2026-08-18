const TYPE_META = {
  stop: { label: 'توقف', prefix: 'STOP' },
  speed: { label: 'سرعة', prefix: 'SPD' },
  workshop: { label: 'دخول ورشة', prefix: 'WRK' },
  fuel: { label: 'استهلاك ديزل', prefix: 'FUEL' }
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function riyadhYear(date) {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Riyadh', year: 'numeric' }).format(date));
}

function riyadhDateTime(date) {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true
  }).format(date);
}

function buildMessage(incident) {
  const fallbackReason = {
    stop: incident.stop_duration ? `توقف المعدة لمدة ${incident.stop_duration}` : 'توقف المعدة',
    speed: incident.recorded_speed !== null ? `تجاوز السرعة، السرعة المسجلة ${incident.recorded_speed} كم/س` : 'تجاوز السرعة المعتمدة',
    workshop: incident.entry_reason || 'دخول المعدة إلى الورشة',
    fuel: 'رصد استهلاك ديزل غير طبيعي'
  }[incident.incident_type];
  return [
    `رقم البلاغ: ${incident.report_number}`,
    `كود المعدة: ${incident.equipment_code}`,
    `سبب التبليغ: ${incident.details || fallbackReason}`
  ].join('\n');
}

function accessEmail(request) {
  return text(request.headers.get('Cf-Access-Authenticated-User-Email') || '', 200).toLowerCase();
}

async function currentUser(request, env) {
  const email = accessEmail(request);
  if (!email) return null;
  return env.DB.prepare(`
    SELECT id, email, full_name, role, active, can_edit_incidents, created_at, updated_at
    FROM app_users WHERE email = ? COLLATE NOCASE AND active = 1
  `).bind(email).first();
}

function unauthorized(message = 'هذا البريد غير مسجل أو أن الحساب معطل.') {
  return json({ error: message }, 403);
}

function requireAdmin(user) {
  return user?.role === 'admin' ? null : unauthorized('هذه العملية متاحة لمدير النظام فقط.');
}

function canEditIncidents(user) {
  return user?.role === 'admin' || Number(user?.can_edit_incidents) === 1;
}

async function listIncidents(request, env, user) {
  const url = new URL(request.url);
  const clauses = [];
  const bindings = [];
  const type = url.searchParams.get('type');
  const status = url.searchParams.get('status');
  const date = url.searchParams.get('date');
  const search = text(url.searchParams.get('search'), 100);
  if (type && TYPE_META[type]) { clauses.push('incident_type = ?'); bindings.push(type); }
  if (status && ['open', 'in_progress', 'closed'].includes(status)) { clauses.push('status = ?'); bindings.push(status); }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { clauses.push("date(datetime(reported_at, '+3 hours')) = ?"); bindings.push(date); }
  if (search) { clauses.push('(equipment_code LIKE ? OR report_number LIKE ?)'); bindings.push(`%${search}%`, `%${search}%`); }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 1000);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const query = `SELECT * FROM incidents ${where} ORDER BY reported_at DESC LIMIT ?`;
  const result = await env.DB.prepare(query).bind(...bindings, limit).all();
  return json({ incidents: result.results || [], current_user: user });
}

async function createIncident(request, env, user) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'بيانات البلاغ غير صالحة.' }, 400);
  const incidentType = text(body.incident_type, 30);
  const equipmentCode = text(body.equipment_code, 80).toUpperCase();
  if (!TYPE_META[incidentType]) return json({ error: 'اختر نوع بلاغ صحيحًا.' }, 400);
  if (!equipmentCode) return json({ error: 'كود المعدة مطلوب.' }, 400);
  if (!text(body.details, 1000)) return json({ error: 'سبب التبليغ مطلوب.' }, 400);

  const now = new Date();
  const year = riyadhYear(now);
  const counter = await env.DB.prepare(`
    INSERT INTO incident_counters (incident_type, incident_year, current_value)
    VALUES (?, ?, 1)
    ON CONFLICT (incident_type, incident_year)
    DO UPDATE SET current_value = current_value + 1
    RETURNING current_value
  `).bind(incidentType, year).first();
  const reportNumber = `${TYPE_META[incidentType].prefix}-${year}-${String(counter.current_value).padStart(5, '0')}`;
  const iso = now.toISOString();
  const incident = {
    report_number: reportNumber,
    incident_type: incidentType,
    equipment_code: equipmentCode,
    project_name: text(body.project_name, 150),
    location_name: text(body.location_name, 200),
    details: text(body.details, 1000),
    stop_duration: text(body.stop_duration, 80),
    recorded_speed: numberOrNull(body.recorded_speed),
    speed_limit: numberOrNull(body.speed_limit),
    workshop_name: text(body.workshop_name, 150),
    entry_reason: text(body.entry_reason, 300),
    fuel_before: numberOrNull(body.fuel_before),
    fuel_after: numberOrNull(body.fuel_after),
    observer_name: text(body.observer_name, 120),
    observer_email: user.email,
    reported_at: iso,
    created_at: iso,
    updated_at: iso
  };
  incident.message_text = buildMessage(incident);

  const inserted = await env.DB.prepare(`
    INSERT INTO incidents (
      report_number, incident_type, equipment_code, project_name, location_name, details,
      stop_duration, recorded_speed, speed_limit, workshop_name, entry_reason,
      fuel_before, fuel_after, observer_name, observer_email, reported_at,
      message_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    incident.report_number, incident.incident_type, incident.equipment_code,
    incident.project_name, incident.location_name, incident.details, incident.stop_duration,
    incident.recorded_speed, incident.speed_limit, incident.workshop_name, incident.entry_reason,
    incident.fuel_before, incident.fuel_after, incident.observer_name, incident.observer_email,
    incident.reported_at, incident.message_text, incident.created_at, incident.updated_at
  ).first();
  return json({ incident: inserted }, 201);
}

async function updateIncidentStatus(body, env, id, user) {
  const status = text(body?.status, 30);
  if (!['open', 'in_progress', 'closed'].includes(status)) return json({ error: 'الحالة غير صالحة.' }, 400);
  const now = new Date().toISOString();
  const closedAt = status === 'closed' ? now : null;
  const closureReason = status === 'closed' ? text(body?.closure_reason, 1000) : '';
  if (status === 'closed' && !closureReason) return json({ error: 'سبب إغلاق البلاغ مطلوب.' }, 400);
  const row = await env.DB.prepare(`
    UPDATE incidents SET
      status = ?, closed_at = ?, closure_reason = ?,
      closed_by_name = ?, closed_by_email = ?, updated_at = ?
    WHERE id = ? RETURNING *
  `).bind(
    status,
    closedAt,
    status === 'closed' ? closureReason : null,
    status === 'closed' ? user.full_name : null,
    status === 'closed' ? user.email : null,
    now,
    id
  ).first();
  return row ? json({ incident: row }) : json({ error: 'البلاغ غير موجود.' }, 404);
}

async function editIncident(body, env, id, user) {
  if (!canEditIncidents(user)) return unauthorized('ليس لديك صلاحية تعديل البلاغات.');
  const existing = await env.DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'البلاغ غير موجود.' }, 404);
  const equipmentCode = text(body?.equipment_code, 80).toUpperCase();
  const details = text(body?.details, 1000);
  if (!equipmentCode) return json({ error: 'كود المعدة مطلوب.' }, 400);
  if (!details) return json({ error: 'سبب التبليغ مطلوب.' }, 400);
  const now = new Date().toISOString();
  const incident = {
    ...existing,
    equipment_code: equipmentCode,
    project_name: text(body?.project_name, 150),
    location_name: text(body?.location_name, 200),
    details,
    stop_duration: text(body?.stop_duration, 80),
    recorded_speed: numberOrNull(body?.recorded_speed),
    speed_limit: numberOrNull(body?.speed_limit),
    workshop_name: text(body?.workshop_name, 150),
    entry_reason: text(body?.entry_reason, 300),
    fuel_before: numberOrNull(body?.fuel_before),
    fuel_after: numberOrNull(body?.fuel_after),
    observer_name: text(body?.observer_name, 120)
  };
  incident.message_text = buildMessage(incident);
  const row = await env.DB.prepare(`
    UPDATE incidents SET
      equipment_code = ?, project_name = ?, location_name = ?, details = ?,
      stop_duration = ?, recorded_speed = ?, speed_limit = ?, workshop_name = ?,
      entry_reason = ?, fuel_before = ?, fuel_after = ?, observer_name = ?,
      message_text = ?, last_edited_at = ?, last_edited_by_email = ?, updated_at = ?
    WHERE id = ? RETURNING *
  `).bind(
    incident.equipment_code, incident.project_name, incident.location_name, incident.details,
    incident.stop_duration, incident.recorded_speed, incident.speed_limit, incident.workshop_name,
    incident.entry_reason, incident.fuel_before, incident.fuel_after, incident.observer_name,
    incident.message_text, now, user.email, now, id
  ).first();
  return json({ incident: row });
}

async function updateIncident(request, env, id, user) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'بيانات البلاغ غير صالحة.' }, 400);
  return body.action === 'edit'
    ? editIncident(body, env, id, user)
    : updateIncidentStatus(body, env, id, user);
}

async function listUsers(env) {
  const result = await env.DB.prepare(`
    SELECT id, email, full_name, role, active, can_edit_incidents, created_by, created_at, updated_at
    FROM app_users ORDER BY active DESC, role ASC, full_name COLLATE NOCASE ASC
  `).all();
  return json({ users: result.results || [] });
}

async function createUser(request, env, admin) {
  const body = await request.json().catch(() => null);
  const email = text(body?.email, 200).toLowerCase();
  const fullName = text(body?.full_name, 150);
  const role = text(body?.role, 30) || 'monitor';
  const canEdit = (role === 'admin' || Boolean(body?.can_edit_incidents)) ? 1 : 0;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'أدخل بريدًا إلكترونيًا صحيحًا.' }, 400);
  if (!fullName) return json({ error: 'اسم المستخدم مطلوب.' }, 400);
  if (!['admin', 'monitor'].includes(role)) return json({ error: 'الصلاحية غير صحيحة.' }, 400);
  const now = new Date().toISOString();
  const user = await env.DB.prepare(`
    INSERT INTO app_users (email, full_name, role, active, can_edit_incidents, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      full_name = excluded.full_name,
      role = excluded.role,
      active = 1,
      can_edit_incidents = excluded.can_edit_incidents,
      updated_at = excluded.updated_at
    RETURNING id, email, full_name, role, active, can_edit_incidents, created_by, created_at, updated_at
  `).bind(email, fullName, role, canEdit, admin.email, now, now).first();
  return json({ user }, 201);
}

async function updateUser(request, env, id, admin) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'بيانات المستخدم غير صالحة.' }, 400);
  const existing = await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'المستخدم غير موجود.' }, 404);
  const role = body.role === undefined ? existing.role : text(body.role, 30);
  const active = body.active === undefined ? existing.active : (body.active ? 1 : 0);
  const canEdit = role === 'admin' ? 1 : (
    body.can_edit_incidents === undefined ? existing.can_edit_incidents : (body.can_edit_incidents ? 1 : 0)
  );
  if (!['admin', 'monitor'].includes(role)) return json({ error: 'الصلاحية غير صحيحة.' }, 400);
  if (existing.email.toLowerCase() === admin.email.toLowerCase() && (!active || role !== 'admin')) {
    return json({ error: 'لا يمكنك تعطيل حسابك الإداري أو إزالة صلاحية المدير منه.' }, 400);
  }
  const user = await env.DB.prepare(`
    UPDATE app_users SET role = ?, active = ?, can_edit_incidents = ?, updated_at = ? WHERE id = ?
    RETURNING id, email, full_name, role, active, can_edit_incidents, created_by, created_at, updated_at
  `).bind(role, active, canEdit, new Date().toISOString(), id).first();
  return json({ user });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        const user = await currentUser(request, env);
        if (!user) return unauthorized();
        if (url.pathname === '/api/incidents' && request.method === 'GET') return listIncidents(request, env, user);
        if (url.pathname === '/api/incidents' && request.method === 'POST') return createIncident(request, env, user);
        const match = url.pathname.match(/^\/api\/incidents\/(\d+)$/);
        if (match && request.method === 'PATCH') return updateIncident(request, env, Number(match[1]), user);
        if (url.pathname === '/api/users' && request.method === 'GET') {
          const denied = requireAdmin(user); if (denied) return denied;
          return listUsers(env);
        }
        if (url.pathname === '/api/users' && request.method === 'POST') {
          const denied = requireAdmin(user); if (denied) return denied;
          return createUser(request, env, user);
        }
        const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
        if (userMatch && request.method === 'PATCH') {
          const denied = requireAdmin(user); if (denied) return denied;
          return updateUser(request, env, Number(userMatch[1]), user);
        }
        return json({ error: 'المسار غير موجود.' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'تعذر تنفيذ العملية. حاول مرة أخرى.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
