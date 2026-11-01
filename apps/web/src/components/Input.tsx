// src/components/Input.tsx
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input: React.FC<InputProps> = ({ label, className, ...rest }) => {
  return (
    <div className="flex flex-col space-y-1">
      {label && <label className="text-text-secondary text-sm">{label}</label>}
      <input
        className={`px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:border-accent ${className}`}
        {...rest}
      />
    </div>
  );
};
