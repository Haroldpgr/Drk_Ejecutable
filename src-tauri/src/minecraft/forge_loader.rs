use std::path::{Path, PathBuf};
use std::fs;
use std::process::Command;
use tauri::AppHandle;
use tauri::Emitter;
use crate::auth::MinecraftProfile;
use super::models::*;
use super::downloader::download_file;
use super::java::{get_java_path_for_major, get_required_java_version, download_java, get_system_java_version};
use super::utils::{check_rules, get_os_name, get_arch, replace_vars, extract_natives};
use super::launch_logic::{resolve_complete_version_info, ensure_forge_installed};

 

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

fn escape_arg(arg: &str) -> String {
    let mut escaped = String::new();
    let needs_quotes = arg.contains(' ') || arg.contains('\t');
    if needs_quotes { escaped.push('"'); }
    for c in arg.chars() {
        if c == '"' { escaped.push_str("\\\""); } else { escaped.push(c); }
    }
    if needs_quotes { escaped.push('"'); }
    escaped
}

fn normalize_path_for_comparison(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    if get_os_name() == "windows" { s.to_lowercase() } else { s }
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
    if items.len() < 3 { return None; }
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
    Some(format!("{}/{}/{}/{}", group_path, maven.artifact, maven.version, filename))
}

fn ensure_trailing_slash(value: &str) -> String {
    if value.ends_with('/') { value.to_string() } else { format!("{}/", value) }
}

pub fn download_forge(
    base_path: &Path,
    instance_minecraft_dir: &Path,
    mc_version: &str,
    app: &Option<AppHandle>,
    instance_id: &str
) -> Result<VersionInfo, String> {
    let assets_dir = base_path.join("assets");
    let libraries_dir = instance_minecraft_dir
        .parent()
        .map(|p| p.join("libraries"))
        .unwrap_or_else(|| instance_minecraft_dir.join("libraries"));
    let versions_dir = base_path.join("versions");
    let natives_dir = instance_minecraft_dir.join("natives");
    fs::create_dir_all(instance_minecraft_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&natives_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&libraries_dir).map_err(|e| e.to_string())?;

    let effective_id = ensure_forge_installed(base_path, mc_version, app, instance_id)?;

    let manifest: VersionManifest = super::launch_logic::fetch_manifest_with_fallback()
        .map_err(|e| format!("Failed to fetch manifest (with fallback): {}", e))?;

    let info = resolve_complete_version_info(&effective_id, &versions_dir, &manifest)?;
    let version_dir = versions_dir.join(&info.id);
    fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    let json_path = version_dir.join("version.json");
    let json = serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?;
    fs::write(&json_path, json).map_err(|e| e.to_string())?;

    if let Some(downloads) = &info.downloads {
        let client_path = instance_minecraft_dir.join("client.jar");
        emit(app, instance_id, "cliente", 55, "Descargando cliente");
        download_file(&downloads.client.url, &client_path, Some(&downloads.client.sha1))?;
    }

    if let Some(asset_index_ref) = &info.asset_index {
        let idx_path = assets_dir.join("indexes").join(format!("{}.json", asset_index_ref.id));
        download_file(&asset_index_ref.url, &idx_path, Some(&asset_index_ref.sha1))?;
        let asset_index: AssetIndex = serde_json::from_str(
            &fs::read_to_string(&idx_path).map_err(|e| e.to_string())?
        ).map_err(|e| e.to_string())?;
        emit(app, instance_id, "assets", 60, "Descargando assets");
        super::launch_logic::download_assets_parallel(&assets_dir, &asset_index, app, instance_id)?;
        emit(app, instance_id, "assets", 75, "Assets descargados");
    }

    if !info.libraries.is_empty() {
        emit(app, instance_id, "librerias", 65, "Descargando librerías");
        for lib in &info.libraries {
            if !check_rules(&lib.rules) { continue; }
            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    if let Some(path_str) = &artifact.path {
                        let target = libraries_dir.join(path_str);
                        let _ = fs::create_dir_all(target.parent().unwrap());
                        let _ = download_file(&artifact.url, &target, Some(&artifact.sha1));
                    }
                }
                if let Some(classifiers) = &downloads.classifiers {
                    if let Some(natives_map) = &lib.natives {
                        if let Some(classifier_key) = natives_map.get(get_os_name()) {
                            let arch = get_arch();
                            let key = classifier_key.replace("${arch}", if arch == "x86" { "32" } else { "64" });
                            if let Some(artifact) = classifiers.get(&key) {
                                if let Some(path_str) = &artifact.path {
                                    let target = libraries_dir.join(path_str);
                                    let _ = fs::create_dir_all(target.parent().unwrap());
                                    let _ = download_file(&artifact.url, &target, Some(&artifact.sha1));
                                    let _ = extract_natives(&target, &natives_dir);
                                }
                            }
                        }
                    }
                }
            } else if let Some(maven) = parse_maven_name(&lib.name) {
                let base_url = lib.url.clone().unwrap_or_else(|| "https://libraries.minecraft.net/".to_string());
                if let Some(path_str) = maven_path(&maven) {
                    let url = format!("{}{}", ensure_trailing_slash(&base_url), path_str);
                    let target = libraries_dir.join(&path_str);
                    let _ = fs::create_dir_all(target.parent().unwrap());
                    let _ = download_file(&url, &target, None);
                }
                if let Some(natives_map) = &lib.natives {
                    if let Some(classifier_key) = natives_map.get(get_os_name()) {
                        let arch = get_arch();
                        let classifier = classifier_key.replace("${arch}", if arch == "x86" { "32" } else { "64" });
                        let mut native_maven = maven.clone();
                        native_maven.classifier = Some(classifier);
                        if let Some(native_path) = maven_path(&native_maven) {
                            let url = format!("{}{}", ensure_trailing_slash(&base_url), native_path);
                            let target = libraries_dir.join(&native_path);
                            let _ = fs::create_dir_all(target.parent().unwrap());
                            let _ = download_file(&url, &target, None);
                            let _ = extract_natives(&target, &natives_dir);
                        }
                    }
                }
            }
        }
    }

    Ok(info)
}

pub fn build_forge_command(
    base_path: &Path,
    instance_minecraft_dir: &Path,
    info: &VersionInfo,
    auth: &MinecraftProfile,
    ram_mb: u64
) -> Result<Command, String> {
    let assets_dir = base_path.join("assets");
    let libraries_dir = instance_minecraft_dir
        .parent()
        .map(|p| p.join("libraries"))
        .unwrap_or_else(|| instance_minecraft_dir.join("libraries"));
    let _versions_dir = base_path.join("versions");
    let natives_dir = instance_minecraft_dir.join("natives");
    let required_java = info.java_version.as_ref().map(|v| v.major_version).unwrap_or_else(|| get_required_java_version(&info.id));
    let java_path = match get_java_path_for_major(required_java) {
        Ok(p) => p,
        Err(_) => {
            let path_str = download_java(required_java, None, None)?;
            PathBuf::from(path_str)
        }
    };

    let mut cmd = Command::new(java_path.clone());
    let mut jvm_flags: Vec<String> = Vec::new();
    let min_mem = std::cmp::max(512, ram_mb / 4);
    for flag in [
        "-XX:+UnlockExperimentalVMOptions",
        &format!("-Xms{}M", min_mem),
        &format!("-Xmx{}M", ram_mb),
        "-XX:+UseG1GC",
        "-XX:MaxGCPauseMillis=120",
        "-XX:G1HeapRegionSize=8M",
        "-XX:G1NewSizePercent=30",
        "-XX:G1MaxNewSizePercent=40",
        "-XX:G1ReservePercent=20",
        "-XX:G1HeapWastePercent=5",
        "-XX:G1MixedGCCountTarget=4",
        "-XX:InitiatingHeapOccupancyPercent=15",
        "-XX:G1MixedGCLiveThresholdPercent=90",
        "-XX:G1RSetUpdatingPauseTimePercent=5",
        "-XX:ReservedCodeCacheSize=768M",
        "-XX:InitialCodeCacheSize=128M",
        "-XX:+ParallelRefProcEnabled",
        "-XX:+DisableExplicitGC",
        "-XX:+AlwaysPreTouch",
        "-XX:+UseStringDeduplication",
        "-XX:+UseCompressedOops",
        "-XX:+UseCompressedClassPointers",
        "-XX:+PerfDisableSharedMem",
        "-Djava.net.preferIPv4Stack=true",
        "-Dfile.encoding=UTF-8",
        "-Dfml.ignoreInvalidMinecraftCertificates=true",
        "-Dfml.ignorePatchDiscrepancies=true",
        "-Dfml.earlyprogresswindow=false",
        "-Dfml.earlyWindowControl=false",
        "-Dforge.logging.console.level=info",
        "-Djava.awt.headless=false",
        &format!("-Djava.library.path={}", natives_dir.to_string_lossy()),
        "-Dminecraft.launcher.brand=drklauncher",
        "-Dminecraft.launcher.version=1.0",
    ] {
        cmd.arg(flag);
        jvm_flags.push(flag.to_string());
    }

    let java_major = get_system_java_version(&java_path.to_string_lossy()).unwrap_or(required_java);
    if java_major >= 21 {
        let flag = "--enable-native-access=ALL-UNNAMED";
        cmd.arg(flag);
        jvm_flags.push(flag.to_string());
    }

    if let Some(logging) = &info.logging {
        if let Some(client_logging) = &logging.client {
            if let Some(file) = &client_logging.file {
                let log_config_path = assets_dir.join("log_configs").join(&file.id);
                if !log_config_path.exists() {
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

    let asset_index_id = info.asset_index.as_ref().map(|a| a.id.as_str()).unwrap_or("legacy");
    let args_file_path = instance_minecraft_dir.join("args.txt");
    let mut args_content = String::new();
    args_content.push_str("-Dfml.earlyprogresswindow=false\n");
    args_content.push_str("-Dfml.earlyWindowControl=false\n");
    args_content.push_str("-Dforge.logging.console.level=info\n");

    let mut library_map: std::collections::HashMap<String, MavenName> = std::collections::HashMap::new();
    for lib in &info.libraries {
        if let Some(maven) = parse_maven_name(&lib.name) {
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

    let mp_sep = if get_os_name() == "windows" { ";" } else { ":" };
    let mut module_path_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (_, maven) in &library_map {
        if maven.group == "cpw.mods" && (maven.artifact == "securejarhandler" || maven.artifact == "modlauncher" || maven.artifact == "bootstraplauncher") {
            if let Some(rel) = maven_path(maven) {
                let full = libraries_dir.join(rel).to_string_lossy().to_string();
                module_path_set.insert(full);
            }
        }
    }
    for v in module_path_set.clone() {
        let full_path = std::path::PathBuf::from(&v);
        if !full_path.exists() {
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
        let final_mp = module_path_set.clone().into_iter().collect::<Vec<_>>().join(mp_sep);
        args_content.push_str("-p\n");
        args_content.push_str(&format!("{}\n", escape_arg(&final_mp)));
    }
    let mut module_path_libs: std::collections::HashSet<String> = std::collections::HashSet::new();
    for v in &module_path_set {
        let norm = normalize_path_for_comparison(&std::path::PathBuf::from(v));
        module_path_libs.insert(norm);
    }

    let mut classpath_entries: Vec<PathBuf> = Vec::new();
    for lib in &info.libraries {
        if !check_rules(&lib.rules) { continue; }
        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                if let Some(path_str) = &artifact.path {
                    let is_native = false;
                    if !is_native {
                        classpath_entries.push(libraries_dir.join(path_str));
                    }
                }
            }
        } else if let Some(maven) = parse_maven_name(&lib.name) {
            if let Some(path_str) = maven_path(&maven) {
                let is_native = maven.classifier.as_deref().map(|c| c.contains("natives")).unwrap_or(false);
                if !is_native {
                    classpath_entries.push(libraries_dir.join(path_str));
                }
            }
        }
    }
    let client_path = instance_minecraft_dir.join("client.jar");
    if client_path.exists() {
        classpath_entries.insert(0, client_path);
    }

    if let Some(args) = &info.arguments {
        if let Some(jvm_args) = &args.jvm {
            let mut skip_next = false;
            for arg in jvm_args {
                match arg {
                    Argument::Simple(s) => {
                        if skip_next { skip_next = false; continue; }
                        if s == "-cp" { skip_next = true; continue; }
                        if s == "-p" || s == "--module-path" { skip_next = true; continue; }
                        if s == "${classpath}" { continue; }
                        if s == "${module_path}" { continue; }
                        if (s.starts_with("--add-exports") || s.starts_with("--add-opens")) && s.contains("cpw.mods.") { continue; }
                        if s.starts_with("-DignoreList=") { continue; }
                        let val = replace_vars(s, auth, &info.id, &assets_dir, instance_minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                        if val.starts_with("-DignoreList=") { continue; }
                        args_content.push_str(&format!("{}\n", escape_arg(&val)));
                    }
                    Argument::Complex(c) => {
                        if check_rules(&Some(c.rules.clone())) {
                            match &c.value {
                                ArgumentValue::Single(s) => {
                                    if skip_next { skip_next = false; continue; }
                                    if s == "-cp" { skip_next = true; continue; }
                                    if s == "-p" || s == "--module-path" { skip_next = true; continue; }
                                    if s == "${classpath}" { continue; }
                                    if s == "${module_path}" { continue; }
                                    if (s.starts_with("--add-exports") || s.starts_with("--add-opens")) && s.contains("cpw.mods.") { continue; }
                                    if s.starts_with("-DignoreList=") { continue; }
                                    let val = replace_vars(s, auth, &info.id, &assets_dir, instance_minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                                    if val.starts_with("-DignoreList=") { continue; }
                                    args_content.push_str(&format!("{}\n", escape_arg(&val)));
                                }
                                ArgumentValue::Multiple(vec) => {
                                    for s in vec {
                                        if skip_next { skip_next = false; continue; }
                                        if s == "-cp" { skip_next = true; continue; }
                                        if s == "-p" || s == "--module-path" { skip_next = true; continue; }
                                        if s == "${classpath}" { continue; }
                                        if s == "${module_path}" { continue; }
                                        if s.starts_with("-DignoreList=") { continue; }
                                        let val = replace_vars(s, auth, &info.id, &assets_dir, instance_minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                                        if val.starts_with("-DignoreList=") { continue; }
                                        args_content.push_str(&format!("{}\n", escape_arg(&val)));
                                    }
                                     
   if (s.starts_with("--add-exports") || s.starts_with("--add-opens")) && s.contains("cpw.mods.") { continue; }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let cp_sep = if get_os_name() == "windows" { ";" } else { ":" };
    let mut unique_entries = std::collections::HashSet::new();
    let mut final_classpath = Vec::new();
    let mut module_path_artifacts = std::collections::HashSet::new();
                }
            }
        }
    }

    let cp_sep = if get_os_name() == "windows" { ";" } else { ":" };
    let mut unique_entries = std::collections::HashSet::new();
    let mut final_classpath = Vec::new();
    let mut module_path_artifacts = std::collections::HashSet::new();
    for path in &module_path_libs {
        if let Some(maven) = library_map.get(path) {
            module_path_artifacts.insert((maven.group.clone(), maven.artifact.clone()));
        }
    }
    let forge_classpath_blacklist = [
        "asm", "asm-commons", "asm-tree", "asm-util", "asm-analysis",
        "java-objc-bridge", "jna", "oshi-core",
        "sponge-mixin", "mixin", "jakarta.activation", "jakarta.xml.bind"
    ];
    for entry in classpath_entries {
        if unique_entries.insert(entry.clone()) {
            let normalized_entry = normalize_path_for_comparison(&entry);
            let is_on_module_path = module_path_libs.contains(&normalized_entry);
            let is_artifact_conflict = if let Some(maven) = library_map.get(&normalized_entry) {
                module_path_artifacts.contains(&(maven.group.clone(), maven.artifact.clone()))
            } else { false };
            let is_blacklisted = {
                let file_name = entry.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                forge_classpath_blacklist.iter().any(|&b| file_name.contains(b))
            };
            let force_include_bootstrap = {
                let file_name = entry.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                if file_name.contains("bootstraplauncher") {
                    true
                } else {
                    if let Some(maven) = library_map.get(&normalized_entry) {
                        maven.group == "cpw.mods" && maven.artifact == "bootstraplauncher"
                    } else { false }
                }
            };
            if force_include_bootstrap || (!is_on_module_path && !is_artifact_conflict && !is_blacklisted) {
                final_classpath.push(entry);
            }
        }
    }
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
    let mut bootstrap_target_scan: Option<PathBuf> = None;
    if bootstrap_target_scan.is_none() {
        let base = libraries_dir.join("cpw").join("mods").join("bootstraplauncher");
        if base.exists() {
            if let Ok(entries) = fs::read_dir(&base) {
                'outer_bootstrap: for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        if let Ok(files) = fs::read_dir(&p) {
                            for f in files.flatten() {
                                let fp = f.path();
                                if let Some(name) = fp.file_name().and_then(|n| n.to_str()) {
                                    if name.starts_with("bootstraplauncher-") && name.ends_with(".jar") {
                                        bootstrap_target_scan = Some(fp);
                                        break 'outer_bootstrap;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if let Some(target) = bootstrap_target_scan.clone() {
        if !target.exists() {
            let rel = if let Ok(stripped) = target.strip_prefix(&libraries_dir) {
                stripped.to_string_lossy().replace('\\', "/")
            } else {
                String::new()
            };
            if !rel.is_empty() {
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
    let mut fmlloader_target: Option<PathBuf> = None;
    for (_, maven) in &library_map {
        if maven.group == "net.minecraftforge" && maven.artifact == "fmlloader" {
            if let Some(rel) = maven_path(maven) {
                fmlloader_target = Some(libraries_dir.join(rel));
                break;
            }
        }
    }
    if fmlloader_target.is_none() {
        let base = libraries_dir.join("net").join("minecraftforge").join("fmlloader");
        if base.exists() {
            if let Ok(entries) = fs::read_dir(&base) {
                'outer: for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        if let Ok(files) = fs::read_dir(&p) {
                            for f in files.flatten() {
                                let fp = f.path();
                                if let Some(name) = fp.file_name().and_then(|n| n.to_str()) {
                                    if name.starts_with("fmlloader-") && name.ends_with(".jar") {
                                        fmlloader_target = Some(fp);
                                        break 'outer;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if let Some(target) = fmlloader_target.clone() {
        if !target.exists() {
            let rel = if let Ok(stripped) = target.strip_prefix(&libraries_dir) {
                stripped.to_string_lossy().replace('\\', "/")
            } else {
                String::new()
            };
            if !rel.is_empty() {
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
    let final_classpath_existing = final_classpath
        .into_iter()
        .filter(|p| p.exists())
        .collect::<Vec<_>>();
    let cp_str = final_classpath_existing
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(cp_sep);
    args_content.push_str("-cp\n");
    args_content.push_str(&format!("{}\n", escape_arg(&cp_str)));
    
    // Select effective main class for Forge with fallback
    let mut bootstrap_target: Option<PathBuf> = None;
    for (_, maven) in &library_map {
        if maven.group == "cpw.mods" && maven.artifact == "bootstraplauncher" {
            if let Some(rel) = maven_path(maven) {
                bootstrap_target = Some(libraries_dir.join(rel));
                break;
            }
        }
    }
    let effective_main_class = if let Some(bt) = bootstrap_target.or(bootstrap_target_scan.clone()) {
        if bt.exists() {
            "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string()
        } else if let Some(fml) = fmlloader_target.clone() {
            if fml.exists() {
                "net.minecraftforge.bootstrap.ForgeBootstrap".to_string()
            } else {
                "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string()
            }
        } else {
            "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string()
        }
    } else if let Some(fml) = fmlloader_target.clone() {
        if fml.exists() {
            "net.minecraftforge.bootstrap.ForgeBootstrap".to_string()
        } else {
            "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string()
        }
    } else {
        "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string()
    };
    args_content.push_str(&format!("{}\n", escape_arg(&effective_main_class)));

    args_content.push_str("--width\n854\n");
    args_content.push_str("--height\n480\n");

    if let Some(args) = &info.arguments {
        if let Some(game_args) = &args.game {
            let mut skip_next = false;
            for arg in game_args {
                match arg {
                    Argument::Simple(s) => {
                        if skip_next { skip_next = false; continue; }
                        if s == "--demo" { continue; }
                        if s == "--width" || s == "--height" { skip_next = true; continue; }
                        if s == "${resolution_width}" || s == "${resolution_height}" { continue; }
                        let val = replace_vars(s, auth, &info.id, &assets_dir, instance_minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
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
                                    let val = replace_vars(s, auth, &info.id, &assets_dir, instance_minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                                    args_content.push_str(&format!("{}\n", escape_arg(&val)));
                                }
                                ArgumentValue::Multiple(vec) => {
                                    for s in vec {
                                        if skip_next { skip_next = false; continue; }
                                        if s == "--demo" { continue; }
                                        if s == "--width" || s == "--height" { skip_next = true; continue; }
                                        if s == "${resolution_width}" || s == "${resolution_height}" { continue; }
                                        let val = replace_vars(s, auth, &info.id, &assets_dir, instance_minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
                                        args_content.push_str(&format!("{}\n", escape_arg(&val)));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    } else if let Some(legacy_args) = &info.minecraft_arguments {
        let mut skip_next = false;
        for part in legacy_args.split_whitespace() {
            if skip_next { skip_next = false; continue; }
            if part == "--demo" { continue; }
            if part == "--width" || part == "--height" { skip_next = true; continue; }
            if part == "${resolution_width}" || part == "${resolution_height}" { continue; }
            let val = replace_vars(part, auth, &info.id, &assets_dir, instance_minecraft_dir, asset_index_id, &natives_dir, &libraries_dir);
            args_content.push_str(&format!("{}\n", escape_arg(&val)));
        }
    }

    let _ = fs::write(&args_file_path, args_content.clone());

    let logs_dir = instance_minecraft_dir.join("logs");
    let _ = fs::create_dir_all(&logs_dir);
    let mut lib_checks: Vec<String> = Vec::new();
    for (grp, art) in [
        ("cpw.mods", "bootstraplauncher"),
        ("cpw.mods", "modlauncher"),
        ("cpw.mods", "securejarhandler"),
        ("net.minecraftforge", "fmlloader"),
    ] {
        let mut found_path: Option<PathBuf> = None;
        for (_, maven) in &library_map {
            if maven.group == grp && maven.artifact == art {
                if let Some(rel) = maven_path(maven) {
                    found_path = Some(libraries_dir.join(rel));
                    break;
                }
            }
        }
        if let Some(p) = found_path {
            let exists = p.exists();
            let size = if exists { fs::metadata(&p).map(|m| m.len()).unwrap_or(0) } else { 0 };
            lib_checks.push(format!("{}:{} path={} exists={} size={}", grp, art, p.to_string_lossy(), exists, size));
        } else {
            lib_checks.push(format!("{}:{} path=<not-found-in-version.json>", grp, art));
        }
    }
    let final_mp_dbg = module_path_set.into_iter().collect::<Vec<_>>().join(mp_sep);
    let debug_content = format!(
        "JAVA_PATH={}\nJAVA_MAJOR={}\nJAVA_REQUIRED={}\nWORK_DIR={}\nNATIVES_DIR={}\nMAIN_CLASS={}\nMODULE_PATH={}\nCLASSPATH={}\nJVM_FLAGS={}\nARGS_FILE={}\nARGS_CONTENT_BEGIN\n{}\nARGS_CONTENT_END\nLIB_CHECKS_BEGIN\n{}\nLIB_CHECKS_END\n",
        java_path.to_string_lossy(),
        java_major,
        required_java,
        instance_minecraft_dir.to_string_lossy(),
        natives_dir.to_string_lossy(),
        effective_main_class,
        final_mp_dbg,
        cp_str,
        jvm_flags.join(" "),
        args_file_path.to_string_lossy(),
        args_content,
        lib_checks.join("\n"),
    );
    let _ = fs::write(logs_dir.join("launch-debug.txt"), debug_content);
    cmd.arg(format!("@{}", args_file_path.to_string_lossy()));
    cmd.current_dir(instance_minecraft_dir);
    Ok(cmd)
}
