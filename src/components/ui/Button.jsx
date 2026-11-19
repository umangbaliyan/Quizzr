import React from 'react';

/**
 * Reusable Button component adhering to the immersive Midnight Gaming design system.
 * 
 * Variants:
 * - primary: Sleek gaming CTA with deep midnight blue tone
 * - secondary: Secondary dark slate surface with subtle border
 * - danger: Error highlight for kick or destructive actions
 * - ghost: Transparent background, subtle hover
 * 
 * Sizes: 'sm', 'md', 'lg'
 */
export function Button({
  children,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  onClick,
  ...props
}) {
  const baseClasses =
    'inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3.5 text-base shadow-lg',
  };

  const variantClasses = {
    primary:
      'bg-gradient-to-r from-[#0F0B42] to-[#0B083F] text-white hover:from-[#171259] hover:to-[#120D54] shadow-md shadow-[#0B083F]/60 border border-[#231B68]/60 focus-visible:outline-[#3B349E]',
    secondary:
      'bg-[#18112C] text-[#F3F4F6] border border-[#342756] hover:bg-[#231840] hover:border-[#231B68] focus-visible:outline-[#3B349E]',
    danger:
      'bg-transparent text-[#F87171] border border-red-500/30 hover:bg-red-500/15 hover:border-red-500 focus-visible:outline-red-400',
    ghost:
      'bg-transparent text-[#A5A6C2] hover:text-[#F3F4F6] hover:bg-white/5 focus-visible:outline-[#3B349E]',
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${baseClasses} ${sizeClasses[size] || sizeClasses.md} ${variantClasses[variant] || variantClasses.primary} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
