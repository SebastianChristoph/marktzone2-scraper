import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Testing from "./pages/Testing";
import Logging from "./pages/Logging";
import LoginGate from "./components/LoginGate";

export default function App() {
  return (
    <LoginGate>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/testing" element={<Testing />} />
            <Route path="/logging" element={<Logging />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LoginGate>
  );
}
