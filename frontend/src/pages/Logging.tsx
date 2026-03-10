import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Divider,
  FormControlLabel,
  IconButton,
  Link,
  SvgIcon,
  Switch,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { isLocal } from "../utils/debug";

// Inline SVG icons (Material Design paths, no extra package needed)
const IcCamera    = () => <SvgIcon fontSize="inherit"><path d="M12 15.2A3.2 3.2 0 0 1 8.8 12 3.2 3.2 0 0 1 12 8.8 3.2 3.2 0 0 1 15.2 12 3.2 3.2 0 0 1 12 15.2m0-8A4.8 4.8 0 0 0 7.2 12 4.8 4.8 0 0 0 12 16.8 4.8 4.8 0 0 0 16.8 12 4.8 4.8 0 0 0 12 7.2M2 4v16h20V4h-4.83l-1.48-1.79A2 2 0 0 0 14.17 2H9.83a2 2 0 0 0-1.52.71L6.83 4z"/></SvgIcon>;
const IcCheck     = () => <SvgIcon fontSize="inherit"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z"/></SvgIcon>;
const IcAutoFix   = () => <SvgIcon fontSize="inherit"><path d="m7.5 5.6 1.5 1.5L6.5 9.6 5 8.1zm5 0L14 7.1l-2.5 2.5-1.5-1.5zm-5 9L6 16.1l1.5 1.5L9 16.1zm5.9-9.1L15 4l1.5 1.5L15 7zm-5.9 4.1 1.5-1.5 6 6-1.5 1.5zM3 17h8v2H3zM3 7h2v10H3z"/></SvgIcon>;
const IcReplay    = () => <SvgIcon fontSize="inherit"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></SvgIcon>;
const IcDelete    = () => <SvgIcon fontSize="inherit"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></SvgIcon>;
const IcRefresh   = () => <SvgIcon fontSize="inherit"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></SvgIcon>;
const IcDeleteAll = () => <SvgIcon fontSize="inherit"><path d="M15 16h4v2h-4zm0-8h7v2h-7zm0 4h6v2h-6zM3 18c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V8H3zm2-8h6v8H5zM12 4H9L8 3H5L4 4H1v2h11z"/></SvgIcon>;

interface ErrorEntry {
  id: number;
  timestamp: string;
  scraper_type: string;
  job_id: string | null;
  context: string;
  url: string | null;
  error_type: string;
  error_message: string | null;
  attempt: number | null;
  screenshot_file: string | null;
}

// Per-row fix state, persisted in localStorage
type FixState = "none" | "fix_attempted" | "retrying" | "verified_fixed" | "still_broken";

interface RowState {
  state: FixState;
  fixAttempts: number;
  lastFixAt: string;
  retryResult?: Record<string, unknown>;  // full response from retry-scrape on success
}

const LS_PREFIX     = "scraper_fix_";
const LS_REMOTE_MODE = "scraper_log_remote_mode";
const LS_REMOTE_URL  = "scraper_log_remote_url";

function loadRowState(id: number): RowState {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${id}`);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { state: "none", fixAttempts: 0, lastFixAt: "" };
}

function saveRowState(id: number, s: RowState) {
  localStorage.setItem(`${LS_PREFIX}${id}`, JSON.stringify(s));
}

/** Extract the single relevant value from a retry result for display in the Meldung cell. */
function extractRetryValue(errorType: string, result: Record<string, unknown>): string | null {
  if (!result) return null;
  const r = result as Record<string, unknown>;
  if (errorType === "no_price")    return r.price    != null ? `Preis: $${r.price}`              : null;
  if (errorType === "no_title")    return r.title    != null ? `Titel: ${String(r.title).slice(0, 60)}` : null;
  if (errorType === "no_products") return r.count    != null ? `${r.count} Produkte gefunden`    : null;
  if (errorType === "out_of_stock") return "Seite gefunden (kein Out-of-stock)";
  if (errorType === "captcha")     return "Kein CAPTCHA erkannt";
  return "Erfolgreich";
}

const ERROR_TYPE_COLORS: Record<string, "error" | "warning" | "info" | "default"> = {
  captcha: "error",
  no_price: "warning",
  no_title: "warning",
  no_products: "warning",
  out_of_stock: "info",
  scrape_failed: "error",
  general: "default",
};

const ROW_BG: Record<FixState, string | undefined> = {
  none:           undefined,
  fix_attempted:  "rgba(255, 193, 7, 0.12)",   // amber
  retrying:       "rgba(255, 193, 7, 0.12)",
  verified_fixed: "rgba(76, 175, 80, 0.12)",    // green
  still_broken:   "rgba(244, 67, 54, 0.10)",    // red
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" });
}

export default function Logging() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [count24h, setCount24h] = useState(0);
  const [scraperType, setScraperType] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [retryAllProgress, setRetryAllProgress] = useState<{ done: number; total: number } | null>(null);

  // Per-row states (in-memory mirror of localStorage)
  const [rowStates, setRowStates] = useState<Record<number, RowState>>({});

  // Remote toggle
  const [remoteMode, setRemoteMode] = useState(() => localStorage.getItem(LS_REMOTE_MODE) === "true");
  const [remoteUrl, setRemoteUrl] = useState(() => localStorage.getItem(LS_REMOTE_URL) ?? "");
  const remoteUrlRef = useRef(remoteUrl);
  remoteUrlRef.current = remoteUrl;

  function toggleRemote(on: boolean) {
    setRemoteMode(on);
    localStorage.setItem(LS_REMOTE_MODE, String(on));
  }
  function saveRemoteUrl(url: string) {
    const trimmed = url.replace(/\/$/, "");
    setRemoteUrl(trimmed);
    localStorage.setItem(LS_REMOTE_URL, trimmed);
  }
  function apiBase() {
    return remoteMode && remoteUrlRef.current ? remoteUrlRef.current : "/api";
  }
  function screenshotBase() {
    return remoteMode && remoteUrlRef.current ? remoteUrlRef.current : "/api";
  }

  function getRowState(id: number): RowState {
    return rowStates[id] ?? loadRowState(id);
  }
  function setRowStateFor(id: number, s: RowState) {
    saveRowState(id, s);
    setRowStates((prev) => ({ ...prev, [id]: s }));
  }

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams();
    if (scraperType) params.set("scraper_type", scraperType);
    params.set("limit", "200");
    const base = remoteMode && remoteUrl ? remoteUrl : "/api";
    try {
      const res = await fetch(`${base}/logs?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setErrors(data.errors);
      setCount24h(data.count_24h);
      // Pre-load row states from localStorage
      const states: Record<number, RowState> = {};
      for (const e of data.errors) states[e.id] = loadRowState(e.id);
      setRowStates(states);
    } catch { /* backend not ready */ }
  }, [scraperType, remoteMode, remoteUrl]);

  useEffect(() => {
    fetchLogs();
    const id = setInterval(fetchLogs, 5000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  async function deleteOne(id: number) {
    await fetch(`${apiBase()}/logs/${id}`, { method: "DELETE" });
    localStorage.removeItem(`${LS_PREFIX}${id}`);
    fetchLogs();
  }
  async function clearAll() {
    await fetch(`${apiBase()}/logs/all`, { method: "DELETE" });
    fetchLogs();
  }
  async function clearScreenshots() {
    await fetch("/api/logs/screenshots", { method: "DELETE" });
  }

  async function fixWithAi(e: ErrorEntry, isRetry = false) {
    const prev = getRowState(e.id);
    const attempts = isRetry ? prev.fixAttempts + 1 : 1;
    setRowStateFor(e.id, { state: "fix_attempted", fixAttempts: attempts, lastFixAt: new Date().toISOString() });

    await fetch("/api/debug/fix-with-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: e.context,
        url: e.url,
        error_type: e.error_type,
        error_message: e.error_message,
        screenshot_file: e.screenshot_file,
        scraper_type: e.scraper_type,
        fix_attempts: attempts,
      }),
    });
  }

  async function retryScrape(e: ErrorEntry) {
    setRowStateFor(e.id, { ...getRowState(e.id), state: "retrying" });
    try {
      const res = await fetch("/api/debug/retry-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: e.context,
          url: e.url,
          error_type: e.error_type,
          scraper_type: e.scraper_type,
        }),
      });
      const data = await res.json();
      const prev = getRowState(e.id);
      if (data.field_found) {
        setRowStateFor(e.id, { ...prev, state: "verified_fixed", retryResult: data.result ?? undefined });
      } else {
        setRowStateFor(e.id, { ...prev, state: "still_broken", retryResult: undefined });
      }
    } catch {
      setRowStateFor(e.id, { ...getRowState(e.id), state: "still_broken", retryResult: undefined });
    }
  }

  async function retryAll() {
    const list = errors;
    setRetryAllProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      await retryScrape(list[i]);
      setRetryAllProgress({ done: i + 1, total: list.length });
    }
    setRetryAllProgress(null);
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Typography variant="h4" fontWeight={700}>Logging</Typography>
        <Chip
          label={`${count24h} Fehler in 24h`}
          color={count24h > 0 ? "error" : "default"}
          size="small"
          sx={{ ml: 1 }}
        />
        <Box sx={{ ml: "auto", display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          {isLocal && errors.length > 0 && (
            <Button
              variant="outlined"
              size="small"
              color="primary"
              disabled={!!retryAllProgress}
              startIcon={retryAllProgress ? <CircularProgress size={12} /> : <IcReplay />}
              onClick={retryAll}
            >
              {retryAllProgress
                ? `Retry ${retryAllProgress.done}/${retryAllProgress.total}…`
                : "Retry all scraping"}
            </Button>
          )}
          {!remoteMode && (
            <Button variant="outlined" size="small" color="warning" startIcon={<IcDelete />} onClick={clearScreenshots}>
              Screenshots löschen
            </Button>
          )}
          <Button variant="outlined" color="error" size="small" disabled={errors.length === 0} startIcon={<IcDeleteAll />} onClick={clearAll}>
            Alle Logs löschen
          </Button>
        </Box>
      </Box>

      {/* DB source toggle */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1, flexWrap: "wrap" }}>
        <FormControlLabel
          control={<Switch checked={remoteMode} onChange={(e) => toggleRemote(e.target.checked)} size="small" color={remoteMode ? "success" : "default"} />}
          label={<Typography variant="body2" fontWeight={600}>{remoteMode ? "Server (PostgreSQL)" : "Lokal (SQLite)"}</Typography>}
          sx={{ mr: 0 }}
        />
        {remoteMode && (
          <TextField
            size="small"
            placeholder="https://scraper.marktzone.io"
            value={remoteUrl}
            onChange={(e) => saveRemoteUrl(e.target.value)}
            sx={{ flexGrow: 1, maxWidth: 380 }}
            inputProps={{ style: { fontFamily: "monospace", fontSize: "0.82rem" } }}
          />
        )}
        {remoteMode && !remoteUrl && (
          <Typography variant="caption" color="error">Server-URL eingeben</Typography>
        )}
        {remoteMode && <Chip label="Fix with AI immer lokal" size="small" variant="outlined" color="info" />}
      </Box>

      {/* Filters */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, alignItems: "center", flexWrap: "wrap" }}>
        <Select value={scraperType} onChange={(e) => setScraperType(e.target.value)} displayEmpty size="small" sx={{ minWidth: 160 }}>
          <MenuItem value="">Alle Scraper</MenuItem>
          <MenuItem value="first_page">First Page</MenuItem>
          <MenuItem value="product">Product</MenuItem>
        </Select>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", alignItems: "center" }}>
          {(["captcha", "no_price", "no_title", "no_products", "out_of_stock", "scrape_failed", "general"] as const).map((type) => {
            const active = !hiddenTypes.has(type);
            return (
              <Chip
                key={type}
                label={type}
                size="small"
                color={active ? (ERROR_TYPE_COLORS[type] ?? "default") : "default"}
                variant={active ? "filled" : "outlined"}
                onClick={() =>
                  setHiddenTypes((prev) => {
                    const next = new Set(prev);
                    next.has(type) ? next.delete(type) : next.add(type);
                    return next;
                  })
                }
                sx={{ cursor: "pointer", opacity: active ? 1 : 0.4 }}
              />
            );
          })}
        </Box>
        <Button size="small" onClick={fetchLogs} variant="outlined" startIcon={<IcRefresh />}>Aktualisieren</Button>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {(() => {
        const visible = errors.filter((e) => !hiddenTypes.has(e.error_type));
        return visible.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {scraperType || hiddenTypes.size > 0 ? "Keine Fehler für diesen Filter." : "Keine Fehler protokolliert."}
          </Typography>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: "nowrap" }}>Zeitpunkt</TableCell>
                <TableCell>Scraper</TableCell>
                <TableCell>Kontext</TableCell>
                <TableCell>Fehlertyp</TableCell>
                <TableCell>Meldung</TableCell>
                <TableCell>Attempt</TableCell>
                <TableCell>Aktionen</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((e) => {
                const rs = getRowState(e.id);
                return (
                  <TableRow key={e.id} sx={{ bgcolor: ROW_BG[rs.state] }}>
                    <TableCell sx={{ whiteSpace: "nowrap", fontSize: "0.78rem", color: "text.secondary" }}>
                      {formatTime(e.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Chip label={e.scraper_type === "first_page" ? "First Page" : "Product"} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      {e.url ? (
                        <Tooltip title={e.url} placement="top">
                          <Link href={e.url} target="_blank" rel="noopener noreferrer" underline="hover"
                            sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                            {e.context}
                          </Link>
                        </Tooltip>
                      ) : (
                        <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{e.context}</Typography>
                      )}
                      {e.job_id && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Job {e.job_id.slice(0, 8)}…
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={e.error_type} color={ERROR_TYPE_COLORS[e.error_type] ?? "default"} size="small" />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>
                      {rs.state === "verified_fixed" && rs.retryResult ? (
                        <Tooltip
                          title={
                            <Box component="pre" sx={{ m: 0, fontSize: "0.7rem", maxHeight: 300, overflowY: "auto" }}>
                              {JSON.stringify(rs.retryResult, null, 2)}
                            </Box>
                          }
                          placement="right"
                          componentsProps={{ tooltip: { sx: { maxWidth: 480, bgcolor: "grey.900" } } }}
                        >
                          <Typography variant="body2" sx={{ fontSize: "0.78rem", color: "success.main", fontWeight: 600, cursor: "help" }}>
                            {extractRetryValue(e.error_type, rs.retryResult) ?? "Erfolgreich"}
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography variant="body2" sx={{ fontSize: "0.78rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {e.error_message ?? "—"}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary", fontSize: "0.78rem" }}>
                      {e.attempt ?? "—"}
                    </TableCell>

                    {/* Action column */}
                    <TableCell>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, alignItems: "flex-start" }}>
                        {/* Screenshot */}
                        {e.screenshot_file && (
                          <Button size="small" variant="outlined" startIcon={<IcCamera />}
                            sx={{ fontSize: "0.68rem", px: 1, py: 0.25 }}
                            onClick={() => setScreenshot(`${screenshotBase()}/static/screenshots/${e.screenshot_file}`)}>
                            Screenshot
                          </Button>
                        )}

                        {/* Ist korrekt — entfernt den Log-Eintrag */}
                        <Button size="small" variant="outlined" color="inherit" startIcon={<IcCheck />}
                          sx={{ fontSize: "0.68rem", px: 1, py: 0.25, whiteSpace: "nowrap", color: "text.secondary" }}
                          onClick={() => deleteOne(e.id)}>
                          Ist korrekt
                        </Button>

                        {/* State label */}
                        {rs.state === "verified_fixed" && (
                          <Chip label="✓ Gefixt" color="success" size="small" />
                        )}
                        {rs.state === "still_broken" && (
                          <Chip label="✗ Noch offen" color="error" size="small" />
                        )}

                        {isLocal && (
                          <>
                            {/* Fix with AI — initial or "again" */}
                            {(rs.state === "none" || rs.state === "verified_fixed") && (
                              <Button size="small" variant="contained" color="secondary" startIcon={<IcAutoFix />}
                                sx={{ fontSize: "0.68rem", px: 1, py: 0.25, whiteSpace: "nowrap" }}
                                onClick={() => fixWithAi(e, false)}>
                                Fix with AI
                              </Button>
                            )}
                            {rs.state === "still_broken" && (
                              <Button size="small" variant="contained" color="error" startIcon={<IcAutoFix />}
                                sx={{ fontSize: "0.68rem", px: 1, py: 0.25, whiteSpace: "nowrap" }}
                                onClick={() => fixWithAi(e, true)}>
                                Fix with AI again ({rs.fixAttempts}×)
                              </Button>
                            )}

                            {/* Retry — always available */}
                            <Button size="small" variant="outlined" color="primary"
                              sx={{ fontSize: "0.68rem", px: 1, py: 0.25, whiteSpace: "nowrap" }}
                              disabled={rs.state === "retrying" || !!retryAllProgress}
                              startIcon={rs.state === "retrying" ? <CircularProgress size={10} /> : <IcReplay />}
                              onClick={() => retryScrape(e)}>
                              {rs.state === "retrying" ? "Scrapt…" : "Retry product scraping"}
                            </Button>
                          </>
                        )}
                      </Box>
                    </TableCell>

                    <TableCell>
                      <IconButton size="small" onClick={() => deleteOne(e.id)} title="Eintrag löschen">✕</IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
        );
      })()}

      {/* Screenshot lightbox */}
      <Dialog open={!!screenshot} onClose={() => setScreenshot(null)} maxWidth="xl">
        <DialogContent sx={{ p: 1, bgcolor: "#000" }}>
          {screenshot && <img src={screenshot} alt="Screenshot" style={{ maxWidth: "90vw", maxHeight: "85vh", display: "block" }} />}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
