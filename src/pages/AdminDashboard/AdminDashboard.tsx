import { useState, useEffect } from "react";
import { supabase } from "../../supabase";
import { 
  Users, 
  Layout, 
  Globe, 
  Database, 
  Trash2, 
  Edit, 
  Plus, 
  ArrowLeft,
  Server,
  Package,
  Image as ImageIcon,
  Zap,
  X,
  Ban,
  UserMinus,
  UserPlus,
  RefreshCw,
  Mail,
  Calendar
} from "lucide-react";
import "./AdminDashboard.css";

interface GlobalInstance {
  id: string;
  name: string;
  version: string;
  description: string;
  server_ip?: string;
  modpack_url?: string;
  image?: string;
  is_active: boolean;
}

interface UserProfile {
  id: string;
  username: string;
  email: string;
  is_admin: boolean;
  is_banned?: boolean;
  avatar_url?: string;
  created_at: string;
}

interface AdminDashboardProps {
  onBack: () => void;
  showToast?: (message: string, type: "success" | "error" | "info" | "warning") => void;
}

export default function AdminDashboard({ onBack, showToast }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<"instances" | "users" | "settings">("instances");
  const [globalInstances, setGlobalInstances] = useState<GlobalInstance[]>([]);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Partial<GlobalInstance> | null>(null);
  
  // User Management States
  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  async function fetchData() {
    setLoading(true);
    try {
      if (activeTab === "instances") {
        const { data, error } = await supabase
          .from("global_instances")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;
        setGlobalInstances(data || []);
      } else if (activeTab === "users") {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;
        setUserProfiles(data || []);
      }
    } catch (error: any) {
      console.error("Error fetching admin data:", error);
      if (showToast) showToast("Error al cargar datos: " + error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveInstance() {
    if (!editingInstance?.name || !editingInstance?.version) {
      if (showToast) showToast("Nombre y versión son obligatorios", "error");
      return;
    }

    try {
      const isNew = !editingInstance.id;
      const instanceData = {
        name: editingInstance.name,
        version: editingInstance.version,
        description: editingInstance.description || "",
        server_ip: editingInstance.server_ip,
        modpack_url: editingInstance.modpack_url,
        image: editingInstance.image,
        is_active: editingInstance.is_active ?? true,
      };

      if (isNew) {
        const { error } = await supabase.from("global_instances").insert([instanceData]);
        if (error) throw error;
        if (showToast) showToast("Instancia creada correctamente", "success");
      } else {
        const { error } = await supabase
          .from("global_instances")
          .update(instanceData)
          .eq("id", editingInstance.id);
        if (error) throw error;
        if (showToast) showToast("Instancia actualizada", "success");
      }

      setShowEditModal(false);
      setEditingInstance(null);
      fetchData();
    } catch (error: any) {
      if (showToast) showToast("Error al guardar: " + error.message, "error");
    }
  }

  async function handleUserAction(action: "toggle_admin" | "toggle_ban" | "reset_skin", user: UserProfile) {
    setIsUpdatingUser(true);
    try {
      let updateData: any = {};
      let message = "";

      switch (action) {
        case "toggle_admin":
          updateData = { is_admin: !user.is_admin };
          message = `Usuario ${user.is_admin ? "degradado a jugador" : "ascendido a administrador"}`;
          break;
        case "toggle_ban":
          updateData = { is_banned: !user.is_banned };
          message = `Usuario ${user.is_banned ? "desbaneado" : "baneado"}`;
          break;
        case "reset_skin":
          updateData = { avatar_url: `https://mc-heads.net/skin/${user.username}` };
          message = "Skin reseteada a la de Minecraft";
          break;
      }

      const { error } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("id", user.id);

      if (error) throw error;

      // Update local state
      setUserProfiles(prev => prev.map(u => u.id === user.id ? { ...u, ...updateData } : u));
      if (selectedUser?.id === user.id) {
        setSelectedUser({ ...selectedUser, ...updateData });
      }

      if (showToast) showToast(message, "success");
    } catch (error: any) {
      console.error("Error in user action:", error);
      if (showToast) showToast("Error: " + error.message, "error");
    } finally {
      setIsUpdatingUser(false);
    }
  }

  async function toggleInstanceStatus(id: string, currentStatus: boolean) {
    try {
      const { error } = await supabase
        .from("global_instances")
        .update({ is_active: !currentStatus })
        .eq("id", id);
      if (error) throw error;
      setGlobalInstances(prev => prev.map(inst => inst.id === id ? { ...inst, is_active: !currentStatus } : inst));
      if (showToast) showToast("Estado actualizado", "success");
    } catch (error: any) {
      if (showToast) showToast("Error: " + error.message, "error");
    }
  }

  async function deleteGlobalInstance(id: string) {
    if (!confirm("¿Estás seguro de que quieres eliminar esta instancia global? Esto afectará a todos los usuarios.")) return;
    try {
      const { error } = await supabase
        .from("global_instances")
        .delete()
        .eq("id", id);
      if (error) throw error;
      setGlobalInstances(prev => prev.filter(inst => inst.id !== id));
      if (showToast) showToast("Instancia eliminada", "success");
    } catch (error: any) {
      if (showToast) showToast("Error: " + error.message, "error");
    }
  }

  return (
    <div className="admin-dashboard-container animate-fade-in">
      <div className="admin-dashboard-header">
        <button className="admin-back-btn" onClick={onBack}>
          <ArrowLeft size={20} />
          Volver
        </button>
        <div className="admin-header-title">
          <h1>Panel de Administración</h1>
          <p>Gestiona el ecosistema global de DRK Launcher</p>
        </div>
      </div>

      <div className="admin-dashboard-layout">
        <aside className="admin-sidebar glass-panel">
          <button 
            className={`admin-nav-item ${activeTab === "instances" ? "active" : ""}`}
            onClick={() => setActiveTab("instances")}
          >
            <Layout size={20} />
            <span>Instancias Globales</span>
          </button>
          <button 
            className={`admin-nav-item ${activeTab === "users" ? "active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            <Users size={20} />
            <span>Usuarios Registrados</span>
          </button>
          <button 
            className={`admin-nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Database size={20} />
            <span>Configuración Cloud</span>
          </button>
        </aside>

        <main className="admin-main-content glass-panel">
          {loading ? (
            <div className="admin-loading">
              <Zap className="animate-pulse" size={48} />
              <p>Cargando datos del servidor...</p>
            </div>
          ) : (
            <>
              {activeTab === "instances" && (
                <div className="admin-section">
                  <div className="admin-section-header">
                    <h2>Gestión de Instancias Globales</h2>
                    <button 
                      className="drk-button-primary admin-add-btn"
                      onClick={() => {
                        setEditingInstance({ is_active: true });
                        setShowEditModal(true);
                      }}
                    >
                      <Plus size={18} />
                      Nueva Global
                    </button>
                  </div>
                  <div className="admin-table-wrapper">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Versión</th>
                          <th>Servidor IP</th>
                          <th>Estado</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {globalInstances.map((inst) => (
                          <tr key={inst.id}>
                            <td>
                              <div className="admin-table-name">
                                <ImageIcon size={16} />
                                {inst.name}
                              </div>
                            </td>
                            <td>{inst.version}</td>
                            <td>{inst.server_ip || "N/A"}</td>
                            <td>
                              <span className={`admin-status-badge ${inst.is_active ? "active" : "inactive"}`}>
                                {inst.is_active ? "Activa" : "Oculta"}
                              </span>
                            </td>
                            <td>
                              <div className="admin-table-actions">
                                <button 
                                  className="admin-action-btn edit" 
                                  title="Editar"
                                  onClick={() => {
                                    setEditingInstance(inst);
                                    setShowEditModal(true);
                                  }}
                                >
                                  <Edit size={16} />
                                </button>
                                <button 
                                  className="admin-action-btn toggle" 
                                  title={inst.is_active ? "Ocultar" : "Mostrar"}
                                  onClick={() => toggleInstanceStatus(inst.id, inst.is_active)}
                                >
                                  <Globe size={16} />
                                </button>
                                <button 
                                  className="admin-action-btn delete" 
                                  title="Eliminar"
                                  onClick={() => deleteGlobalInstance(inst.id)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === "users" && (
                <div className="admin-section">
                  <div className="admin-section-header">
                    <h2>Usuarios del Launcher</h2>
                    <div className="admin-stats-pills">
                      <span className="admin-pill">Total: {userProfiles.length}</span>
                    </div>
                  </div>
                  <div className="admin-table-wrapper">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Usuario</th>
                          <th>Email</th>
                          <th>Rol</th>
                          <th>Registro</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userProfiles.map((user) => (
                          <tr key={user.id}>
                            <td>
                              <div className="admin-table-user">
                                <div className="admin-mini-avatar">
                                  <img src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`} alt="" />
                                </div>
                                {user.username}
                              </div>
                            </td>
                            <td>{user.email}</td>
                            <td>
                              <span className={`admin-role-badge ${user.is_admin ? "admin" : "user"}`}>
                                {user.is_admin ? "Administrador" : "Jugador"}
                              </span>
                            </td>
                            <td>{new Date(user.created_at).toLocaleDateString()}</td>
                            <td>
                              <div className="admin-table-actions">
                                <button 
                                  className="admin-action-btn manage" 
                                  title="Gestionar Usuario"
                                  onClick={() => {
                                    setSelectedUser(user);
                                    setShowUserModal(true);
                                  }}
                                >
                                  <Users size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === "settings" && (
                <div className="admin-section">
                  <h2>Configuración de la Nube (Supabase)</h2>
                  <div className="admin-settings-grid">
                    <div className="admin-setting-card glass-panel">
                      <Server size={32} />
                      <h3>Estado de la Base de Datos</h3>
                      <p>Conexión activa con el cluster de Supabase.</p>
                      <div className="admin-setting-status online">En Línea</div>
                    </div>
                    <div className="admin-setting-card glass-panel">
                      <Package size={32} />
                      <h3>Almacenamiento de Modpacks</h3>
                      <p>Configura los buckets para la descarga de mods.</p>
                      <button className="admin-setting-btn">Gestionar Buckets</button>
                    </div>
                    <div className="admin-setting-card glass-panel">
                      <ImageIcon size={32} />
                      <h3>Media & Assets</h3>
                      <p>Gestiona las imágenes globales del launcher.</p>
                      <button className="admin-setting-btn">Explorar Media</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {showEditModal && (
        <div className="admin-modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="admin-modal glass-panel" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h2>{editingInstance?.id ? "Editar Instancia Global" : "Nueva Instancia Global"}</h2>
              <button className="admin-modal-close" onClick={() => setShowEditModal(false)}><X size={20} /></button>
            </div>
            
            <div className="admin-modal-form">
              <div className="admin-input-group">
                <label>Nombre de la Instancia</label>
                <input 
                  type="text" 
                  value={editingInstance?.name || ""} 
                  onChange={e => setEditingInstance(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ej: Evento de Supervivencia"
                />
              </div>
              
              <div className="admin-input-row">
                <div className="admin-input-group">
                  <label>Versión</label>
                  <input 
                    type="text" 
                    value={editingInstance?.version || ""} 
                    onChange={e => setEditingInstance(prev => ({ ...prev, version: e.target.value }))}
                    placeholder="1.20.1"
                  />
                </div>
                <div className="admin-input-group">
                  <label>IP del Servidor (Opcional)</label>
                  <input 
                    type="text" 
                    value={editingInstance?.server_ip || ""} 
                    onChange={e => setEditingInstance(prev => ({ ...prev, server_ip: e.target.value }))}
                    placeholder="play.drk.com"
                  />
                </div>
              </div>

              <div className="admin-input-group">
                <label>Descripción</label>
                <textarea 
                  value={editingInstance?.description || ""} 
                  onChange={e => setEditingInstance(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Detalles sobre este evento o instancia..."
                />
              </div>

              <div className="admin-input-group">
                <label>URL del Modpack / Imagen</label>
                <input 
                  type="text" 
                  value={editingInstance?.image || ""} 
                  onChange={e => setEditingInstance(prev => ({ ...prev, image: e.target.value }))}
                  placeholder="https://link-a-la-imagen.png"
                />
              </div>

              <div className="admin-modal-actions">
                <button className="admin-back-btn" onClick={() => setShowEditModal(false)}>Cancelar</button>
                <button className="drk-button-primary" onClick={handleSaveInstance}>
                  {editingInstance?.id ? "Guardar Cambios" : "Crear Instancia"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUserModal && selectedUser && (
        <div className="admin-modal-overlay" onClick={() => setShowUserModal(false)}>
          <div className="admin-modal user-manage-modal glass-panel" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="user-modal-title">
                <Users size={24} />
                <h2>Gestionar Usuario</h2>
              </div>
              <button className="admin-modal-close" onClick={() => setShowUserModal(false)}><X size={20} /></button>
            </div>

            <div className="user-manage-content">
              <div className="user-info-card glass-card">
                <div className="user-card-avatar">
                  <img src={selectedUser.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedUser.username}`} alt="" />
                </div>
                <div className="user-card-details">
                  <h3>{selectedUser.username}</h3>
                  <div className="user-detail-item">
                    <Mail size={14} />
                    <span>{selectedUser.email}</span>
                  </div>
                  <div className="user-detail-item">
                    <Calendar size={14} />
                    <span>Registrado: {new Date(selectedUser.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="user-status-badges">
                    <span className={`admin-role-badge ${selectedUser.is_admin ? "admin" : "user"}`}>
                      {selectedUser.is_admin ? "Administrador" : "Jugador"}
                    </span>
                    {selectedUser.is_banned && (
                      <span className="admin-status-badge inactive">Baneado</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="user-actions-grid">
                <button 
                  className={`user-action-card glass-card ${selectedUser.is_admin ? "danger" : "success"}`}
                  onClick={() => handleUserAction("toggle_admin", selectedUser)}
                  disabled={isUpdatingUser}
                >
                  <div className="action-icon">
                    {selectedUser.is_admin ? <UserMinus size={24} /> : <UserPlus size={24} />}
                  </div>
                  <div className="action-text">
                    <span>{selectedUser.is_admin ? "Quitar Admin" : "Dar Admin"}</span>
                    <p>{selectedUser.is_admin ? "Degradar a jugador normal" : "Dar permisos totales"}</p>
                  </div>
                </button>

                <button 
                  className={`user-action-card glass-card ${selectedUser.is_banned ? "success" : "danger"}`}
                  onClick={() => handleUserAction("toggle_ban", selectedUser)}
                  disabled={isUpdatingUser}
                >
                  <div className="action-icon">
                    <Ban size={24} />
                  </div>
                  <div className="action-text">
                    <span>{selectedUser.is_banned ? "Desbanear" : "Banear Usuario"}</span>
                    <p>{selectedUser.is_banned ? "Restaurar acceso al launcher" : "Bloquear acceso permanentemente"}</p>
                  </div>
                </button>

                <button 
                  className="user-action-card glass-card info"
                  onClick={() => handleUserAction("reset_skin", selectedUser)}
                  disabled={isUpdatingUser}
                >
                  <div className="action-icon">
                    <RefreshCw size={24} />
                  </div>
                  <div className="action-text">
                    <span>Resetear Skin</span>
                    <p>Volver a la skin original de MC</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
