import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Monitor, HardDrive, Globe, ShieldCheck } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import "./Settings.css";

interface SettingsProps {
  showToast?: (message: string, type: "success" | "error" | "info" | "warning") => void;
}

export default function Settings({ showToast }: SettingsProps) {
  const [notifications, setNotifications] = useState(true);
  const [ram, setRam] = useState(4096);
  const [systemRam, setSystemRam] = useState(8192);

  useEffect(() => {
    // Cargar ajustes guardados
    const savedNotifications = localStorage.getItem("drk_settings_notifications") !== "false";
    const savedRam = Number(localStorage.getItem("drk_settings_global_ram")) || 4096;
    
    setNotifications(savedNotifications);
    setRam(savedRam);

    invoke<number>("get_system_ram").then(setSystemRam).catch(console.error);
  }, []);

  const handleSave = () => {
    localStorage.setItem("drk_settings_notifications", String(notifications));
    localStorage.setItem("drk_settings_global_ram", String(ram));
    
    if (showToast) {
      showToast("Configuración global guardada correctamente", "success");
    }
  };

  return (
    <div className="settings-page animate-fade-in">
      <div className="settings-page-header glass-panel">
        <div className="header-icon">
          <SettingsIcon size={32} />
        </div>
        <div className="header-text">
          <h1>Configuración Global</h1>
          <p>Personaliza tu experiencia en DRK Launcher</p>
        </div>
        <button className="settings-save-global drk-button-primary" onClick={handleSave}>
          Guardar Cambios
        </button>
      </div>

      <div className="settings-page-grid">
        <div className="settings-page-card glass-card">
          <h3 className="settings-page-card-title">
            <Monitor size={18} />
            Lanzador
          </h3>
          <div className="settings-page-field">
            <div className="field-info">
              <span className="field-label">Notificaciones</span>
              <span className="field-description">Muestra avisos sobre actualizaciones y eventos.</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={notifications} onChange={(e) => setNotifications(e.target.checked)} />
              <span className="slider round"></span>
            </label>
          </div>
        </div>

        <div className="settings-page-card glass-card">
          <h3 className="settings-page-card-title">
            <HardDrive size={18} />
            Recursos Globales
          </h3>
          <div className="settings-page-field vertical">
            <div className="field-info">
              <span className="field-label">Asignación de RAM Predeterminada</span>
              <span className="field-description">Memoria que se asignará a las nuevas instancias.</span>
            </div>
            <div className="ram-slider-group">
              <input 
                type="range" 
                min="1024" 
                max={systemRam} 
                step="512" 
                value={ram} 
                onChange={(e) => setRam(Number(e.target.value))}
                className="drk-slider"
              />
              <span className="ram-value">{(ram / 1024).toFixed(1)} GB</span>
            </div>
          </div>
        </div>

        <div className="settings-page-card glass-card">
          <h3 className="settings-page-card-title">
            <ShieldCheck size={18} />
            Privacidad y Seguridad
          </h3>
          <div className="settings-page-field">
            <div className="field-info">
              <span className="field-label">Modo Incógnito</span>
              <span className="field-description">Oculta tu actividad de juego a otros usuarios.</span>
            </div>
            <label className="switch">
              <input type="checkbox" />
              <span className="slider round"></span>
            </label>
          </div>
        </div>

        <div className="settings-page-card glass-card">
          <h3 className="settings-page-card-title">
            <Globe size={18} />
            Idioma y Región
          </h3>
          <div className="settings-page-field">
            <div className="field-info">
              <span className="field-label">Idioma del Launcher</span>
            </div>
            <select className="drk-select">
              <option value="es">Español (ES)</option>
              <option value="en">English (US)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
