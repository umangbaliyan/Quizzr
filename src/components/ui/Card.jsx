import React from 'react';

/**
 * Reusable Card component for Midnight Gaming aesthetic.
 * 
 * Variants:
 * - primary: Background #110B22, border #2B1E48 with subtle glow
 * - secondary: Background #18112C, border #342756
 */
export function Card({
  children,
  variant = 'primary',
  className = '',
  ...props
}) {
  const variantClasses = {
    primary: 'bg-[#110B22]/95 border-[#2E204E] shadow-2xl shadow-purple-950/40 backdrop-blur-md',
    secondary: 'bg-[#18112C]/90 border-[#38265E] shadow-xl backdrop-blur-md',
  };

  return (
    <div
      className={`border rounded-2xl p-6 ${variantClasses[variant] || variantClasses.primary} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
