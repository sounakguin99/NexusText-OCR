"use client";

import React, { useState, useCallback, useRef, useMemo } from 'react';
import Tesseract from 'tesseract.js';
import * as XLSX from 'xlsx';
import { ScanText, Download, Trash2, ImagePlus, Loader2, FileText, CheckCircle2, AlertCircle } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
interface StructuredData {
  jobTitle: string; company: string; location: string;
  email: string; phone: string; salary: string; role: string;
  description: string; isDuplicate?: boolean; duplicateFields?: string[];
}
interface ImageItem {
  id: string; file: File; previewUrl: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  progress: number; result: string; structuredData?: StructuredData; error?: string;
}
interface ExcelEntry extends StructuredData { id: string; fileName: string; }

// ─── Text Parser ─────────────────────────────────────────────────────────────
const parseExtractedText = (text: string): StructuredData => {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4,}/;
  const data: StructuredData = {
    jobTitle: '', company: '', location: '', email: '', phone: '',
    salary: '', role: '',
    description: text.substring(0, 500) + (text.length > 500 ? '...' : '')
  };
  const emailMatch = text.match(emailRegex);
  if (emailMatch) data.email = emailMatch[0];
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) data.phone = phoneMatch[0];
  for (const line of lines) {
    const lo = line.toLowerCase();
    if (lo.includes('hiring at')) data.company = line.split(/hiring at/i)[1]?.trim().split(/\s/)[0].replace(/[^\w\s]/gi, '') || '';
    if (lo.includes('location:')) data.location = line.split(/location:/i)[1]?.trim() || '';
    else if (lo.includes('location -')) data.location = line.split(/location -/i)[1]?.trim() || '';
    if (lo.includes('looking for a') || lo.includes('looking for an')) {
      const parts = line.split(/looking for a|looking for an/i);
      if (parts[1]) { data.jobTitle = parts[1].split(/to join|at|in/i)[0].trim(); data.role = data.jobTitle; }
    }
    if (lo.includes('salary') || lo.includes('ctc') || lo.includes('lpa')) data.salary = line;
  }
  if (!data.jobTitle) {
    const kws = ['developer','manager','engineer','lead','designer','analyst'];
    for (const line of lines) {
      if (kws.some(k => line.toLowerCase().includes(k))) { data.jobTitle = line.trim(); data.role = line.trim(); break; }
    }
  }
  if (!data.company) {
    const h = lines.find(l => l.toLowerCase().includes('hiring at'));
    if (h) data.company = h.split(/hiring at/i)[1]?.trim() || '';
  }
  return data;
};

// ─── Duplicate Checker ───────────────────────────────────────────────────────
const computeDuplicates = (images: ImageItem[], excel: ExcelEntry[]): { images: ImageItem[]; excel: ExcelEntry[] } => {
  type Entry = { id: string; email: string; phone: string; company: string };
  const entries: Entry[] = [
    ...images.filter(i => i.status === 'success' && i.structuredData)
      .map(i => ({ id: i.id, email: i.structuredData!.email, phone: i.structuredData!.phone, company: i.structuredData!.company })),
    ...excel.map(e => ({ id: e.id, email: e.email, phone: e.phone, company: e.company }))
  ];
  const check = (id: string, field: keyof Entry, val: string) =>
    !!val && entries.some(e => e.id !== id && (e[field] as string)?.toLowerCase() === val.toLowerCase());

  return {
    images: images.map(img => {
      if (img.status !== 'success' || !img.structuredData) return img;
      const dups: string[] = [];
      const { email, phone, company } = img.structuredData;
      if (check(img.id, 'email', email)) dups.push('Email');
      if (check(img.id, 'phone', phone)) dups.push('Phone');
      if (check(img.id, 'company', company)) dups.push('Company');
      return { ...img, structuredData: { ...img.structuredData, isDuplicate: dups.length > 0, duplicateFields: dups } };
    }),
    excel: excel.map(entry => {
      const dups: string[] = [];
      if (check(entry.id, 'email', entry.email)) dups.push('Email');
      if (check(entry.id, 'phone', entry.phone)) dups.push('Phone');
      if (check(entry.id, 'company', entry.company)) dups.push('Company');
      return { ...entry, isDuplicate: dups.length > 0, duplicateFields: dups };
    })
  };
};

// ─── Constants ───────────────────────────────────────────────────────────────
const CONCURRENCY = 5;
const PAGE_SIZE = 50;

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [excelData, setExcelData] = useState<ExcelEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [page, setPage] = useState(1);

  // Ref mirrors state so async workers always read fresh data
  const imagesRef = useRef<ImageItem[]>([]);
  const excelRef = useRef<ExcelEntry[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // Keep refs in sync
  const syncImages = useCallback((updater: (prev: ImageItem[]) => ImageItem[]) => {
    setImages(prev => {
      const next = updater(prev);
      imagesRef.current = next;
      return next;
    });
  }, []);
  const syncExcel = useCallback((next: ExcelEntry[]) => {
    excelRef.current = next;
    setExcelData(next);
  }, []);

  // ── Update a single image by id (ref-safe) ──────────────────────────────
  const updateOne = useCallback((id: string, updates: Partial<ImageItem>) => {
    syncImages(prev => prev.map(img => img.id === id ? { ...img, ...updates } : img));
  }, [syncImages]);

  // ── Process files ────────────────────────────────────────────────────────
  const processFiles = useCallback((files: File[]) => {
    const newItems: ImageItem[] = files
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f, previewUrl: URL.createObjectURL(f),
        status: 'pending', progress: 0, result: ''
      }));
    syncImages(prev => [...prev, ...newItems]);
    setPage(1);
  }, [syncImages]);

  // ── OCR worker ──────────────────────────────────────────────────────────
  const runOcr = useCallback(async (img: ImageItem) => {
    updateOne(img.id, { status: 'processing', progress: 0 });
    try {
      const result = await Tesseract.recognize(img.file, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text')
            updateOne(img.id, { progress: Math.round(m.progress * 100) });
        }
      });
      const structuredData = parseExtractedText(result.data.text);
      updateOne(img.id, { status: 'success', progress: 100, result: result.data.text, structuredData });
    } catch (err: any) {
      updateOne(img.id, { status: 'error', progress: 0, error: err.message || 'Failed' });
    }
  }, [updateOne]);

  // ── Extract all with concurrency pool ───────────────────────────────────
  const extractText = useCallback(async () => {
    const pending = imagesRef.current.filter(i => i.status === 'pending' || i.status === 'error');
    if (!pending.length) return;
    setIsProcessing(true);

    // Concurrency pool: run CONCURRENCY workers in parallel
    const queue = [...pending];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const img = queue.shift();
        if (img) await runOcr(img);
      }
    });
    await Promise.all(workers);

    // After all done, compute duplicates from fresh ref
    const { images: updatedImgs, excel: updatedExcel } = computeDuplicates(imagesRef.current, excelRef.current);
    imagesRef.current = updatedImgs;
    excelRef.current = updatedExcel;
    setImages([...updatedImgs]);
    setExcelData([...updatedExcel]);
    setIsProcessing(false);
  }, [runOcr]);

  // ── Excel upload ─────────────────────────────────────────────────────────
  const handleExcelUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const wb = XLSX.read(ev.target?.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws) as any[];
      const entries: ExcelEntry[] = rows.map((row, i) => ({
        id: `excel-${Date.now()}-${i}`, fileName: file.name,
        jobTitle: row['Job Title'] || row['jobTitle'] || '',
        company: row['Company'] || row['company'] || '',
        location: row['Location'] || row['location'] || '',
        email: row['Email'] || row['email'] || '',
        phone: row['Phone'] || row['phone'] || '',
        salary: row['Salary'] || row['salary'] || '',
        role: row['Role'] || row['role'] || '',
        description: row['Full Description'] || row['description'] || '',
      }));
      const combined = [...excelRef.current, ...entries];
      const { images: ui, excel: ue } = computeDuplicates(imagesRef.current, combined);
      imagesRef.current = ui; excelRef.current = ue;
      setImages([...ui]); syncExcel([...ue]);
    };
    reader.readAsBinaryString(file);
    if (excelInputRef.current) excelInputRef.current.value = '';
  }, [syncExcel]);

  // ── Remove image ─────────────────────────────────────────────────────────
  const removeImage = useCallback((id: string) => {
    syncImages(prev => {
      const idx = prev.findIndex(i => i.id === id);
      if (idx !== -1) URL.revokeObjectURL(prev[idx].previewUrl);
      const next = prev.filter(i => i.id !== id);
      const { images: ui } = computeDuplicates(next, excelRef.current);
      return ui;
    });
  }, [syncImages]);

  // ── Update structured data field ─────────────────────────────────────────
  const updateStructured = useCallback((id: string, field: keyof StructuredData, value: string) => {
    syncImages(prev => {
      const next = prev.map(img =>
        img.id === id && img.structuredData
          ? { ...img, structuredData: { ...img.structuredData, [field]: value } }
          : img
      );
      const { images: ui } = computeDuplicates(next, excelRef.current);
      return ui;
    });
  }, [syncImages]);

  // ── Clear all ─────────────────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    imagesRef.current.forEach(i => URL.revokeObjectURL(i.previewUrl));
    imagesRef.current = [];
    setImages([]); setPage(1);
  }, []);

  // ── Downloads ─────────────────────────────────────────────────────────────
  const downloadAllExcel = useCallback(() => {
    const rows = [
      ...imagesRef.current
        .filter(i => i.status === 'success')
        .map(i => ({
          'Source': i.file.name, 'Job Title': i.structuredData?.jobTitle || '',
          'Company': i.structuredData?.company || '', 'Location': i.structuredData?.location || '',
          'Email': i.structuredData?.email || '', 'Phone': i.structuredData?.phone || '',
          'Salary': i.structuredData?.salary || '', 'Role': i.structuredData?.role || '',
          'Full Description': i.result,
          'Is Duplicate': i.structuredData?.isDuplicate ? 'YES' : 'No',
          'Duplicate Fields': i.structuredData?.duplicateFields?.join(', ') || ''
        })),
      ...excelRef.current.map(e => ({
        'Source': `Existing: ${e.fileName}`, 'Job Title': e.jobTitle,
        'Company': e.company, 'Location': e.location, 'Email': e.email, 'Phone': e.phone,
        'Salary': e.salary, 'Role': e.role, 'Full Description': e.description,
        'Is Duplicate': e.isDuplicate ? 'YES' : 'No',
        'Duplicate Fields': e.duplicateFields?.join(', ') || ''
      }))
    ];
    if (!rows.length) return;

    // Apply highlight styles for duplicates
    const ws = XLSX.utils.json_to_sheet(rows);
    rows.forEach((row, ri) => {
      if (row['Is Duplicate'] === 'YES') {
        const cols = ['A','B','C','D','E','F','G','H','I','J','K'];
        cols.forEach(c => {
          const cellRef = `${c}${ri + 2}`;
          if (!ws[cellRef]) return;
          ws[cellRef].s = { fill: { patternType: 'solid', fgColor: { rgb: 'FFCCCB' } } };
        });
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Job Posts Data');
    XLSX.writeFile(wb, `job_data_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, []);

  const downloadAllText = useCallback(() => {
    const txt = imagesRef.current
      .filter(i => i.status === 'success' && i.result)
      .map(i => `--- File: ${i.file.name} ---\n\n${i.result}\n\n`)
      .join('\n');
    if (!txt) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    a.download = `extracted_data_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }, []);

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.currentTarget.classList.add('active'); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.currentTarget.classList.remove('active'); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.currentTarget.classList.remove('active');
    if (e.dataTransfer.files.length) processFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) processFiles(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: images.length,
    done: images.filter(i => i.status === 'success').length,
    pending: images.filter(i => i.status === 'pending').length,
    errors: images.filter(i => i.status === 'error').length,
    duplicates: images.filter(i => i.structuredData?.isDuplicate).length + excelData.filter(e => e.isDuplicate).length,
    allDone: images.length > 0 && images.every(i => i.status === 'success' || i.status === 'error'),
  }), [images, excelData]);

  // ── Pagination (virtual windowing) ───────────────────────────────────────
  const totalPages = Math.ceil(images.length / PAGE_SIZE);
  const visibleImages = useMemo(() => images.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [images, page]);

  const renderStatus = (status: ImageItem['status']) => {
    switch (status) {
      case 'pending':    return <span className="status-badge status-pending">Pending</span>;
      case 'processing': return <span className="status-badge status-processing"><Loader2 size={12} className="spinner" /> Processing</span>;
      case 'success':    return <span className="status-badge status-success"><CheckCircle2 size={12} /> Done</span>;
      case 'error':      return <span className="status-badge status-error"><AlertCircle size={12} /> Error</span>;
    }
  };

  return (
    <div className="app-container">
      <nav>
        <div className="logo">
          <div className="logo-icon"><ScanText size={24} /></div>
          NexusText OCR
        </div>
        <div><a href="https://github.com/tesseract-ocr/tesseract" target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem' }}>Powered by Tesseract.js</a></div>
      </nav>

      <header className="header">
        <h1>Bulk Image Data Extraction</h1>
        <p>Drop up to 500+ images — processed concurrently with duplicate detection.</p>
      </header>

      <main className="glass-panel">
        {/* Drop Zone */}
        <div className="drop-zone" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}>
          <ImagePlus size={48} className="drop-zone-icon" />
          <h3>Drag & Drop Images Here</h3>
          <p>or click to browse — supports PNG, JPG, JPEG, WEBP</p>
          <input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleFileInput} />
        </div>

        {/* Excel Upload */}
        <div className="excel-upload-bar" style={{ marginTop: '1rem', padding: '1rem', border: '1px dashed var(--panel-border)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h4 style={{ margin: 0 }}>Compare with Existing Excel</h4>
            <p style={{ fontSize: '0.8rem', opacity: 0.6, margin: '0.25rem 0 0 0' }}>Upload a sheet to check duplicates (Email, Phone, Company).</p>
          </div>
          <button className="btn btn-secondary" onClick={() => excelInputRef.current?.click()}>
            <FileText size={18} /> Upload Excel
          </button>
          <input type="file" accept=".xlsx,.xls,.csv" ref={excelInputRef} onChange={handleExcelUpload} style={{ display: 'none' }} />
        </div>

        {excelData.length > 0 && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem 1rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
            <span>✓ Loaded <strong>{excelData.length}</strong> existing records from Excel for comparison.</span>
            <button className="remove-btn" title="Clear" onClick={() => { syncExcel([]); const { images: ui } = computeDuplicates(imagesRef.current, []); imagesRef.current = ui; setImages([...ui]); }}><Trash2 size={16} /></button>
          </div>
        )}

        {/* Images Panel */}
        {images.length > 0 && (
          <div className="images-container">
            {/* Controls + Stats */}
            <div className="grid-controls">
              <div>
                <h3>Images ({stats.done}/{stats.total} done{stats.errors ? `, ${stats.errors} errors` : ''})</h3>
                {isProcessing && (
                  <div style={{ marginTop: '0.25rem' }}>
                    <div className="progress-container" style={{ margin: 0, width: '300px', height: '4px' }}>
                      <div className="progress-bar" style={{ width: `${Math.round((stats.done / stats.total) * 100)}%`, transition: 'width 0.4s ease' }} />
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      Processing {stats.done}/{stats.total} — {CONCURRENCY} concurrent workers
                    </p>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={clearAll} disabled={isProcessing}><Trash2 size={18} /> Clear All</button>
                <button className="btn" onClick={extractText} disabled={isProcessing || stats.pending === 0}>
                  {isProcessing ? <><Loader2 className="spinner" size={18} /> Processing {stats.done}/{stats.total}…</> : <><ScanText size={18} /> Extract Data</>}
                </button>
                {stats.allDone && (
                  <button className="btn" style={{ background: 'linear-gradient(135deg,#10b981,#059669)', boxShadow: '0 4px 15px rgba(16,185,129,0.4)' }} onClick={downloadAllExcel}>
                    <Download size={18} /> Export Final Excel
                  </button>
                )}
              </div>
            </div>

            {/* Duplicate summary */}
            {stats.duplicates > 0 && (
              <div style={{ padding: '0.6rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', color: 'var(--error-color)', fontSize: '0.85rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <AlertCircle size={15} /> <strong>{stats.duplicates}</strong> duplicate entries found — they will be highlighted in red in the exported Excel.
              </div>
            )}

            {/* Pagination info */}
            {images.length > PAGE_SIZE && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.5rem 0' }}>
                <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, images.length)} of {images.length}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.min(totalPages, page + 2)).map(p => (
                    <button key={p} onClick={() => setPage(p)} style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--panel-border)', background: p === page ? 'var(--accent-color)' : 'transparent', color: p === page ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}>{p}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Image Grid */}
            <div className="images-grid">
              {visibleImages.map(img => (
                <div key={img.id} className="image-card">
                  <img src={img.previewUrl} alt={img.file.name} className="image-preview" />
                  <div className="card-content">
                    <div className="card-header">
                      <div className="filename" title={img.file.name}>{img.file.name}</div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {renderStatus(img.status)}
                        <button className="remove-btn" onClick={e => { e.stopPropagation(); removeImage(img.id); }} disabled={img.status === 'processing'} title="Remove"><Trash2 size={16} /></button>
                      </div>
                    </div>

                    {img.status === 'processing' && (
                      <div>
                        <div className="progress-text">{img.progress}%</div>
                        <div className="progress-container"><div className="progress-bar" style={{ width: `${img.progress}%` }} /></div>
                      </div>
                    )}

                    {img.status === 'success' && img.structuredData && (
                      <div className={`structured-editor ${img.structuredData.isDuplicate ? 'duplicate-highlight' : ''}`}>
                        {img.structuredData.isDuplicate && (
                          <div className="duplicate-badge"><AlertCircle size={14} /> Duplicate: {img.structuredData.duplicateFields?.join(', ')}</div>
                        )}
                        {(['jobTitle','company','email','location','phone','salary','role'] as (keyof StructuredData)[]).map(field => (
                          <div className="input-group" key={field}>
                            <label>{field === 'jobTitle' ? 'Job Title' : field.charAt(0).toUpperCase() + field.slice(1)}</label>
                            <input value={img.structuredData![field] as string} onChange={e => updateStructured(img.id, field, e.target.value)} />
                          </div>
                        ))}
                        <div className="input-group">
                          <label>Description</label>
                          <textarea className="result-area small" style={{ height: '80px', opacity: 1 }} value={img.structuredData.description} onChange={e => updateStructured(img.id, 'description', e.target.value)} />
                        </div>
                        <div className="input-group">
                          <label>OCR Raw Text</label>
                          <textarea className="result-area small" readOnly value={img.result} />
                        </div>
                      </div>
                    )}

                    {img.status === 'error' && (
                      <div style={{ color: 'var(--error-color)', fontSize: '0.875rem', marginTop: '1rem' }}>{img.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Action Bar */}
            {stats.done > 0 && (
              <div className="action-bar">
                <button className="btn btn-secondary" onClick={downloadAllText}><FileText size={18} /> Export as TXT</button>
                <button className="btn" onClick={downloadAllExcel}><Download size={18} /> Export as Excel</button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
