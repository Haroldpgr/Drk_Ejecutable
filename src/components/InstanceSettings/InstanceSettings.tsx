import { useState, useEffect } from "react";
import { X, Save, Folder, FileText, Cpu, Maximize, Trash2, Settings as SettingsIcon, Package, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";
import "./InstanceSettings.css";

interface Instance {
  id: string;
  name: string;
  version: string;
  lastPlayed: string;
  icon: string;
  path: string;
  image?: string;
  ram?: number;
  resolutionWidth?: number;
  resolutionHeight?: number;
  serverIp?: string;
  serverName?: string;
  modpackUrl?: string;
}

interface ModEntry {
  file_name: string;
  enabled: boolean;
}

interface InstanceSettingsProps {
  instance: Instance;
  isAdmin: boolean;
  onClose: () => void;
  onSave: (updatedInstance: Instance) => void;
  onOpenInstanceFolder: (instanceId: string, kind: "root" | "logs" | "mods" | "minecraft") => void;
  onDelete: (instanceId: string) => void;
}

export default function InstanceSettings({ instance, isAdmin, onClose, onSave, onOpenInstanceFolder, onDelete }: InstanceSettingsProps) {
  const [name, setName] = useState(instance.name);
  const [version, setVersion] = useState(instance.version);
  const [ram, setRam] = useState(instance.ram || 4096);
  const [width, setWidth] = useState(instance.resolutionWidth || 854);
  const [height, setHeight] = useState(instance.resolutionHeight || 480);
  const [serverIp, setServerIp] = useState(instance.serverIp || "");
  const [serverName, setServerName] = useState(instance.serverName || "");
  const [modpackUrl, setModpackUrl] = useState(instance.modpackUrl || "");
  const [systemRam, setSystemRam] = useState(8192);
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [modsLoading, setModsLoading] = useState(false);

  useEffect(() => {
    // Get system RAM for the slider
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<number>("get_system_ram").then(setSystemRam).catch(console.error);
    });
  }, []);

  async function refreshMods() {
    setModsLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<ModEntry[]>("get_instance_mods", { instanceId: instance.id });
      setMods(list || []);
    } catch {
      setMods([]);
    } finally {
      setModsLoading(false);
    }
  }

  useEffect(() => {
    refreshMods();
  }, [instance.id]);

  async function toggleMod(mod: ModEntry) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_instance_mod_enabled", { instanceId: instance.id, fileName: mod.file_name, enabled: !mod.enabled });
      refreshMods();
    } catch {}
  }

  const handleSave = () => {
    onSave({
      ...instance,
      name,
      version,
      ram,
      resolutionWidth: width,
      resolutionHeight: height,
      serverIp,
      serverName,
      modpackUrl,
    });
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title-group">
            <SettingsIcon size={24} className="settings-icon-main" />
            <h2 className="settings-title">Ajustes de {instance.name}</h2>
          </div>
          <button className="settings-close-btn" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h3 className="settings-section-title">
              <FileText size={18} />
              General
            </h3>
            <div className="settings-card glass-card">
              <div className="settings-grid">
                <div className="settings-field">
                  <label>Nombre de la Instancia</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="drk-input-global"
                  />
                </div>
                <div className="settings-field">
                  <label>Versión de Minecraft</label>
                  <input
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    className="drk-input-global"
                    disabled
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">
              <Cpu size={18} />
              Rendimiento
            </h3>
            <div className="settings-card glass-card">
              <div className="settings-field">
                <div className="settings-label-group">
                  <label>Asignación de RAM</label>
                  <span className="settings-value-badge">{(ram / 1024).toFixed(1)} GB</span>
                </div>
                <input
                  type="range"
                  min="1024"
                  max={systemRam}
                  step="512"
                  value={ram}
                  onChange={(e) => setRam(parseInt(e.target.value))}
                  className="settings-slider"
                />
                <div className="settings-slider-labels">
                  <span>1 GB</span>
                  <span>{Math.floor(systemRam / 1024)} GB</span>
                </div>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">
              <Maximize size={18} />
              Pantalla
            </h3>
            <div className="settings-card glass-card">
              <div className="settings-grid">
                <div className="settings-field">
                  <label>Ancho</label>
                  <input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(parseInt(e.target.value) || 854)}
                    className="drk-input-global"
                  />
                </div>
                <div className="settings-field">
                  <label>Alto</label>
                  <input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(parseInt(e.target.value) || 480)}
                    className="drk-input-global"
                  />
                </div>
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="settings-section">
              <h3 className="settings-section-title">
                <SettingsIcon size={18} />
                Servidor y Modpack
              </h3>
              <div className="settings-card glass-card">
                <div className="settings-grid">
                  <div className="settings-field">
                    <label>Nombre del Servidor</label>
                    <input
                      type="text"
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      className="drk-input-global"
                    />
                  </div>
                  <div className="settings-field">
                    <label>IP del Servidor</label>
                    <input
                      type="text"
                      value={serverIp}
                      onChange={(e) => setServerIp(e.target.value)}
                      className="drk-input-global"
                    />
                  </div>
                  <div className="settings-field" style={{ gridColumn: "span 2" }}>
                    <label>URL del Modpack</label>
                    <input
                      type="text"
                      value={modpackUrl}
                      onChange={(e) => setModpackUrl(e.target.value)}
                      className="drk-input-global"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="settings-section">
            <h3 className="settings-section-title">
              <Folder size={18} />
              Archivos
            </h3>
            <div className="settings-actions-grid">
              <button className="settings-action-btn glass-card" onClick={() => onOpenInstanceFolder(instance.id, "root")}>
                <Folder size={20} />
                <span>Ver Carpeta</span>
              </button>
              <button className="settings-action-btn glass-card" onClick={() => onOpenInstanceFolder(instance.id, "logs")}>
                <FileText size={20} />
                <span>Ver Logs</span>
              </button>
              <button className="settings-action-btn glass-card" onClick={() => onOpenInstanceFolder(instance.id, "mods")}>
                <Package size={20} />
                <span>Ver Mods</span>
              </button>
              {isAdmin && (
                <button className="settings-action-btn danger glass-card" onClick={() => onDelete(instance.id)}>
                  <Trash2 size={20} />
                  <span>Eliminar Instancia</span>
                </button>
              )}
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">
              <Package size={18} />
              Mods
            </h3>
            <div className="settings-card glass-card">
              <div className="settings-mods-header">
                <div className="settings-mods-meta">{mods.length} mods</div>
                <button className="settings-mods-refresh" onClick={refreshMods} disabled={modsLoading}>
                  <RefreshCw size={16} />
                  {modsLoading ? "Cargando..." : "Actualizar"}
                </button>
              </div>
              <div className="settings-mods-list">
                {mods.length === 0 ? (
                  <div className="settings-mods-empty">No hay mods instalados.</div>
                ) : (
                  mods.map((m) => (
                    <button key={m.file_name} className={`settings-mod-row ${m.enabled ? "enabled" : "disabled"}`} onClick={() => toggleMod(m)}>
                      <span className="settings-mod-name">{m.file_name}</span>
                      <span className="settings-mod-state">
                        {m.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="settings-cancel-btn" onClick={onClose}>Cancelar</button>
          <button className="settings-save-btn drk-button-primary" onClick={handleSave}>
            <Save size={20} />
            <span>Guardar Cambios</span>
          </button>
        </div>
      </div>
    </div>
  );
}
