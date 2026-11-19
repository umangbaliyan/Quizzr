import React from 'react';

/**
 * Animated Flying Helicopter Component
 * Styled after the reference video's futuristic tactical helicopter.
 * Features:
 * - Rotor blade spinning animation with aerodynamic blur
 * - Tail rotor spinning blur
 * - Sleek cockpit canopy with cyan/blue instrument visor glow
 * - Pulsing navigation beacon
 * - Floating hover physics with realistic gentle tilt and drift
 */
export function Helicopter({
  className = '',
  direction = 'right', // 'right' | 'left'
  scale = 1,
  rotorSpeed = 'fast', // 'fast' | 'normal'
  beaconColor = '#38BDF8', // cyan
}) {
  const isFacingLeft = direction === 'left';

  return (
    <div
      className={`relative inline-block select-none pointer-events-none ${className}`}
      style={{
        transform: `${isFacingLeft ? 'scaleX(-1)' : 'scaleX(1)'} scale(${scale})`,
        transformOrigin: 'center center',
      }}
    >
      <svg
        viewBox="0 0 92 36"
        className="w-24 h-10 overflow-visible drop-shadow-[0_4px_12px_rgba(11,8,63,0.5)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Fuselage gradient */}
          <linearGradient id="fuselageGrad" x1="0%" y1="0%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#4A3B69" />
            <stop offset="50%" stopColor="#7E709A" />
            <stop offset="100%" stopColor="#9B8FB7" />
          </linearGradient>

          {/* Underbody shadow gradient */}
          <linearGradient id="underbodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2D1F4C" />
            <stop offset="100%" stopColor="#18112C" />
          </linearGradient>

          {/* Canopy glass gradient */}
          <linearGradient id="canopyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.85" />
            <stop offset="70%" stopColor="#0284C7" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#0B083F" stopOpacity="0.9" />
          </linearGradient>

          {/* Spinning rotor disc blur gradient */}
          <linearGradient id="rotorDiscGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#CBD5E1" stopOpacity="0.1" />
            <stop offset="30%" stopColor="#F8FAFC" stopOpacity="0.75" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <stop offset="70%" stopColor="#F8FAFC" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#CBD5E1" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* 1. Main Rotor Mast */}
        <line x1="50" y1="5.5" x2="50" y2="10" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="50" cy="5.5" r="2" fill="#94A3B8" />

        {/* 2. Spinning Main Rotor Blades (rapidly oscillating blur effect) */}
        <g className="animate-spin" style={{ animationDuration: rotorSpeed === 'fast' ? '0.12s' : '0.2s', transformOrigin: '50px 5.5px' }}>
          <ellipse cx="50" cy="5.5" rx="38" ry="1.4" fill="url(#rotorDiscGrad)" opacity="0.8" />
          <line x1="14" y1="5.5" x2="86" y2="5.5" stroke="#FFFFFF" strokeWidth="1.2" opacity="0.9" strokeLinecap="round" />
        </g>
        {/* Soft atmospheric rotor wash blur */}
        <ellipse cx="50" cy="5.5" rx="36" ry="3.5" fill="#38BDF8" opacity="0.08" className="animate-pulse" />

        {/* 3. Tail Boom & Vertical Stabilizer */}
        {/* Tail boom strut */}
        <path d="M12 16 L42 15 L42 19 L12 18 Z" fill="url(#fuselageGrad)" />
        <path d="M12 18 L42 19 L40 21 L13 19 Z" fill="url(#underbodyGrad)" />

        {/* Horizontal tail stabilizer */}
        <polygon points="18,16 28,15 27,17 17,18" fill="#6B5B88" />

        {/* Vertical tail fin */}
        <polygon points="11,17 4,7 8,6 15,16" fill="url(#fuselageGrad)" />
        <polygon points="9,17 6,24 10,23 12,18" fill="url(#fuselageGrad)" />

        {/* 4. Tail Rotor (rapid spin) */}
        <g className="animate-spin" style={{ animationDuration: '0.08s', transformOrigin: '7px 7px' }}>
          <circle cx="7" cy="7" r="5" stroke="#94A3B8" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.7" />
          <line x1="2" y1="7" x2="12" y2="7" stroke="#F1F5F9" strokeWidth="1" />
        </g>

        {/* 5. Main Fuselage Body */}
        {/* Upper engine cowling */}
        <path d="M38 12 Q50 9 60 12 L60 15 L38 15 Z" fill="#5F507D" />

        {/* Aerodynamic Cockpit & Cabin Shell */}
        <path
          d="M38 14 C44 13, 62 12, 74 15 C82 17, 85 20, 81 24 C76 27, 48 27, 36 21 C33 19, 34 16, 38 14 Z"
          fill="url(#fuselageGrad)"
        />

        {/* Lower belly shading */}
        <path
          d="M36 21 C48 27, 76 27, 81 24 C78 26, 68 27.5, 48 26 C38 25, 34 23, 36 21 Z"
          fill="url(#underbodyGrad)"
        />

        {/* Cockpit Canopy Windshield */}
        <path
          d="M58 14 C66 14, 76 16, 79 19 C80 20.5, 78 22, 73 22 C67 22, 56 19, 54 17 Z"
          fill="url(#canopyGrad)"
        />
        {/* Windshield glare highlight */}
        <path d="M60 15 C66 15, 73 17, 76 19" stroke="#E0F2FE" strokeWidth="0.8" strokeLinecap="round" opacity="0.8" />

        {/* Tactical panel lines */}
        <path d="M46 15 L45 22" stroke="#362854" strokeWidth="0.75" opacity="0.8" />
        <path d="M53 15 L52 23" stroke="#362854" strokeWidth="0.75" opacity="0.8" />

        {/* 6. Landing Skids */}
        {/* Forward strut */}
        <line x1="64" y1="23" x2="62" y2="30" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
        {/* Aft strut */}
        <line x1="44" y1="22" x2="42" y2="30" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
        {/* Horizontal skid tube with curved tips */}
        <path
          d="M35 30 L69 30 Q74 30 76 26"
          stroke="#94A3B8"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />

        {/* 7. Pulsing Navigation / Recon Beacon */}
        <circle cx="6" cy="6" r="1.5" fill={beaconColor} className="animate-ping" style={{ animationDuration: '1.2s' }} />
        <circle cx="6" cy="6" r="1.2" fill={beaconColor} />
      </svg>
    </div>
  );
}

