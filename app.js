/* rzAI Mobil — tamamen cihazda calisan yapay zeka (WebLLM + WebGPU) */
import * as webllm from "./vendor/web-llm.js";

const VERSION = "1.0.0";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const PREVIEW = new URLSearchParams(location.search).has("onizleme"); // WebGPU olmadan arayuz onizlemesi

const MODELS = [
  {key:"qwen15", name:"Qwen2.5 1.5B", desc:"Önerilen · Türkçesi en iyi", size:"~1 GB",
   f16:"Qwen2.5-1.5B-Instruct-q4f16_1-MLC", f32:"Qwen2.5-1.5B-Instruct-q4f32_1-MLC"},
  {key:"qwen05", name:"Qwen2.5 0.5B", desc:"En hızlı · eski iPhone'lar için", size:"~300 MB",
   f16:"Qwen2.5-0.5B-Instruct-q4f16_1-MLC", f32:"Qwen2.5-0.5B-Instruct-q4f32_1-MLC"},
  {key:"llama1b", name:"Llama 3.2 1B", desc:"Meta · İngilizcede güçlü", size:"~700 MB",
   f16:"Llama-3.2-1B-Instruct-q4f16_1-MLC", f32:"Llama-3.2-1B-Instruct-q4f32_1-MLC"},
];
const APP_CONFIG = {...webllm.prebuiltAppConfig, useIndexedDBCache: false}; // Cache API'de sakla
const SYSTEM = name => `Sen rzAI'sin: ${name} adlı kullanıcının telefonunda internetsiz çalışan yardımsever bir yapay zeka asistanısın. ` +
  `Her zaman Türkçe cevap ver (kullanıcı başka dil istemedikçe). Kısa, net ve doğru ol. Kod yazarken markdown kod blokları kullan. ` +
  `İnternete erişimin yok; güncel bilgi gerekiyorsa bunu açıkça söyle.`;

const state = {
  settings: Object.assign({name:"İzzet", model:"qwen15", temp:0.6}, JSON.parse(localStorage.getItem("rzm_settings") || "{}")),
  chats: JSON.parse(localStorage.getItem("rzm_chats") || "[]"),
  chatId: null, engine: null, loadedId: null, f16: true, busy: false, stopReq: false,
};
const saveSettings = () => localStorage.setItem("rzm_settings", JSON.stringify(state.settings));
function saveChats() {
  state.chats = state.chats.slice(0, 60);
  try { localStorage.setItem("rzm_chats", JSON.stringify(state.chats)); }
  catch { state.chats = state.chats.slice(0, 20); localStorage.setItem("rzm_chats", JSON.stringify(state.chats)); }
}
const modelOf = key => MODELS.find(m => m.key === key) || MODELS[0];
const modelId = key => { const m = modelOf(key); return state.f16 ? m.f16 : m.f32; };

/* ---------------- markdown ---------------- */
marked.setOptions({gfm:true, breaks:true});
marked.use({renderer:{ code(code, info) {
  if (typeof code === "object") { info = code.lang; code = code.text; }
  const lang = (info || "").split(/\s+/)[0];
  return `<pre><code class="language-${esc(lang || "plaintext")}">${esc(code)}</code></pre>`;
}}});
function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(() => legacyCopy(t));
  return legacyCopy(t);
}
function legacyCopy(t) {
  const ta = document.createElement("textarea"); ta.value = t; document.body.append(ta); ta.select();
  try { document.execCommand("copy"); } finally { ta.remove(); }
  return Promise.resolve();
}
function renderMD(el, text, streaming = false) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(text || ""));
  el.querySelectorAll("pre > code").forEach(code => {
    const lang = ([...code.classList].find(c => c.startsWith("language-")) || "").replace("language-", "");
    try { if (lang && hljs.getLanguage(lang)) code.innerHTML = hljs.highlight(code.textContent, {language:lang}).value; else hljs.highlightElement(code); } catch {}
    const head = document.createElement("div"); head.className = "code-head";
    head.innerHTML = `<span>${esc(lang && lang !== "plaintext" ? lang : "kod")}</span><button type="button">Kopyala</button>`;
    const btn = head.querySelector("button");
    btn.onclick = () => copyText(code.textContent).then(() => { btn.textContent = "Kopyalandı ✓"; setTimeout(() => btn.textContent = "Kopyala", 1400); });
    code.parentElement.prepend(head);
  });
  if (streaming) (el.lastElementChild || el).classList.add("cursor");
}

/* ---------------- mesajlar ---------------- */
const msgs = $("#messages"), scroller = $("#scroller"), input = $("#input");
let stick = true;
scroller.addEventListener("scroll", () => { stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80; });
const toBottom = f => { if (stick || f) scroller.scrollTop = scroller.scrollHeight; };
const setHasMsgs = () => document.body.classList.toggle("has-msgs", msgs.children.length > 0);
function addUser(text) {
  const d = document.createElement("div"); d.className = "msg user";
  d.innerHTML = `<div class="bubble">${esc(text)}</div>`; msgs.append(d); setHasMsgs(); toBottom(true);
}
function addAssistant(text) {
  const d = document.createElement("div"); d.className = "msg assistant";
  d.innerHTML = `<div class="logo logo-xs"><span>rz</span><i></i></div><div class="body"><div class="md"></div></div>`;
  msgs.append(d); setHasMsgs();
  const md = d.querySelector(".md"); if (text != null) renderMD(md, text);
  return md;
}
function errorBox(text) { const e = document.createElement("div"); e.className = "error-box"; e.textContent = "⚠️ " + text; msgs.append(e); toBottom(true); }

/* ---------------- sohbetler ---------------- */
function renderChatList() {
  const nav = $("#chatList"); nav.innerHTML = "";
  if (!state.chats.length) nav.innerHTML = `<div class="muted small" style="padding:8px 10px">Henüz sohbet yok</div>`;
  for (const c of [...state.chats].sort((a, b) => b.updated - a.updated)) {
    const b = document.createElement("div");
    b.className = "chat-item" + (c.id === state.chatId ? " active" : "");
    b.innerHTML = `<span class="t">${esc(c.title)}</span><button class="del" title="Sil"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>`;
    b.onclick = () => openChat(c.id);
    b.querySelector(".del").onclick = e => { e.stopPropagation(); if (!confirm("Bu sohbet silinsin mi?")) return;
      state.chats = state.chats.filter(x => x.id !== c.id); saveChats(); if (c.id === state.chatId) newChat(); else renderChatList(); };
    nav.append(b);
  }
}
function openChat(id) {
  if (state.busy) return;
  const c = state.chats.find(x => x.id === id); if (!c) return;
  state.chatId = id; msgs.innerHTML = "";
  for (const m of c.messages) m.role === "user" ? addUser(m.content) : addAssistant(m.content);
  setHasMsgs(); closeSide(); renderChatList(); toBottom(true);
}
function newChat() {
  if (state.busy) stop();
  state.chatId = null; msgs.innerHTML = ""; setHasMsgs(); closeSide(); renderChatList(); input.focus();
}
function historyFor(chat) {
  // baglam penceresi 4096 token: son mesajlari ~6000 karaktere sigdir
  const out = []; let total = 0;
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]; total += m.content.length;
    if (total > 6000 && out.length) break;
    out.unshift({role: m.role, content: m.content.slice(-6000)});
  }
  return [{role:"system", content: SYSTEM(state.settings.name)}, ...out];
}

/* ---------------- gonder ---------------- */
async function send() {
  const text = input.value.trim(); if (!text || state.busy) return;
  if (!state.engine) { errorBox(PREVIEW ? "Önizleme modu: model yüklü değil." : "Model henüz yüklenmedi."); return; }
  input.value = ""; autoGrow();
  let chat = state.chats.find(x => x.id === state.chatId);
  if (!chat) { chat = {id: Date.now().toString(36), title: text.slice(0, 40) + (text.length > 40 ? "…" : ""), updated: Date.now(), messages: []};
    state.chats.push(chat); state.chatId = chat.id; }
  chat.messages.push({role:"user", content:text}); chat.updated = Date.now(); saveChats(); renderChatList();
  addUser(text);
  const md = addAssistant();
  md.innerHTML = `<div class="thinking"><span></span><span></span><span></span></div>`;
  setBusy(true); state.stopReq = false;
  let out = "", raf = 0, usage = null;
  const flush = () => { raf = 0; renderMD(md, out, true); toBottom(); };
  try {
    const stream = await state.engine.chat.completions.create({
      messages: historyFor(chat), stream: true, temperature: +state.settings.temp, max_tokens: 1024,
      stream_options: {include_usage: true}});
    for await (const ch of stream) {
      const d = ch.choices?.[0]?.delta?.content || "";
      if (d) { out += d; if (!raf) raf = requestAnimationFrame(flush); }
      if (ch.usage) usage = ch.usage;
    }
  } catch (e) {
    errorBox("Cevap üretilemedi: " + (e?.message || e));
  } finally {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    renderMD(md, out || (state.stopReq ? "_(durduruldu)_" : ""));
    if (usage?.extra?.decode_tokens_per_s) {
      const s = document.createElement("div"); s.className = "stats";
      s.textContent = `${usage.completion_tokens} token · ${usage.extra.decode_tokens_per_s.toFixed(1)} token/sn`;
      md.after(s);
    }
    if (out) { chat.messages.push({role:"assistant", content: out}); chat.updated = Date.now(); saveChats(); }
    setBusy(false); toBottom();
  }
}
function stop() { state.stopReq = true; try { state.engine?.interruptGenerate(); } catch {} }
function setBusy(b) { state.busy = b; document.body.classList.toggle("busy", b); }

function autoGrow() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px"; }
input.addEventListener("input", autoGrow);
input.addEventListener("keydown", e => {
  // telefonda Enter yeni satir; fiziksel klavyede Enter gonderir
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer:fine)").matches) { e.preventDefault(); send(); }
});
$("#composer").addEventListener("submit", e => { e.preventDefault(); state.busy ? stop() : send(); });
document.querySelectorAll(".card").forEach(c => c.onclick = () => { input.value = c.dataset.prompt; autoGrow(); input.focus();
  input.setSelectionRange(input.value.length, input.value.length); });

/* ---------------- yan menu ---------------- */
function closeSide() { document.body.classList.remove("side-open"); }
$("#openSide").onclick = () => document.body.classList.add("side-open");
$("#closeSide").onclick = closeSide; $("#scrim").onclick = closeSide;
$("#newChat").onclick = newChat; $("#topNew").onclick = newChat;

/* ---------------- durum ---------------- */
function setStatus(kind, text) {
  $("#statusLine .dot").className = "dot " + kind; $("#modelDot").className = "dot " + kind;
  $("#statusLine .txt").textContent = text;
}
function updateNet() {
  const b = $("#netBadge");
  if (!navigator.onLine) { b.textContent = "✈︎ internetsiz"; b.className = "offline-badge"; }
  else { b.textContent = state.engine ? "● cihazda" : "● çevrimiçi"; b.className = "offline-badge" + (state.engine ? "" : " warn"); }
}
addEventListener("online", updateNet); addEventListener("offline", updateNet);
function applyName() { $("#greeting").textContent = `Selam ${state.settings.name || "İzzet"}, ne yapalım?`; $("#modelName").textContent = modelOf(state.settings.model).name; }

/* ---------------- model secimi UI ---------------- */
async function renderChoices(container, selected, onPick) {
  container.innerHTML = "";
  for (const m of MODELS) {
    let cached = false;
    try { cached = !PREVIEW && await webllm.hasModelInCache(modelId(m.key), APP_CONFIG); } catch {}
    const b = document.createElement("button"); b.type = "button";
    b.className = "choice" + (m.key === selected ? " sel" : "");
    b.innerHTML = `<span class="radio"></span><span class="ct"><b>${m.name}</b><span>${m.desc}</span></span>
      <span class="tag ${cached ? "" : "dl"}">${cached ? "indirildi ✓" : m.size}</span>`;
    b.onclick = () => { container.querySelectorAll(".choice").forEach(x => x.classList.remove("sel")); b.classList.add("sel"); onPick(m.key); };
    container.append(b);
  }
}

/* ---------------- kurulum / yukleme ---------------- */
function trProgress(r) {
  const t = r.text || "";
  let m;
  if ((m = /(\d+)\s*MB (?:fetched|loaded)/i.exec(t))) return (/cache/i.test(t) && !/fetch/i.test(t) ? "Önbellekten yükleniyor: " : "İndiriliyor: ") + m[1] + " MB";
  if (/cache/i.test(t)) return "Önbellekten yükleniyor…";
  if (/shader|compil|gpu|pipeline/i.test(t)) return "Ekran kartı hazırlanıyor…";
  if (/finish|ready/i.test(t)) return "Hazır!";
  return "Hazırlanıyor…";
}
let pickKey = null;
async function showSetup(key, opts = {}) {
  pickKey = key;
  $("#setup").classList.remove("hidden");
  $("#setupErr").textContent = "";
  $("#progressWrap").classList.add("hidden");
  $("#startBtn").classList.remove("hidden"); $("#modelChoices").classList.remove("hidden");
  $("#setupTitle").textContent = opts.title || "rzAI'yi telefonuna kur";
  $("#setupText").innerHTML = "Yapay zeka modeli <b>bir kere</b> indirilir, sonra <b>internetsiz</b> çalışır. Wi-Fi'ye bağlıyken indirmen önerilir.";
  await renderChoices($("#modelChoices"), key, k => pickKey = k);
}
$("#startBtn").onclick = () => loadModel(pickKey || state.settings.model);

async function loadModel(key) {
  const id = modelId(key);
  let cached = false;
  try { cached = await webllm.hasModelInCache(id, APP_CONFIG); } catch {}
  if (!cached && !navigator.onLine) {
    await showSetup(key); $("#setupErr").textContent = "İlk indirme için internet gerekli. Wi-Fi'ye bağlanıp tekrar dene."; return;
  }
  state.settings.model = key; saveSettings(); applyName();
  $("#setup").classList.remove("hidden");
  $("#startBtn").classList.add("hidden"); $("#modelChoices").classList.add("hidden");
  $("#progressWrap").classList.remove("hidden"); $("#setupErr").textContent = "";
  $("#setupTitle").textContent = cached ? "Model yükleniyor" : "Model indiriliyor";
  $("#setupText").innerHTML = cached ? `${modelOf(key).name} telefonundan yükleniyor…`
    : `${modelOf(key).name} (${modelOf(key).size}) indiriliyor. Bu sadece <b>ilk seferde</b> olur.`;
  $("#bar").style.width = "0%"; $("#progPct").textContent = "%0"; $("#progText").textContent = "Hazırlanıyor…";
  setStatus("warn", "Yükleniyor…");
  try { await navigator.storage?.persist?.(); } catch {}
  const onProg = r => {
    const p = Math.max(0, Math.min(1, r.progress || 0));
    $("#bar").style.width = (p * 100).toFixed(1) + "%"; $("#progPct").textContent = "%" + Math.floor(p * 100);
    $("#progText").textContent = trProgress(r);
  };
  try {
    if (state.engine && state.loadedId !== id) { await state.engine.reload(id); }
    else if (!state.engine) {
      try {
        const w = new Worker(new URL("./worker.js", import.meta.url), {type: "module"});
        state.engine = await webllm.CreateWebWorkerMLCEngine(w, id, {appConfig: APP_CONFIG, initProgressCallback: onProg});
      } catch (we) {
        console.warn("Worker olmadi, ana is parcacigi:", we);
        state.engine = await webllm.CreateMLCEngine(id, {appConfig: APP_CONFIG, initProgressCallback: onProg});
      }
    }
    state.engine.setInitProgressCallback?.(onProg);
    state.loadedId = id;
    $("#setup").classList.add("hidden");
    setStatus("ok", "Hazır · " + modelOf(key).name); updateNet();
  } catch (e) {
    console.error(e);
    state.engine = null; state.loadedId = null;
    setStatus("bad", "Yüklenemedi");
    await showSetup(key, {title: "Bir sorun oldu"});
    const msg = String(e?.message || e);
    $("#setupErr").textContent = /memory|OOM|allocate|device lost/i.test(msg)
      ? "Telefonun belleği bu model için yetmedi. Daha küçük modeli (Qwen2.5 0.5B) seç. (" + msg.slice(0, 120) + ")"
      : "Yüklenemedi: " + msg.slice(0, 200);
  }
}

/* ---------------- ayarlar ---------------- */
let sKey = null;
async function openSettings() {
  closeSide();
  $("#sName").value = state.settings.name; $("#sTemp").value = state.settings.temp; $("#sTempV").textContent = state.settings.temp;
  sKey = state.settings.model;
  $("#verLine").textContent = `rzAI Mobil v${VERSION} · WebLLM · ${state.f16 ? "f16" : "f32"} · veriler sadece bu telefonda`;
  $("#settings").classList.remove("hidden");
  renderChoices($("#sModels"), sKey, k => sKey = k);
  try {
    const e = await navigator.storage.estimate();
    $("#storageInfo").textContent = `Kullanılan: ${(e.usage / 1048576).toFixed(0)} MB · Boş alan kotası: ${(e.quota / 1073741824).toFixed(1)} GB`;
  } catch { $("#storageInfo").textContent = "Bilgi alınamadı"; }
}
$("#openSettings").onclick = openSettings; $("#modelPill").onclick = openSettings;
$("#sTemp").oninput = e => $("#sTempV").textContent = e.target.value;
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => $("#settings").classList.add("hidden"));
$("#settings").addEventListener("click", e => { if (e.target.id === "settings") $("#settings").classList.add("hidden"); });
$("#saveSettings").onclick = () => {
  state.settings.name = $("#sName").value.trim() || "İzzet"; state.settings.temp = +$("#sTemp").value;
  const changed = sKey && sKey !== state.settings.model;
  saveSettings(); applyName(); $("#settings").classList.add("hidden");
  if (changed && !PREVIEW) loadModel(sKey); else if (changed) { state.settings.model = sKey; saveSettings(); applyName(); }
};
$("#delModel").onclick = async () => {
  const k = sKey || state.settings.model;
  if (!confirm(`${modelOf(k).name} telefondan silinsin mi? Tekrar kullanmak için yeniden indirmen gerekir.`)) return;
  try { await webllm.deleteModelAllInfoInCache(modelId(k), APP_CONFIG); } catch (e) { alert("Silinemedi: " + e.message); }
  if (modelId(k) === state.loadedId) { try { await state.engine.unload(); } catch {} state.engine = null; state.loadedId = null; setStatus("bad", "Model yok"); }
  openSettings();
};
$("#delChats").onclick = () => { if (!confirm("Tüm sohbetler silinsin mi?")) return; state.chats = []; saveChats(); newChat(); };

/* ---------------- onizleme: sahte model (sadece ?onizleme) ---------------- */
function demoEngine() {
  const reply = "Önizleme modundasın, gerçek model yüklü değil. Örnek cevap:\n\n```python\nimport random\nsayi = random.randint(1, 100)\nwhile (t := int(input('Tahmin: '))) != sayi:\n    print('Daha büyük' if t < sayi else 'Daha küçük')\nprint('Bildin!')\n```\n\n**Kopyala** düğmesiyle kodu alabilirsin.";
  return { chat: { completions: { create: async () => (async function* () {
    for (const w of reply.match(/[\s\S]{1,6}/g)) { await new Promise(r => setTimeout(r, 15)); yield {choices: [{delta: {content: w}}]}; }
  })() } }, interruptGenerate() {} };
}

/* ---------------- baslangic ---------------- */
async function gpuCheck() {
  if (!("gpu" in navigator)) return {ok:false, why:"Bu tarayıcıda WebGPU yok (navigator.gpu bulunamadı)."};
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return {ok:false, why:"WebGPU var ama ekran kartına erişilemedi."};
    return {ok:true, f16: a.features.has("shader-f16")};
  } catch (e) { return {ok:false, why:"WebGPU hatası: " + e.message}; }
}
async function boot() {
  applyName(); renderChatList(); updateNet();
  if (PREVIEW) { state.engine = demoEngine(); setStatus("warn", "Önizleme modu (sahte model)"); return; }
  const g = await gpuCheck();
  if (!g.ok) { $("#nogpu").classList.remove("hidden"); $("#nogpuDetail").textContent = g.why; setStatus("bad", "WebGPU yok"); return; }
  $("#nogpu").classList.add("hidden");
  state.f16 = g.f16;
  let cached = false;
  try { cached = await webllm.hasModelInCache(modelId(state.settings.model), APP_CONFIG); } catch {}
  if (cached) loadModel(state.settings.model); else showSetup(state.settings.model);
}
$("#retryGpu").onclick = boot;
boot();

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js").catch(e => console.warn("SW", e));
}
