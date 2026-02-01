import { useState, useEffect } from "react";
import { LogIn, User } from "lucide-react";
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
}

export default function Login({ onMicrosoftLogin, onOfflineLogin, onQuickLogin, isLoading }: LoginProps) {
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);

  useEffect(() => {
    // Cargar cuentas guardadas
    const saved = localStorage.getItem("drk_saved_accounts");
    if (saved) {
      try {
        const accounts = JSON.parse(saved);
        setSavedAccounts(accounts);
      } catch (e) {
        console.error("Error loading saved accounts:", e);
      }
    }
  }, []);

  return (
    <div className="login-container">
      {/* Animated Background Elements */}
      <div className="login-background">
        {/* Stars */}
        <div className="stars"></div>
        <div className="stars2"></div>
        <div className="stars3"></div>
        
        {/* Nebula Effect */}
        <div className="nebula nebula-1"></div>
        <div className="nebula nebula-2"></div>
      </div>

      <div className="login-content">
        {/* Logo and Title Section */}
        <div className="login-header">
          <div className="login-logo-container">
            <div className="login-logo-glow"></div>
            <div className="login-logo">
              <span className="login-logo-text">DRK</span>
            </div>
          </div>
          
          <h1 className="login-title">
            Please <span className="login-title-highlight">Log-In</span> with your account
          </h1>
        </div>

        {/* Quick Login - Saved Accounts */}
        {savedAccounts.length > 0 && (
          <div className="login-quick-login">
            <h3 className="login-quick-title">Iniciar Sesión Rápido</h3>
            <div className="login-quick-accounts">
              {savedAccounts.map((account, index) => (
                <button
                  key={index}
                  className="login-quick-account"
                  onClick={() => onQuickLogin(account)}
                  disabled={isLoading}
                >
                  <div className="login-quick-avatar">
                    {account.avatar ? (
                      <img src={account.avatar} alt={account.username} />
                    ) : (
                      <User size={24} />
                    )}
                  </div>
                  <div className="login-quick-info">
                    <span className="login-quick-username">{account.username}</span>
                    <span className="login-quick-type">
                      {account.type === "microsoft" ? "Microsoft" : "Offline"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Account Selection Cards */}
        <div className="login-accounts">
          {/* Microsoft Account Card */}
          <div 
            className="login-account-card login-account-card-premium"
            onClick={onMicrosoftLogin}
          >
            <div className="login-account-icon">
              <div className="login-microsoft-icon">
                <svg viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0" y="0" width="10" height="10" fill="#F25022"/>
                  <rect x="12" y="0" width="10" height="10" fill="#7FBA00"/>
                  <rect x="0" y="12" width="10" height="10" fill="#00A4EF"/>
                  <rect x="12" y="12" width="10" height="10" fill="#FFB900"/>
                </svg>
              </div>
            </div>
            <div className="login-account-content">
              <h3 className="login-account-title">Microsoft Account</h3>
              <p className="login-account-description">Premium account with full access</p>
            </div>
            <button 
              className="login-account-button login-account-button-premium"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="login-spinner"></div>
              ) : (
                <>
                  <LogIn size={20} />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </div>

          {/* Offline Account Card */}
          <div 
            className="login-account-card login-account-card-offline"
            onClick={onOfflineLogin}
          >
            <div className="login-account-icon">
              <div className="login-offline-icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
                </svg>
              </div>
            </div>
            <div className="login-account-content">
              <h3 className="login-account-title">Offline Mode</h3>
              <p className="login-account-description">No premium - Local account</p>
            </div>
            <button 
              className="login-account-button login-account-button-offline"
            >
              <LogIn size={20} />
              <span>Continue</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="login-footer">
          <p className="login-footer-text">DRK Launcher v2.0.0</p>
        </div>
      </div>
    </div>
  );
}
