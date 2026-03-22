import { useEffect, useState } from "react";
import "./AdminLogin.css";
import { Lock, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface AdminLoginProps {
  onLogin: (password: string) => Promise<boolean>;
  onClose: () => void;
}

export default function AdminLogin({ onLogin, onClose }: AdminLoginProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    invoke<boolean>("is_admin_configured")
      .then((configured) => setNeedsSetup(!configured))
      .catch(() => setNeedsSetup(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (needsSetup) {
        if (!password || password.length < 8) {
          setError("La contraseña debe tener al menos 8 caracteres");
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Las contraseñas no coinciden");
          setLoading(false);
          return;
        }
        await invoke("set_admin_password", { password });
        setNeedsSetup(false);
      }

      const success = await onLogin(password);
      if (success) {
        onClose();
      } else {
        setError(needsSetup ? "No se pudo activar el acceso admin" : "Contraseña incorrecta");
      }
    } catch {
      setError("Error al procesar la solicitud");
    } finally {
      setLoading(false);
    }
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
          <p>{needsSetup ? "Crea una contraseña para activar el modo admin" : "Ingresa la contraseña para continuar"}</p>
        </div>

        <form onSubmit={handleSubmit} className="admin-login-form">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={needsSetup ? "Nueva contraseña" : "Contraseña"}
            className="admin-login-input"
            autoFocus
          />
          {needsSetup && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirmar contraseña"
              className="admin-login-input"
            />
          )}
          {error && <p className="admin-login-error">{error}</p>}
          
          <button type="submit" className="admin-login-submit" disabled={loading}>
            {loading ? "Procesando..." : needsSetup ? "Crear y Acceder" : "Acceder"}
          </button>
        </form>
      </div>
    </div>
  );
}
