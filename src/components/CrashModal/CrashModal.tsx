import { X, AlertTriangle, Copy } from 'lucide-react';
import './CrashModal.css';

interface CrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  error: string;
  code: number;
}

export default function CrashModal({ isOpen, onClose, error, code }: CrashModalProps) {
  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(`Error Code: ${code}\n\n${error}`);
  };

  return (
    <div className="crash-modal-overlay" onClick={onClose}>
      <div className="crash-modal" onClick={e => e.stopPropagation()}>
        <div className="crash-modal-header">
          <div className="crash-modal-title-group">
            <div className="crash-modal-icon">
              <AlertTriangle size={24} />
            </div>
            <div className="crash-modal-title">
              <h2>El juego se ha cerrado inesperadamente</h2>
              <p>Código de salida: {code}</p>
            </div>
          </div>
          <button className="crash-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="crash-modal-content">
          <p style={{ color: '#d1d5db', marginBottom: '1rem' }}>
            Se ha detectado un error crítico durante la ejecución del juego. 
            A continuación se muestran los detalles del registro de errores:
          </p>
          
          <div className="crash-modal-logs">
            {error || "No hay detalles disponibles."}
          </div>
        </div>

        <div className="crash-modal-actions">
          <button className="crash-btn crash-btn-secondary" onClick={handleCopy}>
            <Copy size={16} />
            Copiar Error
          </button>
          <button className="crash-btn crash-btn-primary" onClick={onClose}>
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
