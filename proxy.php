<?php
// ============================================================
//  proxy.php — Ambil CSV Google Sheet tanpa kena CORS
//  Upload file ini ke hosting PHP kamu (sama folder dengan index.html)
// ============================================================

// ✏️  GANTI dengan URL CSV Google Sheet kamu
//  Cara dapat URL:
//  File → Share → Publish to web → pilih sheet → CSV → Publish
// define('SHEET_CSV_URL', 'https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=0');
define('SHEET_CSV_URL', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSDTNkRGh-PTDBt8t_wFIE91kvHPFrHO1nQYVjawwTU4LL_UhRl0i0vwJE3x3TeLAb2taGGhG7DgHVz/pub?gid=387111055&single=true&output=csv');


// ============================================================
//  Izinkan akses dari semua origin (CORS header)
// ============================================================
header('Access-Control-Allow-Origin: *');
header('Content-Type: text/csv; charset=UTF-8');
header('Cache-Control: no-cache, must-revalidate');

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
//  Error handling
// ============================================================
if ($curlError) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'cURL error: ' . $curlError]);
    exit;
}

if ($httpCode !== 200) {
    header('Content-Type: application/json');
    http_response_code($httpCode);
    echo json_encode(['error' => 'HTTP error: ' . $httpCode . '. Pastikan Sheet sudah di-publish.']);
    exit;
}

if (empty($response)) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'Respons kosong dari Google Sheets.']);
    exit;
}

// ============================================================
//  Kirim CSV ke browser
// ============================================================
echo $response;
