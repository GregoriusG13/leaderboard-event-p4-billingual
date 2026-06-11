/**
 * ================================================================
 * PAPAN JUARA — app.js (Firebase + Timer + Login Peserta)
 * ================================================================
 *   BAGIAN 1  — Konfigurasi (EDIT DI SINI)
 *   BAGIAN 2  — State
 *   BAGIAN 3  — Router
 *   BAGIAN 4  — Config persisten
 *   BAGIAN 5  — Auth admin
 *   BAGIAN 6  — Data peserta (Firestore) + login/logout
 *   BAGIAN 7  — Score log & poin
 *   BAGIAN 8  — TIMER EVENT (Firestore, sinkron semua device)
 *   BAGIAN 9  — Leaderboard render
 *   BAGIAN 10 — Rank change
 *   BAGIAN 11 — Halaman peserta
 *   BAGIAN 12 — Halaman panitia
 *   BAGIAN 13 — Admin panel
 *   BAGIAN 14 — Audio & efek
 *   BAGIAN 15 — Utilitas
 *   BAGIAN 16 — Modal bantuan (auto-show sekali per device)
 *
 *   `db` didefinisikan di index.html (Firebase).
 * ================================================================
 */

/* ================================================================
   BAGIAN 1 — KONFIGURASI
   ================================================================ */
const CONFIG = {
  eventTitle  : "NAMA EVENT",
  eventTagline: "Tagline Event · Tahun",
  topN : 10,

  // Admin — WAJIB GANTI sebelum deploy!
  adminUser : "admin",
  adminPass : "papanjuara2025",

  musicAutoplay : false,

  // ImgBB API key (foto). Dapatkan di https://api.imgbb.com
  imgbbApiKey : "GANTI_DENGAN_API_KEY_IMGBB",

  // Daftar 12 lomba
  daftarLomba : [
    "Congklak", "Bentengan", "Sipak Rago", "Boi-boian",
    "Klek Engklek", "Golong-golong", "Dam-daman", "Marble Action",
    "Kelereng Billiard", "Bola Bekel 3000", "Lucky Compass", "Ketapel",
  ],
};

/* ================================================================
   BAGIAN 2 — STATE
   ================================================================ */
const STATE = {
  jawara:[], penjelajah:[], prevJawara:[], prevPenjelajah:[],
  musicOn: true,
  _audioUnlocked:false,
  lombaAktif:null, modeAktif:null, qrScanner:null, scanLog:[],
  pesertaAktif:null,
  cachePeserta:[], cacheLog:[], cacheVote:[],
  unsubPeserta:null, unsubLog:null, unsubTimer:null, unsubVote:null, unsubVoteDisplay:null,
  // Timer
  eventStatus:'idle',  // 'idle' | 'running' | 'ended'
  eventEndAt:null,     // timestamp (ms) kapan event berakhir
  eventStartedAt:null, // timestamp (ms) kapan event dimulai
  timerInterval:null,
  countdownDone:false, // sudah tampilkan animasi 3-2-1?
  _lastCountdownEndAt:null, // endAt terakhir yang sudah ditampilkan countdown-nya
  _endToastShown:false,     // sudah tampilkan toast "event selesai"?
};

/* ================================================================
   BAGIAN 3 — ROUTER
   ================================================================ */
function router() {
  const page = new URLSearchParams(location.search).get('page') || 'leaderboard';
  document.querySelectorAll('.page').forEach(p => p.style.display='none');
  const el = document.getElementById(`page-${page}`);
  if (el) el.style.display='block';
  switch(page) {
    case 'leaderboard': initLeaderboard(); break;
    case 'peserta':     initPeserta();     break;
    case 'panitia':     initPanitia();     break;
    case 'admin':       initAdmin();       break;
  }
}
document.addEventListener('DOMContentLoaded', () => {
  loadConfig(); spawnParticles(); listenTimer(); router();
});

/* ================================================================
   BAGIAN 4 — CONFIG PERSISTEN
   ================================================================ */
function loadConfig() {
  const s = localStorage.getItem('papanJuaraConfig');
  if (s) Object.assign(CONFIG, JSON.parse(s));
  const t=document.getElementById('event-title'), g=document.getElementById('event-tagline');
  if (t) t.textContent=CONFIG.eventTitle;
  if (g) g.textContent=CONFIG.eventTagline;
}
function saveConfig() {
  CONFIG.eventTitle   = document.getElementById('cfg-title')?.value   || CONFIG.eventTitle;
  CONFIG.eventTagline = document.getElementById('cfg-tagline')?.value || CONFIG.eventTagline;
  localStorage.setItem('papanJuaraConfig', JSON.stringify(CONFIG));
  showToast('✅ Pengaturan disimpan!');
}
function populateConfigForm() {
  const t=document.getElementById('cfg-title'), g=document.getElementById('cfg-tagline');
  if (t) t.value=CONFIG.eventTitle; if (g) g.value=CONFIG.eventTagline;
}

/* ================================================================
   BAGIAN 5 — AUTH ADMIN
   ================================================================ */
function initAdmin() { checkAdminSession(); populateConfigForm(); }
function doLogin() {
  const u=document.getElementById('inp-user')?.value.trim(), p=document.getElementById('inp-pass')?.value;
  const e=document.getElementById('login-error');
  if (u===CONFIG.adminUser && p===CONFIG.adminPass) { sessionStorage.setItem('adminLoggedIn','true'); showAdminPanel(); }
  else { if(e) e.textContent='❌ Username atau password salah!';
    const b=document.querySelector('.login-box'); if(b){b.style.animation='none';setTimeout(()=>b.style.animation='shake .4s ease',10);} }
}
function checkAdminSession() { if (sessionStorage.getItem('adminLoggedIn')==='true') showAdminPanel(); }
function showAdminPanel() {
  document.getElementById('login-overlay').style.display='none';
  document.getElementById('admin-panel').style.display='block';
  populateLombaFilter(); generateAdminQR();
  listenPeserta(()=>renderPesertaTable());
  listenLog(()=>{ renderPesertaTable(); renderLogTable(); });
  listenVote(()=>updateVoteAdminPreview());
  updateAdminTimerUI();
}
function doLogout() { sessionStorage.removeItem('adminLoggedIn'); location.reload(); }

/* ================================================================
   BAGIAN 6 — DATA PESERTA + LOGIN/LOGOUT
   Collection "peserta": { nama, kelas, username, password, foto, createdAt }
   ================================================================ */
function listenPeserta(cb) {
  if (STATE.unsubPeserta) STATE.unsubPeserta();
  STATE.unsubPeserta = db.collection('peserta').onSnapshot(snap => {
    STATE.cachePeserta = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (cb) cb();
  }, err=>console.error('[FS peserta]',err));
}
function getAllPeserta() { return STATE.cachePeserta; }

/**
 * Daftar peserta baru.
 * Validasi: username harus diawali "peserta", unik, password min 4.
 * @returns {Promise<{ok:boolean, msg?:string, peserta?:object}>}
 */
async function registerPeserta(nama, kelas, username, password) {
  username = username.trim();
  nama = nama.trim();
  // Validasi nickname harus diakhiri "Fam"
  if (!nama.toLowerCase().endsWith('fam'))
    return { ok:false, msg:'Nickname harus diakhiri kata "Fam"' };
  // Validasi username diawali "peserta"
  if (!username.toLowerCase().startsWith('peserta'))
    return { ok:false, msg:'Username harus diawali kata "peserta"' };
  if (password.length < 4)
    return { ok:false, msg:'Password minimal 4 karakter' };

  // Cek username unik
  const dup = await db.collection('peserta').where('username','==',username).get();
  if (!dup.empty) return { ok:false, msg:'Username sudah dipakai, pilih yang lain' };

  const data = {
    nama, kelas: kelas.trim(), username, password,
    foto:'', createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  const ref = await db.collection('peserta').add(data);
  return { ok:true, peserta:{ id:ref.id, ...data } };
}

/**
 * Login peserta dengan username + password.
 * @returns {Promise<{ok:boolean, msg?:string, peserta?:object}>}
 */
async function authPeserta(username, password) {
  const snap = await db.collection('peserta')
    .where('username','==',username.trim())
    .where('password','==',password)
    .get();
  if (snap.empty) return { ok:false, msg:'Username atau password salah' };
  const doc = snap.docs[0];
  return { ok:true, peserta:{ id:doc.id, ...doc.data() } };
}

async function hapusPeserta(id) {
  if (!confirm('⚠️ Hapus peserta ini? Semua score-nya juga dihapus!')) return;
  await db.collection('peserta').doc(id).delete();
  const logs = await db.collection('log').where('pesertaId','==',id).get();
  const batch = db.batch(); logs.forEach(d=>batch.delete(d.ref)); await batch.commit();
  showToast('🗑️ Peserta dihapus');
}

/**
 * Admin ubah password peserta (kalau lupa)
 */
async function ubahPasswordPeserta(id, namaPeserta) {
  const baru = prompt(`Password baru untuk ${namaPeserta}:`);
  if (!baru) return;
  if (baru.length < 4) { alert('Password minimal 4 karakter'); return; }
  await db.collection('peserta').doc(id).update({ password: baru });
  showToast('✅ Password diperbarui');
}

/** Upload foto via ImgBB → simpan URL ke Firestore */
async function updateFotoPeserta(id, fotoBlob) {
  const fd = new FormData(); fd.append('image', fotoBlob);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${CONFIG.imgbbApiKey}`, { method:'POST', body:fd });
  const data = await res.json();
  if (!data.success) throw new Error('Upload ImgBB gagal');
  const url = data.data.url;
  await db.collection('peserta').doc(id).update({ foto:url });
  return url;
}

async function resetSemuaPeserta() {
  if (!confirm('⚠️ Hapus SEMUA peserta dan score?')) return;
  showToast('⏳ Menghapus...'); await deleteCollection('peserta'); await deleteCollection('log');
  showToast('🗑️ Semua data dihapus');
}

/* ================================================================
   BAGIAN 7 — SCORE LOG & POIN
   ================================================================ */
function listenLog(cb) {
  if (STATE.unsubLog) STATE.unsubLog();
  STATE.unsubLog = db.collection('log').onSnapshot(snap => {
    STATE.cacheLog = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (cb) cb();
  }, err=>console.error('[FS log]',err));
}
function getAllLog() { return STATE.cacheLog; }

async function tambahScore(pesertaId, lomba, mode) {
  // BLOKIR jika event tidak sedang berjalan
  if (STATE.eventStatus !== 'running') return 'event_tutup';

  const doc = await db.collection('peserta').doc(pesertaId).get();
  if (!doc.exists) return 'tidak_ditemukan';
  const peserta = doc.data();

  const dup = await db.collection('log')
    .where('pesertaId','==',pesertaId).where('lomba','==',lomba).where('mode','==',mode).get();
  if (!dup.empty) return 'duplikat';

  await db.collection('log').add({
    pesertaId, nama:peserta.nama, kelas:peserta.kelas, lomba, mode,
    waktu: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return 'ok';
}

async function hapusLog(logId) {
  if (!confirm('Hapus entry ini?')) return;
  await db.collection('log').doc(logId).delete(); showToast('🗑️ Entry dihapus');
}
async function resetSemuaScore() {
  if (!confirm('⚠️ Reset SEMUA score?')) return;
  showToast('⏳ Mereset...'); await deleteCollection('log'); showToast('🗑️ Score direset');
}

function hitungSkor(mode) {
  const log=getAllLog().filter(l=>l.mode===mode), peserta=getAllPeserta(), map={};
  log.forEach(l=>map[l.pesertaId]=(map[l.pesertaId]||0)+1);
  return peserta.filter(p=>(map[p.id]||0)>0)
    .map(p=>({nama:p.nama,kelas:p.kelas,foto:p.foto,skor:map[p.id]||0}))
    .sort((a,b)=>b.skor-a.skor).slice(0,CONFIG.topN);
}
function getPoinPeserta(id) {
  const log=getAllLog().filter(l=>l.pesertaId===id);
  return { jawara:log.filter(l=>l.mode==='jawara').length, penjelajah:log.filter(l=>l.mode==='penjelajah').length };
}

/* ================================================================
   BAGIAN 8 — TIMER EVENT (Firestore: doc "event/status")
   Struktur: { status:'idle'|'running'|'ended', endAt: <ms>, startedAt: <ms> }
   ================================================================ */

/** Listen status timer realtime dari Firestore */
function listenTimer() {
  if (STATE.unsubTimer) STATE.unsubTimer();
  STATE.unsubTimer = db.collection('event').doc('status').onSnapshot(doc => {
    if (!doc.exists) { STATE.eventStatus='idle'; STATE.eventEndAt=null; }
    else {
      const d = doc.data();
      STATE.eventStatus = d.status || 'idle';
      STATE.eventEndAt  = d.endAt || null;
      STATE.eventStartedAt = d.startedAt || null;
    }
    onTimerUpdate();
  }, err=>console.error('[FS timer]',err));
}

/** Dipanggil setiap status timer berubah */
function onTimerUpdate() {
  // Update tampilan sesuai halaman
  const page = new URLSearchParams(location.search).get('page') || 'leaderboard';

  // Auto-end jika waktu sudah lewat
  if (STATE.eventStatus==='running' && STATE.eventEndAt && Date.now() >= STATE.eventEndAt) {
    // Tandai berakhir (hanya admin yang menulis, tapi semua bisa anggap ended lokal)
    STATE.eventStatus = 'ended';
  }

  if (page==='leaderboard') updateLeaderboardTimer();
  if (page==='panitia')     updatePanitiaStatus();
  if (page==='admin')       updateAdminTimerUI();

  // Jalankan interval lokal untuk hitung mundur tampilan
  startLocalTimerTick();
}

/** Interval lokal untuk update angka countdown tiap detik */
function startLocalTimerTick() {
  if (STATE.timerInterval) clearInterval(STATE.timerInterval);
  if (STATE.eventStatus !== 'running') { renderTimerText(); return; }
  STATE.timerInterval = setInterval(() => {
    if (STATE.eventEndAt && Date.now() >= STATE.eventEndAt) {
      STATE.eventStatus = 'ended';
      clearInterval(STATE.timerInterval);
      const page = new URLSearchParams(location.search).get('page') || 'leaderboard';
      if (page==='leaderboard') updateLeaderboardTimer();
      if (page==='panitia')     updatePanitiaStatus();
      if (page==='admin')       updateAdminTimerUI();
    }
    renderTimerText();
  }, 1000);
  renderTimerText();
}

/** Hitung sisa waktu dalam format MM:SS */
function sisaWaktuStr() {
  if (!STATE.eventEndAt) return '--:--';
  let sisa = Math.max(0, STATE.eventEndAt - Date.now());
  const totalDetik = Math.floor(sisa/1000);
  const m = String(Math.floor(totalDetik/60)).padStart(2,'0');
  const s = String(totalDetik%60).padStart(2,'0');
  return `${m}:${s}`;
}

/** Update angka timer di header leaderboard */
function renderTimerText() {
  const el = document.getElementById('timer-text');
  if (!el) return;
  if (STATE.eventStatus==='running') el.textContent = sisaWaktuStr();
  else if (STATE.eventStatus==='ended') el.textContent = '00:00';
  else el.textContent = '--:--';
}

/** ── ADMIN: Mulai event ── */
async function mulaiEvent() {
  const menit = parseInt(document.getElementById('timer-durasi')?.value) || 60;
  const endAt = Date.now() + menit*60*1000;
  STATE._timeupPlayed = false;  // reset agar suara selesai bisa bunyi lagi
  await db.collection('event').doc('status').set({
    status:'running', endAt, startedAt: Date.now(), durasiMenit: menit,
  });
  showToast(`▶️ Event dimulai! Durasi ${menit} menit`);
}

/** ── ADMIN: Reset event ── */
async function resetEvent() {
  if (!confirm('Reset event? Timer kembali ke awal & leaderboard bisa diulang.')) return;
  await db.collection('event').doc('status').set({ status:'idle', endAt:null, startedAt:null });
  showToast('🔄 Event direset');
}

/** Update UI timer di panel admin */
function updateAdminTimerUI() {
  const valueEl = document.getElementById('timer-status-value');
  const cdEl    = document.getElementById('timer-countdown-big');
  const inputRow= document.getElementById('timer-input-row');
  const btnMulai= document.getElementById('btn-mulai-timer');
  if (!valueEl) return;

  if (STATE.eventStatus==='running') {
    valueEl.textContent='🟢 Sedang Berjalan'; valueEl.style.color='#4CAF50';
    cdEl.textContent = sisaWaktuStr();
    if (inputRow) inputRow.style.display='none';
    if (btnMulai) btnMulai.style.display='none';
  } else if (STATE.eventStatus==='ended') {
    valueEl.textContent='🔴 Selesai'; valueEl.style.color='#F44336';
    cdEl.textContent='00:00';
    if (inputRow) inputRow.style.display='flex';
    if (btnMulai) { btnMulai.style.display='inline-block'; btnMulai.textContent='▶️ MULAI LAGI'; }
  } else {
    valueEl.textContent='⚪ Belum Dimulai'; valueEl.style.color='var(--cream-dark)';
    cdEl.textContent='--:--';
    if (inputRow) inputRow.style.display='flex';
    if (btnMulai) { btnMulai.style.display='inline-block'; btnMulai.textContent='▶️ MULAI EVENT'; }
  }
}

/** Update overlay status di leaderboard + animasi 3-2-1 */
function updateLeaderboardTimer() {
  const statusOverlay = document.getElementById('status-overlay');
  const timerDisplay  = document.getElementById('timer-display');
  const statusEvent   = document.getElementById('status-event');

  renderTimerText();

  if (STATE.eventStatus==='running') {
    // Tampilkan animasi 3-2-1 setiap kali ada event BARU (endAt berbeda dari yang terakhir ditampilkan)
    // dan sisa waktu memang masih banyak (baru mulai, bukan refresh di tengah jalan)
    const sisaMs = STATE.eventEndAt ? (STATE.eventEndAt - Date.now()) : 0;
    const lastCd = STATE._lastCountdownEndAt;
    const eventBaru = STATE.eventEndAt && lastCd !== STATE.eventEndAt;

    // Hitung total durasi event untuk tahu apakah ini "baru mulai"
    // Tampilkan countdown jika event baru DAN sisa waktu > (durasi - 5 detik)
    // Artinya kita masih di ~5 detik pertama event
    if (eventBaru && sisaMs > 0) {
      const startedAt = STATE.eventStartedAt || 0;
      const detikSejakMulai = startedAt ? (Date.now() - startedAt)/1000 : 0;
      // Hanya jalankan countdown kalau event baru dimulai (< 5 detik lalu)
      if (detikSejakMulai < 5) {
        STATE._lastCountdownEndAt = STATE.eventEndAt;
        jalankanCountdown321();
      } else {
        // Event sudah jalan sebelum kita buka halaman → jangan countdown, langsung tampil
        STATE._lastCountdownEndAt = STATE.eventEndAt;
      }
    }
    if (statusOverlay) statusOverlay.style.display='none';
    if (timerDisplay)  timerDisplay.style.display='flex';
    if (statusEvent)   statusEvent.textContent='🟢 Berlangsung';
    STATE._endToastShown=false; // reset agar toast "selesai" bisa muncul lagi nanti
  } else if (STATE.eventStatus==='ended') {
    // Event selesai: leaderboard TETAP terlihat, hanya tampilkan badge "Ditutup"
    // Overlay status disembunyikan agar papan juara tetap bisa dilihat
    const ov=document.getElementById('status-overlay');
    if (ov) ov.style.display='none';
    if (timerDisplay) timerDisplay.style.display='flex';
    if (statusEvent)  statusEvent.textContent='🔴 Ditutup';
    // Tampilkan toast info + bunyikan suara selesai (sekali)
    if (!STATE._endToastShown) {
      STATE._endToastShown=true;
      showToast('🏁 Event selesai! Leaderboard final ditampilkan.');
      playSound('sfx-timeup');   // suara penanda waktu habis
    }
  } else {
    showStatusOverlay('⏳','Menunggu Dimulai','Leaderboard belum dibuka oleh admin');
    if (timerDisplay) timerDisplay.style.display='none';
    if (statusEvent)  statusEvent.textContent='Menunggu Mulai';
  }
}

/** Tampilkan overlay status (idle/ended) */
function showStatusOverlay(icon, title, msg) {
  const ov=document.getElementById('status-overlay');
  if (!ov) return;
  document.getElementById('status-icon').textContent=icon;
  document.getElementById('status-title').textContent=title;
  document.getElementById('status-msg').textContent=msg;
  ov.style.display='flex';
}

/** Animasi countdown 3-2-1-MULAI di leaderboard. Suara diputar SEKALI di awal. */
function jalankanCountdown321() {
  const ov=document.getElementById('countdown-overlay');
  const num=document.getElementById('countdown-number');
  if (!ov||!num) return;
  ov.style.display='flex';
  let n=3;
  num.textContent=n;
  num.style.animation='none'; setTimeout(()=>num.style.animation='cdPop .8s ease',10);
  playSound('sfx-countdown');   // diputar SEKALI saja (file sudah berisi 3-2-1 lengkap)
  const iv=setInterval(()=>{
    n--;
    if (n>0) {
      // angka 2 dan 1 — TANPA suara lagi (biar tidak numpuk)
      num.textContent=n;
      num.style.animation='none'; setTimeout(()=>num.style.animation='cdPop .8s ease',10);
    } else if (n===0) {
      // "MULAI!"
      num.textContent='MULAI!';
      num.style.animation='none'; setTimeout(()=>num.style.animation='cdPop .8s ease',10);
      fireConfetti();            // confetti visual saja (tanpa suara)
      playBGM();                 // BGM mulai pas GO! (hanya bunyi jika musik tidak di-mute)
    } else {
      clearInterval(iv);
      ov.style.display='none';
    }
  },1000);
}

/* ================================================================
   BAGIAN 9 — LEADERBOARD RENDER
   ================================================================ */
function initLeaderboard() {
  listenPeserta(()=>refreshLeaderboard());
  listenLog(()=>refreshLeaderboard());
  listenVotingDisplay();  // dengarkan flag tampilkan hasil voting
  updateLeaderboardTimer();
  // Unlock audio otomatis saat ada interaksi pertama (klik/sentuh) di mana saja.
  // Ini agar BGM bisa autoplay pas countdown GO! tanpa diblokir browser.
  const unlockOnce = () => {
    unlockAudio();
    document.removeEventListener('click', unlockOnce);
    document.removeEventListener('touchstart', unlockOnce);
  };
  document.addEventListener('click', unlockOnce);
  document.addEventListener('touchstart', unlockOnce);
}
function refreshLeaderboard() {
  setRefreshIndicator('loading');
  try {
    const j=hitungSkor('jawara'), p=hitungSkor('penjelajah');
    const jc=detectRankChanges(STATE.prevJawara,j), pc=detectRankChanges(STATE.prevPenjelajah,p);
    STATE.prevJawara=[...STATE.jawara]; STATE.prevPenjelajah=[...STATE.penjelajah];
    STATE.jawara=j; STATE.penjelajah=p;
    renderBoard('jawara',j,jc); renderBoard('penjelajah',p,pc);
    handleRankChanges(jc,pc); updateFooter(getAllPeserta().length);
    setRefreshIndicator('live');
  } catch(e){ console.error(e); setRefreshIndicator('error'); }
}
function renderBoard(type,data,changes) {
  const podiumEl=document.getElementById(`podium-${type}`), listEl=document.getElementById(`list-${type}`);
  if (!podiumEl||!listEl) return;
  const unit='Point';
  const top3=data.slice(0,3);
  podiumEl.innerHTML=top3.map((p,i)=>{
    const rank=i+1, av=p.foto?`<img src="${p.foto}" alt="${escHtml(p.nama)}" />`:p.nama.charAt(0).toUpperCase();
    return `<div class="podium-item rank-${rank}" title="${escHtml(p.kelas)}">
      <div class="podium-avatar">${av}</div>
      <div class="podium-name">${escHtml(p.nama)}</div>
      <div class="podium-score">${p.skor} ${unit}</div>
      <div class="podium-base">#${rank}</div></div>`;
  }).join('');
  const rest=data.slice(3), anim=type==='jawara'?'slideInLeft':'slideInRight';
  listEl.innerHTML=rest.map((p,i)=>{
    const rank=i+4, ch=changes.get(p.nama)||'same';
    const ar=ch==='up'?'▲':(ch==='down'?'▼':''), col=ch==='up'?'#4CAF50':'#F44336';
    return `<li class="rank-item ${ch!=='same'?'changed':''}" style="animation:${anim} ${0.3+i*0.07}s var(--ease-bounce) both" title="${escHtml(p.kelas)}">
      <div class="rank-change ${ch}"></div><div class="rank-num">${rank}</div>
      <div class="rank-info"><div class="rank-name">${escHtml(p.nama)}</div><div class="rank-origin">${escHtml(p.kelas)}</div></div>
      <div class="rank-score">${p.skor} ${unit} ${ar?`<span style="font-size:.6rem;color:${col}">${ar}</span>`:''}</div></li>`;
  }).join('');
  if (top3.length>0 && STATE.prevJawara.length===0 && type==='jawara' && STATE.eventStatus==='running') setTimeout(fireConfetti,800);
}

/* ================================================================
   BAGIAN 10 — RANK CHANGE
   ================================================================ */
function detectRankChanges(prev,curr) {
  const ch=new Map(); if(!prev.length)return ch;
  const pr=new Map(prev.map((p,i)=>[p.nama,i+1]));
  curr.forEach((p,i)=>{const c=i+1,o=pr.get(p.nama);
    if(o===undefined)ch.set(p.nama,'up');else if(c<o)ch.set(p.nama,'up');else if(c>o)ch.set(p.nama,'down');else ch.set(p.nama,'same');});
  return ch;
}
function handleRankChanges(jc,pc) {
  const all=[...jc.entries(),...pc.entries()];
  const ups=all.filter(([,d])=>d==='up'), downs=all.filter(([,d])=>d==='down');
  if(ups.length){playSound('sfx-rank-up');showRankToast('⬆️',`${ups[0][0]} naik posisi!`);}
  else if(downs.length){playSound('sfx-rank-down');showRankToast('⬇️',`${downs[0][0]} turun posisi`);}
}
function showRankToast(icon,msg){const t=document.getElementById('rank-toast');if(!t)return;
  document.getElementById('rank-toast-icon').textContent=icon;document.getElementById('rank-toast-msg').textContent=msg;
  t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
function setRefreshIndicator(s){const d=document.querySelector('.refresh-dot'),l=document.querySelector('.refresh-label');if(!d)return;
  const m={live:['#4CAF50','Live'],loading:['#FFC107','Sync...'],error:['#F44336','Error']};const[c,t]=m[s]||['#888','—'];d.style.background=c;if(l)l.textContent=t;}
function updateFooter(total){const u=document.getElementById('last-update'),t=document.getElementById('total-peserta');
  if(u)u.textContent=new Date().toLocaleTimeString('id-ID');if(t)t.textContent=total;}

/* ================================================================
   BAGIAN 11 — HALAMAN PESERTA
   ================================================================ */
function initPeserta() {
  maybeAutoHelp('peserta');  // tampilkan help otomatis sekali
  listenVote();              // dengarkan data vote (untuk cek status)

  listenPeserta(()=>{
    if (STATE.pesertaAktif) {
      const p=getAllPeserta().find(x=>x.id===STATE.pesertaAktif.id);
      if (p) updateProfilPoin(p.id);
    }
  });
  listenLog(()=>{ if(STATE.pesertaAktif) updateProfilPoin(STATE.pesertaAktif.id); });

  // Cek sesi login tersimpan
  const savedId = localStorage.getItem('pesertaAktifId');
  if (savedId) {
    setTimeout(()=>{
      const p=getAllPeserta().find(x=>x.id===savedId);
      if (p) tampilkanProfil(p); else showAuth();
    },800);
  } else showAuth();
}
function showAuth() {
  document.getElementById('peserta-auth-section').style.display='block';
  document.getElementById('peserta-profile-section').style.display='none';
}
function switchAuthTab(tab) {
  document.getElementById('auth-tab-login').classList.toggle('active', tab==='login');
  document.getElementById('auth-tab-daftar').classList.toggle('active', tab==='daftar');
  document.getElementById('auth-pane-login').classList.toggle('active', tab==='login');
  document.getElementById('auth-pane-daftar').classList.toggle('active', tab==='daftar');
}

/** Proses daftar */
async function daftarPeserta() {
  const nama=document.getElementById('daftar-nama')?.value.trim();
  const kelas=document.getElementById('daftar-kelas')?.value.trim();
  const username=document.getElementById('daftar-username')?.value.trim();
  const password=document.getElementById('daftar-password')?.value;
  const err=document.getElementById('daftar-peserta-error');
  if (!nama||!kelas||!username||!password){ if(err)err.textContent='❌ Semua kolom wajib diisi!'; return; }
  if(err) err.textContent='⏳ Mendaftar...';
  try {
    const r=await registerPeserta(nama,kelas,username,password);
    if (!r.ok){ if(err)err.textContent='❌ '+r.msg; return; }
    localStorage.setItem('pesertaAktifId', r.peserta.id);
    tampilkanProfil(r.peserta);
  } catch(e){ if(err)err.textContent='❌ Gagal: '+e.message; }
}

/** Proses login */
async function loginPeserta() {
  const username=document.getElementById('login-username')?.value.trim();
  const password=document.getElementById('login-password')?.value;
  const err=document.getElementById('login-peserta-error');
  if (!username||!password){ if(err)err.textContent='❌ Isi username & password!'; return; }
  if(err) err.textContent='⏳ Masuk...';
  try {
    const r=await authPeserta(username,password);
    if (!r.ok){ if(err)err.textContent='❌ '+r.msg; return; }
    localStorage.setItem('pesertaAktifId', r.peserta.id);
    tampilkanProfil(r.peserta);
  } catch(e){ if(err)err.textContent='❌ Gagal: '+e.message; }
}

function tampilkanProfil(peserta) {
  STATE.pesertaAktif=peserta;
  document.getElementById('peserta-auth-section').style.display='none';
  document.getElementById('peserta-profile-section').style.display='block';
  document.getElementById('profile-name-display').textContent=peserta.nama;
  document.getElementById('profile-kelas-display').textContent=peserta.kelas;
  document.getElementById('profile-initial').textContent=peserta.nama.charAt(0).toUpperCase();
  if (peserta.foto) {
    const img=document.getElementById('profile-photo-img');
    img.src=peserta.foto; img.style.display='block';
    document.getElementById('profile-initial').style.display='none';
  }
  const qc=document.getElementById('profile-qr-canvas');
  if (qc){ qc.innerHTML=''; new QRCode(qc,{text:peserta.id,width:170,height:170,correctLevel:QRCode.CorrectLevel.H}); }
  updateProfilPoin(peserta.id);
}
function updateProfilPoin(id) {
  const poin=getPoinPeserta(id);
  const j=document.getElementById('stat-jawara'),p=document.getElementById('stat-penjelajah');
  if(j)j.textContent=poin.jawara; if(p)p.textContent=poin.penjelajah;
}
async function handleFotoUpload(event) {
  const file=event.target.files[0]; if(!file||!STATE.pesertaAktif)return;
  showToast('⏳ Mengupload foto...');
  const reader=new FileReader();
  reader.onload=(e)=>{const img=new Image();img.onload=async()=>{
    const size=Math.min(img.width,img.height),canvas=document.createElement('canvas');
    canvas.width=canvas.height=300;const ctx=canvas.getContext('2d');
    ctx.drawImage(img,(img.width-size)/2,(img.height-size)/2,size,size,0,0,300,300);
    canvas.toBlob(async(blob)=>{try{
      const url=await updateFotoPeserta(STATE.pesertaAktif.id,blob);
      STATE.pesertaAktif.foto=url;
      const ie=document.getElementById('profile-photo-img');ie.src=url;ie.style.display='block';
      document.getElementById('profile-initial').style.display='none';
      showToast('✅ Foto diperbarui!');
    }catch(err){showToast('❌ Gagal: '+err.message);}},'image/jpeg',0.85);
  };img.src=e.target.result;};
  reader.readAsDataURL(file);
}
function logoutPeserta() {
  if (!confirm('Keluar dari akun ini?')) return;
  localStorage.removeItem('pesertaAktifId'); STATE.pesertaAktif=null; location.reload();
}

/* ================================================================
   BAGIAN 11B — VOTING LOMBA FAVORIT
   Collection "vote": { pesertaId, lomba, waktu }
   - Peserta hanya bisa vote lomba yang DIA IKUTI (ada di log penjelajah)
   - Hanya 1 vote per peserta
   - Hanya bisa vote SETELAH event berakhir (status 'ended')
   ================================================================ */

/**
 * Tampilkan modal voting untuk peserta.
 * Hanya menampilkan lomba yang peserta ikuti (mode penjelajah).
 */
async function showVoting() {
  const overlay = document.getElementById('vote-overlay');
  const body    = document.getElementById('vote-body');
  if (!overlay || !body) return;

  // Harus sudah login
  if (!STATE.pesertaAktif) {
    showToast('⚠️ Login dulu untuk bisa vote');
    return;
  }

  // Voting hanya setelah event berakhir
  if (STATE.eventStatus !== 'ended') {
    body.innerHTML = `<p class="vote-info">⏳ Voting dibuka setelah event selesai.<br>Tunggu sampai waktu habis ya!</p>`;
    overlay.style.display='flex';
    return;
  }

  body.innerHTML = `<p class="vote-info">⏳ Memuat lomba yang kamu ikuti...</p>`;
  overlay.style.display='flex';

  const pid = STATE.pesertaAktif.id;

  // Cek apakah sudah pernah vote
  const sudahVote = await db.collection('vote').where('pesertaId','==',pid).get();
  if (!sudahVote.empty) {
    const v = sudahVote.docs[0].data();
    body.innerHTML = `<p class="vote-info">✅ Kamu sudah vote!<br>Pilihan kamu: <strong>${escHtml(v.lomba)}</strong><br><span style="font-size:.75rem;color:var(--cream-dark)">Terima kasih sudah berpartisipasi 🎉</span></p>`;
    return;
  }

  // Ambil lomba yang peserta ikuti (dari log mode penjelajah)
  const lombaDiikuti = [...new Set(
    getAllLog().filter(l => l.pesertaId===pid && l.mode==='penjelajah').map(l => l.lomba)
  )];

  if (!lombaDiikuti.length) {
    body.innerHTML = `<p class="vote-info">😅 Kamu belum tercatat mengikuti lomba apapun, jadi belum bisa vote.</p>`;
    return;
  }

  // Tampilkan tombol lomba yang diikuti + yang tidak diikuti (disabled)
  const semuaLomba = CONFIG.daftarLomba;
  body.innerHTML = `
    <p class="vote-info">Pilih <strong>1 lomba favorit</strong> kamu (hanya lomba yang kamu ikuti yang bisa dipilih):</p>
    <div class="vote-grid">
      ${semuaLomba.map(lomba => {
        const ikut = lombaDiikuti.includes(lomba);
        return `<button class="vote-opt ${ikut?'':'locked'}"
                  ${ikut?`onclick="kirimVote('${escHtml(lomba)}')"`:'disabled'}>
                  ${ikut?'🎮':'🔒'} ${escHtml(lomba)}
                </button>`;
      }).join('')}
    </div>`;
}

/** Kirim vote peserta */
async function kirimVote(lomba) {
  if (!STATE.pesertaAktif) return;
  const pid = STATE.pesertaAktif.id;
  if (!confirm(`Vote "${lomba}" sebagai lomba favorit? Vote tidak bisa diubah.`)) return;

  // Cek ulang belum vote (jaga-jaga)
  const cek = await db.collection('vote').where('pesertaId','==',pid).get();
  if (!cek.empty) { showToast('Kamu sudah vote sebelumnya'); return; }

  await db.collection('vote').add({
    pesertaId: pid, lomba,
    waktu: firebase.firestore.FieldValue.serverTimestamp(),
  });
  document.getElementById('vote-body').innerHTML =
    `<p class="vote-info">✅ Vote berhasil!<br>Kamu memilih: <strong>${escHtml(lomba)}</strong><br><span style="font-size:.75rem;color:var(--cream-dark)">Terima kasih 🎉</span></p>`;
  showToast('🗳️ Vote kamu tercatat!');
}

function closeVoting(event) {
  if (event && event.target.id!=='vote-overlay') return;
  document.getElementById('vote-overlay').style.display='none';
}

/* ── ADMIN & LEADERBOARD: hasil voting ── */

/** Listen voting realtime (dipakai admin & leaderboard) */
function listenVote(cb) {
  if (STATE.unsubVote) STATE.unsubVote();
  STATE.unsubVote = db.collection('vote').onSnapshot(snap => {
    STATE.cacheVote = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (cb) cb();
  }, err=>console.error('[FS vote]',err));
}

/** Hitung lomba dengan vote terbanyak. @returns {{lomba, count}|null} */
function hitungVoteTerbanyak() {
  const votes = STATE.cacheVote || [];
  if (!votes.length) return null;
  const map = {};
  votes.forEach(v => map[v.lomba] = (map[v.lomba]||0)+1);
  let best=null, bestCount=0;
  for (const [lomba,count] of Object.entries(map)) {
    if (count>bestCount) { best=lomba; bestCount=count; }
  }
  return { lomba:best, count:bestCount };
}

/** ADMIN: tampilkan hasil voting di leaderboard (set flag di Firestore) */
async function showVotingResult() {
  const hasil = hitungVoteTerbanyak();
  if (!hasil) { showToast('⚠️ Belum ada voting masuk'); return; }
  await db.collection('event').doc('voting').set({
    show:true, lomba:hasil.lomba, count:hasil.count, updatedAt:Date.now(),
  });
  showToast(`📊 Menampilkan: ${hasil.lomba} (${hasil.count} suara)`);
}

/** ADMIN: sembunyikan hasil voting */
async function hideVotingResult() {
  await db.collection('event').doc('voting').set({ show:false }, { merge:true });
  showToast('🙈 Hasil voting disembunyikan');
}

/** ADMIN: reset semua voting */
async function resetVoting() {
  if (!confirm('⚠️ Hapus semua data voting?')) return;
  await deleteCollection('vote');
  await db.collection('event').doc('voting').set({ show:false }, { merge:true });
  showToast('🗑️ Voting direset');
}

/** Listen flag tampilkan hasil voting (untuk leaderboard) */
function listenVotingDisplay() {
  if (STATE.unsubVoteDisplay) STATE.unsubVoteDisplay();
  STATE.unsubVoteDisplay = db.collection('event').doc('voting').onSnapshot(doc => {
    const ov = document.getElementById('vote-result-overlay');
    if (!ov) return;
    if (doc.exists && doc.data().show) {
      const d = doc.data();
      document.getElementById('vote-result-name').textContent  = d.lomba || '—';
      document.getElementById('vote-result-count').textContent = `${d.count||0} suara`;
      ov.style.display='flex';
      fireConfetti();
    } else {
      ov.style.display='none';
    }
  }, err=>console.error('[FS voteDisplay]',err));
}

/** Update preview hasil voting di admin */
function updateVoteAdminPreview() {
  const el = document.getElementById('vote-admin-preview');
  if (!el) return;
  const hasil = hitungVoteTerbanyak();
  const total = (STATE.cacheVote||[]).length;
  if (!hasil) { el.textContent='Belum ada data voting.'; return; }
  el.innerHTML = `Total suara masuk: <strong>${total}</strong><br>Terbanyak: <strong style="color:var(--gold)">${escHtml(hasil.lomba)}</strong> (${hasil.count} suara)`;
}

/**
 * Helper: ubah array of array jadi string CSV & trigger download.
 * @param {Array<Array>} rows - baris pertama = header
 * @param {string} filename
 */
function downloadCSV(rows, filename) {
  // Escape tiap sel: bungkus tanda kutip & ganti " jadi ""
  const csv = rows.map(r =>
    r.map(cell => `"${String(cell ?? '').replace(/"/g,'""')}"`).join(',')
  ).join('\r\n');
  // Tambah BOM agar Excel baca UTF-8 (emoji & karakter Indonesia aman)
  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/**
 * Export DETAIL voting: tiap baris = 1 vote (nama, kelas, username, lomba, waktu).
 * Data peserta diambil dari cache agar nama/kelas ikut.
 */
function exportVoteCSV() {
  const votes = STATE.cacheVote || [];
  if (!votes.length) { showToast('⚠️ Belum ada data voting'); return; }

  const peserta = getAllPeserta();
  const rows = [['Nama','Kelas','Username','Lomba Favorit','Waktu Vote']];
  votes
    .sort((a,b)=>toMillis(a.waktu)-toMillis(b.waktu))
    .forEach(v => {
      const p = peserta.find(x => x.id === v.pesertaId) || {};
      rows.push([
        p.nama || '(terhapus)',
        p.kelas || '-',
        p.username || '-',
        v.lomba,
        formatWaktu(v.waktu),
      ]);
    });

  const tgl = new Date().toISOString().slice(0,10);
  downloadCSV(rows, `voting-detail-${tgl}.csv`);
  showToast('📥 Detail voting diunduh');
}

/**
 * Export REKAP voting: jumlah suara per lomba (urut terbanyak).
 */
function exportVoteRekapCSV() {
  const votes = STATE.cacheVote || [];
  if (!votes.length) { showToast('⚠️ Belum ada data voting'); return; }

  const map = {};
  votes.forEach(v => map[v.lomba] = (map[v.lomba]||0)+1);

  const rows = [['Peringkat','Lomba','Jumlah Suara']];
  Object.entries(map)
    .sort((a,b)=>b[1]-a[1])
    .forEach(([lomba,count],i) => rows.push([i+1, lomba, count]));

  const tgl = new Date().toISOString().slice(0,10);
  downloadCSV(rows, `voting-rekap-${tgl}.csv`);
  showToast('📥 Rekap voting diunduh');
}

/* ================================================================
   BAGIAN 12 — HALAMAN PANITIA
   ================================================================ */
function initPanitia() {
  maybeAutoHelp('panitia');
  listenPeserta(); listenLog();
  renderLombaGrid();
  updatePanitiaStatus();
}

/** Update banner status event di panitia + enable/disable */
function updatePanitiaStatus() {
  const banner=document.getElementById('panitia-status-banner');
  const text=document.getElementById('panitia-status-text');
  if (!banner) return;
  if (STATE.eventStatus==='running') {
    banner.className='panitia-status-banner running';
    text.textContent=`🟢 Event berlangsung · Sisa ${sisaWaktuStr()}`;
  } else if (STATE.eventStatus==='ended') {
    banner.className='panitia-status-banner ended';
    text.textContent='🔴 Event selesai · Scan dinonaktifkan';
  } else {
    banner.className='panitia-status-banner idle';
    text.textContent='⏳ Menunggu event dimulai admin...';
  }
}

function renderLombaGrid() {
  const g=document.getElementById('lomba-grid'); if(!g)return;
  g.innerHTML=CONFIG.daftarLomba.map((l,i)=>`<button class="lomba-btn" onclick="pilihLomba('${escHtml(l)}',this)">
    <div style="font-size:1.3rem;margin-bottom:.3rem">${getLombaEmoji(i)}</div>${escHtml(l)}</button>`).join('');
}
function getLombaEmoji(i){return['🎯','🏃','🎨','🎭','🎵','🏆','⚡','🌟','🎪','🎲','🌺','🎋'][i%12];}

function pilihLomba(l,btn) {
  // Cegah pilih lomba kalau event belum mulai
  if (STATE.eventStatus!=='running') { showToast('⚠️ Event belum dimulai / sudah ditutup'); return; }
  STATE.lombaAktif=l;
  document.querySelectorAll('.lomba-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('step-pilih-lomba').style.display='none';
  document.getElementById('step-pilih-mode').style.display='block';
  document.getElementById('lomba-terpilih-label').textContent=l;
}
function mulaiScan(mode) {
  STATE.modeAktif=mode;
  document.getElementById('step-pilih-mode').style.display='none';
  document.getElementById('step-scanner').style.display='block';
  document.getElementById('scan-lomba-label').textContent=STATE.lombaAktif;
  document.getElementById('scan-mode-label').textContent=mode==='jawara'?'👑 Jawara':'🗺️ Penjelajah';
  document.getElementById('scan-result').style.display='none';
  STATE.qrScanner=new Html5Qrcode('qr-reader');
  STATE.qrScanner.start({facingMode:'environment'},{fps:10,qrbox:{width:220,height:220}},
    (t)=>onQRScan(t),()=>{}).catch(err=>showToast('⚠️ Kamera: '+err));
}
async function onQRScan(pesertaId) {
  if (STATE.qrScanner) STATE.qrScanner.pause();
  const r=document.getElementById('scan-result');
  r.style.display='block';r.className='scan-result';
  document.getElementById('scan-result-icon').textContent='⏳';
  document.getElementById('scan-result-name').textContent='Memproses...';
  document.getElementById('scan-result-msg').textContent='';
  try {
    const status=await tambahScore(pesertaId,STATE.lombaAktif,STATE.modeAktif);
    const peserta=getAllPeserta().find(p=>p.id===pesertaId);
    if (status==='ok') {
      r.classList.add('ok');
      document.getElementById('scan-result-icon').textContent='✅';
      document.getElementById('scan-result-name').textContent=peserta?.nama||pesertaId;
      document.getElementById('scan-result-msg').textContent=`+1 ${STATE.modeAktif==='jawara'?'Jawara':'Penjelajah'}!`;
      playSound('sfx-scan-ok');
      STATE.scanLog.unshift({nama:peserta?.nama,status:'OK',waktu:new Date().toLocaleTimeString('id-ID')});renderScanLog();
    } else if (status==='duplikat') {
      r.classList.add('err');document.getElementById('scan-result-icon').textContent='⚠️';
      document.getElementById('scan-result-name').textContent=peserta?.nama||'—';
      document.getElementById('scan-result-msg').textContent='Sudah di-scan di lomba ini!';playSound('sfx-scan-err');
    } else if (status==='event_tutup') {
      r.classList.add('err');document.getElementById('scan-result-icon').textContent='🔒';
      document.getElementById('scan-result-name').textContent='—';
      document.getElementById('scan-result-msg').textContent='Event belum mulai / sudah ditutup!';playSound('sfx-scan-err');
    } else {
      r.classList.add('err');document.getElementById('scan-result-icon').textContent='❌';
      document.getElementById('scan-result-name').textContent='—';
      document.getElementById('scan-result-msg').textContent='QR tidak dikenali';playSound('sfx-scan-err');
    }
  } catch(e){ r.classList.add('err');document.getElementById('scan-result-msg').textContent='Error: '+e.message; }
  setTimeout(()=>{if(STATE.qrScanner)STATE.qrScanner.resume();},2500);
}
function renderScanLog() {
  const ul=document.getElementById('scan-log-list');if(!ul)return;
  ul.innerHTML=STATE.scanLog.slice(0,15).map(l=>`<li><span>${escHtml(l.nama||'—')}</span>
    <span style="color:${l.status==='OK'?'#4CAF50':'#F44336'}">${l.status} · ${l.waktu}</span></li>`).join('');
}
function stopScan(){if(STATE.qrScanner){STATE.qrScanner.stop().catch(()=>{});STATE.qrScanner=null;}resetPanitia();}
function resetPanitia(){STATE.lombaAktif=null;STATE.modeAktif=null;
  document.getElementById('step-pilih-lomba').style.display='block';
  document.getElementById('step-pilih-mode').style.display='none';
  document.getElementById('step-scanner').style.display='none';
  document.querySelectorAll('.lomba-btn').forEach(b=>b.classList.remove('selected'));}

/* ================================================================
   BAGIAN 13 — ADMIN PANEL
   ================================================================ */
function switchAdminTab(tabId) {
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  document.querySelectorAll('.admin-tab').forEach(b=>{if(b.getAttribute('onclick')?.includes(tabId))b.classList.add('active');});
}
function renderPesertaTable() {
  const tb=document.getElementById('tbody-peserta'),c=document.getElementById('total-count');if(!tb)return;
  const q=document.getElementById('search-peserta')?.value.toLowerCase()||'';
  const ps=getAllPeserta().filter(p=>p.nama.toLowerCase().includes(q)||p.kelas.toLowerCase().includes(q)||(p.username||'').toLowerCase().includes(q));
  if(c)c.textContent=getAllPeserta().length;
  if(!ps.length){tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--cream-dark);padding:1.5rem">Belum ada peserta</td></tr>';return;}
  tb.innerHTML=ps.map(p=>{const poin=getPoinPeserta(p.id);
    const av=p.foto?`<div class="tbl-avatar"><img src="${p.foto}"/></div>`:`<div class="tbl-avatar">${p.nama.charAt(0).toUpperCase()}</div>`;
    return `<tr><td>${av}</td><td>${escHtml(p.nama)}</td><td>${escHtml(p.kelas)}</td>
      <td style="font-size:.72rem">${escHtml(p.username||'—')}</td>
      <td><span class="pw-cell">${escHtml(p.password||'—')}</span>
        <button class="tbl-mini-btn" onclick="ubahPasswordPeserta('${p.id}','${escHtml(p.nama)}')" title="Ubah password">✏️</button></td>
      <td style="color:var(--gold)">${poin.jawara}</td><td style="color:#A8E6CF">${poin.penjelajah}</td>
      <td><button class="tbl-del-btn" onclick="hapusPeserta('${p.id}')" title="Hapus">🗑️</button></td></tr>`;
  }).join('');
}
function renderLogTable() {
  const tb=document.getElementById('tbody-log');if(!tb)return;
  const fl=document.getElementById('filter-lomba')?.value||'',fm=document.getElementById('filter-mode')?.value||'';
  let log=getAllLog();if(fl)log=log.filter(l=>l.lomba===fl);if(fm)log=log.filter(l=>l.mode===fm);
  log=log.sort((a,b)=>toMillis(b.waktu)-toMillis(a.waktu));
  if(!log.length){tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--cream-dark);padding:1.5rem">Belum ada data</td></tr>';return;}
  tb.innerHTML=log.map(l=>`<tr><td style="font-size:.7rem">${formatWaktu(l.waktu)}</td>
    <td>${escHtml(l.nama)}</td><td>${escHtml(l.kelas)}</td><td>${escHtml(l.lomba)}</td>
    <td><span style="color:${l.mode==='jawara'?'var(--gold)':'#A8E6CF'}">${l.mode==='jawara'?'👑':'🗺️'}</span></td>
    <td><button class="tbl-del-btn" onclick="hapusLog('${l.id}')">🗑️</button></td></tr>`).join('');
}
function toMillis(w){if(!w)return 0;if(w.toMillis)return w.toMillis();return new Date(w).getTime();}
function formatWaktu(w){if(!w)return'—';const d=w.toDate?w.toDate():new Date(w);return d.toLocaleString('id-ID');}
function populateLombaFilter(){const s=document.getElementById('filter-lomba');if(!s)return;
  s.innerHTML='<option value="">Semua Lomba</option>';CONFIG.daftarLomba.forEach(l=>{const o=document.createElement('option');o.value=o.textContent=l;s.appendChild(o);});}
function generateAdminQR(){const c=document.getElementById('admin-qr-pendaftaran'),u=document.getElementById('admin-qr-url');if(!c)return;
  const url=`${location.origin}${location.pathname}?page=peserta`;if(u)u.textContent=url;
  c.innerHTML='';new QRCode(c,{text:url,width:220,height:220,correctLevel:QRCode.CorrectLevel.H});}
function printQR(){const box=document.getElementById('admin-qr-pendaftaran');if(!box)return;
  const cv=box.querySelector('canvas'),im=box.querySelector('img');const src=cv?cv.toDataURL():(im?im.src:'');if(!src)return;
  const w=window.open('');w.document.write(`<html><body style="text-align:center;padding:2rem;font-family:sans-serif">
    <h2>QR Pendaftaran</h2><p>${CONFIG.eventTitle}</p><img src="${src}" style="width:300px"/>
    <p style="margin-top:1rem;font-size:.8rem">Scan untuk mendaftar</p>
    <script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`);}

/* ================================================================
   BAGIAN 14 — AUDIO & EFEK
   ================================================================ */
function playSound(id){try{const e=document.getElementById(id);if(!e)return;e.currentTime=0;e.volume=.5;e.play().catch(()=>{});}catch(e){}}
/**
 * Toggle mute/unmute musik.
 * Saat dinyalakan, kalau event belum mulai → BGM disiapkan (unlock) tapi
 * baru benar-benar bunyi pas countdown GO!. Kalau event sedang jalan → langsung bunyi.
 */
function toggleMusic(){
  const b=document.getElementById('bgm-loop'),btn=document.getElementById('btn-music');
  if(!b)return;
  if(STATE.musicOn){
    // Matikan
    b.pause(); STATE.musicOn=false; if(btn)btn.textContent='🔇';
  } else {
    // Nyalakan
    STATE.musicOn=true; if(btn)btn.textContent='🎵';
    // Unlock audio: putar sebentar lalu pause (trik agar browser izinkan autoplay nanti)
    unlockAudio();
    // Kalau event sedang berjalan, langsung putar. Kalau belum, tunggu countdown GO!
    if (STATE.eventStatus==='running') playBGM();
  }
}

/**
 * "Unlock" + "hangatkan" semua audio saat ada interaksi user.
 * Memutar tiap audio sebentar (volume 0) lalu pause → browser memuat
 * file ke memori, sehingga saat dibutuhkan (countdown) langsung bunyi tanpa delay.
 */
function unlockAudio(){
  if (STATE._audioUnlocked) return;
  STATE._audioUnlocked = true;

  // Hangatkan semua elemen audio sekaligus
  const ids = ['bgm-loop','sfx-countdown','sfx-confetti','sfx-rank-up','sfx-rank-down','sfx-scan-ok','sfx-scan-err','sfx-timeup'];
  ids.forEach(id => {
    const a = document.getElementById(id);
    if (!a) return;
    const volAsli = (id==='bgm-loop') ? 0.15 : 0.5;
    a.volume = 0;
    a.play().then(() => {
      a.pause(); a.currentTime = 0; a.volume = volAsli;
    }).catch(()=>{});
  });
}

/** Mulai putar BGM (hanya jika musik dalam keadaan ON / tidak di-mute) */
function playBGM(){
  const b=document.getElementById('bgm-loop');
  if(!b) return;
  if(!STATE.musicOn) return;   // kalau di-mute, jangan bunyi
  b.volume=0.15;
  b.play().catch(()=>{
    console.info('[BGM] Autoplay diblokir. Klik tombol musik 🎵 dulu untuk mengaktifkan.');
  });
}
function fireConfetti(){if(typeof confetti==='undefined')return;
  confetti({particleCount:120,spread:80,origin:{y:.6},colors:['#F5C842','#FFE68A','#9B1B30','#1A6B4A','#FDF3DC'],scalar:1.2});
  setTimeout(()=>{confetti({particleCount:60,angle:60,spread:55,origin:{x:0},colors:['#F5C842','#9B1B30']});
  confetti({particleCount:60,angle:120,spread:55,origin:{x:1},colors:['#1A6B4A','#FFE68A']});},600);playSound('sfx-confetti');}

/**
 * Partikel background — sekarang pakai logo Penabur (logo-penabur.png).
 * Kalau file logo tidak ada, otomatis fallback ke emoji bintang.
 */
function spawnParticles(){
  const c=document.getElementById('particles');if(!c)return;
  for(let i=0;i<14;i++){
    const el=document.createElement('div');el.className='particle particle-logo';
    // Pakai <img> logo penabur; jika gagal load → ganti jadi emoji
    const img=document.createElement('img');
    img.src='logo-penabur.png';
    img.style.cssText='width:100%;height:100%;object-fit:contain;opacity:.5';
    img.onerror=()=>{ el.textContent='✨'; el.removeChild(img); };
    el.appendChild(img);
    const sz=18+Math.random()*22;
    el.style.left=`${Math.random()*100}%`;
    el.style.width=`${sz}px`;el.style.height=`${sz}px`;
    el.style.animationDuration=`${14+Math.random()*16}s`;
    el.style.animationDelay=`${Math.random()*20}s`;
    c.appendChild(el);
  }
}

/* ================================================================
   BAGIAN 15 — UTILITAS
   ================================================================ */
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showToast(msg){let t=document.getElementById('global-toast');
  if(!t){t=document.createElement('div');t.id='global-toast';
    t.style.cssText='position:fixed;bottom:2rem;left:50%;transform:translateX(-50%) translateY(20px);z-index:9999;background:linear-gradient(135deg,#2A1000,#4A2000);border:1.5px solid var(--gold-dark);border-radius:10px;padding:.7rem 1.3rem;color:var(--gold-light);font-family:var(--font-ui);font-size:.82rem;box-shadow:0 8px 30px rgba(0,0,0,.7);opacity:0;transition:all .3s ease;pointer-events:none;text-align:center;max-width:90vw';
    document.body.appendChild(t);}
  t.textContent=msg;t.style.opacity='1';t.style.transform='translateX(-50%) translateY(0)';
  setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(-50%) translateY(20px)';},3000);}
async function deleteCollection(name){const snap=await db.collection(name).get();const b=db.batch();snap.forEach(d=>b.delete(d.ref));await b.commit();}

/* ================================================================
   BAGIAN 16 — MODAL BANTUAN (auto-show sekali per device)
   ================================================================ */
const HELP_CONTENT = {
  peserta:{icon:'🎭',title:'Panduan Peserta',steps:[
    '<strong>Daftar</strong> dengan nickname (diakhiri "Fam"), kelas, username (diawali "peserta"), dan password.',
    '<strong>Login</strong> pakai username & password kamu (bisa dari HP mana saja).',
    '<strong>Upload foto</strong> dengan mengetuk lingkaran foto. Tampil di leaderboard kalau Top 3.',
    '<strong>Tunjukkan QR Code</strong> ke panitia setiap selesai ikut/menang lomba.',
  ],note:'💡 Nickname diakhiri "Fam", username diawali "peserta". Simpan password baik-baik ya!'},
  panitia:{icon:'⚡',title:'Panduan Panitia',steps:[
    'Pastikan <strong>event sudah dimulai admin</strong> (banner hijau di atas).',
    '<strong>Pilih lomba</strong> yang sedang berlangsung.',
    '<strong>Pilih mode:</strong> Jawara (menang) atau Penjelajah (ikut).',
    '<strong>Scan QR</strong> peserta. Poin otomatis +1. Sudah pernah = ditolak otomatis.',
  ],note:'💡 Scan hanya bisa selama event berjalan. Kalau timer habis, scan otomatis nonaktif.'},
};
function showHelp(page){const d=HELP_CONTENT[page];if(!d)return;
  document.getElementById('help-icon').textContent=d.icon;
  document.getElementById('help-title').textContent=d.title;
  document.getElementById('help-content').innerHTML=`<ol>${d.steps.map(s=>`<li>${s}</li>`).join('')}</ol>${d.note?`<div class="help-note">${d.note}</div>`:''}`;
  document.getElementById('help-overlay').style.display='flex';}
function closeHelp(event){if(event&&event.target.id!=='help-overlay')return;document.getElementById('help-overlay').style.display='none';}

/**
 * Tampilkan help otomatis SETIAP kali halaman dibuka.
 * @param {'peserta'|'panitia'} page
 */
function maybeAutoHelp(page) {
  // Delay sebentar agar halaman ter-render dulu, lalu tampilkan help
  setTimeout(() => showHelp(page), 500);
}
