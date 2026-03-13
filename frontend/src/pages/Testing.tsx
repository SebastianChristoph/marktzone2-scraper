import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  LinearProgress,
  Paper,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { isLocal } from "../utils/debug";

const DEFAULT_ASINS = "B07XYZABC1,B08QRSTUVW,B09MNOPQR2,B06DEFGHIJ,B01KLMNOPQ";
const DEFAULT_MARKETS = "Bluetooth Lautsprecher,Fitness Tracker,Luftbefeuchter";
const EXPL_MARKETS = "creatine,protein powder,yoga mat,resistance bands";

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
  // Real first-page scraper
  const [scraperKeyword, setScraperKeyword] = useState("");
  const [scraperHeadless, setScraperHeadless] = useState(true);

  const [scraperLoading, setScraperLoading] = useState(false);
  const [scraperResult, setScraperResult] = useState<unknown>(null);
  const [scraperError, setScraperError] = useState<string | null>(null);
  const [scraperDuration, setScraperDuration] = useState<number | null>(null);
  const [scraperElapsed, setScraperElapsed] = useState(0);
  const scraperTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Real product scraper
  const [productAsin, setProductAsin] = useState("");
  const [productHeadless, setProductHeadless] = useState(true);
  const [productUseProxy, setProductUseProxy] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [productResult, setProductResult] = useState<unknown>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [productDuration, setProductDuration] = useState<number | null>(null);
  const [deletingScreenshots, setDeletingScreenshots] = useState(false);

  // Proxy test
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyResult, setProxyResult] = useState<Record<string, unknown> | null>(null);
  const [proxyError, setProxyError] = useState<string | null>(null);

  async function handleProxyTest() {
    setProxyLoading(true);
    setProxyResult(null);
    setProxyError(null);
    try {
      const res = await fetch("/api/proxy-test");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProxyResult(await res.json());
    } catch (e) {
      setProxyError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setProxyLoading(false);
    }
  }

  async function handleDeleteTestScreenshots() {
    setDeletingScreenshots(true);
    try {
      await fetch("/api/scraper/test-screenshots", { method: "DELETE" });
      setProductResult(null);
    } finally {
      setDeletingScreenshots(false);
    }
  }

  async function handleProductScrape() {
    if (!productAsin.trim()) return;
    setProductLoading(true);
    setProductResult(null);
    setProductError(null);
    setProductDuration(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/scraper/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin: productAsin.trim(), headless: productHeadless, test_screenshot: true, use_proxy: productUseProxy }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProductResult(await res.json());
    } catch (e) {
      setProductError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setProductDuration((Date.now() - t0) / 1000);
      setProductLoading(false);
    }
  }

  async function handleRealScrape() {
    if (!scraperKeyword.trim()) return;
    setScraperLoading(true);
    setScraperResult(null);
    setScraperError(null);
    setScraperDuration(null);
    setScraperElapsed(0);
    const t0 = Date.now();
    scraperTimerRef.current = setInterval(() => {
      setScraperElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 500);
    try {
      const res = await fetch("/api/scraper/first-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: scraperKeyword.trim(), headless: scraperHeadless, test_screenshot: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setScraperResult(await res.json());
    } catch (e) {
      setScraperError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (scraperTimerRef.current) { clearInterval(scraperTimerRef.current); scraperTimerRef.current = null; }
      setScraperDuration((Date.now() - t0) / 1000);
      setScraperLoading(false);
    }
  }

  // ── Explorativ (raw HTTP) ────────────────────────────────────────────────
  const [explFpKeyword, setExplFpKeyword] = useState("");
  const [explFpLoading, setExplFpLoading] = useState(false);
  const [explFpResult, setExplFpResult] = useState<unknown>(null);
  const [explFpError, setExplFpError] = useState<string | null>(null);

  const [explProdAsin, setExplProdAsin] = useState("");
  const [explProdLoading, setExplProdLoading] = useState(false);
  const [explProdResult, setExplProdResult] = useState<unknown>(null);
  const [explProdError, setExplProdError] = useState<string | null>(null);

  const [explClusterMarkets, setExplClusterMarkets] = useState(EXPL_MARKETS);
  const [explClusterLoading, setExplClusterLoading] = useState(false);
  const [explClusterResult, setExplClusterResult] = useState<unknown>(null);
  const [explClusterError, setExplClusterError] = useState<string | null>(null);
  const [explClusterElapsed, setExplClusterElapsed] = useState(0);
  const explClusterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleExplFirstPage() {
    if (!explFpKeyword.trim()) return;
    setExplFpLoading(true); setExplFpResult(null); setExplFpError(null);
    try {
      const res = await fetch("/api/exploratory/first-page", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: explFpKeyword.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setExplFpResult(await res.json());
    } catch (e) { setExplFpError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setExplFpLoading(false); }
  }

  async function handleExplProduct() {
    if (!explProdAsin.trim()) return;
    setExplProdLoading(true); setExplProdResult(null); setExplProdError(null);
    try {
      const res = await fetch("/api/exploratory/product", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin: explProdAsin.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setExplProdResult(await res.json());
    } catch (e) { setExplProdError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setExplProdLoading(false); }
  }

  async function handleExplCluster() {
    const markets = explClusterMarkets.split(",").map(m => m.trim()).filter(Boolean);
    if (!markets.length) return;
    setExplClusterLoading(true); setExplClusterResult(null); setExplClusterError(null);
    setExplClusterElapsed(0);
    const t0 = Date.now();
    explClusterTimerRef.current = setInterval(() => {
      setExplClusterElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 500);
    try {
      const res = await fetch("/api/exploratory/cluster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markets, concurrency: 10 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setExplClusterResult(await res.json());
    } catch (e) { setExplClusterError(e instanceof Error ? e.message : "Unknown error"); }
    finally {
      if (explClusterTimerRef.current) { clearInterval(explClusterTimerRef.current); explClusterTimerRef.current = null; }
      setExplClusterLoading(false);
    }
  }

  // First page scrape (dummy)
  const [marketName, setMarketName] = useState("");
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<unknown>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  // ASIN detail scrape
  const [asins, setAsins] = useState(DEFAULT_ASINS);
  const [asinLoading, setAsinLoading] = useState(false);
  const [asinResult, setAsinResult] = useState<unknown>(null);
  const [asinError, setAsinError] = useState<string | null>(null);

  // Job
  const [jobMarkets, setJobMarkets] = useState(DEFAULT_MARKETS);
  const [jobClusterId, setJobClusterId] = useState("1");
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<{
    job_id: string; cluster_id: number; status: string;
    progress: { done: number; total: number }; errors: string[]; created_at: string;
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
      setJobStatus(data);
      if (data.status === "completed" || data.status === "failed") stopPolling();
    } catch { stopPolling(); }
  }

  async function handleCreateJob() {
    const markets = jobMarkets.split(",").map((m) => m.trim()).filter(Boolean);
    if (!markets.length || !jobClusterId.trim()) return;
    stopPolling();
    setJobLoading(true);
    setJobStatus(null);
    setJobError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cluster_id: parseInt(jobClusterId), markets, max_asins_per_market: 25 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setJobStatus(data);
      pollRef.current = setInterval(() => pollJob(data.job_id), 1500);
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setJobLoading(false);
    }
  }

  async function handleScrape() {
    if (!marketName.trim()) return;
    setScrapeLoading(true); setScrapeResult(null); setScrapeError(null);
    try {
      const res = await fetch("/api/dummy/scrape", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_name: marketName.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setScrapeResult(await res.json());
    } catch (e) { setScrapeError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setScrapeLoading(false); }
  }

  async function handleAsinScrape() {
    const list = asins.split(",").map((a) => a.trim()).filter(Boolean);
    if (!list.length) return;
    setAsinLoading(true); setAsinResult(null); setAsinError(null);
    try {
      const res = await fetch("/api/dummy/scrape-asins", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asins: list }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAsinResult(await res.json());
    } catch (e) { setAsinError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setAsinLoading(false); }
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} mb={4}>Testing</Typography>

      <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
        Scraper
      </Typography>
      <Divider sx={{ mb: 3, mt: 0.5 }} />

      {/* Proxy Test */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: proxyResult || proxyError ? 2 : 0 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>Proxy Test</Typography>
            <Typography variant="caption" color="text.secondary">
              Prüft ob der Proxy korrekt konfiguriert ist und Amazon erreichbar ist (kein Playwright, ~15s).
            </Typography>
          </Box>
          <Button
            variant="outlined"
            onClick={handleProxyTest}
            disabled={proxyLoading}
            startIcon={proxyLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 130, ml: 2, flexShrink: 0 }}
          >
            {proxyLoading ? "Teste…" : "Proxy testen"}
          </Button>
        </Box>
        {proxyError && <Alert severity="error" sx={{ mt: 1.5 }}>{proxyError}</Alert>}
        {proxyResult && (() => {
          const r = proxyResult;
          if (!r.proxy_configured) {
            return <Alert severity="error" sx={{ mt: 1.5 }}>Proxy nicht konfiguriert — WEBSHARE_PROXY_URL fehlt</Alert>;
          }

          type Variant = {
            username: string;
            ip_result: { ip: string | null; ms: number | null; status_code: number | null; error: string | null };
            amazon_result: { status_code: number | null; ms: number | null; blocked: boolean; error: string | null };
            proxy_working: boolean;
            amazon_ok: boolean;
          };

          const variants = (r.variants ?? []) as Variant[];
          const variantLabels = ["Raw (kein Suffix)", ...variants.slice(1).map((v) => v.username)];
          const anyOk = variants.some((v) => v.proxy_working && v.amazon_ok);

          return (
            <Box>
              <Alert severity={anyOk ? "success" : "error"} sx={{ mb: 2 }}>
                {anyOk ? "Proxy funktioniert" : "Beide Varianten schlagen fehl"}
              </Alert>
              <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                Server IP (direkt): <strong>{String(r.direct_ip ?? "–")}</strong> &nbsp;·&nbsp; Proxy: <strong>{String(r.proxy_server ?? "–")}</strong>
              </Typography>
              {variants.map((v, i) => {
                const allOk = v.proxy_working && v.amazon_ok;
                const rows = [
                  { label: "Username", value: v.username },
                  {
                    label: "Exit IP",
                    value: v.ip_result.error ? `Fehler: ${v.ip_result.error}` : `${v.ip_result.ip} (${v.ip_result.ms}ms)`,
                    ok: v.proxy_working,
                  },
                  {
                    label: "Amazon",
                    value: v.amazon_result.error
                      ? `Fehler: ${v.amazon_result.error}`
                      : `HTTP ${v.amazon_result.status_code} (${v.amazon_result.ms}ms)${v.amazon_result.blocked ? " — BLOCKIERT" : ""}`,
                    ok: v.amazon_ok,
                  },
                ];
                return (
                  <Box key={i} sx={{ mb: 2, pb: 2, borderBottom: i < variants.length - 1 ? "1px solid" : "none", borderColor: "divider" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 1 }}>
                        {variantLabels[i] ?? `Variante ${i + 1}`}
                      </Typography>
                      <Chip label={allOk ? "OK" : "FEHLER"} size="small" color={allOk ? "success" : "error"} sx={{ fontSize: "0.65rem", height: 18 }} />
                    </Box>
                    <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", alignItems: "baseline", pl: 1 }}>
                      {rows.map(({ label: rl, value, ok: rowOk }) => (
                        <>
                          <Typography key={`l-${i}-${rl}`} variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>{rl}</Typography>
                          <Typography key={`v-${i}-${rl}`} variant="caption" sx={{
                            fontFamily: "monospace", wordBreak: "break-all",
                            color: rowOk === true ? "success.main" : rowOk === false ? "error.main" : "text.primary",
                            fontWeight: rowOk != null ? 600 : 400,
                          }}>{value}</Typography>
                        </>
                      ))}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          );
        })()}
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={1.5}>Amazon First Page Scraper</Typography>
        <Box sx={{ display: "flex", gap: 0.75, mb: 1.5, flexWrap: "wrap" }}>
          {["Creatine", "Organic red beet"].map((kw) => (
            <Chip key={kw} label={kw} size="small" variant="outlined" onClick={() => setScraperKeyword(kw)}
              sx={{ cursor: "pointer", fontSize: "0.72rem" }} />
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 2 }}>
          <TextField
            label="Keyword"
            size="small"
            value={scraperKeyword}
            onChange={(e) => setScraperKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRealScrape()}
            disabled={scraperLoading}
            sx={{ flexGrow: 1 }}
          />
          <Button
            variant="contained"
            onClick={handleRealScrape}
            disabled={scraperLoading || !scraperKeyword.trim()}
            startIcon={scraperLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 120 }}
          >
            {scraperLoading ? "Scraping…" : "Run Scrape"}
          </Button>
        </Box>
        {isLocal && (
          <FormControlLabel
            control={
              <Switch
                checked={!scraperHeadless}
                onChange={(e) => setScraperHeadless(!e.target.checked)}
                disabled={scraperLoading}
                size="small"
              />
            }
            label={<Typography variant="caption">Browser sichtbar (nicht headless)</Typography>}
            sx={{ mb: 1 }}
          />
        )}
        {scraperLoading && (() => {
          const s = scraperElapsed;
          const status =
            s < 30 ? `Versuch 1/3 — Amazon lädt… (${s}s)` :
            s < 40 ? `Backoff 10s nach Versuch 1… (${s}s)` :
            s < 70 ? `Versuch 2/3 — erneuter Versuch… (${s}s)` :
            s < 100 ? `Backoff 30s nach Versuch 2… (${s}s)` :
            `Versuch 3/3 — letzter Versuch… (${s}s)`;
          const progress = Math.min((s / 130) * 100, 98);
          return (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                {status}
              </Typography>
              <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: 1 }} />
            </Box>
          );
        })()}
        {scraperDuration !== null && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Dauer: <strong>{scraperDuration.toFixed(2)}s</strong>
          </Typography>
        )}
        {scraperError && <Typography color="error" variant="body2" mb={1}>Fehler: {scraperError}</Typography>}
        {scraperResult && (
          <Box>
            {(scraperResult as any).debug && (
              <Box sx={{ mb: 1.5, p: 1.5, bgcolor: "action.hover", borderRadius: 1, fontSize: "0.78rem", fontFamily: "monospace" }}>
                <Typography variant="caption" fontWeight={700} display="block" mb={0.5}>Debug</Typography>
                <Box>Proxy: <strong>{(scraperResult as any).debug.proxy}</strong></Box>
                <Box>Attempts: <strong>{(scraperResult as any).debug.attempts}</strong></Box>
                <Box sx={{ wordBreak: "break-all" }}>UA: {(scraperResult as any).debug.user_agent}</Box>
              </Box>
            )}
            <JsonBox data={scraperResult} />
            {(scraperResult as any).test_screenshot && (
              <Box mt={2}>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  Screenshot (search results page at scrape time):
                </Typography>
                <a
                  href={`/api/static/screenshots/${(scraperResult as any).test_screenshot}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={`/api/static/screenshots/${(scraperResult as any).test_screenshot}`}
                    alt="test screenshot"
                    style={{ maxWidth: "100%", borderRadius: 4, border: "1px solid #ddd", cursor: "zoom-in", display: "block" }}
                  />
                </a>
              </Box>
            )}
          </Box>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={1.5}>Amazon Product Scraper</Typography>
        <Box sx={{ display: "flex", gap: 0.75, mb: 1.5, flexWrap: "wrap" }}>
          {["B0F5WZ4V5N", "B0CTNWBT1Z", "B0FXMWY914", "B0GFWLY9BF", "B01M5KZTAQ"].map((asin) => (
            <Chip key={asin} label={asin} size="small" variant="outlined" onClick={() => setProductAsin(asin)}
              sx={{ cursor: "pointer", fontSize: "0.72rem", fontFamily: "monospace" }} />
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 2 }}>
          <TextField
            label="ASIN"
            size="small"
            value={productAsin}
            onChange={(e) => setProductAsin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleProductScrape()}
            disabled={productLoading}
            sx={{ flexGrow: 1 }}
          />
          <Button
            variant="contained"
            onClick={handleProductScrape}
            disabled={productLoading || !productAsin.trim()}
            startIcon={productLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 120 }}
          >
            {productLoading ? "Scraping…" : "Run Scrape"}
          </Button>
        </Box>
        {isLocal && (
          <FormControlLabel
            control={
              <Switch
                checked={!productHeadless}
                onChange={(e) => setProductHeadless(!e.target.checked)}
                disabled={productLoading}
                size="small"
              />
            }
            label={<Typography variant="caption">Browser sichtbar (nicht headless)</Typography>}
            sx={{ mb: 1 }}
          />
        )}
        <FormControlLabel
          control={
            <Switch
              checked={productUseProxy}
              onChange={(e) => setProductUseProxy(e.target.checked)}
              disabled={productLoading}
              size="small"
            />
          }
          label={<Typography variant="caption">Proxy verwenden (erzwingt einzelnen Versuch)</Typography>}
          sx={{ mb: 1 }}
        />
        {productDuration !== null && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Dauer: <strong>{productDuration.toFixed(2)}s</strong>
          </Typography>
        )}
        {productError && <Typography color="error" variant="body2" mb={1}>Fehler: {productError}</Typography>}
        {productResult && (
          <Box>
            <Box sx={{ mb: 1.5 }}>
              <a href={`https://www.amazon.com/dp/${productAsin.trim()}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: "0.82rem", fontFamily: "monospace" }}>
                amazon.com/dp/{productAsin.trim()}
              </a>
            </Box>
            <JsonBox data={productResult} />
            {(productResult as any).test_screenshot && (
              <Box mt={2}>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  Screenshot (product page at scrape time):
                </Typography>
                <a
                  href={`/api/static/screenshots/${(productResult as any).test_screenshot}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={`/api/static/screenshots/${(productResult as any).test_screenshot}`}
                    alt="test screenshot"
                    style={{ maxWidth: "100%", borderRadius: 4, border: "1px solid #ddd", cursor: "zoom-in", display: "block" }}
                  />
                </a>
              </Box>
            )}
            <Box mt={1.5}>
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={deletingScreenshots}
                onClick={handleDeleteTestScreenshots}
              >
                {deletingScreenshots ? "Deleting…" : "Delete test screenshots"}
              </Button>
            </Box>
          </Box>
        )}
      </Paper>

      {/* Real cluster job */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={0.5}>Cluster Scraping Job (real)</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={2}>
          Startet einen echten Job: First-Page → ASIN-Details. Polling alle 1.5s.
        </Typography>
        <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
          <TextField label="Cluster ID" size="small" value={jobClusterId}
            onChange={(e) => setJobClusterId(e.target.value)} disabled={jobLoading} sx={{ width: 110 }} />
          <TextField label="Markets (komma-separiert)" size="small" value={jobMarkets}
            onChange={(e) => setJobMarkets(e.target.value)} disabled={jobLoading} sx={{ flexGrow: 1 }} />
        </Box>
        <Button variant="contained" onClick={handleCreateJob}
          disabled={jobLoading || !jobMarkets.trim()}
          startIcon={jobLoading ? <CircularProgress size={16} color="inherit" /> : null}
          sx={{ mb: 2, minWidth: 140 }}>
          {jobLoading ? "Erstelle Job…" : "Create Job"}
        </Button>
        {jobError && <Typography color="error" variant="body2" mb={1}>Fehler: {jobError}</Typography>}
        {jobStatus && (
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
              <Chip label={jobStatus.status} color={statusColor(jobStatus.status)} size="small" />
              <Typography variant="body2" color="text.secondary">
                {jobStatus.progress.done} / {jobStatus.progress.total} Schritte
              </Typography>
              {jobStatus.status === "running" && <CircularProgress size={14} />}
            </Box>
            {(jobStatus.status === "pending" || jobStatus.status === "running") && (
              <LinearProgress variant="determinate"
                value={jobStatus.progress.total ? (jobStatus.progress.done / jobStatus.progress.total) * 100 : 0}
                sx={{ mb: 1.5, borderRadius: 1 }} />
            )}
            <JsonBox data={jobStatus} />
          </Box>
        )}
      </Paper>

      {/* ═════════ EXPLORATIV (raw HTTP) ═════════ */}
      <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
        Explorativ — Raw HTTP (kein Playwright, kein Proxy)
      </Typography>
      <Divider sx={{ mb: 3, mt: 0.5 }} />

      {/* Expl: First Page */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={0.5}>First Page — HTTP</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          Einzelner HTTP-Request an Amazon Search. Kein Browser, kein Proxy. ~2-3s.
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75, mb: 1.5, flexWrap: "wrap" }}>
          {["creatine", "yoga mat", "protein powder", "bluetooth speaker"].map((kw) => (
            <Chip key={kw} label={kw} size="small" variant="outlined" onClick={() => setExplFpKeyword(kw)}
              sx={{ cursor: "pointer", fontSize: "0.72rem" }} />
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 2 }}>
          <TextField label="Keyword" size="small" value={explFpKeyword}
            onChange={e => setExplFpKeyword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleExplFirstPage()}
            disabled={explFpLoading} sx={{ flexGrow: 1 }} />
          <Button variant="contained" onClick={handleExplFirstPage}
            disabled={explFpLoading || !explFpKeyword.trim()}
            startIcon={explFpLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 120 }}>
            {explFpLoading ? "Läuft…" : "Run"}
          </Button>
        </Box>
        {explFpError && <Alert severity="error" sx={{ mb: 1.5 }}>{explFpError}</Alert>}
        {explFpResult && (() => {
          const r = explFpResult as any;
          const hasError = !!r.error;
          return (
            <Box>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1.5, flexWrap: "wrap" }}>
                <Chip label={hasError ? r.error : `${r.count} ASINs`} size="small"
                  color={hasError ? "error" : "success"} />
                <Typography variant="caption" color="text.secondary">
                  {r.duration_s}s · HTTP {r.http_status} · {r.method}
                </Typography>
              </Box>
              <JsonBox data={r} />
            </Box>
          );
        })()}
      </Paper>

      {/* Expl: Product */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={0.5}>Product — HTTP</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          Einzelner HTTP-Request an Amazon Produktseite. Parst Preis, BSR, BLM, Rating etc. ~2-3s.
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75, mb: 1.5, flexWrap: "wrap" }}>
          {["B0F5WZ4V5N", "B0CTNWBT1Z", "B0FXMWY914", "B0GFWLY9BF", "B01M5KZTAQ"].map((asin) => (
            <Chip key={asin} label={asin} size="small" variant="outlined" onClick={() => setExplProdAsin(asin)}
              sx={{ cursor: "pointer", fontSize: "0.72rem", fontFamily: "monospace" }} />
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 2 }}>
          <TextField label="ASIN" size="small" value={explProdAsin}
            onChange={e => setExplProdAsin(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleExplProduct()}
            disabled={explProdLoading} sx={{ flexGrow: 1 }} />
          <Button variant="contained" onClick={handleExplProduct}
            disabled={explProdLoading || !explProdAsin.trim()}
            startIcon={explProdLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 120 }}>
            {explProdLoading ? "Läuft…" : "Run"}
          </Button>
        </Box>
        {explProdError && <Alert severity="error" sx={{ mb: 1.5 }}>{explProdError}</Alert>}
        {explProdResult && (() => {
          const r = explProdResult as any;
          const hasError = !!r.error;
          return (
            <Box>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1, flexWrap: "wrap" }}>
                <Chip label={hasError ? r.error : "OK"} size="small" color={hasError ? "error" : "success"} />
                <Typography variant="caption" color="text.secondary">
                  {r.duration_s}s · HTTP {r.http_status} · {r.method}
                </Typography>
              </Box>
              {!hasError && (
                <Box sx={{ mb: 1.5 }}>
                  <a href={`https://www.amazon.com/dp/${r.asin}`} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: "0.82rem", fontFamily: "monospace" }}>
                    amazon.com/dp/{r.asin}
                  </a>
                </Box>
              )}
              <JsonBox data={r} />
            </Box>
          );
        })()}
      </Paper>

      {/* Expl: Cluster */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={0.5}>Cluster — HTTP (Full Pipeline)</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          Komplett-Test: Markets scrapen → ASINs sammeln → alle Produkte scrapen. 10 parallele HTTP-Requests. Kein Playwright, kein Proxy.
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75, mb: 1.5, flexWrap: "wrap" }}>
          <Chip label="4 Test-Markets" size="small" variant="outlined"
            onClick={() => setExplClusterMarkets(EXPL_MARKETS)}
            sx={{ cursor: "pointer", fontSize: "0.72rem" }} />
        </Box>
        <TextField label="Markets (komma-separiert)" size="small" fullWidth multiline rows={2}
          value={explClusterMarkets} onChange={e => setExplClusterMarkets(e.target.value)}
          disabled={explClusterLoading} sx={{ mb: 2 }} />
        <Button variant="contained" onClick={handleExplCluster}
          disabled={explClusterLoading || !explClusterMarkets.trim()}
          startIcon={explClusterLoading ? <CircularProgress size={16} color="inherit" /> : null}
          sx={{ mb: 2, minWidth: 140 }}>
          {explClusterLoading ? `Läuft… ${explClusterElapsed}s` : "Run Cluster"}
        </Button>
        {explClusterLoading && (
          <Box sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
              {explClusterElapsed < 10 ? "Phase 1: Markets scrapen…" : "Phase 2: Produkte scrapen…"} ({explClusterElapsed}s)
            </Typography>
            <LinearProgress sx={{ borderRadius: 1 }} />
          </Box>
        )}
        {explClusterError && <Alert severity="error" sx={{ mb: 1.5 }}>{explClusterError}</Alert>}
        {explClusterResult && (() => {
          const r = explClusterResult as any;
          return (
            <Box>
              <Box sx={{ display: "flex", gap: 1, mb: 1.5, flexWrap: "wrap", alignItems: "center" }}>
                <Chip label={`${r.products_scraped} Produkte`} size="small" color="success" />
                {r.products_failed > 0 && (
                  <Chip label={`${r.products_failed} Fehler`} size="small" color="error" />
                )}
                <Typography variant="caption" color="text.secondary">
                  {r.unique_asins} ASINs · {r.markets_count} Markets · {r.duration_s}s · {r.concurrency}x parallel
                </Typography>
              </Box>
              {/* Summary table */}
              <Box sx={{ mb: 2, p: 1.5, bgcolor: "action.hover", borderRadius: 1, fontSize: "0.78rem", fontFamily: "monospace" }}>
                <Typography variant="caption" fontWeight={700} display="block" mb={0.5}>Zusammenfassung</Typography>
                {r.markets && Object.entries(r.markets).map(([kw, data]: [string, any]) => (
                  <Box key={kw}>
                    {kw}: <strong>{data.count ?? 0} ASINs</strong> ({data.duration_s}s)
                    {data.error && <span style={{ color: "#d32f2f" }}> — {data.error}</span>}
                  </Box>
                ))}
                <Divider sx={{ my: 1 }} />
                <Box>Produkte OK: <strong>{r.products_scraped}</strong> / Fehler: <strong>{r.products_failed}</strong></Box>
                <Box>Felder-Abdeckung (von {r.products_scraped} OK-Produkten):</Box>
                {r.products_scraped > 0 && (() => {
                  const prods = r.products as any[];
                  const fields = ["title", "price", "blm", "avg_rating", "ratings", "main_category", "main_category_rank", "store", "img_path"];
                  return fields.map(f => {
                    const count = prods.filter(p => p[f] != null).length;
                    const pct = Math.round(count / prods.length * 100);
                    return (
                      <Box key={f} sx={{ pl: 1 }}>
                        {f}: <strong>{count}/{prods.length}</strong> ({pct}%)
                        <span style={{ color: pct >= 80 ? "#2e7d32" : pct >= 50 ? "#ed6c02" : "#d32f2f", fontWeight: 600, marginLeft: 8 }}>
                          {pct >= 80 ? "GUT" : pct >= 50 ? "OK" : "SCHWACH"}
                        </span>
                      </Box>
                    );
                  });
                })()}
              </Box>
              <JsonBox data={r} />
            </Box>
          );
        })()}
      </Paper>

      <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
        Dummy Data
      </Typography>
      <Divider sx={{ mb: 3, mt: 0.5 }} />

      {/* First page scrape */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={2}>Amazon First Page Scraping simulieren</Typography>
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 2 }}>
          <TextField label="Market Name" size="small" value={marketName}
            onChange={(e) => setMarketName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleScrape()}
            disabled={scrapeLoading} sx={{ flexGrow: 1 }} />
          <Button variant="contained" onClick={handleScrape}
            disabled={scrapeLoading || !marketName.trim()}
            startIcon={scrapeLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 120 }}>
            {scrapeLoading ? "Scraping…" : "Run Scrape"}
          </Button>
        </Box>
        {scrapeError && <Typography color="error" variant="body2" mb={1}>Fehler: {scrapeError}</Typography>}
        {scrapeResult && <JsonBox data={scrapeResult} />}
      </Paper>

      {/* ASIN detail scrape */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: "100%", sm: 600 }, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={2}>Amazon ASIN Detail Scraping simulieren</Typography>
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 2 }}>
          <TextField label="ASINs (komma-separiert)" size="small" value={asins}
            onChange={(e) => setAsins(e.target.value)} disabled={asinLoading} sx={{ flexGrow: 1 }} />
          <Button variant="contained" onClick={handleAsinScrape}
            disabled={asinLoading || !asins.trim()}
            startIcon={asinLoading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ whiteSpace: "nowrap", minWidth: 120 }}>
            {asinLoading ? "Scraping…" : "Run Scrape"}
          </Button>
        </Box>
        {asinError && <Typography color="error" variant="body2" mb={1}>Fehler: {asinError}</Typography>}
        {asinResult && <JsonBox data={asinResult} />}
      </Paper>

    </Box>
  );
}
