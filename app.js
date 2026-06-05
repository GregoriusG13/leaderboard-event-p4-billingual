/**
 * ================================================================
 * PAPAN JUARA — app.js (Plan B + Firebase)
 * ================================================================
 * Data tersimpan di Firebase Firestore (terpusat, multi-device).
 * Foto tersimpan di Firebase Storage.
 *
 * Struktur:
 *   BAGIAN 1  — Konfigurasi (EDIT DI SINI)
 *   BAGIAN 2  — State aplikasi
 *   BAGIAN 3  — Router halaman
 *   BAGIAN 4  — Konfigurasi persisten
 *   BAGIAN 5  — Auth admin
 *   BAGIAN 6  — Data peserta (Firestore)
 *   BAGIAN 7  — Score log & poin (Firestore)
 *   BAGIAN 8  — Leaderboard render (realtime)
 *   BAGIAN 9  — Rank change + animasi
 *   BAGIAN 10 — Halaman peserta
 *   BAGIAN 11 — Halaman panitia (scanner)
 *   BAGIAN 12 — Admin panel
 *   BAGIAN 13 — Audio & efek
 *   BAGIAN 14 — Utilitas
 *   BAGIAN 15 — Modal bantuan
 *
 * CATATAN: `db` dan `storage` didefinisikan di index.html
 *          (hasil inisialisasi Firebase).
 * ================================================================
 */

/* ================================================================
   BAGIAN 1 — KONFIGURASI
   ================================================================ */
const CONFIG = {
  eventTitle  : "NAMA EVENT",
  eventTagline: "Tagline Event · Tahun",

  // Interval refresh leaderboard (ms) — fallback kalau realtime mati
  refreshInterval : 30000,

  // Jumlah peserta tampil di leaderboard
  topN : 10,

  // Kredensial admin — WAJIB GANTI sebelum deploy!
  adminUser : "GregAdmin",
  adminPass : "papanjuara2026",

  musicAutoplay : false,

  // Daftar nama murid (dropdown pendaftaran)
  daftarNama : [
    "Adi Pratama", "Amelia Sari", "Bagas Wicaksono", "Bella Kusuma",
    "Candra Wijaya", "Dea Permata", "Eko Santoso", "Farah Nadia",
    "Galih Purnama", "Hana Safitri", "Ilham Maulana", "Jeni Rahayu",
    // ... tambahkan semua nama murid di sini
  ],

  // Daftar kelas (dropdown pendaftaran)
  daftarKelas : [
    "X IPA 1", "X IPA 2", "X IPS 1", "X IPS 2",
    "XI IPA 1", "XI IPA 2", "XI IPS 1", "XI IPS 2",
    "XII IPA 1", "XII IPA 2", "XII IPS 1", "XII IPS 2",
    // ... tambahkan semua kelas di sini
  ],

  // Daftar 12 lomba
  daftarLomba : [
    "Lomba 1", "Lomba 2", "Lomba 3", "Lomba 4",
    "Lomba 5", "Lomba 6", "Lomba 7", "Lomba 8",
    "Lomba 9", "Lomba 10", "Lomba 11", "Lomba 12",
  ],
};

/* ================================================================
   BAGIAN 2 — STATE APLIKASI
   ================================================================ */
const STATE = {
  jawara:[], penjelajah:[], prevJawara:[], prevPenjelajah:[],
  musicOn: CONFIG.musicAutoplay,
  lombaAktif:null, modeAktif:null, qrScanner:null, scanLog:[],
  pesertaAktif:null,

  // Cache data dari Firestore (di-update realtime)
  cachePeserta: [],
  cacheLog:     [],
  unsubPeserta: null,  // fungsi untuk berhenti listen
  unsubLog:     null,
};

/* ================================================================
   BAGIAN 3 — ROUTER HALAMAN
   ================================================================ */
function router() {
  const params = new URLSearchParams(window.location.search);
  const page   = params.get('page') || 'leaderboard';
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  const el = document.getElementById(`page-${page}`);
  if (el) el.style.display = 'block';

  switch (page) {
    case 'leaderboard': initLeaderboard(); break;
    case 'peserta':     initPeserta();     break;
    case 'panitia':     initPanitia();     break;
    case 'admin':       initAdmin();       break;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  spawnParticles();
  router();
});

/* ================================================================
   BAGIAN 4 — KONFIGURASI PERSISTEN (localStorage utk setting)
   ================================================================ */
function loadConfig() {
  const saved = localStorage.getItem('papanJuaraConfig');
  if (saved) Object.assign(CONFIG, JSON.parse(saved));
  const elTitle   = document.getElementById('event-title');
  const elTagline = document.getElementById('event-tagline');
  if (elTitle)   elTitle.textContent   = CONFIG.eventTitle;
  if (elTagline) elTagline.textContent = CONFIG.eventTagline;
}

function saveConfig() {
  CONFIG.eventTitle      = document.getElementById('cfg-title')?.value   || CONFIG.eventTitle;
  CONFIG.eventTagline    = document.getElementById('cfg-tagline')?.value || CONFIG.eventTagline;
  CONFIG.refreshInterval = (parseInt(document.getElementById('cfg-refresh')?.value) || 30) * 1000;
  localStorage.setItem('papanJuaraConfig', JSON.stringify(CONFIG));
  showToast('✅ Pengaturan berhasil disimpan!');
}

function populateConfigForm() {
  const f = { 'cfg-title':CONFIG.eventTitle, 'cfg-tagline':CONFIG.eventTagline, 'cfg-refresh':CONFIG.refreshInterval/1000 };
  for (const [id,val] of Object.entries(f)) { const el = document.getElementById(id); if (el) el.value = val; }
}

/* ================================================================
   BAGIAN 5 — AUTH ADMIN
   ================================================================ */
function initAdmin() {
  checkAdminSession();
  populateConfigForm();
}

function doLogin() {
  const user  = document.getElementById('inp-user')?.value.trim();
  const pass  = document.getElementById('inp-pass')?.value;
  const errEl = document.getElementById('login-error');
  if (user === CONFIG.adminUser && pass === CONFIG.adminPass) {
    sessionStorage.setItem('adminLoggedIn','true');
    showAdminPanel();
  } else {
    if (errEl) errEl.textContent = '❌ Username atau password salah!';
    const box = document.querySelector('.login-box');
    if (box) { box.style.animation='none'; setTimeout(()=>box.style.animation='shake .4s ease',10); }
  }
}

function checkAdminSession() {
  if (sessionStorage.getItem('adminLoggedIn') === 'true') showAdminPanel();
}

function showAdminPanel() {
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('admin-panel').style.display   = 'block';
  populateLombaFilter();
  generateAdminQR();
  // Mulai listen data realtime untuk tabel admin
  listenPeserta(() => { renderPesertaTable(); });
  listenLog(() => { renderPesertaTable(); renderLogTable(); });
}

function doLogout() {
  sessionStorage.removeItem('adminLoggedIn');
  location.reload();
}

/* ================================================================
   BAGIAN 6 — DATA PESERTA (FIRESTORE)
   Collection: "peserta"
   Dokumen: { nama, kelas, foto, createdAt }
   ================================================================ */

/**
 * Listen perubahan data peserta secara realtime.
 * Setiap ada perubahan di Firestore, cache di-update & callback dipanggil.
 * @param {Function} callback - dipanggil setiap data berubah
 */
function listenPeserta(callback) {
  // Hentikan listener lama jika ada
  if (STATE.unsubPeserta) STATE.unsubPeserta();
  STATE.unsubPeserta = db.collection('peserta')
    .onSnapshot(snap => {
      STATE.cachePeserta = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (callback) callback();
    }, err => console.error('[Firestore] listen peserta:', err));
}

/** Ambil peserta dari cache (sudah realtime) */
function getAllPeserta() {
  return STATE.cachePeserta;
}

/**
 * Daftarkan peserta baru ke Firestore.
 * @returns {Promise<{id,nama,kelas,foto}|null>} null jika nama sudah ada
 */
async function tambahPeserta(nama, kelas) {
  // Cek duplikat nama
  const existing = await db.collection('peserta').where('nama','==',nama).get();
  if (!existing.empty) return null;

  const data = { nama, kelas, foto:'', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
  const ref  = await db.collection('peserta').add(data);
  return { id: ref.id, ...data };
}

/**
 * Hapus peserta + semua score log-nya (untuk diskualifikasi)
 * @param {string} id
 */
async function hapusPeserta(id) {
  if (!confirm('⚠️ Hapus peserta ini? Semua score-nya juga dihapus!')) return;
  // Hapus dokumen peserta
  await db.collection('peserta').doc(id).delete();
  // Hapus semua log peserta ini
  const logs = await db.collection('log').where('pesertaId','==',id).get();
  const batch = db.batch();
  logs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  showToast('🗑️ Peserta berhasil dihapus');
}

/**
 * Update foto peserta. Foto di-upload ke Storage, URL disimpan di Firestore.
 * @param {string} id
 * @param {Blob} fotoBlob - file foto (sudah di-crop 1:1)
 * @returns {Promise<string>} URL foto
 */
async function updateFotoPeserta(id, fotoBlob) {
  // Upload ke Storage: folder foto/{id}.jpg
  const ref = storage.ref(`foto/${id}.jpg`);
  await ref.put(fotoBlob);
  const url = await ref.getDownloadURL();
  // Simpan URL ke Firestore
  await db.collection('peserta').doc(id).update({ foto: url });
  return url;
}

/** Reset semua peserta + log */
async function resetSemuaPeserta() {
  if (!confirm('⚠️ Hapus SEMUA peserta dan score? Tidak dapat dibatalkan!')) return;
  showToast('⏳ Menghapus...');
  await deleteCollection('peserta');
  await deleteCollection('log');
  showToast('🗑️ Semua data dihapus');
}

/* ================================================================
   BAGIAN 7 — SCORE LOG & POIN (FIRESTORE)
   Collection: "log"
   Dokumen: { pesertaId, nama, kelas, lomba, mode, waktu }
   ================================================================ */

/** Listen log realtime */
function listenLog(callback) {
  if (STATE.unsubLog) STATE.unsubLog();
  STATE.unsubLog = db.collection('log')
    .onSnapshot(snap => {
      STATE.cacheLog = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (callback) callback();
    }, err => console.error('[Firestore] listen log:', err));
}

function getAllLog() {
  return STATE.cacheLog;
}

/**
 * Tambah score (saat panitia scan QR).
 * Cek duplikat: 1 peserta hanya +1 per lomba per mode.
 * @returns {Promise<'ok'|'duplikat'|'tidak_ditemukan'>}
 */
async function tambahScore(pesertaId, lomba, mode) {
  // Cari peserta langsung dari Firestore (untuk akurasi)
  const pesertaDoc = await db.collection('peserta').doc(pesertaId).get();
  if (!pesertaDoc.exists) return 'tidak_ditemukan';
  const peserta = pesertaDoc.data();

  // Cek duplikat
  const dup = await db.collection('log')
    .where('pesertaId','==',pesertaId)
    .where('lomba','==',lomba)
    .where('mode','==',mode)
    .get();
  if (!dup.empty) return 'duplikat';

  // Simpan log baru
  await db.collection('log').add({
    pesertaId, nama: peserta.nama, kelas: peserta.kelas,
    lomba, mode,
    waktu: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return 'ok';
}

/** Hapus 1 entry log (koreksi admin) */
async function hapusLog(logId) {
  if (!confirm('Hapus entry score ini?')) return;
  await db.collection('log').doc(logId).delete();
  showToast('🗑️ Entry dihapus');
}

/** Reset semua score */
async function resetSemuaScore() {
  if (!confirm('⚠️ Reset SEMUA score? Peserta tetap, poin jadi 0!')) return;
  showToast('⏳ Mereset...');
  await deleteCollection('log');
  showToast('🗑️ Semua score direset');
}

/**
 * Hitung skor tiap peserta dari cache log (untuk leaderboard)
 * @param {'jawara'|'penjelajah'} mode
 */
function hitungSkor(mode) {
  const log = getAllLog().filter(l => l.mode === mode);
  const peserta = getAllPeserta();
  const map = {};
  log.forEach(l => { map[l.pesertaId] = (map[l.pesertaId]||0) + 1; });
  return peserta
    .filter(p => (map[p.id]||0) > 0)
    .map(p => ({ nama:p.nama, kelas:p.kelas, foto:p.foto, skor: map[p.id]||0 }))
    .sort((a,b) => b.skor - a.skor)
    .slice(0, CONFIG.topN);
}

/** Poin peserta tertentu */
function getPoinPeserta(pesertaId) {
  const log = getAllLog().filter(l => l.pesertaId === pesertaId);
  return {
    jawara    : log.filter(l => l.mode==='jawara').length,
    penjelajah: log.filter(l => l.mode==='penjelajah').length,
  };
}

/* ================================================================
   BAGIAN 8 — LEADERBOARD RENDER (REALTIME)
   ================================================================ */

/** Inisialisasi leaderboard dengan listener realtime */
function initLeaderboard() {
  // Listen peserta & log; setiap berubah → refresh leaderboard
  listenPeserta(() => refreshLeaderboard());
  listenLog(() => refreshLeaderboard());
  if (CONFIG.musicAutoplay) setTimeout(playBGM, 1000);
}

function refreshLeaderboard() {
  setRefreshIndicator('loading');
  try {
    const jawaraData     = hitungSkor('jawara');
    const penjelajahData = hitungSkor('penjelajah');
    const jChanges = detectRankChanges(STATE.prevJawara, jawaraData);
    const pChanges = detectRankChanges(STATE.prevPenjelajah, penjelajahData);
    STATE.prevJawara     = [...STATE.jawara];
    STATE.prevPenjelajah = [...STATE.penjelajah];
    STATE.jawara         = jawaraData;
    STATE.penjelajah     = penjelajahData;
    renderBoard('jawara',     jawaraData,     jChanges);
    renderBoard('penjelajah', penjelajahData, pChanges);
    handleRankChanges(jChanges, pChanges);
    updateFooter(getAllPeserta().length);
    setRefreshIndicator('live');
  } catch(e) { console.error('[PapanJuara] refresh:', e); setRefreshIndicator('error'); }
}

function renderBoard(type, data, changes) {
  const podiumEl = document.getElementById(`podium-${type}`);
  const listEl   = document.getElementById(`list-${type}`);
  if (!podiumEl || !listEl) return;
  const scoreUnit = 'Point';

  // Podium top 3 (dengan foto)
  const top3 = data.slice(0,3);
  podiumEl.innerHTML = top3.map((p,i) => {
    const rank = i+1;
    const avatar = p.foto
      ? `<img src="${p.foto}" alt="${escHtml(p.nama)}" />`
      : p.nama.charAt(0).toUpperCase();
    return `
      <div class="podium-item rank-${rank}" title="${escHtml(p.kelas)}">
        <div class="podium-avatar">${avatar}</div>
        <div class="podium-name">${escHtml(p.nama)}</div>
        <div class="podium-score">${p.skor} ${scoreUnit}</div>
        <div class="podium-base">#${rank}</div>
      </div>`;
  }).join('');

  // List rank 4-10
  const rest = data.slice(3);
  const anim = type === 'jawara' ? 'slideInLeft' : 'slideInRight';
  listEl.innerHTML = rest.map((p,i) => {
    const rank = i+4;
    const change = changes.get(p.nama) || 'same';
    const arrow  = change==='up' ? '▲' : (change==='down' ? '▼' : '');
    const color  = change==='up' ? '#4CAF50' : '#F44336';
    return `
      <li class="rank-item ${change!=='same'?'changed':''}"
          style="animation:${anim} ${0.3+i*0.07}s var(--ease-bounce) both"
          title="${escHtml(p.kelas)}">
        <div class="rank-change ${change}"></div>
        <div class="rank-num">${rank}</div>
        <div class="rank-info">
          <div class="rank-name">${escHtml(p.nama)}</div>
          <div class="rank-origin">${escHtml(p.kelas)}</div>
        </div>
        <div class="rank-score">${p.skor} ${scoreUnit}
          ${arrow?`<span style="font-size:.6rem;color:${color}">${arrow}</span>`:''}
        </div>
      </li>`;
  }).join('');

  if (top3.length>0 && STATE.prevJawara.length===0 && type==='jawara') setTimeout(fireConfetti,800);
}

/* ================================================================
   BAGIAN 9 — RANK CHANGE + ANIMASI
   ================================================================ */
function detectRankChanges(prev, curr) {
  const changes = new Map();
  if (!prev.length) return changes;
  const pr = new Map(prev.map((p,i)=>[p.nama,i+1]));
  curr.forEach((p,i)=>{
    const c=i+1, old=pr.get(p.nama);
    if (old===undefined) changes.set(p.nama,'up');
    else if (c<old) changes.set(p.nama,'up');
    else if (c>old) changes.set(p.nama,'down');
    else changes.set(p.nama,'same');
  });
  return changes;
}

function handleRankChanges(jc,pc) {
  const all=[...jc.entries(),...pc.entries()];
  const ups=all.filter(([,d])=>d==='up'), downs=all.filter(([,d])=>d==='down');
  if (ups.length)   { playSound('sfx-rank-up');   showRankToast('⬆️',`${ups[0][0]} naik posisi!`); }
  else if (downs.length){ playSound('sfx-rank-down'); showRankToast('⬇️',`${downs[0][0]} turun posisi`); }
}

function showRankToast(icon,msg){
  const t=document.getElementById('rank-toast'); if(!t) return;
  document.getElementById('rank-toast-icon').textContent=icon;
  document.getElementById('rank-toast-msg').textContent=msg;
  t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000);
}

function setRefreshIndicator(state){
  const dot=document.querySelector('.refresh-dot'), label=document.querySelector('.refresh-label');
  if(!dot) return;
  const m={live:['#4CAF50','Live'],loading:['#FFC107','Sync...'],error:['#F44336','Error']};
  const [c,t]=m[state]||['#888','—']; dot.style.background=c; if(label)label.textContent=t;
}

function updateFooter(total){
  const u=document.getElementById('last-update'), t=document.getElementById('total-peserta');
  if(u)u.textContent=new Date().toLocaleTimeString('id-ID'); if(t)t.textContent=total;
}

/* ================================================================
   BAGIAN 10 — HALAMAN PESERTA
   ================================================================ */
function initPeserta() {
  populateDropdownKelas();
  // Listen peserta untuk update dropdown nama & profil realtime
  listenPeserta(() => {
    populateDropdownNama();
    // Jika peserta sedang lihat profil, update poinnya
    if (STATE.pesertaAktif) {
      const p = getAllPeserta().find(x => x.id === STATE.pesertaAktif.id);
      if (p) updateProfilPoin(p.id);
    }
  });
  listenLog(() => {
    if (STATE.pesertaAktif) updateProfilPoin(STATE.pesertaAktif.id);
  });

  // Cek peserta tersimpan di device ini
  const savedId = localStorage.getItem('pesertaAktifId');
  if (savedId) {
    // Tunggu cache terisi, lalu tampilkan profil
    setTimeout(() => {
      const p = getAllPeserta().find(x => x.id === savedId);
      if (p) tampilkanProfil(p);
      else showFormPendaftaran();
    }, 800);
  } else {
    showFormPendaftaran();
  }
}

function showFormPendaftaran() {
  document.getElementById('peserta-form-section').style.display = 'block';
  document.getElementById('peserta-profile-section').style.display = 'none';
}

function populateDropdownNama() {
  const sel = document.getElementById('peserta-nama');
  if (!sel) return;
  const terdaftar = getAllPeserta().map(p => p.nama);
  // Reset dropdown
  sel.innerHTML = '<option value="">— Pilih Nama —</option>';
  CONFIG.daftarNama.forEach(nama => {
    const opt = document.createElement('option');
    opt.value = nama;
    opt.textContent = terdaftar.includes(nama) ? `${nama} ✓ (sudah daftar)` : nama;
    opt.disabled = terdaftar.includes(nama);
    sel.appendChild(opt);
  });
}

function populateDropdownKelas() {
  const sel = document.getElementById('peserta-kelas');
  if (!sel) return;
  CONFIG.daftarKelas.forEach(k => {
    const opt = document.createElement('option'); opt.value=opt.textContent=k; sel.appendChild(opt);
  });
}

/** Proses pendaftaran (async ke Firestore) */
async function daftarPeserta() {
  const nama  = document.getElementById('peserta-nama')?.value;
  const kelas = document.getElementById('peserta-kelas')?.value;
  const errEl = document.getElementById('peserta-error');
  if (!nama)  { if(errEl) errEl.textContent='❌ Pilih nama dulu!'; return; }
  if (!kelas) { if(errEl) errEl.textContent='❌ Pilih kelas dulu!'; return; }

  if (errEl) errEl.textContent = '⏳ Mendaftar...';
  try {
    const peserta = await tambahPeserta(nama, kelas);
    if (!peserta) { if(errEl) errEl.textContent='❌ Nama ini sudah terdaftar!'; return; }
    localStorage.setItem('pesertaAktifId', peserta.id);
    tampilkanProfil(peserta);
  } catch(e) {
    if (errEl) errEl.textContent = '❌ Gagal daftar: ' + e.message;
  }
}

function tampilkanProfil(peserta) {
  STATE.pesertaAktif = peserta;
  document.getElementById('peserta-form-section').style.display = 'none';
  document.getElementById('peserta-profile-section').style.display = 'block';
  document.getElementById('profile-name-display').textContent  = peserta.nama;
  document.getElementById('profile-kelas-display').textContent = peserta.kelas;
  document.getElementById('profile-initial').textContent       = peserta.nama.charAt(0).toUpperCase();

  if (peserta.foto) {
    const img = document.getElementById('profile-photo-img');
    img.src = peserta.foto; img.style.display='block';
    document.getElementById('profile-initial').style.display='none';
  }

  // QR berisi ID peserta
  const qc = document.getElementById('profile-qr-canvas');
  if (qc) { qc.innerHTML=''; new QRCode(qc, { text: peserta.id, width:180, height:180, correctLevel: QRCode.CorrectLevel.H }); }

  updateProfilPoin(peserta.id);
}

/** Update tampilan poin di profil */
function updateProfilPoin(pesertaId) {
  const poin = getPoinPeserta(pesertaId);
  const j=document.getElementById('stat-jawara'), p=document.getElementById('stat-penjelajah');
  if (j) j.textContent = poin.jawara;
  if (p) p.textContent = poin.penjelajah;
}

/** Upload foto: crop 1:1 → upload ke Storage */
async function handleFotoUpload(event) {
  const file = event.target.files[0];
  if (!file || !STATE.pesertaAktif) return;

  showToast('⏳ Mengupload foto...');
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      // Crop tengah ke 1:1, output 300x300
      const size = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 300;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,(img.width-size)/2,(img.height-size)/2,size,size,0,0,300,300);

      // Konversi canvas → Blob → upload
      canvas.toBlob(async (blob) => {
        try {
          const url = await updateFotoPeserta(STATE.pesertaAktif.id, blob);
          STATE.pesertaAktif.foto = url;
          const imgEl = document.getElementById('profile-photo-img');
          imgEl.src = url; imgEl.style.display='block';
          document.getElementById('profile-initial').style.display='none';
          showToast('✅ Foto berhasil diperbarui!');
        } catch(err) {
          showToast('❌ Gagal upload: ' + err.message);
        }
      }, 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function logoutPeserta() {
  if (!confirm('Keluar dari profil ini di perangkat ini?')) return;
  localStorage.removeItem('pesertaAktifId');
  STATE.pesertaAktif = null;
  location.reload();
}

/* ================================================================
   BAGIAN 11 — HALAMAN PANITIA (SCANNER)
   ================================================================ */
function initPanitia() {
  // Listen agar data peserta tersedia saat scan
  listenPeserta();
  listenLog();
  renderLombaGrid();
}

function renderLombaGrid() {
  const grid = document.getElementById('lomba-grid');
  if (!grid) return;
  grid.innerHTML = CONFIG.daftarLomba.map((lomba,i)=>`
    <button class="lomba-btn" onclick="pilihLomba('${escHtml(lomba)}',this)">
      <div style="font-size:1.3rem;margin-bottom:.3rem">${getLombaEmoji(i)}</div>
      ${escHtml(lomba)}
    </button>`).join('');
}

function getLombaEmoji(i){ return ['🎯','🏃','🎨','🎭','🎵','🏆','⚡','🌟','🎪','🎲','🌺','🎋'][i%12]; }

function pilihLomba(lomba, btn) {
  STATE.lombaAktif = lomba;
  document.querySelectorAll('.lomba-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('step-pilih-lomba').style.display='none';
  document.getElementById('step-pilih-mode').style.display='block';
  document.getElementById('lomba-terpilih-label').textContent=lomba;
}

function mulaiScan(mode) {
  STATE.modeAktif = mode;
  document.getElementById('step-pilih-mode').style.display='none';
  document.getElementById('step-scanner').style.display='block';
  document.getElementById('scan-lomba-label').textContent=STATE.lombaAktif;
  document.getElementById('scan-mode-label').textContent=mode==='jawara'?'👑 Jawara':'🗺️ Penjelajah';
  document.getElementById('scan-result').style.display='none';

  STATE.qrScanner = new Html5Qrcode('qr-reader');
  STATE.qrScanner.start(
    { facingMode:'environment' },
    { fps:10, qrbox:{width:220,height:220} },
    (text)=>onQRScan(text),
    ()=>{}
  ).catch(err => showToast('⚠️ Tidak bisa akses kamera: '+err));
}

/** Callback scan QR (async ke Firestore) */
async function onQRScan(pesertaId) {
  if (STATE.qrScanner) STATE.qrScanner.pause();

  const resultEl = document.getElementById('scan-result');
  resultEl.style.display='block'; resultEl.className='scan-result';
  document.getElementById('scan-result-icon').textContent='⏳';
  document.getElementById('scan-result-name').textContent='Memproses...';
  document.getElementById('scan-result-msg').textContent='';

  try {
    const status = await tambahScore(pesertaId, STATE.lombaAktif, STATE.modeAktif);
    const peserta = getAllPeserta().find(p=>p.id===pesertaId);

    if (status === 'ok') {
      resultEl.classList.add('ok');
      document.getElementById('scan-result-icon').textContent='✅';
      document.getElementById('scan-result-name').textContent=peserta?.nama||pesertaId;
      document.getElementById('scan-result-msg').textContent=`+1 Point ${STATE.modeAktif==='jawara'?'Jawara':'Penjelajah'} berhasil!`;
      playSound('sfx-scan-ok');
      STATE.scanLog.unshift({nama:peserta?.nama,status:'OK',waktu:new Date().toLocaleTimeString('id-ID')});
      renderScanLog();
    } else if (status === 'duplikat') {
      resultEl.classList.add('err');
      document.getElementById('scan-result-icon').textContent='⚠️';
      document.getElementById('scan-result-name').textContent=peserta?.nama||'—';
      document.getElementById('scan-result-msg').textContent='Sudah di-scan di lomba ini!';
      playSound('sfx-scan-err');
    } else {
      resultEl.classList.add('err');
      document.getElementById('scan-result-icon').textContent='❌';
      document.getElementById('scan-result-name').textContent='—';
      document.getElementById('scan-result-msg').textContent='QR tidak dikenali';
      playSound('sfx-scan-err');
    }
  } catch(e) {
    resultEl.classList.add('err');
    document.getElementById('scan-result-icon').textContent='❌';
    document.getElementById('scan-result-msg').textContent='Error: '+e.message;
  }

  setTimeout(()=>{ if(STATE.qrScanner) STATE.qrScanner.resume(); }, 2500);
}

function renderScanLog() {
  const ul=document.getElementById('scan-log-list'); if(!ul) return;
  ul.innerHTML = STATE.scanLog.slice(0,15).map(l=>`
    <li><span>${escHtml(l.nama||'—')}</span>
    <span style="color:${l.status==='OK'?'#4CAF50':'#F44336'}">${l.status} · ${l.waktu}</span></li>`).join('');
}

function stopScan() {
  if (STATE.qrScanner) { STATE.qrScanner.stop().catch(()=>{}); STATE.qrScanner=null; }
  resetPanitia();
}

function resetPanitia() {
  STATE.lombaAktif=null; STATE.modeAktif=null;
  document.getElementById('step-pilih-lomba').style.display='block';
  document.getElementById('step-pilih-mode').style.display='none';
  document.getElementById('step-scanner').style.display='none';
  document.querySelectorAll('.lomba-btn').forEach(b=>b.classList.remove('selected'));
}

/* ================================================================
   BAGIAN 12 — ADMIN PANEL
   ================================================================ */
function switchAdminTab(tabId) {
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  document.querySelectorAll('.admin-tab').forEach(btn=>{
    if (btn.getAttribute('onclick')?.includes(tabId)) btn.classList.add('active');
  });
}

function renderPesertaTable() {
  const tbody=document.getElementById('tbody-peserta'), counter=document.getElementById('total-count');
  if(!tbody) return;
  const q=document.getElementById('search-peserta')?.value.toLowerCase()||'';
  const peserta=getAllPeserta().filter(p=>p.nama.toLowerCase().includes(q)||p.kelas.toLowerCase().includes(q));
  if(counter) counter.textContent=getAllPeserta().length;
  if(!peserta.length){ tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--cream-dark);padding:1.5rem">Belum ada peserta</td></tr>'; return; }
  tbody.innerHTML=peserta.map(p=>{
    const poin=getPoinPeserta(p.id);
    const avatar=p.foto?`<div class="tbl-avatar"><img src="${p.foto}"/></div>`:`<div class="tbl-avatar">${p.nama.charAt(0).toUpperCase()}</div>`;
    return `<tr><td>${avatar}</td><td>${escHtml(p.nama)}</td><td>${escHtml(p.kelas)}</td>
      <td style="color:var(--gold)">${poin.jawara}</td><td style="color:#A8E6CF">${poin.penjelajah}</td>
      <td><button class="tbl-del-btn" onclick="hapusPeserta('${p.id}')" title="Hapus/Diskualifikasi">🗑️</button></td></tr>`;
  }).join('');
}

function renderLogTable() {
  const tbody=document.getElementById('tbody-log'); if(!tbody) return;
  const fl=document.getElementById('filter-lomba')?.value||'', fm=document.getElementById('filter-mode')?.value||'';
  let log=getAllLog();
  if(fl) log=log.filter(l=>l.lomba===fl);
  if(fm) log=log.filter(l=>l.mode===fm);
  // urutkan terbaru (waktu bisa berupa Timestamp Firestore)
  log=log.sort((a,b)=>toMillis(b.waktu)-toMillis(a.waktu));
  if(!log.length){ tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--cream-dark);padding:1.5rem">Belum ada data scan</td></tr>'; return; }
  tbody.innerHTML=log.map(l=>`<tr>
    <td style="font-size:.7rem">${formatWaktu(l.waktu)}</td>
    <td>${escHtml(l.nama)}</td><td>${escHtml(l.kelas)}</td><td>${escHtml(l.lomba)}</td>
    <td><span style="color:${l.mode==='jawara'?'var(--gold)':'#A8E6CF'}">${l.mode==='jawara'?'👑 Jawara':'🗺️ Penjelajah'}</span></td>
    <td><button class="tbl-del-btn" onclick="hapusLog('${l.id}')">🗑️</button></td></tr>`).join('');
}

/** Konversi Firestore Timestamp / ISO ke milidetik */
function toMillis(w){ if(!w) return 0; if(w.toMillis) return w.toMillis(); return new Date(w).getTime(); }
function formatWaktu(w){ if(!w) return '—'; const d=w.toDate?w.toDate():new Date(w); return d.toLocaleString('id-ID'); }

function populateLombaFilter() {
  const sel=document.getElementById('filter-lomba'); if(!sel) return;
  sel.innerHTML='<option value="">Semua Lomba</option>';
  CONFIG.daftarLomba.forEach(l=>{ const o=document.createElement('option'); o.value=o.textContent=l; sel.appendChild(o); });
}

function generateAdminQR() {
  const c=document.getElementById('admin-qr-pendaftaran'), u=document.getElementById('admin-qr-url');
  if(!c) return;
  const url=`${location.origin}${location.pathname}?page=peserta`;
  if(u) u.textContent=url;
  c.innerHTML=''; new QRCode(c, { text: url, width:220, height:220, correctLevel: QRCode.CorrectLevel.H });
}

function printQR() {
  const box=document.getElementById('admin-qr-pendaftaran'); if(!box) return;
  // qrcodejs bisa render sebagai <canvas> atau <img> — ambil mana yang ada
  const canvas=box.querySelector('canvas');
  const img=box.querySelector('img');
  const src = canvas ? canvas.toDataURL() : (img ? img.src : '');
  if(!src) return;
  const win=window.open('');
  win.document.write(`<html><body style="text-align:center;padding:2rem;font-family:sans-serif">
    <h2>QR Pendaftaran Peserta</h2><p>${CONFIG.eventTitle}</p>
    <img src="${src}" style="width:300px"/>
    <p style="margin-top:1rem;font-size:.8rem">Scan untuk mendaftar</p>
    <script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`);
}

/* ================================================================
   BAGIAN 13 — AUDIO & EFEK
   ================================================================ */
function playSound(id){ try{const el=document.getElementById(id); if(!el)return; el.currentTime=0; el.volume=.5; el.play().catch(()=>{});}catch(e){} }
function toggleMusic(){ const b=document.getElementById('bgm-loop'),btn=document.getElementById('btn-music'); if(!b)return;
  if(STATE.musicOn){b.pause();STATE.musicOn=false;if(btn)btn.textContent='🔇';}else{playBGM();STATE.musicOn=true;if(btn)btn.textContent='🎵';} }
function playBGM(){ const b=document.getElementById('bgm-loop'); if(!b)return; b.volume=.15; b.play().catch(()=>{}); }
function fireConfetti(){ if(typeof confetti==='undefined')return;
  confetti({particleCount:120,spread:80,origin:{y:.6},colors:['#F5C842','#FFE68A','#9B1B30','#1A6B4A','#FDF3DC'],scalar:1.2});
  setTimeout(()=>{confetti({particleCount:60,angle:60,spread:55,origin:{x:0},colors:['#F5C842','#9B1B30']});
  confetti({particleCount:60,angle:120,spread:55,origin:{x:1},colors:['#1A6B4A','#FFE68A']});},600);
  playSound('sfx-confetti'); }
function spawnParticles(){ const c=document.getElementById('particles'); if(!c)return;
  const icons=['🍃','🌺','✨','🌸','🎋','⭐','🌿','💫'];
  for(let i=0;i<18;i++){const el=document.createElement('div');el.className='particle';
    el.textContent=icons[Math.floor(Math.random()*icons.length)];el.style.left=`${Math.random()*100}%`;
    el.style.fontSize=`${.8+Math.random()*1.2}rem`;el.style.animationDuration=`${12+Math.random()*18}s`;
    el.style.animationDelay=`${Math.random()*20}s`;c.appendChild(el);} }

/* ================================================================
   BAGIAN 14 — UTILITAS
   ================================================================ */
function escHtml(str){ return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showToast(msg){
  let t=document.getElementById('global-toast');
  if(!t){t=document.createElement('div');t.id='global-toast';
    t.style.cssText=`position:fixed;bottom:2rem;right:2rem;z-index:9999;background:linear-gradient(135deg,#2A1000,#4A2000);border:1.5px solid var(--gold-dark);border-radius:10px;padding:.7rem 1.3rem;color:var(--gold-light);font-family:var(--font-ui);font-size:.82rem;box-shadow:0 8px 30px rgba(0,0,0,.7);opacity:0;transform:translateY(20px);transition:all .3s ease;pointer-events:none;`;
    document.body.appendChild(t);}
  t.textContent=msg;t.style.opacity='1';t.style.transform='translateY(0)';
  setTimeout(()=>{t.style.opacity='0';t.style.transform='translateY(20px)';},3000);
}

/**
 * Hapus seluruh dokumen dalam sebuah collection (untuk reset).
 * @param {string} name - nama collection
 */
async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  const batch = db.batch();
  snap.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

/* ================================================================
   BAGIAN 15 — MODAL BANTUAN
   ================================================================ */
const HELP_CONTENT = {
  peserta: {
    icon:'🎭', title:'Panduan Peserta',
    steps:[
      '<strong>Pilih nama & kelas</strong> kamu dari daftar, lalu tekan Daftar.',
      '<strong>Upload foto</strong> dengan mengetuk lingkaran foto. Foto tampil di leaderboard kalau masuk Top 3.',
      '<strong>Tunjukkan QR Code kamu</strong> ke panitia setiap selesai ikut/menang lomba.',
      'Cek <strong>poin kamu</strong> kapan saja di halaman profil ini.',
    ],
    note:'💡 Satu nama hanya bisa daftar sekali. QR code kamu identitas unik — jangan dibagikan!',
  },
  panitia: {
    icon:'⚡', title:'Panduan Panitia',
    steps:[
      '<strong>Pilih lomba</strong> yang sedang berlangsung dari 12 tombol.',
      '<strong>Pilih mode:</strong> "Jawara" untuk yang MENANG, "Penjelajah" untuk yang IKUT.',
      '<strong>Scan QR code</strong> peserta. Poin otomatis +1.',
      'Kalau sudah pernah di-scan di lomba & mode sama, sistem <strong>menolak otomatis</strong>.',
    ],
    note:'💡 Izinkan akses kamera saat diminta. Cek log scan di bawah untuk memastikan data masuk.',
  },
};

function showHelp(page){
  const d=HELP_CONTENT[page]; if(!d)return;
  document.getElementById('help-icon').textContent=d.icon;
  document.getElementById('help-title').textContent=d.title;
  document.getElementById('help-content').innerHTML=`<ol>${d.steps.map(s=>`<li>${s}</li>`).join('')}</ol>${d.note?`<div class="help-note">${d.note}</div>`:''}`;
  document.getElementById('help-overlay').style.display='flex';
}
function closeHelp(event){ if(event&&event.target.id!=='help-overlay')return; document.getElementById('help-overlay').style.display='none'; }
