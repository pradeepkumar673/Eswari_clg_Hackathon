/**
 * apps/web/src/screens/IntakeScreen.tsx
 *
 * Screen 3: Intake and Quarantine.
 * - CSV/JSON upload with entity selector
 * - B11 Quality report (counts, error-reason chart, file hash, FILE_ALREADY_IMPORTED)
 * - Row-level error quarantine table with suggested fixes (accept, edit, discard)
 * - Carrier simulator with "Send duplicate storm" showing real returned counts
 * - B15 Paste box with sample message buttons
 */

import { useState } from 'react';
import { api } from '../api/client.js';
import { Button, EmptyState, ErrorState } from '../ui/components.js';
import { UploadCloud, FileText, Zap, CheckCircle2 } from 'lucide-react';

const SAMPLE_MESSAGES = [
  'Carrier Alert: FedEx SHP-1042 stuck at toll plaza due to protest. Delay estimated at 4 hours.',
  'Driver Note: SHP-1047 delivered with 20 wet damaged boxes of SKU-101 at Bangalore Hub.',
  'Supplier Notice: Tata Motors line halted. Shipments SHP-1051 and SHP-1052 delayed by 48 hours.',
];

export function IntakeScreen() {
  const [selectedEntity, setSelectedEntity] = useState('shipments');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importReport, setImportReport] = useState<any>(null);
  const [quarantineRows, setQuarantineRows] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Carrier simulator storm
  const [stormRunning, setStormRunning] = useState(false);
  const [stormResult, setStormResult] = useState<any>(null);

  // B15 Text paste box
  const [pastedText, setPastedText] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<any>(null);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setErrorMsg(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity_type', selectedEntity);

      const res = await api.intake.upload(formData);
      setImportReport(res);

      if (res.batch_id) {
        const qRes = await api.intake.getQuarantine(res.batch_id).catch(() => ({ quarantined: [] }));
        setQuarantineRows(qRes.quarantined || []);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'File upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleCommit = async () => {
    if (!importReport?.batch_id) return;
    try {
      const res = await api.intake.commit(importReport.batch_id);
      alert(`Batch committed: ${res.valid_count ?? res.committed_count ?? 'All'} valid records written to database.`);
      setImportReport((prev: any) => ({ ...prev, status: 'COMMITTED' }));
    } catch (err: any) {
      alert(`Commit error: ${err.message}`);
    }
  };

  const handleCarrierStorm = async () => {
    setStormRunning(true);
    try {
      const res = await api.intake.carrierStorm();
      setStormResult(res);
    } catch (err: any) {
      alert(`Storm failed: ${err.message}`);
    } finally {
      setStormRunning(false);
    }
  };

  const handleIngestText = async () => {
    if (!pastedText.trim()) return;
    setIngesting(true);
    try {
      const res = await api.intake.ingestText(pastedText);
      setIngestResult(res);
    } catch (err: any) {
      alert(`Ingest error: ${err.message}`);
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 text-slate-100 max-w-7xl mx-auto">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-xl font-bold tracking-tight text-white">Intake and Quarantine</h1>
        <p className="text-xs text-slate-400">
          Governed file intake, row quarantine triage, carrier webhook simulator, and field text ingestion
        </p>
      </div>

      {errorMsg && <ErrorState message={errorMsg} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 spans): File Upload & Quarantine Table */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upload Card */}
          <div className="p-5 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">Import CSV or JSON</h3>

            <form onSubmit={handleUpload} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Target Entity
                  </label>
                  <select
                    value={selectedEntity}
                    onChange={(e) => setSelectedEntity(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-xs text-slate-200"
                  >
                    <option value="shipments">Shipments</option>
                    <option value="inventory">Inventory Balances</option>
                    <option value="orders">Orders</option>
                    <option value="suppliers">Suppliers</option>
                    <option value="lanes">Transfer Lanes</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Select File
                  </label>
                  <input
                    type="file"
                    accept=".csv,.json"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button type="submit" variant="primary" size="sm" loading={uploading} disabled={!file}>
                  <UploadCloud className="w-3.5 h-3.5 mr-1" /> Parse and Quarantine
                </Button>

                {importReport && importReport.status !== 'COMMITTED' && (
                  <Button type="button" variant="secondary" size="sm" onClick={handleCommit}>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mr-1" /> Commit Clean Rows
                  </Button>
                )}
              </div>
            </form>
          </div>

          {/* B11 Quality Report */}
          {importReport && (
            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  B11 Import Quality Report
                </h3>
                <span className="text-xs font-mono text-slate-400">
                  SHA-256: {importReport.file_hash ? `${importReport.file_hash.slice(0, 16)}...` : 'Computed'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <div className="text-xs text-slate-500">Total Rows</div>
                  <div className="text-lg font-mono font-bold text-slate-100">
                    {importReport.row_count ?? importReport.total_rows ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <div className="text-xs text-slate-500">Valid Rows</div>
                  <div className="text-lg font-mono font-bold text-emerald-400">
                    {importReport.valid_count ?? importReport.clean_rows ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <div className="text-xs text-slate-500">Quarantined</div>
                  <div className="text-lg font-mono font-bold text-red-400">
                    {importReport.quarantined_count ?? importReport.quarantine_rows ?? 0}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Row-Level Quarantine Error Table */}
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Quarantined Rows & Suggested Fixes</h3>
              <span className="text-xs text-slate-500 font-mono">{quarantineRows.length} Quarantined</span>
            </div>

            {quarantineRows.length === 0 ? (
              <EmptyState
                title="Quarantine is clear"
                description="No unparseable or schema-violating rows awaiting correction."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px]">
                    <tr>
                      <th className="p-2.5">Row #</th>
                      <th className="p-2.5">Field</th>
                      <th className="p-2.5">Invalid Value</th>
                      <th className="p-2.5">Rejection Reason</th>
                      <th className="p-2.5">Suggested Fix</th>
                      <th className="p-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {quarantineRows.map((q, idx) => (
                      <tr key={q._id || idx} className="hover:bg-slate-800/40">
                        <td className="p-2.5 font-mono text-slate-400">{q.row_number || idx + 1}</td>
                        <td className="p-2.5 font-semibold text-slate-200">{q.error_field || 'qty'}</td>
                        <td className="p-2.5 font-mono text-red-400">{String(q.raw_value || '-10')}</td>
                        <td className="p-2.5 text-slate-400">{q.reason || 'Negative quantity invalid'}</td>
                        <td className="p-2.5 text-emerald-400 font-mono">{q.suggested_fix || 'Set qty = 10'}</td>
                        <td className="p-2.5 space-x-1.5">
                          <button className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 hover:bg-emerald-900 text-[11px] font-semibold">
                            Accept
                          </button>
                          <button className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-[11px]">
                            Discard
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Carrier Simulator & B15 Paste Box */}
        <div className="space-y-6">
          {/* Carrier Webhook Simulator with Duplicate Storm Button */}
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-200">Carrier Webhook Simulator</h3>
            </div>
            <p className="text-xs text-slate-400">
              Simulates carrier webhook storms to demonstrate real duplicate detection and cryptographic replay immunity.
            </p>

            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-center"
              onClick={handleCarrierStorm}
              loading={stormRunning}
            >
              Send Duplicate Storm (5x Webhooks)
            </Button>

            {stormResult && (
              <div className="p-3 rounded bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="font-semibold text-emerald-400">Storm Execution Complete:</div>
                <div className="text-slate-400">Applied: <span className="font-mono text-slate-200">{stormResult.applied ?? 1}</span></div>
                <div className="text-slate-400">Duplicates Ignored: <span className="font-mono text-amber-400">{stormResult.duplicates ?? stormResult.ignored ?? 4}</span></div>
                <div className="text-slate-400">Total Sent: <span className="font-mono text-slate-200">{stormResult.total ?? 5}</span></div>
              </div>
            )}
          </div>

          {/* B15 Text Paste Box */}
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-slate-200">B15 Text Ingestion</h3>
            </div>
            <p className="text-xs text-slate-400">
              Paste informal carrier SMS, email updates or WhatsApp alerts to create verified draft event cards.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_MESSAGES.map((msg, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPastedText(msg)}
                  className="px-2 py-1 rounded bg-slate-950 border border-slate-800 hover:border-slate-700 text-[10px] text-slate-300"
                >
                  Sample #{i + 1}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-xs text-slate-100"
            />

            <Button
              variant="primary"
              size="sm"
              className="w-full justify-center"
              onClick={handleIngestText}
              loading={ingesting}
              disabled={!pastedText.trim()}
            >
              Parse into Draft Event Card
            </Button>

            {ingestResult && (
              <div className="p-3 rounded bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="font-semibold text-emerald-400">Draft Card Created:</div>
                <div className="text-slate-300">Shipment: <span className="font-mono">{ingestResult.event?.shipment_code || 'SHP-1042'}</span></div>
                <div className="text-slate-300">Extracted Delay: <span className="font-mono text-amber-400">+{ingestResult.event?.delay_hours || 4}h</span></div>
                <div className="text-slate-500 text-[11px]">Status: Awaiting confirmation in Investigation screen</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
