const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const { execSync } = require('child_process');

// ─────────────────────────────────────────────
//  KONFIGURASI
// ─────────────────────────────────────────────
const ADMIN_ID  = '174500427595779@lid'; // ID Owner (backup mutlak)
const DB_PATH   = '/data/database.json';
const NOMOR_BOT = '6285875121429';       // Nomor WA bot (tanpa + atau 0 di depan)

// ─────────────────────────────────────────────
//  KONFIGURASI SAMBUTAN
//  Ganti teks dan path gambar sesuai kebutuhan
// ─────────────────────────────────────────────
const SAMBUTAN = {
    teks: `🎉 Selamat datang di Echin Store*, @{{nama}}!

` +
          `Kami jual berbagai produk digital terpercaya.
` +
          `Ketik *menu* untuk melihat daftar produk kami.

` +
          `_Semoga betah dan happy shopping!_ 🛍️`,
    gambarPath: './welcome.jpg', // Letakkan file gambar di folder yang sama dengan index.js
                                 // Kosongkan ('') jika tidak pakai gambar
};

// ─────────────────────────────────────────────
//  DATABASE
//  Struktur produk:
//  {
//    nama: {
//      teks: "isi teks",
//      gambar: "base64string" | null
//    }
//  }
// ─────────────────────────────────────────────
let db = { produk: {}, orders: {}, orderCounter: 1, adminList: [] };
let customList;

function muatData() {
    try {

        // kalau file belum ada buat otomatis
        if (!fs.existsSync(DB_PATH)) {
            console.log('📂 database.json belum ada, membuat baru...');
            db = {
                produk: {},
                orders: {},
                orderCounter: 1,
                adminList: []
            };
            simpanData();
            customList = db.produk;
            return;
        }

        // baca file
        let rawText = fs.readFileSync(DB_PATH, 'utf8').trim();

        // kalau kosong
        if (!rawText) {
            console.log('⚠️ database kosong, reset otomatis...');
            db = {
                produk: {},
                orders: {},
                orderCounter: 1,
                adminList: []
            };
            simpanData();
            customList = db.produk;
            return;
        }

        // hapus BOM / karakter aneh
        rawText = rawText.replace(/^\uFEFF/, '');

        let raw = JSON.parse(rawText);

        // default struktur
        if (!raw || typeof raw !== 'object') {
            raw = {};
        }

        // kalau format lama:
        // { netflix:"...", canva:"..." }
        if (!raw.produk) {
            console.log('🔄 Deteksi database format lama, migrasi...');

            const produkBaru = {};

            for (const [k,v] of Object.entries(raw)) {

                // skip field order lama kalau ada
                if (
                    k === 'orders' ||
                    k === 'orderCounter'
                ) continue;

                if (typeof v === 'string') {
                    produkBaru[k.toLowerCase()] = {
                        teks: v,
                        gambar: null
                    };
                }

                else if (typeof v === 'object' && v) {
                    produkBaru[k.toLowerCase()] = {
                        teks: v.teks || '',
                        gambar: v.gambar || null
                    };
                }
            }

            db = {
                produk: produkBaru,
                orders: raw.orders || {},
                orderCounter: raw.orderCounter || 1,
                adminList: raw.adminList || []
            };
        }

        // format baru
        else {

            const produkFix = {};

            for (const [k,v] of Object.entries(raw.produk || {})) {

                if (typeof v === 'string') {
                    produkFix[k.toLowerCase()] = {
                        teks: v,
                        gambar: null
                    };
                }

                else {
                    produkFix[k.toLowerCase()] = {
                        teks: v?.teks || '',
                        gambar: v?.gambar || null
                    };
                }
            }

            db = {
                produk: produkFix,
                orders: raw.orders || {},
                orderCounter: raw.orderCounter || 1,
                adminList: raw.adminList || []
            };
        }

        // sinkronkan alias
        customList = db.produk;

        // auto repair simpan ulang biar rapih
        simpanData();

        console.log('✅ Database loaded');
        console.log('📦 Produk:', Object.keys(customList).length);
        console.log(
            '📝 List:',
            Object.keys(customList).join(', ')
        );

    }

    catch(e){

        console.error(
            '❌ Gagal membaca database:',
            e.message
        );

        // fallback biar bot gak crash
        db = {
            produk:{},
            orders:{},
            orderCounter:1,
            adminList:[]
        };

        customList = db.produk;
    }
}

function simpanData() {
    try {
        const tmp = DB_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
        fs.renameSync(tmp, DB_PATH);
    } catch (e) {
        console.error('⚠️  Gagal menyimpan database:', e.message);
    }
}

muatData();

// ─────────────────────────────────────────────
//  HELPER – generate ID order
// ─────────────────────────────────────────────
function buatIdOrder() {
    const nomor = String(db.orderCounter).padStart(3, '0');
    const id    = `ES${nomor}`;
    db.orderCounter++;
    simpanData();
    return id;
}

// ─────────────────────────────────────────────
//  HELPER – format tanggal & waktu (WIB)
// ─────────────────────────────────────────────
function formatWaktu(date = new Date()) {
    return date.toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}
function formatTanggal(date = new Date()) {
    return date.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit', month: 'long', year: 'numeric',
    });
}

// ─────────────────────────────────────────────
//  HAPUS SESI & LOCK FILE (sebelum start)
// ─────────────────────────────────────────────
try {
    // JANGAN hapus session biar pairing sekali saja
    execSync(
      'find /data -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" -o -name "lockfile" | xargs rm -f 2>/dev/null'
    );

    console.log('🧹 Lock file dibersihkan.');
} catch (_) {}
// ─────────────────────────────────────────────
//  CLIENT
// ─────────────────────────────────────────────
const client = new Client({

    authStrategy: new LocalAuth({
        dataPath:'/data'
    }),

    webVersionCache:{
        type:'remote',
        remotePath:
'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },

    puppeteer:{
        executablePath:
            process.env.PUPPETEER_EXECUTABLE_PATH || undefined,

        args:[
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    }
});
// ─────────────────────────────────────────────
//  QR CODE
// ─────────────────────────────────────────────
let pairingShown = false;

client.on('qr', async ()=>{

    if(pairingShown) return;
    pairingShown = true;

    try{

        console.log('🔗 Generating Pairing Code...');

        const code = await client.requestPairingCode(
            NOMOR_BOT,
            true
        );

        console.log('\n======================');
        console.log('PAIRING CODE:');
        console.log(code);
        console.log('======================\n');

        console.log(
'WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon'
        );

    }catch(err){

        console.error(
'❌ Pairing gagal:',
err.message
        );
    }

});

client.on('ready',        ()       => console.log('✅ Bot Echin Store Aktif!'));
client.on('auth_failure', (msg)    => console.error('❌ Auth gagal:', msg));
client.on('disconnected', async (reason)=>{

    console.warn('⚠️ Bot terputus:',reason);

    // Tunggu sebentar sebelum reconnect
    await new Promise(resolve => setTimeout(resolve, 5000));

    try{
        console.log('♻️ reconnect...');
        // destroy dulu baru initialize ulang agar tidak conflict
        await client.destroy().catch(()=>{});
        await client.initialize();
    }catch(e){
        console.error(
'Reconnect gagal:',
e.message
        );
    }

});

// ─────────────────────────────────────────────
//  EVENT – member baru masuk grup
// ─────────────────────────────────────────────
client.on('group_join', async (notif) => {
    try {
        const chat    = await notif.getChat();
        const contact = await notif.getContact();

        const namaMember = contact.pushname || contact.name || contact.number || 'Member Baru';
        const mention    = [contact.id];
        const teks       = SAMBUTAN.teks.replace('{{nama}}', namaMember);

        // Kirim dengan gambar jika tersedia
        if (SAMBUTAN.gambarPath && fs.existsSync(SAMBUTAN.gambarPath)) {
            const media = MessageMedia.fromFilePath(SAMBUTAN.gambarPath);
            await chat.sendMessage(media, { caption: teks, mentions: mention });
        } else {
            await chat.sendMessage(teks, { mentions: mention });
        }
    } catch (e) {
        console.error('⚠️  Gagal kirim sambutan:', e.message);
    }
});

// ─────────────────────────────────────────────
//  HELPER – cek admin
// ─────────────────────────────────────────────
async function cekAdmin(msg, chat) {
    const authorId = msg.author ?? msg.from;
    // Owner mutlak
    if (authorId === ADMIN_ID) return true;
    // Admin yang didaftarkan via perintah "admin: @tag"
    if (db.adminList && db.adminList.includes(authorId)) return true;
    // Admin grup WhatsApp
    if (chat.isGroup) {
        const user = chat.participants.find(p => p.id._serialized === authorId);
        return !!(user && (user.isAdmin || user.isSuperAdmin));
    }
    return false;
}

// ─────────────────────────────────────────────
//  HELPER – balas teks
// ─────────────────────────────────────────────
async function balas(msg, teks) {
    try { await msg.reply(teks); }
    catch (e) { console.error('⚠️  Gagal membalas:', e.message); }
}

// ─────────────────────────────────────────────
//  HELPER – kirim produk (teks + gambar jika ada)
// ─────────────────────────────────────────────
async function balasProduk(msg, produk) {
    try {
        if (produk.gambar) {
            const media = new MessageMedia('image/jpeg', produk.gambar, 'produk.jpg');
            await msg.reply(media, undefined, { caption: produk.teks });
        } else {
            await msg.reply(produk.teks);
        }
    } catch (e) {
        console.error('⚠️  Gagal kirim produk:', e.message);
        // Fallback ke teks saja
        try { await msg.reply(produk.teks); } catch (_) {}
    }
}

// ─────────────────────────────────────────────
//  HELPER – kirim DM ke pembeli
// ─────────────────────────────────────────────
async function kirimDM(pembeliId, teks) {
    try { await client.sendMessage(pembeliId, teks); }
    catch (e) { console.error('⚠️  Gagal DM:', e.message); }
}

// ─────────────────────────────────────────────
//  HELPER – hitung jarak Levenshtein (untuk fuzzy match)
// ─────────────────────────────────────────────
function hitungJarak(a, b) {
    const m = a.length, n = b.length;
    // Jika panjang beda terlalu jauh, langsung skip
    if (Math.abs(m - n) > 3) return 99;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i-1] === b[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
    }
    return dp[m][n];
}

// ─────────────────────────────────────────────
//  HANDLER PESAN
// ─────────────────────────────────────────────
client.on('message', async (msg) => {
    if (msg.fromMe || msg.from === 'status@broadcast') return;

    const pesan      = msg.body?.trim() ?? '';
    const pesanLower = pesan.toLowerCase();

    let chat;
    try { chat = await msg.getChat(); }
    catch (e) { console.error('⚠️  Gagal mendapat chat:', e.message); return; }

    const isAdmin = await cekAdmin(msg, chat);

    // ── /panduan ──────────────────────────────
    if (pesanLower === '/panduan') {
        if (!isAdmin) return balas(msg, '❌ Perintah ini hanya untuk Admin Grup!');
        return balas(msg,
            `📖 *PANDUAN ADMIN*\n\n` +
            `*📦 Produk (teks saja):*\n` +
            `• Tambah: \`addlist: Nama | Isi\`\n` +
            `• Edit:   \`editlist: Nama | Isi Baru\`\n` +
            `• Hapus:  \`dellist: Nama\`\n\n` +
            `*🖼️ Produk dengan gambar (reply foto):*\n` +
            `• Tambah: reply foto → \`addlist: Nama | Isi\`\n` +
            `• Edit:   reply foto → \`editlist: Nama | Isi Baru\`\n\n` +
            `*👤 Kelola Admin Bot:*\n` +
            `• Tambah: \`admin: @tag\` _(reply/tag member)_\n` +
            `• Hapus:  \`deladmin: @tag\`\n` +
            `• List:   \`listadmin\`\n\n` +
            `*🛒 Order (reply foto bukti bayar):*\n` +
            `• \`proses\` → buat ID order & tandai Diproses\n` +
            `• \`done\`   → tandai order Selesai\n\n` +
            `*📋 Riwayat (Admin):*\n` +
            `• \`riwayat\`           → semua order\n` +
            `• \`riwayat: diproses\` → filter Diproses\n` +
            `• \`riwayat: selesai\`  → filter Selesai\n` +
            `• \`riwayat: hari ini\` → order hari ini\n\n` +
            `*🔍 Umum:*\n` +
            `• \`cekorder: GS001\`  → detail order\n` +
            `• \`riwayat saya\`     → riwayat pembeli\n` +
            `• \`.close\` / \`.open\` → buka/tutup grup\n` +
`• \`!\`                → pin pesan`
        );
    }

    // ── menu ──────────────────────────────────
    if (pesanLower === 'menu') {
        const keys = Object.keys(customList).sort();
        let menuTeks = `𝗐𝖾𝗅𝖼𝗈𝗆𝖾 to *Echin Store*, Ketik list berikut untuk keterangan lebih lanjut\n\n`;
        if (keys.length > 0) {
            menuTeks += `*List Produk:*\n`;
            keys.forEach(k => {
                
                menuTeks += `- ${k.charAt(0).toUpperCase() + k.slice(1)}\n`;
            });
        } else {
            menuTeks += `_Belum ada produk._\n`;
        }
        return balas(msg, menuTeks + `\n*Happy Shopping* 🛍️`);
    }

    // ── cekorder: ID ──────────────────────────
    if (pesanLower.startsWith('cekorder:')) {
        const idCari = pesan.substring(9).trim().toUpperCase();
        const order  = db.orders[idCari];
        if (!order) return balas(msg, `❌ Order *${idCari}* tidak ditemukan.`);
        const statusEmoji = order.status === 'Selesai' ? '✅' : order.status === 'Diproses' ? '⏳' : '🕐';
        return balas(msg,
            `🧾 *Detail Order ${order.id}*\n\n` +
            `📦 Produk  : ${order.namaProduk}\n` +
            `📅 Tanggal : ${order.tanggalOrder}\n` +
            `🕐 Waktu   : ${order.waktuOrder} WIB\n` +
            `👤 Pembeli : ${order.pembeliNama}\n` +
            `${statusEmoji} Status  : *${order.status}*`
        );
    }

    // ── riwayat saya (pembeli) ────────────────
    if (pesanLower === 'riwayat saya') {
        const senderId  = msg.author ?? msg.from;
        const milikSaya = Object.values(db.orders)
            .filter(o => o.pembeliId === senderId)
            .sort((a, b) => a.id.localeCompare(b.id));
        if (milikSaya.length === 0) return balas(msg, `📭 Kamu belum memiliki riwayat order.`);
        const baris = milikSaya.map(o => {
            const ikon = o.status === 'Selesai' ? '✅' : '⏳';
            return `${ikon} *${o.id}* | ${o.namaProduk} | ${o.tanggalOrder}`;
        }).join('\n');
        return balas(msg,
            `📋 *Riwayat Order Kamu*\n_(${milikSaya.length} order)_\n\n` +
            baris + `\n\n_Ketik \`cekorder: ID\` untuk detail._`
        );
    }

    // ── riwayat (admin) ───────────────────────
    if (pesanLower === 'riwayat' || pesanLower.startsWith('riwayat:')) {
        if (!isAdmin) return balas(msg, '❌ Perintah ini hanya untuk Admin!');
        const filter  = pesanLower.startsWith('riwayat:') ? pesan.substring(8).trim().toLowerCase() : '';
        const hariIni = formatTanggal(new Date());
        let semua     = Object.values(db.orders);
        if (filter === 'diproses')       semua = semua.filter(o => o.status === 'Diproses');
        else if (filter === 'selesai')   semua = semua.filter(o => o.status === 'Selesai');
        else if (filter === 'hari ini')  semua = semua.filter(o => o.tanggalOrder === hariIni);
        else if (filter !== '')          return balas(msg, `❌ Filter tidak dikenal.\nGunakan: \`riwayat\`, \`riwayat: diproses\`, \`riwayat: selesai\`, \`riwayat: hari ini\``);
        semua.sort((a, b) => a.id.localeCompare(b.id));
        if (semua.length === 0) return balas(msg, `📭 Tidak ada order${filter ? ` dengan filter *${filter}*` : ''}.`);
        const totalDiproses = semua.filter(o => o.status === 'Diproses').length;
        const totalSelesai  = semua.filter(o => o.status === 'Selesai').length;
        const MAKS   = 30;
        const tampil = semua.slice(-MAKS);
        const baris  = tampil.map(o => {
            const ikon = o.status === 'Selesai' ? '✅' : '⏳';
            return `${ikon} *${o.id}* | ${o.namaProduk}\n   👤 ${o.pembeliNama} | 📅 ${o.tanggalOrder} ${o.waktuOrder}`;
        }).join('\n\n');
        const judulFilter = filter ? ` — ${filter.charAt(0).toUpperCase() + filter.slice(1)}` : '';
        const catatan     = semua.length > MAKS ? `\n\n_Menampilkan ${MAKS} order terbaru dari total ${semua.length}._` : '';
        return balas(msg,
            `📊 *Riwayat Order${judulFilter}*\n` +
            `⏳ Diproses: ${totalDiproses}  ✅ Selesai: ${totalSelesai}  📦 Total: ${semua.length}\n` +
            `─────────────────\n\n` + baris + catatan
        );
    }

    // ── Perintah Admin ────────────────────────
    if (isAdmin) {

        // ── admin: @tag (tambah admin bot) ──
        if (pesanLower.startsWith('admin:')) {
            // Hanya owner mutlak atau admin grup yang bisa mengelola admin bot
            const authorId = msg.author ?? msg.from;
            const isOwner  = authorId === ADMIN_ID;
            let isGrupAdmin = false;
            if (chat.isGroup) {
                const user = chat.participants.find(p => p.id._serialized === authorId);
                isGrupAdmin = !!(user && (user.isAdmin || user.isSuperAdmin));
            }
            if (!isOwner && !isGrupAdmin) return balas(msg, '❌ Hanya Owner atau Admin Grup yang bisa menambah Admin Bot!');

            const mentionedIds = msg.mentionedIds;
            if (!mentionedIds || mentionedIds.length === 0)
                return balas(msg, '❌ Tag/mention member yang ingin dijadikan Admin Bot.\nContoh: *admin: @nama*');

            if (!db.adminList) db.adminList = [];
            const ditambahkan = [];
            const sudahAda    = [];

            for (const id of mentionedIds) {
                const idStr = id._serialized ?? id;
                if (db.adminList.includes(idStr)) {
                    sudahAda.push(idStr);
                } else {
                    db.adminList.push(idStr);
                    ditambahkan.push(idStr);
                }
            }
            simpanData();

            let balasanTeks = '';
            if (ditambahkan.length > 0) {
                const namaList = await Promise.all(ditambahkan.map(async (idStr) => {
                    try {
                        const kontak = await client.getContactById(idStr);
                        return kontak.pushname || kontak.name || idStr;
                    } catch (_) { return idStr; }
                }));
                balasanTeks += `✅ *${namaList.join(', ')}* berhasil didaftarkan sebagai Admin Bot.\n`;
            }
            if (sudahAda.length > 0) {
                balasanTeks += `⚠️ Beberapa member sudah terdaftar sebagai Admin Bot.`;
            }
            return balas(msg, balasanTeks.trim());
        }

        // ── deladmin: @tag (hapus admin bot) ──
        if (pesanLower.startsWith('deladmin:')) {
            const authorId = msg.author ?? msg.from;
            const isOwner  = authorId === ADMIN_ID;
            let isGrupAdmin = false;
            if (chat.isGroup) {
                const user = chat.participants.find(p => p.id._serialized === authorId);
                isGrupAdmin = !!(user && (user.isAdmin || user.isSuperAdmin));
            }
            if (!isOwner && !isGrupAdmin) return balas(msg, '❌ Hanya Owner atau Admin Grup yang bisa menghapus Admin Bot!');

            const mentionedIds = msg.mentionedIds;
            if (!mentionedIds || mentionedIds.length === 0)
                return balas(msg, '❌ Tag/mention member yang ingin dihapus dari Admin Bot.\nContoh: *deladmin: @nama*');

            if (!db.adminList) db.adminList = [];
            const dihapus    = [];
            const tidakAda   = [];

            for (const id of mentionedIds) {
                const idStr = id._serialized ?? id;
                const idx   = db.adminList.indexOf(idStr);
                if (idx !== -1) {
                    db.adminList.splice(idx, 1);
                    dihapus.push(idStr);
                } else {
                    tidakAda.push(idStr);
                }
            }
            simpanData();

            let balasanTeks = '';
            if (dihapus.length > 0) {
                const namaList = await Promise.all(dihapus.map(async (idStr) => {
                    try {
                        const kontak = await client.getContactById(idStr);
                        return kontak.pushname || kontak.name || idStr;
                    } catch (_) { return idStr; }
                }));
                balasanTeks += `🗑️ *${namaList.join(', ')}* telah dihapus dari Admin Bot.\n`;
            }
            if (tidakAda.length > 0) {
                balasanTeks += `⚠️ Beberapa member tidak terdaftar sebagai Admin Bot.`;
            }
            return balas(msg, balasanTeks.trim());
        }

        // ── listadmin ──
        if (pesanLower === 'listadmin') {
            if (!db.adminList || db.adminList.length === 0)
                return balas(msg, `📋 *Daftar Admin Bot*\n\n_Belum ada Admin Bot yang terdaftar._\n\nGunakan: *admin: @tag*`);

            const namaList = await Promise.all(db.adminList.map(async (idStr, i) => {
                try {
                    const kontak = await client.getContactById(idStr);
                    const nama   = kontak.pushname || kontak.name || idStr;
                    return `${i + 1}. ${nama}`;
                } catch (_) { return `${i + 1}. ${idStr}`; }
            }));
            return balas(msg,
                `📋 *Daftar Admin Bot* (${db.adminList.length} orang)\n\n` +
                namaList.join('\n') +
                `\n\n_Tambah: *admin: @tag* | Hapus: *deladmin: @tag*_`
            );
        }

        // addlist: Nama | Isi
        // Bisa reply foto untuk menyertakan gambar
        if (pesanLower.startsWith('addlist:')) {
            const bagian = pesan.substring(8).split('|');
            if (bagian.length < 2) return balas(msg, '❌ Format: *addlist: Nama | Isi*\n_Tip: reply foto dulu untuk tambah gambar._');
            const nama = bagian[0].trim().toLowerCase();
            const isi  = bagian.slice(1).join('|').trim();
            if (!nama) return balas(msg, '❌ Nama produk tidak boleh kosong.');

            let gambarBase64 = null;

            // Cek apakah admin reply foto
            if (msg.hasQuotedMsg) {
                try {
                    const quoted = await msg.getQuotedMessage();
                    if (quoted.type === 'image' && quoted.hasMedia) {
                        const media = await quoted.downloadMedia();
                        gambarBase64 = media.data; // sudah base64
                    }
                } catch (_) {}
            }
            // Cek apakah pesan itu sendiri adalah foto dengan caption addlist
            else if (msg.type === 'image' && msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    gambarBase64 = media.data;
                } catch (_) {}
            }

            customList[nama] = { teks: isi, gambar: gambarBase64 };
            simpanData();
            return balas(msg, `✅ Produk *${nama}* berhasil ditambahkan${gambarBase64 ? ' beserta gambar 🖼️' : ''}.`);
        }

        // editlist: Nama | Isi Baru
        // Bisa reply foto untuk mengganti/menambah gambar
        if (pesanLower.startsWith('editlist:')) {
            const bagian = pesan.substring(9).split('|');
            if (bagian.length < 2) return balas(msg, '❌ Format: *editlist: Nama | Isi Baru*\n_Tip: reply foto untuk mengganti gambar._');
            const nama = bagian[0].trim().toLowerCase();
            const isi  = bagian.slice(1).join('|').trim();
            if (!customList[nama]) return balas(msg, `❌ Produk *${nama}* tidak ditemukan.`);

            // Pertahankan gambar lama kecuali ada foto baru
            let gambarBase64 = customList[nama]?.gambar ?? null;

            if (msg.hasQuotedMsg) {
                try {
                    const quoted = await msg.getQuotedMessage();
                    if (quoted.type === 'image' && quoted.hasMedia) {
                        const media = await quoted.downloadMedia();
                        gambarBase64 = media.data;
                    }
                } catch (_) {}
            } else if (msg.type === 'image' && msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    gambarBase64 = media.data;
                } catch (_) {}
            }

            customList[nama] = { teks: isi, gambar: gambarBase64 };
            simpanData();
            return balas(msg, `📝 Produk *${nama}* berhasil diperbarui${gambarBase64 ? ' beserta gambar 🖼️' : ''}.`);
        }

        // dellist: Nama
        if (pesanLower.startsWith('dellist:')) {
            const nama = pesan.substring(8).trim().toLowerCase();
            if (!nama) return balas(msg, '❌ Masukkan nama produk yang ingin dihapus.');
            if (!customList[nama]) return balas(msg, `❌ Produk *${nama}* tidak ditemukan.`);
            delete customList[nama];
            simpanData();
            return balas(msg, `🗑️ Produk *${nama}* berhasil dihapus.`);
        }

        // ── proses ──
        if (pesanLower === 'proses' && msg.hasQuotedMsg) {
            let quotedMsg;
            try { quotedMsg = await msg.getQuotedMessage(); }
            catch (e) { return balas(msg, '❌ Gagal membaca pesan yang di-reply.'); }
            if (quotedMsg.type !== 'image') return balas(msg, '❌ Reply harus ke foto *bukti pembayaran*!');
            const caption    = quotedMsg.body?.trim() || '';
            const namaProduk = caption || '_(tidak ada caption)_';
            const pembeliId  = quotedMsg.author ?? quotedMsg.from;
            let pembeliNama  = pembeliId;
            try {
                const kontak = await client.getContactById(pembeliId);
                pembeliNama  = kontak.pushname || kontak.name || pembeliId;
            } catch (_) {}
            const sudahAda = Object.values(db.orders).find(o => o.msgId === quotedMsg.id._serialized);
            if (sudahAda) return balas(msg, `⚠️ Bukti bayar ini sudah diproses.\nID Order: *${sudahAda.id}*`);
            const now = new Date();
            const idOrder = buatIdOrder();
            db.orders[idOrder] = {
                id: idOrder, namaProduk, waktuOrder: formatWaktu(now),
                tanggalOrder: formatTanggal(now), pembeliId, pembeliNama,
                status: 'Diproses', msgId: quotedMsg.id._serialized,
            };
            simpanData();
            const pesanProses =
                `✅ *Pembayaran Dikonfirmasi!*\n\n` +
                `🆔 ID Order  : *${idOrder}*\n` +
                `📦 Produk    : ${namaProduk}\n` +
                `📅 Tanggal   : ${formatTanggal(now)}\n` +
                `🕐 Waktu     : ${formatWaktu(now)} WIB\n` +
                `👤 Pembeli   : ${pembeliNama}\n` +
                `⏳ Status    : *Diproses*\n\n` +
                `_Pesanan sedang kami proses. Harap tunggu ya!_ 🙏`;
            // Hanya kirim detail ke DM pembeli, tanpa balas di grup
            await kirimDM(pembeliId, pesanProses);
            return;
        }

        // ── done ──
        if (pesanLower === 'done' && msg.hasQuotedMsg) {
            let quotedMsg;
            try { quotedMsg = await msg.getQuotedMessage(); }
            catch (e) { return balas(msg, '❌ Gagal membaca pesan yang di-reply.'); }
            const order = Object.values(db.orders).find(o => o.msgId === quotedMsg.id._serialized);
            if (!order) return balas(msg, `❌ Order tidak ditemukan.\nGunakan *proses* terlebih dahulu.`);
            if (order.status === 'Selesai') return balas(msg, `⚠️ Order *${order.id}* sudah *Selesai*.`);
            order.status = 'Selesai';
            simpanData();
            const pesanDone =
                `🎉 *Pesanan Selesai!*\n\n` +
                `🆔 ID Order  : *${order.id}*\n` +
                `📦 Produk    : ${order.namaProduk}\n` +
                `📅 Tanggal   : ${order.tanggalOrder}\n` +
                `🕐 Waktu     : ${order.waktuOrder} WIB\n` +
                `👤 Pembeli   : ${order.pembeliNama}\n` +
                `✅ Status    : *Selesai*\n\n` +
                `_Terima kasih sudah berbelanja di Echin Store!_ 🛍️`;
            // Hanya kirim detail ke DM pembeli, tanpa balas di grup
            await kirimDM(order.pembeliId, pesanDone);
            return;
        }

        // .close / .open
        if (pesanLower === '.close' || pesanLower === '.open') {
            if (!chat.isGroup) return balas(msg, '❌ Perintah ini hanya untuk Grup.');
            const tutup = pesanLower === '.close';
            try {
                await chat.setMessagesAdminsOnly(tutup);
                return balas(msg, tutup ? '🔒 Grup ditutup.' : '🔓 Grup dibuka.');
            } catch (e) {
                return balas(msg, '❌ Gagal. Pastikan bot adalah Admin!');
            }
        }

        // ! – pin pesan
        if (pesan.startsWith('!')) {
            const textToPin = pesan.substring(1).trim();
            try {
                if (textToPin.length > 0) {
                    const botMsg = await chat.sendMessage(textToPin);
                    await botMsg.pin(86400);
                } else if (msg.hasQuotedMsg) {
                    const quotedMsg = await msg.getQuotedMessage();
                    await quotedMsg.pin(86400);
                } else {
                    await balas(msg, '❌ Ketik teks setelah ! atau reply pesan yang ingin di-pin.');
                }
            } catch (e) { balas(msg, '❌ Gagal pin. Pastikan bot adalah Admin!'); }
            return;
        }
    }

    // ── Cek list otomatis ─────────────────────
    if (customList[pesanLower]) {
        return balasProduk(msg, customList[pesanLower]);
    }

    // ── Fuzzy match – deteksi typo ────────────
    // Hanya proses pesan pendek (maks 30 karakter) agar tidak false positive
    if (pesanLower.length <= 30 && pesanLower.length >= 2) {
        const keys  = Object.keys(customList);
        const cocok = keys.find(k => hitungJarak(pesanLower, k) <= 2 && k.length >= 3);
        if (cocok) {
            const formatNama = cocok.charAt(0).toUpperCase() + cocok.slice(1);
            return balas(msg, `❓ Apakah maksud kamu *${formatNama}*?\n_Ketik kata kunci dengan benar untuk melihat info produk._`);
        }
    }
});

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────
client.initialize();
