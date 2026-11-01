// src/pages/SettingsPage.tsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Save, RotateCcw, CheckCircle } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useSettingsStore } from '../stores/useSettingsStore';

export default function SettingsPage() {
  const settings = useSettingsStore();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    settings.save();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <motion.div className="max-w-2xl mx-auto py-8 space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="text-3xl font-bold">Settings</h1>

      <div className="p-5 bg-surface rounded-lg space-y-4">
        <h2 className="text-lg font-semibold">Signaling Server</h2>
        <Input
          label="Signaling Server URL"
          value={settings.signalingUrl}
          onChange={e => settings.update({ signalingUrl: e.target.value })}
          placeholder="http://localhost:4000"
        />
      </div>

      <div className="p-5 bg-surface rounded-lg space-y-4">
        <h2 className="text-lg font-semibold">STUN / TURN</h2>
        <div>
          <label className="text-text-secondary text-sm block mb-1">STUN URLs (comma-separated)</label>
          <textarea
            className="w-full px-3 py-2 bg-surface-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent h-20 resize-none"
            value={settings.stunUrls.join('\n')}
            onChange={e => settings.update({ stunUrls: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
          />
        </div>
        <Input
          label="TURN Server URL (optional)"
          value={settings.turnUrl}
          onChange={e => settings.update({ turnUrl: e.target.value })}
          placeholder="turn:your-turn-server:3478"
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="TURN Username"
            value={settings.turnUsername}
            onChange={e => settings.update({ turnUsername: e.target.value })}
          />
          <Input
            label="TURN Credential"
            type="password"
            value={settings.turnCredential}
            onChange={e => settings.update({ turnCredential: e.target.value })}
          />
        </div>
      </div>

      <div className="p-5 bg-surface rounded-lg space-y-4">
        <h2 className="text-lg font-semibold">Model &amp; Inference</h2>
        <Input
          label="Manifest URL"
          value={settings.manifestUrl}
          onChange={e => settings.update({ manifestUrl: e.target.value })}
          placeholder="/models/manifest.json"
        />
        <div>
          <label className="text-text-secondary text-sm block mb-2">Inference Backend</label>
          <div className="flex gap-3">
            {(['wasm', 'webgpu'] as const).map(b => (
              <button
                key={b}
                onClick={() => settings.update({ inferenceBackend: b })}
                className={`px-4 py-2 rounded border text-sm ${
                  settings.inferenceBackend === b
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-secondary hover:border-border-hover'
                }`}
              >
                {b.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <Input
          label="Max Devices per Session"
          type="number"
          min={1}
          max={8}
          value={settings.maxDevices}
          onChange={e => settings.update({ maxDevices: Number(e.target.value) })}
        />
      </div>

      <div className="p-5 bg-surface rounded-lg space-y-4">
        <h2 className="text-lg font-semibold">Heartbeat</h2>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={settings.enableHeartbeat}
            onChange={e => settings.update({ enableHeartbeat: e.target.checked })}
            className="accent-accent"
            id="hb"
          />
          <label htmlFor="hb" className="text-text-secondary text-sm">Enable heartbeat</label>
        </div>
        {settings.enableHeartbeat && (
          <Input
            label="Heartbeat Interval (ms)"
            type="number"
            min={1000}
            max={60000}
            value={settings.heartbeatIntervalMs}
            onChange={e => settings.update({ heartbeatIntervalMs: Number(e.target.value) })}
          />
        )}
      </div>

      <div className="p-5 bg-surface rounded-lg space-y-4">
        <h2 className="text-lg font-semibold">Privacy</h2>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={settings.storeHistory}
            onChange={e => settings.update({ storeHistory: e.target.checked })}
            className="accent-accent"
            id="hist"
          />
          <label htmlFor="hist" className="text-text-secondary text-sm">
            Store session history locally (prompts are NOT stored by default)
          </label>
        </div>
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSave} className="flex items-center gap-2 flex-1 justify-center">
          {saved ? <CheckCircle size={16} className="text-success" /> : <Save size={16} />}
          {saved ? 'Saved!' : 'Save Settings'}
        </Button>
        <Button
          onClick={() => { if (confirm('Reset all settings to defaults?')) settings.reset(); }}
          className="flex items-center gap-2 bg-surface-secondary hover:bg-surface-tertiary"
        >
          <RotateCcw size={16} /> Reset
        </Button>
      </div>
    </motion.div>
  );
}
