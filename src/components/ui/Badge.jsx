import React from 'react';

/**
 * Reusable Badge component for metadata, statuses, and player tags.
 * 
 * Variants:
 * - neutral: Surface #18112C, text #A5A6C2, border #2E204E
 * - accent: Surface purple-900/30, text purple-300, border purple-500/40
 * - success: Surface emerald-900/30, text emerald-300, border emerald-500/40
 * - error: Surface red-900/30, text red-300, border red-500/40
 */
export function Badge({
  children,
  variant = 'neutral',
  className = '',
  ...props
}) {
  const variantClasses = {
    neutral: 'bg-[#18112C] text-[#A5A6C2] border-[#2E204E]',
    accent: 'bg-purple-900/30 text-purple-300 border-purple-500/40 shadow-sm shadow-purple-900/20',
    success: 'bg-emerald-900/30 text-emerald-300 border-emerald-500/40',
    error: 'bg-red-900/30 text-red-300 border-red-500/40',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full border ${
        variantClasses[variant] || variantClasses.neutral
      } ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
