import { useState, useRef, useEffect } from "react";
import "./Sidebar.css";
import { Lock, Unlock, LogOut, Settings, User, Plus } from "lucide-react";
import Skin3D from "../Skin3D/Skin3D";

interface Instance {
  id: string;
  name: string;
  version: string;
  lastPlayed: string;
  icon: string;
  path: string;
  image?: string;
}

interface SidebarProps {
  instances: Instance[];
  selectedInstance: Instance | null;
  onSelectInstance: (instance: Instance) => void;
  onCreateInstance: () => void;
  onHome: () => void;
  isOfflineMode: boolean;
  onLogout: () => void;
  userAvatar?: string;
  username?: string;
  isAdmin?: boolean;
  onDeleteInstance?: (id: string) => void;
  onOpenAdminLogin?: () => void;
  onProfile: () => void;
  onGlobalSettings: () => void;
}

export default function Sidebar({
  instances,
  selectedInstance,
  onSelectInstance,
  onCreateInstance,
  onHome,
  userAvatar,
  username,
  isAdmin,
  onDeleteInstance,
  onOpenAdminLogin,
  onProfile,
  onGlobalSettings,
  onLogout,
}: SidebarProps) {
  const [hoverPreview, setHoverPreview] = useState<{
    instance: Instance;
    top: number;
    left: number;
  } | null>(null);
  const [permissionDenied, setPermissionDenied] = useState<{ x: number, y: number } | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // If there's no userAvatar, we can use a default name-based skin or Steve
  // Also sanitizing old render URLs that might be saved in profile
  const getSanitizedAvatar = () => {
    if (!userAvatar || userAvatar.includes("mineskin.org/render")) {
      return username ? `https://mc-heads.net/skin/${username}` : `https://mc-heads.net/skin/steve`;
    }
    return userAvatar;
  };

  const finalSkinUrl = getSanitizedAvatar();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, instance: Instance) => {
    e.preventDefault();
    if (isAdmin && onDeleteInstance) {
      onDeleteInstance(instance.id);
    } else {
      setPermissionDenied({ x: e.clientX, y: e.clientY });
      setTimeout(() => setPermissionDenied(null), 2500);
    }
  };

  const handleActionRestricted = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAdmin) {
      setPermissionDenied({ x: e.clientX, y: e.clientY });
      setTimeout(() => setPermissionDenied(null), 2500);
    }
  };

  // Ensure icons are loaded
  if (!Lock || !Unlock || !User) {
    console.error("Lucide icons failed to load");
    return null;
  }

  return (
    <div className="sidebar-container glass-panel">
      <div className="sidebar-top">
        <div className="sidebar-logo" onClick={onHome} style={{ cursor: "pointer" }}>
          <div className="logo-glow"></div>
          <span className="logo-text">DRK</span>
        </div>
      </div>
      <div className="sidebar-instances">
        {instances.length === 0 ? (
          <div className="sidebar-empty">
            <p className="sidebar-empty-text">No hay instancias</p>
            <p className="sidebar-empty-subtext">Crea una nueva para comenzar</p>
          </div>
        ) : (
          <div className="sidebar-instance-list">
            {instances.map((instance) => (
              <div key={instance.id} className="sidebar-instance-wrapper">
                <button
                  className={`sidebar-instance-circle ${selectedInstance?.id === instance.id ? "selected" : ""}`}
                  onClick={() => onSelectInstance(instance)}
                  onContextMenu={(e) => handleContextMenu(e, instance)}
                  title={instance.name}
                  onMouseEnter={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setHoverPreview({
                      instance,
                      top: rect.top + rect.height / 2,
                      left: rect.right + 12,
                    });
                  }}
                  onMouseLeave={() => setHoverPreview(null)}
                >
                  <img
                    src={instance.image || `https://api.dicebear.com/7.x/shapes/svg?seed=${instance.name}`}
                    alt={instance.name}
                    className="sidebar-instance-image"
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {hoverPreview && (
        <div
          className="sidebar-hover-preview"
          style={{ top: hoverPreview.top, left: hoverPreview.left }}
        >
          <img
            src={hoverPreview.instance.image || `https://api.dicebear.com/7.x/shapes/svg?seed=${hoverPreview.instance.name}`}
            alt={hoverPreview.instance.name}
          />
          <span>{hoverPreview.instance.name}</span>
        </div>
      )}
      {permissionDenied && (
        <div 
          className="sidebar-permission-denied"
          style={{ top: permissionDenied.y, left: permissionDenied.x + 20 }}
        >
          <div className="sidebar-permission-content">
            <div className="sidebar-permission-icon">
               <Lock size={16} />
            </div>
            <div className="sidebar-permission-text">
              <span className="sidebar-permission-title">Acceso Denegado</span>
              <span className="sidebar-permission-desc">No tienes permisos para esta acción</span>
            </div>
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <button 
          className={`sidebar-admin-button ${isAdmin ? "active" : ""}`}
          onClick={() => {
            if (isAdmin) {
              onOpenAdminLogin?.();
            } else {
              onOpenAdminLogin?.();
            }
          }}
          title={isAdmin ? "Panel de Administración" : "Acceso Admin"}
        >
          {isAdmin ? <Unlock size={24} /> : <Lock size={24} />}
        </button>

        <button 
          className="sidebar-add-circle" 
          onClick={(e) => {
            if (isAdmin) {
              onCreateInstance();
            } else {
              handleActionRestricted(e);
            }
          }} 
          title="Nueva instancia"
        >
          <Plus size={24} />
        </button>
        
        <div className="sidebar-user-container" ref={userMenuRef}>
          <div 
            className="sidebar-user-avatar" 
            onClick={() => setShowUserMenu(!showUserMenu)}
            title={username || "Usuario"}
          >
            <Skin3D 
              skinUrl={finalSkinUrl} 
              width={42} 
              height={42} 
              autoRotate={true}
              walking={false}
              className="sidebar-3d-skin"
            />
          </div>
          
          {showUserMenu && (
            <div className="sidebar-user-menu">
              <div className="sidebar-user-menu-header">
                <span className="sidebar-user-menu-name">{username || "Jugador"}</span>
                {isAdmin && <span className="sidebar-user-menu-role">Admin</span>}
              </div>
              <div className="sidebar-user-menu-divider"></div>
              
              <button className="sidebar-user-menu-item" onClick={() => { onProfile(); setShowUserMenu(false); }}>
                <User size={16} />
                <span>Perfil</span>
              </button>

              <button className="sidebar-user-menu-item" onClick={() => { onGlobalSettings(); setShowUserMenu(false); }}>
                <Settings size={16} />
                <span>Configuración</span>
              </button>
              
              <div className="sidebar-user-menu-divider"></div>
              
              <button className="sidebar-user-menu-item logout" onClick={onLogout}>
                <LogOut size={16} />
                <span>Cerrar Sesión</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
