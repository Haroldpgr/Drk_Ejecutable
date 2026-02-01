use crate::minecraft::models::{VersionManifest, VersionEntry};

const MANIFEST_URLS: [&str; 4] = [
    "https://piston-meta.mojang.com/mc/game/version_manifest.json",
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    "https://launchermeta.mojang.com/mc/game/version_manifest.json",
    "https://bmclapi2.bangbang93.com/mc/game/version_manifest.json",
];

pub fn get_release_versions(limit: usize) -> Result<Vec<String>, String> {
    let mut last_err = String::new();
    let mut manifest_opt: Option<VersionManifest> = None;
    for url in MANIFEST_URLS {
        match reqwest::blocking::get(url) {
            Ok(resp) => {
                match resp.json::<VersionManifest>() {
                    Ok(m) => { manifest_opt = Some(m); break; }
                    Err(e) => last_err = format!("Failed to parse manifest: {}", e),
                }
            }
            Err(e) => { last_err = format!("Failed to fetch manifest: {}", e); }
        }
    }
    let manifest = manifest_opt.ok_or(last_err)?;

    let mut releases: Vec<VersionEntry> = manifest
        .versions
        .into_iter()
        .filter(|v| v.version_type == "release")
        .collect();

    releases.sort_by(|a, b| b.release_time.cmp(&a.release_time));

    Ok(releases.into_iter().take(limit).map(|v| v.id).collect())
}
