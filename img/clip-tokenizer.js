// Basit CLIP BPE tokenizer (Stable Diffusion icin). vocab.json + merges.txt ile calisir.
function bytesToUnicode() {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice(); let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
  const m = {}; bs.forEach((b, i) => m[b] = String.fromCharCode(cs[i])); return m;
}
const PAT = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;
export class CLIPTokenizer {
  constructor(vocab, mergesText) {
    this.encoder = vocab;
    const lines = mergesText.split("\n").slice(1, 49152 - 256 - 2 + 1);
    this.ranks = new Map(); lines.forEach((l, i) => { if (l.trim()) this.ranks.set(l, i); });
    this.byteEnc = bytesToUnicode(); this.cache = new Map(); this.te = new TextEncoder();
    this.bos = 49406; this.eos = 49407;
  }
  bpe(token) {
    if (this.cache.has(token)) return this.cache.get(token);
    let word = [...token.slice(0, -1)].concat(token.slice(-1) + "</w>");
    if (word.length === 1) return token + "</w>";
    while (true) {
      let best = null, bestRank = Infinity;
      for (let i = 0; i < word.length - 1; i++) {
        const r = this.ranks.get(word[i] + " " + word[i + 1]);
        if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
      }
      if (best === null) break;
      const a = word[best], b = word[best + 1], nw = [];
      for (let i = 0; i < word.length;) {
        if (i < word.length - 1 && word[i] === a && word[i + 1] === b) { nw.push(a + b); i += 2; }
        else { nw.push(word[i]); i++; }
      }
      word = nw; if (word.length === 1) break;
    }
    const out = word.join(" "); this.cache.set(token, out); return out;
  }
  encode(text, maxLen = 77) {
    text = text.replace(/\s+/g, " ").trim().toLowerCase();
    const ids = [this.bos];
    for (const m of text.matchAll(PAT)) {
      const t = [...this.te.encode(m[0])].map(b => this.byteEnc[b]).join("");
      for (const piece of this.bpe(t).split(" ")) { const id = this.encoder[piece]; if (id !== undefined) ids.push(id); }
    }
    ids.length = Math.min(ids.length, maxLen - 1); ids.push(this.eos);
    while (ids.length < maxLen) ids.push(this.eos);
    return ids;
  }
}
