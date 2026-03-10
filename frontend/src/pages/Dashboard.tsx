import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  TextField,
} from "@mui/material";

interface DailySession {
  session_id: string;
  started_at: string;
  status: string;
  phase: string;
  markets_total: number;
  markets_done: number;
  markets_errors: number;
  asins_total: number;
  asins_done: number;
  asins_errors: number;
  products_updated: number;
  products_new: number;
  markets_changed: number;
}

const PHASE_LABELS: Record<string, string> = {
  market_discovery: "Phase 1 — Market Discovery",
  product_scraping: "Phase 2 — Product Scraping",
  market_aggregation: "Phase 3 — Market Aggregation",
  cluster_update: "Phase 4 — Cluster Update",
  done: "Abgeschlossen",
};

function DailyRunCard({ session }: { session: DailySession }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(session.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session.started_at]);

  const fmtTime = (s: number) =>
    s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  const isProductPhase = session.phase === "product_scraping";
  const progressValue = isProductPhase && session.asins_total > 0
    ? (session.asins_done / session.asins_total) * 100
    : session.markets_total > 0
    ? (session.markets_done / session.markets_total) * 100
    : null;

  const progressLabel = isProductPhase
    ? `${session.asins_done} / ${session.asins_total} ASINs`
    : `${session.markets_done} / ${session.markets_total} Markets`;

  const errors = session.markets_errors + session.asins_errors;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5, mb: 3,
        borderColor: "primary.main",
        borderWidth: 1.5,
        bgcolor: "action.hover",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
        <CircularProgress size={16} />
        <Typography variant="subtitle2" fontWeight={700} color="primary.main">
          Daily Scraper — läuft
        </Typography>
        <Chip
          label={PHASE_LABELS[session.phase] ?? session.phase}
          size="small"
          color="primary"
          variant="outlined"
        />
        <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
          {fmtTime(elapsed)}
        </Typography>
      </Box>

      <LinearProgress
        variant={progressValue !== null ? "determinate" : "indeterminate"}
        value={progressValue ?? 0}
        sx={{ borderRadius: 1, mb: 1 }}
      />

      <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        <Typography variant="caption" color="text.secondary">
          {progressLabel}
        </Typography>
        {session.products_new > 0 && (
          <Typography variant="caption" color="success.main">
            +{session.products_new} neue Products
          </Typography>
        )}
        {session.products_updated > 0 && (
          <Typography variant="caption" color="info.main">
            {session.products_updated} Updates
          </Typography>
        )}
        {errors > 0 && (
          <Typography variant="caption" color="warning.main">
            {errors} Fehler
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

// ── Health Monitor ────────────────────────────────────────────────────────────

interface KeywordResult {
  keyword: string;
  ok: boolean;
  asin_count?: number;
  asins?: string[];
  duration_s?: number;
  error?: string | null;
}

interface AsinResult {
  asin: string;
  ok: boolean;
  missing_fields?: string[];
  duration_s?: number;
  error?: string | null;
  data?: Record<string, unknown>;
}

interface ProxyResult {
  ok: boolean;
  username?: string;
  direct_ip?: string | null;
  exit_ip?: string | null;
  ip_error?: string | null;
  proxy_routing?: boolean;
  amazon_status?: number | null;
  amazon_error?: string | null;
  error?: string | null;
}

interface HealthCheck {
  id: number;
  checked_at: string;
  overall_ok: boolean;
  duration_s: number | null;
  details: {
    proxy?: ProxyResult;
    keywords: KeywordResult[];
    asins: AsinResult[];
  };
}

interface HealthConfig {
  asins: string[];
  keywords: string[];
}

function HealthStatusWidget() {
  const [check, setCheck] = useState<HealthCheck | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState<HealthConfig | null>(null);
  const [editAsins, setEditAsins] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/health-monitor/status");
      if (res.ok) {
        const data = await res.json();
        setCheck(data.check ?? null);
      }
    } catch { /* non-critical */ }
  }

  async function fetchConfig() {
    try {
      const res = await fetch("/api/health-monitor/config");
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setEditAsins(data.asins.join("\n"));
        setEditKeywords(data.keywords.join("\n"));
      }
    } catch { /* non-critical */ }
  }

  async function saveConfig() {
    setSaving(true);
    try {
      await fetch("/api/health-monitor/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asins: editAsins.split("\n").map((s) => s.trim()).filter(Boolean),
          keywords: editKeywords.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
      });
      await fetchConfig();
      setConfigOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function triggerRun() {
    setRunning(true);
    try {
      await fetch("/api/health-monitor/run", { method: "POST" });
      setTimeout(fetchStatus, 3000);
      setTimeout(fetchStatus, 8000);
      setTimeout(fetchStatus, 15000);
    } finally {
      setTimeout(() => setRunning(false), 15000);
    }
  }

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 30000);
    return () => clearInterval(id);
  }, []);

  const ok = check?.overall_ok ?? null;
  const proxyOk = check?.details?.proxy?.ok ?? null;
  const checkedAgo = check
    ? (() => {
        const secs = Math.floor((Date.now() - new Date(check.checked_at).getTime()) / 1000);
        if (secs < 60) return `${secs}s`;
        if (secs < 3600) return `${Math.floor(secs / 60)}m`;
        return `${Math.floor(secs / 3600)}h`;
      })()
    : null;

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          cursor: check ? "pointer" : "default",
          userSelect: "none",
        }}
        onClick={() => check && setDetailOpen(true)}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
            bgcolor: ok === null ? "text.disabled" : ok ? "success.main" : "error.main" }} />
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
            bgcolor: proxyOk === null ? "text.disabled" : proxyOk ? "success.main" : "error.main" }} />
        </Box>
        <Typography variant="caption" color="text.secondary">
          Scraper {ok === null ? "—" : ok ? "OK" : "FEHLER"}
          {" · "}Proxy {proxyOk === null ? "—" : proxyOk ? "OK" : "FEHLER"}
          {checkedAgo && ` · vor ${checkedAgo}`}
        </Typography>
        <Tooltip title="Konfigurieren">
          <IconButton
            size="small"
            sx={{ ml: 0.5, fontSize: "0.72rem" }}
            onClick={(e) => { e.stopPropagation(); setConfigOpen(true); fetchConfig(); }}
          >
            ⚙
          </IconButton>
        </Tooltip>
        <Tooltip title="Jetzt prüfen">
          <IconButton
            size="small"
            sx={{ fontSize: "0.72rem" }}
            onClick={(e) => { e.stopPropagation(); triggerRun(); }}
            disabled={running}
          >
            {running ? <CircularProgress size={12} /> : "↻"}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Detail modal */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="sm" fullWidth>
        {check && (
          <>
            <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box
                sx={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                  bgcolor: check.overall_ok ? "success.main" : "error.main",
                }}
              />
              <span>Scraper Health — {check.overall_ok ? "Alles OK" : "Problem erkannt"}</span>
              <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                {new Date(check.checked_at).toLocaleString("de-DE")}
                {check.duration_s != null && ` · ${check.duration_s.toFixed(1)}s`}
              </Typography>
              <IconButton size="small" onClick={() => setDetailOpen(false)}>✕</IconButton>
            </DialogTitle>
            <DialogContent dividers>
              {/* Proxy */}
              {check.details.proxy && (
                <Box mb={2}>
                  <Typography variant="overline" color="text.secondary" fontWeight={700}>
                    Proxy
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, mt: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: "50%",
                        bgcolor: check.details.proxy.ok ? "success.main" : "error.main" }} />
                      <Typography variant="body2" fontWeight={600}>
                        {check.details.proxy.ok ? "Proxy funktioniert" : "Proxy-Problem"}
                      </Typography>
                      {check.details.proxy.username && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                          {check.details.proxy.username}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", pl: 2 }}>
                      {check.details.proxy.direct_ip && (
                        <>
                          <Typography variant="caption" color="text.secondary">Server IP</Typography>
                          <Typography variant="caption" sx={{ fontFamily: "monospace" }}>{check.details.proxy.direct_ip}</Typography>
                        </>
                      )}
                      <Typography variant="caption" color="text.secondary">Exit IP</Typography>
                      <Typography variant="caption" sx={{ fontFamily: "monospace",
                        color: check.details.proxy.proxy_routing ? "success.main" : "error.main", fontWeight: 600 }}>
                        {check.details.proxy.exit_ip ?? check.details.proxy.ip_error ?? "–"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">Amazon</Typography>
                      <Typography variant="caption" sx={{
                        color: check.details.proxy.amazon_status === 200 ? "success.main" : "error.main", fontWeight: 600 }}>
                        {check.details.proxy.amazon_error ?? `HTTP ${check.details.proxy.amazon_status ?? "–"}`}
                      </Typography>
                    </Box>
                    {check.details.proxy.error && (
                      <Typography variant="caption" color="error.main" sx={{ mt: 0.5, display: "block" }}>
                        {check.details.proxy.error}
                      </Typography>
                    )}
                  </Paper>
                </Box>
              )}
              {/* Keywords */}
              {check.details.keywords.length > 0 && (
                <Box mb={2}>
                  <Typography variant="overline" color="text.secondary" fontWeight={700}>
                    First-Page Scraper
                  </Typography>
                  {check.details.keywords.map((kw) => (
                    <Paper key={kw.keyword} variant="outlined" sx={{ p: 1.5, mt: 1 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: kw.ok ? "success.main" : "error.main" }} />
                        <Typography variant="body2" fontWeight={600}>"{kw.keyword}"</Typography>
                        {kw.asin_count !== undefined && (
                          <Typography variant="caption" color="text.secondary">
                            {kw.asin_count} ASINs gefunden
                            {kw.duration_s != null && ` · ${kw.duration_s}s`}
                          </Typography>
                        )}
                      </Box>
                      {kw.error && (
                        <Typography variant="caption" color="error.main" sx={{ mt: 0.5, display: "block" }}>
                          Fehler: {kw.error}
                        </Typography>
                      )}
                      {!kw.ok && !kw.error && (
                        <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: "block" }}>
                          Weniger als 5 ASINs (min. erforderlich)
                        </Typography>
                      )}
                    </Paper>
                  ))}
                </Box>
              )}
              {/* ASINs */}
              {check.details.asins.length > 0 && (
                <Box>
                  <Typography variant="overline" color="text.secondary" fontWeight={700}>
                    Produkt-Scraper
                  </Typography>
                  {check.details.asins.map((a) => (
                    <Paper key={a.asin} variant="outlined" sx={{ p: 1.5, mt: 1 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: a.ok ? "success.main" : "error.main" }} />
                        <Typography variant="body2" fontFamily="monospace" fontWeight={600}>{a.asin}</Typography>
                        {a.duration_s != null && (
                          <Typography variant="caption" color="text.secondary">{a.duration_s}s</Typography>
                        )}
                      </Box>
                      {a.data && a.ok && (
                        <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 1 }}>
                          {Object.entries(a.data).map(([k, v]) => (
                            <Chip
                              key={k}
                              label={`${k}: ${v ?? "—"}`}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: "0.68rem", height: 20 }}
                            />
                          ))}
                        </Box>
                      )}
                      {a.missing_fields && a.missing_fields.length > 0 && (
                        <Typography variant="caption" color="error.main" sx={{ mt: 0.5, display: "block" }}>
                          Fehlende Felder: {a.missing_fields.join(", ")}
                        </Typography>
                      )}
                      {a.error && (
                        <Typography variant="caption" color="error.main" sx={{ mt: 0.5, display: "block" }}>
                          Fehler: {a.error}
                        </Typography>
                      )}
                    </Paper>
                  ))}
                </Box>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>

      {/* Config modal */}
      <Dialog open={configOpen} onClose={() => setConfigOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center" }}>
          Health Monitor Konfiguration
          <IconButton size="small" sx={{ ml: "auto" }} onClick={() => setConfigOpen(false)}>✕</IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Je eine ASIN / ein Keyword pro Zeile. Prüfintervall: alle 5 Stunden.
          </Typography>
          <TextField
            label="ASINs"
            multiline
            minRows={3}
            fullWidth
            value={editAsins}
            onChange={(e) => setEditAsins(e.target.value)}
            sx={{ mb: 2 }}
            size="small"
            placeholder="B0FWR9H9L9&#10;B0FG7P8WMW"
          />
          <TextField
            label="Keywords (First-Page)"
            multiline
            minRows={2}
            fullWidth
            value={editKeywords}
            onChange={(e) => setEditKeywords(e.target.value)}
            size="small"
            placeholder="creatine"
          />
          <Button
            variant="contained"
            size="small"
            fullWidth
            sx={{ mt: 2 }}
            onClick={saveConfig}
            disabled={saving}
          >
            {saving ? "Speichern…" : "Speichern"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Ad-hoc job types ──────────────────────────────────────────────────────────

interface MarketResult {
  market_name: string;
  products: unknown[];
  suggestions: string[];
}

interface Job {
  job_id: string;
  cluster_id: number;
  status: string;
  phase: string;
  markets: string[];
  progress: { done: number; total: number };
  errors: string[];
  results: MarketResult[] | null;
  created_at: string;
}

function statusColor(s: string): "default" | "warning" | "success" | "error" {
  if (s === "running") return "warning";
  if (s === "completed") return "success";
  if (s === "failed") return "error";
  return "default";
}

function elapsed(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [dailySession, setDailySession] = useState<DailySession | null>(null);
  const tickRef = useRef(0);

  async function fetchJobs() {
    try {
      const res = await fetch("/api/jobs");
      if (res.ok) {
        setJobs(await res.json());
        setLastUpdated(new Date());
        tickRef.current += 1;
      }
    } catch { /* backend not ready yet */ }
  }

  async function fetchDailyStatus() {
    try {
      const res = await fetch("/api/daily/status");
      if (res.ok) {
        const data = await res.json();
        const s = data.session;
        setDailySession(s?.status === "running" ? s : null);
      }
    } catch { /* non-critical */ }
  }

  useEffect(() => {
    fetchJobs();
    fetchDailyStatus();
    const id1 = setInterval(fetchJobs, 2000);
    const id2 = setInterval(fetchDailyStatus, 5000);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, []);

  async function deleteJob(jobId: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    if (detailJob?.job_id === jobId) setDetailJob(null);
  }

  async function deleteAllCompleted() {
    await fetch("/api/jobs/completed", { method: "DELETE" });
    setJobs((prev) => prev.filter((j) => j.status === "pending" || j.status === "running"));
    setDetailJob(null);
  }

  const active = jobs.filter((j) => j.status === "pending" || j.status === "running");
  const done = jobs.filter((j) => j.status === "completed" || j.status === "failed");

  return (
    <Box>
      {/* Daily scraper live progress (shown only when running) */}
      {dailySession && <DailyRunCard session={dailySession} />}

      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 4, flexWrap: "wrap" }}>
        <Typography variant="h4" fontWeight={700}>Dashboard</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, ml: "auto", flexWrap: "wrap" }}>
          <HealthStatusWidget />
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box sx={{
              width: 8, height: 8, borderRadius: "50%", bgcolor: "success.main",
              animation: "pulse 2s ease-in-out infinite",
              "@keyframes pulse": {
                "0%, 100%": { opacity: 1 },
                "50%": { opacity: 0.3 },
              }
            }} />
            <Typography variant="caption" color="text.secondary">
              Live{lastUpdated ? ` · ${lastUpdated.toLocaleTimeString()}` : ""}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Active jobs */}
      <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
        Ad-hoc Scraper — aktiv
      </Typography>
      <Divider sx={{ mt: 0.5, mb: 2 }} />

      {active.length === 0 ? (
        <Typography variant="body2" color="text.secondary" mb={4}>Keine laufenden Jobs.</Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 4 }}>
          {active.map((job) => (
            <Paper key={job.job_id} variant="outlined" sx={{ p: 2, maxWidth: { xs: "100%", sm: 560 } }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
                <CircularProgress size={14} />
                <Chip label={job.status} color={statusColor(job.status)} size="small" />
                <Typography variant="body2" fontWeight={600}>Cluster {job.cluster_id}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                  {elapsed(job.created_at)}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={job.progress.total ? (job.progress.done / job.progress.total) * 100 : 0}
                sx={{ borderRadius: 1, mb: 1 }}
              />
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {job.markets.map((m) => (
                  <Chip key={m} label={m} size="small" variant="outlined" />
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
                {job.markets.length} markets · {job.progress.done} / {job.progress.total} Schritte abgeschlossen
              </Typography>
            </Paper>
          ))}
        </Box>
      )}

      {/* Completed jobs */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 0, flexWrap: "wrap" }}>
        <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
          Ad-hoc Scraper — abgeschlossen
        </Typography>
        {done.length > 0 && (
          <Button
            size="small"
            color="error"
            variant="outlined"
            sx={{ ml: "auto", fontSize: "0.72rem" }}
            onClick={deleteAllCompleted}
          >
            Alle löschen
          </Button>
        )}
      </Box>
      <Divider sx={{ mt: 0.5, mb: 2 }} />

      {done.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Noch keine abgeschlossenen Jobs.</Typography>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 700 }}>
            <TableHead>
              <TableRow>
                <TableCell>Job ID</TableCell>
                <TableCell>Cluster</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Fortschritt</TableCell>
                <TableCell>Markets</TableCell>
                <TableCell>Produkte</TableCell>
                <TableCell>Gestartet</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {done.map((job) => (
                <TableRow
                  key={job.job_id}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => setDetailJob(job)}
                >
                  <TableCell sx={{ fontFamily: "monospace", fontSize: "0.72rem" }}>
                    {job.job_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell>{job.cluster_id}</TableCell>
                  <TableCell>
                    <Chip label={job.status} color={statusColor(job.status)} size="small" />
                  </TableCell>
                  <TableCell sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
                    {job.progress.done} / {job.progress.total}
                  </TableCell>
                  <TableCell sx={{ fontSize: "0.78rem" }}>
                    {job.markets.join(", ")}
                  </TableCell>
                  <TableCell sx={{ fontSize: "0.78rem" }}>
                    {job.results && job.results.length > 0 ? (
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                        {job.results.map((r) => (
                          <Box key={r.market_name}>
                            <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>
                              <Box component="span" sx={{ color: "text.secondary" }}>{r.market_name}:</Box>{" "}
                              <Box component="span" fontWeight={600}>{r.products.length} Produkte</Box>
                            </Typography>
                            {r.suggestions?.length > 0 && (
                              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.4, mt: 0.4 }}>
                                {r.suggestions.slice(0, 5).map((s, i) => (
                                  <Chip key={i} label={s} size="small" variant="outlined"
                                    sx={{ fontSize: "0.62rem", height: 18, "& .MuiChip-label": { px: 0.75 } }} />
                                ))}
                                {r.suggestions.length > 5 && (
                                  <Tooltip title={r.suggestions.slice(5).join(", ")} placement="top">
                                    <Chip label={`+${r.suggestions.length - 5}`} size="small"
                                      sx={{ fontSize: "0.62rem", height: 18, "& .MuiChip-label": { px: 0.75 }, cursor: "help" }} />
                                  </Tooltip>
                                )}
                              </Box>
                            )}
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.disabled">—</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap", fontSize: "0.78rem", color: "text.secondary" }}>
                    {elapsed(job.created_at)}
                  </TableCell>
                  <TableCell padding="none">
                    <Tooltip title="Job löschen">
                      <IconButton size="small" onClick={(e) => deleteJob(job.job_id, e)}>
                        ✕
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Job detail modal */}
      <Dialog
        open={!!detailJob}
        onClose={() => setDetailJob(null)}
        maxWidth="md"
        fullWidth
      >
        {detailJob && (
          <>
            <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Chip label={detailJob.status} color={statusColor(detailJob.status)} size="small" />
              <span>Job {detailJob.job_id.slice(0, 8)}… — Cluster {detailJob.cluster_id}</span>
              <IconButton
                size="small"
                sx={{ ml: "auto" }}
                onClick={() => setDetailJob(null)}
              >
                ✕
              </IconButton>
            </DialogTitle>
            <DialogContent dividers>
              {detailJob.errors.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="error" mb={0.5}>
                    Fehler ({detailJob.errors.length})
                  </Typography>
                  {detailJob.errors.map((err, i) => (
                    <Typography key={i} variant="body2" color="error.main" sx={{ fontSize: "0.78rem", mb: 0.25 }}>
                      • {err}
                    </Typography>
                  ))}
                  <Divider sx={{ mt: 1.5, mb: 1.5 }} />
                </Box>
              )}
              <Typography variant="subtitle2" mb={1}>
                Raw Response (wie an marktzone2 gesendet)
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0, p: 1.5, bgcolor: "action.hover", borderRadius: 1,
                  fontSize: "0.72rem", overflowX: "auto", maxHeight: "60vh",
                  overflowY: "auto",
                }}
              >
                {JSON.stringify(detailJob, null, 2)}
              </Box>
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
}
