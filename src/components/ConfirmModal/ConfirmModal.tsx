import "./ConfirmModal.css";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  isDanger = false,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal-container" onClick={(e) => e.stopPropagation()}>
        <button className="confirm-modal-close" onClick={onCancel}>
          <X size={20} />
        </button>
        
        <div className="confirm-modal-icon-wrapper">
          <div className={`confirm-modal-icon ${isDanger ? "danger" : ""}`}>
            <AlertTriangle size={32} />
          </div>
        </div>

        <div className="confirm-modal-content">
          <h3 className="confirm-modal-title">{title}</h3>
          <p className="confirm-modal-message">{message}</p>
        </div>

        <div className="confirm-modal-actions">
          <button className="confirm-modal-button cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button 
            className={`confirm-modal-button confirm ${isDanger ? "danger" : ""}`} 
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
