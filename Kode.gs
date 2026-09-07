/**
 * ============================================
 * Google Apps Script - Backend API
 * Sistem Pembukuan Iuran RT 08 RW 13
 * LPR Pilang - Sidodadi
 * ============================================
 *
 * CARA PAKAI:
 * 1. Buka Google Sheet kamu
 * 2. Klik Extensions > Apps Script
 * 3. Hapus semua kode yang ada, lalu paste kode ini
 * 4. Klik Deploy > New deployment
 * 5. Pilih Type: Web app
 * 6. Execute as: Me
 * 7. Who has access: Anyone
 * 8. Klik Deploy, lalu copy URL-nya
 * 9. Paste URL tersebut di file index.html (bagian API_URL)
 *
 * Mendukung 5 format sheet:
 * 1. "Jurnal Per Bulan": format vertikal (No, Tanggal, Nama, No.Rumah, Transaksi, Pemasukan, Pengeluaran, Saldo, Metode, Ket)
 * 2. "Iuran RT" / "Iuran Pos": format horizontal multi-bulan (5 bulan berdampingan)
 * 3. "Donasi": format sederhana (No, Tanggal, Nama, No Rumah, Berupa)
 * 4. "Rekap Pengeluaran RT": format side-by-side tables keuangan
 * 5. "Kwintansi": format receipt dengan link gambar
 */

// ==========================================
// KONFIGURASI
// ==========================================

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ==========================================
// WEB APP HANDLERS
// ==========================================

function doGet(e) {
  var action = e.parameter.action;
  var result;

  try {
    switch (action) {
      case 'getSheets':
        result = getSheetNames();
        break;
      case 'getData':
        var sheetName = e.parameter.sheet;
        result = getSheetData(sheetName);
        break;
      case 'getSummary':
        result = getAllSummary();
        break;
      case 'getWarga':
        result = getWargaList();
        break;
      default:
        result = { error: 'Action tidak valid. Gunakan: getSheets, getData, getSummary, getWarga' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var result;

  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;

    // Aksi-aksi ini mengubah data, wajib punya token login yang valid.
    var WRITE_ACTIONS = ['addTransaction', 'deleteTransaction', 'editTransaction', 'addSheet', 'saveImageLink'];

    if (action === 'login') {
      result = login(data);
    } else if (WRITE_ACTIONS.indexOf(action) >= 0 && !verifyToken(data.token)) {
      result = { error: 'Sesi tidak valid atau sudah habis. Silakan login ulang.' };
    } else {
      switch (action) {
        case 'addTransaction':
          result = addTransaction(data);
          break;
        case 'deleteTransaction':
          result = deleteTransaction(data);
          break;
        case 'editTransaction':
          result = editTransaction(data);
          break;
        case 'addSheet':
          result = addNewMonthSheet(data);
          break;
        case 'saveImageLink':
          result = saveImageLink(data);
          break;
        default:
          result = { error: 'Action tidak valid' };
      }
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// AUTENTIKASI (password TIDAK disimpan di kode ini)
// ==========================================

function hashPassword(password) {
  var digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return digestBytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/**
 * JALANKAN FUNGSI INI SATU KALI SAJA secara manual dari editor Apps Script:
 * 1. Ganti 'GANTI_DENGAN_PASSWORD_BARU' di bawah dengan password admin pilihanmu
 * 2. Pilih fungsi "setAdminPassword" di dropdown atas, klik Run
 * 3. Cek Execution log untuk konfirmasi berhasil
 * 4. Setelah berhasil, HAPUS password asli dari baris di bawah ini dan simpan ulang
 *    (password sudah tersimpan aman di Script Properties, tidak perlu ada di kode lagi)
 */
function setAdminPassword() {
  var passwordBaru = 'saifit2787';
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', hashPassword(passwordBaru));
  Logger.log('Password admin berhasil diatur.');
}

function login(data) {
  var password = data.password || '';
  var storedHash = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD_HASH');
  if (!storedHash) {
    return { error: 'Password admin belum diatur. Jalankan fungsi setAdminPassword() di Apps Script terlebih dahulu.' };
  }
  if (!password || hashPassword(password) !== storedHash) {
    return { error: 'Password salah' };
  }
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('token_' + token, 'valid', 21600); // token berlaku 6 jam
  return { success: true, token: token };
}

function verifyToken(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get('token_' + token) === 'valid';
}

// ==========================================
// DETEKSI FORMAT SHEET
// ==========================================

function detectSheetType(data, sheetName) {
  if (!data || data.length < 1) return 'unknown';

  var name = (sheetName || '').toLowerCase().trim();
  var firstCell = (data[0][0] || '').toString().toLowerCase().trim();

  // By sheet name first
  if (name.indexOf('kwintansi') >= 0 || name.indexOf('kwitansi') >= 0) return 'kwintansi';
  if (name.indexOf('donasi') >= 0) return 'donasi';
  if (isTumpengSheetName(sheetName)) return 'iuran';
  if (name.indexOf('rekap') >= 0) return 'rekap';

  // "Iuran RT" / "Iuran Pos" format: baris 1 berisi "Iuran ... Bulan ..."
  if (firstCell.indexOf('iuran') >= 0 && firstCell.indexOf('bulan') >= 0) return 'iuran';

  // "Donasi" format: baris 1 is header row "No." with col 4 = "Berupa"
  if (firstCell === 'no.' || firstCell === 'no') {
    var col4 = (data[0][4] || '').toString().toLowerCase().trim();
    if (col4 === 'berupa') return 'donasi';
    if (col4 === 'nominal') return 'iuran';
  }

  // "Rekap" format: baris 1 contains "Laporan Keuangan RT"
  if (firstCell.indexOf('laporan keuangan rt') >= 0) return 'rekap';

  // "Jurnal Per Bulan": baris 1 "Laporan Keuangan" or "RT 08 RW 13"
  var secondCell = data.length > 1 ? (data[1][0] || '').toString().toLowerCase().trim() : '';
  if (firstCell.indexOf('laporan') >= 0 || firstCell.indexOf('rt 08') >= 0 ||
      secondCell.indexOf('bulan') >= 0 || secondCell.indexOf('rt 08') >= 0) {
    return 'jurnal';
  }

  // Check for Kwintansi pattern: first data has no header, just entries with lots of empty rows
  if (typeof data[0][0] === 'number' && data.length > 30) {
    var emptyCount = 0;
    for (var i = 1; i < Math.min(35, data.length); i++) {
      if (!data[i][0] && !data[i][1] && !data[i][2]) emptyCount++;
    }
    if (emptyCount > 25) return 'kwintansi';
  }

  return 'jurnal'; // default
}

function isTumpengSheetName(sheetName) {
  return (sheetName || '').toString().toLowerCase().indexOf('tumpeng') >= 0;
}

// ==========================================
// FUNGSI BACA DATA (GET)
// ==========================================

function getSheetNames() {
  var sheets = getSpreadsheet().getSheets();
  var result = [];
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var data = sheet.getDataRange().getValues();
    var type = detectSheetType(data, sheet.getName());
    result.push({ name: sheet.getName(), type: type });
  }
  return { sheets: result };
}

function getSheetData(sheetName) {
  var ss = getSpreadsheet();
  if (!sheetName || sheetName === 'undefined' || sheetName === '') {
    sheetName = null;
  }
  var sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];

  if (!sheet) {
    return { error: 'Sheet "' + sheetName + '" tidak ditemukan' };
  }

  var data = sheet.getDataRange().getValues();
  var type = detectSheetType(data, sheet.getName());

  if (isTumpengSheetName(sheet.getName())) {
    return getTumpengData(sheet, data);
  }

  switch (type) {
    case 'iuran': return getIuranData(sheet, data);
    case 'donasi': return getDonasiData(sheet, data);
    case 'rekap': return getRekapData(sheet, data);
    case 'kwintansi': return getKwintansiData(sheet, data);
    default: return getJurnalData(sheet, data);
  }
}

// ==========================================
// FORMAT 1: JURNAL PER BULAN
// ==========================================

function getJurnalData(sheet, data) {
  if (data.length < 4) {
    return { sheetName: sheet.getName(), type: 'jurnal', sections: [] };
  }

  var sections = [];
  var currentSection = null;
  var currentHeader = '';
  var bulanName = '';

  function getRowText(row) {
    var values = [];
    for (var c = 0; c < row.length; c++) {
      var text = (row[c] || '').toString().trim();
      if (text) values.push(text);
    }
    return values.join(' ').trim();
  }

  function pushCurrentSection() {
    if (currentSection && currentSection.transactions.length > 0) {
      sections.push(currentSection);
    }
  }

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var firstCell = (row[0] || '').toString().trim();
    var firstCellLower = firstCell.toLowerCase();
    var rowText = getRowText(row);
    var rowTextLower = rowText.toLowerCase();

    // Format jurnal:
    // Laporan Keuangan
    // RT 08 RW 13 LPR Pilang - Sidodadi
    // Bulan Oktober 2025
    // No. | Tanggal | Nama | ...
    if (rowTextLower.indexOf('laporan keuangan') >= 0) {
      currentHeader = rowText || firstCell || 'Laporan Keuangan';
      continue;
    }

    if (firstCellLower.indexOf('bulan') >= 0) {
      // bulanName = rowText || firstCell;
      bulanName = rowText || firstCell;
      continue;
    }

    // Skip baris judul RT dan baris kosong di atas tabel.
    if (rowTextLower.indexOf('rt 08 rw 13') >= 0 || rowText === '') {
      continue;
    }

    // Detect header kolom (No., Tanggal, Nama, ...)
    if ((firstCellLower === 'no.' || firstCellLower === 'no') &&
        (rowTextLower.indexOf('tanggal') >= 0 || rowTextLower.indexOf('nama') >= 0)) {
      pushCurrentSection();
      currentSection = {
        header: currentHeader || 'Laporan Keuangan',
        bulan: bulanName || 'Tanpa Bulan',
        transactions: [],
        totalPemasukan: 0,
        totalPengeluaran: 0,
        saldo: 0
      };
      bulanName = '';
      continue;
    }

    // Jika data transaksi muncul tanpa header tabel, tetap tampilkan sebagai section fallback.
    if (!currentSection) {
      currentSection = {
        header: currentHeader || 'Laporan Keuangan',
        bulan: bulanName || 'Tanpa Bulan',
        transactions: [],
        totalPemasukan: 0,
        totalPengeluaran: 0,
        saldo: 0
      };
      bulanName = '';
    }

    if (firstCell === '' || firstCellLower === 'total') continue;
    var col4 = (row[4] || '').toString().trim().toLowerCase();
    if (col4.indexOf('pemasukan dan pengeluaran') >= 0) continue;

    var no = row[0];
    if (typeof no !== 'number') continue;

    var pemasukan = parseNumber(row[5]);
    var pengeluaran = parseNumber(row[6]);
    var saldo = parseNumber(row[7]);

    if (saldo > 0) currentSection.saldo = saldo;

    var transaksiStr = (row[4] || '').toString().toLowerCase();
    var isSaldoAwal = transaksiStr.indexOf('saldo bulan') >= 0 || transaksiStr.indexOf('saldo awal') >= 0;

    if (!isSaldoAwal) {
      currentSection.totalPemasukan += pemasukan;
      currentSection.totalPengeluaran += pengeluaran;
    }

    currentSection.transactions.push({
      rowIndex: i + 1,
      no: no,
      tanggal: formatDate(row[1]),
      nama: (row[2] || '').toString().trim(),
      noRumah: (row[3] || '').toString().trim(),
      transaksi: (row[4] || '').toString().trim(),
      pemasukan: pemasukan,
      pengeluaran: pengeluaran,
      saldo: saldo,
      metode: (row[8] || '').toString().trim(),
      keterangan: (row[9] || '').toString().trim(),
      linkGambar: (row[10] || '').toString().trim(),
      isSaldoAwal: isSaldoAwal
    });
  }

  pushCurrentSection();

  return { sheetName: sheet.getName(), type: 'jurnal', sections: sections };
}

// ==========================================
// FORMAT 2: IURAN RT / IURAN POS (FIXED)
// ==========================================

function getIuranData(sheet, data) {
  var months = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var firstCell = (row[0] || '').toString().trim().toLowerCase();

    if (firstCell.indexOf('iuran') >= 0 && firstCell.indexOf('bulan') >= 0) {
      var colsPerMonth = 6;
      var numMonths = Math.floor((row.length + 1) / colsPerMonth);

      var monthTitles = [];
      for (var m = 0; m < numMonths; m++) {
        var colStart = m * colsPerMonth;
        var title = (row[colStart] || '').toString().trim();
        if (title && title.toLowerCase().indexOf('iuran') >= 0) {
          monthTitles.push({ title: title, colStart: colStart });
        }
      }

      var dataStartIdx = i + 2;

      for (var mi = 0; mi < monthTitles.length; mi++) {
        var monthInfo = monthTitles[mi];
        var cs = monthInfo.colStart;
        var entries = [];
        var totalCalculated = 0;   // ← PERBAIKAN

        for (var j = dataStartIdx; j < data.length; j++) {
          var dRow = data[j];
          var cellNo = dRow[cs];
          var cellNoStr = (cellNo || '').toString().trim().toLowerCase();

          // Deteksi baris TOTAL (lebih fleksibel)
          if (cellNoStr === 'total' || cellNoStr.includes('total')) {
            var totalFromSheet = parseNumber(dRow[cs + 4]);
            // Gunakan nilai dari sheet jika ada, jika tidak pakai hasil perhitungan
            totalCalculated = totalFromSheet > 0 ? totalFromSheet : totalCalculated;
            break;
          }

          // Stop jika ketemu header bulan berikutnya
          if (cellNoStr.indexOf('iuran') >= 0 && cellNoStr.indexOf('bulan') >= 0) break;
          
          // Skip baris kosong di tengah
          if (cellNoStr === '' && !dRow[cs + 2]) continue;

          if (typeof cellNo === 'number' && cellNo > 0) {
            var nama = (dRow[cs + 2] || '').toString().trim();
            var nominal = parseNumber(dRow[cs + 4]);

            if (nama || nominal > 0) {
              entries.push({
                no: cellNo,
                tanggal: formatDate(dRow[cs + 1]),
                nama: nama,
                noRumah: (dRow[cs + 3] || '').toString().trim(),
                nominal: nominal
              });
              totalCalculated += nominal;   // Selalu hitung manual
            }
          }
        }

        if (entries.length > 0 || totalCalculated > 0) {
          months.push({
            title: monthInfo.title,
            entries: entries,
            total: totalCalculated,        // ← Pakai hasil perhitungan
            jumlahWarga: entries.length
          });
        }
      }
    }
  }

  return { sheetName: sheet.getName(), type: 'iuran', months: months };
}

function getTumpengData(sheet, data) {
  var sheetName = sheet.getName();
  var headerRowIdx = -1;
  var cols = { no: -1, tanggal: -1, nama: -1, noRumah: -1, nominal: -1 };

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var found = { no: -1, tanggal: -1, nama: -1, noRumah: -1, nominal: -1 };

    for (var c = 0; c < row.length; c++) {
      var header = (row[c] || '').toString().toLowerCase().trim();
      if (header === 'no.' || header === 'no') found.no = c;
      else if (header.indexOf('tanggal') >= 0) found.tanggal = c;
      else if (header === 'nama' || header.indexOf('nama') >= 0) found.nama = c;
      else if (header.indexOf('rumah') >= 0) found.noRumah = c;
      else if (header.indexOf('nominal') >= 0 || header.indexOf('jumlah') >= 0) found.nominal = c;
    }

    if (found.no >= 0 && found.tanggal >= 0 && found.nama >= 0 && found.nominal >= 0) {
      headerRowIdx = i;
      cols = found;
      break;
    }
  }

  if (headerRowIdx < 0) {
    return { sheetName: sheetName, type: 'iuran', hideNoRumah: true, months: [] };
  }

  var entries = [];
  var totalCalculated = 0;

  for (var r = headerRowIdx + 1; r < data.length; r++) {
    var dRow = data[r];
    var noCell = dRow[cols.no];
    var noText = (noCell || '').toString().toLowerCase().trim();

    if (noText === 'total' || noText.indexOf('total') >= 0) {
      var totalFromSheet = parseNumber(dRow[cols.nominal]);
      totalCalculated = totalFromSheet > 0 ? totalFromSheet : totalCalculated;
      break;
    }

    if (noText === '' && !dRow[cols.nama] && !dRow[cols.nominal]) {
      if (entries.length > 0) break;
      continue;
    }

    var no = typeof noCell === 'number' ? noCell : parseNumber(noCell);
    if (!no || no <= 0) continue;

    var nama = (dRow[cols.nama] || '').toString().trim();
    var nominal = parseNumber(dRow[cols.nominal]);

    if (nama || nominal > 0) {
      entries.push({
        no: no,
        tanggal: formatDate(dRow[cols.tanggal]),
        nama: nama,
        noRumah: cols.noRumah >= 0 ? (dRow[cols.noRumah] || '').toString().trim() : '',
        nominal: nominal
      });
      totalCalculated += nominal;
    }
  }

  return {
    sheetName: sheetName,
    type: 'iuran',
    hideNoRumah: true,
    months: [{
      title: sheetName,
      entries: entries,
      total: totalCalculated,
      jumlahWarga: entries.length
    }]
  };
}

// ==========================================
// FORMAT 3: DONASI
// ==========================================

function getDonasiData(sheet, data) {
  var entries = [];

  var startRow = 0;
  var firstCell = (data[0][0] || '').toString().toLowerCase().trim();
  if (firstCell === 'no.' || firstCell === 'no') startRow = 1;

  for (var i = startRow; i < data.length; i++) {
    var row = data[i];
    var no = row[0];
    if (typeof no !== 'number' || no <= 0) continue;

    var nama = (row[2] || '').toString().trim();
    var berupa = (row[4] || '').toString().trim();
    if (!nama && !berupa) continue;

    entries.push({
      rowIndex: i + 1,
      no: no,
      tanggal: formatDate(row[1]),
      nama: nama,
      noRumah: (row[3] || '').toString().trim(),
      berupa: berupa
    });
  }

  return { sheetName: sheet.getName(), type: 'donasi', entries: entries };
}

// ==========================================
// FORMAT 4: REKAP PENGELUARAN RT
// ==========================================

function getRekapData(sheet, data) {
  var tables = [];
  var maxTables = 3;

  // Parse multiple side-by-side and stacked tables
  // Each table section has: title row, header row, data rows, total row
  // Tables can be side-by-side (columns 0-6 and 9-15)

  // Find all table sections by scanning for header rows
  var processed = {};

  for (var i = 0; i < data.length; i++) {
    if (tables.length >= maxTables) break;

    for (var colGroup = 0; colGroup < 3; colGroup++) {
      if (tables.length >= maxTables) break;

      var baseCol = colGroup * 9; // 0, 9, 18...
      if (baseCol >= (data[i] || []).length) continue;

      var cell = (data[i][baseCol] || '').toString().trim().toLowerCase();

      // Detect title row or header row
      var isTitle = cell.indexOf('laporan keuangan') >= 0 || cell.indexOf('pengeluaran') >= 0;
      var isHeader = cell === 'no.' || cell === 'no';

      if (!isTitle && !isHeader) continue;

      var headerRowIdx = isTitle ? i + 1 : i;
      var titleText = isTitle ? (data[i][baseCol] || '').toString().trim() : '';

      // Check if header row exists
      if (headerRowIdx >= data.length) continue;
      var headerRow = data[headerRowIdx];
      var hCell = (headerRow[baseCol] || '').toString().toLowerCase().trim();
      if (hCell !== 'no.' && hCell !== 'no') continue;

      var key = headerRowIdx + '_' + baseCol;
      if (processed[key]) continue;
      processed[key] = true;

      // Read column headers
      var headers = [];
      for (var h = 0; h < 7 && (baseCol + h) < headerRow.length; h++) {
        headers.push((headerRow[baseCol + h] || '').toString().trim());
      }

      // Read data rows
      var rows = [];
      var totalRow = null;
      for (var j = headerRowIdx + 1; j < data.length; j++) {
        var rCell = data[j][baseCol];
        var rCellStr = (rCell || '').toString().trim().toLowerCase();

        if (rCellStr === 'total') {
          totalRow = {
            pemasukan: parseNumber(data[j][baseCol + 3]),
            pengeluaran: parseNumber(data[j][baseCol + 4]),
            saldo: parseNumber(data[j][baseCol + 5])
          };
          break;
        }

        // Another title/header = stop
        if (rCellStr.indexOf('laporan keuangan') >= 0 || rCellStr.indexOf('pengeluaran') >= 0) break;

        if (rCellStr === '' || rCellStr === 'no.' || rCellStr === 'no') {
          // Check if it's a new section header below
          if (rCellStr === 'no.' || rCellStr === 'no') break;
          // Could be a row with no number but has data
          var hasData = false;
          for (var c = 1; c < 7 && (baseCol + c) < data[j].length; c++) {
            if (data[j][baseCol + c]) { hasData = true; break; }
          }
          if (!hasData) continue;
        }

        var tanggal = formatDate(data[j][baseCol + 1]);
        var transaksi = (data[j][baseCol + 2] || '').toString().trim();
        var pemasukan = parseNumber(data[j][baseCol + 3]);
        var pengeluaran = parseNumber(data[j][baseCol + 4]);
        var saldo = parseNumber(data[j][baseCol + 5]);
        var ket = (data[j][baseCol + 6] || '').toString().trim();
        var linkGambar = (baseCol + 7 < data[j].length) ? (data[j][baseCol + 7] || '').toString().trim() : '';

        if (transaksi || pemasukan || pengeluaran || saldo) {
          rows.push({
            rowIndex: j + 1,
            no: rCell,
            tanggal: tanggal,
            transaksi: transaksi,
            pemasukan: pemasukan,
            pengeluaran: pengeluaran,
            saldo: saldo,
            keterangan: ket,
            linkGambar: linkGambar
          });
        }
      }

      if (rows.length > 0) {
        tables.push({
          title: titleText || ('Tabel ' + (tables.length + 1)),
          headers: headers,
          rows: rows,
          total: totalRow
        });
      }
    }
  }

  return { sheetName: sheet.getName(), type: 'rekap', tables: tables };
}

// ==========================================
// FORMAT 5: KWINTANSI
// ==========================================

function getKwintansiData(sheet, data) {
  var entries = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var no = row[0];

    if (typeof no === 'number' && no > 0) {
      var tanggal = formatDate(row[1]);
      var keterangan = (row[2] || '').toString().trim();
      var nominal = parseNumber(row[3]);

      // Check for image link in column 5 (index 4) or check if next row has sub-info
      var linkGambar = (row[4] || '').toString().trim();
      var subInfo = '';

      // Check next row for additional info (like "Admin transfer")
      if (i + 1 < data.length) {
        var nextRow = data[i + 1];
        var nextKet = (nextRow[2] || '').toString().trim();
        if (nextKet && !nextRow[0]) {
          subInfo = nextKet;
        }
      }

      if (keterangan || nominal) {
        entries.push({
          rowIndex: i + 1,
          no: no,
          tanggal: tanggal,
          keterangan: keterangan,
          nominal: nominal,
          subInfo: subInfo,
          linkGambar: linkGambar
        });
      }
    }
  }

  return { sheetName: sheet.getName(), type: 'kwintansi', entries: entries };
}

// ==========================================
// SAVE IMAGE LINK
// ==========================================

function saveImageLink(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(data.sheet);
  if (!sheet) return { error: 'Sheet tidak ditemukan' };

  var rowIndex = data.rowIndex;
  var linkGambar = data.linkGambar || '';
  var colIndex = data.colIndex || 11; // Default kolom K (11) untuk Jurnal, bisa berbeda

  sheet.getRange(rowIndex, colIndex).setValue(linkGambar);

  return { success: true, message: 'Link gambar berhasil disimpan' };
}

// ==========================================
// RINGKASAN
// ==========================================

function getAllSummary() {
  var sheets = getSpreadsheet().getSheets();
  var summaries = [];

  for (var i = 0; i < sheets.length; i++) {
    var sheetData = getSheetData(sheets[i].getName());
    if (sheetData.error) continue;

    if (sheetData.type === 'jurnal') {
      for (var s = 0; s < sheetData.sections.length; s++) {
        var sec = sheetData.sections[s];
        summaries.push({
          bulan: sec.bulan || sheets[i].getName(),
          sheetName: sheets[i].getName(),
          type: 'jurnal',
          totalPemasukan: sec.totalPemasukan,
          totalPengeluaran: sec.totalPengeluaran,
          saldo: sec.saldo,
          jumlahTransaksi: sec.transactions.length
        });
      }
    } else if (sheetData.type === 'iuran') {
      summaries.push({
        bulan: sheets[i].getName(),
        sheetName: sheets[i].getName(),
        type: 'iuran',
        totalBulan: sheetData.months.length,
        months: sheetData.months.map(function (m) {
          return { title: m.title, total: m.total, jumlahWarga: m.jumlahWarga };
        })
      });
    } else if (sheetData.type === 'donasi') {
      summaries.push({
        bulan: sheets[i].getName(),
        sheetName: sheets[i].getName(),
        type: 'donasi',
        jumlahDonasi: sheetData.entries.length
      });
    } else if (sheetData.type === 'rekap') {
      summaries.push({
        bulan: sheets[i].getName(),
        sheetName: sheets[i].getName(),
        type: 'rekap',
        jumlahTabel: sheetData.tables.length
      });
    } else if (sheetData.type === 'kwintansi') {
      var totalNominal = 0;
      sheetData.entries.forEach(function (e) { totalNominal += e.nominal; });
      summaries.push({
        bulan: sheets[i].getName(),
        sheetName: sheets[i].getName(),
        type: 'kwintansi',
        jumlahKwintansi: sheetData.entries.length,
        totalNominal: totalNominal
      });
    }
  }

  return { summaries: summaries };
}

function getWargaList() {
  var sheets = getSpreadsheet().getSheets();
  var wargaMap = {};

  for (var i = 0; i < sheets.length; i++) {
    var data = sheets[i].getDataRange().getValues();
    var type = detectSheetType(data, sheets[i].getName());

    if (type === 'jurnal') {
      for (var j = 3; j < data.length; j++) {
        addWarga(wargaMap, data[j][2], data[j][3]);
      }
    } else if (type === 'iuran') {
      for (var j = 0; j < data.length; j++) {
        for (var m = 0; m < 5; m++) {
          var cs = m * 6;
          addWarga(wargaMap, data[j][cs + 2], data[j][cs + 3]);
        }
      }
    } else if (type === 'donasi') {
      for (var j = 1; j < data.length; j++) {
        addWarga(wargaMap, data[j][2], data[j][3]);
      }
    }
  }

  var wargaList = [];
  for (var k in wargaMap) wargaList.push(wargaMap[k]);
  wargaList.sort(function (a, b) { return a.nama.localeCompare(b.nama); });

  return { warga: wargaList };
}

function addWarga(map, nama, noRumah) {
  nama = (nama || '').toString().trim();
  noRumah = (noRumah || '').toString().trim();
  if (nama && noRumah && nama.toLowerCase() !== 'total' && nama.toLowerCase().indexOf('iuran') < 0) {
    map[nama + '|' + noRumah] = { nama: nama, noRumah: noRumah };
  }
}

// ==========================================
// FUNGSI TULIS DATA (POST)
// ==========================================

function addTransaction(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(data.sheet);
  if (!sheet) return { error: 'Sheet "' + data.sheet + '" tidak ditemukan' };

  var allData = sheet.getDataRange().getValues();
  var lastDataRow = 3;
  var lastNo = 0;
  for (var i = 3; i < allData.length; i++) {
    var no = allData[i][0];
    if (typeof no === 'number' && no > 0) { lastDataRow = i; lastNo = no; }
  }

  var prevSaldo = parseNumber(allData[lastDataRow][7]);
  var pemasukan = parseNumber(data.pemasukan) || 0;
  var pengeluaran = parseNumber(data.pengeluaran) || 0;
  var newSaldo = prevSaldo + pemasukan - pengeluaran;

  var newRow = [
    lastNo + 1,
    data.tanggal || new Date(),
    data.nama || '',
    data.noRumah || '',
    data.transaksi || '',
    pemasukan || '',
    pengeluaran || '',
    newSaldo,
    data.metode || '',
    data.keterangan || '',
    data.linkGambar || ''
  ];

  var insertRow = lastDataRow + 2;
  sheet.insertRowBefore(insertRow);
  sheet.getRange(insertRow, 1, 1, 11).setValues([newRow]);

  return { success: true, message: 'Transaksi berhasil ditambahkan' };
}

function deleteTransaction(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(data.sheet);
  if (!sheet) return { error: 'Sheet "' + data.sheet + '" tidak ditemukan' };

  var rowIndex = data.rowIndex;
  if (!rowIndex || rowIndex < 5) return { error: 'Row index tidak valid' };

  sheet.deleteRow(rowIndex);
  recalculateSaldo(sheet);
  return { success: true, message: 'Transaksi berhasil dihapus' };
}

function editTransaction(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(data.sheet);
  if (!sheet) return { error: 'Sheet "' + data.sheet + '" tidak ditemukan' };

  var rowIndex = data.rowIndex;
  if (!rowIndex || rowIndex < 5) return { error: 'Row index tidak valid' };

  var pemasukan = parseNumber(data.pemasukan) || 0;
  var pengeluaran = parseNumber(data.pengeluaran) || 0;

  var updatedRow = [
    data.no || sheet.getRange(rowIndex, 1).getValue(),
    data.tanggal || sheet.getRange(rowIndex, 2).getValue(),
    data.nama || '',
    data.noRumah || '',
    data.transaksi || '',
    pemasukan || '',
    pengeluaran || '',
    '',
    data.metode || '',
    data.keterangan || '',
    data.linkGambar || ''
  ];

  sheet.getRange(rowIndex, 1, 1, 11).setValues([updatedRow]);
  recalculateSaldo(sheet);
  return { success: true, message: 'Transaksi berhasil diubah' };
}

function addNewMonthSheet(data) {
  var ss = getSpreadsheet();
  var monthName = data.monthName;
  if (!monthName) return { error: 'Nama bulan harus diisi' };
  if (ss.getSheetByName(monthName)) return { error: 'Sheet "' + monthName + '" sudah ada' };

  var sheets = ss.getSheets();
  var lastSheet = sheets[sheets.length - 1];
  var lastData = lastSheet.getDataRange().getValues();
  var prevSaldo = 0;
  var prevMonth = lastSheet.getName();

  for (var i = lastData.length - 1; i >= 0; i--) {
    var s = parseNumber(lastData[i][7]);
    if (s > 0) { prevSaldo = s; break; }
  }

  var newSheet = ss.insertSheet(monthName);
  var headers = [
    ['RT 08 RW 13 LPR Pilang - Sidodadi', '', '', '', '', '', '', '', '', '', ''],
    ['Bulan ' + monthName, '', '', '', '', '', '', '', '', '', ''],
    ['No.', 'Tanggal', 'Nama', 'No. Rumah', 'Transaksi', 'Pemasukan', 'Pengeluaran', 'Saldo', 'Metode', 'Ket', 'Link Gambar'],
    [1, new Date(), 'Saldo bulan ' + prevMonth, '', 'Saldo bulan ' + prevMonth, prevSaldo, '', prevSaldo, '', '', '']
  ];

  newSheet.getRange(1, 1, 4, 11).setValues(headers);
  newSheet.getRange(3, 1, 1, 11).setFontWeight('bold');
  newSheet.getRange(1, 1, 1, 11).merge();
  newSheet.getRange(2, 1, 1, 11).merge();

  return { success: true, message: 'Sheet "' + monthName + '" berhasil dibuat dengan saldo awal Rp ' + formatRupiah(prevSaldo) };
}

// ==========================================
// FUNGSI HELPER
// ==========================================

function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  var str = val.toString()
    .replace(/[Rr]p\.?\s*/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/\s/g, '')
    .replace(/-/g, '');
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    var days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    var months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return days[val.getDay()] + ', ' + val.getDate() + ' ' + months[val.getMonth()] + ' ' + val.getFullYear();
  }
  return val.toString();
}

function formatRupiah(num) {
  if (!num && num !== 0) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function recalculateSaldo(sheet) {
  var data = sheet.getDataRange().getValues();
  for (var i = 4; i < data.length; i++) {
    var no = data[i][0];
    if (typeof no !== 'number' || no <= 0) continue;
    var prevSaldo = parseNumber(data[i - 1][7]);
    var pemasukan = parseNumber(data[i][5]);
    var pengeluaran = parseNumber(data[i][6]);
    sheet.getRange(i + 1, 8).setValue(prevSaldo + pemasukan - pengeluaran);
  }
}
