use std::env;
use std::path::Path;
use std::fs::{self, File};
use zip::ZipArchive;
use crate::minecraft::models::Rule;
use crate::auth::MinecraftProfile;

pub fn get_os_name() -> &'static str {
    match env::consts::OS {
        "windows" => "windows",
        "macos" => "osx",
        "linux" => "linux",
        _ => "unknown",
    }
}

pub fn get_arch() -> &'static str {
    match env::consts::ARCH {
        "x86" => "x86",
        "x86_64" => "x64",
        "aarch64" => "arm64",
        _ => "unknown",
    }
}

pub fn check_rules(rules: &Option<Vec<Rule>>) -> bool {
    if let Some(rules) = rules {
        if rules.is_empty() {
            return true;
        }
        
        let os = get_os_name();
        let arch = get_arch();
        let mut allowed = false; 
        
        for rule in rules {
            let mut os_match = true;
            if let Some(os_rule) = &rule.os {
                if let Some(name) = &os_rule.name {
                    if name != os {
                        os_match = false;
                    }
                }
                if let Some(arch_rule) = &os_rule.arch {
                    if arch_rule != arch {
                        os_match = false;
                    }
                }
            }

            if os_match {
                allowed = rule.action == "allow";
            }
        }
        allowed
    } else {
        true
    }
}

pub fn extract_natives(jar_path: &Path, target_dir: &Path) -> Result<(), String> {
    if !target_dir.exists() {
        fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
    }

    let file = File::open(jar_path).map_err(|e| format!("Failed to open natives jar: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Failed to open zip: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

        if name.starts_with("META-INF") || file.is_dir() {
            continue;
        }

        // Flatten: Extract all files to the root of target_dir, ignoring jar directory structure
        let file_name = Path::new(&name).file_name();
        if let Some(fname) = file_name {
            let out_path = target_dir.join(fname);
            
            // Overwrite existing
            let mut out_file = File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

pub fn replace_vars(
    arg: &str,
    auth: &MinecraftProfile,
    version_id: &str,
    assets_dir: &Path,
    game_dir: &Path,
    asset_index_id: &str,
    natives_dir: &Path,
    libraries_dir: &Path
) -> String {
    let mut result = arg.to_string();
    
    result = result.replace("${auth_player_name}", &auth.name);
    result = result.replace("${version_name}", version_id);
    result = result.replace("${game_directory}", &game_dir.to_string_lossy());
    result = result.replace("${assets_root}", &assets_dir.to_string_lossy());
    result = result.replace("${assets_index_name}", asset_index_id);
    result = result.replace("${auth_uuid}", &auth.id);
    result = result.replace("${auth_access_token}", &auth.access_token);
    if auth.access_token == "offline" {
        result = result.replace("${user_type}", "legacy");
    } else {
        result = result.replace("${user_type}", "msa");
    }
    result = result.replace("${version_type}", "release");
    result = result.replace("${natives_directory}", &natives_dir.to_string_lossy());
    result = result.replace("${launcher_name}", "DrkLauncher");
    result = result.replace("${launcher_version}", "1.0");
    result = result.replace("${library_directory}", &libraries_dir.to_string_lossy());
    
    let cp_sep = if get_os_name() == "windows" { ";" } else { ":" };
    result = result.replace("${classpath_separator}", cp_sep);
    
    result = result.replace("${resolution_width}", "854");
    result = result.replace("${resolution_height}", "480");

    // Fix library paths if they contain spaces? usually handled by quoting
    
    result
}
