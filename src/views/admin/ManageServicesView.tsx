import React, { useState } from 'react';
import { Clock, Download, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import type { Service, View } from '../../types';
import { cn, notify } from '../../lib/ui';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Modal } from '../../components/Modal';

export function ManageServicesView({ services, onSave, canAdminOverride }: { services: Service[], onSave: (s: Service[]) => void, canAdminOverride: boolean }) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingImportedServices, setPendingImportedServices] = useState<Service[] | null>(null);
  const [pendingImportCount, setPendingImportCount] = useState(0);
  const [formData, setFormData] = useState({
    serviceNumber: '', 
    startTime: '', 
    endTime: '',
    startTime2: '',
    endTime2: '',
    startTime3: '',
    endTime3: ''
  });
  const [isImporting, setIsImporting] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canAdminOverride) {
      notify('Excel-import is alleen beschikbaar voor admins.', 'error');
      if (e.target) e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const XLSX = await import('xlsx');
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
          notify('Het Excel-bestand lijkt leeg te zijn.', 'error');
          setIsImporting(false);
          return;
        }

        const formatExcelTime = (val: any) => {
          if (val === undefined || val === null || val === "") return "";
          if (typeof val === 'number') {
            // Excel stores time as a fraction of 24 hours (0.5 = 12:00)
            const totalSeconds = Math.round(val * 24 * 3600);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
          }
          return val.toString().trim();
        };

        const importedServices: Service[] = jsonData.map((row: any, index) => {
          const rowKeys = Object.keys(row);
          const findValue = (patterns: string[]) => {
            const foundKey = rowKeys.find(k => {
              const cleanK = k.toString().trim().toLowerCase();
              return patterns.some(p => cleanK.includes(p));
            });
            return foundKey ? row[foundKey] : undefined;
          };

          const serviceNumber = findValue(['dienst', 'nummer', 'service', 'nr']);
          
          // Part 1
          const startTime = findValue(['start 1', 'begin 1', 'van 1', 'starttijd 1', 'start (deel 1)']);
          const endTime = findValue(['eind 1', 'stop 1', 'tot 1', 'eindtijd 1', 'einde (deel 1)']);
          
          // Part 2
          const startTime2 = findValue(['start 2', 'begin 2', 'van 2', 'starttijd 2', 'start (deel 2)']);
          const endTime2 = findValue(['eind 2', 'stop 2', 'tot 2', 'eindtijd 2', 'einde (deel 2)']);
          
          // Part 3
          const startTime3 = findValue(['start 3', 'begin 3', 'van 3', 'starttijd 3', 'start (deel 3)']);
          const endTime3 = findValue(['eind 3', 'stop 3', 'tot 3', 'eindtijd 3', 'einde (deel 3)']);

          // Fallback for simple start/end if part 1 is missing
          const finalStart = startTime || findValue(['start', 'begin', 'van']);
          const finalEnd = endTime || findValue(['eind', 'stop', 'tot']);

          return {
            id: (Date.now() + index).toString(),
            serviceNumber: serviceNumber?.toString().trim() || '',
            startTime: formatExcelTime(finalStart),
            endTime: formatExcelTime(finalEnd),
            startTime2: formatExcelTime(startTime2),
            endTime2: formatExcelTime(endTime2),
            startTime3: formatExcelTime(startTime3),
            endTime3: formatExcelTime(endTime3)
          };
        }).filter(s => s.serviceNumber);

        if (importedServices.length > 0) {
          setPendingImportedServices(importedServices);
          setPendingImportCount(importedServices.length);
        } else {
          notify('Geen geldige diensten gevonden in het bestand. Controleer de kolommen Dienst, Start en Eind.', 'error');
        }
      } catch (error) {
        console.error('Error parsing Excel:', error);
        notify('Fout bij het verwerken van het Excel-bestand.', 'error');
      } finally {
        setIsImporting(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadCSV = () => {
    const headers = ['Dienstnummer', 'Start 1', 'Eind 1', 'Start 2', 'Eind 2', 'Start 3', 'Eind 3'];
    const rows = services.map(s => [
      `"${s.serviceNumber}"`, 
      `"${s.startTime}"`, 
      `"${s.endTime}"`,
      `"${s.startTime2 || ''}"`,
      `"${s.endTime2 || ''}"`,
      `"${s.startTime3 || ''}"`,
      `"${s.endTime3 || ''}"`
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `beheer_dienstoverzicht_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEdit = (service: Service) => {
    setEditingId(service.id);
    setFormData({ 
      serviceNumber: service.serviceNumber, 
      startTime: service.startTime, 
      endTime: service.endTime,
      startTime2: service.startTime2 || '',
      endTime2: service.endTime2 || '',
      startTime3: service.startTime3 || '',
      endTime3: service.endTime3 || ''
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      onSave(services.map(s => s.id === editingId ? { ...s, ...formData } : s));
    } else {
      onSave([...services, { id: Date.now().toString(), ...formData }]);
    }
    setShowModal(false);
    setEditingId(null);
    setFormData({ 
      serviceNumber: '', 
      startTime: '', 
      endTime: '',
      startTime2: '',
      endTime2: '',
      startTime3: '',
      endTime3: ''
    });
  };

  const handleDelete = (id: string) => {
    if (!canAdminOverride) {
      notify('Diensten verwijderen is alleen beschikbaar voor admins.', 'error');
      return;
    }
    setConfirmDeleteId(id);
  };

  const handleConfirmDelete = () => {
    if (!confirmDeleteId) return;
    onSave(services.filter(s => s.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  const handleConfirmImport = () => {
    if (!canAdminOverride) {
      notify('Excel-import is alleen beschikbaar voor admins.', 'error');
      setPendingImportedServices(null);
      setPendingImportCount(0);
      return;
    }
    if (!pendingImportedServices) return;
    onSave(pendingImportedServices);
    setPendingImportedServices(null);
    setPendingImportCount(0);
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Beheer"
        title="Beheer Dienstoverzicht"
        description="Voeg diensten toe, bewerk of verwijder ze."
        actions={(
          <div className="flex items-center gap-3">
            {canAdminOverride ? (
              <>
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  className="hidden"
                  id="services-upload"
                  onChange={handleFileUpload}
                  disabled={isImporting}
                />
                <label
                  htmlFor="services-upload"
                  className={cn(
                    "control-button-soft flex items-center gap-2 px-6 py-3 rounded-2xl text-slate-600 font-bold text-sm transition-all cursor-pointer active:scale-95",
                    isImporting && "opacity-50 cursor-not-allowed"
                  )}
                  title="Importeer vanuit Excel"
                >
                  <Upload size={20} className="text-oker-500" />
                  {isImporting ? 'Importeren...' : 'Excel Import'}
                </label>
              </>
            ) : (
              <div className="rounded-2xl border border-white/70 bg-white/55 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                Excel import admin-only
              </div>
            )}
            <button
              onClick={downloadCSV}
              className="control-button-soft flex items-center gap-2 px-6 py-3 rounded-2xl text-slate-600 font-bold text-sm transition-all active:scale-95"
              title="Download als CSV"
            >
              <Download size={20} className="text-oker-500" />
              Download CSV
            </button>
            <button
              onClick={() => {
                setEditingId(null);
                setFormData({
                  serviceNumber: '',
                  startTime: '',
                  endTime: '',
                  startTime2: '',
                  endTime2: '',
                  startTime3: '',
                  endTime3: ''
                });
                setShowModal(true);
              }}
              className="btn-primary ios-pressable px-6 py-3 flex items-center gap-2"
            >
              <Plus size={20} />
              Nieuwe Dienst
            </button>
          </div>
        )}
      />

      <div className="surface-table rounded-[28px] overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Dienst</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 1</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 2</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 3</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {services.map(s => (
                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-5 font-black text-slate-800">{s.serviceNumber}</td>
                  <td className="px-6 py-5 text-slate-600 font-bold text-xs">
                    {s.startTime} - {s.endTime}
                  </td>
                  <td className="px-6 py-5 text-slate-600 font-bold text-xs">
                    {s.startTime2 ? `${s.startTime2} - ${s.endTime2}` : '-'}
                  </td>
                  <td className="px-6 py-5 text-slate-600 font-bold text-xs">
                    {s.startTime3 ? `${s.startTime3} - ${s.endTime3}` : '-'}
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleEdit(s)} className="p-2 text-slate-400 hover:text-oker-500 transition-colors"><Pencil size={18} /></button>
                      {canAdminOverride ? <button onClick={() => handleDelete(s.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={18} /></button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-slate-50">
          {services.map(s => (
            <div key={s.id} className="p-6 space-y-4 hover:bg-slate-50/50 transition-colors">
              <div className="flex justify-between items-center">
                <span className="text-lg font-black text-slate-800 tracking-tight">{s.serviceNumber}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleEdit(s)} className="p-2 text-slate-400 hover:text-oker-500 transition-colors"><Pencil size={18} /></button>
                  {canAdminOverride ? <button onClick={() => handleDelete(s.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={18} /></button> : null}
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 1</span>
                  <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                    <Clock size={14} className="text-oker-500" />
                    {s.startTime} - {s.endTime}
                  </div>
                </div>

                {s.startTime2 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 2</span>
                    <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                      <Clock size={14} className="text-oker-500" />
                      {s.startTime2} - {s.endTime2}
                    </div>
                  </div>
                )}

                {s.startTime3 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 3</span>
                    <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                      <Clock size={14} className="text-oker-500" />
                      {s.startTime3} - {s.endTime3}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {services.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<Clock size={28} />}
              title="Geen diensten geconfigureerd"
              message="Voeg handmatig een dienst toe of importeer een Excel-bestand."
            />
          </div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} maxWidth="lg">
        <div className="p-8 border-b border-white/70 flex items-center justify-between">
          <h4 className="text-xl font-black">{editingId ? 'Dienst Bewerken' : 'Nieuwe Dienst'}</h4>
          <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-5">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Dienstnummer</label>
            <input
              type="text" required value={formData.serviceNumber}
              onChange={(e) => setFormData({...formData, serviceNumber: e.target.value})}
              className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Starttijd (Deel 1)</label>
              <input
                type="time" required value={formData.startTime}
                onChange={(e) => setFormData({...formData, startTime: e.target.value})}
                className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Eindtijd (Deel 1)</label>
              <input
                type="time" required value={formData.endTime}
                onChange={(e) => setFormData({...formData, endTime: e.target.value})}
                className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Starttijd (Deel 2)</label>
              <input
                type="time" value={formData.startTime2}
                onChange={(e) => setFormData({...formData, startTime2: e.target.value})}
                className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Eindtijd (Deel 2)</label>
              <input
                type="time" value={formData.endTime2}
                onChange={(e) => setFormData({...formData, endTime2: e.target.value})}
                className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Starttijd (Deel 3)</label>
              <input
                type="time" value={formData.startTime3}
                onChange={(e) => setFormData({...formData, startTime3: e.target.value})}
                className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Eindtijd (Deel 3)</label>
              <input
                type="time" value={formData.endTime3}
                onChange={(e) => setFormData({...formData, endTime3: e.target.value})}
                className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
              />
            </div>
          </div>
          <button type="submit" className="btn-primary ios-pressable w-full py-4 mt-4">
            {editingId ? 'Dienst Bijwerken' : 'Dienst Toevoegen'}
          </button>
        </form>
      </Modal>

      <ConfirmationModal
        isOpen={!!pendingImportedServices}
        onClose={() => {
          setPendingImportedServices(null);
          setPendingImportCount(0);
        }}
        onConfirm={handleConfirmImport}
        title="Diensten importeren"
        message={`Er zijn ${pendingImportCount} diensten gevonden. De huidige lijst wordt vervangen door deze import.`}
        confirmText="Importeren"
        variant="warning"
      />

      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleConfirmDelete}
        title="Dienst verwijderen"
        message="Weet je zeker dat je deze dienst wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
      />
    </PageShell>
  );
}


