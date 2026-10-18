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
