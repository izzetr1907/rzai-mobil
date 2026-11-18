# rzAI Mobil — iPhone'da internetsiz yapay zeka

rzAI Mobil, yapay zekayı **doğrudan iPhone'un içinde** (Safari + WebGPU) çalıştırır.
- ❌ Bilgisayar gerekmez, ❌ Mac gerekmez, ❌ App Store gerekmez, ❌ API anahtarı yok
- ✅ Model bir kere indirildikten sonra **uçak modunda bile** çalışır
- ✅ Sohbetler sadece telefonunda saklanır, hiçbir yere gönderilmez

> Neden bir web sitesine koymamız gerekiyor? iPhone'a App Store dışından uygulama yüklemenin Mac'siz tek yolu **PWA**'dır (Ana Ekrana Eklenen web uygulaması). Safari bunun için uygulamanın **bir kere HTTPS adresinden** açılmasını ister. Sonrasında her şey telefonda kalır, internet gerekmez.

## Gereksinimler
| | |
|---|---|
| 📱 iOS | **iOS 26 veya üstü** (WebGPU varsayılan açık). iOS 18'de: Ayarlar → Safari → Gelişmiş → Özellik Bayrakları → **WebGPU** açılabilir (deneysel). |
| ⚡ iPhone | **iPhone 12 veya daha yeni** önerilir (iPhone 15 Pro / 16 / 17 çok daha hızlı) |
| 💾 Boş alan | Model başına 0.3 – 1 GB |
| 🌐 İnternet | Sadece **ilk kurulumda** (siteyi açmak + modeli indirmek için) |

---

## 1) Siteyi ücretsiz yayınla (bir kere yapılır)

Bu klasör hazır bir statik sitedir; derleme gerekmez. Üç seçenek var, **en kolayı A**:

### A) Netlify Drop — en kolay (2 dakika, kod/git yok) ⭐
1. Bilgisayarda (Windows olur) `rzAI-Mobil.zip`'i çıkar → içinden **`rzai-mobil`** klasörü çıkar.
2. https://app.netlify.com/drop adresine git.
3. `rzai-mobil` klasörünü sayfaya **sürükle-bırak**.
4. Ücretsiz hesap oluştur/giriş yap (Google ile olur) ki site kalıcı olsun.
5. Sana `https://xxxx.netlify.app` gibi bir adres verir. İstersen *Site settings → Change site name* ile `rzai-izzet.netlify.app` yap.

### B) GitHub Pages (ücretsiz, telefondan bile yapılabilir)
1. https://github.com adresinde ücretsiz hesap aç → **New repository** → adı `rzai-mobil`, **Public** → Create.
2. **uploading an existing file** linkine tıkla → `rzai-mobil` klasörünün **içindeki** tüm dosya ve klasörleri sürükle (index.html en üstte olmalı) → **Commit changes**.
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.
4. 1-2 dakika sonra adresin: `https://<kullanici-adin>.github.io/rzai-mobil/`

### C) Render (ücretsiz statik site)
1. Dosyaları B'deki gibi bir GitHub reposuna yükle (`render.yaml` repo kökünde olmalı).
2. https://dashboard.render.com → **New → Blueprint** → repoyu seç → **Apply**.
   (veya **New → Static Site** → repo → Build Command: `echo ok`, Publish Directory: `.`)
3. Adres: `https://rzai-mobil.onrender.com`

---

## 2) iPhone'a kur (Ana Ekrana Ekle)
1. iPhone'da **Safari**'yi aç (Chrome değil!) ve sitenin adresine git.
2. Alttaki **Paylaş** düğmesine (□↑) bas → aşağı kaydır → **Ana Ekrana Ekle** → **Ekle**.
3. Ana ekranda **rzAI** simgesi belirir. Bundan sonra hep **bu simgeden** aç.

## 3) İlk açılış: modeli indir
1. rzAI simgesine dokun. Model seçme ekranı gelir:
   - **Qwen2.5 1.5B** (~1 GB) — önerilen, Türkçesi en iyi
   - **Qwen2.5 0.5B** (~300 MB) — en hızlı, eski/zayıf iPhone'lar için
   - **Llama 3.2 1B** (~700 MB) — İngilizcede güçlü
2. **Wi-Fi'ye bağlıyken** **İndir ve başlat**'a bas. İlerleme çubuğu yüzdeyi gösterir.
3. İndirme bitene kadar uygulamayı açık tut, ekranı kilitleme (yarıda kalırsa tekrar aç, kalan kısmı indirir).
4. "Ekran kartı hazırlanıyor" adımından sonra sohbet ekranı açılır. 🎉

## 4) İnternetsiz kullan
- Artık **uçak modunda** bile rzAI simgesinden aç: uygulama ve model telefondan yüklenir.
- Sağ üstte **✈︎ internetsiz** yazısını görürsün.
- Model değiştirmek / silmek / yer açmak için: sol menü → **Ayarlar & modeller**.

## Sorun giderme
| Sorun | Çözüm |
|---|---|
| "Bu cihaz desteklenmiyor" | iOS'u güncelle (iOS 26+). Safari ile açtığından emin ol. |
| İndirme sonrası "belleği yetmedi" | **Qwen2.5 0.5B** modelini seç; diğer uygulamaları kapat. |
| Uygulama çok yavaş | Küçük modele geç. İlk mesaj (ısınma) her zaman biraz yavaştır. |
| Model tekrar indiriliyor | Siteyi Safari sekmesinden değil, **Ana Ekran simgesinden** kullan (iOS, kullanılmayan web sitelerinin verisini bir süre sonra silebilir; Ana Ekran uygulamaları bundan korunur). |
| Güncelleme gelmedi | Uygulamayı tamamen kapatıp iki kez aç. |

## Neler yapabilir / yapamaz
- ✅ Sohbet, kod yazma (kopyala düğmeli kod blokları), metin yazma, çeviri, özet, fikir üretme
- ❌ İnternette arama, APK/EXE derleme, dosya/komut çalıştırma (bunlar için bilgisayardaki **rzAI** sürümünü kullan)
- ⚠️ Telefon modelleri küçüktür (0.5–1.5 milyar parametre): basit işlerde iyidir ama hata yapabilir, önemli bilgileri kontrol et.

## Teknik bilgi
- Motor: [WebLLM](https://github.com/mlc-ai/web-llm) 0.2.89 (`vendor/web-llm.js`, yerelde paketli, CDN yok), WebGPU, Web Worker
- Model dosyaları ilk seferde Hugging Face'ten (`huggingface.co/mlc-ai`), çalışma kodu (wasm) GitHub'dan indirilir ve tarayıcının **Cache API**'sinde saklanır
- Uygulama kabuğu `sw.js` service worker'ı ile önbelleğe alınır
- Sohbetler ve ayarlar: `localStorage` (sadece bu cihazda)
- Önizleme (WebGPU olmadan arayüzü görmek için): adresin sonuna `?onizleme` ekle
