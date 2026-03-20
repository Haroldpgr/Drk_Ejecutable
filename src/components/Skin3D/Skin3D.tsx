import { useEffect, useRef } from "react";
import { SkinViewer } from "skinview3d";

interface Skin3DProps {
  skinUrl: string;
  width?: number;
  height?: number;
  autoRotate?: boolean;
  walking?: boolean;
  className?: string;
}

const DEFAULT_SKIN = "https://mc-heads.net/skin/steve";

export default function Skin3D({ 
  skinUrl, 
  width = 250, 
  height = 300, 
  autoRotate = true, 
  walking = false,
  className = "" 
}: Skin3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      // Initialize viewer
      const viewer = new SkinViewer({
        canvas: canvasRef.current,
        width: width,
        height: height,
        // Don't load skin in constructor to avoid issues if it fails
      });

      // Configuration
      viewer.autoRotate = autoRotate;
      viewer.autoRotateSpeed = 0.5;
      
      viewerRef.current = viewer;

      // Load initial skin safely
      loadSafeSkin(viewer, skinUrl);

      return () => {
        viewer.dispose();
      };
    } catch (error) {
      console.error("Error initializing SkinViewer:", error);
    }
  }, [width, height, walking, autoRotate]);

  // Update skin when skinUrl changes
  useEffect(() => {
    if (viewerRef.current) {
      loadSafeSkin(viewerRef.current, skinUrl);
    }
  }, [skinUrl]);

  const loadSafeSkin = (viewer: SkinViewer, url: string) => {
    if (!url || url.includes('dicebear.com')) {
      viewer.loadSkin(DEFAULT_SKIN).catch(console.error);
      return;
    }

    viewer.loadSkin(url).catch(err => {
      console.error("Error loading skin in 3D viewer, falling back to Steve:", err);
      // Attempt to load default skin as fallback
      viewer.loadSkin(DEFAULT_SKIN).catch(err2 => {
        console.error("Failed to load even the fallback skin:", err2);
      });
    });
  };

  return (
    <div className={`skin-3d-container ${className}`} style={{ width, height, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
