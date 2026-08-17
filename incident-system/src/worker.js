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
  const meta = TYPE_META[incident.incident_type];
  const lines = [
    `بلاغ ${meta.label} رقم: ${incident.report_number}`,
    `كود المعدة: ${incident.equipment_code}`,
    `تاريخ ووقت البلاغ: ${riyadhDateTime(new Date(incident.reported_at))}`
  ];
  if (incident.project_name) lines.push(`المشروع / الفرع: ${incident.project_name}`);
  if (incident.location_name) lines.push(`الموقع: ${incident.location_name}`);
  if (incident.incident_type === 'stop' && incident.stop_duration) lines.push(`مدة التوقف: ${incident.stop_duration}`);
  if (incident.incident_type === 'speed') {
    if (incident.recorded_speed !== null) lines.push(`السرعة المسجلة: ${incident.recorded_speed} كم/س`);
    if (incident.speed_limit !== null) lines.push(`الحد المعتمد: ${incident.speed_limit} كم/س`);
  }
  if (incident.incident_type === 'workshop') {
    if (incident.workshop_name) lines.push(`اسم الورشة: ${incident.workshop_name}`);
    if (incident.entry_reason) lines.push(`سبب الدخول: ${incident.entry_reason}`);
  }
  if (incident.incident_type === 'fuel') {
    if (incident.fuel_before !== null) lines.push(`قراءة الوقود قبل: ${incident.fuel_before} لتر`);
    if (incident.fuel_after !== null) lines.push(`قراءة الوقود بعد: ${incident.fuel_after} لتر`);
    if (incident.fuel_before !== null && incident.fuel_after !== null) lines.push(`الفرق: ${(incident.fuel_before - incident.fuel_after).toFixed(1)} لتر`);
  }
  if (incident.details) lines.push(`التفاصيل: ${incident.details}`);
  lines.push('الحالة: مفتوح', 'يرجى المتابعة واتخاذ اللازم.');
  return lines.join('\n');
}

function accessEmail(request) {
  return text(request.headers.get('Cf-Access-Authenticated-User-Email') || '', 200);
}

function requireAccess(request, env) {
  if (env.REQUIRE_ACCESS !== 'true') return null;
  return accessEmail(request) ? null : json({ error: 'الدخول غير مصرح. افتح الموقع عبر حساب العمل.' }, 401);
}

async function listIncidents(request, env) {
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
  return json({ incidents: result.results || [] });
}

async function createIncident(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'بيانات البلاغ غير صالحة.' }, 400);
  const incidentType = text(body.incident_type, 30);
  const equipmentCode = text(body.equipment_code, 80).toUpperCase();
  if (!TYPE_META[incidentType]) return json({ error: 'اختر نوع بلاغ صحيحًا.' }, 400);
  if (!equipmentCode) return json({ error: 'كود المعدة مطلوب.' }, 400);

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
    observer_email: accessEmail(request),
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

async function updateIncident(request, env, id) {
  const body = await request.json().catch(() => null);
  const status = text(body?.status, 30);
  if (!['open', 'in_progress', 'closed'].includes(status)) return json({ error: 'الحالة غير صالحة.' }, 400);
  const now = new Date().toISOString();
  const closedAt = status === 'closed' ? now : null;
  const row = await env.DB.prepare(`
    UPDATE incidents SET status = ?, closed_at = ?, updated_at = ? WHERE id = ? RETURNING *
  `).bind(status, closedAt, now, id).first();
  return row ? json({ incident: row }) : json({ error: 'البلاغ غير موجود.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const denied = requireAccess(request, env);
      if (denied) return denied;
      try {
        if (url.pathname === '/api/incidents' && request.method === 'GET') return listIncidents(request, env);
        if (url.pathname === '/api/incidents' && request.method === 'POST') return createIncident(request, env);
        const match = url.pathname.match(/^\/api\/incidents\/(\d+)$/);
        if (match && request.method === 'PATCH') return updateIncident(request, env, Number(match[1]));
        return json({ error: 'المسار غير موجود.' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'تعذر تنفيذ العملية. حاول مرة أخرى.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
