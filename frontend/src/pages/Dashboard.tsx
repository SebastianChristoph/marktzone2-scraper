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
} from "@mui/material";

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

  useEffect(() => {
    fetchJobs();
    const id = setInterval(fetchJobs, 2000);
    return () => clearInterval(id);
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
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 4 }}>
        <Typography variant="h4" fontWeight={700}>Dashboard</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, ml: "auto" }}>
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
            <Paper key={job.job_id} variant="outlined" sx={{ p: 2, maxWidth: 560 }}>
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
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 0 }}>
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
