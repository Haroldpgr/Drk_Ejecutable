import { useState, useEffect, useRef } from "react";
import { User, Mail, Shield, Calendar, Trophy, Zap, Edit3, Camera, Maximize, X, Upload, Link, Search } from "lucide-react";
import { supabase } from "../../supabase";
import Skin3D from "../../components/Skin3D/Skin3D";
import "./Profile.css";

interface ProfileData {
  username: string;
  email: string;
  avatar_url: string;
  banner_url?: string;
  is_admin: boolean;
  created_at: string;
}

interface ProfileProps {
  showToast?: (message: string, type: "success" | "error" | "info" | "warning") => void;
  onUpdateUser?: (username: string, avatar: string) => void;
}

export default function Profile({ showToast, onUpdateUser }: ProfileProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [showAvatarSelector, setShowAvatarSelector] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [editBanner, setEditBanner] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showSkinPreview, setShowSkinPreview] = useState(false);
  
  // Selector states
  const [selectorMode, setSelectorMode] = useState<"menu" | "link" | "user">("menu");
  const [tempValue, setTempValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (error) throw error;
        const avatar = data.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`;
        setProfile({
          username: data.username,
          email: user.email || "",
          avatar_url: avatar,
          banner_url: data.banner_url || "",
          is_admin: data.is_admin,
          created_at: data.created_at
        });
        setEditName(data.username);
        setEditAvatar(avatar);
        setEditBanner(data.banner_url || "");
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setLoading(false);
    }
  }

  const handleUpdateProfile = async () => {
    if (!editName.trim()) {
      if (showToast) showToast("El nombre de usuario no puede estar vacío", "warning");
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No hay sesión activa");

      const { error } = await supabase
        .from('profiles')
        .update({ 
          username: editName.trim(), 
          avatar_url: editAvatar.trim(),
          banner_url: editBanner.trim()
        })
        .eq('id', user.id);

      if (error) throw error;

      if (showToast) showToast("Perfil actualizado correctamente", "success");
      setIsEditing(false);
      
      // Actualizar estado local
      if (profile) {
        setProfile({ ...profile, username: editName, avatar_url: editAvatar, banner_url: editBanner });
      }

      // Notificar a App.tsx para actualizar el sidebar y gamertag
      if (onUpdateUser) {
        onUpdateUser(editName, editAvatar);
      }
    } catch (error: any) {
      console.error("Error updating profile:", error);
      if (showToast) showToast("Error al actualizar perfil: " + error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        if (isEditing) {
          setEditAvatar(base64);
        } else {
          await updateSkinDirectly(base64);
        }
        setShowAvatarSelector(false);
        if (showToast) showToast("Skin cargada desde el PC", "success");
      };
      reader.readAsDataURL(file);
    }
  };

  const updateSkinDirectly = async (newSkin: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No hay sesión activa");

      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: newSkin })
        .eq('id', user.id);

      if (error) throw error;

      if (profile) {
        setProfile({ ...profile, avatar_url: newSkin });
        setEditAvatar(newSkin);
        if (onUpdateUser) {
          onUpdateUser(profile.username, newSkin);
        }
      }
    } catch (error: any) {
      console.error("Error direct skin update:", error);
      if (showToast) showToast("Error al actualizar skin: " + error.message, "error");
    }
  };

  const applySelectorValue = async () => {
    if (!tempValue.trim()) return;
    
    let finalUrl = tempValue.trim();
    if (selectorMode === "user") {
      // Usar la textura de la skin, no el render estático
      finalUrl = `https://mc-heads.net/skin/${finalUrl}`;
    }
    
    if (isEditing) {
      setEditAvatar(finalUrl);
    } else {
      await updateSkinDirectly(finalUrl);
    }

    setShowAvatarSelector(false);
    setTempValue("");
    setSelectorMode("menu");
    if (showToast) showToast("Skin actualizada", "success");
  };

  const handleUpdateBanner = () => {
    const url = prompt("Introduce la URL de una imagen o GIF para tu fondo de perfil:");
    if (url) {
      setEditBanner(url);
    }
  };

  if (loading) {
    return (
      <div className="profile-loading">
        <div className="drk-spinner"></div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="profile-container animate-fade-in">
      <div className="profile-header glass-panel">
        <div 
          className="profile-cover" 
          style={{ 
            backgroundImage: profile.banner_url ? `url(${profile.banner_url})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundColor: '#0a0a15'
          }}
        >
          {isEditing && (
            <button className="edit-banner-btn" onClick={handleUpdateBanner}>
              <Camera size={16} /> Cambiar Fondo
            </button>
          )}
        </div>
        <div className="profile-info-main">
          <div className="profile-avatar-wrapper" onClick={() => setShowSkinPreview(true)}>
            <div className="profile-avatar-3d-wrapper">
              <Skin3D 
                skinUrl={isEditing ? editAvatar : profile.avatar_url} 
                width={140} 
                height={140} 
              />
            </div>
            <div className="profile-avatar-zoom-hint">
              <Maximize size={14} /> Ampliar
            </div>
          </div>
          <div className="profile-titles">
            {isEditing ? (
              <div className="profile-edit-inputs">
                <input 
                  type="text" 
                  value={editName} 
                  onChange={(e) => setEditName(e.target.value)}
                  className="drk-input-global profile-name-input"
                  placeholder="Nombre de usuario"
                />
                <div className="profile-edit-hint">Tu nombre aparecerá como Gamertag en el juego.</div>
              </div>
            ) : (
              <>
                <h1 className="profile-username">
                  {profile.username}
                  {profile.is_admin && (
                    <span title="Administrador">
                      <Shield className="admin-badge" size={20} />
                    </span>
                  )}
                </h1>
                <p className="profile-email">
                  <Mail size={14} />
                  {profile.email}
                </p>
              </>
            )}
          </div>
          
          <div className="profile-actions">
            {!isEditing && (
              <>
                <button 
                  className="drk-button-secondary profile-action-btn" 
                  onClick={() => fileInputRef.current?.click()}
                  title="Subir Skin desde PC"
                >
                  <Upload size={18} />
                  Subir Skin
                </button>
                <button 
                  className="drk-button-secondary profile-action-btn" 
                  onClick={() => {
                    setSelectorMode("link");
                    setShowAvatarSelector(true);
                  }}
                  title="Poner link de la skin"
                >
                  <Link size={18} />
                  Poner Link
                </button>
                <button 
                  className="drk-button-secondary profile-action-btn" 
                  onClick={() => {
                    setSelectorMode("user");
                    setShowAvatarSelector(true);
                  }}
                  title="Skin de usuario de Minecraft"
                >
                  <Search size={18} />
                  Usuario MC
                </button>
              </>
            )}
            
            {isEditing ? (
              <>
                <button 
                  className="drk-button-secondary profile-action-btn" 
                  onClick={() => {
                    setSelectorMode("menu");
                    setShowAvatarSelector(true);
                  }}
                >
                  <User size={18} />
                  Cambiar Skin
                </button>
                <button 
                  className="settings-cancel-btn" 
                  onClick={() => {
                    setIsEditing(false);
                    setEditName(profile.username);
                    setEditAvatar(profile.avatar_url);
                    setEditBanner(profile.banner_url || "");
                  }}
                  disabled={isSaving}
                >
                  Cancelar
                </button>
                <button 
                  className="drk-button-primary profile-save-btn" 
                  onClick={handleUpdateProfile}
                  disabled={isSaving}
                >
                  {isSaving ? "Guardando..." : "Guardar"}
                </button>
              </>
            ) : (
              <button 
                className="profile-edit-btn drk-button-primary"
                onClick={() => setIsEditing(true)}
              >
                <Edit3 size={18} />
                Editar Perfil
              </button>
            )}
          </div>
        </div>
      </div>

      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        accept="image/*"
        onChange={handleFileChange}
      />

      {showAvatarSelector && (
        <div className="avatar-selector-overlay" onClick={() => setShowAvatarSelector(false)}>
          <div className="avatar-selector-modal glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="avatar-selector-header">
              <h2 className="avatar-selector-title">Cambiar Avatar / Skin</h2>
              <button className="avatar-selector-close" onClick={() => setShowAvatarSelector(false)}><X size={20} /></button>
            </div>

            {selectorMode === "menu" ? (
              <div className="avatar-selector-grid">
                <button className="selector-option-btn glass-card" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={32} />
                  <div className="selector-option-text">
                    <span>Subir desde PC</span>
                    <p>Carga un archivo .png de tu skin</p>
                  </div>
                </button>
                <button className="selector-option-btn glass-card" onClick={() => setSelectorMode("link")}>
                  <Link size={32} />
                  <div className="selector-option-text">
                    <span>Enlace de Imagen</span>
                    <p>Pega una URL directa de imagen</p>
                  </div>
                </button>
                <button className="selector-option-btn glass-card" onClick={() => setSelectorMode("user")}>
                  <Search size={32} />
                  <div className="selector-option-text">
                    <span>Skin por Usuario</span>
                    <p>Usa la skin de un jugador de MC</p>
                  </div>
                </button>
              </div>
            ) : (
              <div className="avatar-selector-input-view">
                <div className="selector-input-container glass-card">
                  <div className="selector-input-icon-wrapper">
                    {selectorMode === "link" ? <Link size={24} /> : <Search size={24} />}
                  </div>
                  <div className="selector-input-field">
                    <label className="selector-label">
                      {selectorMode === "link" ? "Enlace directo de la imagen" : "Nombre del jugador de Minecraft"}
                    </label>
                    <input 
                      type="text" 
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      className="modal-text-input"
                      placeholder={selectorMode === "link" ? "https://imgur.com/tu-skin.png" : "Ej: Notch, Dream..."}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && applySelectorValue()}
                    />
                  </div>
                </div>

                {tempValue.trim() && (
                  <div className="selector-preview-hint animate-fade-in">
                    <div className="preview-avatar-3d-mini">
                      <Skin3D 
                        skinUrl={selectorMode === "user" 
                          ? `https://mc-heads.net/skin/${tempValue.trim()}`
                          : tempValue.trim()
                        } 
                        width={80}
                        height={80}
                      />
                    </div>
                    <span>Previsualización rápida</span>
                  </div>
                )}

                <div className="selector-input-actions">
                  <button className="modal-back-btn" onClick={() => { setSelectorMode("menu"); setTempValue(""); }}>
                    Volver
                  </button>
                  <button className="drk-button-primary modal-confirm-btn" onClick={applySelectorValue}>
                    <Zap size={16} />
                    Confirmar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showSkinPreview && (
        <div className="skin-preview-overlay" onClick={() => setShowSkinPreview(false)}>
          <div className="skin-preview-modal glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="skin-preview-close" onClick={() => setShowSkinPreview(false)}>
              <X size={24} />
            </button>
            <div className="skin-preview-content">
              <Skin3D 
                skinUrl={profile.avatar_url} 
                width={400} 
                height={600} 
                walking={true}
              />
              <div className="skin-preview-info">
                <h2 className="skin-preview-name">{profile.username}</h2>
                <div className="skin-preview-badge">Vista Previa 3D</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="profile-grid">
        <div className="profile-card glass-card">
          <h3 className="card-title">
            <Trophy size={18} />
            Estadísticas
          </h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-value">0</span>
              <span className="stat-label">Horas Jugadas</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">0</span>
              <span className="stat-label">Eventos</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">0</span>
              <span className="stat-label">Logros</span>
            </div>
          </div>
        </div>

        <div className="profile-card glass-card">
          <h3 className="card-title">
            <Calendar size={18} />
            Información
          </h3>
          <div className="info-list">
            <div className="info-item">
              <span className="info-label">Miembro desde</span>
              <span className="info-value">{new Date(profile.created_at).toLocaleDateString()}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Rango</span>
              <span className="info-value">{profile.is_admin ? "Administrador" : "Usuario"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Estado</span>
              <span className="info-value active">Online</span>
            </div>
          </div>
        </div>

        <div className="profile-card glass-card wide">
          <h3 className="card-title">
            <Zap size={18} />
            Actividad Reciente
          </h3>
          <div className="activity-placeholder">
            No hay actividad reciente para mostrar.
          </div>
        </div>
      </div>
    </div>
  );
}
