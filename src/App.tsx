import { useEffect, useState } from 'react';

type Health = { status: string; runtime: string; version: string; backend: string; model_provider: string };
type Capabilities = { capabilities: string[]; backend: string; model_provider: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState({ backend: '', provider: '' });
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      fetch('/health').then(response => response.ok ? response.json() : Promise.reject(new Error('Health unavailable'))),
      fetch('/v1/runtime/capabilities').then(response =>
        response.ok ? response.json() : Promise.reject(new Error('Capabilities unavailable'))),
    ]).then(([healthResponse, capabilityResponse]: [Health, Capabilities]) => {
      setHealth(healthResponse);
      setCapabilities(capabilityResponse.capabilities);
      setRuntimeConfig({ backend: capabilityResponse.backend, provider: capabilityResponse.model_provider });
    }).catch(cause => setError(cause instanceof Error ? cause.message : 'Runtime unavailable'));
  }, []);

  return <main className="min-h-screen bg-[#0A0B0D] text-[#E1E4E8] p-8">
    <div className="max-w-4xl mx-auto">
      <header className="border-b border-[#2D3139] pb-6 mb-8 flex justify-between items-end">
        <div><p className="text-xs text-[#58A6FF] font-mono">OPEN SOURCE LEARNING AGENT</p>
          <h1 className="text-4xl font-bold mt-2">EGO Runtime</h1></div>
        <span className={`px-3 py-1 border rounded text-xs ${health ? 'border-green-600 text-green-400' : 'border-slate-600'}`}>
          {error || (health ? 'HEALTHY' : 'CONNECTING')}
        </span>
      </header>
      <section className="grid md:grid-cols-3 gap-4 mb-8">
        {[
          ['Version', health?.version ?? ''],
          ['Backend', runtimeConfig.backend],
          ['Model provider', runtimeConfig.provider],
        ].map(([key, value]) =>
          <div key={key} className="bg-[#16181D] border border-[#2D3139] rounded p-5">
            <p className="text-xs text-slate-500 uppercase">{key}</p>
            <p className="mt-2 font-mono">{value}</p>
          </div>)}
      </section>
      <section className="bg-[#16181D] border border-[#2D3139] rounded p-6">
        <h2 className="font-semibold mb-4">Advertised capabilities</h2>
        <div className="flex flex-wrap gap-2">{capabilities.map(capability =>
          <span key={capability} className="px-3 py-2 bg-[#0F1115] border border-[#2D3139] rounded font-mono text-sm">
            {capability}
          </span>)}</div>
        {!capabilities.length && !error && <p className="text-slate-500">Loading runtime contract&</p>}
      </section>
      <p className="text-slate-500 text-sm mt-8">
        Operational jobs are exposed through the authenticated API. Client and orchestration layers remain separate.
      </p>
    </div>
  </main>;
}
