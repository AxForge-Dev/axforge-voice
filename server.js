// AxForge voice starter: a small server that keeps your API key and passes audio calls to the API.
//
// The browser never sees the key. The page talks to this server, and this server adds the key
// and calls the AxForge API, which speaks the OpenAI audio shape. No dependencies: Node.js only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

try {
  process.loadEnvFile(); // reads .env when it is there
} catch {}

const API = (process.env.AXFORGE_BASE_URL || "https://api.axforge.ai/v1").replace(/\/$/, "");
const KEY = (process.env.AXFORGE_API_KEY || "").trim();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = join(import.meta.dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

// Hand the API's answer back to the page as it is: JSON text, or the audio itself.
async function passBack(res, upstream) {
  res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

// POST /api/transcribe: the page sends the recording or the file as it is. It goes on to
// Whisper as a multipart upload, the way /v1/audio/transcriptions takes it.
async function transcribe(req, res) {
  const audio = await readBody(req);
  const form = new FormData();
  const type = req.headers["content-type"] || "application/octet-stream";
  form.append("file", new Blob([audio], { type }), req.headers["x-filename"] || "audio.webm");
  form.append("model", "whisper");
  const upstream = await fetch(`${API}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
    signal: AbortSignal.timeout(300_000),
  });
  await passBack(res, upstream);
}

// POST /api/speak {text}: Piper reads the text, and the spoken audio (WAV) comes back.
async function speak(req, res) {
  const { text } = JSON.parse((await readBody(req)).toString() || "{}");
  const upstream = await fetch(`${API}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "piper", input: text }),
    signal: AbortSignal.timeout(120_000),
  });
  await passBack(res, upstream);
}

async function serveFile(req, res) {
  const name = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  if (!/^\/[\w.-]+$/.test(name)) return sendJson(res, 404, { error: { message: "Not found" } });
  try {
    const body = await readFile(join(PUBLIC, name));
    res.writeHead(200, { "Content-Type": TYPES[extname(name)] || "application/octet-stream" });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: { message: "Not found" } });
  }
}

const routes = { "POST /api/transcribe": transcribe, "POST /api/speak": speak };

createServer(async (req, res) => {
  try {
    const route = routes[`${req.method} ${req.url}`];
    if (!route) return await serveFile(req, res);
    if (!KEY) return sendJson(res, 500, { error: { message: "No API key yet: put AXFORGE_API_KEY in .env and restart." } });
    await route(req, res);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 502, { error: { message: `Could not reach the API: ${err.message}` } });
    else res.end();
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`AxForge voice is running at http://127.0.0.1:${PORT}`);
  if (!KEY) console.log("No API key yet: copy .env.example to .env, paste your key, and restart.");
});
