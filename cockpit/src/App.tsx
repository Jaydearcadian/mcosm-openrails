import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import Cockpit from "./pages/Cockpit";
import LinkLanding from "./pages/LinkLanding";
import Docs from "./pages/Docs";
import System from "./pages/System";
import Network from "./pages/Network";
import Build from "./pages/Build";
import { Providers } from "./components/Providers";

export default function App() {
  return (
    <Providers>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Cockpit />} />
        <Route path="/cockpit" element={<Navigate to="/app" replace />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/system" element={<System />} />
        <Route path="/network" element={<Network />} />
        <Route path="/build" element={<Build />} />
        <Route path="/openrails/flow" element={<LinkLanding />} />
        <Route path="/openrails/card" element={<LinkLanding />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Providers>
  );
}
