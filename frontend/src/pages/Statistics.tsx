import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";

interface TimingStats {
  avg: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  min: number | null;
  max: number | null;
}

interface DailySessionRow {
  session_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  phase: string;
  markets_done: number;
  markets_errors: number;
  asins_done: number;
  asins_errors: number;
  products_updated: number;
  products_new: number;
  markets_changed: number;
  total_duration_s: number | null;
}

interface Stats {
  summary: {
    total_jobs: number;
    completed_jobs: number;
    failed_jobs: number;
    success_rate: number;
    total_markets_attempted: number;
    total_markets_scraped: number;
    total_asins_scraped: number;
    total_errors: number;
  };
  timing: {
    job_duration: TimingStats;
    phase1_per_market: TimingStats;
    phase2_per_market: TimingStats;
    asin: TimingStats;
    estimated_asins_per_hour: number | null;
  };
  jobs_per_day: { date: string; count: number }[];
  asin_histogram: { bucket: string; count: number }[];
  top_clusters: {
    cluster_id: number;
    job_count: number;
    total_asins: number;
    completed: number;
    failed: number;
  }[];
}

function fmt(s: number | null, unit = "s"): string {
  if (s === null || s === undefined) return "—";
  if (unit === "s" && s >= 60) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${s}${unit}`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// ─── Summary card ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, minWidth: 140, flex: 1 }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600} letterSpacing={0.8}>
        {label.toUpperCase()}
      </Typography>
      <Typography variant="h4" fontWeight={700} sx={{ mt: 0.5, color: color || "text.primary" }}>
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" color="text.secondary">{sub}</Typography>
      )}
    </Paper>
  );
}

// ─── Timing row ──────────────────────────────────────────────────────────────
function TimingRow({ label, stats }: { label: string; stats: TimingStats }) {
  return (
    <TableRow>
      <TableCell sx={{ fontWeight: 600, fontSize: "0.82rem" }}>{label}</TableCell>
      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{fmt(stats.avg)}</TableCell>
      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{fmt(stats.p50)}</TableCell>
      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.82rem", color: "warning.main" }}>{fmt(stats.p95)}</TableCell>
      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.82rem", color: "error.main" }}>{fmt(stats.p99)}</TableCell>
      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.82rem", color: "text.secondary" }}>
        {fmt(stats.min)} – {fmt(stats.max)}
      </TableCell>
    </TableRow>
  );
}

// ─── Mini bar chart ──────────────────────────────────────────────────────────
function MiniBarChart({ data, dateMode = false }: {
  data: { label: string; count: number }[];
  dateMode?: boolean;
}) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <Box sx={{ display: "flex", alignItems: "flex-end", gap: "2px", height: 80, width: "100%" }}>
      {data.map((d, i) => (
        <Tooltip key={i} title={`${d.label}: ${d.count}`} placement="top">
          <Box
            sx={{
              flex: 1,
              height: d.count > 0 ? `${Math.max((d.count / max) * 100, 6)}%` : 3,
              bgcolor: d.count > 0 ? "primary.main" : "action.hover",
              borderRadius: "2px 2px 0 0",
              cursor: "default",
              transition: "opacity 0.15s",
              "&:hover": { opacity: 0.75 },
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}

export default function Statistics() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [dailyHistory, setDailyHistory] = useState<DailySessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingDaily, setDeletingDaily] = useState(false);

  async function deleteAllStats() {
    if (!confirm("Alle Statistiken (Jobs) löschen?")) return;
    setDeleting(true);
    try {
      await fetch("/api/stats", { method: "DELETE" });
      await load();
    } finally {
      setDeleting(false);
    }
  }

  async function deleteDailyHistory() {
    if (!confirm("Alle Daily-Scraper-Runs löschen?")) return;
    setDeletingDaily(true);
    try {
      await fetch("/api/daily/history", { method: "DELETE" });
      await load();
    } finally {
      setDeletingDaily(false);
    }
  }

  async function load() {
    try {
      const [statsRes, dailyRes] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/daily/history"),
      ]);
      if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
      setStats(await statsRes.json());
      if (dailyRes.ok) {
        const d = await dailyRes.json();
        setDailyHistory(d.sessions ?? []);
      }
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 8, justifyContent: "center" }}>
        <CircularProgress size={20} />
        <Typography color="text.secondary">Statistiken werden geladen…</Typography>
      </Box>
    );
  }

  if (error || !stats) {
    return <Typography color="error" mt={4}>Fehler: {error}</Typography>;
  }

  const { summary, timing, jobs_per_day, asin_histogram, top_clusters } = stats;
  const hasTimingData = timing.asin.avg !== null;

  // Show only last 14 days in chart for readability
  const chartDays = jobs_per_day.slice(-14).map((d) => ({
    label: d.date.slice(5), // MM-DD
    count: d.count,
  }));

  const histData = asin_histogram.map((h) => ({ label: h.bucket, count: h.count }));

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 1 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Statistiken</Typography>
          <Typography variant="body2" color="text.secondary">
            Performance-Metriken des Ad-hoc Scrapers — basierend auf {summary.total_jobs} gespeicherten Jobs
          </Typography>
        </Box>
        <Button
          variant="outlined"
          color="error"
          size="small"
          sx={{ ml: "auto", mt: 0.5, whiteSpace: "nowrap" }}
          onClick={deleteAllStats}
          disabled={deleting || summary.total_jobs === 0}
        >
          {deleting ? "Löschen…" : "Alle Statistiken löschen"}
        </Button>
      </Box>
      <Box mb={4} />

      {/* ── Summary cards ──────────────────────────────────────────────── */}
      <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
        Übersicht
      </Typography>
      <Divider sx={{ mt: 0.5, mb: 2 }} />
      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 4 }}>
        <StatCard label="Jobs gesamt" value={summary.total_jobs} />
        <StatCard
          label="Erfolgreich"
          value={summary.completed_jobs}
          sub={summary.total_jobs > 0 ? pct(summary.success_rate) : undefined}
          color="success.main"
        />
        <StatCard
          label="Fehlgeschlagen"
          value={summary.failed_jobs}
          color={summary.failed_jobs > 0 ? "error.main" : undefined}
        />
        <StatCard label="Markets gescraped" value={summary.total_markets_scraped} sub={`von ${summary.total_markets_attempted} versucht`} />
        <StatCard label="ASINs gescraped" value={summary.total_asins_scraped.toLocaleString()} />
        <StatCard
          label="Fehler gesamt"
          value={summary.total_errors}
          color={summary.total_errors > 0 ? "warning.main" : undefined}
        />
      </Box>

      {/* ── Timing metrics ─────────────────────────────────────────────── */}
      <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
        Laufzeiten
      </Typography>
      <Divider sx={{ mt: 0.5, mb: 2 }} />

      {!hasTimingData ? (
        <Typography variant="body2" color="text.secondary" mb={4}>
          Noch keine Timing-Daten vorhanden — werden ab dem nächsten Job erfasst.
        </Typography>
      ) : (
        <>
          {/* Key timing highlights */}
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
            <StatCard
              label="Ø Job-Dauer"
              value={fmt(timing.job_duration.avg)}
              sub={`P95: ${fmt(timing.job_duration.p95)}`}
            />
            <StatCard
              label="Ø Phase 1 / Market"
              value={fmt(timing.phase1_per_market.avg)}
              sub="First-Page Scraping"
            />
            <StatCard
              label="Ø Phase 2 / Market"
              value={fmt(timing.phase2_per_market.avg)}
              sub="ASIN-Detail Scraping"
            />
            <StatCard
              label="Ø ASIN-Dauer"
              value={fmt(timing.asin.avg)}
              sub={`P95: ${fmt(timing.asin.p95)}`}
            />
            {timing.estimated_asins_per_hour !== null && (
              <StatCard
                label="Durchsatz (est.)"
                value={`~${timing.estimated_asins_per_hour.toLocaleString()}`}
                sub="ASINs/h bei Semaphore(4)"
                color="primary.main"
              />
            )}
          </Box>

          {/* Detailed timing table */}
          <Paper variant="outlined" sx={{ mb: 4, overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 480 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Metrik</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>
                    <Tooltip title="Arithmetischer Mittelwert aller Messungen" placement="top" arrow>
                      <span style={{ cursor: "help", borderBottom: "1px dashed currentColor" }}>Ø Avg</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>
                    <Tooltip title="Median — 50 % der Messungen liegen darunter" placement="top" arrow>
                      <span style={{ cursor: "help", borderBottom: "1px dashed currentColor" }}>P50</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: "warning.main" }}>
                    <Tooltip title="95. Perzentil — nur 5 % der Messungen dauern länger" placement="top" arrow>
                      <span style={{ cursor: "help", borderBottom: "1px dashed currentColor" }}>P95</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: "error.main" }}>
                    <Tooltip title="99. Perzentil — Worst-Case-Ausreißer (1 % der Messungen)" placement="top" arrow>
                      <span style={{ cursor: "help", borderBottom: "1px dashed currentColor" }}>P99</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: "text.secondary" }}>Min – Max</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TimingRow label="Gesamt-Job-Dauer" stats={timing.job_duration} />
                <TimingRow label="Phase 1 pro Market (First-Page)" stats={timing.phase1_per_market} />
                <TimingRow label="Phase 2 pro Market (ASIN-Details)" stats={timing.phase2_per_market} />
                <TimingRow label="Einzelnes ASIN-Scraping" stats={timing.asin} />
              </TableBody>
            </Table>
          </Paper>
        </>
      )}

      {/* ── Charts row ─────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", mb: 4 }}>
        {/* Jobs per day */}
        <Paper variant="outlined" sx={{ p: 2.5, flex: 2, minWidth: { xs: "100%", sm: 280 } }}>
          <Typography variant="subtitle2" fontWeight={700} mb={0.5}>Jobs pro Tag (letzte 14 Tage)</Typography>
          <Typography variant="caption" color="text.secondary" display="block" mb={2}>
            {jobs_per_day.reduce((a, b) => a + b.count, 0)} Jobs total
          </Typography>
          <MiniBarChart data={chartDays} dateMode />
          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">{chartDays[0]?.label}</Typography>
            <Typography variant="caption" color="text.secondary">{chartDays[chartDays.length - 1]?.label}</Typography>
          </Box>
        </Paper>

        {/* ASIN duration histogram */}
        <Paper variant="outlined" sx={{ p: 2.5, flex: 1, minWidth: 220 }}>
          <Typography variant="subtitle2" fontWeight={700} mb={0.5}>ASIN-Dauer Verteilung</Typography>
          <Typography variant="caption" color="text.secondary" display="block" mb={2}>
            {asin_histogram.reduce((a, b) => a + b.count, 0)} Messungen
          </Typography>
          {asin_histogram.every((h) => h.count === 0) ? (
            <Typography variant="caption" color="text.disabled">Noch keine Daten</Typography>
          ) : (
            <>
              <MiniBarChart data={histData} />
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                {histData.map((h) => (
                  <Box key={h.label} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{h.label}:</Typography>
                    <Typography variant="caption" fontWeight={600}>{h.count}</Typography>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Paper>
      </Box>

      {/* ── Daily Scraper ──────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
          Daily Scraper — Historie
        </Typography>
        <Button
          variant="outlined"
          color="error"
          size="small"
          sx={{ ml: "auto", whiteSpace: "nowrap" }}
          onClick={deleteDailyHistory}
          disabled={deletingDaily || dailyHistory.length === 0}
        >
          {deletingDaily ? "Löschen…" : "Daily-Historie löschen"}
        </Button>
      </Box>
      <Divider sx={{ mt: 0.5, mb: 2 }} />

      {dailyHistory.length === 0 ? (
        <Typography variant="body2" color="text.secondary" mb={4}>
          Noch keine Daily-Runs — erster Start täglich um 00:05 UTC.
        </Typography>
      ) : (
        <>
          {/* Summary from last run */}
          {(() => {
            const last = dailyHistory[0];
            return (
              <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
                <StatCard
                  label="Letzter Run"
                  value={last.started_at.slice(0, 10).split("-").reverse().join(".")}
                  sub={last.status}
                  color={last.status === "completed" ? "success.main" : last.status === "failed" ? "error.main" : undefined}
                />
                <StatCard label="Dauer" value={fmt(last.total_duration_s)} sub="Gesamt-Laufzeit" />
                <StatCard label="ASINs gescraped" value={(last.asins_done ?? 0).toLocaleString()} />
                <StatCard label="Products updated" value={last.products_updated} sub="neue ProductChanges" />
                <StatCard label="Neue Products" value={last.products_new} color={last.products_new > 0 ? "success.main" : undefined} />
                <StatCard label="MarketChanges" value={last.markets_changed} />
                <StatCard
                  label="Fehler"
                  value={(last.markets_errors ?? 0) + (last.asins_errors ?? 0)}
                  color={((last.markets_errors ?? 0) + (last.asins_errors ?? 0)) > 0 ? "warning.main" : undefined}
                />
              </Box>
            );
          })()}

          {/* History table */}
          <Paper variant="outlined" sx={{ mb: 4, overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 560 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Datum</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Dauer</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>ASINs</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Updated</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Neu</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>MarketChanges</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: "warning.main" }}>Fehler</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {dailyHistory.slice(0, 10).map((s) => {
                  const errors = (s.markets_errors ?? 0) + (s.asins_errors ?? 0);
                  return (
                    <TableRow key={s.session_id}>
                      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                        {s.started_at.slice(0, 10).split("-").reverse().join(".")} {s.started_at.slice(11, 16)}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={s.status}
                          size="small"
                          color={s.status === "completed" ? "success" : s.status === "failed" ? "error" : "warning"}
                        />
                      </TableCell>
                      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{fmt(s.total_duration_s)}</TableCell>
                      <TableCell sx={{ fontSize: "0.8rem" }}>{(s.asins_done ?? 0).toLocaleString()}</TableCell>
                      <TableCell sx={{ fontSize: "0.8rem" }}>{s.products_updated}</TableCell>
                      <TableCell sx={{ fontSize: "0.8rem", color: s.products_new > 0 ? "success.main" : undefined }}>{s.products_new}</TableCell>
                      <TableCell sx={{ fontSize: "0.8rem" }}>{s.markets_changed}</TableCell>
                      <TableCell sx={{ fontSize: "0.8rem", color: errors > 0 ? "warning.main" : "text.disabled" }}>{errors || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}

      {/* ── Top Clusters ───────────────────────────────────────────────── */}
      <Typography variant="overline" color="text.secondary" fontWeight={700} letterSpacing={1.5}>
        Meist gescrapete Cluster
      </Typography>
      <Divider sx={{ mt: 0.5, mb: 2 }} />

      {top_clusters.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Noch keine Cluster-Daten.</Typography>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 340 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Cluster ID</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Jobs</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>ASINs gescraped</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {top_clusters.map((c) => (
                <TableRow key={c.cluster_id}>
                  <TableCell sx={{ fontFamily: "monospace" }}>#{c.cluster_id}</TableCell>
                  <TableCell>{c.job_count}</TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 0.75 }}>
                      {c.completed > 0 && (
                        <Chip label={`${c.completed} ok`} color="success" size="small" />
                      )}
                      {c.failed > 0 && (
                        <Chip label={`${c.failed} failed`} color="error" size="small" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{c.total_asins.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}
