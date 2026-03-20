import { useState, FormEvent } from "react";
import { ArrowLeft, User, Mail, Lock, LogIn } from "lucide-react";
import { supabase } from "../../supabase";
import "./OfflineLogin.css";

interface OfflineLoginProps {
  onBack: () => void;
  onLogin: (username: string, email: string, avatar: string, authType: "microsoft" | "offline") => void;
  isLoading: boolean;
  showToast: (message: string, type: "success" | "error" | "info" | "warning") => void;
}

export default function OfflineLogin({ onBack, onLogin, isLoading, showToast }: OfflineLoginProps) {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [localLoading, setLocalLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLocalLoading(true);

    // Limpiar espacios en blanco al principio y al final
    const cleanEmail = email.trim();
    const cleanUsername = username.trim();
    const cleanPassword = password; // Las contraseñas no se suelen trimar por seguridad

    try {
      if (isLoginMode) {
        // LOGIN DUAL (Usuario o Correo)
        let loginEmail = cleanEmail;

        // Si no parece un correo (no tiene @), buscamos el correo asociado a ese nombre de usuario
        if (!cleanEmail.includes("@")) {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('email')
            .eq('username', cleanEmail)
            .single();
          
          if (profileError || !profile) {
            throw new Error("No se encontró ningún usuario con ese nombre.");
          }
          loginEmail = profile.email;
        }

        // LOGIN CON SUPABASE usando el email resuelto
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password: cleanPassword,
        });

        if (authError) throw authError;

        // Obtener perfil completo del usuario
        let { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        // AUTOCORRECCIÓN: Si el usuario existe en Auth pero no en Profiles (por errores previos)
        if (profileError || !profile) {
          console.log("Perfil no encontrado, intentando crear uno nuevo...");
          const fallbackUsername = data.user.email?.split('@')[0] || "Usuario";
          const fallbackAvatar = `https://mc-heads.net/skin/${fallbackUsername}`;
          
          const { data: newProfile, error: createError } = await supabase
            .from('profiles')
            .upsert([
              { id: data.user.id, username: fallbackUsername, email: data.user.email, avatar_url: fallbackAvatar }
            ])
            .select()
            .single();
          
          if (createError) throw new Error("Error al recuperar tu perfil. Contacta con el admin.");
          profile = newProfile;
        }

        showToast("¡Sesión iniciada con éxito!", "success");
        onLogin(profile.username, profile.email, profile.avatar_url || "", "offline");
      } else {
        // REGISTRO CON SUPABASE
        const { data, error: authError } = await supabase.auth.signUp({
          email: cleanEmail,
          password: cleanPassword,
        });

        if (authError) throw authError;
        if (!data.user) throw new Error("Error al crear usuario");

        // Crear perfil en la tabla 'profiles'
        const avatar = `https://mc-heads.net/skin/${cleanUsername}`;
        const { error: profileError } = await supabase
          .from('profiles')
          .insert([
            { id: data.user.id, username: cleanUsername, email: cleanEmail, avatar_url: avatar }
          ]);

        if (profileError) {
          console.error("Error al crear perfil:", profileError);
          // No lanzamos error aquí para no bloquear al usuario si el Auth ya funcionó
        }

        showToast("¡Cuenta creada con éxito!", "success");
        setIsLoginMode(true);
      }
    } catch (err: any) {
      console.error(err);
      
      // TRADUCCIÓN DE ERRORES PARA EL USUARIO
      let userFriendlyError = err.message;

      if (err.message.includes("Password should contain at least one character")) {
        userFriendlyError = "La contraseña debe tener: una mayúscula, una minúscula y un número.";
      } else if (err.message.includes("Invalid login credentials")) {
        userFriendlyError = "Correo o contraseña incorrectos. Verifica tus datos.";
      } else if (err.message.includes("User already registered")) {
        userFriendlyError = "Este correo ya está registrado. Intenta iniciar sesión.";
      } else if (err.message.includes("Email not confirmed")) {
        userFriendlyError = "Debes confirmar tu correo electrónico para entrar.";
      } else if (err.message.includes("rate limit exceeded")) {
        userFriendlyError = "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
      } else if (err.message.includes("Password is too short")) {
        userFriendlyError = "La contraseña es muy corta (mínimo 6 caracteres).";
      }

      showToast(userFriendlyError, "error");
      setError(userFriendlyError);
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <div className="drk-login-container">
      {/* Animated Background */}
      <div className="drk-login-background">
        <div className="drk-stars"></div>
        <div className="drk-nebula"></div>
      </div>

      <div className="drk-login-card">
        <button className="drk-back-button" onClick={onBack} title="Volver">
          <ArrowLeft size={20} />
        </button>

        <div className="drk-login-header">
          <div className="drk-logo-container">
            <div className="drk-logo-glow"></div>
            <User size={40} className="drk-login-icon" />
          </div>
          <h2 className="drk-title">{isLoginMode ? "Bienvenido de nuevo" : "Crea tu cuenta"}</h2>
          <p className="drk-subtitle">
            {isLoginMode ? "Inicia sesión en tu cuenta DRK" : "Regístrate para acceder al launcher"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="drk-login-form">
          {isLoginMode ? (
            <div className="drk-input-wrapper">
              <Mail className="drk-input-icon" size={18} />
              <input
                type="text"
                placeholder="Usuario o Correo"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="drk-input"
                required
              />
            </div>
          ) : (
            <>
              <div className="drk-input-wrapper">
                <User className="drk-input-icon" size={18} />
                <input
                  type="text"
                  placeholder="Nombre de usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="drk-input"
                  required
                />
              </div>
              <div className="drk-input-wrapper">
                <Mail className="drk-input-icon" size={18} />
                <input
                  type="email"
                  placeholder="Correo electrónico"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="drk-input"
                  required
                />
              </div>
            </>
          )}

          <div className="drk-input-wrapper">
            <Lock className="drk-input-icon" size={18} />
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="drk-input"
              required
            />
          </div>

          {error && (
            <div className="drk-error-container">
              <span>{error}</span>
            </div>
          )}

          <button 
            type="submit" 
            className="drk-submit-button" 
            disabled={isLoading || localLoading}
          >
            {isLoading || localLoading ? (
              <div className="drk-spinner"></div>
            ) : (
              <>
                <LogIn size={20} />
                <span>{isLoginMode ? "Iniciar Sesión" : "Crear Cuenta"}</span>
              </>
            )}
          </button>
        </form>

        <div className="drk-login-footer">
          <button className="drk-toggle-mode" onClick={() => setIsLoginMode(!isLoginMode)}>
            {isLoginMode ? (
              <>¿No tienes cuenta? <span>Regístrate</span></>
            ) : (
              <>¿Ya tienes cuenta? <span>Inicia sesión</span></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

