import { useEffect, useMemo, useRef, useState } from "react";
import { X, Copy, Trash2 } from "lucide-react";
import "./LogViewer.css";

export type LogStream = "stdout" | "stderr";

interface LogViewerProps {
  isOpen: boolean;
  instanceName: string;
  stdoutText: string;
  stderrText: string;
  onClose: () => void;
  onClear: () => void;
}

export default function LogViewer({ isOpen, instanceName, stdoutText, stderrText, onClose, onClear }: LogViewerProps) {
  const [tab, setTab] = useState<LogStream>("stdout");
  const [autoScroll, setAutoScroll] = useState(true);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  const activeText = tab === "stdout" ? stdoutText : stderrText;
  const linesCount = useMemo(() => (activeText ? activeText.split("\n").length : 0), [activeText]);

  useEffect(() => {
    if (!isOpen) return;
    const el = consoleRef.current;
    if (!el) return;
    if (!autoScroll) return;
    requestAnimationFrame(() => {
      const node = consoleRef.current;
      if (!node) return;
      node.scrollTop = node.scrollHeight;
      requestAnimationFrame(() => {
        const n2 = consoleRef.current;
        if (!n2) return;
        n2.scrollTop = n2.scrollHeight;
      });
    });
  }, [isOpen, activeText, autoScroll]);

  const handleScroll = () => {
    const el = consoleRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom > 60 && autoScroll) {
      setAutoScroll(false);
    }
    if (distanceToBottom <= 5 && !autoScroll) {
      setAutoScroll(true);
    }
  };

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeText || "");
  };

  return (
    <div className="logviewer-overlay" onClick={onClose}>
      <div className="logviewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="logviewer-header">
          <div className="logviewer-title">
            <h2>Logs en tiempo real</h2>
            <p>{instanceName}</p>
          </div>
          <div className="logviewer-actions">
            <button className="logviewer-btn" onClick={onClear} title="Limpiar vista">
              <Trash2 size={16} />
              Limpiar
            </button>
            <button className="logviewer-btn" onClick={handleCopy} title="Copiar logs actuales">
              <Copy size={16} />
              Copiar
            </button>
            <button className="logviewer-btn" onClick={onClose} title="Cerrar">
              <X size={16} />
              Cerrar
            </button>
          </div>
        </div>

        <div className="logviewer-tabs">
          <button className={`logviewer-tab ${tab === "stdout" ? "active" : ""}`} onClick={() => setTab("stdout")}>
            STDOUT
          </button>
          <button className={`logviewer-tab ${tab === "stderr" ? "active" : ""}`} onClick={() => setTab("stderr")}>
            STDERR
          </button>
        </div>

        <div className="logviewer-body">
          <div ref={consoleRef} className="logviewer-console" onScroll={handleScroll}>
            {activeText || "Sin logs todavía..."}
          </div>

          <div className="logviewer-footer">
            <div className="logviewer-meta">{linesCount} líneas</div>
            <label className="logviewer-toggle">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              Auto-scroll
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
