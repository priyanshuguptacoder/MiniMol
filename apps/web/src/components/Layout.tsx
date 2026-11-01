// src/components/Layout.tsx
import React from 'react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { useMediaQuery } from '../hooks/useMediaQuery'; // simple hook for responsive check
import { usePipelineCoordinator } from '../hooks/usePipelineCoordinator';

export default function Layout({ children }: { children: React.ReactNode }) {
  // Activate automatic pipeline WebRTC coordination across entire session
  usePipelineCoordinator();

  // Consider width >= 768px as desktop
  const isDesktop = useMediaQuery('(min-width: 768px)');
  return (
    <div className="flex h-screen bg-background text-text-primary">
      {isDesktop ? <Sidebar /> : <BottomNav />}
      <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
