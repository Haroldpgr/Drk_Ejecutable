# Drk_Ejecutable (DrkLauncher)

Launcher de Minecraft construido con React + Vite (frontend) y Tauri 2 (backend en Rust). Soporta instalación y arranque de versiones Vanilla y Forge, descarga automática de librerías/recursos y gestión de Java requerida por cada versión.

## Requisitos
- Node.js 18+ y npm
- Rust toolchain y requisitos de Tauri para Windows (MSVC, Visual Studio Build Tools)
- Git (opcional, para clonar y publicar)

## Instalación
```bash
npm install
```

## Desarrollo
```bash
npm run tauri dev
```

## Build
```bash
npm run build
npm run tauri build
```

## Características
- Descarga y verificación de assets y librerías en paralelo
- Detección/descarga automática de Java por versión requerida
- Arranque de Vanilla y Forge con module-path y classpath correctos
- Generación de logs de arranque en la carpeta de la instancia

## IDE recomendado
- VS Code con extensiones: Tauri, rust-analyzer
