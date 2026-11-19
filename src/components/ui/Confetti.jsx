import React, { useEffect, useRef } from 'react';

/**
 * Lightweight Canvas-based Confetti Cannon
 * Emits vibrant celebration particles launching upwards from the bottom and gently floating across the screen.
 * Zero external dependencies.
 */
export function Confetti({ duration = 7000, particleCount = 140 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Festive palette: Golds, silvers, bronzes, emeralds, royal blues, electric cyans
    const colors = [
      '#FFD700', // Gold
      '#FBBF24', // Amber gold
      '#E2E8F0', // Silver
      '#CD7F32', // Bronze
      '#60A5FA', // Sky Blue
      '#34D399', // Emerald
      '#F472B6', // Rose
      '#A78BFA', // Violet
      '#38BDF8', // Cyan
    ];

    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      // Launch from bottom corners and bottom center upwards
      const originMode = i % 3; // 0 = left corner, 1 = right corner, 2 = bottom spread
      let startX, startVx, startVy;

      if (originMode === 0) {
        // Bottom left corner launching up and inwards to the right
        startX = Math.random() * (width * 0.25);
        startVx = Math.random() * 2.8 + 0.8;
        startVy = -(Math.random() * 3.5 + 4.5);
      } else if (originMode === 1) {
        // Bottom right corner launching up and inwards to the left
        startX = width - Math.random() * (width * 0.25);
        startVx = -(Math.random() * 2.8 + 0.8);
        startVy = -(Math.random() * 3.5 + 4.5);
      } else {
        // Bottom center launching gently upward in both directions
        startX = width * 0.25 + Math.random() * (width * 0.5);
        startVx = (Math.random() - 0.5) * 3;
        startVy = -(Math.random() * 4 + 4.2);
      }

      particles.push({
        x: startX,
        y: height + Math.random() * 20,
        vx: startVx,
        vy: startVy,
        // Gentle gravity so it arches gracefully and falls slowly
        gravity: 0.045,
        drag: 0.993, // slight air resistance for smooth float
        size: Math.random() * 6 + 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 4.5,
        shape: Math.random() > 0.4 ? 'rect' : 'circle',
        opacity: 1,
        oscillation: Math.random() * 20,
        oscillationSpeed: Math.random() * 0.03 + 0.015,
        delay: Math.random() * 1200, // staggered launch over first ~1.2s
      });
    }

    const startTime = Date.now();

    const render = () => {
      const elapsed = Date.now() - startTime;
      ctx.clearRect(0, 0, width, height);

      let anyAlive = false;

      particles.forEach((p) => {
        // Wait for staggered launch delay
        if (elapsed < p.delay) return;

        // Apply physics with drag and gentle gravity
        p.vx *= p.drag;
        p.vy = p.vy * p.drag + p.gravity;
        p.x += p.vx + Math.sin(p.oscillation) * 0.9;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.oscillation += p.oscillationSpeed;

        // Smooth fade out during last 2 seconds
        if (elapsed > duration - 2000) {
          p.opacity = Math.max(0, (duration - elapsed) / 2000);
        }

        if (p.opacity > 0 && p.y < height + 80) {
          anyAlive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;

          if (p.shape === 'rect') {
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.restore();
        }
      });

      if (elapsed < duration && anyAlive) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [duration, particleCount]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50 w-full h-full"
      style={{ pointerEvents: 'none' }}
    />
  );
}

