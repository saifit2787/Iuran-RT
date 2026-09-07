<?php
// ============================================================
//  ⚠️  FILE INI SUDAH TIDAK DIPAKAI (DEPRECATED) ⚠️
// ============================================================
//  Sisa dari versi lama sebelum aplikasi pindah ke Google Apps Script
//  (lihat Kode.gs) sebagai backend. Semua pengambilan & penyimpanan data
//  sekarang lewat Apps Script Web App (API_URL di index.html), BUKAN
//  lewat file ini.
//
//  File ini juga TIDAK BISA berjalan di GitHub Pages karena GitHub Pages
//  hanya hosting statis dan tidak menjalankan PHP — kalau file ini
//  diakses langsung, isinya cuma ditampilkan sebagai teks mentah,
//  bukan dieksekusi.
//
//  Aman untuk dihapus kapan saja. Disimpan sementara sebagai referensi.
// ============================================================

//  proxy.php — Ambil CSV Google Sheet tanpa kena CORS
//  Upload file ini ke hosting PHP kamu (sama folder dengan index.html)
// ============================================================

// ✏️  GANTI dengan URL CSV Google Sheet kamu
//  Cara dapat URL:
//  File → Share → Publish to web → pilih sheet → CSV → Publish
// define('SHEET_CSV_URL', 'https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=0');
define('SHEET_CSV_URL', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSDTNkRGh-PTDBt8t_wFIE91kvHPFrHO1nQYVjawwTU4LL_UhRl0i0vwJE3x3TeLAb2taGGhG7DgHVz/pub?gid=387111055&single=true&output=csv');

// Domain yang boleh akses proxy ini. Tambahkan alamat lain di sini kalau perlu
// (misal saat development lokal pakai http://localhost).
$ALLOWED_ORIGINS = [
    'https://rt08.pilang.my.id',
];

define('CACHE_FILE', __DIR__ . '/cache_sheet.csv');
define('CACHE_TTL', 60);        // simpan cache selama 60 detik
define('RATE_LIMIT_DIR', __DIR__ . '/rate_limit');
define('RATE_LIMIT_MAX', 30);   // maksimal 30 request
define('RATE_LIMIT_WINDOW', 60); // per 60 detik, per alamat IP

// ============================================================
//  CORS — hanya izinkan origin yang terdaftar
// ============================================================
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} elseif (empty($ALLOWED_ORIGINS)) {
    header('Access-Control-Allow-Origin: *');
}
header('Content-Type: text/csv; charset=UTF-8');
header('Cache-Control: no-cache, must-revalidate');

// ============================================================
//  Rate limiting sederhana berbasis file, per alamat IP
// ============================================================
function tooManyRequests() {
    if (!is_dir(RATE_LIMIT_DIR)) {
        @mkdir(RATE_LIMIT_DIR, 0755, true);
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $safeName = preg_replace('/[^a-zA-Z0-9_.]/', '_', $ip);
    $file = RATE_LIMIT_DIR . '/' . $safeName . '.json';

    $now = time();
    $data = ['count' => 0, 'start' => $now];

    if (file_exists($file)) {
        $existing = json_decode(@file_get_contents($file), true);
        if (is_array($existing) && isset($existing['start'], $existing['count'])) {
            if ($now - $existing['start'] < RATE_LIMIT_WINDOW) {
                $data = $existing;
            }
        }
    }

    $data['count']++;
    @file_put_contents($file, json_encode($data));

    return $data['count'] > RATE_LIMIT_MAX;
}

if (tooManyRequests()) {
    header('Content-Type: application/json');
    http_response_code(429);
    echo json_encode(['error' => 'Terlalu banyak permintaan. Coba lagi sebentar lagi.']);
    exit;
}

// ============================================================
//  Coba pakai cache dulu kalau masih fresh
// ============================================================
if (file_exists(CACHE_FILE) && (time() - filemtime(CACHE_FILE) < CACHE_TTL)) {
    readfile(CACHE_FILE);
    exit;
}

// ============================================================
//  Fetch CSV dari Google Sheet menggunakan cURL
// ============================================================
$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL            => SHEET_CSV_URL,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,   // ikuti redirect (Google suka redirect)
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_TIMEOUT        => 15,     // timeout 15 detik
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; PHP-Proxy/1.0)',
    CURLOPT_HTTPHEADER     => [
        'Accept: text/csv,text/plain,*/*',
    ],
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// ============================================================
//  Error handling — kalau gagal, coba pakai cache lama walau kadaluarsa
// ============================================================
if ($curlError || $httpCode !== 200 || empty($response)) {
    if (file_exists(CACHE_FILE)) {
        readfile(CACHE_FILE);
        exit;
    }
    header('Content-Type: application/json');
    if ($curlError) {
        http_response_code(500);
        echo json_encode(['error' => 'cURL error: ' . $curlError]);
    } elseif ($httpCode !== 200) {
        http_response_code($httpCode);
        echo json_encode(['error' => 'HTTP error: ' . $httpCode . '. Pastikan Sheet sudah di-publish.']);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Respons kosong dari Google Sheets.']);
    }
    exit;
}

// ============================================================
//  Simpan ke cache lalu kirim CSV ke browser
// ============================================================
@file_put_contents(CACHE_FILE, $response);
echo $response;
