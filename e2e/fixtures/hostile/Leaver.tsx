import { useEffect } from "react";

/** A component that tries to leave its frame for the web a moment after it starts. */
export default function Leaver() {
  useEffect(() => { const t = setTimeout(() => { location.href = "https://example.com/"; }, 600); return () => clearTimeout(t); }, []);
  return <p>Leaving soon</p>;
}
