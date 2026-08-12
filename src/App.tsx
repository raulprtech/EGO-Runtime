/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export default function App() {
  return (
    <div className="flex w-full h-screen bg-[#0A0B0D] text-[#E1E4E8] font-sans overflow-hidden border-8 border-[#16181D]">
      <nav className="w-64 border-r border-[#2D3139] bg-[#0F1115] flex flex-col shrink-0">
        <div className="p-6 border-b border-[#2D3139]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#58A6FF] rounded-sm flex items-center justify-center font-bold text-black text-xs">E</div>
            <div>
              <h1 className="font-bold text-sm tracking-tight">EGO RUNTIME</h1>
              <p className="text-[10px] text-slate-500 font-mono">v1.0.0-GEN1</p>
            </div>
          </div>
        </div>
        <div className="flex-1 py-4 overflow-y-auto">
          <div className="px-6 mb-2 text-[10px] uppercase tracking-widest text-slate-500 font-bold">System Monitor</div>
          <div className="px-6 py-2 flex items-center gap-3 bg-[#1C1F26] border-r-2 border-[#58A6FF]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#58A6FF]"></span>
            <span className="text-sm">Vertical Slice View</span>
          </div>
          <div className="px-6 py-2 flex items-center gap-3 text-slate-400 opacity-50 cursor-not-allowed">
            <span className="w-1.5 h-1.5 rounded-full bg-transparent border border-slate-600"></span>
            <span className="text-sm">Research Web (L2)</span>
          </div>
          <div className="px-6 py-2 flex items-center gap-3 text-slate-400 opacity-50 cursor-not-allowed">
            <span className="w-1.5 h-1.5 rounded-full bg-transparent border border-slate-600"></span>
            <span className="text-sm">Flashcards (L2)</span>
          </div>
          <div className="px-6 py-2 flex items-center gap-3 text-slate-400 opacity-50 cursor-not-allowed">
            <span className="w-1.5 h-1.5 rounded-full bg-transparent border border-slate-600"></span>
            <span className="text-sm">Calendar / Agenda (L2)</span>
          </div>
          <div className="px-6 mt-8 mb-2 text-[10px] uppercase tracking-widest text-slate-500 font-bold">Infrastructure</div>
          <div className="px-6 py-1.5 text-sm flex justify-between items-center">
            <span className="text-slate-400">Node/Express</span>
            <span className="text-[10px] text-[#238636] font-mono">RUNNING</span>
          </div>
          <div className="px-6 py-1.5 text-sm flex justify-between items-center">
            <span className="text-slate-400">Firestore</span>
            <span className="text-[10px] text-[#238636] font-mono">CONNECTED</span>
          </div>
          <div className="px-6 py-1.5 text-sm flex justify-between items-center">
            <span className="text-slate-400">Cloud Run</span>
            <span className="text-[10px] text-[#238636] font-mono">READY</span>
          </div>
        </div>
        <div className="p-6 border-t border-[#2D3139]">
          <div className="p-3 bg-[#16181D] rounded border border-[#2D3139]">
            <p className="text-[10px] text-slate-500 mb-1">MODEL_ID</p>
            <p className="text-xs font-mono text-white">gemini-2.5-flash</p>
          </div>
        </div>
      </nav>
      
      <main className="flex-1 flex flex-col bg-[#0A0B0D] overflow-hidden">
        <header className="h-16 border-b border-[#2D3139] px-8 flex items-center justify-between shrink-0">
          <div className="flex gap-8 items-center">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Component</span>
              <span className="text-sm font-medium">EGORuntime</span>
            </div>
            <div className="h-8 w-[1px] bg-[#2D3139]"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Idempotency Mode</span>
              <span className="text-sm font-medium">request_id enforced</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="px-3 py-1 bg-[#23863622] border border-[#238636] rounded text-[#238636] text-[10px] font-bold tracking-widest uppercase">Healthy</div>
          </div>
        </header>
        
        <div className="flex-1 p-8 grid grid-cols-12 gap-6 overflow-y-auto">
          <section className="col-span-12 lg:col-span-7 flex flex-col gap-6">
            <div className="bg-[#16181D] border border-[#2D3139] rounded-lg p-5">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Learning Jobs</h2>
                <span className="text-[10px] font-mono text-[#58A6FF]">3 ACTIVE</span>
              </div>
              <div className="overflow-x-auto rounded border border-[#2D3139] bg-[#0F1115]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#1C1F26] text-slate-400 font-mono text-[10px] border-b border-[#2D3139]">
                    <tr>
                      <th className="p-3 border-r border-[#2D3139] whitespace-nowrap">JOB_ID</th>
                      <th className="p-3 border-r border-[#2D3139] whitespace-nowrap">ARTIFACTS</th>
                      <th className="p-3 border-r border-[#2D3139] whitespace-nowrap">STATE</th>
                      <th className="p-3 whitespace-nowrap">ETA</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    <tr className="border-b border-[#2D3139] hover:bg-[#1C1F26] transition-colors">
                      <td className="p-3 border-r border-[#2D3139] whitespace-nowrap">job_8821_feynman</td>
                      <td className="p-3 border-r border-[#2D3139] whitespace-nowrap">3/3 PDFs</td>
                      <td className="p-3 border-r border-[#2D3139] text-[#d29922] whitespace-nowrap">ANALYZING</td>
                      <td className="p-3 whitespace-nowrap">42s</td>
                    </tr>
                    <tr className="border-b border-[#2D3139] hover:bg-[#1C1F26] transition-colors">
                      <td className="p-3 border-r border-[#2D3139] whitespace-nowrap">job_9012_biochem</td>
                      <td className="p-3 border-r border-[#2D3139] whitespace-nowrap">2/2 PDFs</td>
                      <td className="p-3 border-r border-[#2D3139] text-[#238636] whitespace-nowrap">COMPLETED</td>
                      <td className="p-3 whitespace-nowrap">--</td>
                    </tr>
                    <tr className="hover:bg-[#1C1F26] transition-colors">
                      <td className="p-3 border-r border-[#2D3139] whitespace-nowrap">job_9055_mlops</td>
                      <td className="p-3 border-r border-[#2D3139] whitespace-nowrap">1/1 PDFs</td>
                      <td className="p-3 border-r border-[#2D3139] text-[#58A6FF] whitespace-nowrap">ACCEPTED</td>
                      <td className="p-3 whitespace-nowrap">118s</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-[#16181D] border border-[#2D3139] rounded-lg p-5 flex-1 overflow-hidden flex flex-col min-h-[300px]">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Event Bus Log (SSE)</h2>
              <div className="flex-1 bg-[#0F1115] rounded border border-[#2D3139] p-3 font-mono text-[11px] leading-relaxed overflow-y-auto">
                <div className="text-[#238636]">[14:20:01] INFO: Created session sess_882</div>
                <div className="text-slate-400">[14:20:02] INFO: Validating MIME/SHA-256 for artifact_id=992</div>
                <div className="text-slate-400">[14:20:03] INFO: Artifacts verified. Dispatched to Task Queue.</div>
                <div className="text-[#58A6FF]">[14:20:05] EVENT: sequence_number: 102 | type: job_started</div>
                <div className="text-slate-400">[14:20:10] INFO: Coordinator invoking Document Tool...</div>
                <div className="text-[#d29922] animate-pulse">[14:20:42] PROCESS: Analysis in progress (42% complete)</div>
                <div className="text-slate-500">_</div>
              </div>
            </div>
          </section>

          <section className="col-span-12 lg:col-span-5 flex flex-col gap-6 overflow-hidden">
            <div className="bg-[#16181D] border border-[#2D3139] rounded-lg p-5 flex-1 overflow-hidden flex flex-col min-h-[400px]">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Vertical Slice Validation</h2>
              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                <div className="flex items-center justify-between p-2 bg-[#0F1115] rounded border border-[#2D3139]">
                  <span className="text-[11px]">1. API Contracts (Zod/Express)</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#238636] text-white">IMPLEMENTED</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-[#0F1115] rounded border border-[#2D3139]">
                  <span className="text-[11px]">2. Coordinator Agent</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#238636] text-white">IMPLEMENTED</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-[#0F1115] rounded border border-[#2D3139]">
                  <span className="text-[11px]">3. Session Lifecycle</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#238636] text-white">IMPLEMENTED</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-[#0F1115] rounded border border-[#2D3139]">
                  <span className="text-[11px]">4. GCS Auth References</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#238636] text-white">IMPLEMENTED</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-[#0F1115] rounded border border-[#2D3139]">
                  <span className="text-[11px]">8. Task Queue Dispatch</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#238636] text-white">IMPLEMENTED</span>
                </div>
                 <div className="flex items-center justify-between p-2 bg-[#0F1115] border border-dashed border-[#d29922] rounded">
                  <span className="text-[11px]">10. study_plan.json Output</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#d29922] text-white">SIMULATED</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-[#1C1F26] opacity-40 rounded border border-[#2D3139]">
                  <span className="text-[11px]">Research Web / Zotero</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-600 text-white">NOT_IMPLEMENTED</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-[#0F1115] border border-dashed border-[#58A6FF] rounded opacity-75">
                  <span className="text-[11px]">Calendar Schedule Sync</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#58A6FF] text-black font-bold">INTERFACE_ONLY</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[#2D3139]">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Generation 1 Status</p>
                    <p className="text-xl font-bold">100% Complete</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 mb-1">Response Code</p>
                    <p className="text-sm font-mono text-[#58A6FF]">202 Accepted</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
        
        <footer className="h-12 border-t border-[#2D3139] px-8 flex items-center bg-[#0F1115] text-[10px] text-slate-500 font-mono shrink-0">
          <div className="flex-1 flex gap-6">
            <span>IDEMPOTENCY_KEY: 8f92-a1b2-c3d4</span>
            <span>LAST_EVENT_ID: curs_99210</span>
            <span>INTERNAL_RUNTIME_TOKEN: REDACTED</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#238636]"></span>
            <span>EGO NODE #004 ACTIVE</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
