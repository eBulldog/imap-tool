import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { ServersProvider } from "./context/ServersContext";
import ComparePage from "./pages/ComparePage";
import MessageViewerPage from "./pages/MessageViewerPage";
import CapabilitiesReferencePage from "./pages/CapabilitiesReferencePage";
import CopyPage from "./pages/CopyPage";

function Layout() {
  return (
    <>
      <nav className="top-nav">
        <span className="brand">imap-tool</span>
        <Link to="/">Compare</Link>
        <Link to="/viewer">Message viewer</Link>
        <Link to="/capabilities">Capabilities</Link>
        <Link to="/copy">Copy</Link>
      </nav>
      <Routes>
        <Route path="/" element={<ComparePage />} />
        <Route path="/viewer" element={<MessageViewerPage />} />
        <Route path="/capabilities" element={<CapabilitiesReferencePage />} />
        <Route path="/copy" element={<CopyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ServersProvider>
        <Layout />
      </ServersProvider>
    </BrowserRouter>
  );
}
