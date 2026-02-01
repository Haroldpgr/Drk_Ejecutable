import { useState } from "react";
import "./InstanceCard.css";

interface Instance {
  id: string;
  name: string;
  version: string;
  lastPlayed: string;
  icon: string;
  path: string;
  image?: string;
}

interface InstanceCardProps {
  instance: Instance;
  isSelected: boolean;
  onClick: () => void;
}

export default function InstanceCard({ instance, isSelected, onClick }: InstanceCardProps) {
  const [imageError, setImageError] = useState(false);
  
  // Default image if not provided
  const instanceImage = instance.image || `https://api.dicebear.com/7.x/shapes/svg?seed=${instance.name}`;
  
  // Get first letter for fallback icon
  const firstLetter = instance.name[0].toUpperCase();

  return (
    <div
      className={`instance-card ${isSelected ? "instance-card-selected" : ""}`}
      onClick={onClick}
    >
      <div className="instance-card-image-wrapper">
        <div className="instance-card-image-container">
          {instance.image && !imageError ? (
            <img
              src={instanceImage}
              alt={instance.name}
              className="instance-card-image"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="instance-card-fallback">
              {firstLetter}
            </div>
          )}
          {isSelected && <div className="instance-card-selected-indicator"></div>}
        </div>
        <div className="instance-card-info">
          <h3 className="instance-card-name" title={instance.name}>{instance.name}</h3>
          <p className="instance-card-version">{instance.version}</p>
        </div>
      </div>
    </div>
  );
}
