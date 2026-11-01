// src/components/Sidebar.tsx
import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, LayoutGrid, Settings, PlusCircle, Send, Users, BarChart2, Archive } from 'lucide-react';
import { motion } from 'framer-motion';

const routes = [
  { to: '/', label: 'Landing', icon: Home },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/sessions/create', label: 'Create Session', icon: PlusCircle },
  { to: '/sessions/join', label: 'Join Session', icon: Send },
  { to: '/network', label: 'Network', icon: Users },
  { to: '/playground', label: 'Playground', icon: BarChart2 },
  { to: '/history', label: 'History', icon: Archive },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  return (
    <motion.aside
      className="w-64 bg-surface-secondary text-text-primary flex flex-col"
      initial={{ x: -200 }}
      animate={{ x: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="p-4 text-xl font-bold">SplitInfer</div>
      <nav className="flex-1 space-y-2">
        {routes.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2 rounded hover:bg-surface-tertiary transition-colors ${
                isActive ? 'bg-accent text-background' : ''
              }`
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>
    </motion.aside>
  );
}
