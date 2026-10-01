const TABLES = {
  rooms: {
    label: 'Kamar', singular: 'Kamar', icon: '⌂',
    fields: [
      { key: 'name', label: 'Nama kamar', type: 'text', required: true },
      { key: 'monthly_price', label: 'Harga per bulan', type: 'number', required: true },
      { key: 'status', label: 'Status', type: 'select', options: [['available', 'Tersedia'], ['occupied', 'Terisi'], ['maintenance', 'Perbaikan']], required: true },
      { key: 'notes', label: 'Catatan', type: 'textarea' }
    ], columns: ['name', 'monthly_price', 'status']
  },
  tenants: {
    label: 'Penghuni', singular: 'Penghuni', icon: '♡',
    fields: [
      { key: 'full_name', label: 'Nama lengkap', type: 'text', required: true },
      { key: 'phone', label: 'Nomor telepon', type: 'tel', required: true },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'room_id', label: 'Kamar', type: 'relation', table: 'rooms', required: true },
      { key: 'move_in_date', label: 'Tanggal masuk', type: 'date', required: true }
    ], columns: ['full_name', 'phone', 'room_id', 'move_in_date']
  },
  invoices: {
    label: 'Tagihan', singular: 'Tagihan', icon: '▤',
    fields: [
      { key: 'tenant_id', label: 'Penghuni', type: 'relation', table: 'tenants', required: true },
      { key: 'period', label: 'Periode tagihan', type: 'month', required: true },
      { key: 'amount', label: 'Jumlah tagihan', type: 'number', required: true },
      { key: 'due_date', label: 'Jatuh tempo', type: 'date', required: true },
      { key: 'status', label: 'Status', type: 'select', options: [['unpaid', 'Belum dibayar'], ['paid', 'Lunas'], ['overdue', 'Terlambat']], required: true }
    ], columns: ['tenant_id', 'period', 'amount', 'due_date', 'status']
  },
  payments: {
    label: 'Pembayaran', singular: 'Pembayaran', icon: '◉',
    fields: [
      { key: 'invoice_id', label: 'Tagihan', type: 'relation', table: 'invoices', required: true },
      { key: 'paid_at', label: 'Tanggal bayar', type: 'date', required: true },
      { key: 'amount', label: 'Jumlah dibayar', type: 'number', required: true },
      { key: 'method', label: 'Metode', type: 'select', options: [['transfer', 'Transfer bank'], ['cash', 'Tunai'], ['ewallet', 'E-wallet']], required: true },
      { key: 'reference', label: 'Referensi', type: 'text' }
    ], columns: ['invoice_id', 'paid_at', 'amount', 'method', 'reference']
  }
};

const state = { current: 'dashboard', rows: {}, settings: readSettings(), editing: null, trackerMonth: new Date().toISOString().slice(0, 7) };
const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const prettyDate = (value) => value ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) : '—';

function readSettings() {
  const defaults = window.KOSTPAY_CONFIG || {};
  try {
    const saved = JSON.parse(localStorage.getItem('kostpay-supabase') || '{}');
    return {
      url: saved.url || defaults.projectUrl || '',
      key: saved.key || defaults.publishableKey || ''
    };
  } catch {
    return { url: defaults.projectUrl || '', key: defaults.publishableKey || '' };
  }
}

function notify(message, kind = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast is-visible ${kind}`;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 3000);
}

function selectedName(table, id) {
  const row = (state.rows[table] || []).find((item) => item.id === id);
  return row ? (row.full_name || row.name || `${row.period || 'Tagihan'} · ${money(row.amount)}`) : 'Data dihapus';
}

function displayValue(table, key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'monthly_price' || key === 'amount') return money(value);
  if (key.endsWith('_date') || key === 'paid_at' || key === 'due_date') return prettyDate(value);
  if (key === 'room_id') return selectedName('rooms', value);
  if (key === 'tenant_id') return selectedName('tenants', value);
  if (key === 'invoice_id') return selectedName('invoices', value);
  const labels = { available: 'Tersedia', occupied: 'Terisi', maintenance: 'Perbaikan', unpaid: 'Belum dibayar', paid: 'Lunas', overdue: 'Terlambat', transfer: 'Transfer bank', cash: 'Tunai', ewallet: 'E-wallet' };
  return labels[value] || value;
}

async function request(table, options = {}) {
  if (!state.settings.url || !state.settings.key) throw new Error('Lengkapi Project URL dan Publishable Key Supabase terlebih dahulu.');
  const base = state.settings.url.replace(/\/+$/, '');
  const response = await fetch(`${base}/rest/v1/${table}${options.query || '?select=*'}`, {
    method: options.method || 'GET',
    headers: {
      apikey: state.settings.key,
      Authorization: `Bearer ${state.settings.key}`,
      'Content-Type': 'application/json',
      Prefer: options.method === 'POST' ? 'return=representation' : 'return=representation'
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.message || detail.details || `Supabase merespons ${response.status}.`);
  }
  return response.status === 204 ? [] : response.json();
}

async function loadData() {
  if (!state.settings.url || !state.settings.key) {
    state.rows = {};
    render();
    openSettings();
    return;
  }
  app.classList.add('is-loading');
  try {
    const results = await Promise.all(Object.keys(TABLES).map((table) => request(table, { query: '?select=*&order=created_at.desc' })));
    Object.keys(TABLES).forEach((table, index) => { state.rows[table] = results[index]; });
    render();
  } catch (error) {
    state.rows = state.rows || {};
    render();
    notify(error.message, 'error');
  } finally {
    app.classList.remove('is-loading');
  }
}

function render() {
  document.querySelectorAll('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === state.current));
  $('#section-label').textContent = state.current === 'dashboard' ? 'Dashboard' : TABLES[state.current].label;
  if (state.current === 'dashboard') renderDashboard();
  else renderTable(state.current);
}

function renderDashboard() {
  const rooms = state.rows.rooms || [];
  const tenants = state.rows.tenants || [];
  const invoices = state.rows.invoices || [];
  const payments = state.rows.payments || [];
  const unpaid = invoices.filter((item) => item.status !== 'paid');
  const paidThisMonth = payments.filter((item) => item.paid_at && item.paid_at.slice(0, 7) === new Date().toISOString().slice(0, 7));
  const totalIncome = paidThisMonth.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const occupied = rooms.filter((room) => room.status === 'occupied').length;
  const recent = [...payments].sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || '')).slice(0, 5);
  const trackerInvoices = invoices.filter((invoice) => invoice.period?.slice(0, 7) === state.trackerMonth);
  const trackerPaid = trackerInvoices.filter((invoice) => invoice.status === 'paid').length;
  const trackerExpected = trackerInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const trackerReceived = trackerInvoices.reduce((sum, invoice) => sum + payments.filter((payment) => payment.invoice_id === invoice.id && payment.paid_at?.slice(0, 7) === state.trackerMonth).reduce((paid, payment) => paid + Number(payment.amount || 0), 0), 0);
  const unbilledTenants = tenants.filter((tenant) => !trackerInvoices.some((invoice) => invoice.tenant_id === tenant.id));
  const trackerProgress = trackerInvoices.length ? Math.round(trackerPaid / trackerInvoices.length * 100) : 0;
  const trackerRows = tenants.map((tenant) => {
    const invoice = trackerInvoices.find((item) => item.tenant_id === tenant.id);
    const room = (state.rows.rooms || []).find((item) => item.id === tenant.room_id);
    const paid = invoice ? payments.filter((payment) => payment.invoice_id === invoice.id).reduce((sum, payment) => sum + Number(payment.amount || 0), 0) : 0;
    return { tenant, invoice, room, paid, remaining: invoice ? Math.max(0, Number(invoice.amount || 0) - paid) : 0 };
  });
  const monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${state.trackerMonth}-01T00:00:00Z`));
  app.innerHTML = `
    <section class="welcome-strip"><div><span class="eyebrow">${new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span><h2>Semua urusan kos, <em>lebih tenang.</em></h2><p>Pantau kamar, penghuni, dan pembayaran dalam satu tempat.</p></div><div class="welcome-stamp" aria-hidden="true"><svg class="dashboard-mark" viewBox="0 0 96 96" fill="none"><rect x="3" y="3" width="90" height="90" rx="27" fill="#DDF1DC"/><path d="M20 43.5 47.5 21 76 43.5v29a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4v-29Z" fill="#FFFDF8" stroke="#44684E" stroke-width="3.5" stroke-linejoin="round"/><path d="M38 76V54h20v22" fill="#F4D8E4" stroke="#44684E" stroke-width="3.5" stroke-linejoin="round"/><path d="M28 47h11v11H28zM58 47h11v11H58z" fill="#D8EBD6" stroke="#44684E" stroke-width="2.5"/><rect x="50" y="31" width="28" height="17" rx="5" transform="rotate(-10 50 31)" fill="#F3C4D6" stroke="#44684E" stroke-width="2.5"/><circle cx="64" cy="37" r="4" fill="#FFFDF8" stroke="#44684E" stroke-width="2"/><path d="m16 28 2.5-5 2.5 5 5 2.5-5 2.5-2.5 5-2.5-5-5-2.5 5-2.5Z" fill="#E8B94D"/></svg><span>rumah nyaman<br>hati tenteram</span></div></section>
    <section class="metric-grid" aria-label="Ringkasan kos">
      <article class="metric-card mint"><span class="metric-label">Pemasukan bulan ini</span><strong>${money(totalIncome)}</strong><span class="metric-foot">${paidThisMonth.length} pembayaran tercatat</span><span class="metric-doodle" aria-hidden="true">↗</span></article>
      <article class="metric-card blush"><span class="metric-label">Kamar terisi</span><strong>${occupied}<small> / ${rooms.length}</small></strong><span class="metric-foot">${rooms.length - occupied} kamar tersedia</span><span class="metric-doodle" aria-hidden="true">⌂</span></article>
      <article class="metric-card butter"><span class="metric-label">Penghuni aktif</span><strong>${tenants.length}</strong><span class="metric-foot">Semua penghuni terdata</span><span class="metric-doodle" aria-hidden="true">♡</span></article>
      <article class="metric-card lilac"><span class="metric-label">Tagihan terbuka</span><strong>${unpaid.length}</strong><span class="metric-foot">${money(unpaid.reduce((sum, item) => sum + Number(item.amount || 0), 0))} belum lunas</span><span class="metric-doodle" aria-hidden="true">✳</span></article>
    </section>
    <section class="surface monthly-tracker"><div class="tracker-heading"><div><span class="eyebrow">Pantau pembayaran</span><h3>Tracker pembayaran kos</h3><p>Ringkasan tagihan dan pembayaran penghuni setiap bulan.</p></div><label class="month-picker"><span>Bulan</span><input id="tracker-month" type="month" value="${escapeHtml(state.trackerMonth)}"></label></div>
      <div class="tracker-summary"><div class="tracker-progress-card"><div class="tracker-progress-heading"><span>${trackerPaid} dari ${trackerInvoices.length} tagihan lunas</span><strong>${trackerProgress}%</strong></div><div class="progress-track"><span style="width:${trackerProgress}%"></span></div><small>${unbilledTenants.length ? `${unbilledTenants.length} penghuni belum ditagih untuk ${escapeHtml(monthLabel)}` : `Semua penghuni sudah memiliki tagihan ${escapeHtml(monthLabel)}`}</small></div><div class="tracker-total"><span>Tagihan bulan ini</span><strong>${money(trackerExpected)}</strong></div><div class="tracker-total received"><span>Sudah diterima</span><strong>${money(trackerReceived)}</strong></div></div>
      ${trackerRows.length ? `<div class="tracker-table-wrap"><table class="tracker-table"><thead><tr><th>Penghuni</th><th>Kamar</th><th>Tagihan</th><th>Jatuh tempo</th><th>Status</th><th class="tracker-actions-head">Aksi</th></tr></thead><tbody>${trackerRows.map(({ tenant, invoice, room, remaining }) => `<tr><td><strong>${escapeHtml(tenant.full_name)}</strong><small>${escapeHtml(tenant.phone || '')}</small></td><td>${escapeHtml(room?.name || '—')}</td><td>${invoice ? money(invoice.amount) : '<span class="muted-cell">Belum ditagih</span>'}</td><td>${invoice ? prettyDate(invoice.due_date) : '—'}</td><td>${invoice ? `<span class="status-pill ${escapeHtml(invoice.status)}">${escapeHtml(displayValue('invoices', 'status', invoice.status))}</span>` : '<span class="status-pill not-billed">Belum ditagih</span>'}</td><td class="tracker-actions">${invoice ? invoice.status !== 'paid' ? `<button class="tracker-action pay-invoice" data-id="${escapeHtml(invoice.id)}" title="Catat pembayaran">Catat bayar <span aria-hidden="true">→</span></button>` : '<span class="paid-check">Lunas ✓</span>' : `<button class="tracker-action create-invoice" data-id="${escapeHtml(tenant.id)}" title="Buat tagihan">Buat tagihan <span aria-hidden="true">+</span></button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="tracker-empty"><span aria-hidden="true">♡</span><strong>Belum ada penghuni terdaftar</strong><p>Tambahkan penghuni dan tagihan untuk mulai melacak pembayaran bulanan.</p></div>'}
    </section>
    <section class="dashboard-lower"><article class="surface recent-surface"><div class="surface-heading"><div><span class="eyebrow">Aktivitas terbaru</span><h3>Pembayaran masuk</h3></div><button class="text-button" data-page="payments">Lihat semua <span aria-hidden="true">→</span></button></div>${recent.length ? `<div class="activity-list">${recent.map((payment) => `<div class="activity-row"><span class="activity-icon">↗</span><span class="activity-person"><strong>${escapeHtml(selectedName('invoices', payment.invoice_id))}</strong><small>${prettyDate(payment.paid_at)} · ${escapeHtml(displayValue('payments', 'method', payment.method))}</small></span><strong class="activity-amount">${money(payment.amount)}</strong></div>`).join('')}</div>` : '<div class="empty-state compact"><span class="empty-illustration">♡</span><strong>Belum ada pembayaran</strong><p>Transaksi yang masuk akan muncul di sini.</p></div>'}</article>
    <article class="surface occupancy-surface"><div class="surface-heading"><div><span class="eyebrow">Sekilas hunian</span><h3>Status kamar</h3></div><span class="soft-count">${rooms.length} kamar</span></div>${rooms.length ? `<div class="room-status-list">${rooms.slice(0, 5).map((room) => `<div class="room-status-row"><span class="room-dot ${escapeHtml(room.status)}"></span><span>${escapeHtml(room.name)}</span><span class="status-pill ${escapeHtml(room.status)}">${escapeHtml(displayValue('rooms', 'status', room.status))}</span></div>`).join('')}</div><button class="outline-button" data-page="rooms">Kelola kamar <span aria-hidden="true">→</span></button>` : '<div class="empty-state compact"><span class="empty-illustration">⌂</span><strong>Mulai dari kamar pertama</strong><p>Tambahkan data kamar untuk melihat ringkasan hunian.</p><button class="outline-button" data-page="rooms">Tambah kamar <span aria-hidden="true">+</span></button></div>'}</article></section>
    <div class="dashboard-note"><span aria-hidden="true">✿</span> Data tersimpan langsung di project Supabase milikmu.</div>`;
  $('#tracker-month').addEventListener('change', (event) => {
    state.trackerMonth = event.target.value || new Date().toISOString().slice(0, 7);
    renderDashboard();
  });
  document.querySelectorAll('.create-invoice').forEach((button) => button.addEventListener('click', () => {
    const tenant = tenants.find((item) => item.id === button.dataset.id);
    const room = (state.rows.rooms || []).find((item) => item.id === tenant?.room_id);
    openForm('invoices', null, {
      tenant_id: tenant?.id || '',
      period: `${state.trackerMonth}-01`,
      amount: room?.monthly_price || '',
      due_date: `${state.trackerMonth}-05`,
      status: 'unpaid'
    });
  }));
  document.querySelectorAll('.pay-invoice').forEach((button) => button.addEventListener('click', () => {
    const invoice = trackerInvoices.find((item) => item.id === button.dataset.id);
    const paid = payments.filter((payment) => payment.invoice_id === invoice?.id).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    openForm('payments', null, {
      invoice_id: invoice?.id || '',
      paid_at: new Date().toISOString().slice(0, 10),
      amount: Math.max(0, Number(invoice?.amount || 0) - paid),
      method: 'transfer'
    });
  }));
}

function renderTable(table) {
  const config = TABLES[table];
  const rows = state.rows[table] || [];
  app.innerHTML = `<section class="page-heading"><div><span class="eyebrow">Data master</span><h2>${config.label}</h2><p>Kelola ${config.label.toLowerCase()} KostPay dengan rapi.</p></div><button class="primary-button" id="add-record"><span aria-hidden="true">+</span> Tambah ${config.singular}</button></section>
  <section class="surface table-surface"><div class="table-toolbar"><span>${rows.length} data tersimpan</span><span class="table-hint">Terhubung dengan Supabase</span></div>${rows.length ? `<div class="table-scroll"><table><thead><tr>${config.columns.map((key) => `<th>${escapeHtml(fieldLabel(config, key))}</th>`).join('')}<th class="actions-heading">Aksi</th></tr></thead><tbody>${rows.map((row) => `<tr>${config.columns.map((key) => `<td>${cellMarkup(table, key, row[key])}</td>`).join('')}<td class="row-actions"><button class="icon-button edit-record" data-id="${escapeHtml(row.id)}" aria-label="Edit" title="Edit data">✎</button><button class="icon-button delete-record" data-id="${escapeHtml(row.id)}" aria-label="Hapus" title="Hapus data">×</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><span class="empty-illustration">${config.icon}</span><strong>Belum ada data ${config.label.toLowerCase()}</strong><p>Data yang kamu tambahkan akan tampil di halaman ini.</p><button class="outline-button" id="empty-add">Tambah ${config.singular} <span aria-hidden="true">+</span></button></div>`}</section>`;
  $('#add-record')?.addEventListener('click', () => openForm(table));
  $('#empty-add')?.addEventListener('click', () => openForm(table));
  document.querySelectorAll('.edit-record').forEach((button) => button.addEventListener('click', () => openForm(table, button.dataset.id)));
  document.querySelectorAll('.delete-record').forEach((button) => button.addEventListener('click', () => removeRecord(table, button.dataset.id)));
}

function fieldLabel(config, key) {
  return config.fields.find((field) => field.key === key)?.label || key;
}

function cellMarkup(table, key, value) {
  if (key === 'status') return `<span class="status-pill ${escapeHtml(value)}">${escapeHtml(displayValue(table, key, value))}</span>`;
  if (key === 'reference') return `<span class="muted-cell">${escapeHtml(value || '—')}</span>`;
  return escapeHtml(displayValue(table, key, value));
}

function openForm(table, id = null, initial = {}) {
  const config = TABLES[table];
  const current = id ? (state.rows[table] || []).find((row) => row.id === id) : initial;
  state.editing = { table, id };
  $('#modal-title').textContent = `${id ? 'Edit' : 'Tambah'} ${config.singular}`;
  $('#modal-content').innerHTML = `<form id="record-form" class="record-form">${config.fields.map((field) => {
    const value = current?.[field.key] ?? '';
    const required = field.required ? 'required' : '';
    if (field.type === 'select') return `<label class="form-field"><span>${field.label}</span><select name="${field.key}" ${required}><option value="">Pilih ${field.label.toLowerCase()}</option>${field.options.map(([option, label]) => `<option value="${option}" ${value === option ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
    if (field.type === 'relation') return `<label class="form-field"><span>${field.label}</span><select name="${field.key}" ${required}><option value="">Pilih ${field.label.toLowerCase()}</option>${(state.rows[field.table] || []).map((item) => `<option value="${item.id}" ${value === item.id ? 'selected' : ''}>${escapeHtml(selectedName(field.table, item.id))}</option>`).join('')}</select></label>`;
    if (field.type === 'textarea') return `<label class="form-field full-field"><span>${field.label}</span><textarea name="${field.key}" rows="3" placeholder="Tambahkan catatan...">${escapeHtml(value)}</textarea></label>`;
    const inputValue = field.type === 'month' && value ? String(value).slice(0, 7) : value;
    return `<label class="form-field"><span>${field.label}</span><input name="${field.key}" type="${field.type}" value="${escapeHtml(inputValue)}" ${field.type === 'number' ? 'min="0" step="1000"' : ''} ${required}></label>`;
  }).join('')}<div class="form-actions"><button type="button" class="secondary-button" id="cancel-form">Batal</button><button class="primary-button" type="submit">Simpan data <span aria-hidden="true">→</span></button></div></form>`;
  $('#modal').showModal();
  $('#cancel-form').addEventListener('click', () => $('#modal').close());
  $('#record-form').addEventListener('submit', saveRecord);
}

async function saveRecord(event) {
  event.preventDefault();
  const { table, id } = state.editing;
  const config = TABLES[table];
  const form = new FormData(event.currentTarget);
  const record = {};
  config.fields.forEach((field) => {
    const value = form.get(field.key);
    record[field.key] = value === '' ? null : field.type === 'number' ? Number(value) : field.type === 'month' ? `${value}-01` : value;
  });
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await request(table, { method: id ? 'PATCH' : 'POST', query: id ? `?id=eq.${encodeURIComponent(id)}` : '?select=*', body: record });
    $('#modal').close();
    notify(id ? 'Data berhasil diperbarui.' : 'Data berhasil ditambahkan.');
    await loadData();
  } catch (error) {
    notify(error.message, 'error');
    button.disabled = false;
  }
}

async function removeRecord(table, id) {
  const row = (state.rows[table] || []).find((item) => item.id === id);
  const label = row?.full_name || row?.name || 'data ini';
  if (!window.confirm(`Hapus ${label}? Tindakan ini tidak dapat dibatalkan.`)) return;
  try {
    await request(table, { method: 'DELETE', query: `?id=eq.${encodeURIComponent(id)}` });
    notify('Data berhasil dihapus.');
    await loadData();
  } catch (error) {
    notify(error.message, 'error');
  }
}

function openSettings() {
  $('#settings-url').value = state.settings.url || '';
  $('#settings-key').value = state.settings.key || '';
  $('#settings-modal').showModal();
}

$('#settings-button').addEventListener('click', openSettings);
$('#settings-button-top').addEventListener('click', openSettings);
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = $('#settings-url').value.trim().replace(/\/+$/, '');
  const key = $('#settings-key').value.trim();
  if (!/^https:\/\/[\w.-]+\.supabase\.co$/i.test(url)) {
    notify('Project URL Supabase belum sesuai.', 'error');
    return;
  }
  if (!key) {
    notify('Publishable Key belum diisi.', 'error');
    return;
  }
  state.settings = { url, key };
  localStorage.setItem('kostpay-supabase', JSON.stringify(state.settings));
  $('#settings-modal').close();
  await loadData();
});
$('#settings-close').addEventListener('click', () => $('#settings-modal').close());
$('#modal-close').addEventListener('click', () => $('#modal').close());
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]');
  if (!button || !TABLES[button.dataset.page] && button.dataset.page !== 'dashboard') return;
  event.preventDefault();
  state.current = button.dataset.page;
  render();
});
$('#reset-settings').addEventListener('click', async () => {
  localStorage.removeItem('kostpay-supabase');
  state.settings = readSettings();
  state.rows = {};
  $('#settings-key').value = state.settings.key;
  $('#settings-url').value = state.settings.url;
  if (state.settings.url && state.settings.key) {
    $('#settings-modal').close();
    await loadData();
  } else {
    notify('Konfigurasi lokal dihapus. Isi config.js untuk koneksi bawaan.');
  }
});

loadData();
