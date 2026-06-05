# 🏆 Papan Juara — Firebase Edition

Leaderboard tradisional Indonesia, multi-device, data terpusat di Firebase Firestore + Storage.

## 📁 File
```
index.html   ← Semua halaman + config Firebase
style.css    ← Gaya visual
app.js       ← Semua logika (Firestore)
README.md    ← Dokumentasi ini
+ logo-penabur.png, logo-indonesia.png, bgm.mp3 (opsional, tambah sendiri)
```

## 🔗 Halaman
| URL | Untuk |
|---|---|
| `index.html` | Leaderboard |
| `index.html?page=peserta` | Pendaftaran + profil |
| `index.html?page=panitia` | Scanner |
| `index.html?page=admin` | Dashboard admin |

## 🔥 Firebase
Config sudah tertanam di `index.html` (project: leaderboard-p4). Data tersimpan di:
- **Firestore** collection `peserta` → nama, kelas, foto(url)
- **Firestore** collection `log` → setiap scan (anti-duplikat)
- **Storage** folder `foto/` → foto peserta

Semua **realtime** — leaderboard & profil update otomatis tanpa refresh, di semua perangkat.

## ⚙️ Yang WAJIB diisi di `app.js` (CONFIG)
```javascript
eventTitle  : "Nama Event",
adminPass   : "ganti_password",
daftarNama  : [ /* semua nama murid */ ],
daftarKelas : [ /* semua kelas */ ],
daftarLomba : [ /* 12 lomba */ ],
```

## ⚠️ PENTING: Aturan Keamanan Firebase

Saat ini Firestore & Storage dalam **test mode** (siapa saja bisa baca-tulis). Test mode **otomatis kedaluwarsa ~30 hari**. Untuk event:

1. **Cek tanggal kedaluwarsa** di Firebase Console → Firestore → Rules
2. Kalau event sebelum tanggal itu → aman
3. Kalau perlu perpanjang, di tab Rules ubah tanggal `timestamp.date(...)` ke setelah tanggal event

> Karena ini event internal sekolah jangka pendek, test mode sudah cukup. Untuk jangka panjang, perlu aturan keamanan lebih ketat (bisa dibahas terpisah).

## 🚀 Deploy ke GitHub Pages
1. Upload semua file ke repo
2. Settings → Pages → Branch main → /(root) → Save
3. Akses `https://[username].github.io/[repo]/`

📱 Scanner butuh HTTPS (GitHub Pages otomatis HTTPS ✅)

## 🐛 Troubleshooting
| Masalah | Solusi |
|---|---|
| Data tidak muncul | Cek koneksi internet & Firestore Rules belum kedaluwarsa |
| Kamera mati | Akses via HTTPS, izinkan kamera |
| Foto gagal upload | Cek Storage aktif & Rules |
| "Missing permissions" | Test mode kedaluwarsa → perpanjang di Rules |

## 🎨 Kustomisasi
| Ubah | Lokasi |
|---|---|
| Nama event | `app.js` CONFIG.eventTitle |
| Password | `app.js` CONFIG.adminPass |
| Nama/kelas/lomba | `app.js` CONFIG.daftar* |
| Satuan poin | `app.js` cari `scoreUnit` |
| Warna | `style.css` :root |
| Logo | `index.html` logo-*.png |

---
*Dibuat dengan ❤️ untuk permainan tradisional Indonesia*
