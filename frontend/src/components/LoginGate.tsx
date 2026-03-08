import { useState } from "react";
import { Box, Button, CircularProgress, TextField, Typography } from "@mui/material";

const STORAGE_KEY = "mz_scraper_auth";

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem(STORAGE_KEY));
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  if (authed) return <>{children}</>;

  async function handleLogin() {
    if (!password.trim()) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        localStorage.setItem(STORAGE_KEY, "1");
        setAuthed(true);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
      <Box sx={{ width: 320, display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="h6" fontWeight={700} textAlign="center">mz-scraper</Typography>
        <TextField
          label="Password"
          type="password"
          size="small"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          error={error}
          helperText={error ? "Incorrect password" : undefined}
          autoFocus
          fullWidth
        />
        <Button
          variant="contained"
          onClick={handleLogin}
          disabled={loading || !password.trim()}
          startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
          fullWidth
        >
          {loading ? "Checking…" : "Login"}
        </Button>
      </Box>
    </Box>
  );
}
