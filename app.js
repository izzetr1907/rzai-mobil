/* rzAI Mobil — tamamen cihazda calisan yapay zeka (WebLLM + WebGPU) */
import * as webllm from "./vendor/web-llm.js";

const VERSION = "1.1.0";
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
  for (const m of c.messages) m.role === "user" ? addUser(m.content) : (m.image ? addImageMsg(m.image, m.prompt, m.ms) : addAssistant(m.content));
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
    const m = chat.messages[i].image ? {role: "assistant", content: `[Görsel oluşturuldu: ${chat.messages[i].prompt || ""}]`} : chat.messages[i];
    total += m.content.length;
    if (total > 6000 && out.length) break;
    out.unshift({role: m.role, content: m.content.slice(-6000)});
  }
  return [{role:"system", content: SYSTEM(state.settings.name)}, ...out];
}

/* ---------------- gonder ---------------- */
async function send() {
  const text = input.value.trim(); if (!text || state.busy) return;
  if (img.mode) return sendImage(text);
  if (state.engine && !state.loadedId && !PREVIEW) await loadModel(state.settings.model);
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
document.querySelectorAll(".card").forEach(c => c.onclick = async () => {
  if (c.dataset.img) { const ok = await enterImageMode(); if (!ok) return; input.value = c.dataset.img; }
  else { if (img.mode) exitImageMode(); input.value = c.dataset.prompt; }
  autoGrow(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); });

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


/* ---------------- gorsel olusturma (SDXS + ONNX Runtime Web / WebGPU) ---------------- */
const IS_MOBILE = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
const IMG_EP = new URLSearchParams(location.search).get("imgep") || "webgpu"; // test icin: ?imgep=wasm
const img = {worker: null, ready: false, mode: false, waiters: [], onProgress: null};
function imgWorker() {
  if (img.worker) return img.worker;
  img.worker = new Worker(new URL("./img/worker.js", import.meta.url), {type: "module"});
  img.worker.onmessage = ({data}) => {
    if (data.type === "progress") { img.onProgress?.(data); return; }
    if (data.type === "note") { img.note = data.message; return; }
    const w = img.waiters.shift(); if (!w) return;
    data.type === "error" ? w.reject(new Error(data.message)) : w.resolve(data);
  };
  img.worker.onerror = e => { const w = img.waiters.shift(); w?.reject(new Error(e.message || "Görsel işçisi çöktü")); img.worker = null; img.ready = false; };
  return img.worker;
}
const imgCall = msg => new Promise((resolve, reject) => { img.waiters.push({resolve, reject}); imgWorker().postMessage(msg); });
const memErr = m => /memory|alloc|OOM|out of|device.*lost|buffer|RangeError|Aborted/i.test(m);
const trErr = m => memErr(m) ? "Telefonun belleği görsel modeli için yetmedi. Diğer uygulamaları kapat, uygulamayı yeniden aç ve tekrar dene. (Bu iş için iPhone 15 Pro veya daha yenisi önerilir.)" : m;

function setImgProg(p) {
  const fill = $("#imgBarFill"), pct = $("#imgPct"), t = $("#imgProgText");
  if (p.phase === "download") {
    const r = p.loaded / p.total; fill.style.width = (r * 100).toFixed(1) + "%"; pct.textContent = "%" + Math.floor(r * 100);
    t.textContent = `İndiriliyor: ${(p.loaded / 1048576).toFixed(0)} / ${(p.total / 1048576).toFixed(0)} MB`;
  } else if (p.phase === "init") { t.textContent = "Ekran kartına yükleniyor…"; }
}
async function enterImageMode() {
  if (img.ready) { setImgMode(true); return true; }
  if (PREVIEW) { img.ready = true; setImgMode(true); return true; }
  if (!("gpu" in navigator) && IMG_EP === "webgpu") { errorBox("Görsel oluşturma için WebGPU gerekli (iOS 26+)."); return false; }
  let cached = false;
  try { cached = (await imgCall({type: "status"})).cached; } catch {}
  $("#imgSetup").classList.remove("hidden"); $("#imgErr").textContent = "";
  $("#imgStart").disabled = false; $("#imgProgWrap").classList.add("hidden");
  $("#imgStart").textContent = cached ? "Başla" : "İndir ve başla";
  return await new Promise(resolve => {
    const close = ok => { $("#imgSetup").classList.add("hidden"); resolve(ok); };
    $("#imgCancel").onclick = $("#imgSetupClose").onclick = () => close(false);
    $("#imgStart").onclick = async () => {
      if (!cached && !navigator.onLine) { $("#imgErr").textContent = "İlk indirme için internet gerekli."; return; }
      $("#imgStart").disabled = true; $("#imgProgWrap").classList.remove("hidden");
      img.onProgress = setImgProg;
      try { await navigator.storage?.persist?.(); } catch {}
      try {
        await imgCall({type: "load", opts: {ep: IMG_EP, lowMem: IS_MOBILE}});
        img.ready = true; setImgMode(true); close(true);
      } catch (e) { $("#imgErr").textContent = "Yüklenemedi: " + trErr(String(e.message || e)); $("#imgStart").disabled = false; }
    };
    if (cached) $("#imgStart").click();
  });
}
function setImgMode(on) {
  img.mode = on; document.body.classList.toggle("img-mode", on); $("#imgBar").classList.toggle("hidden", !on);
  input.placeholder = on ? "Görsel tarifini yaz…" : "rzAI'ye bir şey yaz...";
}
function exitImageMode() { setImgMode(false); }
$("#imgModeBtn").onclick = () => img.mode ? exitImageMode() : enterImageMode();
$("#imgBarClose").onclick = exitImageMode;

function addImageMsg(src, prompt, ms) {
  const d = document.createElement("div"); d.className = "msg assistant";
  d.innerHTML = `<div class="logo logo-xs"><span>rz</span><i></i></div><div class="body"><div class="gen-img"><img alt="Oluşturulan görsel"><div class="gen-acts">
    <a class="btn" download="rzai-gorsel.jpg">⬇ Kaydet</a><span></span></div></div></div>`;
  d.querySelector("img").src = src; d.querySelector("a").href = src;
  d.querySelector(".gen-acts span").textContent = (prompt ? "“" + prompt + "”" : "") + (ms ? ` · ${(ms / 1000).toFixed(1)} sn` : "");
  d.querySelector("a").onclick = async e => { // iOS: Paylas menusunden "Resmi Kaydet"
    if (navigator.canShare) { try { const b = await (await fetch(src)).blob(); const f = new File([b], "rzai-gorsel.jpg", {type: "image/jpeg"});
      if (navigator.canShare({files: [f]})) { e.preventDefault(); await navigator.share({files: [f]}); } } catch {} } };
  d.querySelector("img").onload = () => toBottom();
  msgs.append(d); setHasMsgs(); toBottom(true); return d;
}
async function translateForImage(text) {
  if (!/[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|ile|gibi|olan|için)\b/i.test(text)) return text; // zaten Ingilizce gibi
  if (!state.engine || !state.loadedId || PREVIEW) return text;
  try {
    const r = await state.engine.chat.completions.create({temperature: 0.2, max_tokens: 90, messages: [
      {role: "system", content: "Translate the user's Turkish image description into ONE short English image-generation prompt (subject, details, style, lighting). Output ONLY the English prompt."},
      {role: "user", content: text}]});
    const out = (r.choices?.[0]?.message?.content || "").split("\n").find(l => l.trim()) || text;
    return out.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 300);
  } catch { return text; }
}
async function sendImage(text) {
  input.value = ""; autoGrow();
  let chat = state.chats.find(x => x.id === state.chatId);
  if (!chat) { chat = {id: Date.now().toString(36), title: "🎨 " + text.slice(0, 36), updated: Date.now(), messages: []}; state.chats.push(chat); state.chatId = chat.id; }
  chat.messages.push({role: "user", content: "🎨 " + text}); saveChats(); renderChatList();
  addUser("🎨 " + text);
  const d = document.createElement("div"); d.className = "msg assistant";
  d.innerHTML = `<div class="logo logo-xs"><span>rz</span><i></i></div><div class="body"><div class="img-progress">
    <div class="ph" data-p="tr">○ Tarif İngilizceye çevriliyor</div><div class="ph" data-p="text">○ Metin anlaşılıyor</div>
    <div class="ph" data-p="unet">○ Görsel çiziliyor</div><div class="ph" data-p="vae">○ Görüntü oluşturuluyor</div><div class="skel"></div></div></div>`;
  msgs.append(d); toBottom(true);
  const order = ["tr", "text", "unet", "vae"];
  const mark = ph => order.forEach((k, i) => { const el = d.querySelector(`[data-p="${k}"]`); const cur = order.indexOf(ph);
    el.className = "ph" + (i < cur ? " ok" : i === cur ? " on" : ""); el.textContent = (i < cur ? "✓ " : i === cur ? "◌ " : "○ ") + el.textContent.slice(2); });
  setBusy(true);
  try {
    mark("tr");
    const en = await translateForImage(text);
    let res;
    if (PREVIEW) { for (const ph of ["text", "unet", "vae"]) { mark(ph); await new Promise(r => setTimeout(r, 400)); } res = demoImage(en); }
    else {
      if (IS_MOBILE && state.engine && state.loadedId) { try { await state.engine.unload(); } catch {} state.loadedId = null; setStatus("warn", "Sohbet modeli beklemede"); }
      img.onProgress = p => p.phase && mark(p.phase);
      localStorage.setItem("rzm_img_running", "1");
      res = await imgCall({type: "generate", prompt: en, seed: Math.floor(Math.random() * 2 ** 31)});
      localStorage.removeItem("rzm_img_running");
    }
    const cv = document.createElement("canvas"); cv.width = res.width; cv.height = res.height;
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(res.pixels), res.width, res.height), 0, 0);
    const url = cv.toDataURL("image/jpeg", 0.88);
    d.remove(); addImageMsg(url, en, res.ms);
    chat.messages.push({role: "assistant", content: "", image: url, prompt: en, ms: Math.round(res.ms)}); chat.updated = Date.now(); saveChats();
  } catch (e) {
    localStorage.removeItem("rzm_img_running");
    d.remove(); errorBox("Görsel oluşturulamadı: " + trErr(String(e.message || e)));
  } finally { setBusy(false); }
}
function demoImage(prompt) { // ?onizleme icin sahte gorsel
  const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 512, 512); gr.addColorStop(0, "#0b1d3a"); gr.addColorStop(.55, "#5b2a86"); gr.addColorStop(1, "#ff9a3c");
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(255,255,255,${Math.random()})`; g.fillRect(Math.random() * 512, Math.random() * 300, 2, 2); }
  g.fillStyle = "#22e06b"; g.beginPath(); g.arc(380, 140, 60, 0, 7); g.fill();
  g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(0, 430, 512, 82); g.fillStyle = "#fff"; g.font = "bold 22px sans-serif";
  g.fillText("ÖNİZLEME (sahte görsel)", 20, 465); g.font = "15px sans-serif"; g.fillText(prompt.slice(0, 52), 20, 492);
  return {pixels: g.getImageData(0, 0, 512, 512).data, width: 512, height: 512, ms: 1200};
}
$("#delImgModel").onclick = async () => {
  if (!confirm("Görsel modeli (~880 MB) telefondan silinsin mi?")) return;
  try { await imgCall({type: "delete"}); } catch {} img.ready = false; exitImageMode(); openSettings();
};

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
  if (localStorage.getItem("rzm_img_running")) {
    localStorage.removeItem("rzm_img_running");
    setTimeout(() => errorBox("Son görsel denemesinde uygulama kapandı: telefonun belleği yetmemiş olabilir. Diğer uygulamaları kapatıp tekrar dene veya sadece sohbet modunu kullan."), 500);
  }
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
