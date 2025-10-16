import { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function App() {
  // ---------- En-tête (vides par défaut) ----------
  const [headerCode, setHeaderCode] = useState('');
  const [headerVersion, setHeaderVersion] = useState('');
  const [headerTitle, setHeaderTitle] = useState('');

  // ---------- Form ----------
  const [client, setClient] = useState('');
  const [dateControle, setDateControle] = useState('');
  const [points, setPoints] = useState([
    { point: '', nonConformite: '', preuvesText: '', preuvesImages: [], action: '' }
  ]);
  const [constatations, setConstatations] = useState('');
  const [recommandations, setRecommandations] = useState('');
  const [controleur, setControleur] = useState('');

  // ---------- Logo ----------
  const [logoPreviewSrc, setLogoPreviewSrc] = useState('/gss-logo.png');
  const [logoDataUrl, setLogoDataUrl] = useState(null);

  const loadDefaultLogoDataUrl = () =>
    fetch('/gss-logo.png')
      .then(r => (r.ok ? r.blob() : Promise.reject()))
      .then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }));

  useEffect(() => { if (!logoDataUrl) loadDefaultLogoDataUrl().then(setLogoDataUrl).catch(()=>{}); }, []); // mount
// --- Filigrane de fond ---
const [bgDataUrl, setBgDataUrl] = useState(null);

useEffect(() => {
  fetch('/GSSbg.png')
    .then(r => (r.ok ? r.blob() : Promise.reject()))
    .then(b => new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(b);
    }))
    .then(setBgDataUrl)
    .catch(() => setBgDataUrl(null));
}, []);

  const onLogoUpload = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setLogoPreviewSrc(URL.createObjectURL(f));
    const r = new FileReader(); r.onload = () => setLogoDataUrl(r.result); r.readAsDataURL(f);
  };
  const resetLogo = () => { setLogoPreviewSrc('/gss-logo.png'); loadDefaultLogoDataUrl().then(setLogoDataUrl).catch(()=>setLogoDataUrl(null)); };

  // ---------- Lignes ----------
  const addPoint = () => setPoints(p => [...p, { point:'', nonConformite:'', preuvesText:'', preuvesImages:[], action:'' }]);
  const removePoint = (idx) => setPoints(p => p.filter((_,i) => i!==idx));

  // ---------- PREUVES ----------
  const setPreuvesText = (idx, val) => { const n=[...points]; n[idx].preuvesText=val; setPoints(n); };
  const addPreuvesImages = (idx, files) => {
    if (!files?.length) return;
    const toRead = [...files].map(f => new Promise(res => { const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(f); }));
    Promise.all(toRead).then(urls => { const n=[...points]; n[idx].preuvesImages=[...(n[idx].preuvesImages||[]), ...urls]; setPoints(n); });
  };
  const removePreuveImage = (idx,k) => { const n=[...points]; n[idx].preuvesImages=n[idx].preuvesImages.filter((_,i)=>i!==k); setPoints(n); };

  // ---------- Import / Export ----------
  const exportJson = () => {
    const data = { headerCode, headerVersion, headerTitle, client, dateControle, points, constatations, recommandations, controleur, logoDataUrl };
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`Rapport_${(client||'Client').replace(/[^\w\d-]+/g,'_')}_${(dateControle||'Date').replace(/[^\w\d-]+/g,'_')}.json`; a.click();
  };
  const importJson = (e) => {
    const f=e.target.files?.[0]; if(!f) return;
    const r=new FileReader(); r.onload=()=>{ try{
      const d=JSON.parse(r.result);
      setHeaderCode(d.headerCode??''); setHeaderVersion(d.headerVersion??''); setHeaderTitle(d.headerTitle??'');
      setClient(d.client??''); setDateControle(d.dateControle??'');
      setPoints(Array.isArray(d.points)?d.points:[]);
      setConstatations(d.constatations??''); setRecommandations(d.recommandations??'');
      setControleur(d.controleur??''); if(d.logoDataUrl){ setLogoDataUrl(d.logoDataUrl); setLogoPreviewSrc(d.logoDataUrl); }
    }catch{ alert('Fichier JSON invalide.'); } }; r.readAsText(f);
  };

  // ---------- Titre dynamique UI ----------
  const pageTitle = useMemo(() => {
    const parts=[]; if(headerCode) parts.push(headerCode); if(headerTitle) parts.push(headerTitle);
    return (parts.length?parts.join(' — '):'Générateur de rapport') + (headerVersion?` (v${headerVersion})`:``);
  }, [headerCode, headerTitle, headerVersion]);

  // ---------- PDF constants ----------
  const mm = { left: 15, right: 15, top: 18, bottom: 18 };
  const HEADER_TOP_Y = 10;                  // fine ligne or haute
  const CONTENT_START_Y = 50;               // début contenu sous header

  // Bandeau GSS (logo + Code/Version) -> TOUTES les pages
  const drawHeaderBand = (doc) => {
    const pageW = doc.internal.pageSize.getWidth();
    doc.setDrawColor(212,160,23); doc.setLineWidth(1.2);
    doc.line(mm.left, HEADER_TOP_Y, pageW - mm.right, HEADER_TOP_Y);
    doc.line(mm.left, 24, pageW - mm.right, 24);
    if (logoDataUrl) doc.addImage(logoDataUrl, undefined, mm.left, 11, 22, 10, undefined, 'FAST');
    const rx = pageW - mm.right;
    doc.setFont('times','bold'); doc.setFontSize(10); doc.setTextColor(0);
    doc.text(`Code : ${headerCode || '—'}`, rx, 14, { align:'right', maxWidth: 70 });
    doc.text(`Version : ${headerVersion || '—'}`, rx, 19, { align:'right', maxWidth: 70 });
  };

  // Bloc Titre + Client/Date -> 1ʳᵉ page UNIQUEMENT
  const drawFirstPageTitleBlock = (doc) => {
    const pageW = doc.internal.pageSize.getWidth();
    doc.setDrawColor(0); doc.setLineWidth(0.3);
    const boxX=mm.left, boxW=pageW - mm.left - mm.right;
    doc.rect(boxX, 26.5, boxW, 8);
    doc.setFont('times','bold'); doc.setFontSize(13);
    doc.text((headerTitle||'—'), pageW/2, 31.5, { align:'center' });

    doc.setFont('times','bold'); doc.setFontSize(10);
    doc.text('Client :', mm.left, 42);
    doc.text('Date :', pageW/2 + 10, 42);
    doc.setFont('times','normal');
    doc.text(client || '—', mm.left + 18, 42, { maxWidth: pageW/2 - mm.left - 20 });
    doc.text(dateControle || '—', pageW/2 + 22, 42, { maxWidth: pageW/2 - mm.right - 22 });
  };

  // Bandeau "crème" utilisé pour toutes les sections
const SECTION_FILL = [255, 247, 225]; // #FFF7E1

// === (A) Remplacer drawSectionTitle ===
// Utilisé avant le tableau "Points de contrôle"
const drawSectionTitle = (doc, title, yStart) => {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableH = pageH - mm.bottom;

  let y = yStart;
  const boxH = 8;
  if (y + boxH + 5 > usableH) {
    doc.addPage();
    drawBackground(doc);
    drawHeaderBand(doc);     // ton bandeau GSS
    y = CONTENT_START_Y;
  }

  const boxX = mm.left;
  const boxW = pageW - mm.left - mm.right;

  // même style que "4. Signature" (fond crème + bord fin + texte noir gras)
  doc.setFillColor(...SECTION_FILL);
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.roundedRect(boxX, y, boxW, boxH, 1.2, 1.2, 'FD');

  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0);
  // texte aligné à gauche avec un padding
  doc.text(title, mm.left + 4, y + 5.4);

  return y + boxH + 3;
};


  // === (B) Remplacer addSectionBlock ===
// Utilisé pour "2. Constatations générales" et "3. Recommandations globales"
const addSectionBlock = (doc, title, text, yStart) => {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableH = pageH - mm.bottom;

  let y = yStart;
  const boxH = 8;

  if (y + boxH + 5 > usableH) {
    doc.addPage();
    drawBackground(doc);
    drawHeaderBand(doc);
    y = CONTENT_START_Y;
  }

  const boxX = mm.left;
  const boxW = pageW - mm.left - mm.right;

  // même look que la section 4
  doc.setFillColor(...SECTION_FILL);
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.roundedRect(boxX, y, boxW, boxH, 1.2, 1.2, 'FD');

  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(title, mm.left + 4, y + 5.4);

  // paragraphe justifié (inchangé)
  y += boxH + 2;
  const content = (text || '—').trim();

  autoTable(doc, {
    startY: y,
    margin: { top: CONTENT_START_Y, left: mm.left, right: mm.right, bottom: mm.bottom },
    head: [],
    body: [[content]],
    styles: {
      font: 'times',
      fontSize: 10,
      cellPadding: 2,
      lineWidth: 0,
      textColor: 20,
      halign: 'justify',
      valign: 'top'
    },
    columnStyles: { 0: { cellWidth: pageW - mm.left - mm.right } },
    theme: 'plain',
 didDrawPage: (data) => {
  drawBackground(doc);
  drawHeaderBand(doc);
  if (data.pageNumber === 1) drawFirstPageTitleBlock(doc);
},

  });

  return doc.lastAutoTable.finalY + 6;
};


  // Section 4 - Signature (dernière page)
  const addSignatureSection = (doc, yStart) => {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableH = pageH - mm.bottom;
  let y = yStart;

  const boxH = 8;
  if (y + boxH + 25 > usableH) { // réserve plus d'espace
    doc.addPage();
    drawBackground(doc);
    drawHeaderBand(doc);
    y = CONTENT_START_Y;
  }

  const boxX = mm.left;
  const boxW = pageW - mm.left - mm.right;

  // Fond crème + cadre
  doc.setFillColor(255, 247, 225);
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.roundedRect(boxX, y, boxW, boxH, 1.2, 1.2, 'FD');

  // Titre "4. Signature"
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text('4. Signature', mm.left + 4, y + 5.4);

  // Ligne contrôleur
  y += boxH + 8;
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.text('Contrôleur :', mm.left + 4, y);

  // Champ libre (texte ou ligne vide)
  const ctrlText = controleur ? controleur : '...............................................................';
  doc.setFont('times', 'normal');
  doc.text(ctrlText, mm.left + 36, y);

  // Ligne pour signature visuelle
  //y += 10;
  //doc.setDrawColor(100);
  //doc.line(mm.left + 36, y, mm.left + 100, y); // ligne signature

  // Etiquette facultative
  //doc.setFontSize(9);
  //doc.text('(Signature et cachet)', mm.left + 38, y + 5);

  return y + 10;
};



  const generatePDF = async () => {
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });

// page 1
drawBackground(doc);
drawHeaderBand(doc);
drawFirstPageTitleBlock(doc);


    // style global
    doc.setFont('times','normal'); doc.setFontSize(10); doc.setLineHeightFactor(1.25);

    const pageH = doc.internal.pageSize.getHeight();

    // Déclencher header (bande sur toutes pages + bloc titre uniquement page 1)
    autoTable(doc, {
      head: [], body: [],
      margin: { top: CONTENT_START_Y, left: mm.left, right: mm.right, bottom: mm.bottom },
    didDrawPage: (data) => {
  drawBackground(doc);
  drawHeaderBand(doc);
  if (data.pageNumber === 1) drawFirstPageTitleBlock(doc);
},


    });

    // Section 1
    let y = CONTENT_START_Y - 4;
    y = drawSectionTitle(doc, '1. Points de contrôle', y);

    const bodyRows = points.map(p => [p.point||'', p.nonConformite||'', (p.preuvesText||'').trim(), p.action||'']);
    const imgW=28, imgH=16, lineGap=1.5, textLineH=5;

    autoTable(doc, {
      startY: y + 2,
      margin: { top: CONTENT_START_Y, left: mm.left, right: mm.right, bottom: mm.bottom },
      head: [['Point vérifié', 'Non-conformité', 'Preuves / Observations / Photos', 'Action immédiate']],
      body: bodyRows,
      styles: { font:'times', fontSize:10, cellPadding:3, lineWidth:0.1, lineColor:[180,180,180], halign:'center', valign:'middle', overflow:'linebreak' },
      headStyles: { fontStyle:'bold', fontSize:11, fillColor:[235,235,235], textColor:20, halign:'center', valign:'middle' },
      alternateRowStyles: { fillColor:[248,248,248] },
      columnStyles: { 0:{cellWidth:35}, 1:{cellWidth:35}, 2:{cellWidth:'auto', minCellWidth:70}, 3:{cellWidth:34} },
      theme:'grid',

      didParseCell: (data) => {
        const { section, row, column, cell } = data;
        if (section==='body' && column.index===2) {
          const idx=row.index; const text=(points[idx]?.preuvesText||'').trim();
          const textLines=doc.splitTextToSize(text, cell.width - 2);
          const nLines=Math.max(1,textLines.length);
          const nImgs=points[idx]?.preuvesImages?.length||0;
          const needed=nLines*textLineH + (nImgs?3:0) + nImgs*(imgH+lineGap) + 4;
          cell.styles.minCellHeight=Math.max(cell.styles.minCellHeight||0, needed);
        }
        if (data.section==='head') data.cell.styles.overflow='hidden';
      },

      didDrawCell: (data) => {
        const { section, row, column, cell } = data;
        if (section!=='body' || column.index!==2) return;
        const idx=row.index; const imgs=points[idx]?.preuvesImages||[]; if(!imgs.length) return;
        const text=(points[idx]?.preuvesText||'').trim();
        const textLines=doc.splitTextToSize(text, cell.width - 2);
        let yCursor = cell.y + 2 + Math.max(1,textLines.length)*textLineH + 3;
        imgs.forEach(src => { const x=cell.x + (cell.width - imgW)/2; doc.addImage(src, undefined, x, yCursor, imgW, imgH, undefined, 'FAST'); yCursor += imgH + lineGap; });
      },

      didDrawPage: (data) => {
  drawBackground(doc);
  drawHeaderBand(doc);
  if (data.pageNumber === 1) drawFirstPageTitleBlock(doc);
},

    });

    y = doc.lastAutoTable.finalY + 8;

    // Section 2 / 3
    y = addSectionBlock(doc, '2. Constatations générales', constatations, y);
    y = addSectionBlock(doc, '3. Recommandations globales', recommandations, y);

    // ---- Section 4 : Signature -> toujours en DERNIÈRE page ----
    y = addSignatureSection(doc, y);

    // Sauvegarde
    const safeClient=(client||'Client').replace(/[^\w\d-]+/g,'_');
    const safeDate=(dateControle||'Date').replace(/[^\w\d-]+/g,'_');
    doc.save(`Rapport_${safeClient}_${safeDate}.pdf`);
  };
// --- Fond filigrane, version sûre (synchrone) ---
const drawBackground = (doc) => {
  if (!bgDataUrl) return;

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Taille et position (ajuste si besoin)
  const imgW = 170;  // mm
  const imgH = 105;  // mm
  const x = (pageW - imgW) / 2;
  const y = (pageH - imgH) / 2;

  try {
    if (doc.GState && typeof doc.setGState === 'function') {
      const low = new doc.GState({ opacity: 0.06 }); // ~6% d’opacité
      doc.setGState(low);
      doc.addImage(bgDataUrl, 'PNG', x, y, imgW, imgH, undefined, 'FAST');
      const full = new doc.GState({ opacity: 1 });
      doc.setGState(full); // rétablit l’opacité normale
    } else {
      // Fallback si GState indisponible
      doc.addImage(bgDataUrl, 'PNG', x, y, imgW, imgH, undefined, 'FAST');
    }
  } catch {
    // Fallback en cas d’erreur
    doc.addImage(bgDataUrl, 'PNG', x, y, imgW, imgH, undefined, 'FAST');
  }
};

  // ---------- UI ----------
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 font-sans">
      <h1 className="text-2xl font-bold text-center mb-2">{pageTitle}</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div><label className="font-semibold">Code</label>
          <input className="border p-2 w-full rounded" placeholder="ex. FO-SI-05" value={headerCode} onChange={e=>setHeaderCode(e.target.value)} /></div>
        <div><label className="font-semibold">Version</label>
          <input className="border p-2 w-full rounded" placeholder="ex. 01" value={headerVersion} onChange={e=>setHeaderVersion(e.target.value)} /></div>
        <div className="md:col-span-2"><label className="font-semibold">Titre</label>
          <input className="border p-2 w-full rounded" placeholder="ex. Rapport de contrôle" value={headerTitle} onChange={e=>setHeaderTitle(e.target.value)} /></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="space-y-2">
          <label className="font-semibold">Logo (PNG/JPG)</label>
          <input type="file" accept="image/*" onChange={onLogoUpload} className="border p-2 w-full rounded" />
        </div>
        <button className="px-3 py-2 border rounded h-[42px]" onClick={resetLogo}>↺ Réinitialiser le logo</button>
        <div className="flex items-center gap-3">
          <div className="border rounded w-40 h-16 flex items-center justify-center bg-white">
            <img src={logoPreviewSrc} alt="Logo" className="max-h-14 max-w-36 object-contain" />
          </div>
          {/* <span className="text-sm text-gray-600">Par défaut : <code>/gss-logo.png</code></span> */}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className="font-semibold">Client</label>
          <input className="border p-2 w-full rounded" value={client} onChange={e=>setClient(e.target.value)} /></div>
        <div><label className="font-semibold">Date du contrôle</label>
          <input type="date" className="border p-2 w-full rounded" value={dateControle} onChange={e=>setDateControle(e.target.value)} /></div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">1. Points de contrôle</h2>
          <button className="border rounded px-3 py-1" onClick={addPoint}>+ Ajouter une ligne</button>
        </div>

        {points.map((p, i) => (
          <div key={i} className="border p-3 rounded-lg mb-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <textarea className="border p-1 rounded" placeholder="Point vérifié"
                        value={p.point} onChange={e=>{ const n=[...points]; n[i].point=e.target.value; setPoints(n); }} />
              <textarea className="border p-1 rounded" placeholder="Non-conformité"
                        value={p.nonConformite} onChange={e=>{ const n=[...points]; n[i].nonConformite=e.target.value; setPoints(n); }} />
              <div className="md:col-span-2 space-y-2">
                <textarea className="border p-1 rounded" placeholder="Preuves / Observations / Photos (texte libre)"
                          value={p.preuvesText} onChange={e=>setPreuvesText(i, e.target.value)} />
                <input type="file" accept="image/*" multiple onChange={e=>addPreuvesImages(i, e.target.files)} className="border p-1 rounded" />
                {p.preuvesImages?.length>0 && (
                  <div className="flex flex-col gap-2">
                    {p.preuvesImages.map((src,k)=>(
                      <div key={k} className="flex items-center gap-3">
                        <img src={src} alt="" className="h-16 w-28 object-cover rounded border" />
                        <button type="button" onClick={()=>removePreuveImage(i,k)} className="text-red-600 hover:underline">Supprimer cette image</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <textarea className="border p-1 rounded" placeholder="Action immédiate"
                        value={p.action} onChange={e=>{ const n=[...points]; n[i].action=e.target.value; setPoints(n); }} />
            </div>
            <div className="text-right">
              <button className="text-red-700 hover:underline" onClick={()=>removePoint(i)}>🗑️ Supprimer cette ligne</button>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-2">2. Constatations générales</h2>
        <textarea className="border p-2 w-full rounded" rows="5" value={constatations} onChange={e=>setConstatations(e.target.value)} />
      </div>
      <div>
        <h2 className="text-xl font-semibold mb-2">3. Recommandations globales</h2>
        <textarea className="border p-2 w-full rounded" rows="5" value={recommandations} onChange={e=>setRecommandations(e.target.value)} />
      </div>
{/* 4. Signature / Contrôleur (saisie) */}
<div>
  <h2 className="text-xl font-semibold mb-2">4. Signature</h2>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <label className="font-semibold">Contrôleur</label>
      <input
        className="border p-2 w-full rounded"
        placeholder="Nom et prénom du contrôleur"
        value={controleur}
        onChange={(e) => setControleur(e.target.value)}
      />
    </div>
  </div>
</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="font-semibold">Importer un rapport (.json)</label>
          <input type="file" accept="application/json" onChange={importJson} className="border p-2 w-full rounded" />
        </div>
        <button onClick={exportJson} className="border rounded p-2">💾 Exporter JSON</button>
        <button onClick={generatePDF} className="bg-blue-600 text-white rounded p-2">🖨️ Générer le PDF</button>
      </div>
    </div>
  );
}

export default App;
