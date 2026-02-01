// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

mod auth;
mod minecraft;
use auth::{AppState, AuthState};
use tauri::State;
use tauri::Emitter;
use sha1::{Sha1, Digest};

#[derive(Serialize, Deserialize, Clone)]
pub struct EventCard {
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub event_name: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub rewards: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StatsCard {
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub players_online: Option<u32>,
    #[serde(default)]
    pub latency: Option<u32>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct InfoCard {
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub mods_installed: Option<u32>,
    #[serde(default)]
    pub last_update: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(rename = "lastPlayed", alias = "last_played", default = "get_current_timestamp")]
    pub last_played: String,
    pub icon: String,
    pub path: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub images: Option<Vec<String>>,
    #[serde(default)]
    pub ram: Option<u64>,
    #[serde(rename = "serverIp", alias = "server_ip", default)]
    pub server_ip: Option<String>,
    #[serde(rename = "serverName", alias = "server_name", default)]
    pub server_name: Option<String>,
    #[serde(rename = "modpackUrl", alias = "modpack_url", default)]
    pub modpack_url: Option<String>,
    #[serde(default)]
    pub launcher: Option<String>,
    #[serde(default)]
    pub mods: Option<Vec<String>>,
    #[serde(rename = "eventCard", alias = "event_card", default)]
    pub event_card: Option<EventCard>,
    #[serde(rename = "statsCard", alias = "stats_card", default)]
    pub stats_card: Option<StatsCard>,
    #[serde(rename = "infoCard", alias = "info_card", default)]
    pub info_card: Option<InfoCard>,
    #[serde(default)]
    pub modloader: Option<String>,
    #[serde(default)]
    pub resolution_width: Option<u32>,
    #[serde(default)]
    pub resolution_height: Option<u32>,
}

const INSTANCES_FILE: &str = "instances.json";
const ADMIN_FILE: &str = "admin.json";
const INSTANCES_DIR: &str = "Eventos DRK";
const INSTANCES_SUBDIR: &str = "instancias";

fn get_instances_path() -> String {
    Path::new(&get_instances_dir()).join(INSTANCES_FILE).to_string_lossy().to_string()
}

fn get_admin_path() -> String {
    Path::new(&get_instances_dir()).join(ADMIN_FILE).to_string_lossy().to_string()
}

fn get_instances_dir() -> String {
    get_appdata_dir().join(INSTANCES_DIR).to_string_lossy().to_string()
}

fn get_instances_subdir() -> String {
    Path::new(&get_instances_dir()).join(INSTANCES_SUBDIR).to_string_lossy().to_string()
}

fn get_appdata_dir() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| "".to_string());
        std::path::PathBuf::from(appdata)
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "".to_string());
        std::path::PathBuf::from(home).join(".local").join("share")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "".to_string());
        std::path::PathBuf::from(home).join("Library").join("Application Support")
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        std::env::current_dir().unwrap()
    }
}

fn load_instances() -> Vec<Instance> {
    let path = get_instances_path();
    if Path::new(&path).exists() {
        match fs::read_to_string(&path) {
            Ok(content) => {
                match serde_json::from_str::<Vec<Instance>>(&content) {
                    Ok(instances) => instances,
                    Err(_) => Vec::new(),
                }
            }
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    }
}

fn save_instances(instances: &Vec<Instance>) {
    let path = get_instances_path();
    if let Ok(json) = serde_json::to_string_pretty(instances) {
        let _ = fs::write(&path, json);
    }
}

fn get_current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string()
}

#[tauri::command]
fn get_system_ram() -> Result<u64, String> {
    use sysinfo::{System, SystemExt};
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_bytes = sys.total_memory(); // in KiB for older versions, bytes for newer
    if total_bytes == 0 {
        return Err("Could not read system RAM".to_string());
    }
    // sysinfo total_memory unit varies per version; convert robustly to MB
    let mb = total_bytes / 1024 / 1024; // if bytes; if KiB, this yields KB->MB correctly too
    Ok(mb)
}

#[tauri::command]
fn get_instances() -> Vec<Instance> {
    load_instances()
}

#[tauri::command]
fn save_instance(instance: Instance) -> Result<(), String> {
    let mut instances = load_instances();
    
    // Ensure root directory exists (AppData/Roaming/Eventos DRK)
    let root_dir = get_instances_dir();
    if !Path::new(&root_dir).exists() {
        fs::create_dir_all(&root_dir).map_err(|e| e.to_string())?;
    }

    // Create standard directory structure
    let dirs_to_create = vec!["assets", "libraries", "logs", "java", "instances"];
    for dir in dirs_to_create {
        let dir_path = Path::new(&root_dir).join(dir);
        if !dir_path.exists() {
             fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
        }
    }
    
    // Sanitize name for folder use (replace invalid chars)
    let folder_name = instance.name.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    
    // Create instance directory structure using the NAME
    let instances_subdir = get_instances_subdir();
    let instance_path = Path::new(&instances_subdir).join(&folder_name);
    if !instance_path.exists() {
        fs::create_dir_all(&instance_path).map_err(|e| format!("Failed to create instance directory: {}", e))?;
    }
    
    // Create subdirectories
    let minecraft_dir = instance_path.join("minecraft");
    let mods_dir = minecraft_dir.join("mods");
    let resourcepacks_dir = minecraft_dir.join("resourcepacks");
    let saves_dir = minecraft_dir.join("saves");
    let logs_dir = minecraft_dir.join("logs");
    let coremods_dir = minecraft_dir.join("coremods");
    let server_resource_packs_dir = minecraft_dir.join("server-resource-packs");
    
    fs::create_dir_all(&minecraft_dir).map_err(|e| format!("Failed to create minecraft directory: {}", e))?;
    fs::create_dir_all(&mods_dir).map_err(|e| format!("Failed to create mods directory: {}", e))?;
    fs::create_dir_all(&resourcepacks_dir).map_err(|e| format!("Failed to create resourcepacks directory: {}", e))?;
    fs::create_dir_all(&saves_dir).map_err(|e| format!("Failed to create saves directory: {}", e))?;
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs directory: {}", e))?;
    fs::create_dir_all(&coremods_dir).map_err(|e| format!("Failed to create coremods directory: {}", e))?;
    fs::create_dir_all(&server_resource_packs_dir).map_err(|e| format!("Failed to create server-resource-packs directory: {}", e))?;
    
    // Create options.txt if not exists (Empty)
    let options_path = minecraft_dir.join("options.txt");
    if !options_path.exists() {
        let _ = fs::write(options_path, "");
    }

    // Remove coremods if it exists (Cleanup) - Wait, screenshots show it exists. Keeping it.
    // if coremods_dir.exists() {
    //    let _ = fs::remove_dir_all(coremods_dir);
    // }

    // Create instance.cfg
    let config_path = instance_path.join("instance.cfg");
    if !config_path.exists() {
        let config_content = format!(
            "InstanceType=OneSix\nname={}\nnotes={}\n",
            instance.name,
            instance.description.clone().unwrap_or_default()
        );
        let _ = fs::write(config_path, config_content);
    }

    // Create mmc-pack.json
     let pack_path = instance_path.join("mmc-pack.json");
     if !pack_path.exists() {
         let mut components = vec![
             serde_json::json!({
                 "cachedName": "Minecraft",
                 "cachedVersion": instance.version,
                 "important": true,
                 "uid": "net.minecraft",
                 "version": instance.version
             })
         ];

         if let Some(loader) = &instance.modloader {
             if loader == "forge" {
                 components.push(serde_json::json!({
                     "cachedName": "Forge",
                     "cachedVersion": "latest",
                     "uid": "net.minecraftforge",
                     "version": "latest"
                 }));
             } else if loader == "fabric" {
                 components.push(serde_json::json!({
                     "cachedName": "Fabric Loader",
                     "cachedVersion": "latest",
                     "uid": "net.fabricmc.fabric-loader",
                     "version": "latest"
                 }));
             }
         }

         // Simple mmc-pack generation
         let pack_content = serde_json::json!({
             "components": components,
             "formatVersion": 1
         });
         
         if let Ok(json) = serde_json::to_string_pretty(&pack_content) {
             let _ = fs::write(pack_path, json);
         }
     }
     
     // Update instance path
    let mut updated_instance = instance;
    updated_instance.path = instance_path.to_string_lossy().to_string();
    
    // Check if instance with this id exists
    if let Some(existing) = instances.iter_mut().find(|i| i.id == updated_instance.id) {
        *existing = updated_instance;
    } else {
        instances.push(updated_instance);
    }
    
    save_instances(&instances);
    Ok(())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
async fn launch_instance(app: tauri::AppHandle, instance_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let instances = load_instances();
    let instance = instances.iter().find(|i| i.id == instance_id)
        .ok_or("Instance not found")?;
    
    // Verify launcher is configured
    if instance.launcher.is_none() {
        return Err("Launcher not configured".to_string());
    }

    // Get Auth Profile
    let auth_profile = {
        let auth_state = state.auth.lock().map_err(|_| "Failed to lock auth state")?;
        auth_state.profile.clone().ok_or("Not logged in. Please login first.")?
    };

    let instance_path = std::path::PathBuf::from(&instance.path);
    let app_data = get_instances_dir(); // This returns ".../Eventos DRK" which is our root
    let root_path = std::path::PathBuf::from(app_data);

    let ram = instance.ram.unwrap_or(4096);
    let version = instance.version.clone();
    let mods_urls = instance.mods.clone();
    let modpack_url = instance.modpack_url.clone();
    let loader = instance.modloader.clone();
    let width = instance.resolution_width;
    let height = instance.resolution_height;
    
    // Run in background thread to avoid blocking UI
    let instance_path_clone = instance_path.clone();
    let root_path_clone = root_path.clone();
    let auth_profile_clone = auth_profile.clone();
    let mods_urls_clone = mods_urls.clone();
    let modpack_url_clone = modpack_url.clone();
    let loader_clone = loader.clone();
    let app_clone = app.clone();
    
    tauri::async_runtime::spawn_blocking(move || {
        // Create logs dir
        let _ = fs::create_dir_all(instance_path_clone.join("logs"));
        
        // Ensure instance folder structure exists, recreate if deleted
        let _ = std::fs::create_dir_all(instance_path_clone.join("minecraft"));
        let _ = std::fs::create_dir_all(instance_path_clone.join("minecraft").join("mods"));
        let _ = std::fs::create_dir_all(instance_path_clone.join("minecraft").join("resourcepacks"));
        let coremods = instance_path_clone.join("minecraft").join("coremods");
        if coremods.exists() { let _ = std::fs::remove_dir_all(coremods); }

        // Prepare and Launch
    match minecraft::launch_logic::prepare_and_launch(
        &root_path_clone,
        &instance_path_clone,
        &version,
        &auth_profile_clone,
        ram,
        mods_urls_clone,
        modpack_url_clone,
        loader_clone,
        width,
        height,
        Some(app_clone.clone()),
        &instance_id,
        false // force_update: false for normal launch
    ) {
            Ok(mut cmd) => {
                // Redirect output to files
                if let Ok(stdout_file) = std::fs::File::create(instance_path_clone.join("logs").join("latest.log")) {
                     cmd.stdout(stdout_file);
                }
                if let Ok(stderr_file) = std::fs::File::create(instance_path_clone.join("logs").join("latest_err.log")) {
                     cmd.stderr(stderr_file);
                }
                
                match cmd.spawn() {
                    Ok(mut child) => {
                        let _ = app_clone.emit("launch_progress", serde_json::json!({
                            "instanceId": instance_id,
                            "stage": "iniciado",
                            "percent": 100,
                            "message": "Juego iniciado"
                        }));
                        
                        // Monitor process execution
                        match child.wait() {
                            Ok(status) => {
                                if !status.success() {
                                    let code = status.code().unwrap_or(-1);
                                    
                                    // Try to read last lines of error log
                                    let mut error_details = String::new();
                                    if let Ok(content) = std::fs::read_to_string(instance_path_clone.join("logs").join("latest_err.log")) {
                                        error_details = content.lines().rev().take(10).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
                                    } else if let Ok(content) = std::fs::read_to_string(instance_path_clone.join("logs").join("latest.log")) {
                                        error_details = content.lines().rev().take(10).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
                                    }

                                    let message = if !error_details.is_empty() {
                                        format!("El juego se cerró con error (Código: {}). Detalles:\n{}", code, error_details)
                                    } else {
                                        format!("El juego se cerró con error (Código: {})", code)
                                    };

                                    let _ = app_clone.emit("launch_progress", serde_json::json!({
                                        "instanceId": instance_id,
                                        "stage": "crasheado",
                                        "percent": 100,
                                        "message": message
                                    }));
                                } else {
                                    let _ = app_clone.emit("launch_progress", serde_json::json!({
                                        "instanceId": instance_id,
                                        "stage": "cerrado",
                                        "percent": 100,
                                        "message": "Juego cerrado correctamente"
                                    }));
                                }
                            }
                            Err(e) => {
                                let _ = app_clone.emit("launch_progress", serde_json::json!({
                                    "instanceId": instance_id,
                                    "stage": "error",
                                    "percent": 100,
                                    "message": format!("Error monitoring process: {}", e)
                                }));
                            }
                        }
                        Ok(())
                    },
                    Err(e) => {
                        let message = format!("Failed to spawn process: {}", e);
                        let _ = app_clone.emit("launch_progress", serde_json::json!({
                            "instanceId": instance_id,
                            "stage": "error",
                            "percent": 100,
                            "message": message
                        }));
                        Err(message)
                    }
                }
            }
            Err(e) => {
                let _ = app_clone.emit("launch_progress", serde_json::json!({
                    "instanceId": instance_id,
                    "stage": "error",
                    "percent": 100,
                    "message": e
                }));
                Err(e)
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn prepare_instance(app: tauri::AppHandle, instance_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let instances = load_instances();
    let instance = instances.iter().find(|i| i.id == instance_id)
        .ok_or("Instance not found")?;
    if instance.launcher.is_none() {
        return Err("Launcher not configured".to_string());
    }
    let auth_profile = {
        let auth_state = state.auth.lock().map_err(|_| "Failed to lock auth state")?;
        auth_state.profile.clone().ok_or("Not logged in. Please login first.")?
    };
    let instance_path = std::path::PathBuf::from(&instance.path);
    let app_data = get_instances_dir();
    let root_path = std::path::PathBuf::from(app_data);
    let ram = instance.ram.unwrap_or(4096);
    let version = instance.version.clone();
    let mods_urls = instance.mods.clone();
    let modpack_url = instance.modpack_url.clone();
    let loader = instance.modloader.clone();
    let width = instance.resolution_width;
    let height = instance.resolution_height;
    let instance_path_clone = instance_path.clone();
    let root_path_clone = root_path.clone();
    let auth_profile_clone = auth_profile.clone();
    let mods_urls_clone = mods_urls.clone();
    let modpack_url_clone = modpack_url.clone();
    let loader_clone = loader.clone();
    let app_clone = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _ = fs::create_dir_all(instance_path_clone.join("logs"));
        let _ = std::fs::create_dir_all(instance_path_clone.join("minecraft"));
        let _ = std::fs::create_dir_all(instance_path_clone.join("minecraft").join("mods"));
        let _ = std::fs::create_dir_all(instance_path_clone.join("minecraft").join("resourcepacks"));
        let coremods = instance_path_clone.join("minecraft").join("coremods");
        if coremods.exists() { let _ = std::fs::remove_dir_all(coremods); }
        match minecraft::launch_logic::prepare_and_launch(
            &root_path_clone,
            &instance_path_clone,
            &version,
            &auth_profile_clone,
            ram,
            mods_urls_clone,
            modpack_url_clone,
            loader_clone,
            width,
            height,
            Some(app_clone.clone()),
            &instance_id,
            true // force_update: true for manual verify/repair
        ) {
            Ok(_) => {
                let _ = app_clone.emit("launch_progress", serde_json::json!({
                    "instanceId": instance_id,
                    "stage": "descarga_completa",
                    "percent": 100,
                    "message": "Descarga completa"
                }));
                Ok(())
            },
            Err(e) => {
                let _ = app_clone.emit("launch_progress", serde_json::json!({
                    "instanceId": instance_id,
                    "stage": "error",
                    "percent": 100,
                    "message": e
                }));
                Err(e)
            }
        }
    }).await;

    match result {
        Ok(res) => res,
        Err(e) => Err(format!("Task panicked: {}", e))
    }
}

#[tauri::command]
fn check_instance_ready(instance_id: String) -> Result<bool, String> {
    let instances = load_instances();
    let instance = instances.iter().find(|i| i.id == instance_id)
        .ok_or("Instance not found")?;
    
    let instance_path = std::path::PathBuf::from(&instance.path);
    if !instance_path.exists() {
        return Ok(false);
    }

    let root_path = std::path::PathBuf::from(get_instances_dir());
    
    // 1. Check if modpack is downloaded
    if let Some(url) = &instance.modpack_url {
        if !url.is_empty() {
             let zip_path = instance_path.join("minecraft").join("modpack.zip");
             if !zip_path.exists() {
                 return Ok(false);
             }
             // If zip exists, we assume it's ready. Launch logic handles extraction.
        }
    }

    let versions_dir = root_path.join("versions");
    let is_vanilla = instance.modloader.as_deref().map(|l| l == "vanilla").unwrap_or(true);
    if is_vanilla {
        let client_jar = instance_path.join("minecraft").join("client.jar");
        if !client_jar.exists() {
            return Ok(false);
        }
    } else {
        let profile_json = versions_dir.join(&instance.version).join("version.json");
        if !profile_json.exists() {
            return Ok(false);
        }
    }
    
    Ok(true)
}

#[tauri::command]
fn delete_instance(instance_id: String) -> Result<(), String> {
    let mut instances = load_instances();
    if let Some(index) = instances.iter().position(|i| i.id == instance_id) {
        let instance = &instances[index];
        let path = std::path::PathBuf::from(&instance.path);
        
        // Safety check: Ensure path is within instances_subdir
        let instances_subdir = std::path::PathBuf::from(get_instances_subdir());
        // Only delete if it looks like a valid subfolder
        if path.starts_with(&instances_subdir) && path != instances_subdir && path.exists() {
             let _ = fs::remove_dir_all(&path);
        }

        instances.remove(index);
        save_instances(&instances);
        Ok(())
    } else {
        Err("Instance not found".to_string())
    }
}

#[tauri::command]
fn check_admin_password(password: String) -> bool {
    let path = get_admin_path();
    if !Path::new(&path).exists() {
        // Default password if not set: "DrkAdmin2026Secure!"
        return password == "DrkAdmin2026Secure!";
    }
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(hash) = json.get("hash").and_then(|h| h.as_str()) {
                let mut hasher = Sha1::new();
                hasher.update(password.as_bytes());
                let result = hex::encode(hasher.finalize());
                return result == hash;
            }
        }
    }
    false
}

#[tauri::command]
fn set_admin_password(password: String) -> Result<(), String> {
    let path = get_admin_path();
    let mut hasher = Sha1::new();
    hasher.update(password.as_bytes());
    let result = hex::encode(hasher.finalize());
    
    let json = serde_json::json!({
        "hash": result
    });
    
    if let Some(p) = Path::new(&path).parent() {
        let _ = fs::create_dir_all(p);
    }
    fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_admin_configured() -> bool {
    Path::new(&get_admin_path()).exists()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            auth: Mutex::new(AuthState::default()),
        })
        .invoke_handler(tauri::generate_handler![
            get_instances,
            save_instance,
            delete_instance,
            launch_instance,
            prepare_instance,
            check_instance_ready,
            get_system_ram,
            get_mc_versions,
            get_loader_recommendation,
            get_java_info,
            download_java,
            open_folder,
            auth::start_microsoft_login,
            auth::get_auth_profile,
            auth::start_offline_login,
            check_admin_password,
            set_admin_password,
            is_admin_configured
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
#[tauri::command]
fn get_mc_versions(limit: usize) -> Result<Vec<String>, String> {
    // If limit is small (e.g. 12 from frontend default), we bump it to 100 to show more versions
    let effective_limit = if limit < 20 { 100 } else { limit };
    minecraft::versions::get_release_versions(effective_limit)
}

#[tauri::command]
fn get_loader_recommendation(loader: String, mc_version: String) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("DrkLauncher/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    match loader.as_str() {
        "fabric" => {
            // Query Fabric meta for recommended stable loader
            let url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version);
            let list: serde_json::Value = client.get(&url)
                .send()
                .map_err(|e| e.to_string())?
                .json()
                .map_err(|e| e.to_string())?;
            let loader_version = list.as_array()
                .and_then(|arr| arr.iter().find(|item| item["loader"]["stable"].as_bool().unwrap_or(true)))
                .and_then(|item| item["loader"]["version"].as_str())
                .ok_or("No fabric loader version found")?;
            Ok(loader_version.to_string())
        }
        "forge" => {
            // Use Forge promotions.json to get recommended build for a MC version
            let promos: serde_json::Value = client.get("https://files.minecraftforge.net/net/minecraftforge/forge/promotions.json")
                .send()
                .map_err(|e| e.to_string())?
                .json()
                .map_err(|e| e.to_string())?;
            if let Some(map) = promos.get("promos").and_then(|v| v.as_object()) {
                let key = format!("{}-recommended", mc_version);
                if let Some(ver) = map.get(&key).and_then(|v| v.as_str()) {
                    return Ok(ver.to_string());
                }
            }
            Err("No forge recommended build found".to_string())
        }
        _ => Err("Unsupported loader".to_string())
    }
}

#[tauri::command]
fn get_java_info(mc_version: String) -> Result<serde_json::Value, String> {
    let required = minecraft::java::get_required_java_version(&mc_version);
    let path = minecraft::java::get_java_path(&mc_version)?;
    let installed = path.to_string_lossy() != "java" || minecraft::java::get_system_java_version("java").unwrap_or(0) >= required;
    Ok(serde_json::json!({
        "recommended": required,
        "installed": installed,
        "path": path.to_string_lossy()
    }))
}

#[tauri::command]
fn download_java(major: u32) -> Result<String, String> {
    minecraft::java::download_java(major, None, None)
}
