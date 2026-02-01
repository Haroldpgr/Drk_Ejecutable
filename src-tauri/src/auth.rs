use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;
use oauth2::{
    basic::BasicClient, AuthUrl, ClientId, CsrfToken, PkceCodeChallenge, RedirectUrl, Scope,
    TokenUrl, TokenResponse, PkceCodeVerifier, AuthorizationCode
};
use oauth2::reqwest::async_http_client;
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use reqwest::Client;

#[derive(Default, Serialize, Clone, Debug)]
pub struct MinecraftProfile {
    pub id: String,
    pub name: String,
    pub access_token: String,
    pub has_entitlement: bool,
}

#[derive(Default)]
pub struct AuthState {
    pub pkce_verifier: Option<PkceCodeVerifier>,
    pub csrf_token: Option<CsrfToken>,
    pub profile: Option<MinecraftProfile>,
}

pub struct AppState {
    pub auth: Mutex<AuthState>,
}

#[derive(Deserialize)]
struct XboxLiveResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: serde_json::Value,
}

#[derive(Deserialize)]
struct MinecraftLoginResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct MinecraftProfileResponse {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct EntitlementsResponse {
    items: Vec<EntitlementItem>,
}

#[derive(Deserialize)]
struct EntitlementItem {
    name: String,
}

#[tauri::command]
pub async fn start_microsoft_login(state: State<'_, AppState>) -> Result<String, String> {
    let client_id = ClientId::new("00000000402b5328".to_string()); // Public Minecraft Client ID
    let auth_url = AuthUrl::new("https://login.live.com/oauth20_authorize.srf".to_string())
        .map_err(|e| e.to_string())?;
    let token_url = TokenUrl::new("https://login.live.com/oauth20_token.srf".to_string())
        .map_err(|e| e.to_string())?;
    
    let redirect_url = RedirectUrl::new("http://localhost:3434/auth/callback".to_string())
        .map_err(|e| e.to_string())?;

    let client = BasicClient::new(
        client_id,
        None,
        auth_url,
        Some(token_url)
    )
    .set_redirect_uri(redirect_url);

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let (auth_url, csrf_token) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new("XboxLive.signin".to_string()))
        .add_scope(Scope::new("offline_access".to_string()))
        .set_pkce_challenge(pkce_challenge)
        .url();

    // Store verifier for later use in the callback
    {
        let mut auth_state = state.auth.lock().map_err(|_| "Failed to lock auth state".to_string())?;
        auth_state.pkce_verifier = Some(pkce_verifier);
        auth_state.csrf_token = Some(csrf_token);
    } // unlock

    // Spawn the local server to listen for the callback

    // Open browser
    if let Err(e) = open::that(auth_url.to_string()) {
        return Err(format!("Failed to open browser: {}", e));
    }

    // Start listener
    let listener = TcpListener::bind("127.0.0.1:3434").await.map_err(|e| e.to_string())?;

    // Accept one connection
    let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;

    let mut buffer = [0; 1024];
    let n = stream.read(&mut buffer).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..n]);

    // Parse code from request
    // GET /auth/callback?code=M... HTTP/1.1
    let code = if let Some(start) = request.find("code=") {
        let rest = &request[start + 5..];
        let end = rest.find('&').or_else(|| rest.find(' ')).unwrap_or(rest.len());
        &rest[..end]
    } else {
        return Err("No code found in callback".to_string());
    };

    let code = AuthorizationCode::new(code.to_string());

    // Exchange code for token
    let pkce_verifier = {
        let mut auth_state = state.auth.lock().map_err(|_| "Failed to lock auth state".to_string())?;
        auth_state.pkce_verifier.take().ok_or("No PKCE verifier found")?
    };

    let token_result = client
        .exchange_code(code)
        .set_pkce_verifier(pkce_verifier)
        .request_async(async_http_client)
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    let access_token = token_result.access_token().secret();

    // Authenticate with Xbox Live
    let client_http = Client::new();
    let xbl_body = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={}", access_token)
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });

    let xbl_res: XboxLiveResponse = client_http.post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&xbl_body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let xbl_token = xbl_res.token;
    let uhs = xbl_res.display_claims["xui"][0]["uhs"].as_str().ok_or("No UHS found")?;

    // Authenticate with XSTS
    let xsts_body = serde_json::json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [xbl_token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });

    let xsts_res: XboxLiveResponse = client_http.post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&xsts_body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let xsts_token = xsts_res.token;

    // Authenticate with Minecraft
    let mc_res: MinecraftLoginResponse = client_http.post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&serde_json::json!({
            "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token)
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let mc_token = mc_res.access_token;

    // Get Profile
    let profile_res: MinecraftProfileResponse = client_http.get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", mc_token))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // Check Entitlements
    let entitlements_ok = {
        let ents: EntitlementsResponse = client_http
            .get("https://api.minecraftservices.com/entitlements/mcstore")
            .header("Authorization", format!("Bearer {}", mc_token))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        ents.items.iter().any(|it| {
            let n = it.name.to_lowercase();
            n.contains("game_minecraft") || n.contains("product_minecraft") || n.contains("minecraft")
        })
    };

    // Save profile to state
    {
        let mut auth_state = state.auth.lock().map_err(|_| "Failed to lock auth state".to_string())?;
        auth_state.profile = Some(MinecraftProfile {
            id: profile_res.id,
            name: profile_res.name.clone(),
            access_token: mc_token,
            has_entitlement: entitlements_ok,
        });
    }

    // Send success response to browser
    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h1>Login Successful!</h1><p>You can close this window and return to the launcher.</p><script>window.close()</script></body></html>";
    stream.write_all(response.as_bytes()).await.map_err(|e| e.to_string())?;

    Ok(format!("Logged in as {}", profile_res.name))
}

#[tauri::command]
pub fn get_auth_profile(state: State<'_, AppState>) -> Result<Option<MinecraftProfile>, String> {
    let auth_state = state.auth.lock().map_err(|_| "Failed to lock auth state".to_string())?;
    Ok(auth_state.profile.clone())
}

#[tauri::command]
pub async fn start_offline_login(username: String, state: State<'_, AppState>) -> Result<String, String> {
    let mut auth_state = state.auth.lock().map_err(|_| "Failed to lock auth state".to_string())?;
    auth_state.profile = Some(MinecraftProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: username,
        access_token: "offline".to_string(),
        has_entitlement: false,
    });
    Ok("Logged in offline".to_string())
}
