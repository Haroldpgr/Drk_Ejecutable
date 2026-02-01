use std::process::Command;
use std::path::PathBuf;
use std::fs;
use tauri::{AppHandle, Emitter};

pub fn get_java_path(minecraft_version: &str) -> Result<PathBuf, String> {
    let required_version = get_required_java_version(minecraft_version);
    get_java_path_for_major(required_version)
}

pub fn get_java_path_for_major(required_version: u32) -> Result<PathBuf, String> {
    if let Ok(version) = get_system_java_version("java") {
        // Use system Java ONLY if the major version matches exactly
        // Newer majors (e.g., 21/25) can break Forge 1.20.1 which expects Java 17
        if version == required_version {
            return Ok(PathBuf::from("java"));
        }
    }
    let appdata = crate::get_instances_dir();
    let embedded = PathBuf::from(&appdata)
        .join("java")
        .join(format!("{}", required_version))
        .join("bin")
        .join(if cfg!(target_os = "windows") { "java.exe" } else { "java" });
    if embedded.exists() {
        return Ok(embedded);
    }
    
    // Check for "javaw.exe" on Windows as alternative
    if cfg!(target_os = "windows") {
        let embedded_javaw = PathBuf::from(&appdata)
            .join("java")
            .join(format!("{}", required_version))
            .join("bin")
            .join("javaw.exe");
        if embedded_javaw.exists() {
             return Ok(embedded_javaw);
        }
    }

    Err(format!("No suitable Java {} found", required_version))
}

pub fn download_java(major: u32, app: Option<&AppHandle>, instance_id: Option<&str>) -> Result<String, String> {
    let base_dir = PathBuf::from(crate::get_instances_dir()).join("java").join(format!("{}", major));
    let bin_java = base_dir.join("bin").join(if cfg!(target_os = "windows") { "java.exe" } else { "java" });
    
    if bin_java.exists() {
        return Ok(bin_java.to_string_lossy().to_string());
    }

    if let Some(app) = app {
        if let Some(id) = instance_id {
            let _ = app.emit("launch_progress", serde_json::json!({
                "instanceId": id,
                "stage": "java",
                "percent": 0,
                "message": format!("Descargando Java {}", major)
            }));
        }
    }

    fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    
    // Determine OS and Arch for Adoptium API
    let os = if cfg!(target_os = "windows") { "windows" } else if cfg!(target_os = "macos") { "mac" } else { "linux" };
    let arch = "x64"; // Assuming x64 for now, could use utils::get_arch() if available and mapped correctly
    
    let api = format!("https://api.adoptium.net/v3/assets/latest/{}/hotspot?architecture={}&os={}&image_type=jre", major, arch, os);
    
    let client = reqwest::blocking::Client::builder()
        .user_agent("DrkLauncher/1.0")
        .build()
        .map_err(|e| format!("Failed to build http client: {}", e))?;

    let max_retries = 3;
    let mut last_error = String::new();
    let mut assets_opt: Option<serde_json::Value> = None;
    for attempt in 1..=max_retries {
        match client.get(&api).send() {
            Ok(resp) => {
                match resp.json::<serde_json::Value>() {
                    Ok(v) => {
                        assets_opt = Some(v);
                        break;
                    }
                    Err(e) => {
                        last_error = format!("Failed to parse Java info: {} (attempt {}/{})", e, attempt, max_retries);
                    }
                }
            }
            Err(e) => {
                last_error = format!("Failed to fetch Java info: {} (attempt {}/{})", e, attempt, max_retries);
            }
        }
        if attempt < max_retries {
            std::thread::sleep(std::time::Duration::from_millis(500 * attempt as u64));
        }
    }
    if assets_opt.is_none() {
        if let Ok(ver) = get_system_java_version("java") {
            if ver == major {
                return Ok("java".to_string());
            }
        }
        return Err(last_error);
    }
    let assets = assets_opt.unwrap();
        
    let release = assets.as_array().and_then(|arr| arr.first()).ok_or("No Java assets found")?;
    let pkg = release.get("binary").and_then(|b| b.get("package")).ok_or("No Java package info")?;
    let url = pkg.get("link").and_then(|l| l.as_str()).ok_or("No Java download link")?;
    let filename = pkg.get("name").and_then(|n| n.as_str()).unwrap_or("java.zip");
    
    let zip_path = base_dir.join(filename);
    
    // Download
    let mut bytes_opt: Option<Vec<u8>> = None;
    for attempt in 1..=max_retries {
        match client.get(url).send() {
            Ok(resp) => {
                match resp.bytes() {
                    Ok(b) => {
                        bytes_opt = Some(b.to_vec());
                        break;
                    }
                    Err(e) => {
                        last_error = format!("Failed to read Java bytes: {} (attempt {}/{})", e, attempt, max_retries);
                    }
                }
            }
            Err(e) => {
                last_error = format!("Failed to download Java: {} (attempt {}/{})", e, attempt, max_retries);
            }
        }
        if attempt < max_retries {
            std::thread::sleep(std::time::Duration::from_millis(500 * attempt as u64));
        }
    }
    if let Some(bytes) = bytes_opt {
        fs::write(&zip_path, &bytes).map_err(|e| e.to_string())?;
    } else {
        if let Ok(ver) = get_system_java_version("java") {
            if ver == major {
                return Ok("java".to_string());
            }
        }
        return Err(last_error);
    }

    if let Some(app) = app {
        if let Some(id) = instance_id {
            let _ = app.emit("launch_progress", serde_json::json!({
                "instanceId": id,
                "stage": "java",
                "percent": 50,
                "message": "Extrayendo Java"
            }));
        }
    }

    // Extract
    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    
    for i in 0..zip.len() {
        let mut zf = zip.by_index(i).map_err(|e| e.to_string())?;
        // Some zips have a top-level folder, we want to strip it or handle it?
        // Usually adoptium has "jdk-17+..." folder. We want to extract contents into base_dir.
        // But the previous code just extracted to base_dir/zf.name().
        // If zf.name() includes the top folder, we end up with base_dir/jdk-17.../bin/java.exe
        // But we expect base_dir/bin/java.exe
        // So we need to strip the first component if possible.
        
        let path = PathBuf::from(zf.name());
        let components: Vec<_> = path.components().collect();
        if components.len() > 1 {
            let mut out = base_dir.clone();
            for component in &components[1..] {
                out.push(component);
            }
            
            if zf.is_dir() {
                let _ = fs::create_dir_all(&out);
            } else {
                if let Some(p) = out.parent() { let _ = fs::create_dir_all(p); }
                let mut out_file = std::fs::File::create(&out).map_err(|e| e.to_string())?;
                std::io::copy(&mut zf, &mut out_file).map_err(|e| e.to_string())?;
            }
            
            // On Linux/Mac, set permissions
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = zf.unix_mode() {
                    fs::set_permissions(&out, fs::Permissions::from_mode(mode)).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    
    // Cleanup zip
    let _ = fs::remove_file(&zip_path);

    if bin_java.exists() {
        Ok(bin_java.to_string_lossy().to_string())
    } else {
        // Fallback: check if we extracted without stripping (if zip structure was flat?)
        // Or maybe check subfolders?
        // For now, assume stripping worked or failed.
        // Try finding java.exe recursively?
        // Let's assume the strip logic is correct for Adoptium.
        if cfg!(target_os = "windows") {
             let javaw = base_dir.join("bin").join("javaw.exe");
             if javaw.exists() {
                 return Ok(javaw.to_string_lossy().to_string());
             }
        }
        Err("Java downloaded but executable not found in expected path".to_string())
    }
}


pub fn get_required_java_version(mc_version: &str) -> u32 {
    // Logic based on Minecraft version
    // <= 1.16.5 -> Java 8
    // >= 1.17 -> Java 16/17
    // >= 1.18 -> Java 17
    // >= 1.20.5 -> Java 21
    // >= 1.21 -> Java 21
    
    let parts: Vec<&str> = mc_version.split('.').collect();
    if parts.len() < 2 {
        return 8; // Fallback
    }

    let minor = parts[1].parse::<u32>().unwrap_or(0);
    
    if minor <= 16 {
        8
    } else if minor <= 17 {
        16 // 1.17 uses Java 16, but 17 works too
    } else if minor <= 20 {
        // 1.18 to 1.20.4 use Java 17
        // Check for 1.20.5+ specifically
        if minor == 20 && parts.len() > 2 {
             let patch = parts[2].parse::<u32>().unwrap_or(0);
             if patch >= 5 {
                 return 21;
             }
        }
        17
    } else {
        21 // 1.21+ uses Java 21
    }
}

pub fn get_system_java_version(binary: &str) -> Result<u32, String> {
    let output = Command::new(binary)
        .arg("-version")
        .output()
        .map_err(|e| format!("Failed to run java: {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    
    // Output looks like: "java version \"1.8.0_311\"" or "openjdk version \"17.0.1\""
    
    if let Some(start) = stderr.find("version \"") {
        let rest = &stderr[start + 9..];
        if let Some(end) = rest.find('"') {
            let version_str = &rest[..end];
            // Parse version
            if version_str.starts_with("1.8") {
                return Ok(8);
            } else {
                let parts: Vec<&str> = version_str.split('.').collect();
                if let Some(major) = parts.first() {
                     if let Ok(v) = major.parse::<u32>() {
                         return Ok(v);
                     }
                }
            }
        }
    }

    Err("Could not parse java version".to_string())
}
