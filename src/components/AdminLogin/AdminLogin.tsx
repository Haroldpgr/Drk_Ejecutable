import { useState } from "react";
import "./AdminLogin.css";
import { Lock, X } from "lucide-react";

interface AdminLoginProps {
  onLogin: (password: string) => Promise<boolean>;
  onClose: () => void;
}

export default function AdminLogin({ onLogin, onClose }: AdminLoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    
    const success = await onLogin(password);
    if (success) {
      onClose();
    } else {
      setError("Contraseña incorrecta");
    }
    setLoading(false);
  };

  return (
    <div className="admin-login-overlay" onClick={onClose}>
      <div className="admin-login-modal" onClick={e => e.stopPropagation()}>
        <button className="admin-login-close" onClick={onClose}>
          <X size={20} />
        </button>
        
        <div className="admin-login-header">
          <div className="admin-login-icon">
            <Lock size={24} />
          </div>
          <h2>Acceso Administrativo</h2>
          <p>Ingresa la contraseña para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="admin-login-form">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            className="admin-login-input"
            autoFocus
          />
          {error && <p className="admin-login-error">{error}</p>}
          
          <button type="submit" className="admin-login-submit" disabled={loading}>
            {loading ? "Verificando..." : "Acceder"}
          </button>
        </form>
      </div>
    </div>
  );
}
