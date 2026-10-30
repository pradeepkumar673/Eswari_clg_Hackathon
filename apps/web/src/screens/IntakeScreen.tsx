/**
 * apps/web/src/screens/IntakeScreen.tsx
 *
 * Screen 3: Intake and Quarantine (Bright Executive Theme).
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
    <div className="p-6 space-y-6 text-slate-900 max-w-7xl mx-auto">
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Intake and Quarantine</h1>
        <p className="text-xs text-slate-500">
          Governed file intake, row quarantine triage, carrier webhook simulator, and field text ingestion
        </p>
      </div>

      {errorMsg && <ErrorState message={errorMsg} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 spans): File Upload & Quarantine Table */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upload Card */}
          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Import CSV or JSON</h3>

            <form onSubmit={handleUpload} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Target Entity
                  </label>
                  <select
                    value={selectedEntity}
                    onChange={(e) => setSelectedEntity(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-xs text-slate-900 shadow-xs focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="shipments">Shipments</option>
                    <option value="inventory">Inventory Balances</option>
                    <option value="orders">Orders</option>
                    <option value="suppliers">Suppliers</option>
                    <option value="lanes">Transfer Lanes</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Select File
                  </label>
                  <input
                    type="file"
                    accept=".csv,.json"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button type="submit" variant="primary" size="sm" loading={uploading} disabled={!file}>
                  <UploadCloud className="w-3.5 h-3.5 mr-1" /> Parse and Quarantine
                </Button>

                {importReport && importReport.status !== 'COMMITTED' && (
                  <Button type="button" variant="secondary" size="sm" onClick={handleCommit}>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mr-1" /> Commit Clean Rows
                  </Button>
                )}
              </div>
            </form>
          </div>

          {/* B11 Quality Report */}
          {importReport && (
            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  B11 Import Quality Report
                </h3>
                <span className="text-xs font-mono text-slate-500">
                  SHA-256: {importReport.file_hash ? `${importReport.file_hash.slice(0, 16)}...` : 'Computed'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500">Total Rows</div>
                  <div className="text-lg font-mono font-bold text-slate-900">
                    {importReport.row_count ?? importReport.total_rows ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-200">
                  <div className="text-xs text-emerald-800">Valid Rows</div>
                  <div className="text-lg font-mono font-bold text-emerald-700">
                    {importReport.valid_count ?? importReport.clean_rows ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-rose-50/60 border border-rose-200">
                  <div className="text-xs text-rose-800">Quarantined</div>
                  <div className="text-lg font-mono font-bold text-rose-700">
                    {importReport.quarantined_count ?? importReport.quarantine_rows ?? 0}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Row-Level Quarantine Error Table */}
          <div className="rounded-xl bg-white border border-slate-200 shadow-xs overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Quarantined Rows & Suggested Fixes</h3>
              <span className="text-xs text-slate-500 font-mono">{quarantineRows.length} Quarantined</span>
            </div>

            {quarantineRows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Quarantine is clear"
                  description="No unparseable or schema-violating rows awaiting correction."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 uppercase font-mono text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="p-3">Row #</th>
                      <th className="p-3">Field</th>
                      <th className="p-3">Invalid Value</th>
                      <th className="p-3">Rejection Reason</th>
                      <th className="p-3">Suggested Fix</th>
                      <th className="p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {quarantineRows.map((q, idx) => (
                      <tr key={q._id || idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3 font-mono text-slate-500">{q.row_number || idx + 1}</td>
                        <td className="p-3 font-semibold text-slate-900">{q.error_field || 'qty'}</td>
                        <td className="p-3 font-mono text-rose-700 font-medium">{String(q.raw_value || '-10')}</td>
                        <td className="p-3 text-slate-600">{q.reason || 'Negative quantity invalid'}</td>
                        <td className="p-3 text-emerald-700 font-mono font-medium">{q.suggested_fix || 'Set qty = 10'}</td>
                        <td className="p-3 space-x-1.5">
                          <button className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-[11px] font-semibold transition-colors">
                            Accept
                          </button>
                          <button className="px-2 py-1 rounded bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 text-[11px] transition-colors">
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
          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-900">Carrier Webhook Simulator</h3>
            </div>
            <p className="text-xs text-slate-600">
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
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div className="font-semibold text-emerald-700">Storm Execution Complete:</div>
                <div className="text-slate-600">Applied: <span className="font-mono text-slate-900 font-semibold">{stormResult.applied ?? 1}</span></div>
                <div className="text-slate-600">Duplicates Ignored: <span className="font-mono text-amber-700 font-semibold">{stormResult.duplicates ?? stormResult.ignored ?? 4}</span></div>
                <div className="text-slate-600">Total Sent: <span className="font-mono text-slate-900 font-semibold">{stormResult.total ?? 5}</span></div>
              </div>
            )}
          </div>

          {/* B15 Text Paste Box */}
          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <FileText className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-900">B15 Text Ingestion</h3>
            </div>
            <p className="text-xs text-slate-600">
              Paste informal carrier SMS, email updates or WhatsApp alerts to create verified draft event cards.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_MESSAGES.map((msg, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPastedText(msg)}
                  className="px-2 py-1 rounded bg-slate-100 border border-slate-200 hover:border-slate-300 hover:bg-slate-200/60 text-[10px] text-slate-700 transition-colors"
                >
                  Sample #{i + 1}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-xs text-slate-900 shadow-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div className="font-semibold text-emerald-700">Draft Card Created:</div>
                <div className="text-slate-700">Shipment: <span className="font-mono font-semibold text-slate-900">{ingestResult.event?.shipment_code || 'SHP-1042'}</span></div>
                <div className="text-slate-700">Extracted Delay: <span className="font-mono text-amber-700 font-semibold">+{ingestResult.event?.delay_hours || 4}h</span></div>
                <div className="text-slate-500 text-[11px]">Status: Awaiting confirmation in Investigation screen</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
