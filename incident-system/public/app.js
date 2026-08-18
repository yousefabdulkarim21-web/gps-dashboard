const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const TYPE_LABELS = { stop: 'توقف', speed: 'سرعة', workshop: 'دخول ورشة', fuel: 'استهلاك ديزل' };
const STATUS_LABELS = { open: 'مفتوح', in_progress: 'تحت المتابعة', closed: 'مغلق' };
let incidents = [];
let currentUser = null;
let users = [];
let editingIncidentId = null;
let statusIncidentId = null;

function arabicNumber(value) { return Number(value || 0).toLocaleString('ar-SA'); }
function formatDate(value) { return new Date(value).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }); }
function todayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2600); }

function setConditionalFields(type) {
  ['stop','speed','workshop','fuel'].forEach(name => $(`#${name}Fields`).classList.toggle('hidden', name !== type));
  $('#formTitle').textContent = `إنشاء بلاغ ${TYPE_LABELS[type]}`;
}

function openCreateDialog(type = 'stop') {
  editingIncidentId = null;
  $('#incidentForm').reset();
  $('#incidentType').value = type;
  $('#incidentType').disabled = false;
  $('#submitButton').textContent = 'حفظ وإنشاء الرسالة';
  $('#formError').classList.add('hidden');
  setConditionalFields(type);
  $('#incidentDialog').showModal();
  setTimeout(() => $('#incidentForm [name="equipment_code"]').focus(), 100);
}

function openEditDialog(id) {
  const incident = incidents.find(row => row.id === id);
  if (!incident || !(currentUser?.role === 'admin' || Number(currentUser?.can_edit_incidents) === 1)) return;
  editingIncidentId = id;
  const form = $('#incidentForm');
  form.reset();
  const fields = [
    'equipment_code','project_name','location_name','observer_name','stop_duration',
    'recorded_speed','speed_limit','workshop_name','entry_reason','fuel_before','fuel_after','details'
  ];
  fields.forEach(name => { if (form.elements[name]) form.elements[name].value = incident[name] ?? ''; });
  $('#incidentType').value = incident.incident_type;
  $('#incidentType').disabled = true;
  setConditionalFields(incident.incident_type);
  $('#formTitle').textContent = `تعديل البلاغ ${incident.report_number}`;
  $('#submitButton').textContent = 'حفظ التعديلات';
  $('#formError').classList.add('hidden');
  $('#incidentDialog').showModal();
}

function queryString() {
  const params = new URLSearchParams({ limit: '1000' });
  const values = { search: $('#searchInput').value.trim(), date: $('#dateFilter').value, type: $('#typeFilter').value, status: $('#statusFilter').value };
  Object.entries(values).forEach(([key,value]) => { if (value) params.set(key, value); });
  return params.toString();
}

async function loadIncidents() {
  $('#loadingState').classList.remove('hidden');
  try {
    const response = await fetch(`/api/incidents?${queryString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر تحميل البلاغات.');
    incidents = data.incidents || [];
    currentUser = data.current_user || null;
    if (currentUser) {
      $('#viewerEmail').textContent = currentUser.email;
      $('#viewerRole').textContent = currentUser.role === 'admin' ? 'مدير النظام' : 'مراقب';
      $('#manageUsersButton').classList.toggle('hidden', currentUser.role !== 'admin');
    }
    render();
  } catch (error) {
    $('#incidentsTable').innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  } finally { $('#loadingState').classList.add('hidden'); }
}

async function loadUsers() {
  $('#usersLoading').classList.remove('hidden');
  try {
    const response = await fetch('/api/users');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر تحميل المستخدمين.');
    users = data.users || [];
    renderUsers();
  } catch (error) {
    $('#usersList').innerHTML = `<div class="form-error">${escapeHtml(error.message)}</div>`;
  } finally { $('#usersLoading').classList.add('hidden'); }
}

function renderUsers() {
  $('#usersCount').textContent = arabicNumber(users.length);
  $('#usersList').innerHTML = users.map(user => `
    <article class="user-row ${user.active ? '' : 'inactive'}">
      <span class="user-row-avatar">${escapeHtml((user.full_name || user.email).trim().charAt(0))}</span>
      <div class="user-row-info"><strong>${escapeHtml(user.full_name)}</strong><small>${escapeHtml(user.email)}</small></div>
      <div class="user-row-meta">
        <span class="role-badge ${user.role}">${user.role === 'admin' ? 'مدير نظام' : 'مراقب'}</span>
        <button class="user-toggle ${user.can_edit_incidents ? 'permission-on' : ''}" data-user-edit-toggle="${user.id}" data-can-edit="${user.can_edit_incidents ? '1' : '0'}" type="button" ${user.role === 'admin' ? 'disabled' : ''}>${user.can_edit_incidents ? 'يعدل البلاغات' : 'بدون تعديل'}</button>
        <button class="user-toggle ${user.active ? 'deactivate' : 'activate'}" data-user-toggle="${user.id}" data-active="${user.active ? '1' : '0'}" type="button">${user.active ? 'تعطيل' : 'تفعيل'}</button>
      </div>
    </article>`).join('') || '<div class="empty-users">لا يوجد مستخدمون مسجلون.</div>';
}

async function submitUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#saveUserButton');
  const payload = Object.fromEntries(new FormData(form).entries());
  button.disabled = true; button.textContent = 'جارٍ الإضافة…';
  $('#userFormError').classList.add('hidden');
  try {
    const response = await fetch('/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر إضافة المستخدم.');
    form.reset();
    toast('تمت إضافة المستخدم بنجاح.');
    await loadUsers();
  } catch (error) {
    $('#userFormError').textContent = error.message;
    $('#userFormError').classList.remove('hidden');
  } finally { button.disabled = false; button.textContent = 'إضافة المستخدم'; }
}

async function toggleUser(id, active) {
  const response = await fetch(`/api/users/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: !active }) });
  const data = await response.json();
  if (!response.ok) return toast(data.error || 'تعذر تحديث المستخدم.');
  toast(active ? 'تم تعطيل المستخدم.' : 'تم تفعيل المستخدم.');
  await loadUsers();
}

async function toggleUserEditPermission(id, canEdit) {
  const response = await fetch(`/api/users/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ can_edit_incidents: !canEdit }) });
  const data = await response.json();
  if (!response.ok) return toast(data.error || 'تعذر تحديث صلاحية التعديل.');
  toast(canEdit ? 'تم سحب صلاحية تعديل البلاغات.' : 'تم منح صلاحية تعديل البلاغات.');
  await loadUsers();
}

async function openUsersDialog() {
  $('#usersDialog').showModal();
  await loadUsers();
}

function render() {
  $('#totalMetric').textContent = arabicNumber(incidents.length);
  $('#openMetric').textContent = arabicNumber(incidents.filter(row => row.status === 'open').length);
  $('#progressMetric').textContent = arabicNumber(incidents.filter(row => row.status === 'in_progress').length);
  $('#closedMetric').textContent = arabicNumber(incidents.filter(row => row.status === 'closed').length);
  const canEdit = currentUser?.role === 'admin' || Number(currentUser?.can_edit_incidents) === 1;
  $('#incidentsTable').innerHTML = incidents.map(row => `
    <tr>
      <td class="report-number">${escapeHtml(row.report_number)}</td>
      <td><span class="type-pill">${TYPE_LABELS[row.incident_type] || row.incident_type}</span></td>
      <td>${escapeHtml(row.equipment_code)}</td>
      <td>${formatDate(row.reported_at)}</td>
      <td>${escapeHtml(row.location_name || '—')}</td>
      <td><button class="status status-${row.status}" data-status-id="${row.id}" data-status="${row.status}">${STATUS_LABELS[row.status]}</button></td>
      <td><div class="record-actions"><button class="button button-secondary" data-message-id="${row.id}">عرض الرسالة</button>${canEdit ? `<button class="button button-secondary" data-edit-id="${row.id}">تعديل</button>` : ''}</div></td>
    </tr>`).join('') || '<tr><td colspan="7">لا توجد بلاغات مطابقة.</td></tr>';
}

async function submitIncident(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const button = $('#submitButton');
  const form = new FormData(formElement);
  const payload = Object.fromEntries(form.entries());
  const isEditing = editingIncidentId !== null;
  if (isEditing) payload.action = 'edit';
  button.disabled = true; button.textContent = 'جارٍ الحفظ…';
  try {
    const response = await fetch(isEditing ? `/api/incidents/${editingIncidentId}` : '/api/incidents', { method: isEditing ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر إنشاء البلاغ.');
    $('#incidentDialog').close();
    $('#createdReportNumber').textContent = data.incident.report_number;
    $('#generatedMessage').textContent = data.incident.message_text;
    $('#messageDialog').showModal();
    editingIncidentId = null;
    await loadIncidents();
  } catch (error) {
    $('#formError').textContent = error.message; $('#formError').classList.remove('hidden');
  } finally { button.disabled = false; button.textContent = editingIncidentId === null ? 'حفظ وإنشاء الرسالة' : 'حفظ التعديلات'; }
}

function toggleClosureReason() {
  $('#closureReasonField').classList.toggle('hidden', $('#newStatus').value !== 'closed');
  $('#closureReason').required = $('#newStatus').value === 'closed';
}

function openStatusDialog(id) {
  const incident = incidents.find(row => row.id === id);
  if (!incident) return;
  statusIncidentId = id;
  $('#statusForm').reset();
  $('#statusReportNumber').textContent = incident.report_number;
  $('#newStatus').value = incident.status;
  $('#closureReason').value = incident.closure_reason || '';
  $('#statusFormError').classList.add('hidden');
  toggleClosureReason();
  $('#statusDialog').showModal();
}

async function submitStatus(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const button = $('#saveStatusButton');
  button.disabled = true; button.textContent = 'جارٍ الحفظ…';
  $('#statusFormError').classList.add('hidden');
  try {
    const response = await fetch(`/api/incidents/${statusIncidentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر تحديث حالة البلاغ.');
    $('#statusDialog').close();
    toast(payload.status === 'closed' ? 'تم إغلاق البلاغ وحفظ السبب.' : 'تم تحديث حالة البلاغ.');
    await loadIncidents();
  } catch (error) {
    $('#statusFormError').textContent = error.message;
    $('#statusFormError').classList.remove('hidden');
  } finally { button.disabled = false; button.textContent = 'حفظ الحالة'; }
}

function showMessage(id) {
  const incident = incidents.find(row => row.id === id);
  if (!incident) return;
  $('#createdReportNumber').textContent = incident.report_number;
  $('#generatedMessage').textContent = incident.message_text;
  $('#messageDialog').showModal();
}

function exportExcel() {
  if (!incidents.length) return toast('لا توجد بيانات لتصديرها.');
  if (!window.XLSX) return toast('تعذر تحميل أداة Excel. حاول مرة أخرى.');
  const rows = incidents.map(row => ({
    'رقم البلاغ': row.report_number,
    'نوع البلاغ': TYPE_LABELS[row.incident_type],
    'كود المعدة': row.equipment_code,
    'المشروع / الفرع': row.project_name || '',
    'الموقع': row.location_name || '',
    'الحالة': STATUS_LABELS[row.status],
    'سبب الإغلاق': row.closure_reason || '',
    'أغلق بواسطة': row.closed_by_name || row.closed_by_email || '',
    'تاريخ الإغلاق': row.closed_at ? formatDate(row.closed_at) : '',
    'تاريخ ووقت البلاغ': formatDate(row.reported_at),
    'اسم المراقب': row.observer_name || '',
    'التفاصيل': row.details || '',
    'رسالة التبليغ': row.message_text
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [{wch:20},{wch:18},{wch:20},{wch:22},{wch:25},{wch:16},{wch:35},{wch:24},{wch:24},{wch:24},{wch:20},{wch:35},{wch:60}];
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'سجل البلاغات');
  XLSX.writeFile(workbook, `سجل_بلاغات_GPS_${todayKey()}.xlsx`);
}

const today = new Date();
$('#todayLabel').textContent = today.toLocaleDateString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
$('.calendar-icon').textContent = today.toLocaleDateString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh', day: 'numeric' });
$('#dateFilter').innerHTML += `<option value="${todayKey()}">بلاغات اليوم</option>`;
$('#newIncidentButton').addEventListener('click', () => openCreateDialog());
$$('[data-create-type]').forEach(button => button.addEventListener('click', () => openCreateDialog(button.dataset.createType)));
$('#incidentType').addEventListener('change', event => setConditionalFields(event.target.value));
$('#incidentForm').addEventListener('submit', submitIncident);
$('#closeDialogButton').addEventListener('click', () => $('#incidentDialog').close());
$('#cancelButton').addEventListener('click', () => $('#incidentDialog').close());
$('#closeMessageButton').addEventListener('click', () => $('#messageDialog').close());
$('#doneButton').addEventListener('click', () => $('#messageDialog').close());
$('#copyMessageButton').addEventListener('click', async () => { await navigator.clipboard.writeText($('#generatedMessage').textContent); toast('تم نسخ رسالة التبليغ.'); });
$('#exportButton').addEventListener('click', exportExcel);
$('#heroExportButton').addEventListener('click', exportExcel);
$('#manageUsersButton').addEventListener('click', openUsersDialog);
$('#closeUsersButton').addEventListener('click', () => $('#usersDialog').close());
$('#userForm').addEventListener('submit', submitUser);
$('#usersList').addEventListener('click', event => {
  const button = event.target.closest('[data-user-toggle]');
  const editButton = event.target.closest('[data-user-edit-toggle]');
  if (button) toggleUser(Number(button.dataset.userToggle), button.dataset.active === '1');
  if (editButton && !editButton.disabled) toggleUserEditPermission(Number(editButton.dataset.userEditToggle), editButton.dataset.canEdit === '1');
});
$('#incidentsTable').addEventListener('click', event => {
  const statusButton = event.target.closest('[data-status-id]');
  const messageButton = event.target.closest('[data-message-id]');
  const editButton = event.target.closest('[data-edit-id]');
  if (statusButton) openStatusDialog(Number(statusButton.dataset.statusId));
  if (messageButton) showMessage(Number(messageButton.dataset.messageId));
  if (editButton) openEditDialog(Number(editButton.dataset.editId));
});
$('#statusForm').addEventListener('submit', submitStatus);
$('#newStatus').addEventListener('change', toggleClosureReason);
$('#closeStatusButton').addEventListener('click', () => $('#statusDialog').close());
$('#cancelStatusButton').addEventListener('click', () => $('#statusDialog').close());
let searchTimer;
$('#searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadIncidents, 350); });
['dateFilter','typeFilter','statusFilter'].forEach(id => $(`#${id}`).addEventListener('change', loadIncidents));
loadIncidents();
