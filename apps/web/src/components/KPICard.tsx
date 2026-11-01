// src/components/KPICard.tsx
import React from 'react';
import { motion } from 'framer-motion';

interface KPICardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
}

export default function KPICard({ title, value, icon }: KPICardProps) {
  return (
    <motion.div
      className="bg-surface p-4 rounded shadow-sm flex items-center space-x-4"
      whileHover={{ scale: 1.02 }}
    >
      {icon && <div className="text-accent">{icon}</div>}
      <div>
        <div className="text-sm text-text-secondary">{title}</div>
        <div className="text-xl font-medium text-text-primary">{value}</div>
      </div>
    </motion.div>
  );
}
