import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Save, Server, Cpu, Image as ImageIcon, Plus, Trash2, Link as LinkIcon, Eye, ChevronLeft, ChevronRight, Upload, ArrowLeft, ArrowRight } from "lucide-react";
import "./CreateInstance.css";


interface CreateInstanceProps {
  onClose: () => void;
  onSave: (instanceData: InstanceData) => void;
}

export interface InstanceData {
  name: string;
  description?: string;
  images?: string[];
  ram: number;
  serverIp?: string;
  serverName?: string;
  modpackUrl?: string;
  mods: any[];
  launcher: string;
  version: string;
  modloader?: string;
  resolutionWidth?: number;
  resolutionHeight?: number;
  // Recuadros de Noticias (Nuevo)
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
  // Legacy fields
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

interface ImageUploadInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function ImageUploadInput({ value, onChange, placeholder = "URL de imagen..." }: ImageUploadInputProps) {
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onChange(reader.result as string);
        e.target.value = "";
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="create-instance-input-with-action">
      <input 
        type="text" 
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        className="create-instance-input" 
        placeholder={placeholder} 
      />
      <label 
        className={`create-instance-upload-btn-mini ${value ? 'has-image' : ''}`} 
        title="Subir imagen"
        style={value ? { backgroundImage: `url(${value})` } : {}}
      >
        <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
        <div className="upload-icon-overlay">
           <Upload size={16} />
        </div>
      </label>
    </div>
  );
}

export default function CreateInstance({ onClose, onSave }: CreateInstanceProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [ram, setRam] = useState(4096);
  const [systemRam, setSystemRam] = useState(8192);
  const [serverIp, setServerIp] = useState("");
  const [serverName, setServerName] = useState("");
  const [modpackUrl, setModpackUrl] = useState("");
  const [version, setVersion] = useState("1.20.1");
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedLauncher, setSelectedLauncher] = useState<string>("");
  const [modloader, setModloader] = useState("vanilla");
  const [loaderVersion, setLoaderVersion] = useState<string>("");
  const [resolutionWidth, setResolutionWidth] = useState(854);
  const [resolutionHeight, setResolutionHeight] = useState(480);
  const [javaInfo, setJavaInfo] = useState<{recommended: number; installed: boolean; path: string} | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  
  // News Cards State
  const [newsLeftImage, setNewsLeftImage] = useState("");
  const [newsLeftTitle, setNewsLeftTitle] = useState("");
  const [newsLeftContent, setNewsLeftContent] = useState("");

  const [newsCenterImage, setNewsCenterImage] = useState("");
  const [newsCenterTitle, setNewsCenterTitle] = useState("");
  const [newsCenterContent, setNewsCenterContent] = useState("");

  const [newsRightImage, setNewsRightImage] = useState("");
  const [newsRightTitle, setNewsRightTitle] = useState("");
  const [newsRightContent, setNewsRightContent] = useState("");
  
  // Recuadros de información (Legacy / Bottom Sections)
  const [eventCardImage] = useState("");
  const [eventName] = useState("");
  const [eventDate] = useState("");
  const [eventRewards] = useState("");
  
  const [statsCardImage, setStatsCardImage] = useState("");
  const [playersOnline, setPlayersOnline] = useState<number | undefined>(undefined);
  const [latency, setLatency] = useState<number | undefined>(undefined);
  const [serverStatus, setServerStatus] = useState("Estable");
  
  const [infoCardImage, setInfoCardImage] = useState("");
  const [modsInstalled, setModsInstalled] = useState<number | undefined>(undefined);
  const [lastUpdate, setLastUpdate] = useState("");

  useEffect(() => {
    // detectLaunchers(); // Eliminamos el escaneo pesado
    loadSystemRam();
    loadVersions();
    setSelectedLauncher("official"); // Default interno
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadJavaInfo() {
      try {
        const info = await invoke<{ recommended: number; installed: boolean; path: string }>("get_java_info", { mcVersion: version });
        if (!cancelled) {
          setJavaInfo(info);
        }
      } catch (error) {
        console.error("Error loading Java info:", error);
        if (!cancelled) {
          setJavaInfo(null);
        }
      }
    }

    loadJavaInfo();
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    let cancelled = false;

    async function loadLoaderRecommendation() {
      if (modloader === "vanilla") {
        setLoaderVersion("");
        return;
      }
      try {
        const recommendation = await invoke<string>("get_loader_recommendation", {
          loader: modloader,
          mcVersion: version,
        });
        if (!cancelled) {
          setLoaderVersion(recommendation);
        }
      } catch (error) {
        console.error("Error loading loader recommendation:", error);
        if (!cancelled) {
          setLoaderVersion("");
        }
      }
    }

    loadLoaderRecommendation();
    return () => {
      cancelled = true;
    };
  }, [modloader, version]);

  async function loadVersions() {
    try {
      const v = await invoke<string[]>("get_mc_versions", { limit: 12 });
      if (v && v.length) {
        setVersions(v);
        setVersion(v[0]);
      }
    } catch (e) {
      console.error("Error loading versions", e);
    }
  }

  async function loadSystemRam() {
    try {
      const totalRam = await invoke<number>("get_system_ram");
      setSystemRam(totalRam);
      setRam(Math.floor(totalRam * 0.5));
    } catch (error) {
      console.error("Error loading system RAM:", error);
    }
  }


  function handleCarouselUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setImages([...images, result]);
        e.target.value = "";
      };
      reader.readAsDataURL(file);
    }
  }

  function moveImage(index: number, direction: 'left' | 'right') {
    if (direction === 'left' && index > 0) {
      const newImages = [...images];
      [newImages[index - 1], newImages[index]] = [newImages[index], newImages[index - 1]];
      setImages(newImages);
    } else if (direction === 'right' && index < images.length - 1) {
      const newImages = [...images];
      [newImages[index + 1], newImages[index]] = [newImages[index], newImages[index + 1]];
      setImages(newImages);
    }
  }

  function addImage() {
    if (newImageUrl.trim()) {
      setImages([...images, newImageUrl.trim()]);
      setNewImageUrl("");
    }
  }

  function removeImage(index: number) {
    setImages(images.filter((_, i) => i !== index));
    if (previewImageIndex >= images.length - 1) {
      setPreviewImageIndex(Math.max(0, images.length - 2));
    }
  }

  async function handleDownloadJava() {
    if (!javaInfo || javaInfo.installed) {
      return;
    }
    try {
      await invoke("download_java", { major: javaInfo.recommended });
      const info = await invoke<{ recommended: number; installed: boolean; path: string }>("get_java_info", { mcVersion: version });
      setJavaInfo(info);
    } catch (error) {
      console.error("Error downloading Java:", error);
      alert("Error al descargar Java");
    }
  }

  function handleSave() {
    if (!name.trim()) {
      alert("Por favor ingresa un nombre para la instancia");
      return;
    }

    if (!selectedLauncher) {
      alert("Por favor selecciona un launcher");
      return;
    }

    setIsLoading(true);

    const instanceData: InstanceData = {
      name: name.trim(),
      description: description.trim() || undefined,
      images: images.length > 0 ? images : undefined,
      ram,
      serverIp: serverIp.trim() || undefined,
      serverName: serverName.trim() || undefined,
      modpackUrl: modpackUrl.trim() || undefined,
      mods: [],
      launcher: selectedLauncher,
      version,
      modloader,
      resolutionWidth,
      resolutionHeight,
      newsLeft: (newsLeftImage || newsLeftTitle || newsLeftContent) ? {
        image: newsLeftImage.trim() || undefined,
        title: newsLeftTitle.trim() || undefined,
        content: newsLeftContent.trim() || undefined,
      } : undefined,
      newsCenter: (newsCenterImage || newsCenterTitle || newsCenterContent) ? {
        image: newsCenterImage.trim() || undefined,
        title: newsCenterTitle.trim() || undefined,
        content: newsCenterContent.trim() || undefined,
      } : undefined,
      newsRight: (newsRightImage || newsRightTitle || newsRightContent) ? {
        image: newsRightImage.trim() || undefined,
        title: newsRightTitle.trim() || undefined,
        content: newsRightContent.trim() || undefined,
      } : undefined,
      eventCard: (eventCardImage || eventName || eventDate || eventRewards) ? {
        image: eventCardImage.trim() || undefined,
        eventName: eventName.trim() || undefined,
        date: eventDate.trim() || undefined,
        rewards: eventRewards.trim() || undefined,
      } : undefined,
      statsCard: (statsCardImage || playersOnline !== undefined || latency !== undefined || serverStatus) ? {
        image: statsCardImage.trim() || undefined,
        playersOnline: playersOnline,
        latency: latency,
        status: serverStatus.trim() || undefined,
      } : undefined,
      infoCard: (infoCardImage || modsInstalled !== undefined || lastUpdate) ? {
        image: infoCardImage.trim() || undefined,
        modsInstalled: modsInstalled,
        lastUpdate: lastUpdate.trim() || undefined,
      } : undefined,
    };

    setTimeout(() => {
      onSave(instanceData);
      setIsLoading(false);
      onClose();
    }, 1000);
  }

  const previewImages = images.length > 0 ? images : [];
  const currentPreviewImage = previewImages[previewImageIndex] || null;

  return (
    <div className="create-instance-overlay" onClick={onClose}>
      <div className="create-instance-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="create-instance-header">
          <h2 className="create-instance-title">Crear Nueva Instancia</h2>
          <div className="create-instance-header-actions">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="create-instance-preview-toggle"
              title={showPreview ? "Ocultar preview" : "Mostrar preview"}
            >
              <Eye size={20} />
            </button>
            <button onClick={onClose} className="create-instance-close">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="create-instance-layout">
          {/* Left Side - Form */}
          <div className="create-instance-form-section">
            <div className="create-instance-form-content">
              {/* Basic Info */}
              <div className="create-instance-form-group">
                <h3 className="create-instance-group-title">Información Básica</h3>
                
                <div className="create-instance-field">
                  <label className="create-instance-label">
                    Nombre de la Instancia *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="create-instance-input"
                    placeholder="Ej: DRK Server"
                    required
                  />
                </div>

                <div className="create-instance-field">
                  <label className="create-instance-label">
                    Descripción
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="create-instance-input create-instance-textarea"
                    placeholder="Describe tu instancia..."
                    rows={3}
                  />
                </div>

                <div className="create-instance-field">
                  <label className="create-instance-label">
                    <ImageIcon size={18} />
                    Imágenes del Carrusel
                  </label>
                  <div className="create-instance-images-control">
                    <input
                      type="text"
                      value={newImageUrl}
                      onChange={(e) => setNewImageUrl(e.target.value)}
                      className="create-instance-input"
                      placeholder="URL de imagen..."
                      onKeyPress={(e) => e.key === "Enter" && addImage()}
                    />
                    <label className="create-instance-upload-btn" title="Subir desde PC">
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleCarouselUpload} 
                        style={{ display: 'none' }} 
                      />
                      <Upload size={18} />
                    </label>
                    <button onClick={addImage} className="create-instance-add-image" title="Añadir URL">
                      <Plus size={18} />
                    </button>
                  </div>
                  {images.length > 0 && (
                    <div className="create-instance-images-preview">
                      {images.map((img, index) => (
                        <div key={index} className="create-instance-image-item">
                          <img src={img} alt={`Preview ${index + 1}`} loading="lazy" decoding="async" onError={() => removeImage(index)} />
                          <div className="create-instance-image-actions">
                            {index > 0 && (
                              <button onClick={() => moveImage(index, 'left')} className="create-instance-move-image" title="Mover a la izquierda">
                                <ArrowLeft size={14} />
                              </button>
                            )}
                            {index < images.length - 1 && (
                              <button onClick={() => moveImage(index, 'right')} className="create-instance-move-image" title="Mover a la derecha">
                                <ArrowRight size={14} />
                              </button>
                            )}
                            <button onClick={() => removeImage(index)} className="create-instance-remove-image" title="Eliminar">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="create-instance-field">
                  <label className="create-instance-label">
                    <Cpu size={18} />
                    Asignación de RAM
                  </label>
                  <div className="create-instance-ram-control">
                    <input
                      type="range"
                      min="1024"
                      max={systemRam > 0 ? systemRam : 16384}
                      step="512"
                      value={ram}
                      onChange={(e) => setRam(parseInt(e.target.value))}
                      className="create-instance-slider"
                    />
                    <span className="create-instance-ram-value">{ram / 1024} GB</span>
                  </div>
                  <div className="create-instance-ram-presets">
                    {[2048, 4096, 6144, 8192].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => setRam(preset)}
                        className={ram === preset ? "active" : ""}
                        type="button"
                      >
                        {preset / 1024}GB
                      </button>
                    ))}
                  </div>
                </div>

                <div className="create-instance-field">
                  <label className="create-instance-label">
                    Resolución de Pantalla
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>Ancho</span>
                      <input
                        type="number"
                        value={resolutionWidth}
                        onChange={(e) => setResolutionWidth(parseInt(e.target.value) || 854)}
                        className="create-instance-input"
                        placeholder="854"
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>Alto</span>
                      <input
                        type="number"
                        value={resolutionHeight}
                        onChange={(e) => setResolutionHeight(parseInt(e.target.value) || 480)}
                        className="create-instance-input"
                        placeholder="480"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Mods */}
              <div className="create-instance-form-group">
                <h3 className="create-instance-group-title">Modpack / Mods</h3>
                <div className="create-instance-field">
                  <label className="create-instance-label">
                    <LinkIcon size={18} />
                    URL del Modpack (Mediafire, Dropbox, etc.)
                  </label>
                  <input
                    type="text"
                    value={modpackUrl}
                    onChange={(e) => setModpackUrl(e.target.value)}
                    className="create-instance-input"
                    placeholder="https://www.mediafire.com/..."
                  />
                </div>
              </div>

              {/* Server */}
              <div className="create-instance-form-group">
                <h3 className="create-instance-group-title">Servidor</h3>
                <div className="create-instance-field">
                  <label className="create-instance-label">
                    <Server size={18} />
                    Nombre del Servidor
                  </label>
                  <input
                    type="text"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    className="create-instance-input"
                    placeholder="Ej: DRK Server"
                  />
                </div>
                <div className="create-instance-field">
                  <label className="create-instance-label">
                    IP del Servidor
                  </label>
                  <input
                    type="text"
                    value={serverIp}
                    onChange={(e) => setServerIp(e.target.value)}
                    className="create-instance-input"
                    placeholder="Ej: play.drkserver.com"
                  />
                </div>
              </div>

            {/* Version & Loader */}
            <div className="create-instance-form-group">
              <h3 className="create-instance-group-title">Versión y Loader</h3>
              <div className="create-instance-grid">
                <div className="create-instance-field">
                  <label className="create-instance-label">Versión de Minecraft</label>
                  <select value={version} onChange={(e) => setVersion(e.target.value)} className="create-instance-input">
                    {versions.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="create-instance-field">
                  <label className="create-instance-label">Loader</label>
                  <select value={modloader} onChange={(e) => setModloader(e.target.value)} className="create-instance-input">
                    <option value="vanilla">Vanilla</option>
                    <option value="fabric">Fabric</option>
                    <option value="forge">Forge</option>
                  </select>
                  {loaderVersion && (
                    <div className="create-instance-hint">Versión recomendada del loader: {loaderVersion}</div>
                  )}
                </div>
                <div className="create-instance-field">
                  <label className="create-instance-label">Java recomendado</label>
                  <div className="create-instance-hint">
                    {javaInfo ? (
                      <>
                        Java {javaInfo.recommended} {javaInfo.installed ? `(instalado)` : `(no instalado)`}
                        {!javaInfo.installed && (
                          <button onClick={handleDownloadJava} className="create-instance-button create-instance-button-secondary" style={{ marginLeft: 8 }}>Descargar Java</button>
                        )}
                      </>
                    ) : (
                      <>Detectando...</>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Launcher Selection Removed - Now handled internally */}
            {/* 
              <div className="create-instance-form-group">
                <h3 className="create-instance-group-title">Launcher</h3>
                <div className="create-instance-launchers">
                  {availableLaunchers.map((launcher) => (
                    <div
                      key={launcher.name}
                      className={`create-instance-launcher-item ${
                        selectedLauncher === launcher.name ? "selected" : ""
                      }`}
                      onClick={() => setSelectedLauncher(launcher.name)}
                    >
                      <div className="create-instance-launcher-icon">
                        {launcher.type === "official" && "🎮"}
                        {launcher.type === "elyprism" && "⚡"}
                        {launcher.type === "custom" && "🔧"}
                      </div>
                      <div className="create-instance-launcher-info">
                        <h4 className="create-instance-launcher-name">{launcher.name}</h4>
                      </div>
                      {selectedLauncher === launcher.name && (
                        <div className="create-instance-launcher-check">✓</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            */}

              {/* News & Information (New Structure) */}
              <div className="create-instance-form-group">
                <h3 className="create-instance-group-title">Noticias (3 Recuadros Superiores)</h3>
                
                {/* News Left */}
                <div className="create-instance-card-section">
                  <h4 className="create-instance-card-section-title">Noticia Izquierda</h4>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Imagen</label>
                    <ImageUploadInput value={newsLeftImage} onChange={setNewsLeftImage} />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Título</label>
                    <input type="text" value={newsLeftTitle} onChange={(e) => setNewsLeftTitle(e.target.value)} className="create-instance-input" placeholder="Título..." />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Contenido</label>
                    <textarea value={newsLeftContent} onChange={(e) => setNewsLeftContent(e.target.value)} className="create-instance-input create-instance-textarea" placeholder="Contenido breve..." rows={2} />
                  </div>
                </div>

                {/* News Center */}
                <div className="create-instance-card-section">
                  <h4 className="create-instance-card-section-title">Noticia Central</h4>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Imagen</label>
                    <ImageUploadInput value={newsCenterImage} onChange={setNewsCenterImage} />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Título</label>
                    <input type="text" value={newsCenterTitle} onChange={(e) => setNewsCenterTitle(e.target.value)} className="create-instance-input" placeholder="Título..." />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Contenido</label>
                    <textarea value={newsCenterContent} onChange={(e) => setNewsCenterContent(e.target.value)} className="create-instance-input create-instance-textarea" placeholder="Contenido breve..." rows={2} />
                  </div>
                </div>

                {/* News Right */}
                <div className="create-instance-card-section">
                  <h4 className="create-instance-card-section-title">Noticia Derecha</h4>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Imagen</label>
                    <ImageUploadInput value={newsRightImage} onChange={setNewsRightImage} />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Título</label>
                    <input type="text" value={newsRightTitle} onChange={(e) => setNewsRightTitle(e.target.value)} className="create-instance-input" placeholder="Título..." />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Contenido</label>
                    <textarea value={newsRightContent} onChange={(e) => setNewsRightContent(e.target.value)} className="create-instance-input create-instance-textarea" placeholder="Contenido breve..." rows={2} />
                  </div>
                </div>
              </div>

              {/* Server Info (Middle) */}
              <div className="create-instance-form-group">
                <h3 className="create-instance-group-title">Información del Servidor (Configurado)</h3>
                <div className="create-instance-card-section">
                   <div className="create-instance-field">
                    <label className="create-instance-label">Imagen del Server</label>
                    <ImageUploadInput value={statsCardImage} onChange={setStatsCardImage} />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Jugadores en Línea</label>
                    <input type="number" value={playersOnline || ""} onChange={(e) => setPlayersOnline(e.target.value ? parseInt(e.target.value) : undefined)} className="create-instance-input" placeholder="Ej: 50" />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Latencia (ms)</label>
                    <input type="number" value={latency || ""} onChange={(e) => setLatency(e.target.value ? parseInt(e.target.value) : undefined)} className="create-instance-input" placeholder="Ej: 45" />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Estado</label>
                    <input type="text" value={serverStatus} onChange={(e) => setServerStatus(e.target.value)} className="create-instance-input" placeholder="Ej: Estable" />
                  </div>
                </div>
              </div>

              {/* Basic Info (Bottom) */}
              <div className="create-instance-form-group">
                <h3 className="create-instance-group-title">Información Básica</h3>
                <div className="create-instance-card-section">
                  <div className="create-instance-field">
                    <label className="create-instance-label">Imagen Info</label>
                    <ImageUploadInput value={infoCardImage} onChange={setInfoCardImage} />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Mods Instalados</label>
                    <input type="number" value={modsInstalled || ""} onChange={(e) => setModsInstalled(e.target.value ? parseInt(e.target.value) : undefined)} className="create-instance-input" placeholder="Ej: 25" />
                  </div>
                  <div className="create-instance-field">
                    <label className="create-instance-label">Última Actualización</label>
                    <input type="text" value={lastUpdate} onChange={(e) => setLastUpdate(e.target.value)} className="create-instance-input" placeholder="Ej: 10 de Enero, 2024" />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="create-instance-footer">
              <button
                onClick={handleSave}
                disabled={isLoading || !name.trim() || !selectedLauncher}
                className="create-instance-button create-instance-button-primary"
              >
                {isLoading ? (
                  <>
                    <div className="create-instance-spinner"></div>
                    <span>Creando...</span>
                  </>
                ) : (
                  <>
                    <Save size={20} />
                    <span>Crear Instancia</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Side - Preview */}
          {showPreview && (
            <div className="create-instance-preview-section">
              <h3 className="create-instance-preview-title">Vista Previa</h3>
              <div className="create-instance-preview-card">
                {/* Instance Icon/Image */}
                <div className="create-instance-preview-image">
                  {currentPreviewImage ? (
                    <>
                      <img src={currentPreviewImage} alt="Preview" loading="lazy" decoding="async" />
                      {previewImages.length > 1 && (
                        <>
                          <button
                            onClick={() => setPreviewImageIndex((prev) => (prev - 1 + previewImages.length) % previewImages.length)}
                            className="create-instance-preview-nav create-instance-preview-nav-prev"
                          >
                            <ChevronLeft size={20} />
                          </button>
                          <button
                            onClick={() => setPreviewImageIndex((prev) => (prev + 1) % previewImages.length)}
                            className="create-instance-preview-nav create-instance-preview-nav-next"
                          >
                            <ChevronRight size={20} />
                          </button>
                          <div className="create-instance-preview-indicators">
                            {previewImages.map((_, index) => (
                              <button
                                key={index}
                                className={`create-instance-preview-indicator ${index === previewImageIndex ? "active" : ""}`}
                                onClick={() => setPreviewImageIndex(index)}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="create-instance-preview-placeholder">
                      <span>{name || "DRK"}</span>
                    </div>
                  )}
                </div>

                {/* Instance Info */}
                <div className="create-instance-preview-info">
                  <h4 className="create-instance-preview-name">{name || "Nombre de la Instancia"}</h4>
                  {description && (
                    <p className="create-instance-preview-description">{description}</p>
                  )}
                  <div className="create-instance-preview-details">
                    <span className="create-instance-preview-detail">Versión: {version}</span>
                    <span className="create-instance-preview-detail">RAM: {Math.round(ram / 1024)} GB</span>
                    {serverName && (
                      <span className="create-instance-preview-detail">Servidor: {serverName}</span>
                    )}
                    {selectedLauncher && (
                      <span className="create-instance-preview-detail">Launcher: {selectedLauncher}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
