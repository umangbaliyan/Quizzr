import React from 'react';

/**
 * Reusable accessible Input component with dark midnight gaming styling.
 */
export function Input({
  label,
  id,
  error,
  helperText,
  type = 'text',
  placeholder = '',
  value,
  onChange,
  disabled = false,
  className = '',
  required = false,
  ...props
}) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-[#A5A6C2] uppercase tracking-wider">
          {label} {required && <span className="text-[#F87171]">*</span>}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={`w-full px-4 py-3 rounded-xl bg-[#0B0617] text-[#F3F4F6] border text-sm placeholder-[#716A8C] focus:outline-none focus:border-[#4338CA] focus:ring-2 focus:ring-[#3B349E]/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
          error ? 'border-[#EF4444] focus:border-[#EF4444] focus:ring-red-500/20' : 'border-[#2D1F4C]'
        } ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-[#F87171] font-medium">{error}</span>}
      {!error && helperText && <span className="text-xs text-[#A5A6C2]">{helperText}</span>}
    </div>
  );
}
