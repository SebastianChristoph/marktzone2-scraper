import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { isLocal } from "../utils/debug";

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <rect x="2" y="4" width="16" height="2" rx="1" />
      <rect x="2" y="9" width="16" height="2" rx="1" />
      <rect x="2" y="14" width="16" height="2" rx="1" />
    </svg>
  );
}

const DRAWER_WIDTH = 220;
const TOPBAR_HEIGHT = 56;

const NAV_ITEMS = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Testing", path: "/testing" },
  { label: "Logging", path: "/logging" },
  { label: "Statistiken", path: "/statistics" },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on route change on mobile
  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [location.pathname, isMobile]);

  const navList = (
    <Box sx={{ pt: isMobile ? 1 : 2 }}>
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
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {isMobile ? (
        <>
          {/* Fixed top bar */}
          <Box
            sx={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              zIndex: theme.zIndex.appBar,
              height: TOPBAR_HEIGHT,
              display: "flex",
              alignItems: "center",
              px: 1.5,
              gap: 1,
              bgcolor: "background.paper",
              borderBottom: "1px solid",
              borderColor: "divider",
              boxShadow: 1,
            }}
          >
            <IconButton size="small" onClick={() => setMobileOpen(true)} sx={{ color: "text.secondary" }}>
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" fontWeight={700} fontSize="0.95rem">
              MZ Scraper
            </Typography>
          </Box>

          {/* Temporary overlay drawer */}
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" } }}
          >
            {navList}
          </Drawer>
        </>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
          }}
        >
          {navList}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3, md: 4 },
          minWidth: 0, // prevent flex child from overflowing
          overflowX: "hidden",
          ...(isMobile && { mt: `${TOPBAR_HEIGHT}px` }),
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
