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
        body: JSON.stringify({ asin: productAsin.trim(), headless: productHeadless, test_screenshot: true }),
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
          const variantLabels = ["Raw (kein Suffix)", "nbbbwudu-US-1 (uppercase)", "nbbbwudu-us-1 (lowercase)"];
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
          {["B0F5WZ4V5N", "B0CTNWBT1Z"].map((asin) => (
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
        {productDuration !== null && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Dauer: <strong>{productDuration.toFixed(2)}s</strong>
          </Typography>
        )}
        {productError && <Typography color="error" variant="body2" mb={1}>Fehler: {productError}</Typography>}
        {productResult && (
          <Box>
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
