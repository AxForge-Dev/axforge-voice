// AxForge voice starter: the page. Recordings and audio files go to the local server
// (/api/transcribe, Whisper), which answers {"text": ...}. Text goes to /api/speak (Piper),
// which answers with the spoken audio as a WAV file.

const $ = (id) => document.getElementById(id);

// Speech to text

async function transcribe(blob, filename) {
  $("stt-status").textContent = "Writing down what was said…";
  try {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream", "X-Filename": filename },
      body: blob,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error?.message || body.detail || body.message || `${res.status} ${res.statusText}`);
    $("transcript").value = body.text;
    const seconds = body.durationMs ? ` from ${(body.durationMs / 1000).toFixed(1)} s of audio` : "";
    $("stt-status").textContent = `Done${seconds}.`;
  } catch (err) {
    $("stt-status").textContent = `Error: ${err.message}`;
  }
}

// The browser records with MediaRecorder (WebM with Opus in most browsers); Whisper takes it as it is.
let recorder = null;
let timer = null;

$("record").addEventListener("click", async () => {
  if (recorder) return recorder.stop();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    $("stt-status").textContent = "The browser did not allow the microphone.";
    return;
  }
  const parts = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => parts.push(e.data);
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(timer);
    $("timer").textContent = "";
    $("record").textContent = "Start recording";
    $("record").classList.remove("live");
    const blob = new Blob(parts, { type: recorder.mimeType });
    recorder = null;
    transcribe(blob, "recording.webm");
  };
  recorder.start();
  const started = Date.now();
  timer = setInterval(() => ($("timer").textContent = `${Math.round((Date.now() - started) / 1000)} s`), 500);
  $("record").textContent = "Stop and write it down";
  $("record").classList.add("live");
  $("stt-status").textContent = "Recording…";
});

$("file").addEventListener("change", () => {
  const file = $("file").files[0];
  if (file) transcribe(file, file.name);
});

$("copy").addEventListener("click", () => navigator.clipboard.writeText($("transcript").value));
$("read-back").addEventListener("click", () => {
  $("text").value = $("transcript").value;
  $("speak").click();
});

// Text to speech

$("speak").addEventListener("click", async () => {
  const text = $("text").value.trim();
  if (!text) return;
  $("speak").disabled = true;
  $("tts-status").textContent = "Speaking…";
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || body.detail || body.message || `${res.status} ${res.statusText}`);
    }
    const url = URL.createObjectURL(await res.blob());
    $("player").src = url;
    $("player").hidden = false;
    $("download").href = url;
    $("download").hidden = false;
    $("player").play().catch(() => {}); // some browsers wait for a click before playing sound
    $("tts-status").textContent = "";
  } catch (err) {
    $("tts-status").textContent = `Error: ${err.message}`;
  } finally {
    $("speak").disabled = false;
  }
});
