import { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import './quill-gss.css';

// -------------------- Utils: dates --------------------
const fmtFR = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const rangeLabelFR = (arr) => {
  if (!arr?.length) return '—';
  const unique = Array.from(new Set(arr.filter(Boolean)));
  if (!unique.length) return '—';
  unique.sort();
  if (unique.length === 1) return fmtFR(unique[0]);
  const toOrdinal = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  };
  const ords = unique.map(toOrdinal);
  const min = Math.min(...ords);
  const max = Math.max(...ords);
  const set = new Set(ords);
  const isContiguous = (max - min + 1) === set.size;
  if (isContiguous) return `du ${fmtFR(unique[0])} au ${fmtFR(unique[unique.length - 1])}`;
  return unique.map(fmtFR).join(', ');
};
const normalizeProofs = (arr) =>
  Array.isArray(arr)
    ? arr.map((x) =>
        typeof x === 'string'
          ? { src: x, caption: '', pos: 'after' }
          : { src: x.src, caption: x.caption || '', pos: x.pos === 'before' ? 'before' : 'after' }
      )
    : [];

const dedupeProofs = (arr) => {
  const seen = new Set();
  const out = [];
  for (const it of normalizeProofs(arr)) {
    if (!it?.src) continue;
    if (seen.has(it.src)) continue;
    seen.add(it.src);
    out.push(it);
  }
  return out;
};

// -------------------- Quill toolbar (light) --------------------
export const quillFormats = [
  'header',
  'bold', 'italic', 'underline', 'strike',
  'list', 'indent',
  'align',
  'color', 'background',
  'link', 'blockquote', 'clean',
];

export const quillModules = {
  toolbar: [
    [{ header: [false, 2, 3, 4] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'bullet' }, { list: 'ordered' }, { indent: '-1' }, { indent: '+1' }],
    [{ align: [] }],
    [{ color: [] }, { background: [] }],
    ['link', 'blockquote', 'clean'],
  ],
  keyboard: {
    bindings: {
      tab: {
        key: 9,
        handler: function (range, ctx) {
          const level = ctx.format.indent ?? 0;
          this.quill.format('indent', level + 1);
          return false;
        },
      },
      shift_tab: {
        key: 9,
        shiftKey: true,
        handler: function (range, ctx) {
          const level = ctx.format.indent ?? 0;
          this.quill.format('indent', Math.max(0, level - 1));
          return false;
        },
      },
    },
  },
};

// -------------------- Quill HTML → plain text for autoTable --------------------
const quillHtmlToText = (html, doc, maxWidth) => {
  if (!html) return '—';
  const root = document.createElement('div');
  root.innerHTML = html;

  const bulletForLevel = (lvl) => (['•', '○', '▪', '–', '›'][lvl] ?? '•');
  const wrap = (t) => doc.splitTextToSize(t, maxWidth);
  const out = [];

  const liTextOnly = (li) => {
    const clone = li.cloneNode(true);
    clone.querySelectorAll('ul,ol').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const walk = (node) => {
    if (node.nodeType === 3) {
      const t = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (t) out.push(...wrap(t));
      return;
    }
    if (node.nodeName === 'BR') { out.push(''); return; }

    if (node.nodeName === 'UL' || node.nodeName === 'OL') {
      Array.from(node.children).forEach((li, i) => {
        if (li.nodeName !== 'LI') return;
        const cls = Array.from(li.classList).find(c => c.startsWith('ql-indent-'));
        const level = cls ? Math.max(0, parseInt(cls.split('-').pop(), 10)) : 0;
        const text = liTextOnly(li);
        if (!text) return;
        if (node.nodeName === 'OL') {
          const line = `${'  '.repeat(level)}${i + 1}. ${text}`;
          out.push(...wrap(line));
        } else {
          const line = `${'  '.repeat(level)}${bulletForLevel(level)} ${text}`;
          out.push(...wrap(line));
        }
        li.querySelectorAll(':scope > ul, :scope > ol').forEach(walk);
      });
      out.push('');
      return;
    }
    Array.from(node.childNodes).forEach(walk);
  };

  Array.from(root.childNodes).forEach(walk);
  return out.join('\n');
};

export default function App() {
  // -------------------- Header --------------------
  const [headerCode, setHeaderCode] = useState('FO-SI-08');
  const [headerVersion, setHeaderVersion] = useState('2');
  const [headerTitle, setHeaderTitle] = useState('Rapport de contrôle inopiné');

  // -------------------- Form --------------------
  const [client, setClient] = useState('');
  const [sites, setSites] = useState([
    { name: '', points: [{ point: '', nonConformite: '', preuvesText: '', preuvesImages: [], action: '' }] },
  ]);
  const [constatations, setConstatations] = useState('');
  const [recommandations, setRecommandations] = useState('');
  const [controleur, setControleur] = useState('');

  // -------------------- Options PDF/UI --------------------
  const [forcePageBreakBetweenSites, setForcePageBreakBetweenSites] = useState(false);
  const [minBlockMM, setMinBlockMM] = useState(28);

  // -------------------- Dates --------------------
  const [datesControle, setDatesControle] = useState([]);
  const [dateInput, setDateInput] = useState('');

  // -------------------- Assets (Logo + BG) --------------------
  const [logoPreviewSrc, setLogoPreviewSrc] = useState('/gss-logo.png');
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const [logoError, setLogoError] = useState(null);

  const loadDefaultLogoDataUrl = () =>
    fetch('/gss-logo.png')
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then(
        (b) =>
          new Promise((res) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(b);
          })
      );

  useEffect(() => {
    if (!logoDataUrl) {
      loadDefaultLogoDataUrl()
        .then((data) => { setLogoDataUrl(data); setLogoError(null); })
        .catch(() => { setLogoError('Impossible de charger le logo par défaut.'); setLogoDataUrl(null); });
    }
  }, [logoDataUrl]);

  const onLogoUpload = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const maxSize = 3 * 1024 * 1024;
    if (!allowed.includes(f.type)) {
      alert('Format non supporté. Utilisez PNG, JPG/JPEG ou WEBP.');
      e.target.value = '';
      return;
    }
    if (f.size > maxSize) {
      alert('Fichier trop volumineux (max 3 Mo).');
      e.target.value = '';
      return;
    }
    setLogoError(null);
    setLogoPreviewSrc(URL.createObjectURL(f));
    const r = new FileReader();
    r.onload = () => setLogoDataUrl(r.result);
    r.onerror = () => { setLogoError('Erreur de lecture du fichier logo.'); };
    r.readAsDataURL(f);
  };

  const resetLogo = () => {
    setLogoPreviewSrc('/gss-logo.png');
    setLogoError(null);
    loadDefaultLogoDataUrl()
      .then((data) => { setLogoDataUrl(data); setLogoError(null); })
      .catch(() => { setLogoDataUrl(null); setLogoError('Impossible de recharger le logo par défaut.'); });
  };

  // BG watermark (optional)
  const [bgDataUrl, setBgDataUrl] = useState(null);
  useEffect(() => {
    fetch('/GSSbg.png')
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then(
        (b) =>
          new Promise((res) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(b);
          })
      )
      .then((data) => setBgDataUrl(data))
      .catch(() => setBgDataUrl(null));
  }, []);

const drawBackground = async (doc) => {
  if (!bgDataUrl) return;

  try {
    // Charger l'image dans un <canvas> pour appliquer la transparence
    const img = new Image();
    img.src = bgDataUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    // Créer un canvas temporaire
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    // Appliquer une transparence douce (ajuste l’opacité ici)
    ctx.globalAlpha = 0.05; // 🔹 entre 0.03 et 0.1 selon ton goût
    ctx.drawImage(img, 0, 0, img.width, img.height);
    const transparentDataUrl = canvas.toDataURL('image/png');

    // Adapter à la largeur du PDF
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const aspect = img.width / img.height;
    const imgW = pageW * 0.95; // 95% de la largeur de page
    const imgH = imgW / aspect;
    const x = (pageW - imgW) / 2;
    const y = (pageH - imgH) / 2;

    // Dessiner le filigrane en arrière-plan
    doc.addImage(transparentDataUrl, 'PNG', x, y, imgW, imgH, undefined, 'FAST');
  } catch (err) {
    console.warn('Erreur de filigrane :', err);
  }
};


  // -------------------- Site/Points helpers --------------------
  const addSite = () =>
    setSites((s) => [...s, { name: '', points: [{ point: '', nonConformite: '', preuvesText: '', preuvesImages: [], action: '' }] }]);

  const removeSite = (siteIdx) => setSites((s) => s.filter((_, i) => i !== siteIdx));

  const addPoint = (siteIdx) =>
    setSites((s) => {
      const n = [...s];
      n[siteIdx] = { ...n[siteIdx], points: [...n[siteIdx].points, { point: '', nonConformite: '', preuvesText: '', preuvesImages: [], action: '' }] };
      return n;
    });

  const removePoint = (siteIdx, pointIdx) =>
    setSites((s) => {
      const n = [...s];
      n[siteIdx] = { ...n[siteIdx], points: n[siteIdx].points.filter((_, i) => i !== pointIdx) };
      return n;
    });

  const setSiteName = (siteIdx, val) =>
    setSites((s) => {
      const n = [...s];
      n[siteIdx] = { ...n[siteIdx], name: val };
      return n;
    });

  const setPointField = (siteIdx, pointIdx, key, val) =>
    setSites((s) => {
      const n = [...s];
      const pts = [...n[siteIdx].points];
      pts[pointIdx] = { ...pts[pointIdx], [key]: val };
      n[siteIdx].points = pts;
      return n;
    });

  const normalizeProofs = (arr) =>
    (Array.isArray(arr)
      ? arr.map((x) => (typeof x === 'string'
        ? { src: x, caption: '', pos: 'after' }
        : { src: x.src, caption: x.caption || '', pos: x.pos === 'before' ? 'before' : 'after' }))
      : []);

  const updatePreuveMeta = (siteIdx, pointIdx, k, key, val) =>
    setSites((s) => {
      const n = [...s];
      const pts = [...n[siteIdx].points];
      const p = { ...pts[pointIdx] };
      const arr = normalizeProofs(p.preuvesImages);
      if (!arr[k]) return s;
      arr[k] = { ...arr[k], [key]: val };
      p.preuvesImages = arr;
      pts[pointIdx] = p;
      n[siteIdx].points = pts;
      return n;
    });

  const addPreuvesImages = (siteIdx, pointIdx, files) => {
    if (!files?.length) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const maxSize = 5 * 1024 * 1024;
    const valid = [];
    const rejected = [];
    [...files].forEach((f) => {
      if (!allowed.includes(f.type)) rejected.push(`${f.name}: format non supporté`);
      else if (f.size > maxSize) rejected.push(`${f.name}: > 5 Mo`);
      else valid.push(f);
    });
    if (rejected.length) alert('Certaines images ont été ignorées:\n' + rejected.join('\n'));
    if (!valid.length) return;
    const toDataURL = (f) =>
      new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error('Lecture échouée: ' + f.name));
        r.readAsDataURL(f);
      });
    Promise.allSettled(valid.map(toDataURL)).then((results) => {
      const urls = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      const fails = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || 'Lecture échouée');
      if (fails.length) alert('Certaines lectures ont échoué:\n' + fails.join('\n'));
      if (!urls.length) return;
     setSites((s) => {
  const n = [...s];
  const pts = [...n[siteIdx].points];
  const p = { ...pts[pointIdx] };

  const existing = normalizeProofs(p.preuvesImages);
  const toAdd = urls.map((src) => ({ src, caption: '', pos: 'after' }));

  p.preuvesImages = dedupeProofs([...existing, ...toAdd]); // <-- dédup ici
  pts[pointIdx] = p;
  n[siteIdx].points = pts;
  return n;
});

    });
  };

  const removePreuveImage = (siteIdx, pointIdx, k) =>
    setSites((s) => {
      const n = [...s];
      const pts = [...n[siteIdx].points];
      const p = { ...pts[pointIdx] };
      const arr = normalizeProofs(p.preuvesImages);
      p.preuvesImages = arr.filter((_, i) => i !== k);
      pts[pointIdx] = p;
      n[siteIdx].points = pts;
      return n;
    });

  // -------------------- Import/Export JSON --------------------
  const exportJson = () => {
    const data = { headerCode, headerVersion, headerTitle, client, datesControle, sites, constatations, recommandations, controleur, logoDataUrl };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const label = rangeLabelFR(datesControle).replaceAll(' ', '_').replace(/[^\w\d-_/]+/g, '');
    a.download = `Rapport_${(client || 'Client').replace(/[^\w\d-]+/g, '_')}_${label || 'Date'}.json`;
    a.click();
  };

  const importJson = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        setHeaderCode(d.headerCode ?? '');
        setHeaderVersion(d.headerVersion ?? '');
        setHeaderTitle(d.headerTitle ?? 'Rapport de contrôle inopiné');
        setClient(d.client ?? '');
        setDatesControle(Array.isArray(d.datesControle) ? d.datesControle : d.dateControle ? [d.dateControle] : []);
        if (Array.isArray(d.sites)) setSites(d.sites);
        else if (Array.isArray(d.points)) setSites([{ name: '', points: d.points }]);
        else if (Array.isArray(d.sites)) {
  setSites(d.sites.map(site => ({
    ...site,
    points: (site.points || []).map(pt => ({
      ...pt,
      preuvesImages: dedupeProofs(pt.preuvesImages)
    }))
  })));
} else if (Array.isArray(d.points)) {
  setSites([{
    name: '',
    points: d.points.map(pt => ({ ...pt, preuvesImages: dedupeProofs(pt.preuvesImages) }))
  }]);
} else {
  setSites([{ name: '', points: [{ point: '', nonConformite: '', preuvesText: '', preuvesImages: [], action: '' }] }]);
}

        setConstatations(d.constatations ?? '');
        setRecommandations(d.recommandations ?? '');
        setControleur(d.controleur ?? '');
        if (d.logoDataUrl) { setLogoDataUrl(d.logoDataUrl); setLogoPreviewSrc(d.logoDataUrl); }
      } catch { alert('Fichier JSON invalide.'); }
    };
    r.readAsText(f);
  };

  // -------------------- PDF helpers --------------------
  const mm = { left: 15, right: 15, top: 18, bottom: 18 };
  const CONTENT_START_Y = 50;

  const drawHeaderBand = (doc) => {
    const pageW = doc.internal.pageSize.getWidth();
    doc.setDrawColor(212, 160, 23);
    doc.setLineWidth(1.2);
    doc.line(mm.left, 10, pageW - mm.right, 10);
    doc.line(mm.left, 24, pageW - mm.right, 24);
    if (logoDataUrl) { try { doc.addImage(logoDataUrl, undefined, mm.left, 11, 22, 10, undefined, 'FAST'); } catch {} }
    const rx = pageW - mm.right;
    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Code : ${headerCode || '—'}`, rx, 14, { align: 'right' });
    doc.text(`Version : ${headerVersion || '—'}`, rx, 19, { align: 'right' });
  };

  const drawFirstPageTitleBlock = (doc) => {
    const pageW = doc.internal.pageSize.getWidth();
    const boxX = mm.left; const boxW = pageW - mm.left - mm.right;
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.rect(boxX, 26.5, boxW, 8);
    doc.setFont('times', 'bold'); doc.setFontSize(13);
    doc.text(headerTitle || 'Rapport de contrôle inopiné', pageW / 2, 31.5, { align: 'center' });

    doc.setFont('times', 'bold'); doc.setFontSize(10);
    doc.text('Client :', mm.left, 42);
    doc.text('Date :', pageW / 2 + 10, 42);

    doc.setFont('times', 'normal');
    const clientLines = doc.splitTextToSize((client || '—').toString(), Math.max(20, (pageW / 2) - (mm.left + 20)));
    const dateLines = doc.splitTextToSize(rangeLabelFR(datesControle) || '—', Math.max(20, (pageW - mm.right) - (pageW / 2 + 22)));
    doc.text(clientLines, mm.left + 18, 42);
    doc.text(dateLines, pageW / 2 + 22, 42);
  };

  const drawSectionTitle = (doc, title, yStart) => {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const usableH = pageH - mm.bottom;
    let y = yStart; const boxH = 8;
    if (y + boxH + 5 > usableH) { drawBackground(doc); drawHeaderBand(doc); y = CONTENT_START_Y; }
    const boxX = mm.left; const boxW = pageW - mm.left - mm.right;
    doc.setFillColor(255, 247, 225); doc.setDrawColor(0); doc.setLineWidth(0.3); doc.roundedRect(boxX, y, boxW, boxH, 1.2, 1.2, 'FD');
    doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(0); doc.text(title, mm.left + 4, y + 5.4);
    return y + boxH + 3;
  };

  const drawSiteSubtitle = (doc, siteName, yStart) => {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const usableH = pageH - mm.bottom;
    let y = yStart; const boxH = 7;
    if (y + boxH + 3 > usableH) { drawBackground(doc); drawHeaderBand(doc); y = CONTENT_START_Y; }
    const boxX = mm.left; const boxW = pageW - mm.left - mm.right;
    doc.setFillColor(245, 245, 245); doc.setDrawColor(180); doc.setLineWidth(0.2); doc.roundedRect(boxX, y, boxW, boxH, 1, 1, 'FD');
    doc.setFont('times', 'bold'); doc.setFontSize(11);
    const label = siteName?.trim() ? `Site : ${siteName.trim()}` : 'Site : —';
    doc.text(label, mm.left + 4, y + 4.8);
    return y + boxH + 2;
  };

  // Block that converts Quill HTML to text and renders with autoTable (stable)
  const addSectionBlock = (doc, title, html, yStart) => {
    let y = drawSectionTitle(doc, title, yStart);
    const pageW = doc.internal.pageSize.getWidth();
    const text = quillHtmlToText(html, doc, pageW - mm.left - mm.right);
    autoTable(doc, {
      startY: y + 1,
      margin: { top: CONTENT_START_Y, left: mm.left, right: mm.right, bottom: mm.bottom },
      head: [],
      body: [[text]],
      styles: { font: 'times', fontSize: 10, cellPadding: 2, lineWidth: 0, textColor: 20, halign: 'left', valign: 'top' },
      columnStyles: { 0: { cellWidth: pageW - mm.left - mm.right } },
      theme: 'plain',
      didDrawPage: (data) => { drawBackground(doc); drawHeaderBand(doc); if (data.pageNumber === 1) drawFirstPageTitleBlock(doc); },
    });
    return (doc.lastAutoTable?.finalY ?? (y + 10)) + 6;
  };

  // -------------------- PDF generation --------------------
  const generatePDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFont('times', 'normal'); doc.setFontSize(10); doc.setLineHeightFactor(1.25);

    const preflightSpace = (y) => {
      const minBlock = Number(minBlockMM) > 0 ? Number(minBlockMM) : 28;
      const pageH = doc.internal.pageSize.getHeight();
      const usableH = pageH - mm.bottom;
      if (y + minBlock > usableH) { drawBackground(doc); drawHeaderBand(doc); return CONTENT_START_Y; }
      return y;
    };

    // prepare first page
    drawBackground(doc);
    drawHeaderBand(doc);
    drawFirstPageTitleBlock(doc);

    const pageW = doc.internal.pageSize.getWidth();
    const tableW = pageW - mm.left - mm.right;
    const w0 = Math.round(tableW * 0.20);
    const w1 = Math.round(tableW * 0.20);
    const w2 = Math.round(tableW * 0.44);
    const w3 = tableW - (w0 + w1 + w2);

    // tiny table just to install a global didDrawPage
    autoTable(doc, {
      head: [], body: [],
      margin: { top: CONTENT_START_Y, left: mm.left, right: mm.right, bottom: 8 },
      didDrawPage: (data) => { drawBackground(doc); drawHeaderBand(doc); if (data.pageNumber === 1) drawFirstPageTitleBlock(doc); },
    });

    let y = CONTENT_START_Y - 4;
    y = drawSectionTitle(doc, '1. Points de contrôle', y);

    const renderSiteTable = (site, idx) => {
      if (forcePageBreakBetweenSites && idx > 0) { drawBackground(doc); drawHeaderBand(doc); y = CONTENT_START_Y; }
      y = preflightSpace(y);
      y = drawSiteSubtitle(doc, site.name, y);

      const bodyRows = (site.points || []).map((p) => [p.point || '', p.nonConformite || '', (p.preuvesText || '').trim(), p.action || '']);

      autoTable(doc, {
        startY: y + 2,
        margin: { top: CONTENT_START_Y, left: mm.left, right: mm.right, bottom: mm.bottom },
        head: [['Point vérifié', 'Non-conformité', 'Preuves / Observations / Photos', 'Action immédiate']],
        body: bodyRows,
        styles: { font: 'times', fontSize: 10, cellPadding: 2, lineWidth: 0.1, lineColor: [180, 180, 180], halign: 'center', valign: 'top', overflow: 'linebreak' },
        headStyles: { fontStyle: 'bold', fontSize: 11, fillColor: [235, 235, 235], textColor: 20, halign: 'center', valign: 'middle' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: { 0: { cellWidth: w0 }, 1: { cellWidth: w1 }, 2: { cellWidth: w2 }, 3: { cellWidth: w3 } },
        theme: 'grid',

        didParseCell: (data) => {
          const { section, row, column, cell } = data;
          if (section === 'head' && column.index === 2) {
            cell.styles.fontSize = 10; cell.styles.cellPadding = 2;
          }
          if (section === 'body' && column.index === 2) {
            const idxRow = row.index;
            const point = site.points?.[idxRow] || {};
            const text = (point.preuvesText || '').trim();
            const textLines = data.doc.splitTextToSize(text, Math.max(10, cell.width - 2));
            const textForMeasure = Array.isArray(textLines) ? textLines.join('\n') : (text || ' ');
            const dims = data.doc.getTextDimensions(textForMeasure);
            const textHeightMM = (dims.h || 0) / data.doc.internal.scaleFactor;

            const proofs = (Array.isArray(point.preuvesImages) ? point.preuvesImages : []).map((x) =>
              typeof x === 'string' ? { src: x, caption: '', pos: 'after' } : { src: x.src, caption: x.caption || '', pos: x.pos === 'before' ? 'before' : 'after' }
            );

            const IMG_W = 40; const IMG_H = 28; const CAPTION_FONT = 9; const CAPTION_GAP = 1.5; const ITEM_GAP = 4;
            let imagesBlockHeight = 0;
            proofs.forEach((it, i) => {
              const capLines = data.doc.splitTextToSize(it.caption || '', Math.max(10, cell.width - 2));
              const capDims = data.doc.getTextDimensions(Array.isArray(capLines) ? capLines.join('\n') : (it.caption || ' '));
              const capH = ((it.caption ? capDims.h : 0) || 0) / data.doc.internal.scaleFactor;
              const beforeH = it.pos === 'before' ? (capH ? capH + CAPTION_GAP : 0) : 0;
              const afterH = it.pos === 'after' ? (capH ? CAPTION_GAP + capH : 0) : 0;
              imagesBlockHeight += beforeH + IMG_H + afterH;
              if (i < proofs.length - 1) imagesBlockHeight += ITEM_GAP;
            });

            const needed = textHeightMM + (proofs.length ? 2 : 0) + imagesBlockHeight + 4;
            cell.styles.minCellHeight = Math.max(cell.styles.minCellHeight || 0, needed);
            cell._gssImgDims = { IMG_W, IMG_H, textHeightMM, CAPTION_FONT, CAPTION_GAP, ITEM_GAP };
          }
        },

        didDrawCell: (data) => {
          if (data.section !== 'body' || data.column.index !== 2) return;
          const idxRow = data.row.index;
          const point = site.points?.[idxRow] || {};
          const proofs = (Array.isArray(point.preuvesImages) ? point.preuvesImages : []).map((x) =>
            typeof x === 'string' ? { src: x, caption: '', pos: 'after' } : { src: x.src, caption: x.caption || '', pos: x.pos === 'before' ? 'before' : 'after' }
          );
          if (!proofs.length) return;
          const d = data.cell._gssImgDims || { IMG_W: 40, IMG_H: 28, textHeightMM: 8, CAPTION_FONT: 9, CAPTION_GAP: 1.5, ITEM_GAP: 4 };
          let yCursor = data.cell.y + 2 + d.textHeightMM + 2;
          const capWidth = Math.max(10, data.cell.width - 2);
          proofs.forEach((it, i) => {
            try {
              if (it.pos === 'before' && it.caption) {
                data.doc.setFontSize(d.CAPTION_FONT);
                const lines = data.doc.splitTextToSize(it.caption, capWidth);
                data.doc.text(lines, data.cell.x + 1, yCursor);
                const dims = data.doc.getTextDimensions(Array.isArray(lines) ? lines.join('\n') : it.caption);
                yCursor += (dims.h || 0) / data.doc.internal.scaleFactor + d.CAPTION_GAP;
                data.doc.setFontSize(10);
              }
              const x = data.cell.x + (data.cell.width - d.IMG_W) / 2;
              data.doc.addImage(it.src, undefined, x, yCursor, d.IMG_W, d.IMG_H, undefined, 'FAST');
              yCursor += d.IMG_H;
              if (it.pos === 'after' && it.caption) {
                yCursor += d.CAPTION_GAP;
                data.doc.setFontSize(d.CAPTION_FONT);
                const lines = data.doc.splitTextToSize(it.caption, capWidth);
                data.doc.text(lines, data.cell.x + 1, yCursor);
                const dims = data.doc.getTextDimensions(Array.isArray(lines) ? lines.join('\n') : it.caption);
                yCursor += (dims.h || 0) / data.doc.internal.scaleFactor;
                data.doc.setFontSize(10);
              }
              if (i < proofs.length - 1) yCursor += d.ITEM_GAP;
            } catch { /* ignore bad images */ }
          });
        },

        didDrawPage: (data) => { drawBackground(doc); drawHeaderBand(doc); if (data.pageNumber === 1) drawFirstPageTitleBlock(doc); },
      });

      y = (doc.lastAutoTable?.finalY ?? y) + 1;
    };

    (sites || []).forEach((s, i) => renderSiteTable(s, i));

    // Section 2 & 3
    y = addSectionBlock(doc, '2. Constatations générales', constatations, y);
    y = addSectionBlock(doc, '3. Recommandations globales', recommandations, y);

    // Section 4 – Signature
    const pageH = doc.internal.pageSize.getHeight();
    const usableH = pageH - mm.bottom; const boxH = 8;
    if (y + boxH + 25 > usableH) { drawBackground(doc); drawHeaderBand(doc); y = CONTENT_START_Y; }
    const pageW2 = doc.internal.pageSize.getWidth();
    const boxX = mm.left; const boxW = pageW2 - mm.left - mm.right;
    doc.setFillColor(255, 247, 225); doc.setDrawColor(0); doc.setLineWidth(0.3); doc.roundedRect(boxX, y, boxW, boxH, 1.2, 1.2, 'FD');
    doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(0); doc.text('4. Signature', mm.left + 4, y + 5.4);
    y += boxH + 8; doc.setFont('times', 'bold'); doc.setFontSize(11); doc.text('Contrôleur :', mm.left + 4, y);
    const ctrlText = controleur ? controleur : '...............................................................';
    doc.setFont('times', 'normal'); doc.text(ctrlText, mm.left + 36, y);

    const safeClient = (client || 'Client').replace(/[^\w\d-]+/g, '_');
    const label = rangeLabelFR(datesControle).replaceAll(' ', '_').replace(/[^\w\d-_/]+/g, '');
    const safeDate = label || 'Date';
    doc.save(`Rapport_${safeClient}_${safeDate}.pdf`);
  };

  // -------------------- Derived title --------------------
  const pageTitle = useMemo(() => {
    const parts = [];
    if (headerCode) parts.push(headerCode);
    if (headerTitle) parts.push(headerTitle);
    return (parts.length ? parts.join(' — ') : 'Générateur de rapport') + (headerVersion ? ` (v${headerVersion})` : '');
  }, [headerCode, headerTitle, headerVersion]);

  // -------------------- UI --------------------
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 font-sans">
      <h1 className="text-2xl font-bold text-center mb-2">{pageTitle}</h1>

      {/* Header inputs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="font-semibold">Code</label>
          <input className="border p-2 w-full rounded" placeholder="ex. FO-SI-05" value={headerCode} onChange={(e) => setHeaderCode(e.target.value)} />
        </div>
        <div>
          <label className="font-semibold">Version</label>
          <input className="border p-2 w-full rounded" placeholder="ex. 01" value={headerVersion} onChange={(e) => setHeaderVersion(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="font-semibold">Titre</label>
          <input className="border p-2 w-full rounded" placeholder="ex. Rapport de contrôle" value={headerTitle} onChange={(e) => setHeaderTitle(e.target.value)} />
        </div>
      </div>

      {/* Logo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="space-y-2">
          <label className="font-semibold">Logo (PNG/JPG)</label>
          <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={onLogoUpload} className="border p-2 w-full rounded" />
          {logoError && <p className="text-red-600 text-sm mt-1">{logoError}</p>}
        </div>
        <button className="px-3 py-2 border rounded h-[42px]" onClick={resetLogo}>↺ Réinitialiser le logo</button>
        <div className="flex items-center gap-3">
          <div className="border rounded w-40 h-16 flex items-center justify-center bg-white">
            <img src={logoPreviewSrc} alt="Logo" className="max-h-14 max-w-36 object-contain" onError={() => { setLogoError('Logo introuvable ou corrompu.'); setLogoPreviewSrc('/gss-logo.png'); }} />
          </div>
        </div>
      </div>

      {/* Client + Dates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="font-semibold">Client</label>
          <input className="border p-2 w-full rounded" value={client} onChange={(e) => setClient(e.target.value)} />
        </div>
        <div>
          <label className="font-semibold">Date(s) du contrôle</label>
          <div className="flex gap-2 items-stretch">
            <input
              type="date"
              className="border p-2 rounded"
              value={dateInput}
              onChange={(e) => {
                const val = e.target.value;
                setDateInput(val);
                if (!val) return;
                setDatesControle((prev) => Array.from(new Set([...prev, val])).sort());
                setTimeout(() => setDateInput(''), 0);
              }}
            />
          </div>
          {datesControle.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {datesControle.map((d) => (
                <span key={d} className="inline-flex items-center gap-2 bg-gray-100 border rounded px-2 py-1" title={fmtFR(d)}>
                  {fmtFR(d)}
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() => setDatesControle((prev) => prev.filter((x) => x !== d))}
                    aria-label={`Supprimer la date ${fmtFR(d)}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 1. Points de contrôle par site */}
      <div className="mb-6 w-full">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">1. Points de contrôle</h2>
          <div className="flex gap-2">
            <button className="border rounded px-3 py-1" onClick={addSite}>+ Ajouter un site</button>
          </div>
        </div>

        {sites.map((site, si) => (
          <div key={si} className="border-2 border-gray-200 rounded-xl mb-6 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex-1 mr-4">
                <label className="font-semibold block mb-1">Sous-titre — Site</label>
                <input
                  className="border p-2 w-full rounded"
                  placeholder="Nom du site (ex. Charguia, Sfax, Usine A, etc.)"
                  value={site.name}
                  onChange={(e) => setSiteName(si, e.target.value)}
                />
              </div>

              <div className="flex items-end gap-2 h-full">
                <button className="border rounded px-3 py-2" onClick={() => addPoint(si)}>
                  + Ajouter un point
                </button>

                {sites.length > 1 && (
                  <button
                    className="text-red-700 underline"
                    onClick={() => removeSite(si)}
                  >
                    Supprimer ce site
                  </button>
                )}
              </div>
            </div>

            {(site.points || []).map((p, pi) => (
              <div key={pi} className="border p-3 rounded-lg mb-3 space-y-3 bg-white/50">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_2fr_1fr] gap-3">
                  <textarea className="border p-2 rounded min-h-[100px]" rows={4} placeholder="Point vérifié" value={p.point} onChange={(e) => setPointField(si, pi, 'point', e.target.value)} />
                  <textarea className="border p-2 rounded min-h-[100px]" rows={4} placeholder="Non-conformité" value={p.nonConformite} onChange={(e) => setPointField(si, pi, 'nonConformite', e.target.value)} />

                  <div className="space-y-2">
                    <textarea className="border p-2 rounded min-h-[100px] w-full" rows={4} placeholder="Preuves / Observations / Photos (texte libre)" value={p.preuvesText} onChange={(e) => setPointField(si, pi, 'preuvesText', e.target.value)} />
                    <input type="file" accept="image/*" multiple onChange={(e) => { addPreuvesImages(si, pi, e.target.files); e.target.value = ''; }} className="border p-1 rounded w-full" />
                    {(p.preuvesImages?.length || 0) > 0 && (
                      <div className="flex flex-col gap-3">
                        {p.preuvesImages.map((it, k) => {
                          const item = typeof it === 'string' ? { src: it, caption: '', pos: 'after' } : it;
                          return (
                            <div key={k} className="flex flex-col md:flex-row md:items-start gap-3 border rounded p-2">
                              {/* preview */}
                              {/* eslint-disable-next-line jsx-a11y/alt-text */}
                              <img src={item.src} className="h-24 w-36 object-cover rounded border" />

                              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                                <div className="md:col-span-2">
                                  <label className="text-sm text-gray-600">Légende / commentaire</label>
                                  <textarea
                                    className="border p-2 rounded w-full min-h-[60px]"
                                    value={item.caption || ''}
                                    onChange={(e) => updatePreuveMeta(si, pi, k, 'caption', e.target.value)}
                                    placeholder="Texte à afficher avant/après l'image dans le PDF"
                                  />
                                </div>
                                <div>
                                  <label className="text-sm text-gray-600">Position du texte</label>
                                  <select
                                    className="border p-2 rounded w-full"
                                    value={item.pos === 'before' ? 'before' : 'after'}
                                    onChange={(e) => updatePreuveMeta(si, pi, k, 'pos', e.target.value)}
                                  >
                                    <option value="before">Avant l'image</option>
                                    <option value="after">Après l'image</option>
                                  </select>
                                </div>
                              </div>

                              <div className="text-right">
                                <button type="button" onClick={() => removePreuveImage(si, pi, k)} className="text-red-600 hover:underline">
                                  Supprimer
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <textarea className="border p-2 rounded min-h-[100px]" rows={4} placeholder="Action immédiate" value={p.action} onChange={(e) => setPointField(si, pi, 'action', e.target.value)} />
                </div>

                <div className="text-right">
                  <button className="text-red-700 hover:underline" onClick={() => removePoint(si, pi)}>
                    🗑️ Supprimer cette ligne
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 2. Constatations */}
      <div className="mb-6 w-full">
        <h2 className="text-xl font-semibold mb-2">2. Constatations générales</h2>
        <div className="border rounded overflow-hidden shadow-sm">
          <div className="quill-compact-wrap">
            <ReactQuill className="quill-compact" theme="snow" modules={quillModules} formats={quillFormats} value={constatations} onChange={setConstatations} />
          </div>
        </div>
      </div>

      {/* 3. Recommandations */}
      <div className="mb-6 w-full">
        <h2 className="text-xl font-semibold mb-2">3. Recommandations globales</h2>
        <div className="border rounded overflow-hidden shadow-sm">
          <div className="quill-compact-wrap">
            <ReactQuill className="quill-compact" theme="snow" modules={quillModules} formats={quillFormats} value={recommandations} onChange={setRecommandations} />
          </div>
        </div>
      </div>

      {/* 4. Signature */}
      <div>
        <h2 className="text-xl font-semibold mb-2">4. Signature</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="font-semibold">Contrôleur</label>
            <input className="border p-2 w-full rounded" placeholder="Nom et prénom du contrôleur" value={controleur} onChange={(e) => setControleur(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Import / Export / PDF */}
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
