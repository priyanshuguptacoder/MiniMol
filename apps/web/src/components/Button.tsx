// src/components/Button.tsx
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ children, className, ...rest }) => {
  return (
    <button
      className={`px-4 py-2 bg-accent text-text-primary rounded hover:bg-accent-hover transition ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};
