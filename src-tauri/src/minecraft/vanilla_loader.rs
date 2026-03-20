use std::path::{Path, PathBuf};
use std::fs;
use std::process::Command;
use tauri::AppHandle;
use tauri::Emitter;
use crate::auth::MinecraftProfile;
use super::models::{VersionManifest, VersionInfo, AssetIndex};
use super::downloader::download_file;
use super::java::{get_java_path_for_major, get_required_java_version, download_java};
use super::utils::check_rules;
use super::launch_logic::{resolve_complete_version_info};

fn emit(app: &Option<AppHandle>, instance_id: &str, stage: &str, percent: u8, message: &str) {
    if let Some(app) = app {
        let _ = app.emit("launch_progress", serde_json::json!({
            "instanceId": instance_id,
            "stage": stage,
            "percent": percent,
            "message": message,
        }));
    }
}

pub fn download_vanilla(
    base_path: &Path,
    instance_minecraft_dir: &Path,
    mc_version: &str,
    app: &Option<AppHandle>,
    instance_id: &str
) -> Result<VersionInfo, String> {
    let assets_dir = base_path.join("assets");
    let libraries_dir = base_path.join("libraries");
    let versions_dir = base_path.join("versions");
    fs::create_dir_all(instance_minecraft_dir).map_err(|e| e.to_string())?;
    let manifest: VersionManifest = super::launch_logic::fetch_manifest_with_fallback()
        .map_err(|e| format!("Failed to fetch manifest (with fallback): {}", e))?;
    let info = resolve_complete_version_info(mc_version, &versions_dir, &manifest)?;
    let version_dir = versions_dir.join(&info.id);
    fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    let json_path = version_dir.join("version.json");
    let json = serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?;
    fs::write(&json_path, json).map_err(|e| e.to_string())?;
    emit(app, instance_id, "cliente", 55, "Descargando cliente");
    if let Some(downloads) = &info.downloads {
        let client_path = instance_minecraft_dir.join("client.jar");
        download_file(&downloads.client.url, &client_path, Some(&downloads.client.sha1))?;
    }
    if let Some(asset_index_ref) = &info.asset_index {
        let idx_path = assets_dir.join("indexes").join(format!("{}.json", asset_index_ref.id));
        download_file(&asset_index_ref.url, &idx_path, Some(&asset_index_ref.sha1))?;
        let asset_index: AssetIndex = serde_json::from_str(
            &fs::read_to_string(&idx_path).map_err(|e| e.to_string())?
        ).map_err(|e| e.to_string())?;
        super::launch_logic::download_assets_parallel(&assets_dir, &asset_index, app, instance_id)?;
    }
    emit(app, instance_id, "librerias", 65, "Descargando librerías");
    let mut libs = Vec::new();
    for lib in &info.libraries {
        if !check_rules(&lib.rules) { continue; }
        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                if let Some(path_str) = &artifact.path {
                    let target = libraries_dir.join(path_str);
                    let _ = fs::create_dir_all(target.parent().unwrap());
                    download_file(&artifact.url, &target, Some(&artifact.sha1))?;
                    libs.push(target);
                }
            }
        }
    }
    Ok(info)
}

pub fn build_vanilla_command(
    base_path: &Path,
    instance_minecraft_dir: &Path,
    info: &VersionInfo,
    auth: &MinecraftProfile,
    ram_mb: u64,
    width: Option<u32>,
    height: Option<u32>
) -> Result<Command, String> {
    let assets_dir = base_path.join("assets");
    let libraries_dir = base_path.join("libraries");
    let versions_dir = base_path.join("versions");
    
    let required_java = if let Some(jv) = &info.java_version {
        jv.major_version
    } else {
        get_required_java_version(&info.id)
    };
    
    let java_path = match get_java_path_for_major(required_java) {
        Ok(p) => p,
        Err(_) => {
            let path_str = download_java(required_java, None, None)?;
            PathBuf::from(path_str)
        }
    };
    
    let mut jars: Vec<PathBuf> = Vec::new();
    for lib in &info.libraries {
        if !check_rules(&lib.rules) { continue; }
        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                if let Some(path_str) = &artifact.path {
                    let p = libraries_dir.join(path_str);
                    if p.exists() { jars.push(p); }
                }
            }
        }
    }
    
    let client_path = versions_dir.join(&info.id).join(format!("{}.jar", &info.id));
    if client_path.exists() {
        jars.push(client_path);
    } else {
        // Fallback for newer versions where it might be in the instance dir
        let instance_client = instance_minecraft_dir.join("client.jar");
        if instance_client.exists() {
            jars.push(instance_client);
        }
    }
    
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
    let classpath = jars.into_iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>().join(sep);
    
    let mut cmd = Command::new(java_path);
    let min_mem = std::cmp::max(512, ram_mb / 4);
    cmd.arg(format!("-Xms{}M", min_mem));
    cmd.arg(format!("-Xmx{}M", ram_mb));
    cmd.arg("-XX:+UnlockExperimentalVMOptions");
    cmd.arg("-XX:+UseG1GC");
    cmd.arg("-XX:MaxGCPauseMillis=120");
    cmd.arg("-XX:G1HeapRegionSize=8M");
    cmd.arg("-XX:G1NewSizePercent=30");
    cmd.arg("-XX:G1MaxNewSizePercent=40");
    cmd.arg("-XX:G1ReservePercent=20");
    cmd.arg("-XX:G1HeapWastePercent=5");
    cmd.arg("-XX:G1MixedGCCountTarget=4");
    cmd.arg("-XX:InitiatingHeapOccupancyPercent=15");
    cmd.arg("-XX:G1MixedGCLiveThresholdPercent=90");
    cmd.arg("-XX:G1RSetUpdatingPauseTimePercent=5");
    cmd.arg("-XX:ReservedCodeCacheSize=768M");
    cmd.arg("-XX:InitialCodeCacheSize=128M");
    cmd.arg("-XX:+ParallelRefProcEnabled");
    cmd.arg("-XX:+DisableExplicitGC");
    cmd.arg("-XX:+AlwaysPreTouch");
    cmd.arg("-XX:+UseStringDeduplication");
    cmd.arg("-XX:+UseCompressedOops");
    cmd.arg("-XX:+UseCompressedClassPointers");
    cmd.arg("-XX:+PerfDisableSharedMem");
    cmd.arg("-Djava.net.preferIPv4Stack=true");
    cmd.arg("-Dfile.encoding=UTF-8");
    cmd.arg("-Djava.awt.headless=false");
    cmd.arg("-cp").arg(classpath);
    cmd.arg(format!("-Dorg.lwjgl.librarypath={}", instance_minecraft_dir.join("natives").to_string_lossy()));
    cmd.arg(format!("-Djava.library.path={}", instance_minecraft_dir.join("natives").to_string_lossy()));
    
    if required_java >= 16 {
        cmd.arg("--add-opens"); cmd.arg("java.base/java.util=ALL-UNNAMED");
        cmd.arg("--add-opens"); cmd.arg("java.base/java.lang=ALL-UNNAMED");
        cmd.arg("--add-opens"); cmd.arg("java.base/java.lang.reflect=ALL-UNNAMED");
        cmd.arg("--add-opens"); cmd.arg("java.base/java.lang.invoke=ALL-UNNAMED");
        cmd.arg("--add-opens"); cmd.arg("java.base/java.text=ALL-UNNAMED");
        cmd.arg("--add-opens"); cmd.arg("java.desktop/java.awt.font=ALL-UNNAMED");
        cmd.arg("--add-opens"); cmd.arg("java.base/java.nio=ALL-UNNAMED");
        cmd.arg("--add-opens"); cmd.arg("java.base/sun.nio.ch=ALL-UNNAMED");
        cmd.arg("--add-opens"); cmd.arg("java.base/java.util.jar=ALL-UNNAMED");
        cmd.arg("--add-exports"); cmd.arg("java.base/sun.security.util=ALL-UNNAMED");
        cmd.arg("--add-exports"); cmd.arg("jdk.naming.dns/com.sun.jndi.dns=java.naming");
    }
    
    cmd.arg(&info.main_class);
    let asset_index_id = info.asset_index.as_ref().map(|a| a.id.as_str()).unwrap_or("legacy");
    cmd.arg("--version").arg(&info.id);
    cmd.arg("--gameDir").arg(instance_minecraft_dir);
    cmd.arg("--assetsDir").arg(assets_dir);
    cmd.arg("--assetIndex").arg(asset_index_id);
    cmd.arg("--username").arg(&auth.name);
    cmd.arg("--uuid").arg(&auth.id);
    cmd.arg("--accessToken").arg(&auth.access_token);
    cmd.arg("--userType").arg("mojang");
    cmd.arg("--versionType").arg("launcher");
    
    // Resolución dinámica
    cmd.arg("--width").arg(width.unwrap_or(854).to_string());
    cmd.arg("--height").arg(height.unwrap_or(480).to_string());
    
    Ok(cmd)
}
