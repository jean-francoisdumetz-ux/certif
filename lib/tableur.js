// CERTIF — écrire un classeur .xlsx, sans bibliothèque de tableur
//
// POURQUOI L'ÉCRIRE SOI-MÊME. Un .xlsx est une archive de fichiers XML, et nous
// n'avons besoin que d'une feuille de texte et de nombres. Les bibliothèques du
// genre pèsent plusieurs mégaoctets, savent évaluer des formules, exécutent du
// code à la lecture, et traînent leur lot d'avis de sécurité. Ici : cent lignes,
// aucune formule, rien qui s'exécute. Nous LISONS déjà les .xlsx de cette
// façon-là (lib/import-parcelles.js) ; les écrire pareillement tient l'ensemble
// dans une seule idée.
//
// LES NOMBRES SONT DES NOMBRES. Une contenance écrite en texte ne s'additionne
// pas, et le premier réflexe devant un tableau de parcelles est de sélectionner
// la colonne pour en lire la somme au bas de l'écran. Les cellules numériques
// sortent donc en type numérique, les autres en chaîne littérale.
//
// PAS DE TABLE DES CHAÎNES PARTAGÉES. Le format en prévoit une pour éviter de
// répéter les mêmes mots ; sur deux cents lignes le gain se compte en kilooctets
// et le coût en complexité. Les chaînes sont écrites en clair dans la feuille.

import { zipSync, strToU8 } from 'fflate';

const echapper = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Les caractères de contrôle sont interdits dans un document XML : un tabulé
  // ou un saut de ligne venu d'un copier-coller ferait un fichier illisible par
  // Excel, avec un message qui ne dit pas pourquoi.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');

/** La référence d'une cellule : 0,0 → A1. */
export function reference(colonne, ligne) {
  let n = colonne + 1;
  let lettres = '';
  while (n > 0) {
    const reste = (n - 1) % 26;
    lettres = String.fromCharCode(65 + reste) + lettres;
    n = Math.floor((n - 1) / 26);
  }
  return `${lettres}${ligne + 1}`;
}

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

function cellule(valeur, colonne, ligne, entete) {
  if (valeur === null || valeur === undefined || valeur === '') return '';
  const r = reference(colonne, ligne);
  if (estNombre(valeur)) return `<c r="${r}"><v>${valeur}</v></c>`;
  // s="1" : le style gras, défini plus bas, réservé à la ligne d'en-tête.
  return `<c r="${r}" t="inlineStr"${entete ? ' s="1"' : ''}>`
    + `<is><t xml:space="preserve">${echapper(valeur)}</t></is></c>`;
}

/**
 * Un classeur d'une feuille.
 *
 * @param {object} o
 *   nom       le nom de l'onglet
 *   colonnes  [{titre, largeur}] — la largeur est en caractères, comme Excel
 *   lignes    Array<Array<string|number|null>>
 * @returns {Uint8Array} le .xlsx
 */
export function construireTableur({ nom = 'Feuille1', colonnes = [], lignes = [] }) {
  const titres = colonnes.map((c) => c.titre);
  const toutes = [titres, ...lignes];

  const corps = toutes.map((valeurs, i) => {
    const cellules = valeurs
      .map((v, j) => cellule(v, j, i, i === 0))
      .filter(Boolean)
      .join('');
    return `<row r="${i + 1}">${cellules}</row>`;
  }).join('');

  const largeurs = colonnes.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${c.largeur || 14}" customWidth="1"/>`).join('');

  const feuille = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${largeurs}</cols>
<sheetData>${corps}</sheetData>
</worksheet>`;

  // Deux styles seulement : l'ordinaire et le gras de l'en-tête. Le format
  // impose de déclarer les polices, les remplissages et les bordures même quand
  // on ne s'en sert pas — d'où ce squelette, qui n'a rien de superflu.
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const fichiers = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${echapper(nom).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(feuille),
    'xl/styles.xml': strToU8(styles),
  };

  // Date fixée au 1er janvier 2000 : deux classeurs au même contenu donnent le
  // même fichier, ce qui rend les essais comparables d'un jour à l'autre. Le
  // format ZIP n'accepte que 1980-2099 — zéro serait refusé.
  return zipSync(fichiers, { level: 6, mtime: 946684800000 });
}
