import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Login from "./pages/Login/Login";
import OfflineLogin from "./pages/OfflineLogin/OfflineLogin";
import Home from "./pages/Home/Home";
import Sidebar from "./components/Sidebar/Sidebar";
import CreateInstance, { InstanceData } from "./pages/CreateInstance/CreateInstance";
import AdminLogin from "./components/AdminLogin/AdminLogin";
import ConfirmModal from "./components/ConfirmModal/ConfirmModal";
import CrashModal from "./components/CrashModal/CrashModal";
import Toast, { ToastType } from "./components/Toast/Toast";
import "./components/Toast/Toast.css";
import InstanceSettings from "./components/InstanceSettings/InstanceSettings";
import LogViewer from "./components/LogViewer/LogViewer";
import UpdateModal, { LauncherRelease } from "./components/UpdateModal/UpdateModal";
import Profile from "./pages/Profile/Profile";
import Settings from "./pages/Settings/Settings";
import AdminDashboard from "./pages/AdminDashboard/AdminDashboard";
import { supabase } from "./supabase";
import { useGameLogs } from "./hooks/useGameLogs";
import { compareSemver } from "./utils/semver";
import { getVersion } from "@tauri-apps/api/app";
import "./App.css";

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
  ram?: number;
  serverIp?: string;
  serverName?: string;
  modpackUrl?: string;
  mods?: any[];
  launcher?: string;
  // Recuadros de Noticias (Nuevo diseño)
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
  // Legacy fields (kept for backward compatibility but might be unused in new layout)
  eventCard?: { // Izquierda
    image?: string;
    title?: string;
    content?: string;
    date?: string;
    // Legacy fields
    eventName?: string;
    rewards?: string;
  };
  statsCard?: { // Centro
    image?: string;
    title?: string;
    content?: string;
    // Server specific fields
    playersOnline?: number;
    latency?: number;
    status?: string;
  };
  infoCard?: { // Derecha
    image?: string;
    title?: string;
    content?: string;
    // Info specific fields
    modsInstalled?: number;
    lastUpdate?: string;
  };
  modloader?: string;
  resolutionWidth?: number;
  resolutionHeight?: number;
  is_global?: boolean;
}

interface SavedAccount {
  username: string;
  type: "microsoft" | "offline";
  avatar?: string;
}

function App() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchProgress, setLaunchProgress] = useState<{ percent: number; stage: string; message: string } | null>(null);
  const [unlistenProgress, setUnlistenProgress] = useState<() => void | undefined>();
  const [launchingInstanceId, setLaunchingInstanceId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [lastLaunchDurationMs, setLastLaunchDurationMs] = useState<number | null>(null);
  const [playFlowInstanceId, setPlayFlowInstanceId] = useState<string | null>(null);
  const [isCheckingReady, setIsCheckingReady] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [currentView, setCurrentView] = useState<"home" | "profile" | "settings" | "admin-dashboard">("home");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showOfflineLogin, setShowOfflineLogin] = useState(false);
  const [showCreateInstance, setShowCreateInstance] = useState(false);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [userAvatar, setUserAvatar] = useState("");
  const [settingsInstance, setSettingsInstance] = useState<Instance | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  // Sistema de Toasts
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const showToast = (message: string, type: ToastType) => {
    setToast({ message, type });
  };

  // Efecto para verificar si el usuario logueado es admin en Supabase
  useEffect(() => {
    async function checkAdminStatus() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single();
        
        if (profile?.is_admin) {
          setIsAdmin(true);
          localStorage.setItem("drk_launcher_admin", "true");
        }
      }
    }
    if (isLoggedIn) {
      checkAdminStatus();
    }
  }, [isLoggedIn]);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDanger?: boolean;
    confirmText?: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });
  
  const [crashData, setCrashData] = useState<{
    isOpen: boolean;
    error: string;
    code: number;
  }>({
    isOpen: false,
    error: "",
    code: 0,
  });
  const gameLogs = useGameLogs();

  const [launcherVersion, setLauncherVersion] = useState("0.0.0");
  const launcherVersionRef = useRef("0.0.0");
  const [updateModal, setUpdateModal] = useState<{ isOpen: boolean; release: LauncherRelease | null }>({
    isOpen: false,
    release: null,
  });

  const dismissKey = "drk_launcher_update_dismissed";

  const showUpdateIfNeeded = (release: LauncherRelease, force = false) => {
    if (!release?.version) return;
    if (compareSemver(release.version, launcherVersionRef.current) <= 0) return;
    const notificationsEnabled = localStorage.getItem("drk_settings_notifications") !== "false";
    if (!force && !release.mandatory && !notificationsEnabled) return;
    const dismissed = localStorage.getItem(dismissKey) || "";
    if (!force && !release.mandatory && dismissed === release.version) return;
    setUpdateModal({ isOpen: true, release });
  };

  const checkForUpdates = async (force = false) => {
    try {
      const { data, error } = await supabase
        .from("launcher_releases")
        .select("version,title,notes,url,created_at,mandatory")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return;
      showUpdateIfNeeded(data as unknown as LauncherRelease, force);
    } catch {}
  };

  useEffect(() => {
    getVersion()
      .then((v) => {
        if (!v) return;
        setLauncherVersion(v);
        launcherVersionRef.current = v;
      })
      .catch(() => {});
    checkForUpdates(false);
    const channel = supabase
      .channel("launcher-releases-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "launcher_releases" },
        (payload: any) => {
          const next = payload?.new as LauncherRelease | undefined;
          if (next?.version) showUpdateIfNeeded(next, false);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    // Verificar sesión guardada
    const savedLogin = localStorage.getItem("drk_launcher_logged_in");
    const authType = localStorage.getItem("drk_launcher_auth_type");
    const savedUsername = localStorage.getItem("drk_launcher_username");
    const savedAvatar = localStorage.getItem("drk_launcher_avatar");
    const adminFlag = localStorage.getItem("drk_launcher_admin") === "true";
    
    if (savedLogin === "true") {
      if (authType === "microsoft") {
        localStorage.setItem("drk_launcher_logged_in", "false");
        return;
      }
      setIsLoggedIn(true);
      setIsOfflineMode(authType === "offline");
      setIsAdmin(adminFlag);
      if (savedUsername) {
        setUsername(savedUsername);
        const avatar = savedAvatar || "";
        setUserAvatar(avatar);
        // Restore offline session in Rust
        if (authType === "offline") {
          invoke("start_offline_login", { username: savedUsername, avatar }).catch(console.error);
        }
      }
      loadInstances();
    }
  }, []);

  

  // Bloquear menú contextual (click derecho) globalmente si no es admin
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (!isAdmin) {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [isAdmin]);

  async function loadInstances() {
    try {
      // 1. Cargar instancias globales de Supabase
      const { data: globalInstances, error } = await supabase
        .from('global_instances')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;

      // 2. Mapear al formato local
      const mappedInstances: Instance[] = (globalInstances || []).map(gi => ({
        id: gi.id,
        name: gi.name,
        version: gi.mc_version,
        lastPlayed: "Nunca",
        icon: gi.icon_url || "default",
        image: gi.icon_url || `https://api.dicebear.com/7.x/shapes/svg?seed=${gi.name}`,
        path: "", // Se gestionará localmente al descargar
        description: gi.description || undefined,
        images: gi.images || undefined,
        ram: gi.ram || undefined,
        serverIp: gi.server_ip || undefined,
        serverName: gi.server_name || undefined,
        modpackUrl: gi.modpack_url || undefined,
        modloader: gi.loader_type || "vanilla",
        resolutionWidth: gi.resolution_width || undefined,
        resolutionHeight: gi.resolution_height || undefined,
        is_global: true
      }));

      setInstances(mappedInstances);
    } catch (error) {
      console.error("Error loading instances from Supabase:", error);
      // Fallback a local si falla
      const saved = localStorage.getItem("drk_instances");
      if (saved) setInstances(JSON.parse(saved));
    }
  }

  useEffect(() => {
    // Escuchar cambios en tiempo real en las instancias
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'global_instances'
        },
        () => {
          loadInstances();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    loadInstances();
  }, [isLoggedIn]);

  function saveAccount(username: string, type: "microsoft" | "offline", avatar?: string) {
    const saved = localStorage.getItem("drk_saved_accounts");
    const accounts: SavedAccount[] = saved ? JSON.parse(saved) : [];
    
    // Evitar duplicados
    const filtered = accounts.filter(acc => acc.username !== username || acc.type !== type);
    filtered.push({ username, type, avatar });
    
    localStorage.setItem("drk_saved_accounts", JSON.stringify(filtered));
  }

  async function handleMicrosoftLogin() {
    setIsLoginLoading(true);
    try {
      await invoke("start_microsoft_login");
      
      // Poll for login success
      const interval = setInterval(async () => {
        try {
          const profile: any = await invoke("get_auth_profile");
          if (profile) {
            clearInterval(interval);
            setIsLoggedIn(true);
            setIsOfflineMode(false);
            setUsername(profile.name);
            const avatar = `https://mc-heads.net/skin/${profile.name}`;
            setUserAvatar(avatar);
            saveAccount(profile.name, "microsoft", avatar);
            localStorage.setItem("drk_launcher_logged_in", "false");
            localStorage.setItem("drk_launcher_username", profile.name);
            localStorage.setItem("drk_launcher_avatar", avatar);
            localStorage.setItem("drk_launcher_auth_type", "microsoft");
            loadInstances();
            setIsLoginLoading(false);
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 2000); // Check every 2s

    } catch (error) {
      console.error("Microsoft login failed:", error);
      setIsLoginLoading(false);
    }
  }

  async function handleLoginSuccess(username: string, _email: string, avatar: string, authType: "microsoft" | "offline") {
    setIsLoggedIn(true);
    setIsOfflineMode(authType === "offline");
    setShowOfflineLogin(false);
    setUsername(username);
    setUserAvatar(avatar);
    saveAccount(username, authType, avatar);
    
    // Sincronizar con el backend de Rust para el Gamertag
    if (authType === "offline") {
      try {
        await invoke("start_offline_login", { username, avatar });
      } catch (e) {
        console.error("Failed to sync offline login with Rust:", e);
      }
    }

    localStorage.setItem("drk_launcher_logged_in", "true");
    localStorage.setItem("drk_launcher_username", username);
    localStorage.setItem("drk_launcher_avatar", avatar);
    localStorage.setItem("drk_launcher_auth_type", authType);
    loadInstances();
  }

  async function handleQuickLogin(account: SavedAccount) {
    setIsLoginLoading(true);
    
    if (account.type === "microsoft") {
      setIsLoginLoading(false);
      handleMicrosoftLogin();
      return;
    }

    // Si es offline, necesitamos verificar que el usuario existe en Supabase antes de dejarlo entrar
    if (account.type === "offline") {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('username', account.username)
          .single();

        if (error || !profile) {
          alert("La cuenta ya no existe en la base de datos centralizada.");
          handleLogout();
          setIsLoginLoading(false);
          return;
        }
      } catch (e) {
        console.error("Quick login verify failed", e);
        setIsLoginLoading(false);
        return;
      }
    }

    setTimeout(() => {
      setIsLoggedIn(true);
      setIsOfflineMode(account.type === "offline");
      setUsername(account.username);
      setUserAvatar(account.avatar || "");
      localStorage.setItem("drk_launcher_logged_in", "true");
      localStorage.setItem("drk_launcher_username", account.username);
      if (account.avatar) localStorage.setItem("drk_launcher_avatar", account.avatar);
      localStorage.setItem("drk_launcher_auth_type", account.type);
      loadInstances();
      setIsLoginLoading(false);
    }, 500);
  }

  async function handleAdminLogin(password: string) {
    try {
      const isValid = await invoke<boolean>("check_admin_password", { password });
      if (isValid) {
        setIsAdmin(true);
        localStorage.setItem("drk_launcher_admin", "true");
        return true;
      } else {
        return false;
      }
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  function handleLogout() {
    setIsLoggedIn(false);
    setIsOfflineMode(false);
    setShowOfflineLogin(false);
    setSelectedInstance(null);
    setInstances([]);
    setUsername("");
    setUserAvatar("");
    localStorage.removeItem("drk_launcher_logged_in");
    localStorage.removeItem("drk_launcher_username");
    localStorage.removeItem("drk_launcher_avatar");
    localStorage.removeItem("drk_launcher_auth_type");
    localStorage.removeItem("drk_launcher_admin");
    supabase.auth.signOut();
  }

  async function launchInstance(instance: Instance) {
    if (launchingInstanceId && launchingInstanceId !== instance.id) {
      return;
    }
    const startTime = Date.now();
    setLastLaunchDurationMs(null);
    setIsLaunching(true);
    setLaunchingInstanceId(instance.id);
    gameLogs.open({ id: instance.id, name: instance.name }, 200);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const authData = {
        id: user?.id || "offline-id",
        name: username,
        access_token: isOfflineMode ? "offline" : "offline-token",
      };

      if (unlistenProgress) {
        try { (unlistenProgress as any)(); } catch {}
      }
      const unlisten = await listen("launch_progress", (event: any) => {
        const p = event.payload;
        if (!p || p.instanceId !== instance.id) return;
        setLaunchProgress({ percent: p.percent, stage: p.stage, message: p.message });
        if (p.stage === "iniciado") {
          setLastLaunchDurationMs(Date.now() - startTime);
          setLaunchProgress({ percent: 100, stage: "iniciado", message: "Jugando..." });
          
          // Auto-cierre desactivado permanentemente para asegurar persistencia de recursos
          console.log("Minecraft iniciado. Launcher permanecerá abierto.");
        }
        if (p.stage === "cerrado" || p.stage === "crasheado" || p.stage === "error") {
          setIsLaunching(false);
          setLaunchingInstanceId(null);
          setLaunchProgress(null);
          setPlayFlowInstanceId(null);
          if (unlistenProgress) {
            try { (unlistenProgress as any)(); } catch {}
          }
          if (p.message && p.stage !== "cerrado") {
            // Use a more friendly modal or just alert for now, but ensure newlines are preserved
            console.error("Game crash details:", p.message);
            // Parse code from message if possible (format: "El juego se cerró con error (Código: 1). Detalles: ...")
            let code = 1;
            const codeMatch = p.message.match(/Código: (-?\d+)/);
            if (codeMatch && codeMatch[1]) {
              code = parseInt(codeMatch[1], 10);
            }
            
            // Extract just the details part if it exists
            let details = p.message;
            if (p.message.includes("Detalles:\n")) {
              details = p.message.split("Detalles:\n")[1];
            }

            setCrashData({
              isOpen: true,
              error: details,
              code: code
            });
          }
        }
      });
      setUnlistenProgress(() => unlisten);
      // Verificar si los mods están instalados
      if (instance.mods && instance.mods.length > 0) {
        // Aquí se verificaría si los mods están instalados
        // Si no, se descargarían automáticamente
        console.log("Verificando mods...", instance.mods);
      }

      // Verificar launcher disponible
      if (instance.launcher) {
        console.log("Usando launcher:", instance.launcher);
      }

      // Lanzar instancia (todos juegan de la misma forma)
      await invoke("launch_instance", { 
        instanceId: instance.id, 
        auth: authData 
      });
      
      // Actualizar última vez jugado
      const timestamp = new Date().toISOString();
      const updatedInstance = { ...instance, lastPlayed: timestamp };
      setSelectedInstance(updatedInstance);
      const updatedInstances = instances.map(inst => 
        inst.id === instance.id ? updatedInstance : inst
      );
      setInstances(updatedInstances);
      
      // Guardar persistentemente (convertir a snake_case para Rust y evitar duplicados)
      try {
        const instanceForRust: any = {
          id: updatedInstance.id,
          name: updatedInstance.name,
          version: updatedInstance.version,
          last_played: timestamp,
          icon: updatedInstance.icon,
          path: updatedInstance.path,
          image: updatedInstance.image,
          images: updatedInstance.images,
          description: updatedInstance.description,
          ram: updatedInstance.ram,
          server_ip: updatedInstance.serverIp,
          server_name: updatedInstance.serverName,
          modpack_url: updatedInstance.modpackUrl,
          mods: updatedInstance.mods,
          launcher: updatedInstance.launcher,
          event_card: updatedInstance.eventCard ? {
            image: updatedInstance.eventCard.image,
            event_name: updatedInstance.eventCard.eventName,
            date: updatedInstance.eventCard.date,
            rewards: updatedInstance.eventCard.rewards,
          } : undefined,
          stats_card: updatedInstance.statsCard ? {
            image: updatedInstance.statsCard.image,
            players_online: updatedInstance.statsCard.playersOnline,
            latency: updatedInstance.statsCard.latency,
            status: updatedInstance.statsCard.status,
          } : undefined,
          info_card: updatedInstance.infoCard ? {
            image: updatedInstance.infoCard.image,
            mods_installed: updatedInstance.infoCard.modsInstalled,
            last_update: updatedInstance.infoCard.lastUpdate,
          } : undefined,
          modloader: updatedInstance.modloader,
          resolution_width: updatedInstance.resolutionWidth,
          resolution_height: updatedInstance.resolutionHeight,
        };
        await invoke("save_instance", { instance: instanceForRust });
        localStorage.setItem("drk_instances", JSON.stringify(updatedInstances));
      } catch (error) {
        console.error("Error saving instance:", error);
      }
    } catch (error) {
      console.error("Error launching instance:", error);
      alert(`Error al lanzar la instancia: ${error}`);
      setIsLaunching(false);
      setLaunchingInstanceId(null);
    } finally {}
  }

  async function handleOpenLogs(instance: Instance) {
    gameLogs.open({ id: instance.id, name: instance.name }, 400);
  }

  async function handleCreateInstance(instanceData: InstanceData) {
    const instanceId = Date.now().toString();
    const timestamp = new Date().toISOString();
      const newInstance: Instance = {
        id: instanceId,
        name: instanceData.name,
        version: instanceData.version,
        lastPlayed: timestamp,
        icon: "default",
        path: "", // Rust will set the correct path
        image: instanceData.images && instanceData.images.length > 0 ? instanceData.images[0] : undefined,
        images: instanceData.images,
        description: instanceData.description,
        ram: instanceData.ram,
        serverIp: instanceData.serverIp,
        serverName: instanceData.serverName,
        modpackUrl: instanceData.modpackUrl,
        mods: instanceData.mods,
        launcher: instanceData.launcher,
        modloader: instanceData.modloader,
        resolutionWidth: instanceData.resolutionWidth,
        resolutionHeight: instanceData.resolutionHeight,
        eventCard: instanceData.eventCard,
        statsCard: instanceData.statsCard,
        infoCard: instanceData.infoCard,
      };
    
    try {
      // Guardar en Rust backend (creará las carpetas automáticamente y actualizará el path)
      await invoke("save_instance", { instance: newInstance });
      
      // Recargar instancias desde el backend para obtener el path correcto
      const savedInstances = await invoke<any[]>("get_instances");
      const instancesWithImages = savedInstances.map((instance: any) => ({
        id: instance.id,
        name: instance.name,
        version: instance.version,
        lastPlayed: instance.last_played || instance.lastPlayed || new Date().toISOString(),
        icon: instance.icon || "default",
        path: instance.path || "",
        image: instance.image || (instance.images && instance.images.length > 0 ? instance.images[0] : undefined) || `https://api.dicebear.com/7.x/shapes/svg?seed=${instance.name}`,
        images: instance.images,
        description: instance.description,
        ram: instance.ram,
        serverIp: instance.server_ip || instance.serverIp,
        serverName: instance.server_name || instance.serverName,
        modpackUrl: instance.modpack_url || instance.modpackUrl,
        mods: instance.mods,
        launcher: instance.launcher,
        modloader: instance.modloader,
        eventCard: instance.event_card ? {
          image: instance.event_card.image,
          eventName: instance.event_card.event_name || instance.event_card.eventName,
          date: instance.event_card.date,
          rewards: instance.event_card.rewards,
        } : instance.eventCard,
        statsCard: instance.stats_card ? {
          image: instance.stats_card.image,
          playersOnline: instance.stats_card.players_online || instance.stats_card.playersOnline,
          latency: instance.stats_card.latency,
          status: instance.stats_card.status,
        } : instance.statsCard,
        infoCard: instance.info_card ? {
          image: instance.info_card.image,
          modsInstalled: instance.info_card.mods_installed || instance.info_card.modsInstalled,
          lastUpdate: instance.info_card.last_update || instance.info_card.lastUpdate,
        } : instance.infoCard,
        resolutionWidth: instance.resolution_width || instance.resolutionWidth,
        resolutionHeight: instance.resolution_height || instance.resolutionHeight,
      }));
      
      setInstances(instancesWithImages);
      
      // Encontrar la instancia recién creada
      const createdInstance = instancesWithImages.find(inst => inst.id === instanceId);
      if (createdInstance) {
        setSelectedInstance(createdInstance);
      }
      
      // Guardar también en localStorage como backup
      try {
        localStorage.setItem("drk_instances", JSON.stringify(instancesWithImages));
      } catch (e) {
        console.warn("Could not save to localStorage (Quota Exceeded?):", e);
      }
      
      setShowCreateInstance(false);
      
      console.log("Instancia creada exitosamente:", createdInstance);
    } catch (error) {
      console.error("Error creating instance:", error);
      alert(`Error al crear la instancia: ${error}. Por favor intenta de nuevo.`);
    }
  }

  function handleSettings(instance: Instance) {
    setSettingsInstance(instance);
  }

  async function handleSaveSettings(updatedInstance: Instance) {
    const updatedInstances = instances.map((inst) =>
      inst.id === updatedInstance.id ? updatedInstance : inst
    );
    setInstances(updatedInstances);
    if (selectedInstance?.id === updatedInstance.id) {
      setSelectedInstance(updatedInstance);
    }
    
    try {
      await ensureInstanceSaved(updatedInstance);
      localStorage.setItem("drk_instances", JSON.stringify(updatedInstances));
      setSettingsInstance(null);
      showToast("Ajustes guardados correctamente", "success");
    } catch (error) {
      console.error("Error saving settings:", error);
      showToast("Error al guardar los ajustes", "error");
    }
  }

  async function ensureInstanceSaved(instance: Instance) {
    try {
      const instanceForRust: any = {
        id: instance.id,
        name: instance.name,
        version: instance.version,
        last_played: instance.lastPlayed || new Date().toISOString(),
        icon: instance.icon,
        path: instance.path || "",
        image: instance.image,
        images: instance.images,
        description: instance.description,
        ram: instance.ram,
        server_ip: instance.serverIp,
        server_name: instance.serverName,
        modpack_url: instance.modpackUrl,
        mods: instance.mods,
        launcher: instance.launcher || "official",
        modloader: instance.modloader || "vanilla",
        resolution_width: instance.resolutionWidth || 854,
        resolution_height: instance.resolutionHeight || 480,
        event_card: instance.eventCard ? {
          image: instance.eventCard.image,
          event_name: instance.eventCard.eventName,
          date: instance.eventCard.date,
          rewards: instance.eventCard.rewards,
        } : undefined,
        stats_card: instance.statsCard ? {
          image: instance.statsCard.image,
          players_online: instance.statsCard.playersOnline,
          latency: instance.statsCard.latency,
          status: instance.statsCard.status,
        } : undefined,
        info_card: instance.infoCard ? {
          image: instance.infoCard.image,
          mods_installed: instance.infoCard.modsInstalled,
          last_update: instance.infoCard.lastUpdate,
        } : undefined,
      };
      await invoke("save_instance", { instance: instanceForRust });
      return true;
    } catch (e) {
      console.error("Error ensuring instance saved in Rust:", e);
      return false;
    }
  }

  async function handleDownloadInstance(instance: Instance, isPlayFlow = false, mode: "prepare" | "repair" = "prepare") {
    try {
      if (launchingInstanceId && launchingInstanceId !== instance.id) {
        return false;
      }
      setIsDownloading(true);
      setLaunchingInstanceId(instance.id);
      
      // Asegurarse de que la instancia esté guardada localmente en Rust antes de descargar
      await ensureInstanceSaved(instance);

      if (unlistenProgress) {
        try { (unlistenProgress as any)(); } catch {}
      }
      return await new Promise<boolean>(async (resolve) => {
        let finished = false;
        const finalize = (ok: boolean) => {
          if (finished) {
            return;
          }
          finished = true;
          setIsDownloading(false);
          setLaunchingInstanceId(null);
          setLaunchProgress(null);
          setUnlistenProgress(undefined);
          resolve(ok);
        };
        const unlisten = await listen("launch_progress", (event: any) => {
          const p = event.payload;
          if (!p || p.instanceId !== instance.id) return;
          setLaunchProgress({ percent: p.percent, stage: p.stage, message: p.message });
          if (p.stage === "descarga_completa") {
            try { (unlisten as any)(); } catch {}
            finalize(true);
          }
          if (p.stage === "error") {
            try { (unlisten as any)(); } catch {}
            if (p.message) {
              showToast(p.message, "error");
            }
            if (isPlayFlow) {
              setPlayFlowInstanceId(null);
            }
            finalize(false);
          }
        });
        setUnlistenProgress(() => unlisten);
        try {
          if (mode === "repair") {
            await invoke("repair_instance", { instanceId: instance.id });
          } else {
            await invoke("prepare_instance", { instanceId: instance.id });
          }
        } catch (error) {
          console.error("Error downloading instance:", error);
          showToast(mode === "repair" ? "Error al reparar la instancia" : "Error al preparar la descarga", "error");
          try { (unlisten as any)(); } catch {}
          if (isPlayFlow) {
            setPlayFlowInstanceId(null);
          }
          finalize(false);
        }
      });
    } catch (error) {
      console.error("Error downloading instance:", error);
      showToast("Error al descargar la instancia", "error");
      setIsDownloading(false);
      setLaunchingInstanceId(null);
      return false;
    }
  }

  async function handleExecuteInstance(instance: Instance) {
    if (isLaunching || isCheckingReady || isDownloading) return;
    
    setPlayFlowInstanceId(instance.id);
    setIsCheckingReady(true);
    
    try {
      // 1. Asegurarse de que la instancia esté registrada en el backend
      await ensureInstanceSaved(instance);

      // 2. Verificar si está lista
      let isReady = false;
      try {
          isReady = await invoke<boolean>("check_instance_ready", { instanceId: instance.id });
      } catch (e) {
          console.error("Failed to check instance ready state", e);
      }

      if (!isReady) {
          const prepared = await handleDownloadInstance(instance, true);
          if (prepared === false) {
            setPlayFlowInstanceId(null);
            setIsCheckingReady(false);
            return;
          }
      }
      
      await launchInstance(instance);
    } catch (e) {
      console.error("Error executing instance:", e);
      setPlayFlowInstanceId(null);
    } finally {
      setIsCheckingReady(false);
    }
  }

  async function handleDeleteInstance(instanceId: string) {
    setConfirmModal({
      isOpen: true,
      title: "Eliminar Instancia",
      message: "¿Estás seguro de que quieres eliminar esta instancia? Esta acción no se puede deshacer y se perderán todos los datos asociados.",
      isDanger: true,
      confirmText: "Eliminar",
      onConfirm: async () => {
        try {
          // Si es una instancia global (tiene ID de Supabase), eliminar de la base de datos
          if (instanceId.includes("-")) { // Los UUID de Supabase suelen tener guiones
            const { error } = await supabase
              .from('global_instances')
              .delete()
              .eq('id', instanceId);
            
            if (error) throw error;
            showToast("Instancia eliminada de la nube", "info");
          }

          await invoke("delete_instance", { instanceId });
          setInstances(prev => prev.filter(i => i.id !== instanceId));
          if (selectedInstance?.id === instanceId) {
            setSelectedInstance(null);
          }
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          showToast("Instancia eliminada localmente", "success");
        } catch (error: any) {
          console.error("Error deleting instance:", error);
          showToast("Error al eliminar: " + error.message, "error");
        }
      }
    });
  }

  const handleUpdateUser = (newUsername: string, newAvatar: string) => {
    setUsername(newUsername);
    setUserAvatar(newAvatar);
    localStorage.setItem("drk_launcher_username", newUsername);
    localStorage.setItem("drk_launcher_avatar", newAvatar);
    
    // Si estamos en modo offline, sincronizar con Rust
    if (isOfflineMode) {
      invoke("start_offline_login", { username: newUsername, avatar: newAvatar }).catch(console.error);
    }
  };

  return (
    <div className="app-container">
      {/* Sistema Global de Toasts */}
      {toast && (
        <div className="drk-toast-container">
          <Toast 
            message={toast.message} 
            type={toast.type} 
            onClose={() => setToast(null)} 
          />
        </div>
      )}

      {!isLoggedIn ? (
        showOfflineLogin ? (
          <OfflineLogin 
            onBack={() => setShowOfflineLogin(false)} 
            onLogin={handleLoginSuccess}
            isLoading={isLoginLoading}
            showToast={showToast}
          />
        ) : (
          <Login 
            onMicrosoftLogin={handleMicrosoftLogin} 
            onOfflineLogin={() => setShowOfflineLogin(true)}
            onQuickLogin={handleQuickLogin}
            isLoading={isLoginLoading}
            showToast={showToast}
          />
        )
      ) : (
        <>
          <div className="app-background">
            <div className="app-stars"></div>
            <div className="app-nebula"></div>
          </div>
          <div className="app-main-layout" style={{ display: 'flex', width: '100%', height: '100%', position: 'relative', zIndex: 1 }}>
            <Sidebar
              instances={instances}
              selectedInstance={selectedInstance}
              onSelectInstance={(instance) => {
                setSelectedInstance(instance);
                setCurrentView("home");
              }}
              onCreateInstance={() => setShowCreateInstance(true)}
              onHome={() => setCurrentView("home")}
              userAvatar={userAvatar}
              username={username}
              isAdmin={isAdmin}
              onDeleteInstance={handleDeleteInstance}
              onOpenAdminLogin={() => {
                if (isAdmin) {
                  setCurrentView("admin-dashboard");
                } else {
                  setShowAdminLogin(true);
                }
              }}
              onProfile={() => setCurrentView("profile")}
              onGlobalSettings={() => setCurrentView("settings")}
              onLogout={handleLogout}
              isOfflineMode={isOfflineMode}
            />
            <div className="view-container">
              {currentView === "home" && (
                <Home
                  selectedInstance={selectedInstance}
                  isLaunching={isLaunching}
                  launchProgress={launchProgress}
                  isDownloading={isDownloading}
                  launchingInstanceId={launchingInstanceId}
                  launchDurationMs={lastLaunchDurationMs}
                  playFlowInstanceId={playFlowInstanceId}
                  isCheckingReady={isCheckingReady}
                  onSettings={handleSettings}
                  instances={instances}
                  onDownloadInstance={handleDownloadInstance}
                  onRepairInstance={(instance) => handleDownloadInstance(instance, false, "repair")}
                  onExecuteInstance={handleExecuteInstance}
                  onOpenLogs={handleOpenLogs}
                  onHome={() => setSelectedInstance(null)}
                  showToast={showToast}
                />
              )}
              {currentView === "profile" && (
                <Profile 
                  showToast={showToast} 
                  onUpdateUser={handleUpdateUser} 
                />
              )}
              {currentView === "settings" && (
                <Settings
                  showToast={showToast}
                  launcherVersion={`v${launcherVersion}`}
                  onCheckUpdates={() => checkForUpdates(true)}
                />
              )}
              {currentView === "admin-dashboard" && (
                <AdminDashboard 
                  onBack={() => setCurrentView("home")} 
                  showToast={showToast} 
                />
              )}
            </div>
          </div>
          {showCreateInstance && (
            <CreateInstance 
              onClose={() => setShowCreateInstance(false)} 
              onSave={handleCreateInstance}
              onCreated={loadInstances}
              showToast={showToast}
            />
          )}
      {showAdminLogin && (
        <AdminLogin
          onClose={() => setShowAdminLogin(false)}
          onLogin={handleAdminLogin}
        />
      )}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        isDanger={confirmModal.isDanger}
        confirmText={confirmModal.confirmText}
      />
      <CrashModal
        isOpen={crashData.isOpen}
        onClose={() => setCrashData(prev => ({ ...prev, isOpen: false }))}
        error={crashData.error}
        code={crashData.code}
      />
      <LogViewer
        isOpen={gameLogs.isOpen}
        instanceName={gameLogs.instanceName}
        stdoutText={gameLogs.stdoutText}
        stderrText={gameLogs.stderrText}
        onClose={gameLogs.close}
        onClear={gameLogs.clearAndTruncateFiles}
      />
      <UpdateModal
        isOpen={updateModal.isOpen}
        currentVersion={launcherVersion}
        release={updateModal.release}
        onClose={() => setUpdateModal({ isOpen: false, release: null })}
        onSkip={() => {
          if (updateModal.release?.version) {
            localStorage.setItem(dismissKey, updateModal.release.version);
          }
          setUpdateModal({ isOpen: false, release: null });
        }}
      />
      {settingsInstance && (
        <InstanceSettings
          instance={settingsInstance}
          isAdmin={isAdmin}
          onClose={() => setSettingsInstance(null)}
          onSave={handleSaveSettings}
          onOpenInstanceFolder={(instanceId, kind) =>
            invoke("open_instance_folder", { instanceId, kind }).catch((e) => {
              const msg = typeof e === "string" ? e : "No se pudo abrir la carpeta";
              showToast(msg, "error");
            })
          }
          onDelete={handleDeleteInstance}
        />
      )}

        </>
      )}
    </div>
  );
}

export default App;
