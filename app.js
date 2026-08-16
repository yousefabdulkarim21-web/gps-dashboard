const $ = (id) => document.getElementById(id);
const types = { 'بلاغات التوقف':'توقف', 'دخول وخروج الورشة':'ورشة', 'بلاغات السرعة':'سرعة', 'استهلاك الديزل':'ديزل' };
let allCases = [];

function clean(value) { return String(value ?? '').trim(); }
function key(value) { return clean(value).replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' '); }
function field(row, names) { const keys = Object.keys(row); const found = keys.find(k => names.some(n => key(k).includes(key(n)))); return found ? clean(row[found]) : ''; }
function typeForSheet(name) { return types[name] || clean(name); }
function hasId(c) { return Boolean(c.id); }
function isClosed(c) { return /مغلق|مقف|closed|تم الاغلاق/i.test(c.status); }
function isOpen(c) { return hasId(c) && !isClosed(c); }
function dateScore(s) { const t = Date.parse(String(s).replace(/(\d{2})\/(\d{2})\/(\d{4})/,'$3-$2-$1')); return Number.isNaN(t) ? 0 : t; }
function overdue(c) { if (isClosed(c)) return false; if (/متاخر|متأخر|overdue/i.test(c.status)) return true; const age = Date.now() - dateScore(c.date); return dateScore(c.date) && age > 24*60*60*1000; }
function inWorkshop(c) { return c.type === 'ورشة' && !c.exitDate && !isClosed(c); }
function longStop(c) { return c.type === 'توقف' && (/3\s*ساع|اكثر من 3|أكثر من 3/i.test(`${c.duration} ${c.description}`)); }
function count(fn) { return allCases.filter(fn).length; }
function set(id, value) { $(id).textContent = value.toLocaleString('ar-SA'); }

function readFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const book = XLSX.read(e.target.result, {type:'array', cellDates:true});
    allCases = [];
    book.SheetNames.forEach(sheetName => {
      const matrix = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {header:1, defval:''});
      const headerIndex = matrix.findIndex(row => row.some(cell => key(cell).includes('رقم البلاغ')));
      if (headerIndex < 0) return;
      const headers = matrix[headerIndex].map(clean);
      const rows = matrix.slice(headerIndex + 1).map(values => Object.fromEntries(headers.map((h,i)=>[h,values[i] ?? ''])));
      rows.forEach(row => {
        const c = {
          id: field(row,['رقم البلاغ']), type:typeForSheet(sheetName),
          vehicle:field(row,['رقم المركبة','المركبة']), date:field(row,['تاريخ البلاغ','تاريخ الدخول','التاريخ']),
          status:field(row,['الحالة','حالة بلاغ SAP']), duration:field(row,['مدة التوقف','المدة']),
          description:field(row,['الوصف','ملاحظات','سبب الدخول']), exitDate:field(row,['تاريخ الخروج'])
        };
        if (hasId(c)) allCases.push(c);
      });
    });
    render(file.name);
  };
  reader.readAsArrayBuffer(file);
}

function renderBars(id, rows) {
  const max = Math.max(...rows.map(x => x.value), 1);
  $(id).innerHTML = rows.map(x => `<div><div class="bar-title"><span>${x.label}</span><strong>${x.value}</strong></div><div class="track"><div class="fill" style="width:${x.value/max*100}%"></div></div></div>`).join('');
}
function badge(c) { const cls = isClosed(c) ? 'closed' : overdue(c) ? 'late' : ''; return `<span class="badge ${cls}">${c.status || (isClosed(c)?'مغلق':'مفتوح')}</span>`; }
function renderTable() {
  const selected = $('typeFilter').value;
  const rows = allCases.filter(c => selected === 'all' || c.type === selected).sort((a,b)=>dateScore(b.date)-dateScore(a.date)).slice(0,15);
  $('casesTable').innerHTML = rows.map(c => `<tr><td>${c.id}</td><td>${c.type}</td><td>${c.vehicle || '—'}</td><td>${c.date || '—'}</td><td>${c.description || '—'}</td><td>${badge(c)}</td></tr>`).join('') || '<tr><td colspan="6">لا توجد بيانات مطابقة</td></tr>';
}
function render(fileName) {
  $('emptyState').classList.add('hidden'); $('dashboard').classList.remove('hidden');
  $('fileName').textContent = `المصدر: ${fileName}`; $('lastUpdated').textContent = `آخر قراءة: ${new Date().toLocaleString('ar-SA')}`;
  set('total', count(hasId)); set('open', count(isOpen)); set('closed', count(isClosed)); set('late', count(overdue)); set('stops', count(longStop)); set('workshop', count(inWorkshop)); set('speed', count(c=>c.type==='سرعة')); set('fuel', count(c=>c.type==='ديزل'));
  const labels = ['توقف','ورشة','سرعة','ديزل'];
  renderBars('typeBars', labels.map(label=>({label,value:count(c=>c.type===label)})));
  renderBars('openBars', labels.map(label=>({label,value:count(c=>c.type===label && isOpen(c))})));
  $('typeFilter').innerHTML = '<option value="all">كل الأنواع</option>' + labels.map(x=>`<option value="${x}">${x}</option>`).join('');
  renderTable();
}
$('fileInput').addEventListener('change', e => { if(e.target.files[0]) readFile(e.target.files[0]); });
$('typeFilter').addEventListener('change', renderTable);
