import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Testing from "./pages/Testing";
import Logging from "./pages/Logging";
import Statistics from "./pages/Statistics";
import LoginGate from "./components/LoginGate";
import { useDynamicFavicon } from "./utils/useDynamicFavicon";

function AppInner() {
  useDynamicFavicon();
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/testing" element={<Testing />} />
          <Route path="/logging" element={<Logging />} />
          <Route path="/statistics" element={<Statistics />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <LoginGate>
      <AppInner />
    </LoginGate>
  );
}
