import { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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

function App() {
  // -------------------- En-tête --------------------
  const [headerCode, setHeaderCode] = useState('FO-SI-08');
  const [headerVersion, setHeaderVersion] = useState('2');
  const [headerTitle, setHeaderTitle] = useState('Rapport de contrôle inopiné');

  // -------------------- Form -----------------------
  const [client, setClient] = useState('');

  // Multi-sites: chaque site a un nom + liste de points
  const [sites, setSites] = useState([
    {
      name: '',
      points: [
        { point: '', nonConformite: '', preuvesText: '', preuvesImages: [], action: '' },
      ],
    },
  ]);

  const [constatations, setConstatations] = useState('');
  const [recommandations, setRecommandations] = useState('');
  const [controleur, setControleur] = useState('');

  // -------------------- Options PDF/UI ------------
  // Forcer un saut de page avant chaque site ; seuil d'espace minimal ; masquer erreurs logo/bg
  const [forcePageBreakBetweenSites] = useState(false);
  const [minBlockMM] = useState(28); // mm requis avant un site (sous-titre + entête + 1ère ligne)
  const [hideAssetErrors] = useState(false);

  // -------------------- Dates multiples ------------
  const [datesControle, setDatesControle] = useState([]); // ex: ['2025-10-07','2025-10-08']
  const [dateInput, setDateInput] = useState('');


  // -------------------- Logo -----------------------
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
    const maxSize = 3 * 1024 * 1024; // 3 Mo
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

  // -------------------- Filigrane (BG) -------------
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
      .then((data) => { setBgDataUrl(data); })
      .catch(() => { setBgDataUrl(null); });
  }, []);

  const drawBackground = (doc) => {
    if (!bgDataUrl) return;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const imgW = 170;
    const imgH = 105;
    const x = (pageW - imgW) / 2;
    const y = (pageH - imgH) / 2;

    try {
      if (doc.GState && typeof doc.setGState === 'function') {
        const low = new doc.GState({ opacity: 0.06 });
        doc.setGState(low);
        doc.addImage(bgDataUrl, 'PNG', x, y, imgW, imgH, undefined, 'FAST');
        const full = new doc.GState({ opacity: 1 });
        doc.setGState(full);
      } else {
        doc.addImage(bgDataUrl, 'PNG', x, y, imgW, imgH, undefined, 'FAST');
      }
    } catch {
      doc.addImage(bgDataUrl, 'PNG', x, y, imgW, imgH, undefined, 'FAST');
    }
  };

  // -------------------- Helpers Sites/Points -------
  const addSite = () =>
    setSites((s) => [
      ...s,
      {
        name: '',
        points: [
          { point: '', nonConformite: '', preuvesText: '', preuvesImages: [], action: '' },
        ],
      },
    ]);

  const removeSite = (siteIdx) => setSites((s) => s.filter((_, i) => i !== siteIdx));

  const addPoint = (siteIdx) =>
    setSites((s) => {
      const n = [...s];
      n[siteIdx] = {
        ...n[siteIdx],
        points: [
          ...n[siteIdx].points,
          { point: '', nonConformite: '', preuvesText: '', preuvesImages: [], action: '' },
        ],
      };
      return n;
    });

  const removePoint = (siteIdx, pointIdx) =>
    setSites((s) => {
      const n = [...s];
      n[siteIdx] = {
        ...n[siteIdx],
        points: n[siteIdx].points.filter((_, i) => i !== pointIdx),
      };
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

  const addPreuvesImages = (siteIdx, pointIdx, files) => {
    if (!files?.length) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5 Mo pour les preuves
    const validFiles = [];
    const rejected = [];

    [...files].forEach((f) => {
      if (!allowed.includes(f.type)) {
        rejected.push(`${f.name}: format non supporté`);
      } else if (f.size > maxSize) {
        rejected.push(`${f.name}: > 5 Mo`);
      } else {
        validFiles.push(f);
      }
    });

    if (rejected.length) {
      alert('Certaines images ont été ignorées:\n' + rejected.join('\n'));
    }
    if (!validFiles.length) return;

    const toRead = validFiles.map(
      (f) =>
        new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = () => rej(new Error('Lecture échouée: ' + f.name));
          r.readAsDataURL(f);
        })
    );

    Promise.allSettled(toRead).then((results) => {
      const urls = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);
      const failed = results
        .filter((r) => r.status === 'rejected')
        .map((r) => (r.reason?.message || 'Lecture échouée'));
      if (failed.length) alert('Certaines lectures ont échoué:\n' + failed.join('\n'));
      if (!urls.length) return;

      setSites((s) => {
        const n = [...s];
        const pts = [...n[siteIdx].points];
        const p = { ...pts[pointIdx] };
        const existing = Array.isArray(p.preuvesImages) ? p.preuvesImages : [];
        p.preuvesImages = Array.from(new Set([...existing, ...urls]));
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
      p.preuvesImages = (p.preuvesImages || []).filter((_, i) => i !== k);
      pts[pointIdx] = p;
      n[siteIdx].points = pts;
      return n;
    });

  // -------------------- Import / Export JSON -------
  const exportJson = () => {
    const data = {
      headerCode,
      headerVersion,
      headerTitle,
      client,
      datesControle,
      sites,
      constatations,
      recommandations,
      controleur,
      logoDataUrl,
    };
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
        if (Array.isArray(d.sites)) {
          setSites(d.sites);
        } else if (Array.isArray(d.points)) {
          setSites([{ name: '', points: d.points }]);
        } else {
          setSites([
            { name: '', points: [{ point: '', nonConformite: '', preuvesText: '', preuvesImages: [], action: '' }] }
          ]);
        }
        setConstatations(d.constatations ?? '');
        setRecommandations(d.recommandations ?? '');
        setControleur(d.controleur ?? '');
        if (d.logoDataUrl) {
          setLogoDataUrl(d.logoDataUrl);
          setLogoPreviewSrc(d.logoDataUrl);
        }
      } catch {
        // eslint-disable-next-line no-alert
        alert('Fichier JSON invalide.');
      }
    };
    r.readAsText(f);
  };

  // -------------------- PDF helpers ----------------
  const mm = { left: 15, right: 15, top: 18, bottom: 18 };
  const CONTENT_START_Y = 50;

  // Bandeau GSS sur toutes les pages
  const drawHeaderBand = (doc) => {
    const pageW = doc.internal.pageSize.getWidth();
    doc.setDrawColor(212, 160, 23);
    doc.setLineWidth(1.2);
    doc.line(mm.left, 10, pageW - mm.right, 10);
    doc.line(mm.left, 24, pageW - mm.right, 24);
    if (logoDataUrl) doc.addImage(logoDataUrl, undefined, mm.left, 11, 22, 10, undefined, 'FAST');
    const rx = pageW - mm.right;
    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Code : ${headerCode || '—'}`, rx, 14, { align: 'right' });
    doc.text(`Version : ${headerVersion || '—'}`, rx, 19, { align: 'right' });
  };

  // Bloc Titre + Client/Date → page 1 uniquement
  const drawFirstPageTitleBlock = (doc) => {
    const pageW = doc.internal.pageSize.getWidth();
    const boxX = mm.left;
    const boxW = pageW - mm.left - mm.right;

    // Cadre du titre
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(boxX, 26.5, boxW, 8);

    // Titre centré
    doc.setFont('times', 'bold');
    doc.setFontSize(13);
    doc.text(headerTitle || 'Rapport de contrôle inopiné', pageW / 2, 31.5, { align: 'center' });

    // Libellés Client / Date (ligne en dessous)
    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    doc.text('Client :', mm.left, 42);
    doc.text('Date :', pageW / 2 + 10, 42);

    // Valeurs Client / Date
    const clientLabel = (client || '—').toString();
    const dateLabelRaw = rangeLabelFR(datesControle);
    const dateLabel = (dateLabelRaw && typeof dateLabelRaw === 'string' ? dateLabelRaw : '—');

    // Largeurs max pour forcer un retour à la ligne si nécessaire
    const clientMaxW = (pageW / 2) - (mm.left + 20);
    const dateMaxW = (pageW - mm.right) - (pageW / 2 + 22);

    doc.setFont('times', 'normal');
    const clientLines = doc.splitTextToSize(clientLabel, Math.max(20, clientMaxW));
    const dateLines = doc.splitTextToSize(dateLabel, Math.max(20, dateMaxW));

    doc.text(clientLines, mm.left + 18, 42);
    doc.text(dateLines, pageW / 2 + 22, 42);
  };

  // Bandeau crème des sections
  const drawSectionTitle = (doc, title, yStart) => {
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

    doc.setFillColor(255, 247, 225);
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.roundedRect(boxX, y, boxW, boxH, 1.2, 1.2, 'FD');

    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(title, mm.left + 4, y + 5.4);

    return y + boxH + 3;
  };

  // Sous-titre pour chaque site
  const drawSiteSubtitle = (doc, siteName, yStart) => {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const usableH = pageH - mm.bottom;
    let y = yStart;
    const boxH = 7;

    if (y + boxH + 3 > usableH) {
      doc.addPage();
      drawBackground(doc);
      drawHeaderBand(doc);
      y = CONTENT_START_Y;
    }

    const boxX = mm.left;
    const boxW = pageW - mm.left - mm.right;

    doc.setFillColor(245, 245, 245);
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.roundedRect(boxX, y, boxW, boxH, 1, 1, 'FD');

    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    const label = siteName?.trim() ? `Site : ${siteName.trim()}` : 'Site : —';
    doc.text(label, mm.left + 4, y + 4.8);
    return y + boxH + 2;
  };

  // -------------------- Génération PDF --------------
  const generatePDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.setLineHeightFactor(1.25);

    const preflightSpace = (y) => {
      // utilise la valeur configurable minBlockMM depuis l'UI
      const minBlock = Number(minBlockMM) > 0 ? Number(minBlockMM) : 28;
      const pageH = doc.internal.pageSize.getHeight();
      const usableH = pageH - mm.bottom;
      if (y + minBlock > usableH) {
        doc.addPage();
        drawBackground(doc);
        drawHeaderBand(doc);
        return CONTENT_START_Y;
      }
      return y;
    };

    // Page 1
    drawBackground(doc);
    drawHeaderBand(doc);
    drawFirstPageTitleBlock(doc);
    // largeur utile du tableau = page - marges
    const pageW = doc.internal.pageSize.getWidth();
    const tableW = pageW - mm.left - mm.right;

    // Répartition proche de ton rendu (20% / 20% / 44% / 16%)
    const w0 = Math.round(tableW * 0.20); // Point vérifié
    const w1 = Math.round(tableW * 0.20); // Non-conformité
    const w2 = Math.round(tableW * 0.44); // Preuves / Observations / Photos
    const w3 = tableW - (w0 + w1 + w2);   // Action immédiate (résiduel pour total exact)

    // Petit autoTable "déclencheur" pour didDrawPage partout
    autoTable(doc, {
      head: [],
      body: [],
      margin: { top: CONTENT_START_Y, left: mm.left, right: mm.right, bottom: 8 },
      didDrawPage: (data) => {
          drawBackground(doc);
          drawHeaderBand(doc);
          // Le bloc titre ne doit apparaître que sur la toute première page
          if (data.pageNumber === 1 && doc.internal.getCurrentPageInfo().pageNumber === 1) {
            drawFirstPageTitleBlock(doc);
          }
        },

    });

    // Section 1
    let y = CONTENT_START_Y - 4;
    y = drawSectionTitle(doc, '1. Points de contrôle', y);

    const renderSiteTable = (site, idx) => {
      // Saut configurable + optionnel avant chaque site
      if (forcePageBreakBetweenSites && idx > 0) {
        doc.addPage();
        drawBackground(doc);
        drawHeaderBand(doc);
        y = CONTENT_START_Y;
      }
      // Pré-vol: éviter que le sous-titre se retrouve seul en bas de page
      y = preflightSpace(y);

      // Sous-titre site
      y = drawSiteSubtitle(doc, site.name, y);

      const bodyRows = site.points.map((p) => [
        p.point || '',
        p.nonConformite || '',
        (p.preuvesText || '').trim(),
        p.action || '',
      ]);

      autoTable(doc, {
        startY: y + 2,
        margin: { top: CONTENT_START_Y, left: mm.left, right: mm.right, bottom: mm.bottom },
        head: [
          [
            'Point vérifié',
            'Non-conformité',
            'Preuves / Observations / Photos',
            'Action immédiate',
          ],
        ],
        body: bodyRows,
        styles: {
          font: 'times',
          fontSize: 10,
          cellPadding: 2,
          lineWidth: 0.1,
          lineColor: [180, 180, 180],
          halign: 'center',
          valign: 'top',
          overflow: 'linebreak',
        },
        headStyles: {
          fontStyle: 'bold',
          fontSize: 11,
          fillColor: [235, 235, 235],
          textColor: 20,
          halign: 'center',
          valign: 'middle',
        },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: { 0: { cellWidth: w0 }, 1: { cellWidth: w1 }, 2: { minCellWidth: w2 }, 3: { cellWidth: w3 } },
        theme: 'grid',

        didParseCell: (data) => {
          const { section, row, column, cell } = data;
          if (section === 'body' && column.index === 2) {
            // Dimensions d'image compactes
            const IMG_W = 32;
            const IMG_H = 18;
            const LINE_GAP = 3;

            const idx = row.index;
            const text = (site.points[idx]?.preuvesText || '').trim();
            const textLines = doc.splitTextToSize(text, cell.width - 2);
            const textForMeasure = Array.isArray(textLines) ? textLines.join('\n') : (text || ' ');
            // Mesure réelle de la hauteur du texte (pts -> mm)
            const dims = doc.getTextDimensions(textForMeasure);
            const textHeightMM = (dims.h || 0) / doc.internal.scaleFactor;
            const nImgs = site.points[idx]?.preuvesImages?.length || 0;
            const imgsHeight = nImgs ? (nImgs * IMG_H + (nImgs - 1) * LINE_GAP) : 0;
            const padding = 4; // marge douce
            const needed = textHeightMM + (nImgs ? 2 : 0) + imgsHeight + padding;
            cell.styles.minCellHeight = Math.max(cell.styles.minCellHeight || 0, needed);
            // Stocker pour didDrawCell
            cell._gssImgDims = { IMG_W, IMG_H, LINE_GAP, textHeightMM };
            if (data.section === 'head' && data.column.index === 2) {
              data.cell.styles.fontSize = 10;   // un chouïa plus petit pour tenir sur 1 ligne
              data.cell.styles.cellPadding = 2; // pad serré
            }
          }
        },

        didDrawCell: (data) => {
          if (data.section !== 'body' || data.column.index !== 2) return;
          const idx = data.row.index;
          const imgs = site.points[idx]?.preuvesImages || [];
          if (!imgs.length) return;
          const d = data.cell._gssImgDims || { IMG_W: 32, IMG_H: 18, LINE_GAP: 3, textHeightMM: 8 };
          // Place les images juste sous le bloc de texte réellement mesuré
          let yCursor = data.cell.y + 2 + d.textHeightMM + 2;
          imgs.forEach((src) => {
            const x = data.cell.x + (data.cell.width - d.IMG_W) / 2;
            doc.addImage(src, undefined, x, yCursor, d.IMG_W, d.IMG_H, undefined, 'FAST');
            yCursor += d.IMG_H + d.LINE_GAP;
          });
        },

        didDrawPage: (data) => {
          drawBackground(doc);
          drawHeaderBand(doc);
          // Le bloc titre ne doit apparaître que sur la toute première page
          if (data.pageNumber === 1 && doc.internal.getCurrentPageInfo().pageNumber === 1) {
            drawFirstPageTitleBlock(doc);
          }
        },

      });

      y = doc.lastAutoTable.finalY + 1; // espace minimal entre tableaux
    };

    sites.forEach((s, i) => renderSiteTable(s, i));

    // Section 2 & 3
    y = addSectionBlock(doc, '2. Constatations générales', constatations, y);
    y = addSectionBlock(doc, '3. Recommandations globales', recommandations, y);

    // Section 4 Signature (dernière)
    y = addSignatureSection(doc, y);

    const safeClient = (client || 'Client').replace(/[^\w\d-]+/g, '_');
    const label = rangeLabelFR(datesControle).replaceAll(' ', '_').replace(/[^\w\d-_/]+/g, '');
    const safeDate = label || 'Date';
    doc.save(`Rapport_${safeClient}_${safeDate}.pdf`);
  };

  // Bloc texte de section (constatations / recommandations)
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

    doc.setFillColor(255, 247, 225);
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.roundedRect(boxX, y, boxW, boxH, 1.2, 1.2, 'FD');

    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(title, mm.left + 4, y + 5.4);

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
        halign: 'center',
        valign: 'top',
      },
      columnStyles: { 0: { cellWidth: pageW - mm.left - mm.right } },
      theme: 'plain',
      didDrawPage: (data) => {
        drawBackground(doc);
        drawHeaderBand(doc);
        // Le bloc titre ne doit apparaître que sur la toute première page
        if (data.pageNumber === 1 && doc.internal.getCurrentPageInfo().pageNumber === 1) {
          drawFirstPageTitleBlock(doc);
        }
      },

    });

    return doc.lastAutoTable.finalY + 6;
  };

  // Section 4 Signature (toujours affichée)
  const addSignatureSection = (doc, yStart) => {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const usableH = pageH - mm.bottom;
    let y = yStart;

    const boxH = 8;
    if (y + boxH + 25 > usableH) {
      doc.addPage();
      drawBackground(doc);
      drawHeaderBand(doc);
      y = CONTENT_START_Y;
    }

    const boxX = mm.left;
    const boxW = pageW - mm.left - mm.right;

    doc.setFillColor(255, 247, 225);
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.roundedRect(boxX, y, boxW, boxH, 1.2, 1.2, 'FD');

    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('4. Signature', mm.left + 4, y + 5.4);

    y += boxH + 8;
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.text('Contrôleur :', mm.left + 4, y);

    const ctrlText = controleur ? controleur : '...............................................................';
    doc.setFont('times', 'normal');
    doc.text(ctrlText, mm.left + 36, y);

    return y + 10;
  };

  // -------------------- Titre UI -------------------
  const pageTitle = useMemo(() => {
    const parts = [];
    if (headerCode) parts.push(headerCode);
    if (headerTitle) parts.push(headerTitle);
    return (parts.length ? parts.join(' — ') : 'Générateur de rapport') + (headerVersion ? ` (v${headerVersion})` : '');
  }, [headerCode, headerTitle, headerVersion]);

  // -------------------- UI -------------------------
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 font-sans">
      <h1 className="text-2xl font-bold text-center mb-2">{pageTitle}</h1>

      {/* En-tête code/version/titre */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="font-semibold">Code</label>
          <input
            className="border p-2 w-full rounded"
            placeholder="ex. FO-SI-05"
            value={headerCode}
            onChange={(e) => setHeaderCode(e.target.value)}
          />
        </div>
        <div>
          <label className="font-semibold">Version</label>
          <input
            className="border p-2 w-full rounded"
            placeholder="ex. 01"
            value={headerVersion}
            onChange={(e) => setHeaderVersion(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="font-semibold">Titre</label>
          <input
            className="border p-2 w-full rounded"
            placeholder="ex. Rapport de contrôle"
            value={headerTitle}
            onChange={(e) => setHeaderTitle(e.target.value)}
          />
        </div>
      </div>

      {/* Logo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="space-y-2">
          <label className="font-semibold">Logo (PNG/JPG)</label>
          <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={onLogoUpload} className="border p-2 w-full rounded" />
          {!hideAssetErrors && logoError && <p className="text-red-600 text-sm mt-1">{logoError}</p>}
        </div>
        <button className="px-3 py-2 border rounded h-[42px]" onClick={resetLogo}>
          ↺ Réinitialiser le logo
        </button>
        <div className="flex items-center gap-3">
          <div className="border rounded w-40 h-16 flex items-center justify-center bg-white">
            <img src={logoPreviewSrc} alt="Logo" className="max-h-14 max-w-36 object-contain" onError={() => { setLogoError('Logo introuvable ou corrompu.'); setLogoPreviewSrc('/gss-logo.png'); }} />
          </div>
        </div>
      </div>

      {/* Client + Dates (pleine largeur) */}
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
                setDatesControle((prev) => {
                  const set = new Set(prev);
                  set.add(val);
                  return Array.from(set).sort();
                });
                setTimeout(() => setDateInput(''), 0);
              }}
            />
          </div>

          {datesControle.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {datesControle.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-2 bg-gray-100 border rounded px-2 py-1"
                  title={fmtFR(d)}
                >
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

      {/* 1. Points de contrôle (par site) */}
      <div className="mb-6 w-full">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">1. Points de contrôle</h2>
          <div className="flex gap-2">
            <button className="border rounded px-3 py-1" onClick={addSite}>+ Ajouter un site</button>
          </div>
        </div>

        {sites.map((site, si) => (
          <div key={si} className="border-2 border-gray-200 rounded-xl mb-6 p-4">
            {/* Sous-titre (site) */}
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
                <button className="border rounded px-3 py-2" onClick={() => addPoint(si)}>+ Ajouter un point</button>
                {sites.length > 1 && (
                  <button className="text-red-700 underline" onClick={() => removeSite(si)}>
                    Supprimer ce site
                  </button>
                )}
              </div>
            </div>

            {site.points.map((p, pi) => (
              <div key={pi} className="border p-3 rounded-lg mb-3 space-y-3 bg-white/50">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_2fr_1fr] gap-3">
                  <textarea
                    className="border p-2 rounded min-h-[100px]"
                    rows={4}
                    placeholder="Point vérifié"
                    value={p.point}
                    onChange={(e) => setPointField(si, pi, 'point', e.target.value)}
                  />

                  <textarea
                    className="border p-2 rounded min-h-[100px]"
                    rows={4}
                    placeholder="Non-conformité"
                    value={p.nonConformite}
                    onChange={(e) => setPointField(si, pi, 'nonConformite', e.target.value)}
                  />

                  {/* Colonne élargie pour Preuves */}
                  <div className="space-y-2">
                    <textarea
                      className="border p-2 rounded min-h-[100px] w-full"
                      rows={4}
                      placeholder="Preuves / Observations / Photos (texte libre)"
                      value={p.preuvesText}
                      onChange={(e) => setPointField(si, pi, 'preuvesText', e.target.value)}
                    />
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => { addPreuvesImages(si, pi, e.target.files); e.target.value = ''; }}
                      className="border p-1 rounded w-full"
                    />
                    {p.preuvesImages?.length > 0 && (
                      <div className="flex flex-col gap-2">
                        {p.preuvesImages.map((src, k) => (
                          <div key={k} className="flex items-center gap-3">
                            {/* eslint-disable-next-line jsx-a11y/alt-text */}
                            <img src={src} className="h-20 w-32 object-cover rounded border" />
                            <button
                              type="button"
                              onClick={() => removePreuveImage(si, pi, k)}
                              className="text-red-600 hover:underline"
                            >
                              Supprimer cette image
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <textarea
                    className="border p-2 rounded min-h-[100px]"
                    rows={4}
                    placeholder="Action immédiate"
                    value={p.action}
                    onChange={(e) => setPointField(si, pi, 'action', e.target.value)}
                  />
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

      {/* 2. Constatations générales */}
      <div className="mb-6 w-full">
        <h2 className="text-xl font-semibold mb-2">2. Constatations générales</h2>
        <textarea
          className="border p-2 w-full rounded"
          rows={10}
          value={constatations}
          onChange={(e) => setConstatations(e.target.value)}
        />
      </div>

      {/* 3. Recommandations */}
      <div>
        <h2 className="text-xl font-semibold mb-2">3. Recommandations globales</h2>
        <textarea
          className="border p-2 w-full rounded"
          rows={5}
          value={recommandations}
          onChange={(e) => setRecommandations(e.target.value)}
        />
      </div>

      {/* 4. Signature / Contrôleur */}
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

      {/* Import / Export / PDF */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="font-semibold">Importer un rapport (.json)</label>
          <input type="file" accept="application/json" onChange={importJson} className="border p-2 w-full rounded" />
        </div>
        <button onClick={exportJson} className="border rounded p-2">
          💾 Exporter JSON
        </button>
        <button onClick={generatePDF} className="bg-blue-600 text-white rounded p-2">
          🖨️ Générer le PDF
        </button>
      </div>
    </div>
  );
}


export default App;
