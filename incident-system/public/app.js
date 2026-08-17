const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const TYPE_LABELS = { stop: 'توقف', speed: 'سرعة', workshop: 'دخول ورشة', fuel: 'استهلاك ديزل' };
const STATUS_LABELS = { open: 'مفتوح', in_progress: 'تحت المتابعة', closed: 'مغلق' };
let incidents = [];

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
  $('#incidentForm').reset();
  $('#incidentType').value = type;
  $('#formError').classList.add('hidden');
  setConditionalFields(type);
  $('#incidentDialog').showModal();
  setTimeout(() => $('#incidentForm [name="equipment_code"]').focus(), 100);
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
    render();
  } catch (error) {
    $('#incidentsTable').innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  } finally { $('#loadingState').classList.add('hidden'); }
}

function render() {
  $('#totalMetric').textContent = arabicNumber(incidents.length);
  $('#openMetric').textContent = arabicNumber(incidents.filter(row => row.status === 'open').length);
  $('#progressMetric').textContent = arabicNumber(incidents.filter(row => row.status === 'in_progress').length);
  $('#closedMetric').textContent = arabicNumber(incidents.filter(row => row.status === 'closed').length);
  $('#incidentsTable').innerHTML = incidents.map(row => `
    <tr>
      <td class="report-number">${escapeHtml(row.report_number)}</td>
      <td><span class="type-pill">${TYPE_LABELS[row.incident_type] || row.incident_type}</span></td>
      <td>${escapeHtml(row.equipment_code)}</td>
      <td>${formatDate(row.reported_at)}</td>
      <td>${escapeHtml(row.location_name || '—')}</td>
      <td><button class="status status-${row.status}" data-status-id="${row.id}" data-status="${row.status}">${STATUS_LABELS[row.status]}</button></td>
      <td><button class="secondary-button" data-message-id="${row.id}">عرض الرسالة</button></td>
    </tr>`).join('') || '<tr><td colspan="7">لا توجد بلاغات مطابقة.</td></tr>';
}

async function submitIncident(event) {
  event.preventDefault();
  const button = $('#submitButton');
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  button.disabled = true; button.textContent = 'جارٍ الحفظ…';
  try {
    const response = await fetch('/api/incidents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر إنشاء البلاغ.');
    $('#incidentDialog').close();
    $('#createdReportNumber').textContent = data.incident.report_number;
    $('#generatedMessage').textContent = data.incident.message_text;
    $('#messageDialog').showModal();
    await loadIncidents();
  } catch (error) {
    $('#formError').textContent = error.message; $('#formError').classList.remove('hidden');
  } finally { button.disabled = false; button.textContent = 'حفظ وإنشاء الرسالة'; }
}

async function changeStatus(id, current) {
  const order = { open: 'in_progress', in_progress: 'closed', closed: 'open' };
  const response = await fetch(`/api/incidents/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: order[current] }) });
  if (!response.ok) return toast('تعذر تحديث حالة البلاغ.');
  toast('تم تحديث حالة البلاغ.'); await loadIncidents();
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
    'تاريخ ووقت البلاغ': formatDate(row.reported_at),
    'اسم المراقب': row.observer_name || '',
    'التفاصيل': row.details || '',
    'رسالة التبليغ': row.message_text
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [{wch:20},{wch:18},{wch:20},{wch:22},{wch:25},{wch:16},{wch:24},{wch:20},{wch:35},{wch:60}];
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'سجل البلاغات');
  XLSX.writeFile(workbook, `سجل_بلاغات_GPS_${todayKey()}.xlsx`);
}

$('#todayLabel').textContent = new Date().toLocaleDateString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
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
$('#incidentsTable').addEventListener('click', event => {
  const statusButton = event.target.closest('[data-status-id]');
  const messageButton = event.target.closest('[data-message-id]');
  if (statusButton) changeStatus(Number(statusButton.dataset.statusId), statusButton.dataset.status);
  if (messageButton) showMessage(Number(messageButton.dataset.messageId));
});
let searchTimer;
$('#searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadIncidents, 350); });
['dateFilter','typeFilter','statusFilter'].forEach(id => $(`#${id}`).addEventListener('change', loadIncidents));
loadIncidents();
