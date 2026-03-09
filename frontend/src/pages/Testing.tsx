import { useEffect, useRef, useState } from "react";
import {
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
  ToggleButton,
  ToggleButtonGroup,
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
  const [scraperCountry, setScraperCountry] = useState<string | null>(null);
  const [scraperLoading, setScraperLoading] = useState(false);
  const [scraperResult, setScraperResult] = useState<unknown>(null);
  const [scraperError, setScraperError] = useState<string | null>(null);
  const [scraperDuration, setScraperDuration] = useState<number | null>(null);

  // Real product scraper
  const [productAsin, setProductAsin] = useState("");
  const [productHeadless, setProductHeadless] = useState(true);
  const [productLoading, setProductLoading] = useState(false);
  const [productResult, setProductResult] = useState<unknown>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [productDuration, setProductDuration] = useState<number | null>(null);
  const [deletingScreenshots, setDeletingScreenshots] = useState(false);

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
    const t0 = Date.now();
    try {
      const res = await fetch("/api/scraper/first-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: scraperKeyword.trim(), headless: scraperHeadless, test_screenshot: true, country: scraperCountry }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setScraperResult(await res.json());
    } catch (e) {
      setScraperError(e instanceof Error ? e.message : "Unknown error");
    } finally {
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

      <Paper variant="outlined" sx={{ p: 3, maxWidth: 600, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={2}>Amazon First Page Scraper</Typography>
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1, flexWrap: "wrap" }}>
          <Typography variant="caption" color="text.secondary">Land:</Typography>
          <ToggleButtonGroup
            value={scraperCountry}
            exclusive
            onChange={(_, val) => setScraperCountry(val)}
            size="small"
            disabled={scraperLoading}
          >
            <ToggleButton value="us" sx={{ fontSize: "0.72rem", py: 0.25, px: 1 }}>🇺🇸 USA</ToggleButton>
            <ToggleButton value="de" sx={{ fontSize: "0.72rem", py: 0.25, px: 1 }}>🇩🇪 DE</ToggleButton>
            <ToggleButton value="fr" sx={{ fontSize: "0.72rem", py: 0.25, px: 1 }}>🇫🇷 FR</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.disabled">
            {scraperCountry ? `→ proxy country-${scraperCountry}` : "→ proxy country-us (default)"}
          </Typography>
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

      <Paper variant="outlined" sx={{ p: 3, maxWidth: 600, mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={2}>Amazon Product Scraper</Typography>
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
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 600, mb: 4 }}>
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
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 600, mb: 3 }}>
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
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 600, mb: 3 }}>
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
