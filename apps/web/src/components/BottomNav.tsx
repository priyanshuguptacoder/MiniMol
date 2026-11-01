// src/components/BottomNav.tsx
import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, LayoutGrid, Settings, PlusCircle, Send, Users, BarChart2, Archive } from 'lucide-react';
import { motion } from 'framer-motion';

const routes = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/sessions/create', label: 'Create', icon: PlusCircle },
  { to: '/sessions/join', label: 'Join', icon: Send },
  { to: '/network', label: 'Network', icon: Users },
  { to: '/playground', label: 'Play', icon: BarChart2 },
  { to: '/history', label: 'History', icon: Archive },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function BottomNav() {
  return (
    <motion.nav
      className="fixed bottom-0 left-0 right-0 bg-surface-secondary border-t border-border text-text-primary flex justify-around py-2"
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {routes.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-col items-center text-xs ${isActive ? 'text-accent' : ''}`
          }
        >
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
    </motion.nav>
  );
}
