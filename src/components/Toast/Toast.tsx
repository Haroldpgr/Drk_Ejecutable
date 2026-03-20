import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import './Toast.css';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  duration?: number;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, duration = 4000, onClose }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(onClose, 300); // Esperar a que termine la animación de salida
  };

  const getIcon = () => {
    switch (type) {
      case 'success': return <CheckCircle2 size={20} />;
      case 'error': return <XCircle size={20} />;
      case 'warning': return <AlertTriangle size={20} />;
      default: return <Info size={20} />;
    }
  };

  return (
    <div className={`drk-toast glass-panel ${type} ${isExiting ? 'exit' : 'enter'}`}>
      <div className="drk-toast-icon">
        {getIcon()}
      </div>
      <div className="drk-toast-content">
        <p>{message}</p>
      </div>
      <button className="drk-toast-close" onClick={handleClose}>
        <X size={16} />
      </button>
      <div className="drk-toast-progress" style={{ animationDuration: `${duration}ms` }}></div>
    </div>
  );
};

export default Toast;
