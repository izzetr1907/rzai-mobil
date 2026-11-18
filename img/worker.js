// rzAI Mobil — gorsel uretici worker: SDXS-512 (1 adim) + ONNX Runtime Web (WebGPU)
import * as ort from "../vendor/ort/ort.webgpu.min.mjs";
import { CLIPTokenizer } from "./clip-tokenizer.js";

const REPO = "https://huggingface.co/skillsafeai/sdxs-512-dreamshaper-onnx-webgpu/resolve/b23bf8f4f809a0beb6d095bf52b5854e0b66caef/";
const FILES = [
  {key: "vocab", path: "tokenizer/vocab.json", size: 1059962},
  {key: "merges", path: "tokenizer/merges.txt", size: 524619},
  {key: "vae", path: "vae_decoder.onnx", size: 2467568},
  {key: "te", path: "text_encoder.onnx", size: 246275486},
  {key: "unet", path: "unet.onnx", size: 631766742},
];
const TOTAL = FILES.reduce((a, f) => a + f.size, 0);
const CACHE = "rzai-gorsel-modeli-v1";
const SIGMA = 14.614646911621094;

ort.env.wasm.wasmPaths = new URL("../vendor/ort/", import.meta.url).href;
ort.env.wasm.numThreads = 1;
ort.env.logLevel = "error";

let tok = null, sessions = {}, opts = {ep: "webgpu", lowMem: true};
const post = (type, data = {}) => self.postMessage({type, ...data});

async function cachedFetch(f, onBytes) {
  // Indirirken diske akit (bellege toplamadan), sonra onbellekten oku
  const url = REPO + f.path;
  const cache = await caches.open(CACHE);
  let res = await cache.match(url);
  if (!res) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`İndirilemedi (${r.status}): ${f.path}`);
    const [toCache, toCount] = r.body.tee();
    const put = cache.put(url, new Response(toCache, {headers: {"Content-Type": "application/octet-stream"}}));
    const reader = toCount.getReader(); let got = 0;
    while (true) { const {done, value} = await reader.read(); if (done) break; got += value.length; onBytes(got); }
    try { await put; } catch (e) {
      throw new Error("Model telefona kaydedilemedi: depolama dolu olabilir ya da Gizli Sekme'desin. Normal Safari'de (Ana Ekran uygulamasında) aç ve birkaç GB boş yer bırak.");
    }
    res = await cache.match(url);
    if (!res) throw new Error("Önbelleğe yazılamadı (depolama dolu olabilir).");
  } else onBytes(f.size);
  return res;
}
const fetchBuf = async (f, onBytes = () => {}) => (await cachedFetch(f, onBytes)).arrayBuffer();

async function isCached() {
  const cache = await caches.open(CACHE);
  for (const f of FILES) if (!(await cache.match(REPO + f.path))) return false;
  return true;
}

async function download() {
  // ORT calisma dosyasini (wasm) da onbellege al -> internetsiz calissin
  try {
    const wasmUrl = ort.env.wasm.wasmPaths + "ort-wasm-simd-threaded.asyncify.wasm";
    const c = await caches.open(CACHE);
    if (!(await c.match(wasmUrl))) { const r = await fetch(wasmUrl); if (r.ok) await c.put(wasmUrl, r); }
  } catch {}
  let doneBefore = 0;
  for (const f of FILES) {
    if (f.key === "vocab" || f.key === "merges") continue; // asagida
    await cachedFetch(f, b => post("progress", {phase: "download", loaded: doneBefore + b, total: TOTAL, file: f.path}));
    doneBefore += f.size;
  }
  const vocab = JSON.parse(new TextDecoder().decode(await fetchBuf(FILES[0])));
  const merges = new TextDecoder().decode(await fetchBuf(FILES[1]));
  tok = new CLIPTokenizer(vocab, merges);
}

async function session(key) {
  if (sessions[key]) return sessions[key];
  const f = FILES.find(x => x.key === key);
  let buf = await fetchBuf(f);
  const s = await ort.InferenceSession.create(new Uint8Array(buf), {
    executionProviders: [opts.ep], graphOptimizationLevel: "all", enableMemPattern: false, enableCpuMemArena: false,
  });
  buf = null;
  sessions[key] = s;
  return s;
}
async function release(key) { if (sessions[key]) { try { await sessions[key].release(); } catch {} delete sessions[key]; } }

function rng(seed) { // mulberry32 + Box-Muller
  let a = seed >>> 0;
  const u = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  return () => { let x = 0, y = 0; while (x === 0) x = u(); y = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * y); };
}

async function generate(prompt, seed) {
  const t0 = performance.now();
  post("progress", {phase: "text"});
  const ids = tok.encode(prompt);
  const te = await session("te");
  const teOut = await te.run({[te.inputNames[0]]: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, 77])});
  const emb = teOut[te.outputNames[0]];
  const embData = new Float32Array(await emb.getData());
  if (opts.lowMem) await release("te");

  post("progress", {phase: "unet"});
  const n = 4 * 64 * 64, rand = rng(seed), x = new Float32Array(n), xin = new Float32Array(n);
  const scale = 1 / Math.sqrt(SIGMA * SIGMA + 1);
  for (let i = 0; i < n; i++) { x[i] = rand() * SIGMA; xin[i] = x[i] * scale; }
  const unet = await session("unet");
  const feeds = {};
  for (const name of unet.inputNames) {
    if (/sample/.test(name) && !/encoder/.test(name)) feeds[name] = new ort.Tensor("float32", xin, [1, 4, 64, 64]);
    else if (/time/.test(name)) feeds[name] = new ort.Tensor("float32", new Float32Array([999]), [1]);
    else feeds[name] = new ort.Tensor("float32", embData, [1, 77, 768]);
  }
  const uo = await unet.run(feeds);
  const eps = new Float32Array(await uo[unet.outputNames[0]].getData());
  if (opts.lowMem) await release("unet");
  for (let i = 0; i < n; i++) x[i] = x[i] - SIGMA * eps[i];

  post("progress", {phase: "vae"});
  const vae = await session("vae");
  const vo = await vae.run({[vae.inputNames[0]]: new ort.Tensor("float32", x, [1, 4, 64, 64])});
  const img = new Float32Array(await vo[vae.outputNames[0]].getData());
  const W = 512, H = 512, px = new Uint8ClampedArray(W * H * 4), plane = W * H;
  for (let i = 0; i < plane; i++) {
    px[i * 4] = (img[i] / 2 + 0.5) * 255; px[i * 4 + 1] = (img[plane + i] / 2 + 0.5) * 255;
    px[i * 4 + 2] = (img[2 * plane + i] / 2 + 0.5) * 255; px[i * 4 + 3] = 255;
  }
  return {pixels: px, width: W, height: H, ms: performance.now() - t0};
}

self.onmessage = async ({data}) => {
  try {
    if (data.type === "status") post("status", {cached: await isCached()});
    else if (data.type === "load") {
      opts = {...opts, ...(data.opts || {})};
      if (opts.ep === "webgpu") {
        // Model fp16: GPU 'shader-f16' desteklemiyorsa CPU (wasm) yoluna gec
        let ok = false;
        try { const a = await navigator.gpu?.requestAdapter(); ok = !!a && a.features.has("shader-f16"); } catch {}
        if (!ok) { opts.ep = "wasm"; post("note", {message: "GPU fp16 desteklemiyor, işlemci ile (yavaş) çizilecek."}); }
      }
      await download();
      if (!opts.lowMem) { post("progress", {phase: "init"}); await session("te"); await session("unet"); await session("vae"); }
      post("ready");
    } else if (data.type === "generate") {
      const r = await generate(data.prompt, data.seed ?? Math.floor(Math.random() * 2 ** 31));
      self.postMessage({type: "image", id: data.id, ...r}, [r.pixels.buffer]);
    } else if (data.type === "unload") {
      for (const k of Object.keys(sessions)) await release(k);
      post("unloaded");
    } else if (data.type === "delete") {
      for (const k of Object.keys(sessions)) await release(k);
      await caches.delete(CACHE); post("deleted");
    }
  } catch (e) {
    post("error", {id: data.id, message: String(e?.message || e)});
  }
};
