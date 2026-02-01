use std::path::{Path, PathBuf};
use std::fs;
use std::process::Command;
use tauri::AppHandle;
use tauri::Emitter;
use crate::auth::MinecraftProfile;
use super::models::{VersionInfo};
use super::downloader::download_file;
use super::java::{get_java_path_for_major, get_required_java_version, download_java};
use super::utils::check_rules;
use super::launch_logic::{load_fabric_profile_info};

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

pub fn download_fabric(
    base_path: &Path,
    instance_minecraft_dir: &Path,
    mc_version: &str,
    app: &Option<AppHandle>,
    instance_id: &str
) -> Result<VersionInfo, String> {
    let _assets_dir = base_path.join("assets");
    let libraries_dir = base_path.join("libraries");
    let versions_dir = base_path.join("versions");
    fs::create_dir_all(instance_minecraft_dir).map_err(|e| e.to_string())?;
    super::vanilla_loader::download_vanilla(base_path, instance_minecraft_dir, mc_version, app, instance_id)?;
    emit(app, instance_id, "fabric", 60, "Descargando perfil Fabric");
    let info = load_fabric_profile_info(mc_version)?;
    let version_dir = versions_dir.join(&info.id);
    fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    let json_path = version_dir.join("version.json");
    let json = serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?;
    fs::write(&json_path, json).map_err(|e| e.to_string())?;
    if let Some(downloads) = &info.downloads {
        let client_path = instance_minecraft_dir.join("client.jar");
        if !client_path.exists() {
            download_file(&downloads.client.url, &client_path, Some(&downloads.client.sha1))?;
        }
    }
    if !info.libraries.is_empty() {
        emit(app, instance_id, "librerias", 70, "Descargando librerías Fabric");
        for lib in &info.libraries {
            if !check_rules(&lib.rules) { continue; }
            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    if let Some(path_str) = &artifact.path {
                        let target = libraries_dir.join(path_str);
                        let _ = fs::create_dir_all(target.parent().unwrap());
                        download_file(&artifact.url, &target, Some(&artifact.sha1))?;
                    }
                }
            } else if let Some(maven) = parse_maven_name(&lib.name) {
                if let Some(path_str) = maven_path(&maven) {
                    let base_url = lib.url.clone().unwrap_or_else(|| "https://maven.fabricmc.net/".to_string());
                    let url = format!("{}{}", ensure_trailing_slash(&base_url), path_str);
                    let target = libraries_dir.join(&path_str);
                    if let Some(parent) = target.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    let _ = download_file(&url, &target, None);
                }
            }
        }
    }
    Ok(info)
}

pub fn build_fabric_command(
    base_path: &Path,
    instance_minecraft_dir: &Path,
    info: &VersionInfo,
    auth: &MinecraftProfile,
    ram_mb: u64
) -> Result<Command, String> {
    let assets_dir = base_path.join("assets");
    let libraries_dir = base_path.join("libraries");
    let versions_dir = base_path.join("versions");
    let required_java = if let Some(jv) = &info.java_version {
        jv.major_version
    } else if let Some(parent_id) = &info.inherits_from {
        get_required_java_version(parent_id)
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
    let meta_path = versions_dir.join(&info.id).join("version.json");
    if meta_path.exists() {
        if let Ok(content) = fs::read_to_string(&meta_path) {
            if let Ok(meta) = serde_json::from_str::<VersionInfo>(&content) {
                for lib in meta.libraries {
                    if !check_rules(&lib.rules) { continue; }
                    if let Some(downloads) = &lib.downloads {
                        if let Some(artifact) = &downloads.artifact {
                            if let Some(path_str) = &artifact.path {
                                let p = libraries_dir.join(path_str);
                                if !p.exists() {
                                    let _ = fs::create_dir_all(p.parent().unwrap_or(&libraries_dir));
                                    let _ = download_file(&artifact.url, &p, Some(&artifact.sha1));
                                }
                                if p.exists() { jars.push(p); }
                            }
                        }
                    } else if let Some(maven) = parse_maven_name(&lib.name) {
                        if let Some(path_str) = maven_path(&maven) {
                            let p = libraries_dir.join(&path_str);
                            if !p.exists() {
                                let base_url = lib.url.clone().unwrap_or_else(|| "https://maven.fabricmc.net/".to_string());
                                let url = format!("{}{}", ensure_trailing_slash(&base_url), path_str);
                                let _ = fs::create_dir_all(p.parent().unwrap_or(&libraries_dir));
                                let _ = download_file(&url, &p, None);
                            }
                            if p.exists() { jars.push(p); }
                        }
                    }
                }
            }
        }
    }
    // Merge parent (vanilla) libraries into classpath
    let mut parent_asset_index_id: Option<String> = None;
    if let Some(parent_id) = &info.inherits_from {
        // Try both "version.json" and "<id>.json"
        let parent_version_json = {
            let path1 = versions_dir.join(parent_id).join("version.json");
            if path1.exists() {
                Some(path1)
            } else {
                let path2 = versions_dir.join(parent_id).join(format!("{}.json", parent_id));
                if path2.exists() { Some(path2) } else { None }
            }
        };
        if let Some(pmeta_path) = parent_version_json {
            if let Ok(content) = fs::read_to_string(&pmeta_path) {
                if let Ok(pmeta) = serde_json::from_str::<VersionInfo>(&content) {
                    parent_asset_index_id = pmeta.asset_index.as_ref().map(|a| a.id.clone());
                    for lib in pmeta.libraries {
                        if !check_rules(&lib.rules) { continue; }
                        if let Some(downloads) = &lib.downloads {
                            if let Some(artifact) = &downloads.artifact {
                                if let Some(path_str) = &artifact.path {
                                    let p = libraries_dir.join(path_str);
                                    if !p.exists() {
                                        let _ = fs::create_dir_all(p.parent().unwrap_or(&libraries_dir));
                                        let _ = download_file(&artifact.url, &p, Some(&artifact.sha1));
                                    }
                                    if p.exists() { jars.push(p); }
                                }
                            }
                        } else if let Some(maven) = parse_maven_name(&lib.name) {
                            if let Some(path_str) = maven_path(&maven) {
                                let p = libraries_dir.join(&path_str);
                                if !p.exists() {
                                    let base_url = lib.url.clone().unwrap_or_else(|| "https://libraries.minecraft.net/".to_string());
                                    let url = format!("{}{}", ensure_trailing_slash(&base_url), path_str);
                                    let _ = fs::create_dir_all(p.parent().unwrap_or(&libraries_dir));
                                    let _ = download_file(&url, &p, None);
                                }
                                if p.exists() { jars.push(p); }
                            }
                        }
                    }
                }
            }
        }
    }
    let client_path = instance_minecraft_dir.join("client.jar");
    if client_path.exists() {
        jars.insert(0, client_path);
    } else {
        return Err("client.jar missing in instance".to_string());
    }
    let has_fabric_loader = jars.iter().any(|p| {
        p.file_name().and_then(|n| n.to_str()).map(|s| s.to_lowercase().contains("fabric-loader")).unwrap_or(false)
    });
    if !has_fabric_loader {
        return Err("Falta la librería fabric-loader en el classpath. Usa \"Verificar\" para reparar la instancia.".to_string());
    }
    // Ensure jopt-simple present for Main option parsing on some MC versions
    let has_jopt = jars.iter().any(|p| {
        p.file_name().and_then(|n| n.to_str()).map(|s| s.to_lowercase().contains("jopt-simple")).unwrap_or(false)
    });
    if !has_jopt {
        // Try to fetch commonly required jopt-simple if missing (fallback)
        let fallback = libraries_dir.join("net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar");
        if !fallback.exists() {
            let _ = fs::create_dir_all(fallback.parent().unwrap_or(&libraries_dir));
            let _ = download_file(
                "https://libraries.minecraft.net/net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar",
                &fallback,
                None
            );
        }
        if fallback.exists() {
            jars.push(fallback);
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
    let asset_index_id = info.asset_index
        .as_ref()
        .map(|a| a.id.clone())
        .or(parent_asset_index_id)
        .unwrap_or_else(|| "legacy".to_string());
    cmd.arg("--version").arg(&info.id);
    cmd.arg("--gameDir").arg(instance_minecraft_dir);
    cmd.arg("--assetsDir").arg(assets_dir);
    cmd.arg("--assetIndex").arg(asset_index_id);
    cmd.arg("--uuid").arg(&auth.id);
    cmd.arg("--accessToken").arg(&auth.access_token);
    cmd.arg("--userType").arg("mojang");
    cmd.arg("--versionType").arg("loader");
    cmd.arg("--width").arg("854");
    cmd.arg("--height").arg("480");
    Ok(cmd)
}

#[derive(Clone)]
struct MavenName {
    group: String,
    artifact: String,
    version: String,
    classifier: Option<String>,
    ext: String,
}

fn parse_maven_name(name: &str) -> Option<MavenName> {
    let mut parts = name.split('@');
    let main = parts.next()?;
    let ext = parts.next().unwrap_or("jar").to_string();
    let items: Vec<&str> = main.split(':').collect();
    if items.len() < 3 {
        return None;
    }
    let classifier = if items.len() > 3 { Some(items[3].to_string()) } else { None };
    Some(MavenName {
        group: items[0].to_string(),
        artifact: items[1].to_string(),
        version: items[2].to_string(),
        classifier,
        ext,
    })
}

fn maven_path(maven: &MavenName) -> Option<String> {
    let group_path = maven.group.replace('.', "/");
    let mut filename = format!("{}-{}", maven.artifact, maven.version);
    if let Some(classifier) = &maven.classifier {
        if !classifier.is_empty() {
            filename = format!("{}-{}", filename, classifier);
        }
    }
    filename = format!("{}.{}", filename, maven.ext);
    Some(format!(
        "{}/{}/{}/{}",
        group_path, maven.artifact, maven.version, filename
    ))
}

fn ensure_trailing_slash(value: &str) -> String {
    if value.ends_with('/') {
        value.to_string()
    } else {
        format!("{}/", value)
    }
}
