use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionEntry>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VersionInfo {
    pub id: String,
    #[serde(rename = "inheritsFrom")]
    pub inherits_from: Option<String>,
    #[serde(rename = "assetIndex")]
    pub asset_index: Option<AssetIndexRef>,
    pub assets: Option<String>,
    pub downloads: Option<VersionDownloads>,
    pub libraries: Vec<Library>,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    #[serde(rename = "minecraftArguments")]
    pub minecraft_arguments: Option<String>, // Legacy
    pub arguments: Option<Arguments>, // New system (1.13+)
    #[serde(rename = "type")]
    pub version_type: String,
    #[serde(rename = "javaVersion")]
    pub java_version: Option<JavaVersion>,
    pub logging: Option<Logging>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Logging {
    pub client: Option<ClientLogging>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ClientLogging {
    pub argument: Option<String>,
    pub file: Option<LogFile>,
    #[serde(rename = "type")]
    pub log_type: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LogFile {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct JavaVersion {
    pub component: String,
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    #[serde(rename = "totalSize")]
    pub total_size: u64,
    pub url: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VersionDownloads {
    pub client: DownloadArtifact,
    pub server: Option<DownloadArtifact>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DownloadArtifact {
    pub sha1: String,
    pub size: u64,
    pub url: String,
    pub path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub url: Option<String>,
    pub natives: Option<HashMap<String, String>>,
    pub rules: Option<Vec<Rule>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LibraryDownloads {
    pub artifact: Option<DownloadArtifact>,
    pub classifiers: Option<HashMap<String, DownloadArtifact>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Rule {
    pub action: String, // "allow" or "disallow"
    pub os: Option<OsRule>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OsRule {
    pub name: Option<String>, // "windows", "osx", "linux"
    pub version: Option<String>, // regex
    pub arch: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Arguments {
    pub game: Option<Vec<Argument>>,
    pub jvm: Option<Vec<Argument>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(untagged)]
pub enum Argument {
    Simple(String),
    Complex(ComplexArgument),
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ComplexArgument {
    pub rules: Vec<Rule>,
    pub value: ArgumentValue,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(untagged)]
pub enum ArgumentValue {
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AssetIndex {
    pub objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}
