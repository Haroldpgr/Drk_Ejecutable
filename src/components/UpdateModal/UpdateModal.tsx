import { X, Download, FileText } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./UpdateModal.css";

export interface LauncherRelease {
  version: string;
  title?: string | null;
  notes?: string | null;
  url?: string | null;
  created_at?: string | null;
  mandatory?: boolean | null;
}

interface UpdateModalProps {
  isOpen: boolean;
  currentVersion: string;
  release: LauncherRelease | null;
  onClose: () => void;
  onSkip: () => void;
}

export default function UpdateModal({ isOpen, currentVersion, release, onClose, onSkip }: UpdateModalProps) {
  if (!isOpen || !release) return null;

  const title = release.title || "Nueva actualización disponible";
  const notes = release.notes || "Sin notas de versión.";
  const url = release.url || "";

  return (
    <div className="update-overlay" onClick={onClose}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-header">
          <div className="update-title">
            <h2>{title}</h2>
            <p>DRK Launcher {currentVersion} → {release.version}</p>
          </div>
          <button className="update-close" onClick={onClose} title="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="update-body">
          <div className="update-meta">
            <span className="update-pill">Versión: {release.version}</span>
            {release.mandatory ? <span className="update-pill">Obligatoria</span> : <span className="update-pill">Opcional</span>}
          </div>

          <div className="update-card">
            <div className="update-card-title">
              <FileText size={18} />
              Notas de la versión
            </div>
            <div className="update-notes">{notes}</div>
          </div>

          <div className="update-actions">
            {!release.mandatory && (
              <button className="update-btn" onClick={onSkip}>
                Más tarde
              </button>
            )}
            <button
              className="update-btn primary"
              onClick={() => {
                if (url) openUrl(url);
              }}
              disabled={!url}
              title={!url ? "Falta el link de descarga" : "Abrir descarga"}
            >
              <Download size={18} />
              Actualizar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
