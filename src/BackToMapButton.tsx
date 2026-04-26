import { Home, Settings } from "lucide-react";
import { Link } from "react-router-dom";

export default function BackToMapButton() {
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 99999,
        display: "flex",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      <Link
        to="/"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 16px",
          borderRadius: 20,
          background: "rgba(0,229,255,.15)",
          border: "2px solid #00e5ff",
          color: "#00e5ff",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1,
          fontFamily: "'Orbitron', monospace",
          textDecoration: "none",
          backdropFilter: "blur(8px)",
          boxShadow: "0 4px 20px rgba(0,229,255,.4)",
        }}
        aria-label="חזרה למפה הראשית"
      >
        <Home size={16} />
        בית
      </Link>
      <Link
        to="/admin"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 14px",
          borderRadius: 20,
          background: "rgba(6,14,22,.92)",
          border: "1px solid #00e5ff44",
          color: "#00e5ff",
          fontSize: 12,
          fontFamily: "'Orbitron', monospace",
          textDecoration: "none",
          backdropFilter: "blur(8px)",
          boxShadow: "0 4px 16px rgba(0,0,0,.5)",
        }}
        aria-label="הגדרות"
      >
        <Settings size={14} />
        הגדרות
      </Link>
    </div>
  );
}
