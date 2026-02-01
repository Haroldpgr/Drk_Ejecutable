use std::process::Command;
use std::path::{Path, PathBuf};
use std::fs;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use crate::auth::MinecraftProfile;
use tauri::Emitter;
use tauri::AppHandle;
use super::models::*;
use super::downloader::download_file;
use super::utils::{get_os_name, get_arch, extract_natives, replace_vars, check_rules};
use super::java::{get_java_path_for_major, get_required_java_version, download_java, get_system_java_version};

 
const RESOURCES_URL: &str = "https://resources.download.minecraft.net";

pub fn fetch_manifest_with_fallback() -> Result<VersionManifest, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("DrkLauncher/1.0")
        .build()
        .map_err(|e| format!("Failed to build http client: {}", e))?;
    
    let urls = [
        "https://piston-meta.mojang.com/mc/game/version_manifest.json",
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
        "https://launchermeta.mojang.com/mc/game/version_manifest.json",
        "https://bmclapi2.bangbang93.com/mc/game/version_manifest.json",
    ];
    let mut last_err = String::new();
    for url in urls {
        match client.get(url).send() {
            Ok(resp) => {
                if resp.status().is_success() {
                    match resp.json::<VersionManifest>() {
                        Ok(m) => return Ok(m),
                        Err(e) => last_err = format!("Failed to parse manifest: {}", e),
                    }
                } else {
                    last_err = format!("Manifest returned status: {}", resp.status());
                }
            }
            Err(e) => {
                last_err = format!("Failed to fetch manifest: {}", e);
            }
        }
    }
    Err(last_err)
}

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

fn download_mods_parallel(
    urls: &[String],
    mods_dir: &Path,
    app: &Option<AppHandle>,
    instance_id: &str
) -> Result<(), String> {
    if urls.is_empty() {
        return Ok(());
    }

    let total = urls.len() as u64;
    let tasks = Arc::new(Mutex::new(VecDeque::new()));
    
    for url in urls {
        if let Some(fname) = url.split('/').last() {
            let target = mods_dir.join(fname);
            tasks.lock().map_err(|_| "Failed to lock tasks".to_string())?
                .push_back((url.clone(), target));
        }
    }

    let done = Arc::new(AtomicU64::new(0));
    let error = Arc::new(Mutex::new(None::<String>));
    let workers = 10usize;
    let mut handles = Vec::new();

    for _ in 0..workers {
        let tasks = Arc::clone(&tasks);
        let done = Arc::clone(&done);
        let error = Arc::clone(&error);
        let app = app.clone();
        let instance_id = instance_id.to_string();
        
        handles.push(std::thread::spawn(move || {
            loop {
                if error.lock().ok().and_then(|e| e.clone()).is_some() {
                    break;
                }
                let task = {
                    let mut guard = match tasks.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                    guard.pop_front()
                };
                let (url, path) = match task {
                    Some(t) => t,
                    None => break,
                };
                
                // Retry logic (3 attempts)
                let mut attempts = 0;
                let mut success = false;
                let mut last_err = String::new();
                
                while attempts < 3 {
                    match download_file(&url, &path, None) {
                        Ok(_) => {
                            success = true;
                            break;
                        }
                        Err(e) => {
                            last_err = e;
                            attempts += 1;
                            std::thread::sleep(std::time::Duration::from_millis(500 * attempts as u64));
                        }
                    }
                }
                
                if !success {
                    if let Ok(mut guard) = error.lock() {
                        if guard.is_none() {
                            *guard = Some(format!("Failed to download mod {}: {}", url, last_err));
                        }
                    }
                    break;
                }
                
                let current = done.fetch_add(1, Ordering::SeqCst) + 1;
                // Update progress every 5 items or at the end
                if current % 5 == 0 || current == total {
                    let percent = 80 + ((current * 10) / total) as u8;
                    let msg = format!("Descargando mods {}/{}", current, total);
                    emit(&app, &instance_id, "mods", percent, &msg);
                }
            }
        }));
    }

    for handle in handles {
        let _ = handle.join();
    }

    if let Ok(guard) = error.lock() {
        if let Some(err) = guard.clone() {
            return Err(err);
        }
    }
    Ok(())
}

fn escape_arg(arg: &str) -> String {
    let mut escaped = String::new();
    let needs_quotes = arg.contains(' ') || arg.contains('\t');
    
    if needs_quotes {
        escaped.push('"');
    }
    
    for c in arg.chars() {
        if c == '"' {
            escaped.push_str("\\\"");
        } else {
            escaped.push(c);
        }
    }
    
    if needs_quotes {
        escaped.push('"');
    }
    
    escaped
}

fn normalize_path_for_comparison(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    if get_os_name() == "windows" {
        s.to_lowercase()
    } else {
        s
    }
}

pub fn prepare_and_launch(
    base_path: &Path, // Common root (e.g., AppData/Roaming/Eventos DRK)
    instance_path: &Path, // Specific instance path
    version_id: &str,
    auth: &MinecraftProfile,
    ram_mb: u64,
    mods_urls: Option<Vec<String>>,
    modpack_url: Option<String>,
    loader: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    app: Option<AppHandle>,
    instance_id: &str,
    force_update: bool
) -> Result<Command, String> {
    let assets_dir = base_path.join("assets");
    let libraries_dir = base_path.join("libraries");
    let versions_dir = base_path.join("versions");
    let natives_dir = instance_path.join("natives");
    let minecraft_dir = instance_path.join("minecraft");

    // 1. Fetch Manifest
    emit(&app, instance_id, "iniciando", 0, "Iniciando lanzamiento");
    let manifest: VersionManifest = fetch_manifest_with_fallback()
        .map_err(|e| format!("Failed to fetch manifest (with fallback): {}", e))?;
    emit(&app, instance_id, "manifest", 10, "Manifest descargado");

    let mut effective_version_id = version_id.to_string();
    if matches!(loader.as_deref(), Some("forge")) {
        effective_version_id = ensure_forge_installed(base_path, version_id, &app, instance_id)?;
    }

    // 2. Resolve Complete Version Info (Handling Inheritance / Loader)
    let version_info = if matches!(loader.as_deref(), Some("fabric")) {
        let mut child = load_fabric_profile_info(version_id)?;
        if let Some(parent_id) = &child.inherits_from {
            let parent = resolve_complete_version_info(parent_id, &versions_dir, &manifest)?;
            // Merge parts from parent into child
            if child.arguments.is_none() { child.arguments = parent.arguments; }
            if child.minecraft_arguments.is_none() { child.minecraft_arguments = parent.minecraft_arguments; }
            if child.asset_index.is_none() { child.asset_index = parent.asset_index; }
            if child.assets.is_none() { child.assets = parent.assets; }
            if child.downloads.is_none() { child.downloads = parent.downloads; }
            if child.java_version.is_none() { child.java_version = parent.java_version; }
            if child.logging.is_none() { child.logging = parent.logging; }
            let mut libs = parent.libraries.clone();
            libs.extend(child.libraries.clone());
            child.libraries = deduplicate_libraries(libs);
        }
        child
    } else {
        resolve_complete_version_info(&effective_version_id, &versions_dir, &manifest)?
    };
    emit(&app, instance_id, "version", 20, "Versión resuelta");
    if loader.as_deref().map(|l| l == "vanilla").unwrap_or(true) {
        let info = super::vanilla_loader::download_vanilla(base_path, &minecraft_dir, version_id, &app, instance_id)?;
        let cmd = super::vanilla_loader::build_vanilla_command(base_path, &minecraft_dir, &info, auth, ram_mb)?;
        return Ok(cmd);
    }
    if matches!(loader.as_deref(), Some("fabric")) {
        let info = super::fabric_loader::download_fabric(base_path, &minecraft_dir, version_id, &app, instance_id)?;
        let cmd = super::fabric_loader::build_fabric_command(base_path, &minecraft_dir, &info, auth, ram_mb)?;
        return Ok(cmd);
    }
    if matches!(loader.as_deref(), Some("forge")) {
        let info = super::forge_loader::download_forge(base_path, &minecraft_dir, version_id, &app, instance_id)?;
        let cmd = super::forge_loader::build_forge_command(base_path, &minecraft_dir, &info, auth, ram_mb)?;
        return Ok(cmd);
    }

    // 3. Download & Verify Libraries
    let mut classpath_entries = download_libraries_parallel(
        &version_info,
        &libraries_dir,
        &natives_dir,
        &app,
        instance_id
    )?;

    // 4. Download Client JAR
    if let Some(downloads) = &version_info.downloads {
        let client_id = &effective_version_id;
        let client_dir = versions_dir.join(client_id);
        let client_path = client_dir.join(format!("{}.jar", client_id));
        download_file(
            &downloads.client.url, 
            &client_path, 
            Some(&downloads.client.sha1)
        )?;
        if loader.as_deref().map(|l| l == "vanilla").unwrap_or(true) {
            if let Ok(file) = std::fs::File::open(&client_path) {
                if let Ok(mut archive) = zip::ZipArchive::new(file) {
                    if archive.by_name("net/minecraft/client/main/Main.class").is_err() {
                        emit(&app, instance_id, "cliente", 61, "Advertencia: client.jar sin Main.class; reintentar descarga");
                        // Forzar una redescarga limpia
                        let _ = std::fs::remove_file(&client_path);
                        download_file(
                            &downloads.client.url, 
                            &client_path, 
                            Some(&downloads.client.sha1)
                        )?;
                    }
                }
            }
        }
        classpath_entries.push(client_path);
    } else {
         return Err("No client download information found (missing downloads section)".to_string());
    }
    emit(&app, instance_id, "cliente", 60, "Cliente descargado");

    // 5. Download Assets
    if let Some(asset_index_ref) = &version_info.asset_index {
        let asset_index_path = assets_dir.join("indexes").join(format!("{}.json", asset_index_ref.id));
        download_file(
            &asset_index_ref.url, 
            &asset_index_path, 
            Some(&asset_index_ref.sha1)
        )?;

        let asset_index: AssetIndex = serde_json::from_str(
            &fs::read_to_string(&asset_index_path).map_err(|e| e.to_string())?
        ).map_err(|e| e.to_string())?;

        emit(&app, instance_id, "assets", 60, "Descargando assets");
        download_assets_parallel(&assets_dir, &asset_index, &app, instance_id)?;
    } else {
        return Err("No asset index found".to_string());
    }
    emit(&app, instance_id, "assets", 75, "Assets descargados");

    // 6. Mods Management (download/extract)
    let mods_dir = minecraft_dir.join("mods");
    let _ = fs::create_dir_all(&mods_dir);

    // Check if mods exist (optional check for future use)
    let mut _has_mods = false;
    if let Ok(entries) = fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) == Some("jar") {
                _has_mods = true;
                break;
            }
        }
    }

    if let Some(url) = &modpack_url {
        if !url.is_empty() {
            // Modpack logic
            let zip_path = minecraft_dir.join("modpack.zip");
            let mods_dir = minecraft_dir.join("mods");
            
            // Check if we already have mods installed
            let has_installed_mods = if let Ok(entries) = fs::read_dir(&mods_dir) {
                entries.count() > 0
            } else {
                false
            };

            let mut should_download = !zip_path.exists();
            let mut should_extract = false;

            // Update Logic: Check for size changes if file exists
            if zip_path.exists() {
                // Check remote size (Optimized HEAD request)
                if let Ok(client) = reqwest::blocking::Client::builder().user_agent("DrkLauncher/1.0").timeout(std::time::Duration::from_secs(5)).build() {
                     if let Ok(resp) = client.head(url).send() {
                         if let Some(remote_len) = resp.content_length() {
                             if let Ok(meta) = fs::metadata(&zip_path) {
                                 if meta.len() != remote_len {
                                     emit(&app, instance_id, "mods", 5, "Actualización de modpack detectada...");
                                     should_download = true;
                                     // Remove old zip to ensure clean download
                                     let _ = fs::remove_file(&zip_path);
                                 }
                             }
                         }
                     }
                }
            }

            if should_download {
                 emit(&app, instance_id, "mods", 80, "Descargando modpack...");
                 
                 // Fix common URL issues (Dropbox)
                 let fixed_url = if url.contains("dropbox.com") && url.contains("?dl=0") {
                     url.replace("?dl=0", "?dl=1")
                 } else if url.contains("dropbox.com") && !url.contains("?dl=") {
                     format!("{}?dl=1", url)
                 } else {
                     url.clone()
                 };
                 
                 download_file(&fixed_url, &zip_path, None)?;
                 should_extract = true;
            }
            
            // Extract if:
            // 1. We just downloaded it (should_extract = true)
            // 2. Or user requested Force Update
            // 3. Or we have the zip but NO mods installed (first run or deleted mods)
            if force_update || (!has_installed_mods && zip_path.exists()) {
                should_extract = true;
            }
            
            if should_extract && zip_path.exists() {
                 emit(&app, instance_id, "mods", 81, "Sincronizando archivos del modpack...");
                 let folders_to_clean = ["mods", "config", "scripts", "kubejs", "defaultconfigs"];
                 for folder in folders_to_clean {
                     // Clean inside minecraft_dir
                     let target_path = minecraft_dir.join(folder);
                     if target_path.exists() {
                         let _ = fs::remove_dir_all(&target_path);
                     }
                 }

                 emit(&app, instance_id, "mods", 82, "Extrayendo modpack...");
                 let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
                 let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
                 
                 for i in 0..archive.len() {
                    let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
                    let name = f.name().to_string();
                    
                    // Exclude metadata files
                    if name == "manifest.json" || name == "modlist.html" || name == "instance.cfg" || name.ends_with("/") {
                        continue;
                    }

                    // Determine target path relative to MINECRAFT_DIR
                    let target_path = if name.starts_with("overrides/") {
                        minecraft_dir.join(name.strip_prefix("overrides/").unwrap())
                    } else {
                        if name.starts_with("mods/") || name.ends_with(".jar") {
                            if !name.contains('/') || name.starts_with("mods/") {
                                minecraft_dir.join(&name)
                            } else {
                                minecraft_dir.join(&name)
                            }
                        } else {
                            minecraft_dir.join(&name)
                        }
                    };

                    // Special case: Flat jars at root of zip -> go to mods/
                    let final_path = if !name.contains('/') && name.ends_with(".jar") && !name.starts_with("overrides/") {
                         minecraft_dir.join("mods").join(&name)
                    } else {
                         target_path
                    };

                    if let Some(p) = final_path.parent() { let _ = fs::create_dir_all(p); }
                    
                    let mut out_file = std::fs::File::create(&final_path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut f, &mut out_file).map_err(|e| e.to_string())?;
                }
            } else if zip_path.exists() {
                // Si ya existe el zip y NO estamos forzando update ni extrayendo, asumimos que está listo
                emit(&app, instance_id, "mods", 90, "Modpack verificado");
            }
        }
    }

    if let Some(urls) = &mods_urls {
        emit(&app, instance_id, "mods", 80, "Iniciando descarga de mods...");
        download_mods_parallel(urls, &mods_dir, &app, instance_id)?;
    }
    emit(&app, instance_id, "mods", 90, "Mods listos");

    // 7. Build Arguments
    let required_java = version_info
        .java_version
        .as_ref()
        .map(|v| v.major_version)
        .unwrap_or_else(|| get_required_java_version(version_id));
    
    let java_path = match get_java_path_for_major(required_java) {
        Ok(path) => path,
        Err(_) => {
            // Try to download
            emit(&app, instance_id, "java", 0, &format!("Descargando Java {}", required_java));
            let path_str = download_java(required_java, app.as_ref(), Some(instance_id))?;
            PathBuf::from(path_str)
        }
    };
    
    let mut cmd = Command::new(java_path.clone());
    
    // JVM Args - Optimized based on Plan_Nuevo (JavaConfigService.ts)
    let min_mem = std::cmp::max(512, ram_mb / 4);
    
    // CRÍTICO: Desbloquear opciones experimentales PRIMERO
    cmd.arg("-XX:+UnlockExperimentalVMOptions");
    
    // Memoria
    cmd.arg(format!("-Xms{}M", min_mem));
    cmd.arg(format!("-Xmx{}M", ram_mb));
    
    // Garbage Collector (G1GC)
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
    
    // CodeCache aumentado (OBLIGATORIO para mods)
    cmd.arg("-XX:ReservedCodeCacheSize=768M");
    cmd.arg("-XX:InitialCodeCacheSize=128M");
    
    // Optimizaciones de memoria y rendimiento
    cmd.arg("-XX:+ParallelRefProcEnabled");
    cmd.arg("-XX:+DisableExplicitGC");
    cmd.arg("-XX:+AlwaysPreTouch");
    cmd.arg("-XX:+UseStringDeduplication");
    cmd.arg("-XX:+UseCompressedOops");
    cmd.arg("-XX:+UseCompressedClassPointers");
    cmd.arg("-XX:+PerfDisableSharedMem");
    
    // Optimizaciones de red y I/O
    cmd.arg("-Djava.net.preferIPv4Stack=true");
    cmd.arg("-Dfile.encoding=UTF-8");
    
    // Optimizaciones de renderizado y Forge
    cmd.arg("-Dfml.ignoreInvalidMinecraftCertificates=true");
    cmd.arg("-Dfml.ignorePatchDiscrepancies=true");
    cmd.arg("-Dfml.earlyprogresswindow=false");
    cmd.arg("-Dfml.earlyWindowControl=false");
    cmd.arg("-Dforge.logging.console.level=info");
    cmd.arg("-Djava.awt.headless=false");

    // Expanded ignoreList to resolve common module conflicts in Forge 1.17+
    // Only apply for Forge to avoid potential side effects on other loaders
    if matches!(loader.as_deref(), Some("forge")) {
        // No incluir módulos críticos de Forge en ignoreList (bootstraplauncher, modlauncher, securejarhandler)
        // Mantener solo bibliotecas de terceros conocidas que causan conflictos cuando están duplicadas
        cmd.arg("-DignoreList=asm-commons,asm-util,asm-analysis,asm-tree,asm,javassist,commons-compress,commons-io,httpclient,httpcore,netty-handler,netty-buffer,netty-common,netty-codec,netty-transport,netty-resolver,fastutil,jna,oshi-core,gson,guava,slf4j-api,log4j-api,log4j-core,org.jetbrains.annotations,annotations,kotlin-stdlib,kotlin-stdlib-jdk8,kotlin-stdlib-jdk7,mixin,sponge-mixin,commons-lang3,commons-logging,jakarta.activation,jakarta.xml.bind");
    }
    
    // Fix for Java 16+ reflection restrictions (Forge/Fabric)
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

    cmd.arg(format!("-Djava.library.path={}", natives_dir.to_string_lossy()));
    cmd.arg("-Dminecraft.launcher.brand=drklauncher");
    cmd.arg("-Dminecraft.launcher.version=1.0");

    let java_major = get_system_java_version(&java_path.to_string_lossy()).unwrap_or(required_java);
    if java_major >= 21 && matches!(loader.as_deref(), Some("forge") | Some("fabric")) {
        cmd.arg("--enable-native-access=ALL-UNNAMED");
    }

    // Log Config (if available)
    if let Some(logging) = &version_info.logging {
        if let Some(client_logging) = &logging.client {
             if let Some(file) = &client_logging.file {
                 let log_config_path = assets_dir.join("log_configs").join(&file.id);
                 if !log_config_path.exists() {
                     // Try to download log config
                     if let Some(url) = &file.url {
                         if let Some(parent) = log_config_path.parent() {
                             let _ = fs::create_dir_all(parent);
                         }
                         let _ = download_file(url, &log_config_path, Some(&file.sha1));
                     }
                 }
                 if log_config_path.exists() {
                     if let Some(arg) = &client_logging.argument {
                         cmd.arg(arg.replace("${path}", &log_config_path.to_string_lossy()));
                     }
                 }
             }
        }
    }
    
    let asset_index_id = version_info.asset_index.as_ref().map(|a| a.id.as_str()).unwrap_or("legacy");

    // Write arguments to a file to avoid command line length limits and character escaping issues
    let args_file_path = minecraft_dir.join("args.txt");
    let mut args_content = String::new();

    // Force disable early window in args.txt as requested
    if matches!(loader.as_deref(), Some("forge")) {
        args_content.push_str("-Dfml.earlyprogresswindow=false\n");
        args_content.push_str("-Dfml.earlyWindowControl=false\n");
        args_content.push_str("-Dforge.logging.console.level=info\n");
    }

    // JVM Args from version info
    let mut module_path_libs = std::collections::HashSet::new();
    let mut module_path_seen_artifacts: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let mut module_path_seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut is_module_path_val = false;
    let mut module_path_values: Vec<String> = Vec::new();

    // Build library map for smart filtering
    let mut library_map: std::collections::HashMap<String, MavenName> = std::collections::HashMap::new();
    for lib in &version_info.libraries {
        if let Some(maven) = parse_maven_name(&lib.name) {
            // Calculate potential paths for this library
            if let Some(path_str) = maven_path(&maven) {
                let full_path = libraries_dir.join(path_str);
                library_map.insert(normalize_path_for_comparison(&full_path), maven.clone());
            }
            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    if let Some(path_str) = &artifact.path {
                        let full_path = libraries_dir.join(path_str);
                        library_map.insert(normalize_path_for_comparison(&full_path), maven.clone());
                    }
                }
            }
        }
    }

    if let Some(args) = &version_info.arguments {
        if let Some(jvm_args) = &args.jvm {
            let mut skip_next = false;
            for arg in jvm_args {
                match arg {
                    Argument::Simple(s) => {
                        if skip_next { skip_next = false; continue; }
                        if s == "-cp" { skip_next = true; continue; }
                        if s == "${classpath}" { continue; }
                        if s.starts_with("-DignoreList=") { continue; }
                        
                        let val = replace_vars(s, auth, &effective_version_id, &assets_dir, &minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                        if val.starts_with("-DignoreList=") { continue; }
                        
                        if is_module_path_val {
                            let sep = if get_os_name() == "windows" { ";" } else { ":" };
                            let mut filtered = Vec::new();
                            for p in val.split(sep) {
                                let norm = normalize_path_for_comparison(&std::path::PathBuf::from(p));
                                if let Some(maven) = library_map.get(&norm) {
                                    let key = (maven.group.clone(), maven.artifact.clone());
                                    if module_path_seen_artifacts.insert(key) {
                                        filtered.push(p.to_string());
                                        module_path_libs.insert(norm);
                                    }
                                } else {
                                    if module_path_seen_paths.insert(norm.clone()) {
                                        filtered.push(p.to_string());
                                        module_path_libs.insert(norm);
                                    }
                                }
                            }
                            let filtered_val = filtered.join(sep);
                            args_content.push_str(&format!("{}\n", escape_arg(&filtered_val)));
                            module_path_values.extend(filtered);
                            is_module_path_val = false;
                            continue;
                        } else if s == "-p" || s == "--module-path" {
                            is_module_path_val = true;
                        }

                        args_content.push_str(&format!("{}\n", escape_arg(&val)));
                    }
                    Argument::Complex(c) => {
                        if check_rules(&Some(c.rules.clone())) {
                            match &c.value {
                                ArgumentValue::Single(s) => {
                                    if skip_next { skip_next = false; continue; }
                                    if s == "-cp" { skip_next = true; continue; }
                                    if s == "${classpath}" { continue; }
                                    if s.starts_with("-DignoreList=") { continue; }
                                    
                                    let val = replace_vars(s, auth, &effective_version_id, &assets_dir, &minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                                    if val.starts_with("-DignoreList=") { continue; }
                                    
                                    if is_module_path_val {
                                        let sep = if get_os_name() == "windows" { ";" } else { ":" };
                                        let mut filtered = Vec::new();
                                        for p in val.split(sep) {
                                            let norm = normalize_path_for_comparison(&std::path::PathBuf::from(p));
                                            if let Some(maven) = library_map.get(&norm) {
                                                let key = (maven.group.clone(), maven.artifact.clone());
                                                if module_path_seen_artifacts.insert(key) {
                                                    filtered.push(p.to_string());
                                                    module_path_libs.insert(norm);
                                                }
                                            } else {
                                                if module_path_seen_paths.insert(norm.clone()) {
                                                    filtered.push(p.to_string());
                                                    module_path_libs.insert(norm);
                                                }
                                            }
                                        }
                                        let filtered_val = filtered.join(sep);
                                        args_content.push_str(&format!("{}\n", escape_arg(&filtered_val)));
                                        module_path_values.extend(filtered);
                                        is_module_path_val = false;
                                        continue;
                                    } else if s == "-p" || s == "--module-path" {
                                        is_module_path_val = true;
                                    }

                                    args_content.push_str(&format!("{}\n", escape_arg(&val)));
                                }
                                ArgumentValue::Multiple(vec) => {
                                    for s in vec {
                                        if skip_next { skip_next = false; continue; }
                                        if s == "-cp" { skip_next = true; continue; }
                                        if s == "${classpath}" { continue; }
                                        if s.starts_with("-DignoreList=") { continue; }
                                        
                                        let val = replace_vars(s, auth, &effective_version_id, &assets_dir, &minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                                        if val.starts_with("-DignoreList=") { continue; }
                                        
                                        if is_module_path_val {
                                            let sep = if get_os_name() == "windows" { ";" } else { ":" };
                                            let mut filtered = Vec::new();
                                            for p in val.split(sep) {
                                                let norm = normalize_path_for_comparison(&std::path::PathBuf::from(p));
                                                if let Some(maven) = library_map.get(&norm) {
                                                    let key = (maven.group.clone(), maven.artifact.clone());
                                                    if module_path_seen_artifacts.insert(key) {
                                                        filtered.push(p.to_string());
                                                        module_path_libs.insert(norm);
                                                    }
                                                } else {
                                                    if module_path_seen_paths.insert(norm.clone()) {
                                                        filtered.push(p.to_string());
                                                        module_path_libs.insert(norm);
                                                    }
                                                }
                                            }
                                            let filtered_val = filtered.join(sep);
                                            args_content.push_str(&format!("{}\n", escape_arg(&filtered_val)));
                                            module_path_values.extend(filtered);
                                            is_module_path_val = false;
                                            continue;
                                        } else if s == "-p" || s == "--module-path" {
                                            is_module_path_val = true;
                                        }

                                        args_content.push_str(&format!("{}\n", escape_arg(&val)));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Ensure essential Forge modules are present on module-path
    let mp_sep = if get_os_name() == "windows" { ";" } else { ":" };
    let mut module_path_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    for v in &module_path_values {
        module_path_set.insert(v.clone());
    }
    for (_, maven) in &library_map {
        if maven.group == "cpw.mods" && (maven.artifact == "securejarhandler" || maven.artifact == "modlauncher" || maven.artifact == "bootstraplauncher") {
            if let Some(rel) = maven_path(maven) {
                let full = libraries_dir.join(rel).to_string_lossy().to_string();
                if !module_path_set.contains(&full) {
                    module_path_set.insert(full);
                }
            }
        }
    }
    // Validate presence on disk; attempt download from Forge Maven if missing
    for v in module_path_set.clone() {
        let full_path = std::path::PathBuf::from(&v);
        if !full_path.exists() {
            // Forge core modules are hosted on Forge Maven
            let rel = if let Ok(stripped) = full_path.strip_prefix(&libraries_dir) {
                stripped.to_string_lossy().replace('\\', "/")
            } else {
                continue;
            };
            let url = format!("https://maven.minecraftforge.net/{}", rel);
            let _ = download_file(&url, &full_path, None);
        }
    }
    if !module_path_set.is_empty() {
        let final_mp = module_path_set.into_iter().collect::<Vec<_>>().join(mp_sep);
        args_content.push_str("-p\n");
        args_content.push_str(&format!("{}\n", escape_arg(&final_mp)));
    }

    // Classpath
    let cp_sep = if get_os_name() == "windows" { ";" } else { ":" };
    let mut unique_entries = std::collections::HashSet::new();
    let mut final_classpath = Vec::new();
    
    // Identify artifacts on module path
    let mut module_path_artifacts = std::collections::HashSet::new();
    for path in &module_path_libs {
        if let Some(maven) = library_map.get(path) {
            module_path_artifacts.insert((maven.group.clone(), maven.artifact.clone()));
        }
    }

    // HARD BLACKLIST for Forge 1.17+ Classpath
    // These libraries MUST NOT be in the classpath because they are handled by ModulePath
    let forge_classpath_blacklist = [
        "asm", "asm-commons", "asm-tree", "asm-util", "asm-analysis", 
        "java-objc-bridge", "jna", "oshi-core",
        "sponge-mixin", "mixin", "jakarta.activation", "jakarta.xml.bind"
    ];

    for entry in classpath_entries {
        if unique_entries.insert(entry.clone()) {
            let normalized_entry = normalize_path_for_comparison(&entry);
            
            // Smart Filter: Check if library is on module path (by exact path OR by artifact identity)
            let is_on_module_path = module_path_libs.contains(&normalized_entry);
            
            let is_artifact_conflict = if let Some(maven) = library_map.get(&normalized_entry) {
                module_path_artifacts.contains(&(maven.group.clone(), maven.artifact.clone()))
            } else {
                false
            };

            // Hard Blacklist Check for Forge
            let is_blacklisted = if matches!(loader.as_deref(), Some("forge")) {
                let file_name = entry.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                forge_classpath_blacklist.iter().any(|&b| file_name.contains(b))
            } else {
                false
            };

            // Always include bootstraplauncher in classpath to ensure main class is resolvable
            let force_include_bootstrap = {
                let file_name = entry.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                if file_name.contains("bootstraplauncher") {
                    true
                } else {
                    if let Some(maven) = library_map.get(&normalized_entry) {
                        maven.group == "cpw.mods" && maven.artifact == "bootstraplauncher"
                    } else {
                        false
                    }
                }
            };

            if force_include_bootstrap || (!is_on_module_path && !is_artifact_conflict && !is_blacklisted) {
                final_classpath.push(entry);
            }
        }
    }

    // Ensure bootstraplauncher jar is present on classpath even if not in classpath_entries
    if matches!(loader.as_deref(), Some("forge")) {
        for (_, maven) in &library_map {
            if maven.group == "cpw.mods" && maven.artifact == "bootstraplauncher" {
                if let Some(rel) = maven_path(maven) {
                    let full = libraries_dir.join(rel);
                    let full_norm = normalize_path_for_comparison(&full);
                    let exists_in_cp = final_classpath.iter().any(|p| normalize_path_for_comparison(p) == full_norm);
                    if !exists_in_cp {
                        final_classpath.push(full);
                    }
                }
            }
        }

        let mut fmlloader_target: Option<std::path::PathBuf> = None;
        for (_, maven) in &library_map {
            if maven.group == "net.minecraftforge" && maven.artifact == "fmlloader" {
                if let Some(rel) = maven_path(maven) {
                    fmlloader_target = Some(libraries_dir.join(rel));
                    break;
                }
            }
        }
        if let Some(target) = fmlloader_target {
            if !target.exists() {
                if let Ok(stripped) = target.strip_prefix(&libraries_dir) {
                    let rel = stripped.to_string_lossy().replace('\\', "/");
                    let url = format!("https://maven.minecraftforge.net/{}", rel);
                    let _ = download_file(&url, &target, None);
                }
            }
            let target_norm = normalize_path_for_comparison(&target);
            let exists_in_cp = final_classpath.iter().any(|p| normalize_path_for_comparison(p) == target_norm);
            if !exists_in_cp {
                final_classpath.push(target);
            }
        }
    }
    if loader.as_deref().map(|l| l == "vanilla").unwrap_or(true) {
        // Prefer com.mojang:minecraft jar if present in libraries
        let mut mojang_minecraft: Option<std::path::PathBuf> = None;
        for (_, maven) in &library_map {
            if maven.group == "com.mojang" && maven.artifact == "minecraft" {
                if let Some(rel) = maven_path(maven) {
                    mojang_minecraft = Some(libraries_dir.join(rel));
                    break;
                }
            }
        }
        if let Some(pref) = mojang_minecraft {
            let pref_norm = normalize_path_for_comparison(&pref);
            if let Some(pos) = final_classpath.iter().position(|p| normalize_path_for_comparison(p) == pref_norm) {
                if pos != 0 {
                    let p = final_classpath.remove(pos);
                    final_classpath.insert(0, p);
                }
            } else {
                final_classpath.insert(0, pref);
            }
        } else {
            // Fallback: ensure client.jar is first
            let client_first = versions_dir.join(&effective_version_id).join(format!("{}.jar", &effective_version_id));
            let client_norm = normalize_path_for_comparison(&client_first);
            if let Some(pos) = final_classpath.iter().position(|p| normalize_path_for_comparison(p) == client_norm) {
                if pos != 0 {
                    let p = final_classpath.remove(pos);
                    final_classpath.insert(0, p);
                }
            }
        }
    }
    
    let cp_str = final_classpath.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(cp_sep);
    
    args_content.push_str("-cp\n");
    args_content.push_str(&format!("{}\n", escape_arg(&cp_str)));
    
    // For Forge, prefer BootstrapLauncher as main class to avoid fmlloader resolution issues
    let effective_main_class = if matches!(loader.as_deref(), Some("forge")) {
        "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string()
    } else {
        version_info.main_class.clone()
    };
    args_content.push_str(&format!("{}\n", escape_arg(&effective_main_class)));

    // Game Args
    if let Some(w) = width {
        args_content.push_str(&format!("--width\n{}\n", w));
    } else {
        args_content.push_str("--width\n854\n");
    }

    if let Some(h) = height {
        args_content.push_str(&format!("--height\n{}\n", h));
    } else {
        args_content.push_str("--height\n480\n");
    }

    if let Some(args) = &version_info.arguments {
        if let Some(game_args) = &args.game {
            let mut skip_next = false;
            for arg in game_args {
                match arg {
                    Argument::Simple(s) => {
                        if skip_next { skip_next = false; continue; }
                        if s == "--demo" { continue; }
                        if s == "--width" || s == "--height" { skip_next = true; continue; }
                        if s == "${resolution_width}" || s == "${resolution_height}" { continue; }

                        let val = replace_vars(s, auth, &effective_version_id, &assets_dir, &minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                        args_content.push_str(&format!("{}\n", escape_arg(&val)));
                    }
                    Argument::Complex(c) => {
                        if check_rules(&Some(c.rules.clone())) {
                            match &c.value {
                                ArgumentValue::Single(s) => {
                                    if skip_next { skip_next = false; continue; }
                                    if s == "--demo" { continue; }
                                    if s == "--width" || s == "--height" { skip_next = true; continue; }
                                    if s == "${resolution_width}" || s == "${resolution_height}" { continue; }

                                    let val = replace_vars(s, auth, &effective_version_id, &assets_dir, &minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                                    args_content.push_str(&format!("{}\n", escape_arg(&val)));
                                }
                                ArgumentValue::Multiple(vec) => {
                                    for s in vec {
                                        if skip_next { skip_next = false; continue; }
                                        if s == "--demo" { continue; }
                                        if s == "--width" || s == "--height" { skip_next = true; continue; }
                                        if s == "${resolution_width}" || s == "${resolution_height}" { continue; }

                                        let val = replace_vars(s, auth, &effective_version_id, &assets_dir, &minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                                        args_content.push_str(&format!("{}\n", escape_arg(&val)));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    } else if let Some(legacy_args) = &version_info.minecraft_arguments {
        let mut skip_next = false;
        for part in legacy_args.split_whitespace() {
            if skip_next { skip_next = false; continue; }
            if part == "--demo" { continue; }
            if part == "--width" || part == "--height" { skip_next = true; continue; }
            if part == "${resolution_width}" || part == "${resolution_height}" { continue; }

            let val = replace_vars(part, auth, &effective_version_id, &assets_dir, &minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
            args_content.push_str(&format!("{}\n", escape_arg(&val)));
        }
    }

    // Write args file
    let _ = fs::write(&args_file_path, args_content);
    
    // Add args file to command
    cmd.arg(format!("@{}", args_file_path.to_string_lossy()));

    cmd.current_dir(&minecraft_dir);
    
    // Debug: Print command to stdout
    println!("Launching command: {:?}", cmd);

    emit(&app, instance_id, "listo", 95, "Preparación completa");
    Ok(cmd)
}



fn download_libraries_parallel(
    version_info: &VersionInfo,
    libraries_dir: &Path,
    natives_dir: &Path,
    app: &Option<AppHandle>,
    instance_id: &str
) -> Result<Vec<PathBuf>, String> {
    let tasks: Arc<Mutex<VecDeque<(String, PathBuf, Option<String>, bool)>>> = Arc::new(Mutex::new(VecDeque::new()));
    let mut classpath_entries = Vec::new();
    let mut total_libs = 0u64;

    for lib in &version_info.libraries {
        if !check_rules(&lib.rules) {
            continue;
        }
        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                if let Some(path_str) = &artifact.path {
                    total_libs += 1;
                    classpath_entries.push(libraries_dir.join(path_str));
                    tasks.lock().map_err(|_| "Failed to lock tasks".to_string())?
                        .push_back((artifact.url.clone(), libraries_dir.join(path_str), Some(artifact.sha1.clone()), false));
                }
            }
            if let Some(classifiers) = &downloads.classifiers {
                let os = get_os_name();
                if let Some(natives_map) = &lib.natives {
                    if let Some(classifier_key) = natives_map.get(os) {
                        let arch = get_arch();
                        let key = classifier_key.replace("${arch}", if arch == "x86" { "32" } else { "64" });
                        if let Some(artifact) = classifiers.get(&key) {
                            if let Some(path_str) = &artifact.path {
                                total_libs += 1;
                                tasks.lock().map_err(|_| "Failed to lock tasks".to_string())?
                                    .push_back((artifact.url.clone(), libraries_dir.join(path_str), Some(artifact.sha1.clone()), true));
                            }
                        }
                    }
                }
            }
        } else if let Some(maven) = parse_maven_name(&lib.name) {
            let base_url = lib.url.clone().unwrap_or_else(|| "https://libraries.minecraft.net/".to_string());
            if let Some(path_str) = maven_path(&maven) {
                let url = format!("{}{}", ensure_trailing_slash(&base_url), path_str);
                let is_native = maven.classifier.as_deref().map(|c| c.contains("natives")).unwrap_or(false);
                total_libs += 1;
                if !is_native {
                    classpath_entries.push(libraries_dir.join(&path_str));
                }
                tasks.lock().map_err(|_| "Failed to lock tasks".to_string())?
                    .push_back((url, libraries_dir.join(path_str), None, is_native));
            }
            if let Some(natives_map) = &lib.natives {
                let os = get_os_name();
                if let Some(classifier_key) = natives_map.get(os) {
                    let arch = get_arch();
                    let classifier = classifier_key.replace("${arch}", if arch == "x86" { "32" } else { "64" });
                    let mut native_maven = maven.clone();
                    native_maven.classifier = Some(classifier);
                    if let Some(native_path) = maven_path(&native_maven) {
                        let url = format!("{}{}", ensure_trailing_slash(&base_url), native_path);
                        total_libs += 1;
                        tasks.lock().map_err(|_| "Failed to lock tasks".to_string())?
                            .push_back((url, libraries_dir.join(native_path), None, true));
                    }
                }
            }
        }
    }

    if total_libs == 0 {
        return Ok(classpath_entries);
    }

    let done = Arc::new(AtomicU64::new(0));
    let error = Arc::new(Mutex::new(None::<String>));
    let workers = 10usize;
    let mut handles = Vec::new();

    for _ in 0..workers {
        let tasks = Arc::clone(&tasks);
        let done = Arc::clone(&done);
        let error = Arc::clone(&error);
        let app = app.clone();
        let instance_id = instance_id.to_string();
        let natives_dir = natives_dir.to_path_buf();
        handles.push(std::thread::spawn(move || {
            loop {
                if error.lock().ok().and_then(|e| e.clone()).is_some() {
                    break;
                }
                let task = {
                    let mut guard = match tasks.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                    guard.pop_front()
                };
                let (url, path, hash, extract) = match task {
                    Some(t) => t,
                    None => break,
                };
                let download_res = if let Some(hash) = &hash {
                    download_file(&url, &path, Some(hash))
                } else {
                    download_file(&url, &path, None)
                };
                if let Err(e) = download_res {
                    if let Ok(mut guard) = error.lock() {
                        if guard.is_none() {
                            *guard = Some(e);
                        }
                    }
                    break;
                }
                if extract {
                    if let Err(e) = extract_natives(&path, &natives_dir) {
                        if let Ok(mut guard) = error.lock() {
                            if guard.is_none() {
                                *guard = Some(e);
                            }
                        }
                        break;
                    }
                }
                let current = done.fetch_add(1, Ordering::SeqCst) + 1;
                if current % 10 == 0 || current == total_libs {
                    let percent = 20 + ((current * 30) / total_libs) as u8;
                    let msg = format!("Verificando librerías {}/{}", current, total_libs);
                    emit(&app, &instance_id, "librerias", percent, &msg);
                }
            }
        }));
    }

    for handle in handles {
        let _ = handle.join();
    }

    if let Ok(guard) = error.lock() {
        if let Some(err) = guard.clone() {
            return Err(err);
        }
    }

    Ok(classpath_entries)
}

pub fn download_assets_parallel(
    assets_dir: &Path,
    asset_index: &AssetIndex,
    app: &Option<AppHandle>,
    instance_id: &str
) -> Result<(), String> {
    let total = asset_index.objects.len() as u64;
    if total == 0 {
        return Ok(());
    }
    let tasks = Arc::new(Mutex::new(VecDeque::new()));
    for (_name, object) in &asset_index.objects {
        let hash_head = &object.hash[0..2];
        let object_path = assets_dir.join("objects").join(hash_head).join(&object.hash);
        let url = format!("{}/{}/{}", RESOURCES_URL, hash_head, object.hash);
        tasks.lock().map_err(|_| "Failed to lock tasks".to_string())?
            .push_back((url, object_path, object.hash.clone()));
    }

    let done = Arc::new(AtomicU64::new(0));
    let error = Arc::new(Mutex::new(None::<String>));
    let workers = 24usize;
    let mut handles = Vec::new();

    for _ in 0..workers {
        let tasks = Arc::clone(&tasks);
        let done = Arc::clone(&done);
        let error = Arc::clone(&error);
        let app = app.clone();
        let instance_id = instance_id.to_string();
        handles.push(std::thread::spawn(move || {
            loop {
                if error.lock().ok().and_then(|e| e.clone()).is_some() {
                    break;
                }
                let task = {
                    let mut guard = match tasks.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                    guard.pop_front()
                };
                let (url, path, hash) = match task {
                    Some(t) => t,
                    None => break,
                };
                if let Err(e) = download_file(&url, &path, Some(&hash)) {
                    if let Ok(mut guard) = error.lock() {
                        if guard.is_none() {
                            *guard = Some(e);
                        }
                    }
                    break;
                }
                let current = done.fetch_add(1, Ordering::SeqCst) + 1;
                if current % 50 == 0 || current == total {
                    let percent = 60 + ((current * 15) / total) as u8;
                    let msg = format!("Verificando assets {}/{}", current, total);
                    emit(&app, &instance_id, "assets", percent, &msg);
                }
            }
        }));
    }

    for handle in handles {
        let _ = handle.join();
    }

    if let Ok(guard) = error.lock() {
        if let Some(err) = guard.clone() {
            return Err(err);
        }
    }
    Ok(())
}

pub fn load_fabric_profile_info(mc_version: &str) -> Result<VersionInfo, String> {
    // Get latest stable loader for this MC version
    let list: serde_json::Value = reqwest::blocking::get(
        &format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version)
    )
        .map_err(|e| format!("Failed to fetch fabric loader list: {}", e))?
        .json()
        .map_err(|e| format!("Failed to parse fabric loader list: {}", e))?;

    let loader_version = list.as_array()
        .and_then(|arr| arr.iter().find(|item| item["loader"]["stable"].as_bool().unwrap_or(true)))
        .and_then(|item| item["loader"]["version"].as_str())
        .ok_or("No fabric loader version found")?;

    // Fetch profile JSON
    let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
        mc_version, loader_version
    );

    let json_text = reqwest::blocking::get(&url)
        .map_err(|e| format!("Failed to fetch fabric profile: {}", e))?
        .text()
        .map_err(|e| e.to_string())?;

    let info: VersionInfo = serde_json::from_str(&json_text).map_err(|e| e.to_string())?;
    Ok(info)
}

fn deduplicate_libraries(libs: Vec<Library>) -> Vec<Library> {
    let mut seen = std::collections::HashMap::new();
    let mut result = Vec::new();
    
    // Iterate in reverse to keep the "latest" (child overrides parent)
    for lib in libs.into_iter().rev() {
        if let Some(maven) = parse_maven_name(&lib.name) {
            // Key includes classifier to distinguish natives
            let key = format!("{}:{}:{}", maven.group, maven.artifact, maven.classifier.unwrap_or_default());
            if !seen.contains_key(&key) {
                seen.insert(key, true);
                result.push(lib);
            }
        } else {
             // Fallback for non-standard names
             if !seen.contains_key(&lib.name) {
                 seen.insert(lib.name.clone(), true);
                 result.push(lib);
             }
        }
    }
    
    result.reverse();
    result
}

pub fn resolve_complete_version_info(
    version_id: &str,
    versions_dir: &Path,
    manifest: &VersionManifest
) -> Result<VersionInfo, String> {
    // 1. Load current version info (local or remote)
    let mut current_info = load_version_info(version_id, versions_dir, manifest)?;

    // 2. Check inheritance
    if let Some(parent_id) = &current_info.inherits_from {
        let parent_info = resolve_complete_version_info(parent_id, versions_dir, manifest)?;
        
        // 3. Merge Libraries (Append child libs to parent libs)
        let mut merged_libs = parent_info.libraries.clone();
        merged_libs.extend(current_info.libraries);
        current_info.libraries = deduplicate_libraries(merged_libs);

        // 4. Merge Arguments
        if current_info.arguments.is_none() {
            current_info.arguments = parent_info.arguments;
        } else if let Some(parent_args) = parent_info.arguments {
             if let Some(mut child_args) = current_info.arguments {
                 // Merge Game Args
                 if let Some(parent_game) = parent_args.game {
                     let mut new_game = parent_game;
                     if let Some(child_game) = child_args.game {
                         new_game.extend(child_game);
                     }
                     child_args.game = Some(new_game);
                 }
                 // Merge JVM Args (if any)
                 if let Some(parent_jvm) = parent_args.jvm {
                     let mut new_jvm = parent_jvm;
                     if let Some(child_jvm) = child_args.jvm {
                         new_jvm.extend(child_jvm);
                     }
                     child_args.jvm = Some(new_jvm);
                 }
                 current_info.arguments = Some(child_args);
             }
        }
        
        if current_info.minecraft_arguments.is_none() {
            current_info.minecraft_arguments = parent_info.minecraft_arguments;
        }

        if current_info.asset_index.is_none() {
            current_info.asset_index = parent_info.asset_index;
        }
        
        if current_info.assets.is_none() {
            current_info.assets = parent_info.assets;
        }
        
        if current_info.downloads.is_none() {
            current_info.downloads = parent_info.downloads;
        }
        
        if current_info.java_version.is_none() {
            current_info.java_version = parent_info.java_version;
        }
    }

    Ok(current_info)
}

fn load_version_info(version_id: &str, versions_dir: &Path, manifest: &VersionManifest) -> Result<VersionInfo, String> {
    let version_json_path = versions_dir.join(version_id).join(format!("{}.json", version_id));
    
    if version_json_path.exists() {
        let content = fs::read_to_string(&version_json_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        let version_entry = manifest.versions.iter().find(|v| v.id == version_id)
            .ok_or(format!("Version {} not found in manifest or locally", version_id))?;
            
        let client = reqwest::blocking::Client::builder()
            .user_agent("DrkLauncher/1.0")
            .build()
            .map_err(|e| format!("Failed to build http client: {}", e))?;

        let info: VersionInfo = client.get(&version_entry.url)
            .send()
            .map_err(|e| format!("Failed to fetch version info: {}", e))?
            .json()
            .map_err(|e| format!("Failed to parse version info: {}", e))?;
        
        if let Some(p) = version_json_path.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&info).unwrap();
        fs::write(&version_json_path, json).map_err(|e| e.to_string())?;
        Ok(info)
    }
}

pub fn ensure_forge_installed(
    base_path: &Path,
    mc_version: &str,
    app: &Option<AppHandle>,
    instance_id: &str
) -> Result<String, String> {
    let forge_version = get_forge_recommended_version(mc_version)?;
    let versions_dir = base_path.join("versions");
    let candidates = [
        format!("{}-forge-{}", mc_version, forge_version),
        format!("forge-{}-{}", mc_version, forge_version),
    ];
    for candidate in &candidates {
        let json_path = versions_dir.join(candidate).join(format!("{}.json", candidate));
        if json_path.exists() {
            return Ok(candidate.to_string());
        }
    }
    if let Some(found) = find_existing_forge_version(&versions_dir, mc_version, &forge_version) {
        return Ok(found);
    }

    emit(app, instance_id, "forge", 22, "Descargando Forge");
    let installer_dir = base_path.join("forge").join("installers");
    let installer_name = format!("forge-{}-{}-installer.jar", mc_version, forge_version);
    let installer_path = installer_dir.join(&installer_name);
    let installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}-{}/{}",
        mc_version, forge_version, installer_name
    );
    
    // Force clean download to avoid corrupt/html files from previous 404s
    if installer_path.exists() {
        let _ = fs::remove_file(&installer_path);
    }
    
    download_file(&installer_url, &installer_path, None)?;
    if !installer_path.exists() {
        let installer_url_alt = format!(
            "https://maven.creeperhost.net/net/minecraftforge/forge/{}-{}/{}",
            mc_version, forge_version, installer_name
        );
        let _ = download_file(&installer_url_alt, &installer_path, None);
    }

    emit(app, instance_id, "forge", 24, "Instalando Forge (Ejecutable)");
    
    // Ejecutar el installer oficial
    let java_ver = get_required_java_version(mc_version);
    let java_path = match get_java_path_for_major(java_ver) {
        Ok(p) => p,
        Err(_) => {
            let path_str = download_java(java_ver, app.as_ref(), Some(instance_id))?;
            PathBuf::from(path_str)
        }
    };
    
    // Crear launcher_profiles.json falso si no existe
    let profiles_path = base_path.join("launcher_profiles.json");
    if !profiles_path.exists() {
        let dummy_json = r#"{
            "profiles": {},
            "selectedUser": {}
        }"#;
        let _ = fs::write(&profiles_path, dummy_json);
    }
    
    let mut success = false;
    let mut last_stdout = String::new();
    let mut last_stderr = String::new();
    for attempt in [
        vec!["-jar", installer_path.to_string_lossy().as_ref(), "--installClient"],
        vec!["-jar", installer_path.to_string_lossy().as_ref(), "--installClient", base_path.to_string_lossy().as_ref()],
        vec!["-jar", installer_path.to_string_lossy().as_ref(), "--installClient", "--target", base_path.to_string_lossy().as_ref()],
    ] {
        let mut cmd = Command::new(&java_path);
        for a in attempt {
            cmd.arg(a);
        }
        let output = cmd.current_dir(base_path).output().map_err(|e| format!("Failed to run forge installer: {}", e))?;
        last_stdout = String::from_utf8_lossy(&output.stdout).to_string();
        last_stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if output.status.success() {
            success = true;
            break;
        }
        for candidate in &candidates {
            let json_path = versions_dir.join(candidate).join(format!("{}.json", candidate));
            if json_path.exists() {
                success = true;
                break;
            }
        }
        if success { break; }
        if let Some(found) = find_existing_forge_version(&versions_dir, mc_version, &forge_version) {
            return Ok(found);
        }
    }
    if !success {
        return Err(format!("Forge installer failed. Stdout: {}, Stderr: {}", last_stdout, last_stderr));
    }

    // Verificar resultado
    for candidate in &candidates {
        let json_path = versions_dir.join(candidate).join(format!("{}.json", candidate));
        if json_path.exists() {
            return Ok(candidate.to_string());
        }
    }

    // Si no encontramos el json en las rutas esperadas, intentamos buscar en la carpeta versions
    // por si el nombre es ligeramente diferente
    if let Ok(entries) = fs::read_dir(&versions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with(mc_version) && name.contains("forge") {
                        let json = path.join(format!("{}.json", name));
                        if json.exists() {
                            return Ok(name.to_string());
                        }
                    }
                }
            }
        }
    }

    Err(format!("Forge installer finished but version json not found for {}", mc_version))
}

pub fn get_forge_recommended_version(mc_version: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    // Use the files endpoint which is the standard for promotions
    // Try slim first, then full
    let urls = [
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions.json"
    ];
    
    let mut last_err = String::new();
    
    for url in urls {
        let response = client.get(url)
            .send();
            
        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    if let Ok(text) = resp.text() {
                        if let Ok(promos) = serde_json::from_str::<serde_json::Value>(&text) {
                            if let Some(map) = promos.get("promos").and_then(|v| v.as_object()) {
                                let recommended = format!("{}-recommended", mc_version);
                                if let Some(ver) = map.get(&recommended).and_then(|v| v.as_str()) {
                                    return Ok(ver.to_string());
                                }
                                let latest = format!("{}-latest", mc_version);
                                if let Some(ver) = map.get(&latest).and_then(|v| v.as_str()) {
                                    return Ok(ver.to_string());
                                }
                                
                                // Fallback: Try to find any version for this MC version in the keys
                                for (key, value) in map {
                                    if key.starts_with(mc_version) {
                                        if let Some(ver) = value.as_str() {
                                            return Ok(ver.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    last_err = format!("Forge API returned status: {}", resp.status());
                }
            }
            Err(e) => {
                last_err = format!("Failed to connect to Forge API: {}", e);
            }
        }
    }

    if last_err.is_empty() {
        last_err = "Forge promotions API did not yield a version".to_string();
    }

    let urls_xml = [
        "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
        "https://maven.creeperhost.net/net/minecraftforge/forge/maven-metadata.xml"
    ];
    for url in urls_xml {
        let resp = client.get(url).send();
        if let Ok(r) = resp {
            if r.status().is_success() {
                if let Ok(text) = r.text() {
                    let mut best: Option<String> = None;
                    for cap in text.match_indices("<version>") {
                        let start = cap.0 + "<version>".len();
                        if let Some(end) = text[start..].find("</version>") {
                            let ver = &text[start..start+end];
                            if ver.starts_with(&(mc_version.to_string() + "-")) {
                                match &best {
                                    None => best = Some(ver.to_string()),
                                    Some(b) => {
                                        let a = ver.split('-').nth(1).unwrap_or("");
                                        let bseg = b.split('-').nth(1).unwrap_or("");
                                        let mut abits = a.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
                                        let mut bbits = bseg.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
                                        let mut better = false;
                                        loop {
                                            let an = abits.next();
                                            let bn = bbits.next();
                                            if an.is_none() && bn.is_none() { break; }
                                            let av = an.unwrap_or(0);
                                            let bv = bn.unwrap_or(0);
                                            if av > bv { better = true; break; }
                                            if av < bv { better = false; break; }
                                        }
                                        if better { best = Some(ver.to_string()); }
                                    }
                                }
                            }
                        }
                    }
                    if let Some(b) = best {
                        let only_forge = b.split('-').nth(1).unwrap_or(&b);
                        return Ok(only_forge.to_string());
                    }
                }
            }
        }
    }
    
    // Fallback extra: parse directory listing HTML of Maven repositories
    let listing_urls = [
        "https://maven.minecraftforge.net/net/minecraftforge/forge/",
        "https://maven.creeperhost.net/net/minecraftforge/forge/",
    ];
    for url in listing_urls {
        if let Ok(r) = client.get(url).send() {
            if r.status().is_success() {
                if let Ok(text) = r.text() {
                    let mut best: Option<String> = None;
                    for line in text.lines() {
                        if let Some(hpos) = line.find("href=") {
                            let rest = &line[hpos+5..];
                            // href may use quotes or not; handle common patterns
                            let candidate = if rest.starts_with('"') {
                                let rest2 = &rest[1..];
                                if let Some(endq) = rest2.find('"') {
                                    &rest2[..endq]
                                } else { continue }
                            } else {
                                let trimmed = rest.trim_start();
                                let end = trimmed.find(|c: char| c.is_whitespace() || c == '>' || c == '"').unwrap_or(trimmed.len());
                                &trimmed[..end]
                            };
                            let name = candidate.trim_end_matches('/').trim();
                            if name.starts_with(&(mc_version.to_string() + "-")) {
                                match &best {
                                    None => best = Some(name.to_string()),
                                    Some(b) => {
                                        let a = name.split('-').nth(1).unwrap_or("");
                                        let bseg = b.split('-').nth(1).unwrap_or("");
                                        let mut abits = a.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
                                        let mut bbits = bseg.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
                                        let mut better = false;
                                        loop {
                                            let an = abits.next();
                                            let bn = bbits.next();
                                            if an.is_none() && bn.is_none() { break; }
                                            let av = an.unwrap_or(0);
                                            let bv = bn.unwrap_or(0);
                                            if av > bv { better = true; break; }
                                            if av < bv { better = false; break; }
                                        }
                                        if better { best = Some(name.to_string()); }
                                    }
                                }
                            }
                        }
                    }
                    if let Some(b) = best {
                        let only_forge = b.split('-').nth(1).unwrap_or(&b);
                        return Ok(only_forge.to_string());
                    }
                }
            }
        }
    }
    
    // Offline mapping fallback for known versions when all network endpoints fail
    if mc_version == "1.21.11" {
        return Ok("61.0.8".to_string());
    }

    Err(format!("No forge version found for Minecraft {}. Last error: {}", mc_version, last_err))
}

pub fn find_existing_forge_version(versions_dir: &Path, mc_version: &str, forge_version: &str) -> Option<String> {
    let entries = fs::read_dir(versions_dir).ok()?;
    for entry in entries.flatten() {
        if let Ok(file_type) = entry.file_type() {
            if !file_type.is_dir() {
                continue;
            }
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains("forge") && name.contains(mc_version) && name.contains(forge_version) {
            let json_path = versions_dir.join(&name).join(format!("{}.json", name));
            if json_path.exists() {
                return Some(name);
            }
        }
    }
    None
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
