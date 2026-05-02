const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const { execSync } = require('child_process');

// ─────────────────────────────────────────────
//  KONFIGURASI
// ─────────────────────────────────────────────
const ADMIN_ID  = '174500427595779@lid'; // ID Owner (backup mutlak)
const DB_PATH   = '/data/database.json';
const NOMOR_BOT = '6288991973369';       // Nomor WA bot (tanpa + atau 0 di depan)

// ─────────────────────────────────────────────
//  KONFIGURASI SAMBUTAN
//  Ganti teks dan path gambar sesuai kebutuhan
// ─────────────────────────────────────────────
const SAMBUTAN = {
    teks: `🎉 Selamat datang di *Genius Store*, @{{nama}}!

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
let db = { produk: {}, orders: {}, orderCounter: 1 };
let customList;

function muatData() {
    try {

        // kalau file belum ada buat otomatis
        if (!fs.existsSync(DB_PATH)) {
            console.log('📂 database.json belum ada, membuat baru...');
            db = {
                produk: {},
                orders: {},
                orderCounter: 1
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
                orderCounter: 1
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
                orderCounter: raw.orderCounter || 1
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
                orderCounter: raw.orderCounter || 1
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
            orderCounter:1
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
    const id    = `GS${nomor}`;
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

client.on('ready',        ()       => console.log('✅ Bot Genius Store Aktif!'));
client.on('auth_failure', (msg)    => console.error('❌ Auth gagal:', msg));
client.on('disconnected', async (reason)=>{

    console.warn('⚠️ Bot terputus:',reason);

    try{
        console.log('♻️ reconnect...');
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
    if (!chat.isGroup) return msg.from === ADMIN_ID;
    const authorId = msg.author ?? msg.from;
    if (authorId === ADMIN_ID) return true;
    const user = chat.participants.find(p => p.id._serialized === authorId);
    return !!(user && (user.isAdmin || user.isSuperAdmin));
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
        let menuTeks = `𝗐𝖾𝗅𝖼𝗈𝗆𝖾 to *Genius Store*, Ketik list berikut untuk keterangan lebih lanjut\n\n`;
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
            const nama = bagian[0]
