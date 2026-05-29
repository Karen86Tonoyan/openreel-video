import { useState, useEffect, useRef, useCallback } from "react";
import {
  Wifi, WifiOff, Sparkles, Download, Loader2,
  Settings2, ChevronDown, ChevronUp, Plus, RefreshCw,
  ImageIcon, Cpu, Cloud,
} from "lucide-react";
import { ScrollArea } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";

// ── ComfyUI (local) ────────────────────────────────────────────
const COMFY_HOST = "http://localhost:8188";
const COMFY_WS   = "ws://localhost:8188/ws";

const buildWorkflow = (
  prompt: string, negPrompt: string,
  steps: number, cfg: number,
  width: number, height: number, seed: number,
) => ({
  "3": { class_type: "KSampler",              inputs: { seed, steps, cfg, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4",0], positive: ["6",0], negative: ["7",0], latent_image: ["5",0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "v1-5-pruned-emaonly.ckpt" } },
  "5": { class_type: "EmptyLatentImage",       inputs: { batch_size: 1, height, width } },
  "6": { class_type: "CLIPTextEncode",         inputs: { text: prompt,    clip: ["4",1] } },
  "7": { class_type: "CLIPTextEncode",         inputs: { text: negPrompt, clip: ["4",1] } },
  "8": { class_type: "VAEDecode",              inputs: { samples: ["3",0], vae: ["4",2] } },
  "9": { class_type: "SaveImage",              inputs: { filename_prefix: "openreel", images: ["8",0] } },
});

// ── Replicate (cloud) ──────────────────────────────────────────
// FLUX-schnell: ~$0.003/img, no GPU needed
const REPLICATE_MODEL = "black-forest-labs/flux-schnell";

async function generateReplicate(
  apiKey: string, prompt: string,
  width: number, height: number,
): Promise<string> {
  const res = await fetch("https://api.replicate.com/v1/models/" + REPLICATE_MODEL + "/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: { prompt, width, height, num_outputs: 1, num_inference_steps: 4 } }),
  });
  if (!res.ok) throw new Error(`Replicate error ${res.status}`);
  let prediction = await res.json();

  // poll until done
  while (prediction.status !== "succeeded" && prediction.status !== "failed") {
    await new Promise(r => setTimeout(r, 1500));
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    prediction = await poll.json();
  }
  if (prediction.status === "failed") throw new Error(prediction.error ?? "Generation failed");
  return prediction.output[0] as string;
}

// ── shared types ───────────────────────────────────────────────
interface GeneratedImage { filename: string; prompt: string; url: string; timestamp: number; }
type ConnectionStatus   = "disconnected" | "connecting" | "connected" | "error";
type Mode               = "local" | "cloud";

// ══════════════════════════════════════════════════════════════
export const ComfyUITab: React.FC = () => {
  const importMedia = useProjectStore((s) => s.importMedia);

  // shared
  const [mode, setMode]           = useState<Mode>(() =>
    (localStorage.getItem("comfy-mode") as Mode) ?? "local");
  const [prompt, setPrompt]       = useState("");
  const [negPrompt, setNegPrompt] = useState("blurry, nsfw, text, watermark, ugly, deformed");
  const [steps, setSteps]         = useState(20);
  const [cfg, setCfg]             = useState(7);
  const [width, setWidth]         = useState(512);
  const [height, setHeight]       = useState(512);
  const [generating, setGenerating] = useState(false);
  const [history, setHistory]     = useState<GeneratedImage[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // local
  const [status, setStatus]       = useState<ConnectionStatus>("disconnected");
  const [queuePos, setQueuePos]   = useState<number | null>(null);
  const [clientId]                = useState(() => crypto.randomUUID());
  const wsRef                     = useRef<WebSocket | null>(null);
  const pendingIdRef              = useRef<string | null>(null);

  // cloud
  const [apiKey, setApiKey]       = useState(() => localStorage.getItem("replicate-key") ?? "");

  const saveMode = (m: Mode) => { setMode(m); localStorage.setItem("comfy-mode", m); };
  const saveKey  = (k: string) => { setApiKey(k); localStorage.setItem("replicate-key", k); };

  // ── WebSocket (local only) ──
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setStatus("connecting");
    const ws = new WebSocket(`${COMFY_WS}?clientId=${clientId}`);
    ws.onopen    = () => setStatus("connected");
    ws.onclose   = () => { setStatus("disconnected"); wsRef.current = null; };
    ws.onerror   = () => setStatus("error");
    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "status") {
          const q = msg.data?.status?.exec_info?.queue_remaining;
          setQueuePos(typeof q === "number" ? q : null);
        }
        if (msg.type === "executing" && msg.data?.node === null && msg.data?.prompt_id === pendingIdRef.current) {
          await fetchComfyResult(msg.data.prompt_id);
          setGenerating(false);
          pendingIdRef.current = null;
          setQueuePos(null);
        }
      } catch { /* binary frame */ }
    };
    wsRef.current = ws;
  }, [clientId]);

  useEffect(() => {
    if (mode === "local") connect();
    return () => { wsRef.current?.close(); };
  }, [mode, connect]);

  // ── fetch ComfyUI result ──
  const fetchComfyResult = async (promptId: string) => {
    try {
      const res  = await fetch(`${COMFY_HOST}/history/${promptId}`);
      const data = await res.json();
      const outputs = data[promptId]?.outputs ?? {};
      for (const nodeId of Object.keys(outputs)) {
        const images: { filename: string; subfolder: string; type: string }[] = outputs[nodeId]?.images ?? [];
        for (const img of images) {
          if (img.type !== "output") continue;
          const url = `${COMFY_HOST}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=output`;
          setHistory(prev => [{ filename: img.filename, prompt, url, timestamp: Date.now() }, ...prev]);
          toast.success("ComfyUI", `Ready: ${img.filename}`);
        }
      }
    } catch { toast.error("ComfyUI", "Failed to fetch result."); }
  };

  // ── generate ──
  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.warning("ComfyUI", "Enter a prompt first."); return; }

    if (mode === "local") {
      if (status !== "connected") { toast.warning("ComfyUI", "Start ComfyUI on port 8188 first."); return; }
      setGenerating(true);
      const seed = Math.floor(Math.random() * 2 ** 32);
      try {
        const res  = await fetch(`${COMFY_HOST}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: buildWorkflow(prompt, negPrompt, steps, cfg, width, height, seed), client_id: clientId }),
        });
        const data = await res.json();
        pendingIdRef.current = data.prompt_id;
      } catch {
        toast.error("ComfyUI", "Cannot reach ComfyUI. Is it running?");
        setGenerating(false);
      }
      return;
    }

    // cloud
    if (!apiKey.trim()) { toast.warning("Replicate", "Enter your Replicate API key first."); return; }
    setGenerating(true);
    try {
      const url  = await generateReplicate(apiKey, prompt, width, height);
      const name = `flux-${Date.now()}.webp`;
      setHistory(prev => [{ filename: name, prompt, url, timestamp: Date.now() }, ...prev]);
      toast.success("Replicate", "Image ready!");
    } catch (e) {
      toast.error("Replicate", (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  // ── add to timeline ──
  const addToTimeline = async (img: GeneratedImage) => {
    try {
      const res  = await fetch(img.url);
      const blob = await res.blob();
      await importMedia(new File([blob], img.filename, { type: blob.type || "image/png" }));
      toast.success("ComfyUI", "Added to timeline!");
    } catch { toast.error("ComfyUI", "Failed to import image."); }
  };

  // ── ui helpers ──
  const statusDot = { disconnected: "bg-text-muted", connecting: "bg-amber-400 animate-pulse", connected: "bg-primary", error: "bg-red-500" }[status];
  const statusLabel = { disconnected: "Disconnected", connecting: "Connecting…", connected: "Connected", error: "Error" }[status];

  return (
    <ScrollArea className="flex-1">
      <div className="px-5 py-4 space-y-4">

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          {(["local", "cloud"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => saveMode(m)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                mode === m
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {m === "local" ? <Cpu size={12} /> : <Cloud size={12} />}
              {m === "local" ? "Local (ComfyUI)" : "Cloud (Replicate)"}
            </button>
          ))}
        </div>

        {/* ── LOCAL status ── */}
        {mode === "local" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${statusDot}`} />
              <span className="text-xs text-text-muted">{statusLabel} · localhost:8188</span>
            </div>
            <button
              onClick={connect}
              disabled={status === "connecting" || status === "connected"}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40 transition-colors"
            >
              {status === "connected" ? <Wifi size={12} /> : <WifiOff size={12} />}
              {(status === "disconnected" || status === "error") && "Reconnect"}
            </button>
          </div>
        )}

        {mode === "local" && status !== "connected" && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-xs text-text-muted space-y-1.5">
            <p className="font-medium text-amber-400">ComfyUI not detected</p>
            <p>Run locally (needs GPU):</p>
            <pre className="bg-background-tertiary rounded p-2 text-[10px] select-all overflow-x-auto">python main.py --listen 0.0.0.0 --port 8188</pre>
            <p className="text-[10px] text-text-muted/70">No GPU? Switch to Cloud mode →</p>
          </div>
        )}

        {/* ── CLOUD API key ── */}
        {mode === "cloud" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">
              Replicate API key
              <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noreferrer"
                className="ml-2 text-primary/70 hover:text-primary transition-colors">
                get free key ↗
              </a>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => saveKey(e.target.value)}
              placeholder="r8_..."
              className="w-full bg-background-tertiary border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary/50 transition-colors font-mono"
            />
            <p className="text-[10px] text-text-muted">Model: FLUX Schnell · ~$0.003/image · no GPU needed</p>
          </div>
        )}

        {/* Prompt */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="a cinematic shot of a neon city at night, rain, 4k..."
            rows={3}
            className="w-full bg-background-tertiary border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Advanced */}
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <Settings2 size={12} />
          Advanced
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showAdvanced && (
          <div className="space-y-3 bg-background-tertiary rounded-lg p-3 border border-border">
            {mode === "local" && (
              <div className="space-y-1.5">
                <label className="text-[10px] text-text-muted">Negative prompt</label>
                <textarea value={negPrompt} onChange={e => setNegPrompt(e.target.value)} rows={2}
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-[10px] text-text-primary resize-none focus:outline-none focus:border-primary/50" />
              </div>
            )}
            {mode === "local" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">Steps: {steps}</label>
                  <input type="range" min={1} max={50} value={steps} onChange={e => setSteps(+e.target.value)} className="w-full accent-primary" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">CFG: {cfg}</label>
                  <input type="range" min={1} max={20} step={0.5} value={cfg} onChange={e => setCfg(+e.target.value)} className="w-full accent-primary" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {([["Width", width, setWidth], ["Height", height, setHeight]] as const).map(([label, val, set]) => (
                <div key={label} className="space-y-1">
                  <label className="text-[10px] text-text-muted">{label}</label>
                  <select value={val} onChange={e => (set as (v: number) => void)(+e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-[10px] text-text-primary focus:outline-none">
                    {[256,512,768,1024].map(v => <option key={v} value={v}>{v}px</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating || !prompt.trim() || (mode === "local" && status !== "connected") || (mode === "cloud" && !apiKey.trim())}
          className="w-full flex items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary rounded-lg py-2.5 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? (
            <><Loader2 size={15} className="animate-spin" />{queuePos !== null ? `Queue: ${queuePos}…` : "Generating…"}</>
          ) : (
            <><Sparkles size={15} />Generate</>
          )}
        </button>

        {/* History */}
        {history.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">Generated</span>
              <button onClick={() => setHistory([])} className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary transition-colors">
                <RefreshCw size={10} /> Clear
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {history.map(img => (
                <div key={img.timestamp} className="group relative aspect-square rounded-lg overflow-hidden border border-border hover:border-primary/40 transition-colors bg-background-tertiary">
                  <img src={img.url} alt={img.prompt} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button onClick={() => addToTimeline(img)} title="Add to timeline"
                      className="p-1.5 bg-primary/20 hover:bg-primary/40 rounded-full transition-colors">
                      <Plus size={13} className="text-primary" />
                    </button>
                    <a href={img.url} download={img.filename} title="Download"
                      className="p-1.5 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
                      <Download size={13} className="text-white" />
                    </a>
                  </div>
                  <p className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-black/60 text-[9px] text-white truncate opacity-0 group-hover:opacity-100 transition-opacity">
                    {img.prompt}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {history.length === 0 && !generating && (
          <div className="flex flex-col items-center gap-2 py-8 text-text-muted">
            <ImageIcon size={32} className="opacity-20" />
            <p className="text-xs">Generated images appear here</p>
          </div>
        )}

      </div>
    </ScrollArea>
  );
};
