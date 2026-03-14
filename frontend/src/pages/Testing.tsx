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
  Typography,
} from "@mui/material";

const DEFAULT_MARKETS = "creatine,protein powder,yoga mat,resistance bands";

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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cluster_id: 1, markets, max_asins_per_market: 25 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setClusterStatus(data);
      pollRef.current = setInterval(() => pollJob(data.job_id), 1500);
    } catch (e) { setClusterError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setClusterLoading(false); }
  }

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
    </Box>
  );
}
