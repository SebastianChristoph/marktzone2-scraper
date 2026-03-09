import { Box, Drawer, List, ListItemButton, ListItemText, Typography } from "@mui/material";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { isLocal } from "../utils/debug";

const DRAWER_WIDTH = 220;

const NAV_ITEMS = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Testing", path: "/testing" },
  { label: "Logging", path: "/logging" },
  { label: "Statistiken", path: "/statistics" },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box", pt: 2 },
        }}
      >
        {isLocal && (
          <Box sx={{ mx: 1, mb: 1, px: 1, py: 0.5, borderRadius: 1, backgroundColor: "#FF6B00", textAlign: "center" }}>
            <Typography variant="caption" fontWeight={800} sx={{ color: "#fff", letterSpacing: 1.5, fontSize: "0.65rem" }}>
              ⚙ DEBUG MODE
            </Typography>
          </Box>
        )}
        <Typography variant="h6" sx={{ px: 2, pb: 2, fontWeight: 700 }}>
          MZ Scraper
        </Typography>
        <List disablePadding>
          {NAV_ITEMS.map((item) => (
            <ListItemButton
              key={item.path}
              selected={location.pathname === item.path}
              onClick={() => navigate(item.path)}
            >
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, p: 4 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
