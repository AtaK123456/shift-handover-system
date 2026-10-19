# Vardiya takip API

Express 5, TypeScript, Prisma 7.10.1 ve PostgreSQL tabanlı vardiya takip servisi.

## Kurulum

Node.js 22.12+ (22 serisi) veya 24 ve üzeri kullanın.

```sh
npm ci
cp .env.example .env
```

`.env` içinde kendi PostgreSQL bağlantınızı ve en az 32 baytlık rastgele
`JWT_SECRET` değerini tanımlayın. Anahtar üretmek için:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npx prisma migrate deploy
npm run build
npm start
```

Geliştirme: `npm run dev`. Kontroller: `npm test` ve `npm run typecheck`.
Prisma komutları için `DATABASE_URL` tanımlı olmalıdır. Testler üretilmiş Prisma
istemcisi gerektirir (`npx prisma generate`); testlerde gerçek veritabanı kullanılmaz.

## Güvenlik davranışı

- `/register` geçerli e-posta, 1–100 karakter isim ve en az 12 karakter/en çok
  256 bayt şifre bekler; yalnızca `WORKER` oluşturur. Mevcut kısa şifrelerle giriş korunur.
- `/login` ve `/register` için IP başına 15 dakikada sırasıyla 20 ve 10 istek sınırı vardır.
- `/users` yalnızca güncel veritabanı rolü `MANAGER` olan kullanıcılara açıktır.
- Vardiya yolları yalnızca token ile doğrulanan kullanıcının kendi kimliğini kullanır.
- JWT yalnızca HS256 kabul eder ve 8 saat geçerlidir. Rol her istekte veritabanından okunur.
- Eski salt:scrypt şifre kayıtları ve süreli HS256 tokenları aynı anahtarla çalışmaya devam eder.
- İstek gövdeleri 16 KB ile sınırlıdır. İç hata ayrıntıları istemciye döndürülmez.

## Dağıtım ve kalan işler

- Trafiği HTTPS üzerinden sunun. Tokenları günlük kayıtlarına yazmayın.
- Hız sınırı bu aşamada süreç belleğinde tutulur. Birden fazla uygulama örneğinde
  paylaşımlı bir depo kullanın. Reverse proxy varsa `trust proxy` değerini yalnızca
  gerçek proxy topolojisine göre yapılandırın; istemci IP başlıklarına körü körüne güvenmeyin.
- Herkese açık kayıt mevcut davranış olarak korunur. Davet/onay ve e-posta doğrulaması henüz yoktur.
- Normal çıkış veya şifre değişikliğinde token iptali henüz yoktur; token süresi 8 saattir.
- Aynı kullanıcıya eşzamanlı `/shifts/start` isteklerinde veritabanı yalnızca bir
  aktif vardiyaya izin verir; diğerleri `409` alır. Tamamlanmış vardiyalar sınırsız kalır.
- Koşullu indeks Prisma şemasında `partialIndexes` önizleme özelliğiyle tanımlıdır;
  migration da aynı indeksi oluşturur. İndeksi kaldırmayın veya koşulsuz `userId`
  benzersizliğiyle değiştirmeyin; bu, geçmiş vardiya kayıtlarını engeller.
- Listeleme sayfalaması ve üretim hata izleme ayrıca ele alınmalıdır.
- Prisma istemcisi, CLI ve PostgreSQL adaptörü 7.10.1 sürümüne yükseltildi.
  Bağlantı artık `src/database.ts` içindeki `PrismaPg` adaptörüyle kurulur;
  CLI bağlantısı `prisma.config.ts` içinden gelir. Tarama sırasında `npm audit`
  sıfır bildirim raporladı; bu sonuç yeni bildirimlerle değişebilir.

## Mevcut kurulumun güncellenmesi

Veritabanınızın yedeğini alın. Önce mükerrer aktif vardiyaları inceleyin:

```sql
SELECT "userId", COUNT(*) FROM "Shift"
WHERE "status" = 'ACTIVE' GROUP BY "userId" HAVING COUNT(*) > 1;
```

Migration mükerrer kayıt bulursa hiçbir vardiyayı silmeden veya kapatmadan durur.
Hangi kayıtların kapatılacağını iş kurallarına göre belirleyip düzelttikten sonra,
yalnızca başarısız migration için aşağıdaki komutla yeniden denemeye izin verin:

```sh
npx prisma migrate resolve --rolled-back 20261019000100_one_active_shift_per_user
npx prisma migrate deploy
```

Yeni sürümü devreye almadan önce `npm ci`, `npx prisma migrate deploy` ve
`npm run build` çalıştırın. Migration tablo yazmalarını geçici olarak kilitler;
kilidi 10 saniyede alamazsa işlemi durdurur. Büyük veritabanlarında bakım zamanı planlayın.

## PostgreSQL entegrasyon testleri

Yalnızca test için ayrılmış, silinebilen bir PostgreSQL veritabanı kullanın.
`DATABASE_URL` ve `TEST_DATABASE_URL` bu test veritabanını göstermelidir.
Migration uygulandıktan sonra:

```sh
npm run test:integration
```

Bu testler iki bağımsız Prisma istemcisi/API örneğinden 12 eşzamanlı başlangıçta
bir `201`, diğerlerinde `409`; 8 eşzamanlı bitirmede bir `200`, diğerlerinde `404`
bekler. Doğrudan veritabanı yazarı da aynı kısıta tabidir. Ayrıca başka bir kullanıcının
vardiyası, tamamlanmış vardiya geçmişi ve mükerrer veri bulunan migration'ın
hiçbir kayıt değiştirmeden durması doğrulanır. Testlerin oluşturduğu kayıtlar temizlenir.

## Web arayüzü ve Excel

Uygulama başladıktan sonra **http://localhost:3000/app/** adresini açın.
Ana adres `/` de bu ekrana yönlendirir. Frontend `public/` klasöründedir ve
API ile aynı sunucudan çalışır; ayrı frontend kurulumu veya derlemesi gerekmez.

- Giriş yapın veya hesap oluşturun. Yeni hesaplar ÇALIŞAN (`WORKER`) rolündedir.
- Üstteki karttan vardiyayı başlatın/bitirin; saatler otomatik kaydedilir.
- Geçmiş listesinde tarihler seçip **Uygula** düğmesine basın.
- **Excel’e aktar**, uygulanan filtredeki tüm kayıtları indirir; yalnızca görünen
  sayfayı indirmez. Tarihleri boş bırakırsanız tüm tarihler seçilir.
- Yönetici rolünde **Kayıtlar → Tüm personel** seçeneği görünür. Diğer roller
  yalnızca kendi vardiyalarını görebilir ve indirebilir.

Excel dosyasında vardiya no, personel no/ad/e-posta, başlangıç, bitiş, durum, vardiya tarihi ve seçilen vardiya saatleri vardır. Tarihler vardiyanın başlangıcına göre ve İstanbul
saatinde süzülür; iki uç tarih de dahildir. Aktif vardiyanın gerçek bitişi boş kalır. Dosya en fazla 5.000 satır içerir; sınır aşılırsa kayıtlar
kesilmeden hata verilir ve tarih aralığını daraltmanız istenir. Boş sonuçta da
başlıkları olan geçerli bir dosya indirilir. Kullanıcı metinleri Excel formülü
olarak değerlendirilmez. Şifre ve JWT verileri dosyaya dahil edilmez.

Token yalnızca sayfa belleğinde saklanır; sayfayı yenilemek yeniden giriş
gerektirir. Tarayıcı depolarına yazılmaz. Excel indirmesi IP başına 15 dakikada
5 istekle sınırlıdır. Üretimde HTTPS kullanın.

### Yeni API yolları

`Authorization: Bearer <token>` gerektirir:

- `GET /shifts?from=2026-10-01&to=2026-10-31&scope=own&page=1`
  → `{ items, total, page, pageSize }`, sayfa başına 20 kayıt, en yeni önce.
- `GET /shifts/export?from=2026-10-01&to=2026-10-31&scope=own`
  → `.xlsx` eki, başlangıç tarihine göre eskiden yeniye.

`scope=own` varsayılandır. `scope=all` yalnızca güncel veritabanı rolü MANAGER
olan kullanıcıya açıktır. Tarihler isteğe bağlıdır; `YYYY-AA-GG` biçimindedir.
ExcelJS içindeki uuid alt bağımlılığı, CommonJS uyumlu ve güvenlik düzeltmesini
içeren 11.1.1 sürümüne sabitlenmiştir.

### Tarayıcı testleri

Önce `npm run build` ve test veritabanı migration'larını çalıştırın.
Test için ayrılmış PostgreSQL bağlantısını `TEST_DATABASE_URL` olarak tanımlayın:

```sh
npx playwright install chromium
npm run test:e2e
```

İstenirse sistem Chromium yolu `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` ile verilir.
Testler kendi yerel sunucusunu başlatır ve durdurur; 3000 portu boş olmalıdır.
Giriş/kayıt, vardiya başlatma/bitirme, filtreleme, gerçek Excel indirmesi,
yönetici görünümü, mobil taşma ve çıkış akışları kontrol edilir.

### Açık / koyu tema

Giriş/kayıt ekranındaki ve panelin üst kısmındaki **güneş/ay simgeli tema anahtarı**
ile görünümü değiştirebilirsiniz. **文 / A** simgesi Türkçe/English seçimini açar. İlk açılışta cihazınızın tema tercihi kullanılır.
Elle seçilen tema yalnızca `vardiya-theme` anahtarıyla tarayıcıda saklanır;
sayfa yenilenince, ekran değiştirince ve çıkış yapınca korunur. Şifre ve token
bu tercihle birlikte kaydedilmez. Tarayıcı depolaması kapalıysa tema o sayfada
çalışmaya devam eder; sonraki açılışta cihaz tercihi kullanılır.

## Tesis devir paneli

- GT1/GT2 gaz türbinleri ve ST buhar türbini için **Belirtilmedi / Devrede /
  Devre dışı / Bakımda** seçilir; durum notu, güncelleyen kişi ve zaman görünür.
  Durumlar manuel kayıttır; yeni kurulumda hiçbir ünite otomatik olarak devrede
  kabul edilmez. Değişiklikler EquipmentChange tablosunda saklanır; eski sürüm
  üzerinden güncelleme 409 döner ve yenileme gerektirir.
- **Olay / Not / Aktif vana / Dikkat edilecek konu / Devam eden iş** kayıtları
  başlık, açıklama ve önem derecesiyle oluşturulur. Açık vana/dikkat/iş kayıtları
  vardiya bitince kaybolmaz; biri kapatana kadar ortak devir panelinde kalır.
  Kapanış notu, kapatan kişi ve tarih saklanır; geçmiş kayıt silinmez. Olay/not
  türleri doğrudan geçmiş bölümünde görünür.
- Bu sürüm tek tesis içindir. Tüm giriş yapan roller ortak tesis durumlarını ve
  devir kayıtlarını görür; kayıt ekleyebilir, ünite durumu güncelleyebilir ve açık
  işleri kapatabilir. Kişisel vardiya listesi/Excel için önceki rol kısıtları sürer.
- Bir kayda en fazla 3 JPEG/PNG/WebP fotoğraf (her biri en fazla 5 MB) eklenir.
  Görsel gerçek içerikten doğrulanır, en fazla 1600x1600'e küçültülüp JPEG'e
  dönüştürülür; EXIF korunmaz. Fotoğraflar PostgreSQL'de saklanır ve yedeklemeye
  dahildir. Fotoğraf URL'si de JWT doğrulaması gerektirir; herkese açık dosya
  servisi yoktur. Görseller indirildiğinde sayfada geçici blob URL'si kullanılır.
- Ortak panel 30 saniyede bir yenilenir; **Yenile** ile hemen güncellenir.
- Vardiya tarihi ve 00:00–08:00 / 08:00–16:00 / 16:00–00:00 aralıklarından biri
  başlangıçta seçilir. Tarih, aralığın başladığı gündür; 16:00–00:00 vardiyası
  ertesi gün biter. Gerçek giriş/çıkış saati ayrıca saklanır. Geçen süre kaldırıldı.
  Eski kayıtlara saat aralığı uydurulmaz; belirtilmemiş olarak görünür.
- Türkçe/English seçimi giriş ve panelde bulunur, `vardiya-language` tercihi
  tarayıcıda korunur. Arayüz ve Excel başlıkları çevrilir; operatörün kendi
  yazdığı notlar otomatik çevrilmez. Saat dilimi her iki dilde İstanbul'dur.

### Güncelleme

Veritabanını yedekleyin; yeni tablolar ve nullable vardiya alanları için
`npx prisma migrate deploy` çalıştırın, ardından `npm run build` ve `npm start`.
Bu migration mevcut vardiya, olay veya kullanıcı kayıtlarını silmez.

Yeni yolların tümü `Authorization: Bearer <token>` gerektirir:
`GET /operations/equipment`, `PUT /operations/equipment/:code`,
`GET /operations/entries?view=open|history&page=1`, `POST /operations/entries`
(JSON veya multipart; `photos` dosya alanı), `POST /operations/entries/:id/close`,
`GET /operations/photos/:id`.

## Kullanım kolaylığı: özet, hızlı kayıt ve arama

### Vardiya devralma özeti

Girişte ünite durumları, tüm açık kayıtların sayısı, önemli açık kayıtlar ve son
olay/not başlıkları gösterilir. Özet listeleri en fazla beşer başlıktır; tüm açık
kayıtlar devir panelinden incelenir. Aktif vardiya başlatıldıktan sonra
**Devir özetini okudum** seçilebilir. Bu işlem tüm kayıtların tek tek okunduğunu
iddia etmez; gösterilen özetin sürümünü, verisinin kopyasını, kişiyi, vardiyayı ve okuma
zamanını `HandoverRead` tablosuna kaydeder.

Ünite güncelleme, kayıt ekleme veya kapatma işlemi aynı veritabanı transaction'ında
ortak sürümü artırır. Özet tutarlı bir PostgreSQL snapshot'ından okunur. Eski
sürüm onayı 409 alır; kullanıcı yeni özeti incelemelidir. Aynı kişinin aynı
vardiyada aynı sürümü tekrar onaylaması yeni kayıt oluşturmaz. Yeni vardiyada
önceki vardiyanın onayı kullanılmaz. Bu sürüm takibi uygulamanın API yazmaları
üzerinden yapılır; operasyon tablolarını doğrudan SQL ile güncellemeyin.

Yeni yollar: `GET /operations/summary`,
`POST /operations/summary/read` (JSON `{ "revision": 123 }`). İkisi de JWT gerektirir;
kimlik ve aktif vardiya sunucudan belirlenir. Eski okuma kayıtları değişmez.

### Hızlı kayıt ve fotoğraf

Olay, vana, iş ve dikkat kısayolları formu hazırlar; yazılmış metni silmez.
İsteğe bağlı GT1/GT2/ST seçimi kayda ünite etiketi ekler. Eski kayıtlara tahmini
ünite atanmaz; etiketlenmemiş kayıtlar **Genel / ortak** görünür.

Fotoğraflar galeriden veya destekleyen telefonda **Fotoğraf çek** ile seçilir;
cihaz/tarayıcı kamera seçeneği sunmuyorsa dosya seçimi kullanılabilir. Önizleme ve
tek tek kaldırma vardır. Toplam üç fotoğraf ve fotoğraf başına 5 MB sınırı sürer.
Tarayıcı testinde dosya seçimi/capture niyeti ve yükleme doğrulanır; fiziksel telefon
kamerası otomasyonu bu testin kapsamında değildir.

Kaydedilmemiş metin/fotoğraf varken çıkış ve sayfadan ayrılma uyarısı vardır.
Kaydetme sırasında form düzenlemeleri kilitlenir; yeni yazılan metin yanlışlıkla
silinmez. Oturum kesilirse taslak yalnızca mevcut sayfanın belleğinde tutulur;
aynı hesapla yeniden girişte geri yüklenir. Başka hesapla girişte gösterilmez ve
silinir. Tarayıcı depolarına, sunucuya veya diske otomatik taslak yazılmaz.
Tarayıcıyı kapatıp uyarıyı kabul etmek taslağı kaybettirir; kalıcı kayıt için Kaydet
kullanılmalıdır. Fotoğraf önizlemelerinin geçici URL'leri kaldırmada/çıkışta temizlenir.

### Olay ve devir kayıtlarında arama

Metin (başlık, açıklama, kapanış notu), ünite, kayıt türü, açık/kapalı durum ve
İstanbul saatine göre dahil tarih aralığı birlikte filtrelenir. Arama tüm açık ve
kapalı kayıtlara bakar; sayfa değiştirince filtreler korunur. Temizle normal
olay/devir geçmişini geri getirir. Açık durum filtresi yalnızca kapatılabilir
vana/dikkat/iş kayıtlarını getirir; olay ve genel not için durum filtresini boş bırakın.

`GET /operations/entries?view=all&q=pompa&equipment=GT1&kind=TASK&status=open&from=2026-10-01&to=2026-10-31&page=1`

`equipment` için GT1/GT2/ST/GENERAL; `kind` için EVENT/NOTE/VALVE/ATTENTION/TASK;
`status` için open/closed kullanılır. Parametreler isteğe bağlıdır. Sayfa başına
20 kayıt döner. Eski view=open/history davranışı korunur. Query değerleri
Prisma ile parametrelenir; aramadaki `%` ve `_` joker değil düz metin olarak aranır.

Güncelleme: veritabanı yedeğinden sonra `npm ci`, `npx prisma migrate deploy`,
`npm run build`, `npm start`. Yeni `20261019000300_handover_reads_and_entry_units`
migration'ı okuma kayıtlarını, ortak sürümü ve nullable ünite etiketini ekler;
mevcut kayıtları silmez. Ortak tesis durumu kullanan entegrasyon testleri sırayla
çalıştırılır.
