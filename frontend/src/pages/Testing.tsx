import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

const DEFAULT_MARKETS = "creatine,protein powder,yoga mat,resistance bands";

const FP_DEFAULT_KEYWORDS = [
  "gaming chair", "standing desk", "protein powder", "creatine", "yoga mat",
  "resistance bands", "coffee maker", "air fryer", "blender", "phone stand",
  "cable organizer", "desk lamp", "laptop stand", "water bottle", "earbuds",
  "smartwatch", "backpack", "sunglasses", "foam roller", "mouse pad",
  "wireless charger", "ring light", "monitor stand", "keyboard wrist rest", "usb hub",
  "electric kettle", "french press", "pour over coffee", "reusable water bottle", "lunch box",
  "bamboo cutting board", "cast iron skillet", "instant pot", "food scale", "salad spinner",
  "knee brace", "compression socks", "massage gun", "pull up bar", "jump rope",
  "whey protein", "pre workout", "omega 3", "vitamin d", "collagen powder",
  "dog collar", "cat tree", "pet water fountain", "dog leash", "cat toy",
  "led strip lights", "smart plug", "motion sensor light", "door lock", "security camera",
  "travel pillow", "packing cubes", "luggage scale", "passport holder", "money belt",
  "drawing tablet", "webcam", "blue light glasses", "standing mat", "monitor arm",
].join("\n");

const PROD_DEFAULT_ASINS = [
  "B0FGD4DVFW", "B098D1YYSX", "B0978NBKWP", "B0FWBYRQ3S",
  "B09M8CC8RD", "B0DP2S5X8N", "B0D2XSL28P",
].join("\n");

type LtTask = {
  item: string;
  attempts: number;
  success: boolean;
  duration_s: number | null;
  captchas: number;
  empties: number;
  error: string | null;
};

function computeLtMetrics(results: LtTask[], wallMs: number | null) {
  if (!results.length) return null;
  const succ = results.filter(r => r.success);
  const durations = succ.map(r => r.duration_s!).sort((a, b) => a - b);
  const totalAttempts = results.reduce((s, r) => s + r.attempts, 0);
  const totalCaptchas = results.reduce((s, r) => s + r.captchas, 0);
  const totalEmpties = results.reduce((s, r) => s + r.empties, 0);
  const avgArr = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const pct = (arr: number[], p: number) =>
    arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null;
  return {
    total: results.length,
    successful: succ.length,
    failed: results.length - succ.length,
    successRate: (succ.length / results.length * 100).toFixed(1),
    totalAttempts,
    totalCaptchas,
    totalEmpties,
    captchaRate: totalAttempts ? (totalCaptchas / totalAttempts * 100).toFixed(1) : "0",
    avgAttempts: succ.length ? (succ.reduce((s, r) => s + r.attempts, 0) / succ.length).toFixed(1) : "–",
    avgDuration: avgArr(durations)?.toFixed(2) ?? "–",
    p50: pct(durations, 0.5)?.toFixed(2) ?? "–",
    p95: pct(durations, 0.95)?.toFixed(2) ?? "–",
    minDuration: durations.length ? durations[0].toFixed(2) : "–",
    maxDuration: durations.length ? durations[durations.length - 1].toFixed(2) : "–",
    wallTime: wallMs ? (wallMs / 1000).toFixed(1) : "–",
  };
}

function LtMetricsGrid({ m }: { m: NonNullable<ReturnType<typeof computeLtMetrics>> }) {
  const rate = parseFloat(m.successRate);
  const items: { label: string; value: string; color?: string }[] = [
    { label: "Erfolgsrate", value: `${m.successRate}%`, color: rate >= 70 ? "success.main" : rate >= 40 ? "warning.main" : "error.main" },
    { label: "Erfolgreich", value: `${m.successful} / ${m.total}` },
    { label: "Fehlgeschlagen", value: m.failed.toString(), color: m.failed > 0 ? "error.main" : undefined },
    { label: "Captchas gesamt", value: m.totalCaptchas.toString(), color: m.totalCaptchas > 0 ? "warning.main" : undefined },
    { label: "Captcha-Rate", value: `${m.captchaRate}%` },
    { label: "Leere Ergebnisse", value: m.totalEmpties.toString() },
    { label: "Ø Versuche/Hit", value: m.avgAttempts },
    { label: "Ø Dauer", value: `${m.avgDuration}s` },
    { label: "P50 Dauer", value: `${m.p50}s` },
    { label: "P95 Dauer", value: `${m.p95}s` },
    { label: "Min / Max", value: `${m.minDuration}s / ${m.maxDuration}s` },
    { label: "Gesamtzeit", value: `${m.wallTime}s` },
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))", gap: 1, mb: 2 }}>
      {items.map(({ label, value, color }) => (
        <Box key={label} sx={{ p: 1, bgcolor: "action.hover", borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3, mb: 0.25 }}>
            {label}
          </Typography>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: color ?? "text.primary" }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function LtResultsList({ results }: { results: LtTask[] }) {
  return (
    <Box sx={{ maxHeight: 280, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
      {results.map((r, i) => (
        <Box key={i} sx={{
          display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.5,
          borderBottom: i < results.length - 1 ? "1px solid" : "none",
          borderColor: "divider",
          "&:hover": { bgcolor: "action.hover" },
        }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, bgcolor: r.success ? "success.main" : "error.main" }} />
          <Typography variant="caption" sx={{
            fontFamily: "monospace", flexGrow: 1, minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.72rem",
          }}>
            {r.item}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontSize: "0.68rem", minWidth: 22, textAlign: "right" }}>
            {r.attempts}x
          </Typography>
          {r.captchas > 0 && (
            <Tooltip title={`${r.captchas} CAPTCHA(s)`} placement="left">
              <Chip label={`${r.captchas}C`} size="small" color="warning"
                sx={{ height: 15, fontSize: "0.62rem", flexShrink: 0, "& .MuiChip-label": { px: 0.75 } }} />
            </Tooltip>
          )}
          {r.success && r.duration_s !== null ? (
            <Typography variant="caption" sx={{ flexShrink: 0, fontSize: "0.68rem", fontFamily: "monospace", color: "text.secondary", minWidth: 34, textAlign: "right" }}>
              {r.duration_s.toFixed(1)}s
            </Typography>
          ) : (
            <Typography variant="caption" sx={{ flexShrink: 0, fontSize: "0.68rem", color: "error.main", minWidth: 34, textAlign: "right" }}>
              {r.error ?? "err"}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

const JsonBox = ({ data }: { data: unknown }) => (
  <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: "action.hover", borderRadius: 1, fontSize: "0.78rem", overflowX: "auto" }}>
    {JSON.stringify(data, null, 2)}
  </Box>
);

function statusColor(status: string): "default" | "warning" | "success" | "error" {
  if (status === "running") return "warning";
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  return "default";
}

export default function Testing() {
  // ── Proxy Test ────────────────────────────────────────────────────────────
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyResult, setProxyResult] = useState<Record<string, unknown> | null>(null);
  const [proxyError, setProxyError] = useState<string | null>(null);

  async function handleProxyTest() {
    setProxyLoading(true); setProxyResult(null); setProxyError(null);
    try {
      const res = await fetch("/api/proxy-test");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProxyResult(await res.json());
    } catch (e) {
      setProxyError(e instanceof Error ? e.message : "Unknown error");
    } finally { setProxyLoading(false); }
  }

  // ── First Page Scraper ────────────────────────────────────────────────────
  const [fpKeyword, setFpKeyword] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpResult, setFpResult] = useState<unknown>(null);
  const [fpError, setFpError] = useState<string | null>(null);
  const [fpDuration, setFpDuration] = useState<number | null>(null);

  async function handleFirstPage() {
    if (!fpKeyword.trim()) return;
    setFpLoading(true); setFpResult(null); setFpError(null); setFpDuration(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/scraper/first-page", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: fpKeyword.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFpResult(await res.json());
    } catch (e) { setFpError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setFpDuration((Date.now() - t0) / 1000); setFpLoading(false); }
  }

  // ── Product Scraper ───────────────────────────────────────────────────────
  const [prodAsin, setProdAsin] = useState("");
  const [prodLoading, setProdLoading] = useState(false);
  const [prodResult, setProdResult] = useState<unknown>(null);
  const [prodError, setProdError] = useState<string | null>(null);
  const [prodDuration, setProdDuration] = useState<number | null>(null);

  async function handleProduct() {
    if (!prodAsin.trim()) return;
    setProdLoading(true); setProdResult(null); setProdError(null); setProdDuration(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/scraper/product", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin: prodAsin.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProdResult(await res.json());
    } catch (e) { setProdError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setProdDuration((Date.now() - t0) / 1000); setProdLoading(false); }
  }

  // ── Cluster Job ───────────────────────────────────────────────────────────
  const [clusterMarkets, setClusterMarkets] = useState(DEFAULT_MARKETS);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [clusterStatus, setClusterStatus] = useState<{
    job_id: string; status: string;
    progress: { done: number; total: number }; errors: string[];
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  useEffect(() => () => stopPolling(), []);

  async function pollJob(jobId: string) {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) { stopPolling(); return; }
      const data = await res.json();
      setClusterStatus(data);
      if (data.status === "completed" || data.status === "failed") stopPolling();
    } catch { stopPolling(); }
  }

  async function handleCluster() {
    const markets = clusterMarkets.split(",").map(m => m.trim()).filter(Boolean);
    if (!markets.length) return;
    stopPolling();
    setClusterLoading(true); setClusterStatus(null); setClusterError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Scraper-Secret": import.meta.env.VITE_SCRAPER_SECRET ?? "",
        },
        body: JSON.stringify({ cluster_id: 1, markets, max_asins_per_market: 25 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setClusterStatus(data);
      pollRef.current = setInterval(() => pollJob(data.job_id), 1500);
    } catch (e) { setClusterError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setClusterLoading(false); }
  }

  // ── Load Tests ────────────────────────────────────────────────────────────
  const [ltFpKw, setLtFpKw] = useState(FP_DEFAULT_KEYWORDS);
  const [ltFpRunning, setLtFpRunning] = useState(false);
  const [ltFpResults, setLtFpResults] = useState<LtTask[]>([]);
  const [ltFpProgress, setLtFpProgress] = useState({ done: 0, total: 0 });
  const [ltFpWallMs, setLtFpWallMs] = useState<number | null>(null);
  const ltFpAbortRef = useRef(false);
  const ltFpStartRef = useRef(0);

  const [ltProdAsin, setLtProdAsin] = useState(PROD_DEFAULT_ASINS);
  const [ltProdRunning, setLtProdRunning] = useState(false);
  const [ltProdResults, setLtProdResults] = useState<LtTask[]>([]);
  const [ltProdProgress, setLtProdProgress] = useState({ done: 0, total: 0 });
  const [ltProdWallMs, setLtProdWallMs] = useState<number | null>(null);
  const ltProdAbortRef = useRef(false);
  const ltProdStartRef = useRef(0);

  async function fetchWithRetry(
    type: "fp" | "prod",
    item: string,
    maxRetries: number,
    abortRef: { current: boolean },
  ): Promise<LtTask> {
    let attempts = 0, captchas = 0, empties = 0;
    let lastError: string | null = null, lastDuration: number | null = null;

    while (attempts < maxRetries && !abortRef.current) {
      attempts++;
      const t0 = Date.now();
      try {
        const endpoint = type === "fp" ? "/api/scraper/first-page" : "/api/scraper/product";
        const body = type === "fp" ? { keyword: item } : { asin: item };
        const res = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        lastDuration = (Date.now() - t0) / 1000;
        if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
        const data = await res.json();

        if (data.error === "CAPTCHA detected") { captchas++; lastError = "CAPTCHA"; }
        else if (data.error) { lastError = data.error; }
        else if (type === "fp" && (!data.products || data.products.length === 0)) { empties++; lastError = "empty"; }
        else { return { item, attempts, success: true, duration_s: lastDuration, captchas, empties, error: null }; }

        // Delay before retry — avoid hammering the same IP immediately
        if (attempts < maxRetries && !abortRef.current) {
          await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
        }
      } catch (e) {
        lastDuration = (Date.now() - t0) / 1000;
        lastError = e instanceof Error ? e.message : "error";
      }
    }
    return { item, attempts, success: false, duration_s: lastDuration, captchas, empties, error: lastError };
  }

  async function runFpLoadTest() {
    ltFpAbortRef.current = false;
    const items = ltFpKw.split("\n").map(s => s.trim()).filter(Boolean);
    if (!items.length) return;
    setLtFpRunning(true);
    setLtFpResults([]);
    setLtFpProgress({ done: 0, total: items.length });
    setLtFpWallMs(null);
    ltFpStartRef.current = Date.now();

    const results: LtTask[] = [];
    for (let i = 0; i < items.length && !ltFpAbortRef.current; i += 5) {
      const batch = items.slice(i, i + 5);
      const br = await Promise.all(batch.map(it => fetchWithRetry("fp", it, 5, ltFpAbortRef)));
      results.push(...br);
      setLtFpResults([...results]);
      setLtFpProgress({ done: results.length, total: items.length });
    }
    setLtFpWallMs(Date.now() - ltFpStartRef.current);
    setLtFpRunning(false);
  }

  async function runProdLoadTest() {
    ltProdAbortRef.current = false;
    const items = ltProdAsin.split("\n").map(s => s.trim()).filter(Boolean);
    if (!items.length) return;
    setLtProdRunning(true);
    setLtProdResults([]);
    setLtProdProgress({ done: 0, total: items.length });
    setLtProdWallMs(null);
    ltProdStartRef.current = Date.now();

    const results: LtTask[] = [];
    for (let i = 0; i < items.length && !ltProdAbortRef.current; i += 2) {
      const batch = items.slice(i, i + 2);
      const br = await Promise.all(batch.map(it => fetchWithRetry("prod", it, 5, ltProdAbortRef)));
      results.push(...br);
      setLtProdResults([...results]);
      setLtProdProgress({ done: results.length, total: items.length });
    }
    setLtProdWallMs(Date.now() - ltProdStartRef.current);
    setLtProdRunning(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Box>
      <Typography variant="h4" fontWeight={700} mb={4}>Testing</Typography>

      <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
        Scraper — HTTP + Datacenter Proxy
      </Typography>
      <Divider sx={{ mb: 3, mt: 0.5 }} />

      {/* Proxy Test */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: proxyResult || proxyError ? 2 : 0 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>Proxy Test</Typography>
            <Typography variant="caption" color="text.secondary">
              Prüft DC_PROXY_LIST — IP-Routing + Amazon-Erreichbarkeit (~15s).
            </Typography>
          </Box>
          <Button variant="outlined" onClick={handleProxyTest} disabled={proxyLoading}
            startIcon={proxyLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 130, ml: 2, flexShrink: 0 }}>
            {proxyLoading ? "Teste…" : "Proxy testen"}
          </Button>
        </Box>
        {proxyError && <Alert severity="error" sx={{ mt: 1.5 }}>{proxyError}</Alert>}
        {proxyResult && (() => {
          const r = proxyResult;
          if (!r.proxy_configured) {
            return <Alert severity="error" sx={{ mt: 1.5 }}>Proxy nicht konfiguriert — DC_PROXY_LIST fehlt</Alert>;
          }
          const results = (r.results ?? []) as any[];
          const anyOk = results.some((v: any) => v.ok);
          return (
            <Box>
              <Alert severity={anyOk ? "success" : "error"} sx={{ mb: 2 }}>
                {anyOk ? "Proxy funktioniert" : "Proxy-Fehler — alle getesteten IPs schlagen fehl"}
              </Alert>
              <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                Server IP (direkt): <strong>{String(r.direct_ip ?? "–")}</strong>
                &nbsp;·&nbsp; Pool: <strong>{String(r.proxy_count ?? "–")} Proxies</strong>
                &nbsp;·&nbsp; Getestet: <strong>{results.length}</strong>
              </Typography>
              {r.rotation && (() => {
                const rot = r.rotation as any;
                return (
                  <Box sx={{ mb: 2, p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
                    <Typography variant="caption" fontWeight={700} display="block" mb={0.5}>
                      IP-Rotation ({rot.requests_sent} Anfragen)
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                      <Chip
                        label={rot.rotates ? "✓ Rotiert" : rot.sticky ? "⚠ Sticky (gleiche IP)" : "? Unbekannt"}
                        size="small"
                        color={rot.rotates ? "success" : "warning"}
                        sx={{ fontSize: "0.7rem" }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {rot.responses}/{rot.requests_sent} Antworten ·{" "}
                        {rot.unique_ips.length} unique IP{rot.unique_ips.length !== 1 ? "s" : ""}
                        {rot.failed > 0 ? ` · ${rot.failed} Fehler` : ""}
                      </Typography>
                    </Box>
                    {rot.unique_ips.length > 0 && (
                      <Typography variant="caption" sx={{ fontFamily: "monospace", display: "block", mt: 0.5, color: "text.secondary" }}>
                        {rot.unique_ips.join(" · ")}
                      </Typography>
                    )}
                  </Box>
                );
              })()}
              {results.map((v: any, i: number) => (
                <Box key={i} sx={{ mb: 2, pb: 2, borderBottom: i < results.length - 1 ? "1px solid" : "none", borderColor: "divider" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary"
                      sx={{ fontFamily: "monospace", textTransform: "none" }}>
                      {v.proxy}
                    </Typography>
                    <Chip label={v.ok ? "OK" : "FEHLER"} size="small" color={v.ok ? "success" : "error"}
                      sx={{ fontSize: "0.65rem", height: 18 }} />
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", pl: 1 }}>
                    {[
                      { label: "Exit IP", value: v.ip_error ? `Fehler: ${v.ip_error}` : `${v.exit_ip} (${v.ip_ms}ms)`, ok: v.proxy_routing },
                      { label: "Amazon", value: v.amazon_error ? `Fehler: ${v.amazon_error}` : `HTTP ${v.amazon_status} (${v.amazon_ms}ms)${v.amazon_ok ? "" : " — BLOCKIERT"}`, ok: v.amazon_ok },
                    ].map(({ label, value, ok }) => (
                      <>
                        <Typography key={`l-${i}-${label}`} variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>{label}</Typography>
                        <Typography key={`v-${i}-${label}`} variant="caption"
                          sx={{ fontFamily: "monospace", wordBreak: "break-all", color: ok ? "success.main" : "error.main", fontWeight: 600 }}>
                          {value}
                        </Typography>
                      </>
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>
          );
        })()}
      </Paper>

      {/* First Page */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={0.5}>First Page Scraper</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          Amazon Suchergebnisse → ASIN-Liste. HTTP + DC Proxy, ~2–5s.
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75, mb: 1.5, flexWrap: "wrap" }}>
          {["creatine", "yoga mat", "protein powder", "bluetooth speaker"].map(kw => (
            <Chip key={kw} label={kw} size="small" variant="outlined" onClick={() => setFpKeyword(kw)}
              sx={{ cursor: "pointer", fontSize: "0.72rem" }} />
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 2 }}>
          <TextField label="Keyword" size="small" value={fpKeyword}
            onChange={e => setFpKeyword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleFirstPage()}
            disabled={fpLoading} sx={{ flexGrow: 1 }} />
          <Button variant="contained" onClick={handleFirstPage}
            disabled={fpLoading || !fpKeyword.trim()}
            startIcon={fpLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 120 }}>
            {fpLoading ? "Läuft…" : "Run"}
          </Button>
        </Box>
        {fpDuration !== null && !fpLoading && (
          <Typography variant="caption" color="text.secondary" display="block" mb={1}>
            Dauer: <strong>{fpDuration.toFixed(2)}s</strong>
          </Typography>
        )}
        {fpError && <Alert severity="error" sx={{ mb: 1.5 }}>{fpError}</Alert>}
        {fpResult && (() => {
          const r = fpResult as any;
          return (
            <Box>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1.5, flexWrap: "wrap" }}>
                <Chip label={r.error ? r.error : `${r.count} ASINs`} size="small"
                  color={r.error ? "error" : "success"} />
                <Typography variant="caption" color="text.secondary">
                  HTTP {r.http_status} · Proxy: {r.proxy ? "✓" : "–"}
                </Typography>
              </Box>
              <JsonBox data={r} />
            </Box>
          );
        })()}
      </Paper>

      {/* Product Scraper */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={0.5}>Product Scraper</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          Amazon Produktseite → Preis, BLM, BSR, Rating etc. HTTP + DC Proxy, ~2–5s.
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75, mb: 1.5, flexWrap: "wrap" }}>
          {["B0F5WZ4V5N", "B0CTNWBT1Z", "B0FXMWY914", "B0GFWLY9BF", "B01M5KZTAQ"].map(asin => (
            <Chip key={asin} label={asin} size="small" variant="outlined" onClick={() => setProdAsin(asin)}
              sx={{ cursor: "pointer", fontSize: "0.72rem", fontFamily: "monospace" }} />
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 2 }}>
          <TextField label="ASIN" size="small" value={prodAsin}
            onChange={e => setProdAsin(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleProduct()}
            disabled={prodLoading} sx={{ flexGrow: 1 }} />
          <Button variant="contained" onClick={handleProduct}
            disabled={prodLoading || !prodAsin.trim()}
            startIcon={prodLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 120 }}>
            {prodLoading ? "Läuft…" : "Run"}
          </Button>
        </Box>
        {prodDuration !== null && !prodLoading && (
          <Typography variant="caption" color="text.secondary" display="block" mb={1}>
            Dauer: <strong>{prodDuration.toFixed(2)}s</strong>
          </Typography>
        )}
        {prodError && <Alert severity="error" sx={{ mb: 1.5 }}>{prodError}</Alert>}
        {prodResult && (() => {
          const r = prodResult as any;
          return (
            <Box>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1, flexWrap: "wrap" }}>
                <Chip label={r.error ? r.error : "OK"} size="small" color={r.error ? "error" : "success"} />
                <Typography variant="caption" color="text.secondary">
                  HTTP {r.http_status} · Proxy: {r.proxy ? "✓" : "–"}
                </Typography>
              </Box>
              {!r.error && (
                <Typography variant="caption" sx={{ fontFamily: "monospace", display: "block", mb: 1 }}>
                  <a href={`https://www.amazon.com/dp/${r.asin}`} target="_blank" rel="noopener noreferrer">
                    amazon.com/dp/{r.asin}
                  </a>
                </Typography>
              )}
              <JsonBox data={r} />
            </Box>
          );
        })()}
      </Paper>

      {/* Cluster Job */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={0.5}>Cluster Scraping Job</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={2}>
          Komplett-Pipeline: First-Page → ASIN-Details. HTTP + DC Proxy. Polling alle 1.5s.
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75, mb: 1.5, flexWrap: "wrap" }}>
          <Chip label="4 Test-Markets" size="small" variant="outlined"
            onClick={() => setClusterMarkets(DEFAULT_MARKETS)}
            sx={{ cursor: "pointer", fontSize: "0.72rem" }} />
        </Box>
        <TextField label="Markets (komma-separiert)" size="small" fullWidth multiline rows={2}
          value={clusterMarkets} onChange={e => setClusterMarkets(e.target.value)}
          disabled={clusterLoading} sx={{ mb: 2 }} />
        <Button variant="contained" onClick={handleCluster}
          disabled={clusterLoading || !clusterMarkets.trim()}
          startIcon={clusterLoading ? <CircularProgress size={16} color="inherit" /> : null}
          sx={{ mb: 2, minWidth: 140 }}>
          {clusterLoading ? "Erstelle Job…" : "Create Job"}
        </Button>
        {clusterError && <Alert severity="error" sx={{ mb: 1.5 }}>{clusterError}</Alert>}
        {clusterStatus && (
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
              <Chip label={clusterStatus.status} color={statusColor(clusterStatus.status)} size="small" />
              <Typography variant="body2" color="text.secondary">
                {clusterStatus.progress.done} / {clusterStatus.progress.total} Schritte
              </Typography>
              {clusterStatus.status === "running" && <CircularProgress size={14} />}
            </Box>
            {(clusterStatus.status === "pending" || clusterStatus.status === "running") && (
              <LinearProgress variant="determinate"
                value={clusterStatus.progress.total ? (clusterStatus.progress.done / clusterStatus.progress.total) * 100 : 0}
                sx={{ mb: 1.5, borderRadius: 1 }} />
            )}
            <JsonBox data={clusterStatus} />
          </Box>
        )}
      </Paper>

      {/* ── Last-Tests ──────────────────────────────────────────────────────── */}
      <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5} mt={5} display="block">
        Last-Tests — Qualitätsmessung
      </Typography>
      <Divider sx={{ mb: 1.5, mt: 0.5 }} />
      <Typography variant="caption" color="text.secondary" display="block" mb={3} maxWidth={620}>
        Führt alle eingetragenen Keywords / ASINs aus (5 parallel, max. 5 Retries je Anfrage).
        Bei CAPTCHA oder leerem Ergebnis wird automatisch mit neuem Proxy-Call wiederholt — kein Solving-Service.
        Ergibt Erfolgsrate, Captcha-Frequenz, Retry-Bedarf und Latenzverteilung.
      </Typography>

      {/* First Page Load Test */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 660 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={0.5}>First Page — Last-Test</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          Ein Keyword pro Zeile · {ltFpKw.split("\n").filter(Boolean).length} Keywords geladen
        </Typography>
        <TextField multiline rows={6} size="small" fullWidth
          value={ltFpKw} onChange={e => setLtFpKw(e.target.value)}
          disabled={ltFpRunning}
          inputProps={{ style: { fontFamily: "monospace", fontSize: "0.78rem" } }}
          sx={{ mb: 2 }} />
        <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
          <Button variant="contained" size="small" onClick={runFpLoadTest}
            disabled={ltFpRunning || ltProdRunning}
            startIcon={ltFpRunning ? <CircularProgress size={14} color="inherit" /> : null}>
            {ltFpRunning ? `Läuft… (${ltFpProgress.done}/${ltFpProgress.total})` : "Test starten"}
          </Button>
          {ltFpRunning && (
            <Button variant="outlined" size="small" color="error"
              onClick={() => { ltFpAbortRef.current = true; }}>
              Abbrechen
            </Button>
          )}
        </Box>
        {ltFpProgress.total > 0 && (
          <LinearProgress variant="determinate"
            value={(ltFpProgress.done / ltFpProgress.total) * 100}
            sx={{ mb: 2, borderRadius: 1 }} />
        )}
        {ltFpResults.length > 0 && (() => {
          const m = computeLtMetrics(ltFpResults, ltFpWallMs);
          if (!m) return null;
          return (
            <>
              {!ltFpRunning && <LtMetricsGrid m={m} />}
              <LtResultsList results={ltFpResults} />
            </>
          );
        })()}
      </Paper>

      {/* Product Load Test */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 660 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={0.5}>Product Scraper — Last-Test</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          Eine ASIN pro Zeile · {ltProdAsin.split("\n").filter(Boolean).length} ASINs geladen
        </Typography>
        <TextField multiline rows={6} size="small" fullWidth
          value={ltProdAsin} onChange={e => setLtProdAsin(e.target.value)}
          disabled={ltProdRunning}
          inputProps={{ style: { fontFamily: "monospace", fontSize: "0.78rem" } }}
          sx={{ mb: 2 }} />
        <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
          <Button variant="contained" size="small" onClick={runProdLoadTest}
            disabled={ltFpRunning || ltProdRunning}
            startIcon={ltProdRunning ? <CircularProgress size={14} color="inherit" /> : null}>
            {ltProdRunning ? `Läuft… (${ltProdProgress.done}/${ltProdProgress.total})` : "Test starten"}
          </Button>
          {ltProdRunning && (
            <Button variant="outlined" size="small" color="error"
              onClick={() => { ltProdAbortRef.current = true; }}>
              Abbrechen
            </Button>
          )}
        </Box>
        {ltProdProgress.total > 0 && (
          <LinearProgress variant="determinate"
            value={(ltProdProgress.done / ltProdProgress.total) * 100}
            sx={{ mb: 2, borderRadius: 1 }} />
        )}
        {ltProdResults.length > 0 && (() => {
          const m = computeLtMetrics(ltProdResults, ltProdWallMs);
          if (!m) return null;
          return (
            <>
              {!ltProdRunning && <LtMetricsGrid m={m} />}
              <LtResultsList results={ltProdResults} />
            </>
          );
        })()}
      </Paper>
    </Box>
  );
}
