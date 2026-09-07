// URL API di-hardcode di sini supaya menu "Pengaturan Awal" tidak perlu ditampilkan.
// Kalau nanti mau pakai lagi menu input URL manual, tinggal aktifkan lagi
// blok setup-banner di HTML (dikomen di index.html) dan bagian di DOMContentLoaded di bawah.
var DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbwzNOiozb6RbXT4JSBr5GBQq950vuq3_gCgJq9ySGkQnmen3RRMPzlhrFrzy46JzvPo/exec';
var API_URL = localStorage.getItem('iuranrt_api_url') || DEFAULT_API_URL;
var currentData = null;
var sheetsInfo = [];
var wargaData = [];
var selectedJurnalSection = -1;
var selectedIuranMonth = -1;
var isAuthenticated = false;
var AUTH_TOKEN_KEY = 'iuranrt_auth_token';

document.addEventListener('DOMContentLoaded', function () {
  checkAuth();
  // Menu setup URL manual dinonaktifkan sementara — langsung load data karena
  // API_URL sudah terisi otomatis dari DEFAULT_API_URL.
  loadSheets();
  showBackendVersion();
});

function saveApiUrl() {
  var url = document.getElementById('apiUrlInput').value.trim();
  if (!url || !url.startsWith('https://script.google.com/')) {
    showToast('URL tidak valid', 'error');
    return;
  }
  API_URL = url;
  localStorage.setItem('iuranrt_api_url', url);
  document.getElementById('setupBanner').style.display = 'none';
  showToast('URL berhasil disimpan!', 'success');
  loadSheets();
}

function checkAuth() {
  isAuthenticated = !!localStorage.getItem(AUTH_TOKEN_KEY);
  updateAuthUI();
  return isAuthenticated;
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function updateAuthUI() {
  document.body.classList.toggle('logged-in', isAuthenticated);
  var authSection = document.getElementById('authStatus');
  if (!authSection) return;
  if (isAuthenticated) {
    authSection.innerHTML = '<span>Masuk sebagai admin</span><button class="btn btn-secondary btn-sm" onclick="logout()">Logout</button>';
  } else {
    authSection.innerHTML = '<span>Login untuk aktifkan fitur tambah/edit/hapus</span><button class="btn btn-primary btn-sm" onclick="openLoginModal()">Login</button>';
  }
  var addBtn = document.getElementById('addTransactionBtn');
  if (addBtn) addBtn.style.display = isAuthenticated ? 'inline-flex' : 'none';
}

function openLoginModal() { document.getElementById('loginModal').classList.add('active'); }
function closeLoginModal() {
  document.getElementById('loginModal').classList.remove('active');
  var input = document.getElementById('loginPassword');
  if (input) {
    input.value = '';
    input.type = 'password';
  }
  var icon = document.getElementById('togglePasswordIcon');
  if (icon) icon.textContent = '👁️';
}

function login() {
  var password = document.getElementById('loginPassword').value || '';
  if (!password) { showToast('Masukkan password', 'error'); return; }
  apiPost({ action: 'login', password: password }).then(function (r) {
    if (r.error) { showToast(r.error, 'error'); return; }
    localStorage.setItem(AUTH_TOKEN_KEY, r.token);
    isAuthenticated = true;
    closeLoginModal();
    updateAuthUI();
    refreshCurrentView();
    showToast('Berhasil login', 'success');
  });
}

function logout() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  isAuthenticated = false;
  updateAuthUI();
  refreshCurrentView();
  showToast('Logout berhasil', 'info');
}

function refreshCurrentView() {
  var sel = document.getElementById('sheetSelect');
  if (sel && sel.value) loadData(sel.value);
}

function requireAuth(action) {
  if (!checkAuth()) {
    showToast('Harap login untuk ' + action, 'error');
    return false;
  }
  return true;
}

function apiGet(action, params) {
  var url = API_URL + '?action=' + action;
  if (params) {
    for (var k in params) {
      if (params[k] != null && params[k] !== '') url += '&' + k + '=' + encodeURIComponent(params[k]);
    }
  }
  return fetch(url)
    .then(handleApiResponse)
    .catch(function (e) {
      showToast('Gagal: ' + e.message, 'error');
      throw e;
    });
}

function apiPost(data) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(data),
    redirect: 'follow'
  })
    .then(handleApiResponse)
    .catch(function (e) {
      showToast('Gagal: ' + e.message, 'error');
      throw e;
    });
}

// Menangani response fetch dengan aman: cek status HTTP dulu, lalu coba
// parse JSON. Kalau server balas HTML/teks (error, expired, quota habis,
// dll), user dapat pesan yang jelas alih-alih error parsing yang membingungkan.
function handleApiResponse(r) {
  return r.text().then(function (raw) {
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      if (!r.ok) {
        throw new Error('Server error (HTTP ' + r.status + '). Coba lagi beberapa saat lagi.');
      }
      throw new Error('Respons server tidak dikenali. Coba refresh halaman.');
    }
    if (!r.ok && !parsed.error) {
      throw new Error('Server error (HTTP ' + r.status + ').');
    }
    return parsed;
  });
}

function hideAllViews() {
  ['viewJurnal','viewIuran','viewDonasi','viewRekap','viewKwintansi','viewLoading'].forEach(function(id) {
    document.getElementById(id).style.display = 'none';
  });
  updatePerRumahButton(null);
}

function updatePerRumahButton(data) {
  var btn = document.getElementById('perRumahBtn');
  if (!btn) return;
  var show = data && data.type === 'iuran' && !data.hideNoRumah;
  btn.style.display = show ? 'inline-flex' : 'none';
}

function loadSheets() {
  hideAllViews();
  document.getElementById('viewLoading').style.display = 'block';
  apiGet('getSheets').then(function (r) {
    if (r.error) {
      showToast('Error: ' + r.error, 'error');
      hideAllViews();
      return;
    }
    if (!r.sheets || !Array.isArray(r.sheets) || r.sheets.length === 0) {
      showToast('Tidak ada sheet ditemukan. Cek SPREADSHEET_ID di Code.gs', 'error');
      hideAllViews();
      return;
    }
    sheetsInfo = r.sheets;
    var sel = document.getElementById('sheetSelect');
    sel.innerHTML = '';
    var typeLabels = { jurnal: 'Jurnal', iuran: 'Iuran', donasi: 'Donasi', rekap: 'Rekap', kwintansi: 'Kwintansi' };
    r.sheets.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name + (typeLabels[s.type] ? ' [' + typeLabels[s.type] + ']' : '');
      sel.appendChild(opt);
    });
    var optNew = document.createElement('option');
    optNew.value = '__NEW__';
    optNew.textContent = '+ Tambah Bulan Baru...';
    sel.appendChild(optNew);
    if (r.sheets.length > 0) sel.value = r.sheets[0].name;
    onSheetChange();
    loadWarga();
  });
}

function onSheetChange() {
  var sel = document.getElementById('sheetSelect');
  var val = sel.value;
  if (val === '__NEW__') {
    openNewMonthModal();
    if (sheetsInfo.length > 0) sel.value = sheetsInfo[0].name;
    return;
  }
  if (!val || val === '' || val === 'undefined') {
    hideAllViews();
    return;
  }
  selectedJurnalSection = -1;
  selectedIuranMonth = -1;
  loadData(val);
}

function loadData(sheetName) {
  if (!sheetName) { hideAllViews(); return; }
  hideAllViews();
  document.getElementById('viewLoading').style.display = 'block';
  apiGet('getData', { sheet: sheetName }).then(function (r) {
    hideAllViews();
    if (r.error) { showToast(r.error, 'error'); return; }
    currentData = r;
    updatePerRumahButton(r);
    switch (r.type) {
      case 'iuran': renderIuranView(r); break;
      case 'donasi': renderDonasiView(r); break;
      case 'rekap': renderRekapView(r); break;
      case 'kwintansi': renderKwintansiView(r); break;
      default: renderJurnalView(r);
    }
  });
}

function loadWarga() {
  apiGet('getWarga').then(function (r) {
    if (r && r.warga) {
      wargaData = r.warga;
      var dl = document.getElementById('wargaList');
      dl.innerHTML = '';
      r.warga.forEach(function (w) {
        var o = document.createElement('option');
        o.value = w.nama;
        dl.appendChild(o);
      });
    }
  });
}

function setupJurnalMonthSelect(sections) {
  var select = document.getElementById('jurnalMonthSelect');
  if (!select) return;
  if (!sections || sections.length <= 1) {
    select.style.display = 'none';
    selectedJurnalSection = -1;
    return;
  }
  select.style.display = 'inline-flex';
  select.innerHTML = '';
  sections.forEach(function (sec, idx) {
    var opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = sec.bulan || sec.header || 'Bulan ' + (idx + 1);
    select.appendChild(opt);
  });
  if (selectedJurnalSection < 0 || selectedJurnalSection >= sections.length)
    selectedJurnalSection = getCurrentMonthDefaultIndex(sections, function (sec) { return sec.bulan || sec.header; });
  select.value = selectedJurnalSection;
}

function onJurnalSectionChange() {
  var select = document.getElementById('jurnalMonthSelect');
  if (!select) return;
  selectedJurnalSection = parseInt(select.value, 10);
  renderJurnalView(currentData);
}

function setupIuranMonthSelect(months) {
  var select = document.getElementById('iuranMonthSelect');
  if (!select) return;
  if (!months || months.length <= 1) {
    select.style.display = 'none';
    selectedIuranMonth = -1;
    return;
  }
  select.style.display = 'inline-flex';
  select.innerHTML = '';
  months.forEach(function (month, idx) {
    var opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = month.title || 'Bulan ' + (idx + 1);
    select.appendChild(opt);
  });
  if (selectedIuranMonth < 0 || selectedIuranMonth >= months.length)
    selectedIuranMonth = getCurrentMonthDefaultIndex(months, function (month) { return month.title; });
  select.value = selectedIuranMonth;
}

function onIuranMonthChange() {
  var select = document.getElementById('iuranMonthSelect');
  if (!select) return;
  selectedIuranMonth = parseInt(select.value, 10);
  renderIuranView(currentData);
}

// ==================== JURNAL ====================
function renderJurnalView(data) {
  document.getElementById('viewJurnal').style.display = 'block';
  var c = document.getElementById('jurnalContent');
  if (!data.sections || !data.sections.length) {
    c.innerHTML = '<div class="empty-state">Tidak ada data transaksi</div>';
    setCards(0, 0, 0, 0);
    return;
  }
  setupJurnalMonthSelect(data.sections);
  var sectionsToRender = data.sections;
  if (selectedJurnalSection >= 0 && selectedJurnalSection < data.sections.length) {
    sectionsToRender = [data.sections[selectedJurnalSection]];
  }
  var html = '', gP = 0, gE = 0, gS = 0, gT = 0;
  sectionsToRender.forEach(function (sec, si) {
    gP += sec.totalPemasukan;
    gE += sec.totalPengeluaran;
    gS = sec.saldo;
    gT += sec.transactions.length;
    if (data.sections.length > 1) {
      html += '<div class="section-header"><h3>' + esc(sec.bulan || sec.header) + '</h3>' +
        '<div class="section-stats">Pemasukan: <span class="amount-in">Rp ' + fmt(sec.totalPemasukan) + '</span> | Pengeluaran: <span class="amount-out">Rp ' + fmt(sec.totalPengeluaran) + '</span> | Saldo: <span class="amount-saldo">Rp ' + fmt(sec.saldo) + '</span></div></div>';
    }
    html += '<div class="table-container"><table><thead><tr>' +
      '<th>No</th><th>Tanggal</th><th>Nama</th><th class="hide-mobile">No.Rumah</th><th>Transaksi</th>' +
      '<th class="text-right">Pemasukan</th><th class="text-right">Pengeluaran</th><th class="text-right">Saldo</th>' +
      '<th class="hide-mobile">Metode</th><th class="hide-mobile">Ket</th><th class="text-center">Aksi</th></tr></thead><tbody>';
    sec.transactions.forEach(function (t) {
      var cls = t.isSaldoAwal ? 'row-saldo-awal' : (t.pengeluaran > 0 && !t.pemasukan ? 'row-pengeluaran' : '');
      html += '<tr class="jurnal-row ' + cls + '">' +
        '<td>' + t.no + '</td><td style="white-space:nowrap">' + esc(t.tanggal) + '</td><td>' + esc(t.nama) + '</td>' +
        '<td class="hide-mobile">' + esc(t.noRumah) + '</td><td>' + esc(t.transaksi) + '</td>' +
        '<td class="text-right">' + (t.pemasukan ? '<span class="amount-in">Rp ' + fmt(t.pemasukan) + '</span>' : '-') + '</td>' +
        '<td class="text-right">' + (t.pengeluaran ? '<span class="amount-out">Rp ' + fmt(t.pengeluaran) + '</span>' : '-') + '</td>' +
        '<td class="text-right"><span class="amount-saldo">Rp ' + fmt(t.saldo) + '</span></td>' +
        '<td class="hide-mobile">' + renderBadge(t.metode) + '</td>' +
        '<td class="hide-mobile">' + esc(t.keterangan) + renderImgLink(t.linkGambar) + '</td>' +
        '<td class="text-center">' + ((t.isSaldoAwal || !isAuthenticated) ? '-' :
          '<div class="action-buttons">' +
          '<button class="btn btn-secondary btn-sm" onclick="openEditModal(' + si + ',' + t.rowIndex + ')">E</button>' +
          '<button class="btn btn-success btn-sm" onclick="openBuktiModal(' + t.rowIndex + ')">B</button>' +
          '<button class="btn btn-danger btn-sm" onclick="confirmDelete(' + t.rowIndex + ')">H</button>' +
          '</div>') + '</td></tr>';
    });
    html += '</tbody></table></div>';
  });
  c.innerHTML = html;
  setCards(gP, gE, gS, gT);
}

function setCards(p, e, s, t) {
  document.getElementById('totalPemasukan').textContent = 'Rp ' + fmt(p);
  document.getElementById('totalPengeluaran').textContent = 'Rp ' + fmt(e);
  document.getElementById('totalSaldo').textContent = 'Rp ' + fmt(s);
  document.getElementById('totalTransaksi').textContent = t;
}

// ==================== IURAN ====================
function renderIuranView(data) {
  document.getElementById('viewIuran').style.display = 'block';
  if (!data.months || !data.months.length) {
    document.getElementById('iuranGrid').innerHTML = '<div class="empty-state">Tidak ada data iuran</div>';
    document.getElementById('iuranSummaryCards').innerHTML = '';
    return;
  }
  setupIuranMonthSelect(data.months);
  var monthsToRender = data.months;
  if (selectedIuranMonth >= 0 && selectedIuranMonth < data.months.length) {
    monthsToRender = [data.months[selectedIuranMonth]];
  }
  var totalU = 0;
  monthsToRender.forEach(function (m) { totalU += m.total; });
  document.getElementById('iuranSummaryCards').innerHTML =
    '<div class="card"><div class="card-label">Bulan Ditampilkan</div><div class="card-value" style="color:var(--primary)">' + monthsToRender.length + '</div></div>' +
    '<div class="card"><div class="card-label">Total Iuran</div><div class="card-value" style="color:var(--success)">Rp ' + fmt(totalU) + '</div></div>' +
    '<div class="card"><div class="card-label">Sheet</div><div class="card-value" style="color:var(--gray-700);font-size:0.95rem">' + esc(data.sheetName) + '</div></div>';
  var html = '';
  var noRumahHeader = data.hideNoRumah ? '' : '<th>No.Rumah</th>';
  monthsToRender.forEach(function (m) {
    html += '<div class="iuran-card iuran-month-card"><div class="iuran-card-header"><span>' + esc(m.title) + '</span><span class="warga-count">' + m.jumlahWarga + ' warga</span></div>' +
      '<table><thead><tr><th>No</th><th>Tanggal</th><th>Nama</th>' + noRumahHeader + '<th class="text-right">Nominal</th></tr></thead><tbody>';
    m.entries.forEach(function (e) {
      var noRumahCell = data.hideNoRumah ? '' : '<td>' + esc(e.noRumah) + '</td>';
      html += '<tr class="iuran-entry-row"><td>' + e.no + '</td><td style="white-space:nowrap;font-size:0.75rem">' + esc(e.tanggal) + '</td><td>' + esc(e.nama) + '</td>' + noRumahCell + '<td class="text-right amount-in">Rp ' + fmt(e.nominal) + '</td></tr>';
    });
    html += '</tbody></table><div class="iuran-card-footer"><span class="total-label">Total</span><span class="total-value">Rp ' + fmt(m.total) + '</span></div></div>';
  });
  document.getElementById('iuranGrid').innerHTML = html;
}

// ==================== DONASI ====================
function renderDonasiView(data) {
  document.getElementById('viewDonasi').style.display = 'block';
  document.getElementById('donasiSummaryCards').innerHTML =
    '<div class="card"><div class="card-label">Total Donasi</div><div class="card-value" style="color:var(--purple)">' + (data.entries ? data.entries.length : 0) + '</div></div>' +
    '<div class="card"><div class="card-label">Sheet</div><div class="card-value" style="color:var(--gray-700);font-size:0.95rem">' + esc(data.sheetName) + '</div></div>';
  if (!data.entries || !data.entries.length) {
    document.getElementById('donasiContent').innerHTML = '<div class="empty-state">Tidak ada data donasi</div>';
    return;
  }
  var html = '';
  data.entries.forEach(function (e) {
    html += '<div class="donasi-card"><div class="donasi-no">' + e.no + '</div>' +
      '<div class="donasi-info"><div class="donasi-nama">' + esc(e.nama) + (e.noRumah ? ' (' + esc(e.noRumah) + ')' : '') + '</div>' +
      '<div class="donasi-tanggal">' + esc(e.tanggal) + '</div></div>' +
      '<div class="donasi-berupa">' + esc(e.berupa) + '</div></div>';
  });
  document.getElementById('donasiContent').innerHTML = html;
}

// ==================== REKAP ====================
function renderRekapView(data) {
  document.getElementById('viewRekap').style.display = 'block';
  if (!data.tables || !data.tables.length) {
    document.getElementById('rekapContent').innerHTML = '<div class="empty-state">Tidak ada data rekap</div>';
    return;
  }
  var html = '';
  data.tables.forEach(function (tbl) {
    var resume = tbl.total || { pemasukan: 0, pengeluaran: 0, saldo: 0 };
    if (!tbl.total && tbl.rows && tbl.rows.length) {
      tbl.rows.forEach(function (r) {
        resume.pemasukan += r.pemasukan || 0;
        resume.pengeluaran += r.pengeluaran || 0;
        if (r.saldo) resume.saldo = r.saldo;
      });
    }
    html += '<div class="rekap-section"><div class="rekap-title">' + esc(tbl.title) + '</div>' +
      '<div class="rekap-total">' +
      '<span>Pemasukan: <span class="amount-in">Rp ' + fmt(resume.pemasukan) + '</span></span>' +
      '<span>Pengeluaran: <span class="amount-out">Rp ' + fmt(resume.pengeluaran) + '</span></span>' +
      '<span>Saldo Akhir: <span class="amount-saldo">Rp ' + fmt(resume.saldo) + '</span></span></div>' +
      '<div class="table-container" style="border-radius:0 0 var(--radius) var(--radius)"><table><thead><tr>' +
      '<th>No</th><th>Tanggal</th><th>Transaksi</th><th class="text-right">Pemasukan</th><th class="text-right">Pengeluaran</th><th class="text-right">Saldo</th><th class="hide-mobile">Keterangan</th><th class="hide-mobile">Bukti</th></tr></thead><tbody>';
    tbl.rows.forEach(function (r) {
      html += '<tr class="rekap-row">' +
        '<td>' + (r.no || '') + '</td><td style="white-space:nowrap">' + esc(r.tanggal) + '</td><td>' + esc(r.transaksi) + '</td>' +
        '<td class="text-right">' + (r.pemasukan ? '<span class="amount-in">Rp ' + fmt(r.pemasukan) + '</span>' : '-') + '</td>' +
        '<td class="text-right">' + (r.pengeluaran ? '<span class="amount-out">Rp ' + fmt(r.pengeluaran) + '</span>' : '-') + '</td>' +
        '<td class="text-right"><span class="amount-saldo">Rp ' + fmt(r.saldo) + '</span></td>' +
        '<td class="hide-mobile">' + esc(r.keterangan) + '</td>' +
        '<td class="hide-mobile">' + renderImgLink(r.linkGambar) + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
  });
  document.getElementById('rekapContent').innerHTML = html;
}

// ==================== KWINTANSI ====================
function renderKwintansiView(data) {
  document.getElementById('viewKwintansi').style.display = 'block';
  var totalN = 0;
  if (data.entries) data.entries.forEach(function (e) { totalN += e.nominal; });
  document.getElementById('kwintansiSummaryCards').innerHTML =
    '<div class="card"><div class="card-label">Jumlah Kwintansi</div><div class="card-value" style="color:var(--teal)">' + (data.entries ? data.entries.length : 0) + '</div></div>' +
    '<div class="card"><div class="card-label">Total Nominal</div><div class="card-value" style="color:var(--danger)">Rp ' + fmt(totalN) + '</div></div>';
  if (!data.entries || !data.entries.length) {
    document.getElementById('kwintansiContent').innerHTML = '<div class="empty-state">Tidak ada data kwintansi</div>';
    return;
  }
  var html = '';
  data.entries.forEach(function (e) {
    html += '<div class="kwintansi-card">' +
      '<div class="kwintansi-card-header">' +
      '<span><span class="kwintansi-no">#' + e.no + '</span></span>' +
      '<span class="kwintansi-nominal">' + (e.nominal ? 'Rp ' + fmt(e.nominal) : '-') + '</span></div>' +
      '<div class="kwintansi-body">' +
      '<div class="kwintansi-ket">' + esc(e.keterangan) + '</div>' +
      '<div class="kwintansi-tanggal">' + esc(e.tanggal) + '</div>' +
      (e.subInfo ? '<div class="kwintansi-sub">' + esc(e.subInfo) + '</div>' : '') +
      (e.linkGambar ? '<div class="kwintansi-image"><a href="' + esc(e.linkGambar) + '" target="_blank">Lihat Bukti / Gambar</a></div>' : '') +
      '<div style="margin-top:0.5rem"><button class="btn btn-sm btn-purple admin-only" onclick="openImageModal(' + e.rowIndex + ',5,\'' + esc(e.linkGambar) + '\')">' + (e.linkGambar ? 'Ubah Link Gambar' : '+ Tambah Gambar') + '</button></div>' +
      '</div></div>';
  });
  document.getElementById('kwintansiContent').innerHTML = html;
}

// ==================== FILTER ====================
function filterRows(selector) {
  var inputId = { '.jurnal-row': 'searchInput', '.iuran-entry-row': 'iuranSearch', '.donasi-card': 'donasiSearch', '.rekap-row': 'rekapSearch', '.kwintansi-card': 'kwintansiSearch' }[selector] || 'searchInput';
  var q = document.getElementById(inputId).value.toLowerCase();
  document.querySelectorAll(selector).forEach(function (el) {
    el.style.display = el.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
  });
}

// ==================== MODALS ====================
function openAddModal() {
  if (!requireAuth('menambahkan transaksi')) return;
  document.getElementById('modalTitle').textContent = 'Tambah Transaksi';
  document.getElementById('editRowIndex').value = '';
  document.getElementById('formTanggal').value = new Date().toISOString().split('T')[0];
  ['formNama','formNoRumah','formTransaksi','formPemasukan','formPengeluaran','formKeterangan','formLinkGambar'].forEach(function(id){ document.getElementById(id).value = ''; });
  document.getElementById('formMetode').value = 'Tranfer';
  document.getElementById('transactionModal').classList.add('active');
}

function openEditModal(si, rowIdx) {
  if (!requireAuth('mengedit transaksi')) return;
  if (!currentData || !currentData.sections) return;
  var sec = currentData.sections[si];
  if (!sec) return;
  var t = sec.transactions.find(function (tr) { return tr.rowIndex === rowIdx; });
  if (!t) return;
  document.getElementById('modalTitle').textContent = 'Edit Transaksi';
  document.getElementById('editRowIndex').value = t.rowIndex;
  document.getElementById('formTanggal').value = parseDateForInput(t.tanggal);
  document.getElementById('formNama').value = t.nama;
  document.getElementById('formNoRumah').value = t.noRumah;
  document.getElementById('formTransaksi').value = t.transaksi;
  document.getElementById('formPemasukan').value = t.pemasukan || '';
  document.getElementById('formPengeluaran').value = t.pengeluaran || '';
  document.getElementById('formMetode').value = t.metode || 'Tranfer';
  document.getElementById('formKeterangan').value = t.keterangan || '';
  document.getElementById('formLinkGambar').value = t.linkGambar || '';
  document.getElementById('transactionModal').classList.add('active');
}

function closeModal() { document.getElementById('transactionModal').classList.remove('active'); }
function openNewMonthModal() { document.getElementById('newMonthModal').classList.add('active'); }
function closeNewMonthModal() { document.getElementById('newMonthModal').classList.remove('active'); }

function findJurnalTransaction(rowIdx) {
  if (!currentData || !currentData.sections) return null;
  for (var s = 0; s < currentData.sections.length; s++) {
    var txs = currentData.sections[s].transactions || [];
    for (var i = 0; i < txs.length; i++) {
      if (txs[i].rowIndex === rowIdx) return txs[i];
    }
  }
  return null;
}

// ==================== BUKTI + SHARE WA (Web Share API) ====================
function openBuktiModal(rowIdx) {
  var t = findJurnalTransaction(rowIdx);
  if (!t) {
    showToast('Data transaksi tidak ditemukan', 'error');
    return;
  }

  var jumlah = t.pemasukan || t.pengeluaran || 0;

document.getElementById('buktiContent').innerHTML = `
<div id="buktiPrintArea" style="
    background: white;
    padding: 24px;
    border-radius: 12px;
    border: 1px solid #e5e7eb;
    max-width: 380px;
    margin: 0 auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1f2937;
">
    <div style="text-align:center; margin-bottom: 16px;">
    <div style="font-size: 18px; font-weight: 700; color: #1e40af;">Bukti Pembayaran</div>
    <div style="font-size: 14px; color: #4b5563; margin-top: 4px;">RT 08 RW 13 • LPR Pilang - Sidodadi</div>
    </div>

    <table style="width:100%; font-size: 14px; border-collapse: collapse;">
    <tr>
        <td style="padding: 6px 0; width: 110px; color: #6b7280; font-weight: 600;">Tanggal</td>
        <td style="padding: 6px 0;">: ${esc(t.tanggal)}</td>
    </tr>
    <tr>
        <td style="padding: 6px 0; color: #6b7280; font-weight: 600;">Nama</td>
        <td style="padding: 6px 0;">: ${esc(t.nama)}</td>
    </tr>
    <tr>
        <td style="padding: 6px 0; color: #6b7280; font-weight: 600;">No Rumah</td>
        <td style="padding: 6px 0;">: ${esc(t.noRumah || '-')}</td>
    </tr>
    <tr>
        <td style="padding: 6px 0; color: #6b7280; font-weight: 600;">Jumlah</td>
        <td style="padding: 6px 0; font-weight: 700; color: #16a34a;">: Rp ${fmt(jumlah)}</td>
    </tr>
    <tr>
        <td style="padding: 6px 0; color: #6b7280; font-weight: 600;">Pembayaran</td>
        <td style="padding: 6px 0;">: ${esc(t.transaksi || '-')}</td>
    </tr>
    </table>

    <div style="
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px dashed #d1d5db;
    font-size: 13px;
    color: #4b5563;
    text-align: center;
    line-height: 1.5;
    ">
    Terima kasih atas pembayarannya<br>
    Jika ada kesalahan hubungi bendahara<br>
    <strong>0817-0300-65656</strong>
    </div>
</div>

<!-- Info tambahan ini SENGAJA di luar #buktiPrintArea, supaya tidak ikut
     ke dalam gambar screenshot/download/share WA. Cukup tampil di modal saja. -->
<div style="
    margin-top: 18px;
    padding: 12px;
    background: #f0f9ff;
    border-radius: 8px;
    font-size: 12.5px;
    color: #1e3a8a;
    text-align: center;
    line-height: 1.55;
    max-width: 380px;
    margin-left: auto;
    margin-right: auto;
    ">
    <strong>Bukti Pembayaran</strong><br>
    Terima Kasih 🙏🏻🙏🏻<br><br>
    Pembukuan bisa dilihat di<br>
    <span style="color:#2563eb;">https://rt08.pilang.my.id/</span><br>
    Atau di Google Sheet<br>
    <span style="font-size:11px; word-break:break-all;">https://docs.google.com/spreadsheets/d/1KXB6N_sOGKAK1XvFQtwkTMAo4JlnmK4wuvL394yLfsQ</span>
</div>

<div style="margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
    <button class="btn btn-secondary" style="width:100%; margin-bottom: 10px;" onclick="downloadBuktiImage()">
    📥 Download Gambar Bukti
    </button>

    <div class="form-group" style="margin-bottom: 10px;">
    <label style="font-size: 0.8rem; font-weight: 600; color: #4b5563;">Nomor WhatsApp tujuan (opsional)</label>
    <input type="tel" id="waNumberInput" 
            placeholder="08xxxxxxxxxx atau 628xxxxxxxxxx"
            style="width:100%; padding: 0.55rem 0.75rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.9rem;">
    </div>

    <button class="btn btn-success" style="width:100%;" onclick="shareBuktiToWA()">
    📤 Bagikan ke WhatsApp
    </button>

    <p style="font-size: 0.72rem; color: #6b7280; margin-top: 10px; text-align: center; line-height: 1.4;">
    Teks pesan sudah termasuk di dalam gambar.<br>
    Di HP modern akan muncul menu Share → pilih WhatsApp.
    </p>
</div>
`;     
    
  document.getElementById('buktiModal').classList.add('active');
}

function closeBuktiModal() {
  document.getElementById('buktiModal').classList.remove('active');
}

function downloadBuktiImage() {
  var area = document.getElementById('buktiPrintArea');
  if (!area) {
    showToast('Area bukti tidak ditemukan', 'error');
    return;
  }

  showToast('Sedang membuat gambar...', 'info');

  html2canvas(area, {
    scale: 2.5,
    backgroundColor: '#ffffff',
    useCORS: true,
    allowTaint: true,
    logging: false
  }).then(function(canvas) {
    var link = document.createElement('a');
    link.download = 'Bukti-Pembayaran-RT08-' + Date.now() + '.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Gambar berhasil diunduh!', 'success');
  }).catch(function(err) {
    console.error(err);
    showToast('Gagal membuat gambar. Coba lagi.', 'error');
  });
}

function shareBuktiToWA() {
  var area = document.getElementById('buktiPrintArea');
  if (!area) {
    showToast('Area bukti tidak ditemukan', 'error');
    return;
  }

  var text = `Bukti Pembayaran
Terima Kasih 🙏🏻🙏🏻
Pembukuan bisa dilihat di 
https://rt08.pilang.my.id/
Atau di googlesheet
https://docs.google.com/spreadsheets/d/1KXB6N_sOGKAK1XvFQtwkTMAo4JlnmK4wuvL394yLfsQ/edit?gid=387111055#gid=387111055`;

  showToast('Menyiapkan gambar...', 'info');

  html2canvas(area, {
    scale: 2.5,
    backgroundColor: '#ffffff',
    useCORS: true,
    allowTaint: true,
    logging: false
  }).then(function(canvas) {

    canvas.toBlob(function(blob) {
      if (!blob) {
        fallbackShare(text);
        return;
      }

      var file = new File([blob], 'Bukti-Pembayaran-RT08.png', { type: 'image/png' });

      // Coba Web Share API (paling otomatis di HP modern)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: 'Bukti Pembayaran RT 08',
          text: text
        }).then(function() {
          showToast('Berhasil dibagikan!', 'success');
        }).catch(function(err) {
          console.log('Share dibatalkan atau gagal:', err);
          fallbackShare(text, canvas);
        });
      } else {
        // Browser tidak support → fallback
        fallbackShare(text, canvas);
      }
    }, 'image/png');

  }).catch(function(err) {
    console.error(err);
    showToast('Gagal membuat gambar', 'error');
    fallbackShare(text);
  });
}

function fallbackShare(text, canvas) {
  // Download gambar jika ada
  if (canvas) {
    var link = document.createElement('a');
    link.download = 'Bukti-Pembayaran-RT08.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Ambil nomor WA
  var phoneInput = document.getElementById('waNumberInput');
  var phone = (phoneInput ? phoneInput.value : '').trim();
  
  if (phone) {
    phone = phone.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '62' + phone.substring(1);
    if (!phone.startsWith('62')) phone = '62' + phone;

    setTimeout(function() {
      var waUrl = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
      window.open(waUrl, '_blank');
      showToast('Gambar diunduh. Silakan lampirkan di chat WA', 'success');
    }, 500);
  } else {
    setTimeout(function() {
      var waUrl = 'https://wa.me/?text=' + encodeURIComponent(text);
      window.open(waUrl, '_blank');
      showToast('Gambar diunduh. Pilih kontak WA lalu lampirkan gambar', 'info');
    }, 500);
  }
}

function normalizeRumah(value) {
  return (value || '').toString().trim().toLowerCase().replace(/\s+/g, '');
}

function openRumahIuranModal() {
  document.getElementById('rumahIuranInput').value = '';
  document.getElementById('rumahIuranResult').innerHTML = '';
  document.getElementById('rumahIuranModal').classList.add('active');
  setTimeout(function () { document.getElementById('rumahIuranInput').focus(); }, 50);
}

function closeRumahIuranModal() {
  document.getElementById('rumahIuranModal').classList.remove('active');
}

function cariIuranPerRumah() {
  var noRumah = document.getElementById('rumahIuranInput').value.trim();
  var result = document.getElementById('rumahIuranResult');
  if (!noRumah) {
    result.innerHTML = '<div class="empty-state" style="padding:1rem">Masukkan No Rumah terlebih dahulu</div>';
    return;
  }
  if (!currentData || currentData.type !== 'iuran' || !currentData.months) {
    result.innerHTML = '<div class="empty-state" style="padding:1rem">Pilih sheet Iuran RT terlebih dahulu</div>';
    return;
  }
  var key = normalizeRumah(noRumah);
  var paid = [];
  currentData.months.forEach(function (month) {
    (month.entries || []).forEach(function (entry) {
      if (normalizeRumah(entry.noRumah) === key) {
        paid.push({ bulan: month.title, tanggal: entry.tanggal, nama: entry.nama, nominal: entry.nominal, order: paid.length });
      }
    });
  });
  if (!paid.length) {
    result.innerHTML = '<div class="empty-state" style="padding:1rem">Belum ada data iuran untuk rumah ' + esc(noRumah) + '</div>';
    return;
  }
  paid.sort(function (a, b) {
    var aDate = parseDateForInput(a.tanggal);
    var bDate = parseDateForInput(b.tanggal);
    var aTime = aDate ? new Date(aDate + 'T00:00:00').getTime() : 0;
    var bTime = bDate ? new Date(bDate + 'T00:00:00').getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return b.order - a.order;
  });
  var html = '<div style="font-weight:700;margin-top:0.5rem">Rumah ' + esc(noRumah) + ' sudah bayar ' + paid.length + ' bulan</div>' +
    '<div class="rumah-result"><div class="rumah-result-row rumah-result-head"><span>Bulan</span><span>Tanggal / Nama</span><span>Nominal</span></div>';
  paid.forEach(function (item) {
    html += '<div class="rumah-result-row">' +
      '<span class="rumah-result-month">' + esc(item.bulan) + '</span>' +
      '<span>' + esc(item.tanggal || '-') + '<br><span style="color:var(--gray-500)">' + esc(item.nama || '-') + '</span></span>' +
      '<span class="rumah-result-paid">Rp ' + fmt(item.nominal) + '</span></div>';
  });
  html += '</div>';
  result.innerHTML = html;
}

function openImageModal(rowIdx, colIdx, currentLink) {
  if (!requireAuth('mengubah link kwitansi')) return;
  document.getElementById('imgRowIndex').value = rowIdx;
  document.getElementById('imgColIndex').value = colIdx || 5;
  document.getElementById('imgLinkInput').value = currentLink || '';
  document.getElementById('imageLinkModal').classList.add('active');
}

function closeImageModal() {
  document.getElementById('imageLinkModal').classList.remove('active');
}

// ==================== SAVE ====================
function saveTransaction() {
  if (!requireAuth('menyimpan transaksi')) return;
  var sheetName = document.getElementById('sheetSelect').value;
  var rowIdx = document.getElementById('editRowIndex').value;
  var d = {
    sheet: sheetName,
    tanggal: document.getElementById('formTanggal').value,
    nama: document.getElementById('formNama').value.trim(),
    noRumah: document.getElementById('formNoRumah').value.trim(),
    transaksi: document.getElementById('formTransaksi').value.trim(),
    pemasukan: document.getElementById('formPemasukan').value || 0,
    pengeluaran: document.getElementById('formPengeluaran').value || 0,
    metode: document.getElementById('formMetode').value,
    keterangan: document.getElementById('formKeterangan').value.trim(),
    linkGambar: document.getElementById('formLinkGambar').value.trim()
  };
  if (!d.nama) { showToast('Nama harus diisi', 'error'); return; }
  d.action = rowIdx ? 'editTransaction' : 'addTransaction';
  d.token = getAuthToken();
  if (rowIdx) d.rowIndex = parseInt(rowIdx);
  var btn = document.getElementById('btnSave');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';
  apiPost(d).then(function (r) {
    btn.disabled = false;
    btn.textContent = 'Simpan';
    if (r.error) { showToast(r.error, 'error'); return; }
    showToast(r.message || 'Berhasil!', 'success');
    closeModal();
    loadData(sheetName);
    loadWarga();
  }).catch(function () {
    btn.disabled = false;
    btn.textContent = 'Simpan';
  });
}

function confirmDelete(rowIdx) {
  if (!requireAuth('menghapus transaksi')) return;
  if (!confirm('Yakin ingin menghapus transaksi ini?')) return;
  var sheetName = document.getElementById('sheetSelect').value;
  apiPost({ action: 'deleteTransaction', sheet: sheetName, rowIndex: rowIdx, token: getAuthToken() }).then(function (r) {
    if (r.error) { showToast(r.error, 'error'); return; }
    showToast('Berhasil dihapus', 'success');
    loadData(sheetName);
  });
}

function createNewMonth() {
  var bulan = document.getElementById('newMonthBulan').value;
  var tahun = document.getElementById('newMonthTahun').value;
  apiPost({ action: 'addSheet', monthName: bulan + ' ' + tahun, token: getAuthToken() }).then(function (r) {
    if (r.error) { showToast(r.error, 'error'); return; }
    showToast(r.message || 'Berhasil!', 'success');
    closeNewMonthModal();
    loadSheets();
  });
}

function saveImageLink() {
  if (!requireAuth('menyimpan link gambar')) return;
  var sheetName = document.getElementById('sheetSelect').value;
  var rowIdx = parseInt(document.getElementById('imgRowIndex').value);
  var colIdx = parseInt(document.getElementById('imgColIndex').value) || 5;
  var link = document.getElementById('imgLinkInput').value.trim();
  apiPost({ action: 'saveImageLink', sheet: sheetName, rowIndex: rowIdx, colIndex: colIdx, linkGambar: link, token: getAuthToken() }).then(function (r) {
    if (r.error) { showToast(r.error, 'error'); return; }
    showToast('Link gambar berhasil disimpan', 'success');
    closeImageModal();
    loadData(sheetName);
  });
}

document.getElementById('formNama').addEventListener('change', function () {
  var nama = this.value.trim();
  for (var i = 0; i < wargaData.length; i++) {
    if (wargaData[i].nama === nama) {
      document.getElementById('formNoRumah').value = wargaData[i].noRumah;
      break;
    }
  }
});

document.getElementById('rumahIuranInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') cariIuranPerRumah();
});

// ==================== RIWAYAT PEMBAYARAN PER RUMAH (lintas tahun & kategori) ====================
var MONTH_NAMES_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
var iuranAllSheetsCache = null; // cache hasil getData semua sheet bertipe 'iuran'

function openRiwayatRumahModal() {
  document.getElementById('riwayatRumahInput').value = '';
  document.getElementById('riwayatRumahResult').innerHTML = '';
  document.getElementById('riwayatRumahModal').classList.add('active');
  setTimeout(function () { document.getElementById('riwayatRumahInput').focus(); }, 50);
}

function closeRiwayatRumahModal() {
  document.getElementById('riwayatRumahModal').classList.remove('active');
}

document.getElementById('riwayatRumahInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') cariRiwayatRumah();
});

// Ambil data semua sheet bertipe 'iuran' (Iuran RT, Iuran Pos, dll), lalu simpan di cache
// supaya pencarian berikutnya tidak perlu fetch ulang semua sheet.
function loadAllIuranSheets() {
  if (iuranAllSheetsCache) return Promise.resolve(iuranAllSheetsCache);
  var iuranSheets = (sheetsInfo || []).filter(function (s) { return s.type === 'iuran'; });
  return Promise.all(iuranSheets.map(function (s) { return apiGet('getData', { sheet: s.name }); }))
    .then(function (results) {
      iuranAllSheetsCache = results;
      return results;
    });
}

// Ambil kategori (Iuran RT / Iuran Pos / dll), bulan, dan tahun dari judul blok bulan,
// misal: "Iuran RT Bulan Januari 2026" -> kategori: "Iuran RT", bulan: "Januari", tahun: "2026"
// Judul di sheet kadang pakai singkatan ("Jan 2026", "Feb 2026"), jadi bulan
// dinormalisasi ke nama lengkap supaya urutannya tetap benar (Jan-Des).
function parseIuranMonthTitle(title) {
  title = (title || '').toString();
  var kategori = title.replace(/bulan.*$/i, '').trim() || 'Iuran';
  var m = /bulan\s+([a-zA-Z]+)\s+(\d{4})/i.exec(title);
  if (m) return { kategori: kategori, bulan: normalizeMonthName(m[1]), tahun: m[2] };
  var m2 = /bulan\s+([a-zA-Z]+)/i.exec(title);
  return { kategori: kategori, bulan: m2 ? normalizeMonthName(m2[1]) : '', tahun: '' };
}

function capitalizeWord(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

// Peta singkatan bulan (Bahasa Indonesia, berbagai variasi ejaan) ke nama lengkap.
var MONTH_ABBR_MAP = {
  jan: 'Januari', januari: 'Januari',
  feb: 'Februari', februari: 'Februari',
  mar: 'Maret', maret: 'Maret',
  apr: 'April', april: 'April',
  mei: 'Mei',
  jun: 'Juni', juni: 'Juni',
  jul: 'Juli', juli: 'Juli',
  agu: 'Agustus', ags: 'Agustus', agus: 'Agustus', agustus: 'Agustus',
  sep: 'September', sept: 'September', september: 'September',
  okt: 'Oktober', oktober: 'Oktober',
  nov: 'November', november: 'November',
  des: 'Desember', desember: 'Desember'
};

function normalizeMonthName(s) {
  if (!s) return s;
  var key = s.toString().trim().toLowerCase();
  return MONTH_ABBR_MAP[key] || capitalizeWord(s);
}

function extractYearFromTanggal(tgl) {
  var m = /(\d{4})/.exec(tgl || '');
  return m ? m[1] : '';
}

function cariRiwayatRumah() {
  var noRumah = document.getElementById('riwayatRumahInput').value.trim();
  var result = document.getElementById('riwayatRumahResult');
  if (!noRumah) {
    result.innerHTML = '<div class="empty-state" style="padding:1rem">Masukkan No Rumah terlebih dahulu</div>';
    return;
  }
  result.innerHTML = '<div class="loading"><div class="spinner"></div><p>Memuat riwayat...</p></div>';
  var key = normalizeRumah(noRumah);

  loadAllIuranSheets().then(function (results) {
    var nama = '';
    var dataByYear = {};   // dataByYear[tahun][kategori][bulan] = { tanggal, nominal }
    var kategoriSet = {};

    results.forEach(function (r) {
      if (!r || r.error || !r.months) return;
      r.months.forEach(function (month) {
        var info = parseIuranMonthTitle(month.title);
        (month.entries || []).forEach(function (entry) {
          if (normalizeRumah(entry.noRumah) !== key) return;
          if (!nama) nama = entry.nama;
          var tahun = info.tahun || extractYearFromTanggal(entry.tanggal) || 'Tanpa Tahun';
          var kategori = info.kategori || 'Iuran';
          var bulan = info.bulan || month.title;
          kategoriSet[kategori] = true;
          if (!dataByYear[tahun]) dataByYear[tahun] = {};
          if (!dataByYear[tahun][kategori]) dataByYear[tahun][kategori] = {};
          dataByYear[tahun][kategori][bulan] = { tanggal: entry.tanggal, nominal: entry.nominal };
        });
      });
    });

    var years = Object.keys(dataByYear).sort();
    if (!years.length) {
      result.innerHTML = '<div class="empty-state" style="padding:1rem">Belum ada data pembayaran untuk rumah ' + esc(noRumah) + '</div>';
      return;
    }
    years.sort(function (a, b) { return b.localeCompare(a); }); // tahun terbaru dulu
    var kategoriList = Object.keys(kategoriSet).sort();

    var html = '<div class="riwayat-header">' +
      '<div><strong>No Rumah:</strong> ' + esc(noRumah) + '</div>' +
      '<div><strong>Nama:</strong> ' + esc(nama || '-') + '</div>' +
      '<div class="riwayat-status">\u2713 Telah melakukan pembayaran</div>' +
      '</div>';

    years.forEach(function (tahun) {
      var monthsInYear = MONTH_NAMES_ID.filter(function (bln) {
        return kategoriList.some(function (kat) { return dataByYear[tahun][kat] && dataByYear[tahun][kat][bln]; });
      });
      // Kalau ada bulan yang formatnya bukan nama bulan standar (fallback), tetap tampilkan
      kategoriList.forEach(function (kat) {
        if (!dataByYear[tahun][kat]) return;
        Object.keys(dataByYear[tahun][kat]).forEach(function (bln) {
          if (monthsInYear.indexOf(bln) < 0) monthsInYear.push(bln);
        });
      });

      html += '<div class="riwayat-year-block"><h4>Tahun ' + esc(tahun) + '</h4>' +
        '<div class="table-container"><table class="riwayat-matrix"><thead><tr><th>Kategori</th>';
      monthsInYear.forEach(function (bln) { html += '<th>' + esc(bln) + '</th>'; });
      html += '</tr></thead><tbody>';
      kategoriList.forEach(function (kat) {
        if (!dataByYear[tahun][kat]) return;
        html += '<tr><td class="riwayat-kategori">' + esc(kat) + '</td>';
        monthsInYear.forEach(function (bln) {
          var cell = dataByYear[tahun][kat][bln];
          if (cell) {
            html += '<td class="riwayat-cell"><div class="riwayat-tanggal">' + esc(cell.tanggal) + '</div><div class="riwayat-nominal">Rp ' + fmt(cell.nominal) + '</div></td>';
          } else {
            html += '<td class="riwayat-cell riwayat-empty">-</td>';
          }
        });
        html += '</tr>';
      });
      html += '</tbody></table></div></div>';
    });

    result.innerHTML = html;
  }).catch(function (err) {
    result.innerHTML = '<div class="empty-state" style="padding:1rem">Gagal memuat data: ' + esc(err.message) + '</div>';
  });
}

document.getElementById('loginPassword').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') login();
});

// ==================== WARGA BELUM BAYAR ====================
// Daftar master no rumah RT (semua unit yang wajib iuran).
// Dipakai fitur Belum Bayar supaya rumah yang belum pernah bayar tetap muncul.
var MASTER_NO_RUMAH = (function () {
  var ranges = [
    { prefix: 'F', from: 1, to: 8 },
    { prefix: 'H', from: 1, to: 8 },
    { prefix: 'I', from: 1, to: 5 },
    { prefix: 'J', from: 1, to: 10 },
    { prefix: 'K', from: 1, to: 12 }
  ];
  var list = [];
  ranges.forEach(function (r) {
    for (var n = r.from; n <= r.to; n++) list.push(r.prefix + n);
  });
  return list;
})();

var belumBayarPeriode = 3; // default 3 bulan terakhir
var belumBayarCache = []; // { noRumah, nama, missing[], futurePaid[] }
var belumBayarMode = 'periode'; // 'periode' | 'ranking' | 'rajin'
var belumBayarHousesTotal = 0;
var belumBayarPeriodeLabel = '';
var belumBayarAllLabel = '';
var belumBayarKategoriLabel = '';
var MONTH_INDEX_MAP = { Januari:0, Februari:1, Maret:2, April:3, Mei:4, Juni:5, Juli:6, Agustus:7, September:8, Oktober:9, November:10, Desember:11 };

function openBelumBayarModal() {
  if (!requireAuth('melihat daftar warga belum bayar')) return;
  document.getElementById('belumBayarManual').value = '';
  belumBayarMode = 'periode';
  document.getElementById('belumBayarModal').classList.add('active');
  updatePeriodeButtonState();
  cekBelumBayar();
}

function closeBelumBayarModal() {
  document.getElementById('belumBayarModal').classList.remove('active');
}

function updatePeriodeButtonState() {
  document.querySelectorAll('.period-btn').forEach(function (btn) {
    var isActive = parseInt(btn.getAttribute('data-n'), 10) === belumBayarPeriode;
    btn.classList.toggle('btn-primary', isActive);
    btn.classList.toggle('btn-secondary', !isActive);
  });
}

function setPeriodeBelumBayar(n) {
  belumBayarPeriode = n;
  document.getElementById('belumBayarManual').value = '';
  belumBayarMode = 'periode';
  updatePeriodeButtonState();
  cekBelumBayar();
}

function applyManualPeriode() {
  var v = parseInt(document.getElementById('belumBayarManual').value, 10);
  if (!v || v < 1) { showToast('Masukkan jumlah bulan yang valid', 'error'); return; }
  belumBayarPeriode = v;
  belumBayarMode = 'periode';
  updatePeriodeButtonState();
  cekBelumBayar();
}

function monthSortKey(tahun, bulan) {
  var idx = MONTH_INDEX_MAP[bulan];
  if (idx == null || !tahun) return null;
  return parseInt(tahun, 10) * 12 + idx;
}

// N bulan kalender terakhir dihitung dari BULAN SEKARANG (bukan dari
// bulan terakhir yang ada di sheet). Contoh: hari ini Sep 2026, N=3
// -> Juli 2026, Agustus 2026, September 2026.
function getLastNCalendarMonths(n) {
  var now = new Date();
  var y = now.getFullYear();
  var m = now.getMonth(); // 0 = Januari
  var list = [];
  for (var i = 0; i < n; i++) {
    var mm = m - i;
    var yy = y;
    while (mm < 0) { mm += 12; yy -= 1; }
    list.push({
      tahun: String(yy),
      bulan: MONTH_NAMES_ID[mm],
      sortKey: yy * 12 + mm
    });
  }
  list.reverse(); // dari paling lama ke paling baru
  return list;
}

// Filter entri sampah (header kolom, total, label sheet) supaya tidak
// dianggap sebagai warga/rumah di fitur Belum Bayar.
function isValidWargaEntry(nama, noRumah) {
  nama = (nama || '').toString().trim();
  noRumah = (noRumah || '').toString().trim();
  if (!nama || !noRumah) return false;

  var n = nama.toLowerCase();
  var r = noRumah.toLowerCase().replace(/\s+/g, ' ');

  var bannedExact = {
    'nama': 1, 'total': 1, 'pengeluaran': 1, 'pemasukan': 1, 'saldo': 1,
    'keterangan': 1, 'transaksi': 1, 'bulan': 1, 'iuran': 1, 'no': 1, 'no.': 1,
    'berupa': 1, 'nominal': 1, 'tanggal': 1, 'metode': 1, 'ket': 1,
    'no rumah': 1, 'no. rumah': 1, 'norumah': 1, 'rumah': 1, 'pos': 1
  };
  if (bannedExact[n] || bannedExact[r]) return false;
  if (n.indexOf('iuran') >= 0) return false;
  if (/^(no\.?\s*rumah|nama|total|pengeluaran|pemasukan)/i.test(nama)) return false;
  if (/^(no\.?\s*rumah|nama|total|pengeluaran|pemasukan)/i.test(noRumah)) return false;
  if (r === '0' || r === '-' || r === '—') return false;
  return true;
}

function cekBelumBayar() {
  var kategoriFilter = document.getElementById('belumBayarKategori').value;
  var result = document.getElementById('belumBayarResult');
  result.innerHTML = '<div class="loading"><div class="spinner"></div><p>Memuat data...</p></div>';

  // Sumber daftar rumah: HANYA dari entri iuran kategori yang dipilih
  // (bukan getWarga lintas sheet). Alasan:
  // - Rumah yang hanya ada di Iuran RT tidak muncul saat cek Iuran Pos
  // - Header/label sheet tidak ikut terbaca sebagai warga
  loadAllIuranSheets().then(function (iuranResults) {
    var monthsMap = {};
    // Nama dari data iuran / warga (opsional). Daftar rumah WAJIB dari MASTER_NO_RUMAH
    // supaya unit yang belum pernah bayar tetap ikut dicek.
    var namaByRumah = {};

    iuranResults.forEach(function (r) {
      if (!r || r.error || !r.months) return;
      r.months.forEach(function (month) {
        var info = parseIuranMonthTitle(month.title);
        if ((info.kategori || '').toLowerCase() !== kategoriFilter.toLowerCase()) return;

        var validEntries = [];
        (month.entries || []).forEach(function (e) {
          if (!isValidWargaEntry(e.nama, e.noRumah)) return;
          validEntries.push(e);
          var key = normalizeRumah(e.noRumah);
          if (!key) return;
          if (e.nama && e.nama.trim()) namaByRumah[key] = e.nama.trim();
        });

        var sortKey = monthSortKey(info.tahun, info.bulan);
        if (sortKey == null) return;
        if (!monthsMap[sortKey]) {
          monthsMap[sortKey] = { tahun: info.tahun, bulan: info.bulan, sortKey: sortKey, entries: [] };
        }
        monthsMap[sortKey].entries = monthsMap[sortKey].entries.concat(validEntries);
      });
    });

    // Lengkapi nama dari cache warga (jurnal/donasi) jika ada
    (wargaData || []).forEach(function (w) {
      if (!isValidWargaEntry(w.nama, w.noRumah)) return;
      var key = normalizeRumah(w.noRumah);
      if (key && w.nama && !namaByRumah[key]) namaByRumah[key] = w.nama.trim();
    });

    // Periode = N bulan kalender terakhir dari HARI INI
    var targetMonths = getLastNCalendarMonths(belumBayarPeriode);

    // Semua no rumah master (F1-F8, H1-H8, I1-I5, J1-J10, K1-K12)
    var houses = MASTER_NO_RUMAH.map(function (no) {
      var key = normalizeRumah(no);
      return { noRumah: no, nama: namaByRumah[key] || '' };
    });

    // Tiga data terpisah:
    // - missingPeriode: hanya N bulan terakhir (tombol 1/3/6/Terapkan)
    // - missingAll: SEMUA bulan di data s.d. bulan ini (Ranking belum bayar)
    // - futurePaid: bulan SETELAH sekarang yang sudah dibayar (Paling rajin)
    var now = new Date();
    var currentSortKey = now.getFullYear() * 12 + now.getMonth();

    var allPastKeys = Object.keys(monthsMap).map(function (k) { return parseInt(k, 10); })
      .filter(function (sk) { return !isNaN(sk) && sk <= currentSortKey; })
      .sort(function (a, b) { return a - b; });

    var futureMonthKeys = Object.keys(monthsMap).map(function (k) { return parseInt(k, 10); })
      .filter(function (sk) { return !isNaN(sk) && sk > currentSortKey; })
      .sort(function (a, b) { return a - b; });

    var allStats = [];
    houses.forEach(function (h) {
      var key = normalizeRumah(h.noRumah);

      // Filter periode (1/3/6/manual) — hanya N bulan kalender terakhir
      var missingPeriode = [];
      targetMonths.forEach(function (m) {
        var bucket = monthsMap[m.sortKey];
        var entries = bucket ? bucket.entries : [];
        var paid = entries.some(function (e) { return normalizeRumah(e.noRumah) === key; });
        if (!paid) {
          missingPeriode.push({ label: m.bulan + ' ' + m.tahun, sortKey: m.sortKey });
        }
      });

      // Ranking: semua bulan historis di sheet yang belum dibayar
      var missingAll = [];
      allPastKeys.forEach(function (sk) {
        var bucket = monthsMap[sk];
        if (!bucket) return;
        var paid = (bucket.entries || []).some(function (e) {
          return normalizeRumah(e.noRumah) === key;
        });
        if (!paid) {
          missingAll.push({ label: bucket.bulan + ' ' + bucket.tahun, sortKey: sk });
        }
      });

      // Paling rajin: bayar di bulan setelah bulan ini
      var futurePaid = [];
      futureMonthKeys.forEach(function (sk) {
        var bucket = monthsMap[sk];
        if (!bucket) return;
        var paid = (bucket.entries || []).some(function (e) {
          return normalizeRumah(e.noRumah) === key;
        });
        if (paid) {
          futurePaid.push({ label: bucket.bulan + ' ' + bucket.tahun, sortKey: sk });
        }
      });

      allStats.push({
        noRumah: h.noRumah,
        nama: h.nama,
        missingPeriode: missingPeriode,
        missingAll: missingAll,
        futurePaid: futurePaid
      });
    });

    var labelPeriode = targetMonths.map(function (m) { return m.bulan + ' ' + m.tahun; }).join(', ');
    var labelAll = '';
    if (allPastKeys.length) {
      var firstB = monthsMap[allPastKeys[0]];
      var lastB = monthsMap[allPastKeys[allPastKeys.length - 1]];
      labelAll = (firstB ? firstB.bulan + ' ' + firstB.tahun : '') +
        ' s.d. ' + (lastB ? lastB.bulan + ' ' + lastB.tahun : '') +
        ' (' + allPastKeys.length + ' bulan di data)';
    }

    belumBayarCache = allStats;
    belumBayarHousesTotal = houses.length;
    belumBayarPeriodeLabel = labelPeriode;
    belumBayarAllLabel = labelAll;
    belumBayarKategoriLabel = kategoriFilter;
    // Mode tidak diubah di sini kecuali belum diset; tombol yang menentukan mode
    if (!belumBayarMode) belumBayarMode = 'periode';

    var toolbar = document.getElementById('belumBayarToolbar');
    var searchInput = document.getElementById('belumBayarSearch');
    if (searchInput) searchInput.value = '';
    if (toolbar) toolbar.style.display = 'flex';
    updateBelumBayarModeButtons();
    renderBelumBayarList();
  }).catch(function (err) {
    result.innerHTML = '<div class="empty-state" style="padding:1rem">Gagal memuat data: ' + esc(err.message) + '</div>';
  });
}


function updateBelumBayarModeButtons() {
  var btnRank = document.getElementById('btnModeRanking');
  var btnRajin = document.getElementById('btnModeRajin');
  if (btnRank) {
    var on = belumBayarMode === 'ranking';
    btnRank.classList.toggle('btn-danger', on);
    btnRank.classList.toggle('btn-secondary', !on);
  }
  if (btnRajin) {
    var onJ = belumBayarMode === 'rajin';
    btnRajin.classList.toggle('btn-success', onJ);
    btnRajin.classList.toggle('btn-secondary', !onJ);
  }
}

function setBelumBayarMode(mode) {
  if (mode === 'rajin') belumBayarMode = 'rajin';
  else if (mode === 'ranking') belumBayarMode = 'ranking';
  else belumBayarMode = 'periode';
  updateBelumBayarModeButtons();
  renderBelumBayarList();
}

function filterBelumBayarList() {
  renderBelumBayarList();
}

function renderBelumBayarList() {
  var result = document.getElementById('belumBayarResult');
  if (!result) return;
  var q = ((document.getElementById('belumBayarSearch') || {}).value || '').toLowerCase().trim();
  var mode = belumBayarMode || 'periode';

  var list = (belumBayarCache || []).filter(function (item) {
    if (mode === 'rajin') return item.futurePaid && item.futurePaid.length > 0;
    if (mode === 'ranking') return item.missingAll && item.missingAll.length > 0;
    // periode: 1/3/6/Terapkan
    return item.missingPeriode && item.missingPeriode.length > 0;
  });

  if (q) {
    list = list.filter(function (item) {
      var hay = ((item.noRumah || '') + ' ' + (item.nama || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  list.sort(function (a, b) {
    var ca, cb;
    if (mode === 'rajin') {
      ca = a.futurePaid.length; cb = b.futurePaid.length;
    } else if (mode === 'ranking') {
      ca = a.missingAll.length; cb = b.missingAll.length;
    } else {
      ca = a.missingPeriode.length; cb = b.missingPeriode.length;
    }
    if (cb !== ca) return cb - ca;
    return String(a.noRumah).localeCompare(String(b.noRumah), 'id', { numeric: true });
  });

  var title, periodeText, emptyMsg, countSuffix;
  if (mode === 'rajin') {
    title = 'Paling rajin (bayar melebihi bulan ini)';
    periodeText = belumBayarAllLabel || belumBayarPeriodeLabel;
    emptyMsg = 'Belum ada rumah yang bayar di bulan setelah bulan ini';
    countSuffix = ' bulan di muka';
  } else if (mode === 'ranking') {
    title = 'Ranking belum bayar (semua bulan)';
    periodeText = belumBayarAllLabel || belumBayarPeriodeLabel;
    emptyMsg = 'Semua warga lunas di semua bulan data';
    countSuffix = ' bulan tunggak';
  } else {
    title = 'Belum bayar (' + belumBayarPeriode + ' bulan terakhir)';
    periodeText = belumBayarPeriodeLabel;
    emptyMsg = 'Semua warga lunas untuk periode ini';
    countSuffix = ' bulan';
  }

  if (!list.length) {
    result.innerHTML = '<div class="belum-bayar-summary">' + esc(title) +
      '<br>Periode: ' + esc(periodeText || '-') + '</div>' +
      '<div class="empty-state" style="padding:1.5rem;color:var(--success)">\u2713 ' + emptyMsg +
      (q ? ' (filter: "' + esc(q) + '")' : '') + '</div>';
    return;
  }

  var html = '<div class="belum-bayar-summary"><strong>' + esc(title) + '</strong><br>' +
    'Periode: ' + esc(periodeText || '-') +
    ' &middot; <strong>' + list.length + '</strong> rumah' +
    (q ? ' (filter)' : '') +
    ' <span style="color:var(--gray-500);font-weight:400">(dari ' + belumBayarHousesTotal +
    ' rumah di ' + esc(belumBayarKategoriLabel) + ')</span></div>' +
    '<div class="belum-bayar-list">';

  list.forEach(function (item, idx) {
    var rawTags;
    if (mode === 'rajin') rawTags = item.futurePaid;
    else if (mode === 'ranking') rawTags = item.missingAll;
    else rawTags = item.missingPeriode;

    var tags = (rawTags || []).slice().sort(function (a, b) {
      return (a.sortKey || 0) - (b.sortKey || 0);
    });
    var showRank = (mode === 'ranking' || mode === 'rajin');
    html += '<div class="belum-bayar-row">' +
      '<div class="belum-bayar-info">' +
      (showRank ? '<span class="belum-bayar-rank">#' + (idx + 1) + '</span> ' : '') +
      '<strong>' + esc(item.noRumah) + '</strong> &middot; ' + esc(item.nama || '-') +
      ' <span class="belum-bayar-count' + (mode === 'rajin' ? ' belum-bayar-count-ok' : '') + '">' +
      tags.length + countSuffix + '</span></div>' +
      '<div class="belum-bayar-months">' +
      tags.map(function (m) {
        var label = typeof m === 'string' ? m : m.label;
        return '<span class="belum-bayar-tag' + (mode === 'rajin' ? ' belum-bayar-tag-ok' : '') + '">' +
          esc(label) + '</span>';
      }).join('') +
      '</div></div>';
  });
  html += '</div>';
  result.innerHTML = html;
}

function togglePasswordVisibility() {
  var input = document.getElementById('loginPassword');
  var icon = document.getElementById('togglePasswordIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = '🙈';
  } else {
    input.type = 'password';
    icon.textContent = '👁️';
  }
}

// ==================== UTILS ====================
function fmt(n) {
  if (!n && n !== 0) return '0';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function esc(s) {
  if (!s) return '';
  return s.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function getCurrentMonthDefaultIndex(items, getLabel) {
  if (!items || !items.length) return -1;
  var now = new Date();
  var monthNames = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
  var currentMonth = monthNames[now.getMonth()];
  var currentYear = now.getFullYear().toString();
  var monthMatch = -1;
  for (var i = 0; i < items.length; i++) {
    var label = ((getLabel(items[i]) || '') + '').toLowerCase();
    if (label.indexOf(currentMonth) >= 0) {
      monthMatch = i;
      if (label.indexOf(currentYear) >= 0) return i;
    }
  }
  return monthMatch >= 0 ? monthMatch : items.length - 1;
}

function renderBadge(m) {
  if (!m) return '-';
  var c = m.toLowerCase().indexOf('tunai') >= 0 ? 'badge-tunai' : 'badge-transfer';
  return '<span class="badge ' + c + '">' + esc(m) + '</span>';
}

function renderImgLink(link) {
  if (!link) return '';
  return ' <a href="' + esc(link) + '" target="_blank" class="img-link" title="Lihat bukti">&#128247; Bukti</a>';
}

function parseDateForInput(ds) {
  if (!ds) return '';
  var ms = {januari:'01',februari:'02',maret:'03',april:'04',mei:'05',juni:'06',juli:'07',agustus:'08',september:'09',oktober:'10',november:'11',desember:'12'};
  var p = ds.replace(/,/g,'').split(/\s+/);
  for (var i = 0; i < p.length; i++) {
    var m = ms[p[i].toLowerCase()];
    if (m) {
      var d = parseInt(p[i-1]), y = parseInt(p[i+1]);
      if (d && y) return y + '-' + m + '-' + (d < 10 ? '0' : '') + d;
    }
  }
  var dt = new Date(ds);
  return !isNaN(dt.getTime()) ? dt.toISOString().split('T')[0] : '';
}

function showToast(msg, type) {
  var c = document.getElementById('toastContainer');
  var t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'info');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function () {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(function(){ t.remove(); }, 300);
  }, 3000);
}

function showBackendVersion() {
  if (!API_URL) return;
  apiGet('getVersion', {}).then(function(r) {
    var info = document.getElementById('versionInfo');
    if (r && r.version) {
      info.innerHTML = `(v${r.version} - ${r.updateDate || 'Terbaru'})`;
      info.style.color = '#a5f3fc';
    } else {
      info.innerHTML = '(vUnknown)';
    }
  }).catch(function() {
    document.getElementById('versionInfo').innerHTML = '(vLocal)';
  });
}
