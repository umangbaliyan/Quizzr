import React from 'react';
import { Helicopter } from './Helicopter.jsx';

/**
 * Animated gaming background inspired by the reference video:
 * - Deep midnight navy / purple gradient background
 * - Subtle twinkling stars
 * - Two soft atmospheric spotlight beams from top corners
 * - Distant silhouettes at the bottom
 * - Subtle floating geometric / gaming elements (controller, diamond, sparkle)
 */
export function GameBackground({ children, className = '' }) {
  return (
    <div className={`relative min-h-screen w-full bg-[#090614] text-[#F3F4F6] overflow-x-hidden ${className}`}>
      {/* Dynamic Starfield */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden select-none">
        {/* Soft background radial glows */}
        <div className="absolute top-[-10%] left-[20%] w-[600px] h-[500px] bg-purple-900/15 rounded-full blur-[140px]" />
        <div className="absolute top-[30%] right-[10%] w-[500px] h-[500px] bg-indigo-900/15 rounded-full blur-[140px]" />
        <div className="absolute bottom-[-5%] left-[30%] w-[600px] h-[400px] bg-violet-950/20 rounded-full blur-[150px]" />

        {/* Left Spotlight Beam */}
        <div
          className="absolute -top-10 left-[8%] w-[280px] h-[120vh] origin-top opacity-30 transform -rotate-[14deg] pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(59, 130, 246, 0.45) 0%, rgba(30, 27, 75, 0.15) 45%, transparent 85%)',
            clipPath: 'polygon(40% 0%, 60% 0%, 100% 100%, 0% 100%)',
            filter: 'blur(12px)',
          }}
        />

        {/* Right Spotlight Beam */}
        <div
          className="absolute -top-10 right-[8%] w-[280px] h-[120vh] origin-top opacity-30 transform rotate-[14deg] pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(30, 27, 75, 0.45) 0%, rgba(59, 130, 246, 0.15) 45%, transparent 85%)',
            clipPath: 'polygon(40% 0%, 60% 0%, 100% 100%, 0% 100%)',
            filter: 'blur(12px)',
          }}
        />

        {/* Floating Tactical Helicopters */}
        {/* Left Helicopter: Higher up, facing right towards the center */}
        <div className="absolute top-[20%] left-[8%] opacity-55 animate-heli-left hidden sm:block z-0 pointer-events-none">
          <Helicopter scale={1} direction="right" beaconColor="#38BDF8" />
        </div>

        {/* Right Helicopter: Slightly lower, facing left towards the center */}
        <div className="absolute top-[32%] right-[8%] opacity-55 animate-heli-right hidden sm:block z-0 pointer-events-none">
          <Helicopter scale={1} direction="left" beaconColor="#F43F5E" />
        </div>

        {/* Floating Gaming / Atmospheric Elements */}
        {/* Left Floating Drone / Tech Rig */}
        <div className="absolute top-20 left-[5%] opacity-30 animate-float-slow hidden lg:block">
          <svg className="w-14 h-14 text-indigo-400/40" viewBox="0 0 64 64" fill="none" stroke="currentColor">
            <ellipse cx="32" cy="28" rx="20" ry="9" strokeWidth="2" strokeDasharray="3 3" />
            <circle cx="32" cy="28" r="5" fill="currentColor" fillOpacity="0.3" />
            <path d="M12 28 L6 20 M52 28 L58 20 M32 37 L32 46" strokeWidth="2" strokeLinecap="round" />
            <path d="M26 46 L38 46" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        {/* Right Floating Satellite / Beacon */}
        <div className="absolute top-24 right-[7%] opacity-35 animate-float-delayed hidden md:block">
          <svg className="w-14 h-14 text-purple-400/40" viewBox="0 0 64 64" fill="none" stroke="currentColor">
            <ellipse cx="32" cy="26" rx="22" ry="8" strokeWidth="2" />
            <circle cx="32" cy="26" r="6" fill="currentColor" fillOpacity="0.3" />
            <path d="M32 14 L32 6 M24 6 L40 6" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 34 L16 46 M42 34 L48 46" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        {/* Floating Diamonds / Sparkles */}
        <div className="absolute top-[42%] left-[12%] opacity-40 animate-pulse text-indigo-300">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0 L15 9 L24 12 L15 15 L12 24 L9 15 L0 12 L9 9 Z" />
          </svg>
        </div>
        <div className="absolute top-[28%] right-[16%] opacity-35 animate-pulse text-purple-300">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0 L15 9 L24 12 L15 15 L12 24 L9 15 L0 12 L9 9 Z" />
          </svg>
        </div>
        <div className="absolute top-[65%] right-[10%] opacity-25 animate-float-slow text-violet-300 hidden sm:block">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
          </svg>
        </div>

        {/* Twinkling Star Points */}
        <div className="absolute top-[15%] left-[25%] w-1.5 h-1.5 rounded-full bg-white/70 animate-ping" style={{ animationDuration: '3s' }} />
        <div className="absolute top-[22%] right-[32%] w-1.5 h-1.5 rounded-full bg-indigo-200/60 animate-ping" style={{ animationDuration: '4s' }} />
        <div className="absolute top-[60%] left-[8%] w-1 h-1 rounded-full bg-white/50" />
        <div className="absolute top-[75%] left-[22%] w-1.5 h-1.5 rounded-full bg-purple-200/60" />
        <div className="absolute top-[18%] left-[78%] w-1 h-1 rounded-full bg-white/60" />
        <div className="absolute top-[50%] right-[25%] w-1 h-1 rounded-full bg-white/40" />
        <div className="absolute top-[80%] right-[18%] w-1 h-1 rounded-full bg-indigo-200/50" />

        {/* Distant City Skyline Silhouettes at bottom */}
        <div className="absolute bottom-0 inset-x-0 h-28 pointer-events-none opacity-20 flex items-end justify-between overflow-hidden">
          <div className="w-[10%] h-24 bg-gradient-to-t from-[#0B083F]/80 to-transparent rounded-t-sm" />
          <div className="w-[7%] h-32 bg-gradient-to-t from-[#0F0B42]/90 to-transparent rounded-t-sm" />
          <div className="w-[12%] h-18 bg-gradient-to-t from-indigo-950/70 to-transparent rounded-t-sm" />
          <div className="w-[15%] h-28 bg-gradient-to-t from-[#0B083F]/80 to-transparent rounded-t-sm" />
          <div className="w-[10%] h-36 bg-gradient-to-t from-[#0F0B42]/90 to-transparent rounded-t-sm" />
          <div className="w-[14%] h-20 bg-gradient-to-t from-indigo-950/70 to-transparent rounded-t-sm" />
          <div className="w-[12%] h-30 bg-gradient-to-t from-[#0B083F]/80 to-transparent rounded-t-sm" />
          <div className="w-[8%] h-22 bg-gradient-to-t from-[#0B083F]/75 to-transparent rounded-t-sm" />
          <div className="w-[12%] h-26 bg-gradient-to-t from-[#0F0B42]/80 to-transparent rounded-t-sm" />
        </div>
      </div>

      {/* Content wrapper */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}

