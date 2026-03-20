import { useState, useEffect } from "react";
import { LogIn, User } from "lucide-react";
import Skin3D from "../../components/Skin3D/Skin3D";
import "./Login.css";

interface SavedAccount {
  username: string;
  type: "microsoft" | "offline";
  avatar?: string;
}

interface LoginProps {
  onMicrosoftLogin: () => void;
  onOfflineLogin: () => void;
  onQuickLogin: (account: SavedAccount) => void;
  isLoading: boolean;
  showToast: (message: string, type: "success" | "error" | "info" | "warning") => void;
}

export default function Login({ onMicrosoftLogin, onOfflineLogin, onQuickLogin, isLoading, showToast }: LoginProps) {
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("drk_saved_accounts");
    if (saved) {
      try {
        setSavedAccounts(JSON.parse(saved));
      } catch (e) {
        setSavedAccounts([]);
      }
    }
  }, []);

  return (
    <div className="drk-login-container">
      {/* Animated Background Global */}
      <div className="drk-login-background">
        <div className="drk-stars"></div>
        <div className="drk-nebula"></div>
      </div>

      <div className="drk-login-card drk-selection-card">
        <div className="drk-login-header">
          <div className="drk-logo-container">
            <div className="drk-logo-glow"></div>
            <div className="drk-welcome-logo">DRK</div>
          </div>
          <h2 className="drk-title">Bienvenido al Launcher</h2>
          <p className="drk-subtitle">Elige cómo quieres ingresar al juego</p>
        </div>

        <div className="drk-selection-options">
          {/* DRK Account Card */}
          <div 
            className="drk-selection-option drk-option-primary"
            onClick={() => {
              if (isLoading) {
                showToast("Espera un momento...", "info");
                return;
              }
              onOfflineLogin();
            }}
          >
            <div className="drk-option-icon">
              <User size={28} />
            </div>
            <div className="drk-option-info">
              <h3 className="drk-option-title">Sesión DRK</h3>
              <p className="drk-option-desc">Cuenta centralizada y segura</p>
            </div>
            <div className="drk-option-arrow">
              <LogIn size={20} />
            </div>
          </div>

          {/* Microsoft Account Card */}
          <div 
            className="drk-selection-option"
            onClick={() => {
              if (isLoading) {
                showToast("Espera un momento...", "info");
                return;
              }
              onMicrosoftLogin();
            }}
          >
            <div className="drk-option-icon">
              <svg viewBox="0 0 23 23" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="10" height="10" fill="#F25022"/>
                <rect x="12" y="0" width="10" height="10" fill="#7FBA00"/>
                <rect x="0" y="12" width="10" height="10" fill="#00A4EF"/>
                <rect x="12" y="12" width="10" height="10" fill="#FFB900"/>
              </svg>
            </div>
            <div className="drk-option-info">
              <h3 className="drk-option-title">Microsoft Account</h3>
              <p className="drk-option-desc">Tu skin oficial y multijugador</p>
            </div>
            <div className="drk-option-badge">OFICIAL</div>
          </div>
        </div>

        {savedAccounts.length > 0 && (
          <div className="drk-saved-accounts-section">
            <h4 className="drk-saved-title">Cuentas Guardadas</h4>
            <div className="drk-saved-list">
              {savedAccounts.slice(0, 3).map((account, index) => {
                const getSanitizedAvatar = (avatar: string | undefined, username: string) => {
                  if (!avatar || avatar.includes("mineskin.org/render")) {
                    return `https://mc-heads.net/skin/${username}`;
                  }
                  return avatar;
                };

                return (
                  <div 
                    key={index} 
                    className="drk-saved-item"
                    onClick={() => onQuickLogin(account)}
                  >
                    <div className="drk-saved-avatar-wrapper">
                      <Skin3D 
                        skinUrl={getSanitizedAvatar(account.avatar, account.username)} 
                        width={32} 
                        height={32} 
                        autoRotate={false}
                        walking={false}
                      />
                    </div>
                    <span className="drk-saved-name">{account.username}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
