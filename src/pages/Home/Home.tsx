import { useState, useEffect } from "react";
import { Play, Settings, Download, ChevronLeft, ChevronRight, CheckCircle2, Eye } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import "./Home.css";

interface Instance {
  id: string;
  name: string;
  version: string;
  lastPlayed: string;
  icon: string;
  path: string;
  image?: string;
  images?: string[];
  description?: string;
  modpackUrl?: string;
  serverIp?: string;
  serverName?: string;
  ram?: number;
  launcher?: string;
  // Recuadros de Noticias
  newsLeft?: {
    image?: string;
    title?: string;
    content?: string;
  };
  newsCenter?: {
    image?: string;
    title?: string;
    content?: string;
  };
  newsRight?: {
    image?: string;
    title?: string;
    content?: string;
  };
  // Legacy
  eventCard?: {
    image?: string;
    title?: string;
    eventName?: string;
    date?: string;
    rewards?: string;
  };
  statsCard?: {
    image?: string;
    playersOnline?: number;
    latency?: number;
    status?: string;
  };
  infoCard?: {
    image?: string;
    modsInstalled?: number;
    lastUpdate?: string;
  };
}

interface HomeProps {
  selectedInstance: Instance | null;
  isLaunching: boolean;
  launchProgress?: { percent: number; stage: string; message: string } | null;
  isDownloading: boolean;
  launchingInstanceId: string | null;
  launchDurationMs?: number | null;
  playFlowInstanceId?: string | null;
  isCheckingReady?: boolean;
  onSettings: (instance: Instance) => void;
  instances: Instance[];
  onDownloadInstance: (instance: Instance) => Promise<boolean> | boolean | void;
  onExecuteInstance: (instance: Instance) => void;
  onHome?: () => void;
}

export default function Home({
  selectedInstance,
  isLaunching,
  launchProgress,
  isDownloading,
  launchingInstanceId,
  launchDurationMs,
  playFlowInstanceId,
  isCheckingReady,
  onSettings,
  instances,
  onDownloadInstance,
  onExecuteInstance,
}: HomeProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [downloadedInstances, setDownloadedInstances] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const raw = localStorage.getItem("drk_downloaded_instances");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        setDownloadedInstances(parsed);
      } catch {
        setDownloadedInstances({});
      }
    }
  }, []);

  useEffect(() => {
    if (selectedInstance) {
      setCurrentImageIndex(0);
      checkInstanceStatus(selectedInstance);
      setShowWelcome(false);
    } else {
      setShowWelcome(true);
    }
  }, [selectedInstance, downloadedInstances]);

  useEffect(() => {
    if (launchingInstanceId && launchProgress?.stage === "descarga_completa") {
      setDownloadedInstances((prev) => {
        if (prev[launchingInstanceId]) {
          return prev;
        }
        const next = { ...prev, [launchingInstanceId]: true };
        localStorage.setItem("drk_downloaded_instances", JSON.stringify(next));
        return next;
      });
      localStorage.setItem(`drk_instance_last_verified_${launchingInstanceId}`, new Date().toISOString());
      if (selectedInstance?.id === launchingInstanceId) {
        setIsDownloaded(true);
      }
    }
    // Also check on launch success (in case it was already downloaded but we missed the event)
    if (launchingInstanceId && launchProgress?.stage === "iniciado") {
        setDownloadedInstances((prev) => {
            const next = { ...prev, [launchingInstanceId]: true };
            localStorage.setItem("drk_downloaded_instances", JSON.stringify(next));
            return next;
        });
        if (selectedInstance?.id === launchingInstanceId) {
            setIsDownloaded(true);
        }
    }
  }, [launchProgress, launchingInstanceId, selectedInstance]);

  useEffect(() => {
    if (isVerifying && selectedInstance && launchingInstanceId === selectedInstance.id && launchProgress?.stage === "descarga_completa") {
      setIsVerifying(false);
    }
  }, [isVerifying, launchProgress, launchingInstanceId, selectedInstance]);

  async function checkInstanceStatus(instance: Instance) {
    let downloaded = Boolean(downloadedInstances[instance.id]);
    try {
      downloaded = await invoke<boolean>("check_instance_ready", { instanceId: instance.id });
    } catch {}
    setIsDownloaded(downloaded);
  }

  async function handleVerifyFiles() {
    if (!selectedInstance) {
      return;
    }
    setIsVerifying(true);
    try {
      await onDownloadInstance(selectedInstance);
    } catch (error) {
      console.error("Error verifying files:", error);
      alert("Error al verificar archivos");
    }
  }
  
  async function handleOpenLogs() {
    if (!selectedInstance) {
      return;
    }
    try {
      const logsPath = `${selectedInstance.path}\\logs`;
      await invoke("open_folder", { path: logsPath });
    } catch (error) {
      console.error("Error abriendo carpeta de logs:", error);
      alert("No se pudo abrir la carpeta de logs");
    }
  }
  

  // Pantalla de bienvenida
  if (showWelcome || !selectedInstance) {
    return (
      <div className="home-container">
        <div className="home-content">
          <div className="home-welcome-screen">
            <div className="home-welcome-logo-container">
              <div className="home-welcome-logo-glow"></div>
              <div className="home-welcome-logo">
                <span className="home-welcome-logo-text">DRK</span>
              </div>
            </div>
            <h1 className="home-welcome-title">Bienvenido a Eventos DRK</h1>
            <p className="home-welcome-subtitle">Selecciona una instancia para comenzar</p>
          </div>
        </div>
      </div>
    );
  }

  // Vista de instancia seleccionada
  const images = selectedInstance.images || (selectedInstance.image ? [selectedInstance.image] : []);
  const currentImage = images.length > 0 ? images[currentImageIndex] : null;
  const isBlocked = Boolean(launchingInstanceId && selectedInstance.id !== launchingInstanceId);
  const runningInstance = launchingInstanceId
    ? instances.find((inst) => inst.id === launchingInstanceId)
    : null;
  const isActiveInstance = launchingInstanceId === selectedInstance.id;
  const activeProgress = isActiveInstance ? launchProgress : null;
  const progressLabel = activeProgress?.message || activeProgress?.stage || "";
  const isDownloadingActive = isActiveInstance ? isDownloading : false;
  const isLaunchingActive = isActiveInstance ? isLaunching : false;
  const isCheckingThis = isCheckingReady && playFlowInstanceId === selectedInstance.id;
  const isPlayFlowActive = isLaunchingActive || isDownloadingActive || isCheckingThis;
  const launchSeconds = launchDurationMs ? Math.max(1, Math.round(launchDurationMs / 1000)) : null;

  function nextImage() {
    if (images.length > 0) {
      setCurrentImageIndex((prev) => (prev + 1) % images.length);
    }
  }

  function prevImage() {
    if (images.length > 0) {
      setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
    }
  }

  return (
    <div className="home-container">
      <div className="home-content">
        <div className="home-instance-view">
          {/* Top Section - Carrusel Completo */}
          <div className="home-instance-top-section">
            <div className="home-instance-carousel-wrapper">
              {images.length > 0 ? (
                <div className="home-instance-carousel">
                  <button 
                    onClick={prevImage}
                    className="home-carousel-button home-carousel-button-prev"
                    disabled={images.length <= 1}
                  >
                    <ChevronLeft size={28} />
                  </button>
                  
                  <div className="home-carousel-image-container">
                    <img 
                      src={currentImage ?? undefined} 
                      alt={`${selectedInstance.name} - ${currentImageIndex + 1}`}
                      className="home-carousel-image"
                    />
                    {images.length > 1 && (
                      <div className="home-carousel-indicators">
                        {images.map((_, index) => (
                          <button
                            key={index}
                            className={`home-carousel-indicator ${index === currentImageIndex ? "active" : ""}`}
                            onClick={() => setCurrentImageIndex(index)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <button 
                    onClick={nextImage}
                    className="home-carousel-button home-carousel-button-next"
                    disabled={images.length <= 1}
                  >
                    <ChevronRight size={28} />
                  </button>
                </div>
              ) : (
                <div className="home-instance-carousel-placeholder">
                  <div className="home-logo-large">
                    <span>DRK</span>
                  </div>
                </div>
              )}
            </div>

            {launchProgress && (launchProgress.stage === "error" || launchProgress.stage === "crasheado") && (
              <div className="home-instance-error-banner" style={{ marginTop: 10, padding: 10, background: "#2b2f3a", border: "1px solid #444", borderRadius: 6, color: "#e5e7eb", maxWidth: 480 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {launchProgress.stage === "error" ? "Error de arranque" : "El juego se cerró con error"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{launchProgress.message}</div>
              </div>
            )}

            {/* Botón de Ajustes */}
            <button 
              onClick={() => onSettings(selectedInstance)}
              className="home-instance-settings-button"
              title="Ajustes"
            >
              <Settings size={24} />
              <span>Ajustes</span>
            </button>
            
          </div>

          {/* Línea de Separación */}
          <div className="home-instance-separator"></div>

          {/* Bottom Section - Botones y Recuadros de Información */}
          <div className="home-instance-bottom">
            {/* Botones de Acción */}
            <div className="home-instance-actions">
              {runningInstance && (
                <div className="home-instance-alert">
                  Ya hay una instancia en ejecución: {runningInstance.name}
                </div>
              )}
              
              <div className="home-instance-play-group">
                <button
                  onClick={() => onExecuteInstance(selectedInstance)}
                  disabled={isLaunchingActive || isDownloadingActive || Boolean(launchingInstanceId) || isCheckingThis}
                  className="home-instance-play-button"
                  title={!isDownloaded ? "Debes descargar la instancia primero" : "Jugar"}
                >
                  {isLaunchingActive || isDownloadingActive || isCheckingThis ? (
                    <>
                      <div className="home-spinner"></div>
                      <span>
                        {isCheckingThis ? "Comprobando" : isDownloadingActive ? "Verificando" : activeProgress?.stage === "iniciado" ? "Jugando" : "Lanzando"}
                        {activeProgress?.percent !== undefined && activeProgress?.stage !== "iniciado" && !isCheckingThis ? ` ${activeProgress.percent}%` : ""}
                        {progressLabel && activeProgress?.stage !== "iniciado" && !isCheckingThis ? ` · ${progressLabel}` : ""}
                      </span>
                    </>
                  ) : (
                    <>
                      <Play size={24} />
                      <span>Jugar</span>
                    </>
                  )}
                </button>

                {!isDownloaded && (
                  <button
                    onClick={() => onDownloadInstance(selectedInstance)}
                    disabled={isVerifying || isDownloadingActive || isBlocked}
                    className="home-instance-download-button"
                  >
                    {isDownloadingActive ? (
                      <>
                        <div className="home-spinner"></div>
                        <span>Descargando...</span>
                      </>
                    ) : (
                      <>
                        <Download size={24} />
                        <span>Descargar</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  onClick={handleVerifyFiles}
                  disabled={isVerifying || isDownloadingActive || isBlocked}
                  className="home-instance-verify-button"
                  title="Verificar archivos y descargar lo que falte automáticamente"
                >
                  {isVerifying || isDownloadingActive ? (
                    <>
                      <div className="home-spinner"></div>
                      <span>Verificando...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={20} />
                      <span>Verificar</span>
                    </>
                  )}
                </button>
              </div>
                <button
                  onClick={handleOpenLogs}
                  disabled={isDownloadingActive || isLaunchingActive || isBlocked}
                  className="home-instance-verify-button"
                  title="Abrir carpeta de logs de la instancia (latest.log, latest_err.log, launch-debug.txt)"
                >
                  <>
                    <Eye size={20} />
                    <span>Ver Logs</span>
                  </>
                </button>

            </div>
            {isPlayFlowActive && activeProgress && (isLaunchingActive || isDownloadingActive) && (
              <div className="home-instance-play-progress">
                <div className="home-instance-play-progress-track">
                  <div
                    className="home-instance-play-progress-bar"
                    style={{ width: `${activeProgress.percent}%` }}
                  ></div>
                </div>
                <span className="home-instance-play-progress-label">
                  {activeProgress.percent}% · {progressLabel || "Preparando"}
                </span>
              </div>
            )}
            {launchSeconds && !isLaunchingActive && !isDownloadingActive && (
              <div className="home-instance-launch-time">
                Tiempo de apertura: {launchSeconds}s
              </div>
            )}

            {/* New Layout: News, Server Info, Basic Info */}
            <div className="home-instance-info-container">
              
              {/* 1. News Section (3 Columns) */}
              <div className="home-news-section">
                {/* Left Card */}
                <div className="home-news-card">
                  <div className="home-news-card-image">
                    {selectedInstance.newsLeft?.image ? (
                      <img src={selectedInstance.newsLeft.image} alt="Noticia" />
                    ) : (
                      <div className="home-news-card-placeholder">📰</div>
                    )}
                  </div>
                  <div className="home-news-card-content">
                    <h4>{selectedInstance.newsLeft?.title || "Noticia"}</h4>
                    <p>{selectedInstance.newsLeft?.content || "Información y noticias del servidor."}</p>
                  </div>
                </div>

                {/* Center Card */}
                <div className="home-news-card">
                  <div className="home-news-card-image">
                    {selectedInstance.newsCenter?.image ? (
                      <img src={selectedInstance.newsCenter.image} alt="Noticia" />
                    ) : (
                      <div className="home-news-card-placeholder">📰</div>
                    )}
                  </div>
                  <div className="home-news-card-content">
                    <h4>{selectedInstance.newsCenter?.title || "Noticia Central"}</h4>
                    <p>{selectedInstance.newsCenter?.content || "Información importante."}</p>
                  </div>
                </div>

                {/* Right Card */}
                <div className="home-news-card">
                  <div className="home-news-card-image">
                    {selectedInstance.newsRight?.image ? (
                      <img src={selectedInstance.newsRight.image} alt="Noticia" />
                    ) : (
                      <div className="home-news-card-placeholder">📰</div>
                    )}
                  </div>
                  <div className="home-news-card-content">
                    <h4>{selectedInstance.newsRight?.title || "Noticia"}</h4>
                    <p>{selectedInstance.newsRight?.content || "Más información."}</p>
                  </div>
                </div>
              </div>

              {/* 2. Server Info Section */}
              <div className="home-info-section home-server-info-section">
                <h3 className="home-section-title">INFORMACIÓN IMPORTANTE DEL SERVIDOR</h3>
                <div className="home-info-grid">
                  <div className="home-info-item">
                    <span className="home-info-label">Jugadores en línea:</span>
                    <span className="home-info-value">{selectedInstance.statsCard?.playersOnline !== undefined ? selectedInstance.statsCard.playersOnline : "N/A"}</span>
                  </div>
                  <div className="home-info-item">
                    <span className="home-info-label">Latencia:</span>
                    <span className="home-info-value">{selectedInstance.statsCard?.latency !== undefined ? `${selectedInstance.statsCard.latency}ms` : "N/A"}</span>
                  </div>
                  <div className="home-info-item">
                    <span className="home-info-label">Estado:</span>
                    <span className="home-info-value">{selectedInstance.statsCard?.status || "Estable"}</span>
                  </div>
                  <div className="home-info-item">
                     <span className="home-info-label">IP:</span>
                     <span className="home-info-value">{selectedInstance.serverIp || "N/A"}</span>
                  </div>
                </div>
              </div>

              {/* 3. Basic Info Section */}
              <div className="home-info-section home-basic-info-section">
                <h3 className="home-section-title">INFORMACIÓN BÁSICA DE LA INSTANCIA</h3>
                <div className="home-info-grid">
                  <div className="home-info-item">
                    <span className="home-info-label">Versión:</span>
                    <span className="home-info-value">{selectedInstance.version}</span>
                  </div>
                  <div className="home-info-item">
                    <span className="home-info-label">RAM:</span>
                    <span className="home-info-value">{selectedInstance.ram ? `${Math.round(selectedInstance.ram / 1024)}GB` : "N/A"}</span>
                  </div>
                  <div className="home-info-item">
                    <span className="home-info-label">Mods:</span>
                    <span className="home-info-value">{selectedInstance.infoCard?.modsInstalled !== undefined ? selectedInstance.infoCard.modsInstalled : "N/A"}</span>
                  </div>
                  <div className="home-info-item">
                    <span className="home-info-label">Actualizado:</span>
                    <span className="home-info-value">{selectedInstance.infoCard?.lastUpdate || new Date(selectedInstance.lastPlayed).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
