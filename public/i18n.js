const messages = {
  aiOpen:["AI sohbetini aç veya kapat", "Toggle AI chat"],
  aiClose:["AI sohbetini kapat", "Close AI chat"],
  aiChatLabel:["KAYIT VE DEVİR DESTEĞİ", "ENTRY & HANDOVER SUPPORT"],
  aiConversation:["AI sohbeti", "AI conversation"],
  aiChatWelcome:["Olayı yaz veya formdaki kaydı al. Kaydı birlikte inceleyelim; eksik bilgileri sonraki mesajında ekleyebilirsin.", "Describe an event or import your draft. Review it together and add missing details in your next message."],
  aiChatReady:["Olayını yazıp gönder. AI önerilerini kontrol ettikten sonra forma aktarabilirsin.", "Send an event description. Review AI suggestions before applying them to the form."],
  aiImport:["Formdaki kaydı al", "Import form draft"],
  aiClear:["Sohbeti temizle", "Clear chat"],
  aiMessage:["Olay veya ek bilgi", "Event or additional information"],
  aiPlaceholder:["Örn. GT1 ünitesinde titreşim artışı gözlendi…", "E.g. Increased vibration was observed on GT1…"],
  aiSend:["Gönder", "Send"],
  aiKeyboard:["Ctrl / ⌘ + Enter ile gönder", "Ctrl / ⌘ + Enter to send"],
  aiYou:["Sen", "You"],
  aiUseText:["Analiz edilen metni de forma aktar", "Also replace form text with the analyzed record"],
  aiReplaceChat:["Formdaki kaydı almak mevcut sohbeti ve yazdığın mesajı temizler. Devam edilsin mi?", "Importing the form draft clears this conversation and your message. Continue?"],
  aiClearConfirm:["Bu sohbet temizlensin mi? Formdaki kayıt değişmez.", "Clear this conversation? Your form draft will be kept."],
  aiImported:["Formdaki kayıt alındı. Düzenleyip gönderebilirsin.", "Form draft imported. Edit and send it."],
  aiNeedMessage:["Önce olayını veya ek bilgiyi yaz.", "Enter an event or additional information first."],
  aiChatLimit:["Bu sohbetin kayıt metni 4.000 karakteri aşıyor. Metni kısalt veya yeni sohbet başlat.", "The combined record exceeds 4,000 characters. Shorten the message or start a new conversation."],
  aiChatRestored:["Kaydedilmemiş sohbet metnin geri getirildi. Öneri almak için yeniden gönder.", "Your unsaved conversation text was restored. Send again to request suggestions."],
  aiTitle:["AI kayıt yardımcısı", "AI entry assistant"],
  aiDisclosure:["Gönderdiğin kayıt metni, bu sohbetteki önceki bilgiler ve varsa başlık OpenAI’a iletilir. Fotoğraflar gönderilmez.", "Sending shares the record text, earlier details in this conversation, and any imported title with OpenAI. Photos are not sent."],
  aiAnalyze:["AI ile analiz et", "Analyze with AI"],
  aiAnalyzing:["AI analiz ediyor…", "AI is analyzing…"],
  aiChecking:["AI kullanılabilirliği kontrol ediliyor…", "Checking AI availability…"],
  aiDisabled:["AI henüz kullanıma açılmadı. Kaydını normal şekilde ekleyebilirsin.", "AI is not enabled yet. You can still add your entry normally."],
  aiReady:["İstersen yazdığın kayıttan öneri al. Alanlar sen onaylamadan değişmez.", "Optionally analyze your text. Fields change only after you approve."],
  aiNeedDescription:["Önce analiz edilecek açıklamayı yaz.", "Enter a description to analyze first."],
  aiReview:["Önerileri ve gerekçelerini kontrol et. Eksik bilgileri ekleyebilirsin.", "Review the suggestions and reasoning. You can add the missing information."],
  aiKeyInvalid:["AI API anahtarı geçersiz veya iptal edilmiş. Sunucudaki OPENAI_API_KEY ayarını kontrol et.", "The AI API key is invalid or revoked. Check OPENAI_API_KEY on the server."],
  aiAccessDenied:["AI erişimi reddedildi. API projesinin ve modelin erişim izinlerini kontrol et.", "AI access was denied. Check API project and model permissions."],
  aiQuota:["OpenAI API bakiyesi veya kullanım limiti yetersiz. API faturalandırmasını kontrol et; ChatGPT aboneliği ayrı çalışır.", "OpenAI API credit or spending limit is insufficient. Check API billing; a ChatGPT subscription is separate."],
  aiProviderRateLimit:["AI sağlayıcısının istek limiti doldu. Biraz bekleyip tekrar dene.", "The AI provider rate limit was reached. Wait before trying again."],
  aiModelUnavailable:["AI modeli bulunamadı veya hesabın bu modele erişemiyor. Sunucudaki OPENAI_MODEL ayarını kontrol et.", "The AI model was not found or is unavailable to this account. Check OPENAI_MODEL on the server."],
  aiConfiguration:["AI sağlayıcısı istek ayarlarını kabul etmedi. OPENAI_MODEL ve yapılandırılmış yanıt desteğini kontrol et.", "The AI provider rejected the request configuration. Check OPENAI_MODEL and structured output support."],
  aiTimeout:["AI yanıtı zaman aşımına uğradı. Biraz sonra tekrar dene.", "The AI request timed out. Try again later."],
  aiConnection:["Sunucu AI sağlayıcısına bağlanamadı. İnternet, proxy veya güvenlik duvarı ayarlarını kontrol et.", "The server could not connect to the AI provider. Check network, proxy, or firewall settings."],
  aiInvalidResponse:["AI yanıtı doğrulamadan geçemedi. Tekrar deneyebilir veya kaydını normal şekilde ekleyebilirsin.", "The AI response failed validation. Retry or save your entry normally."],
  aiIncomplete:["AI yanıtı tamamlanmadan kesildi. Tekrar dene; sürerse model ayarını kontrol et.", "The AI response was incomplete. Retry; if it persists, check the model configuration."],
  aiRefused:["AI bu kaydı analiz etmeyi reddetti. Kaydını normal şekilde ekleyebilirsin.", "AI declined to analyze this record. You can save your entry normally."],
  aiRateLimit:["15 dakikada en fazla 10 AI analizi yapılabilir. Daha sonra tekrar dene.", "Up to 10 AI analyses are allowed per 15 minutes. Try again later."],
  aiBusy:["AI şu anda diğer istekleri işliyor. Biraz sonra tekrar dene.", "AI is processing other requests. Try again shortly."],
  aiFailed:["AI analizi tamamlanamadı. Daha sonra tekrar dene veya kaydını normal şekilde ekle.", "AI analysis could not be completed. Try again later or save your entry normally."],
  aiStale:["Metin veya dil değişti. Güncel kayıt için yeniden analiz et.", "The text or language changed. Analyze the updated entry again."],
  aiApplied:["Seçili öneriler forma uygulandı. Kontrol edip kaydet.", "Selected suggestions applied to the form. Review and save."],
  aiDismissed:["Öneriler kullanılmadı. Formdaki alanlar korundu.", "Suggestions dismissed. Your form fields were kept."],
  aiNotice:["AI karar desteğidir; hatalı olabilir. Ekipman kontrolü yapmaz. Son karar operatöründür.", "AI provides decision support and may be wrong. It does not control equipment. The operator makes the final decision."],
  aiSelect:["Forma uygulanacak öneriler", "Suggestions to apply to the form"],
  aiApply:["Seçili önerileri forma uygula", "Apply selected suggestions"],
  aiDismiss:["Önerileri kullanma", "Dismiss suggestions"],
  aiSaveHint:["Uygulamak kaydetmez. Alanları kontrol edip Kaydet’e bas.", "Applying does not save the entry. Review the fields and select Save."],
  aiCategory:["Olay kategorisi", "Event category"],
  aiReviewPriority:["Önerilen inceleme önceliği", "Suggested review priority"],
  aiReason:["Gerekçe", "Reasoning"],
  aiUncertainty:["Belirsizlikler", "Uncertainties"],
  aiEvidence:["Kaydından alıntılar", "Quotes from your entry"],
  aiQuestions:["Eklenebilecek bilgiler", "Information to add"],
  aiNoQuestions:["Ek bilgi sorusu önerilmedi.", "No additional questions suggested."],
  aiUnknown:["Belirsiz — operatör değerlendirmeli", "Unclear — operator review needed"],
  aiCategoryVIBRATION:["Titreşim", "Vibration"],
  aiCategoryTEMPERATURE:["Sıcaklık", "Temperature"],
  aiCategoryPRESSURE:["Basınç", "Pressure"],
  aiCategoryLEAK:["Kaçak / sızıntı", "Leak"],
  aiCategoryELECTRICAL:["Elektrik", "Electrical"],
  aiCategoryMAINTENANCE:["Bakım", "Maintenance"],
  aiCategoryOTHER:["Diğer", "Other"],
  aiCategoryUNKNOWN:["Belirsiz", "Unclear"],
  noOperationResults:["Bu filtrelere uygun kayıt bulunamadı.","No entries match these filters."],
  choosePhotos:["Dosyadan fotoğraf seç","Choose photo files"],
  summary:["Vardiya devralma özeti","Shift handover overview"],summaryHint:["Ünite durumları ve tüm açık kayıtların özeti. Aşağıda en fazla 5 önemli kayıt ve son 5 olay/not listelenir.","Unit status and all open-item counts. Up to 5 important items and 5 recent events/notes are listed below."],summaryOpen:["Açık kayıt","Open items"],summaryImportant:["Önemli uyarı","Important items"],summaryValves:["Aktif vana kaydı","Active valve items"],summaryTasks:["Devam eden iş","Ongoing work"],summaryRecent:["Son olaylar / notlar","Recent events / notes"],summaryRead:["Devir özetini okudum","I have read this handover overview"],summaryReadDone:["Bu özet {date} tarihinde onaylandı.","This overview was acknowledged at {date}."],summaryChanged:["Özet son onayından sonra güncellendi. Yeni bilgileri incele.","The overview has changed since your acknowledgement. Review the new information."],summaryStart:["Devri onaylamak için önce vardiyanı başlat.","Start your shift before acknowledging the overview."],summarySaved:["Devir özeti okuma kaydın saklandı.","Your overview acknowledgement was recorded."],viewBoard:["Tüm açık kayıtlara git","View all open items"],noImportant:["Önemli açık kayıt yok.","No important open items."],summaryLoading:["Devir özeti yükleniyor…","Loading handover overview…"],
  quickAdd:["Hızlı kayıt","Quick entry"],quickEvent:["Olay ekle","Add event"],quickValve:["Vana kaydı","Valve entry"],quickTask:["Devam eden iş","Ongoing work"],quickAttention:["Dikkat konusu","Attention item"],unit:["İlgili ünite","Related unit"],general:["Genel / ortak","General / shared"],allUnits:["Tüm üniteler","All units"],allKinds:["Tüm kayıt türleri","All entry types"],allStatuses:["Açık ve kapalı","Open and closed"],searchRecords:["Kayıtlarda ara","Search records"],searchText:["Başlık, açıklama veya kapanış notu","Title, description or closing note"],searchHint:["Arama açık ve kapalı tüm kayıtlarda yapılır. Mevcut kayıtlar ünite seçilmemişse Genel olarak görünür.","Search covers open and closed records. Older records without a unit are listed as General."],takePhoto:["Fotoğraf çek","Take photo"],removePhoto:["Fotoğrafı kaldır","Remove photo"],selectedPhotos:["{count}/3 fotoğraf seçildi","{count}/3 photos selected"],draftHint:["Bu kayıt henüz kaydedilmedi.","This entry has not been saved yet."],discardDraft:["Kaydedilmemiş bir kayıt, fotoğraf veya AI sohbeti var. Kaydetmeden çıkmak istiyor musun?","You have an unsaved entry, photo, or AI conversation. Leave without saving?"],draftRestored:["Önceki oturumunda kaydedilmemiş notun geri getirildi. Kontrol edip kaydedebilirsin.","Your unsaved entry from the interrupted session was restored. Review and save it."],expiredDraft:["Oturumun sona erdi. Kaydedilmemiş notun bu sayfada tutuluyor; aynı hesapla giriş yaparak devam edebilirsin.","Your session expired. Your unsaved entry is kept in this page; sign in with the same account to continue."],

  chooseLanguage:["Dil seç","Choose language"],darkTheme:["Koyu tema","Dark theme"],
  brand:["Vardiya Defteri","Shift Logbook"], tagline:["VARDİYA VE DEVİR TAKİBİ","SHIFT & HANDOVER TRACKING"],
  storyTitle:["Her vardiya, eksiksiz bir devir.","Every shift. A complete handover."],storyText:["Ünitelerin durumunu takip et. Olayları kaydet. Devam eden işleri bir sonraki vardiyaya aktar.","Track unit status, record events, and pass ongoing work to the next shift."],
  loginTitle:["Tekrar hoş geldin.","Welcome back."],loginDescription:["Vardiya ve devir kayıtlarına erişmek için giriş yap.","Sign in to access shift and handover records."],signupTitle:["Birlikte başlayalım.","Let's get started."],signupDescription:["Kendi hesabını oluştur.","Create your account."],name:["Ad soyad","Full name"],email:["E-posta adresi","Email address"],password:["Şifre","Password"],passwordHint:["En az 12 karakter kullan.","Use at least 12 characters."],login:["Giriş yap","Sign in"],signup:["Hesap oluştur","Create account"],noAccount:["Henüz hesabın yok mu?","Don't have an account?"],hasAccount:["Zaten hesabın var mı?","Already have an account?"],show:["Göster","Show"],hide:["Gizle","Hide"],showPassword:["Şifreyi göster","Show password"],hidePassword:["Şifreyi gizle","Hide password"],logout:["Çıkış yap","Sign out"],dark:["Koyu mod","Dark mode"],light:["Açık mod","Light mode"],darkLabel:["Koyu moda geç","Switch to dark mode"],lightLabel:["Açık moda geç","Switch to light mode"],
  workspace:["ÇALIŞMA ALANIN","YOUR WORKSPACE"],greeting:["Merhaba, {name}.","Hello, {name}."],intro:["Vardiyanı takip et, önemli bilgileri sonraki ekibe aktar.","Track your shift and keep the next team informed."],currentStatus:["ŞU ANKİ DURUMUN","YOUR CURRENT STATUS"],loading:["Yükleniyor…","Loading…"],checking:["Vardiyan kontrol ediliyor…","Checking your shift…"],checkHint:["Durumunu tekrar kontrol edebilirsin.","You can check your status again."],active:["Vardiya aktif","Shift active"],inactive:["Vardiya kapalı","No active shift"],shiftActiveTitle:["Vardiyan devam ediyor.","Your shift is in progress."],shiftReady:["Yeni bir vardiyaya hazır mısın?","Ready for a new shift?"],shiftActiveHint:["Önemli gelişmeleri devir paneline kaydet.","Record important updates in the handover panel."],shiftReadyHint:["Tarih ve saat aralığını seçerek vardiyanı başlat.","Select the date and time slot to start your shift."],shiftDate:["Vardiya tarihi","Shift date"],shiftHours:["Vardiya saatleri","Shift hours"],overnight:["16:00–00:00 vardiyası ertesi gün biter.","The 16:00–00:00 shift ends on the next day."],startShift:["Vardiyayı başlat","Start shift"],endShift:["Vardiyayı bitir","End shift"],checkStatus:["Durumu kontrol et","Check status"],processing:["İşleniyor…","Processing…"],recordedAutomatically:["Başlangıç ve bitiş otomatik kaydedilir.","Start and end times are recorded automatically."],shiftStarted:["Vardiyan başladı. Kolay gelsin!","Your shift has started."],shiftEnded:["Vardiyan tamamlandı. Açık işler devir panelinde kalır.","Your shift is complete. Open items remain on the handover board."],
  equipment:["Ünite durumları","Unit status"],equipmentHint:["GT1 ve GT2: gaz türbini · ST: buhar türbini","GT1 and GT2: gas turbines · ST: steam turbine"],UNKNOWN:["Belirtilmedi","Not reported"],ACTIVE:["Devrede","In service"],INACTIVE:["Devre dışı","Out of service"],MAINTENANCE:["Bakımda","Under maintenance"],update:["Güncelle","Update"],status:["Durum","Status"],equipmentNote:["Durum notu","Status note"],save:["Kaydet","Save"],cancel:["Vazgeç","Cancel"],updated:["Ünite durumu kaydedildi.","Unit status saved."],neverUpdated:["Henüz durum girilmedi.","No status has been reported yet."],
  board:["Sonraki vardiyaya devir","Handover to the next shift"],boardHint:["Bu ortak paneldeki kayıtlar kapatılana kadar tüm vardiyalarda görünür.","Items on this shared board remain visible across shifts until closed."],openItems:["Açık kayıtlar","Open items"],refresh:["Yenile","Refresh"],noOpen:["Açık devir kaydı yok.","No open handover items."],EVENT:["Olay","Event"],NOTE:["Not","Note"],VALVE:["Aktif vana","Active valve"],ATTENTION:["Dikkat edilecek konu","Attention required"],TASK:["Devam eden iş","Ongoing work"],NORMAL:["Normal","Normal"],HIGH:["Önemli","Important"],newEntry:["Olay / devir kaydı ekle","Add event / handover item"],entryHint:["Vana, dikkat konusu ve işler kapanana kadar devir panelinde kalır. Olaylar ve notlar geçmişe kaydedilir.","Valves, attention items and work stay on the handover board until closed. Events and notes are saved in history."],kind:["Kayıt türü","Entry type"],priority:["Önem derecesi","Priority"],title:["Başlık","Title"],description:["Açıklama / not","Description / note"],photos:["Fotoğraf ekle","Add photos"],photoHint:["En fazla 3 fotoğraf · Her biri en fazla 5 MB · JPEG, PNG veya WebP","Up to 3 photos · Maximum 5 MB each · JPEG, PNG or WebP"],entrySaved:["Kayıt eklendi. Sonraki vardiya da görebilir.","Entry saved and visible to the next shift."],closeItem:["Kaydı kapat","Close item"],closeNote:["Kapanış notu","Closing note"],closeHint:["Tamamlanan işi veya sona eren durumu açıklayabilirsin.","Describe the completed work or resolved condition."],itemClosed:["Kayıt kapatıldı ve geçmişe taşındı.","Item closed and retained in history."],closed:["Kapalı","Closed"],open:["Açık","Open"],closedBy:["Kapatan: {name} · {date}","Closed by: {name} · {date}"],viewPhoto:["Fotoğraf {number}","Photo {number}"],photo:["Kayıt fotoğrafı","Entry photo"],close:["Kapat","Close"],
  operationHistory:["Olaylar ve devir geçmişi","Events and handover history"],noEntries:["Henüz olay veya not eklenmedi.","No events or notes yet."],shiftHistory:["Vardiya geçmişi","Shift history"],historyHint:["Kayıtlarını incele veya Excel olarak indir.","Review your records or download an Excel file."],export:["Excel’e aktar","Export to Excel"],from:["Başlangıç tarihi","Start date"],to:["Bitiş tarihi","End date"],records:["Kayıtlar","Records"],own:["Kendi vardiyalarım","My shifts"],all:["Tüm personel","All staff"],apply:["Uygula","Apply"],clear:["Temizle","Clear"],allDates:["Tüm tarihler gösteriliyor. Saatler İstanbul saatidir.","Showing all dates. Times are in Europe/Istanbul."],filterNote:["{from} → {to} · Vardiya başlangıcına göre · İstanbul saati","{from} → {to} · By shift start · Istanbul time"],firstRecord:["İlk kayıttan","From the first record"],lastRecord:["Son kayda kadar","To the last record"],scroll:["Tüm sütunları görmek için tabloyu yana kaydırabilirsin.","Scroll the table sideways to see all columns."],noShift:["Henüz bir vardiya kaydı yok.","No shift records yet."],noShiftHint:["İlk kaydını oluşturmak için yukarıdan vardiyanı başlat.","Start your first shift using the button above."],noResults:["Bu tarih aralığında kayıt bulunamadı.","No records in this date range."],noResultsHint:["Tarih aralığını değiştir veya filtreleri temizle.","Change the date range or clear the filters."],shift:["Vardiya","Shift"],staff:["Personel","Staff member"],actualStart:["Gerçek başlangıç","Actual start"],actualEnd:["Gerçek bitiş","Actual end"],inProgress:["Devam ediyor","In progress"],completed:["Tamamlandı","Completed"],unspecified:["Belirtilmemiş","Not specified"],previous:["Önceki","Previous"],next:["Sonraki","Next"],pageLabel:["{from}–{to} / {total} kayıt","{from}–{to} of {total} records"],zero:["0 kayıt","0 records"],exportLimit:["Excel seçili tarih aralığını kapsar · En fazla 5.000 vardiya","Excel includes the selected date range · Maximum 5,000 shifts"],WORKER:["Çalışan","Worker"],SUPERVISOR:["Sorumlu","Supervisor"],MANAGER:["Yönetici","Manager"],
  loginProgress:["Giriş yapılıyor…","Signing in…"],signupProgress:["Hesabın oluşturuluyor…","Creating your account…"],signupDone:["Hesabın oluşturuldu. Şimdi giriş yapabilirsin.","Account created. You can now sign in."],signedOut:["Çıkış yapıldı.","Signed out."],connection:["Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.","Unable to reach the server. Check your connection and try again."],expired:["Oturumun sona erdi. Lütfen tekrar giriş yap.","Your session expired. Please sign in again."],failed:["İşlem tamamlanamadı. Tekrar dene.","The request could not be completed. Please try again."],applyFirst:["Seçtiğin filtreyi görmek ve Excel’e aktarmak için Uygula’ya bas.","Select Apply to view and export the chosen filters."],invalidRange:["Bitiş tarihi başlangıçtan önce olamaz.","End date cannot be before start date."],historyFailed:["Kayıtlar yüklenemedi. Uygula ile tekrar dene.","Records could not be loaded. Select Apply to retry."],exporting:["Excel dosyan hazırlanıyor…","Preparing your Excel file…"],exportReady:["Excel dosyan hazır. İndirme başlatıldı.","Your Excel file is ready. Download started."],photoLimit:["En fazla 3 fotoğraf, fotoğraf başına en fazla 5 MB yükleyin.","Upload up to 3 photos, maximum 5 MB per photo."],saveProgress:["Kaydediliyor…","Saving…"]
};
const errors = {
  "Geçersiz filtre parametresi.":"Invalid search filters.",
  "Geçersiz özet sürümü.":"Invalid overview revision.",
  "Devir özeti değişti. Güncel özeti inceleyip tekrar onaylayın.":"The overview changed. Review the latest overview and acknowledge it again.",
  "Devri onaylamadan önce vardiyanızı başlatın.":"Start your shift before acknowledging the overview.",
  "Email veya şifre hatalı":"Invalid email or password", "Bu email adresi zaten kullanımda.":"This email address is already registered.",
  "Geçerli e-posta ve şifre gerekli.":"A valid email and password are required.",
  "Geçerli e-posta, isim (1–100 karakter) ve şifre (en az 12 karakter, en çok 256 bayt) gerekli.":"Enter a valid email, name (1–100 characters) and password (at least 12 characters, at most 256 bytes).",
  "Zaten açık bir vardiyanız var":"You already have an active shift.","Sonlandırılacak aktif bir vardiya bulunamadı.":"No active shift to end.",
  "Geçerli vardiya tarihi ve saat aralığı gerekli.":"Enter a valid shift date and time slot.",
  "Çok fazla deneme. Lütfen daha sonra tekrar deneyin.":"Too many requests. Please try again later.","Sunucu hatası oluştu.":"A server error occurred.",
  "Tüm personeli görmek için yönetici yetkisi gerekli.":"Manager permission is required to view all staff.","Metin alanlarını kontrol edin.":"Check the text fields.","Geçerli bir kayıt türü seçin.":"Select a valid entry type.","Ekipman durumunu kontrol edin.":"Check the equipment status.",
  "Kayıt başka bir kullanıcı tarafından güncellendi. Yenileyip tekrar deneyin.":"Another user updated this record. Refresh and try again.","Kayıt bulunamadı veya zaten kapatıldı.":"The item was not found or has already been closed.","Fotoğraf bulunamadı.":"Photo not found.",
  "Yalnızca JPEG, PNG veya WebP fotoğraf yükleyin.":"Upload JPEG, PNG or WebP images only.","Fotoğraf okunamadı. Geçerli JPEG, PNG veya WebP seçin.":"Unable to read the photo. Select a valid JPEG, PNG or WebP image.","En fazla 3 fotoğraf, fotoğraf başına en fazla 5 MB yükleyin.":"Upload up to 3 photos, maximum 5 MB per photo.",
  "Geçerli bir tarih aralığı seçin (YYYY-AA-GG).":"Select a valid date range (YYYY-MM-DD).", "En fazla 5000 vardiya aktarılabilir. Tarih aralığını daraltın.":"Export is limited to 5,000 shifts. Narrow the date range."
};
let language = "tr";
try { if (localStorage.getItem("vardiya-language") === "en") language = "en"; } catch {}
export const locale = () => language === "en" ? "en-GB" : "tr-TR";
export const lang = () => language;
export function t(key, vars = {}) {
  let value = messages[key]?.[language === "en" ? 1 : 0] || key;
  for (const [name, text] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(text));
  return value;
}
export const apiError = message => language === "en" ? errors[message] || t("failed") : message;
function apply() {
  document.documentElement.lang = language;
  document.title = t("brand");
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-label]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nLabel)));
  document.querySelectorAll("[data-language]").forEach(select => {
    select.value = language;
    select.setAttribute("aria-label", t("chooseLanguage"));
    select.closest(".language-control").title = `${t("chooseLanguage")} · ${language === "en" ? "English" : "Türkçe"}`;
  });
}
export function initializeLanguage() {
  apply();
  document.querySelectorAll("[data-language]").forEach(select => select.addEventListener("change", () => {
    language = select.value === "en" ? "en" : "tr";
    try { localStorage.setItem("vardiya-language", language); } catch {}
    apply(); window.dispatchEvent(new Event("languagechange"));
  }));
}
window.appI18n = { t };
