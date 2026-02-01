import { useState, FormEvent } from "react";
import { ArrowLeft, User, Mail, Lock, LogIn } from "lucide-react";
import "./OfflineLogin.css";

interface OfflineLoginProps {
  onBack: () => void;
  onLogin: (username: string, email: string, password: string, isLogin: boolean) => void;
  isLoading: boolean;
}

export default function OfflineLogin({ onBack, onLogin, isLoading }: OfflineLoginProps) {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onLogin(username, email, password, isLoginMode);
  };

  return (
    <div className="offline-login-container">
      {/* Background */}
      <div className="offline-login-background">
        <div className="offline-login-stars"></div>
        <div className="offline-login-nebula"></div>
      </div>

      <div className="offline-login-content">
        {/* Header */}
        <div className="offline-login-header">
          <button
            onClick={onBack}
            className="offline-login-back-button"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="offline-login-title">Offline Account</h1>
        </div>

        {/* Toggle Login/Register */}
        <div className="offline-login-toggle">
          <button
            onClick={() => setIsLoginMode(true)}
            className={`offline-login-toggle-button ${
              isLoginMode ? "offline-login-toggle-active" : ""
            }`}
          >
            Iniciar Sesión
          </button>
          <button
            onClick={() => setIsLoginMode(false)}
            className={`offline-login-toggle-button ${
              !isLoginMode ? "offline-login-toggle-active" : ""
            }`}
          >
            Registrarse
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="offline-login-form">
          <div className="offline-login-field">
            <label className="offline-login-label">
              <User size={20} />
              Usuario
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="offline-login-input"
              placeholder="Ingresa tu usuario"
              required
            />
          </div>

          {!isLoginMode && (
            <div className="offline-login-field">
              <label className="offline-login-label">
                <Mail size={20} />
                Correo Electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="offline-login-input"
                placeholder="tu@email.com"
                required
              />
            </div>
          )}

          <div className="offline-login-field">
            <label className="offline-login-label">
              <Lock size={20} />
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="offline-login-input"
              placeholder="Ingresa tu contraseña"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="offline-login-submit-button"
          >
            {isLoading ? (
              <div className="offline-login-spinner"></div>
            ) : (
              <>
                <LogIn size={20} />
                <span>{isLoginMode ? "Iniciar Sesión" : "Registrarse"}</span>
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="offline-login-footer">
          <p>Modo Offline - Sin conexión a internet</p>
        </div>
      </div>
    </div>
  );
}

