import { useEffect, useState } from "react";

// Seconds since mount; shown next to "working…" lines so slow model calls are visible as such.
export function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums">{s}s</span>;
}
