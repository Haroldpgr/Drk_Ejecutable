use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use sha1::{Sha1, Digest};

pub fn download_file(url: &str, path: &Path, sha1: Option<&str>) -> Result<(), String> {
    if path.exists() {
        if let Some(expected_hash) = sha1 {
            if verify_hash(path, expected_hash) {
                return Ok(());
            }
        } else {
            // If no hash provided, assume existing file is valid for now
            return Ok(()); 
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(3600)) // 1 hour timeout for large files
        .build()
        .map_err(|e| format!("Failed to build http client: {}", e))?;

    let max_retries = 3;
    let mut last_error = String::new();

    for attempt in 1..=max_retries {
        let result = (|| -> Result<(), String> {
            let mut response = client.get(url)
                .send()
                .map_err(|e| format!("Network error: {}", e))?;
            
            if !response.status().is_success() {
                return Err(format!("Download failed with status: {}", response.status()));
            }

            let mut file = File::create(path).map_err(|e| format!("File creation error: {}", e))?;
            std::io::copy(&mut response, &mut file).map_err(|e| format!("Write error: {}", e))?;
            Ok(())
        })();

        match result {
            Ok(_) => {
                if let Some(expected_hash) = sha1 {
                    if verify_hash(path, expected_hash) {
                        return Ok(());
                    } else {
                        last_error = format!("Hash mismatch for {} (attempt {}/{})", url, attempt, max_retries);
                        let _ = fs::remove_file(path); // Clean up bad file
                    }
                } else {
                    return Ok(());
                }
            },
            Err(e) => {
                last_error = format!("{} (attempt {}/{})", e, attempt, max_retries);
            }
        }
        
        // Exponential backoff: 500ms, 1000ms, 1500ms...
        if attempt < max_retries {
            std::thread::sleep(std::time::Duration::from_millis(500 * attempt as u64));
        }
    }

    Err(format!("Failed to download {} after {} attempts. Last error: {}", url, max_retries, last_error))
}

fn verify_hash(path: &Path, expected: &str) -> bool {
    if let Ok(mut file) = File::open(path) {
        let mut hasher = Sha1::new();
        let mut buffer = [0; 8192]; // 8KB buffer
        loop {
            let n = match file.read(&mut buffer) {
                Ok(n) => n,
                Err(_) => return false,
            };
            if n == 0 { break; }
            hasher.update(&buffer[..n]);
        }
        let result = hasher.finalize();
        let actual = hex::encode(result);
        return actual == expected.to_lowercase();
    }
    false
}
