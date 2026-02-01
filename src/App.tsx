import { useState, useEffect } from "react";
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
}

interface SavedAccount {
  username: string;
  type: "microsoft" | "offline";
  avatar?: string;
}

interface InstanceSettingsDraft {
  name: string;
  description?: string;
  version: string;
  ram?: number;
  serverIp?: string;
  serverName?: string;
  modpackUrl?: string;
  modloader?: string;
  launcher?: string;
  image?: string;
  resolutionWidth?: number;
  resolutionHeight?: number;
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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showOfflineLogin, setShowOfflineLogin] = useState(false);
  const [showCreateInstance, setShowCreateInstance] = useState(false);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [userAvatar, setUserAvatar] = useState("");
  const [settingsInstance, setSettingsInstance] = useState<Instance | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<InstanceSettingsDraft | null>(null);
  const [advancedInstance, setAdvancedInstance] = useState<Instance | null>(null);
  const [advancedDraft, setAdvancedDraft] = useState<InstanceSettingsDraft | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
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

  useEffect(() => {
    // Verificar sesión guardada
    const savedLogin = localStorage.getItem("drk_launcher_logged_in");
    const authType = localStorage.getItem("drk_launcher_auth_type");
    const savedUsername = localStorage.getItem("drk_launcher_username");
    const savedAvatar = localStorage.getItem("drk_launcher_avatar");
    const adminFlag = localStorage.getItem("drk_launcher_admin") === "true";
    
    if (savedLogin === "true") {
      setIsLoggedIn(true);
      setIsOfflineMode(authType === "offline");
      setIsAdmin(adminFlag);
      if (savedUsername) {
        setUsername(savedUsername);
        // Restore offline session in Rust
        if (authType === "offline") {
          invoke("start_offline_login", { username: savedUsername }).catch(console.error);
        }
      }
      if (savedAvatar) setUserAvatar(savedAvatar);
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

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== "a") {
        return;
      }
      if (localStorage.getItem("drk_launcher_admin") !== "true") {
        return;
      }
      const targetInstance = settingsInstance || selectedInstance;
      if (!targetInstance) {
        return;
      }
      setAdvancedInstance(targetInstance);
      setAdvancedDraft({
        name: targetInstance.name,
        description: targetInstance.description,
        version: targetInstance.version,
        ram: targetInstance.ram,
        serverIp: targetInstance.serverIp,
        serverName: targetInstance.serverName,
        modpackUrl: targetInstance.modpackUrl,
        modloader: targetInstance.modloader,
        launcher: targetInstance.launcher,
        image: targetInstance.image,
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedInstance, settingsInstance]);

  async function loadInstances() {
    try {
      const instancesData = await invoke<any[]>("get_instances");
      // Mapear campos de snake_case a camelCase
      const instancesWithImages = instancesData.map((instance: any) => ({
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
        newsLeft: instance.news_left || instance.newsLeft,
        newsCenter: instance.news_center || instance.newsCenter,
        newsRight: instance.news_right || instance.newsRight,
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
        modloader: instance.modloader,
        resolutionWidth: instance.resolution_width || instance.resolutionWidth,
        resolutionHeight: instance.resolution_height || instance.resolutionHeight,
      }));
      setInstances(instancesWithImages);
      
      // NO seleccionar automáticamente - mostrar pantalla de bienvenida
    } catch (error) {
      console.error("Error loading instances:", error);
      // Cargar desde localStorage como fallback
      const saved = localStorage.getItem("drk_instances");
      if (saved) {
        try {
          const savedInstances = JSON.parse(saved);
          setInstances(savedInstances);
          // NO seleccionar automáticamente
        } catch (e) {
          console.error("Error parsing saved instances:", e);
        }
      }
    }
  }

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
            const avatar = `https://mc-heads.net/body/${profile.id}`;
            setUserAvatar(avatar);
            saveAccount(profile.name, "microsoft", avatar);
            localStorage.setItem("drk_launcher_logged_in", "true");
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

  async function handleOfflineLogin(username: string, email: string, password: string, isLogin: boolean) {
    setIsLoginLoading(true);

    try {
      await invoke("start_offline_login", { username });
      
      if (isLogin) {
        // Login
        if (username.trim() && password.trim()) {
          const avatar = `https://api.mineskin.org/render/body/${username}`;
          setIsLoggedIn(true);
          setIsOfflineMode(true);
          setShowOfflineLogin(false);
          setUsername(username);
          setUserAvatar(avatar);
          saveAccount(username, "offline", avatar);
          localStorage.setItem("drk_launcher_logged_in", "true");
          localStorage.setItem("drk_launcher_username", username);
          localStorage.setItem("drk_launcher_avatar", avatar);
          localStorage.setItem("drk_launcher_auth_type", "offline");
          loadInstances();
        } else {
          alert("Por favor ingresa usuario y contraseña");
        }
      } else {
        // Register
        if (username.trim() && email.trim() && password.trim()) {
          const avatar = `https://api.mineskin.org/render/body/${username}`;
          setIsLoggedIn(true);
          setIsOfflineMode(true);
          setShowOfflineLogin(false);
          setUsername(username);
          setUserAvatar(avatar);
          saveAccount(username, "offline", avatar);
          localStorage.setItem("drk_launcher_logged_in", "true");
          localStorage.setItem("drk_launcher_username", username);
          localStorage.setItem("drk_launcher_avatar", avatar);
          localStorage.setItem("drk_launcher_auth_type", "offline");
          loadInstances();
        } else {
          alert("Por favor completa todos los campos");
        }
      }
    } catch (e) {
      console.error("Offline login failed", e);
    }

    setIsLoginLoading(false);
  }

  async function handleQuickLogin(account: SavedAccount) {
    setIsLoginLoading(true);
    
    if (account.type === "offline") {
      try {
        await invoke("start_offline_login", { username: account.username });
      } catch (e) {
        console.error("Quick login failed", e);
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
  }

  async function launchInstance(instance: Instance) {
    if (launchingInstanceId && launchingInstanceId !== instance.id) {
      return;
    }
    const startTime = Date.now();
    setLastLaunchDurationMs(null);
    setIsLaunching(true);
    setLaunchingInstanceId(instance.id);
    try {
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
      await invoke("launch_instance", { instanceId: instance.id });
      
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
    setSettingsDraft({
      name: instance.name,
      description: instance.description,
      version: instance.version,
      ram: instance.ram,
      serverIp: instance.serverIp,
      serverName: instance.serverName,
      modpackUrl: instance.modpackUrl,
      modloader: instance.modloader,
      launcher: instance.launcher,
      image: instance.image,
      resolutionWidth: instance.resolutionWidth || 854,
      resolutionHeight: instance.resolutionHeight || 480,
    });
  }

  async function handleDownloadInstance(instance: Instance, isPlayFlow = false) {
    try {
      if (launchingInstanceId && launchingInstanceId !== instance.id) {
        return false;
      }
      setIsDownloading(true);
      setLaunchingInstanceId(instance.id);
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
              alert(p.message);
            }
            if (isPlayFlow) {
              setPlayFlowInstanceId(null);
            }
            finalize(false);
          }
        });
        setUnlistenProgress(() => unlisten);
        try {
          await invoke("prepare_instance", { instanceId: instance.id });
        } catch (error) {
          console.error("Error downloading instance:", error);
          alert("Error al descargar la instancia");
          try { (unlisten as any)(); } catch {}
          if (isPlayFlow) {
            setPlayFlowInstanceId(null);
          }
          finalize(false);
        }
      });
    } catch (error) {
      console.error("Error downloading instance:", error);
      alert("Error al descargar la instancia");
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
      // Check if instance is ready to skip download/verify flow if possible
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
          await invoke("delete_instance", { instanceId });
          setInstances(prev => prev.filter(i => i.id !== instanceId));
          if (selectedInstance?.id === instanceId) {
            setSelectedInstance(null);
          }
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          console.error("Error deleting instance:", error);
          alert("Error al eliminar la instancia");
        }
      }
    });
  }

  // Mostrar pantalla de login offline
  if (showOfflineLogin) {
    return (
      <OfflineLogin
        onBack={() => setShowOfflineLogin(false)}
        onLogin={handleOfflineLogin}
        isLoading={isLoginLoading}
      />
    );
  }

  // Mostrar pantalla de login principal
  if (!isLoggedIn) {
    return (
      <>
        <Login
          onMicrosoftLogin={handleMicrosoftLogin}
          onOfflineLogin={() => setShowOfflineLogin(true)}
          onQuickLogin={handleQuickLogin}
          isLoading={isLoginLoading}
        />
      </>
    );
  }

  // Mostrar pantalla principal con sidebar y home
  return (
    <div className="app-container">
      <div className="app-background">
        <div className="app-stars"></div>
        <div className="app-nebula app-nebula-1"></div>
        <div className="app-nebula app-nebula-2"></div>
        <div className="app-nebula app-nebula-3"></div>
      </div>
      <Sidebar
        instances={instances}
        selectedInstance={selectedInstance}
        onSelectInstance={setSelectedInstance}
        onCreateInstance={() => setShowCreateInstance(true)}
        isOfflineMode={isOfflineMode}
        onLogout={handleLogout}
        userAvatar={userAvatar}
        username={username}
        isAdmin={isAdmin}
        onDeleteInstance={handleDeleteInstance}
        onOpenAdminLogin={() => setShowAdminLogin(true)}
      />
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
        onExecuteInstance={handleExecuteInstance}
        onHome={() => setSelectedInstance(null)}
      />
      {showCreateInstance && (
        <CreateInstance
          onClose={() => setShowCreateInstance(false)}
          onSave={handleCreateInstance}
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
      {settingsInstance && settingsDraft && (
        <div className="instance-settings-overlay" onClick={() => setSettingsInstance(null)}>
          <div className="instance-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="instance-settings-header">
              <h3 className="instance-settings-title">Ajustes de {settingsInstance.name}</h3>
              <button className="instance-settings-close" onClick={() => setSettingsInstance(null)}>×</button>
            </div>
            <div className="instance-settings-content">
              {launchProgress && launchingInstanceId === settingsInstance.id && (launchProgress.stage === "error" || launchProgress.stage === "crasheado") && (
                <div style={{ marginBottom: 10, padding: 10, background: "#2b2f3a", border: "1px solid #444", borderRadius: 6, color: "#e5e7eb" }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {launchProgress.stage === "error" ? "Error de arranque" : "El juego se cerró con error"}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{launchProgress.message}</div>
                </div>
              )}
              <div className="instance-settings-grid">
                <div className="instance-settings-readonly">
                  <span>Nombre</span>
                  <strong>{settingsInstance.name}</strong>
                </div>
                <div className="instance-settings-readonly">
                  <span>Versión</span>
                  <strong>{settingsInstance.version}</strong>
                </div>
                <div className="instance-settings-field">
                  <label>RAM (MB)</label>
                  <input
                    type="number"
                    value={settingsDraft.ram || 0}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, ram: Number(e.target.value) })}
                  />
                </div>
                <div className="instance-settings-field">
                  <label>Resolución</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="number"
                      placeholder="Ancho"
                      value={settingsDraft.resolutionWidth || 854}
                      onChange={(e) => setSettingsDraft({ ...settingsDraft, resolutionWidth: Number(e.target.value) })}
                      style={{ width: '50%' }}
                    />
                    <input
                      type="number"
                      placeholder="Alto"
                      value={settingsDraft.resolutionHeight || 480}
                      onChange={(e) => setSettingsDraft({ ...settingsDraft, resolutionHeight: Number(e.target.value) })}
                      style={{ width: '50%' }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="instance-settings-actions">
              <button
                className="instance-settings-cancel"
                onClick={() => {
                  const path = settingsInstance.path;
                  invoke("open_folder", { path }).catch(() => alert("No se pudo abrir la carpeta de la instancia"));
                }}
              >
                Ver Instancia
              </button>
              <button
                className="instance-settings-cancel"
                onClick={() => {
                  const path = settingsInstance.path + "\\logs";
                  invoke("open_folder", { path }).catch(() => alert("No se pudo abrir la carpeta de logs"));
                }}
              >
                Ver Logs
              </button>
              <button
                className="instance-settings-cancel"
                onClick={() => setSettingsInstance(null)}
              >
                Cancelar
              </button>
              <button
                className="instance-settings-save"
                onClick={async () => {
                  const updatedInstance: Instance = {
                    ...settingsInstance,
                    ram: settingsDraft.ram,
                    resolutionWidth: settingsDraft.resolutionWidth,
                    resolutionHeight: settingsDraft.resolutionHeight,
                  };
                  const updatedInstances = instances.map((inst) =>
                    inst.id === updatedInstance.id ? updatedInstance : inst
                  );
                  setInstances(updatedInstances);
                  if (selectedInstance?.id === updatedInstance.id) {
                    setSelectedInstance(updatedInstance);
                  }
                  try {
                    const instanceForRust: any = {
                      id: updatedInstance.id,
                      name: updatedInstance.name,
                      version: updatedInstance.version,
                      last_played: updatedInstance.lastPlayed,
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
                      resolution_width: updatedInstance.resolutionWidth,
                      resolution_height: updatedInstance.resolutionHeight,
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
                    };
                    await invoke("save_instance", { instance: instanceForRust });
                    localStorage.setItem("drk_instances", JSON.stringify(updatedInstances));
                  } catch (error) {
                    console.error("Error saving settings:", error);
                    alert("No se pudieron guardar los ajustes");
                  }
                  setSettingsInstance(null);
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
      {advancedInstance && advancedDraft && (
        <div className="admin-settings-overlay" onClick={() => setAdvancedInstance(null)}>
          <div className="admin-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-settings-header">
              <h3 className="admin-settings-title">Panel avanzado · {advancedInstance.name}</h3>
              <button className="admin-settings-close" onClick={() => setAdvancedInstance(null)}>×</button>
            </div>
            <div className="admin-settings-content">
              <div className="admin-settings-grid">
                <div className="admin-settings-field">
                  <label>Nombre</label>
                  <input
                    value={advancedDraft.name}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, name: e.target.value })}
                  />
                </div>
                <div className="admin-settings-field">
                  <label>Versión</label>
                  <input
                    value={advancedDraft.version}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, version: e.target.value })}
                  />
                </div>
                <div className="admin-settings-field">
                  <label>RAM (MB)</label>
                  <input
                    type="number"
                    value={advancedDraft.ram || 0}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, ram: Number(e.target.value) })}
                  />
                </div>
                <div className="admin-settings-field">
                  <label>IP del servidor</label>
                  <input
                    value={advancedDraft.serverIp || ""}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, serverIp: e.target.value })}
                  />
                </div>
                <div className="admin-settings-field">
                  <label>Nombre del servidor</label>
                  <input
                    value={advancedDraft.serverName || ""}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, serverName: e.target.value })}
                  />
                </div>
                <div className="admin-settings-field">
                  <label>Modpack URL</label>
                  <input
                    value={advancedDraft.modpackUrl || ""}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, modpackUrl: e.target.value })}
                  />
                </div>
                <div className="admin-settings-field">
                  <label>Modloader</label>
                  <select
                    value={advancedDraft.modloader || "vanilla"}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, modloader: e.target.value })}
                  >
                    <option value="vanilla">Vanilla</option>
                    <option value="fabric">Fabric</option>
                    <option value="forge">Forge</option>
                  </select>
                </div>
                <div className="admin-settings-field">
                  <label>Launcher</label>
                  <input
                    value={advancedDraft.launcher || ""}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, launcher: e.target.value })}
                  />
                </div>
                <div className="admin-settings-field">
                  <label>Imagen principal</label>
                  <input
                    value={advancedDraft.image || ""}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, image: e.target.value })}
                  />
                </div>
                <div className="admin-settings-field admin-settings-field-full">
                  <label>Descripción</label>
                  <textarea
                    value={advancedDraft.description || ""}
                    onChange={(e) => setAdvancedDraft({ ...advancedDraft, description: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="admin-settings-actions">
              <button
                className="admin-settings-cancel"
                onClick={() => setAdvancedInstance(null)}
              >
                Cancelar
              </button>
              <button
                className="admin-settings-save"
                onClick={async () => {
                  const updatedInstance: Instance = {
                    ...advancedInstance,
                    name: advancedDraft.name,
                    description: advancedDraft.description,
                    version: advancedDraft.version,
                    ram: advancedDraft.ram,
                    serverIp: advancedDraft.serverIp,
                    serverName: advancedDraft.serverName,
                    modpackUrl: advancedDraft.modpackUrl,
                    modloader: advancedDraft.modloader,
                    launcher: advancedDraft.launcher,
                    image: advancedDraft.image,
                  };
                  const updatedInstances = instances.map((inst) =>
                    inst.id === updatedInstance.id ? updatedInstance : inst
                  );
                  setInstances(updatedInstances);
                  if (selectedInstance?.id === updatedInstance.id) {
                    setSelectedInstance(updatedInstance);
                  }
                  try {
                    const instanceForRust: any = {
                      id: updatedInstance.id,
                      name: updatedInstance.name,
                      version: updatedInstance.version,
                      last_played: updatedInstance.lastPlayed,
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
                    };
                    await invoke("save_instance", { instance: instanceForRust });
                    localStorage.setItem("drk_instances", JSON.stringify(updatedInstances));
                  } catch (error) {
                    console.error("Error saving settings:", error);
                    alert("No se pudieron guardar los ajustes");
                  }
                  setAdvancedInstance(null);
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
