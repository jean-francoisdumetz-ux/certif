// CERTIF — lire une liste de parcelles dans un fichier déposé
//
// CE QUE CELA REMPLACE : recopier à la main quarante lignes d'un relevé de
// propriété, section par section, numéro par numéro. Une recopie de quarante
// lignes contient une faute ; une faute sur un numéro de parcelle donne un
// certificat d'urbanisme sur le terrain du voisin.
//
// TROIS FORMATS, DEUX MÉCANIQUES.
//
//   • Tableur (.xlsx) et .csv — des colonnes. On cherche une ligne d'en-tête,
//     et à défaut on reconnaît les cellules à leur forme.
//   • PDF (relevé de propriété, « M1 ») — pas de colonnes, des mots posés à des
//     coordonnées. On reconstitue les lignes en regroupant les mots par
//     ordonnée, puis on lit chaque ligne comme une suite de jetons.
//
// RIEN N'EST GÉNÉRÉ D'OFFICE. Ce module RESTITUE, il ne décide pas : ce qu'il a
// lu s'affiche à l'écran, ligne à ligne, avec ce qu'il n'a pas su lire, et le
// notaire coche avant de reporter. Un relevé de propriété porte toutes les
// parcelles d'un propriétaire dans la commune — souvent bien plus que celles
// qui font l'objet de la vente.
//
// LA CONTENANCE N'EST PRISE QUE SI ELLE EST CERTAINE, c'est-à-dire écrite en
// hectares-ares-centiares (« 00 08 42 »), la forme du relevé. Un nombre isolé
// sur une ligne de M1 peut aussi bien être un code Rivoli, un revenu cadastral
// ou une année : dans le doute on ne prend rien et on le dit. Une contenance
// fausse au dossier vaut moins qu'une contenance absente.

const ENTETES = {
  prefixe: /^(pr[eé]fixe|com\.?\s*abs|commune\s+absorb|ancienne\s+commune)/i,
  section: /^(section|sect\.?|sec\.?)$/i,
  numero: /^(n[°o]?\s*(de\s*)?(plan|parcelle)?|num[eé]ro|parcelle)$/i,
  contenance: /^(contenance|surface|superficie|cont\.?)/i,
  lieudit: /^(lieu-?\s?dit|adresse|voie|situation)/i,
};

const EST_SECTION = /^(?=.*[A-Z])[0-9A-Z]{1,2}$/;
const EST_NUMERO = /^\d{1,4}$/;
const EST_PREFIXE = /^\d{3}$/;

const propre = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Une contenance, en mètres carrés, ou null.
 *
 * « 00 08 42 » se lit 8 ares 42 centiares, soit 842 m² — c'est la forme du
 * relevé de propriété et du cadastre. « 842 » se lit tel quel. Tout le reste
 * est refusé plutôt que deviné.
 */
export function enMetresCarres(brut) {
  const t = propre(brut).replace(/\u00A0/g, ' ');
  if (!t) return null;

  const haAca = t.match(/^(\d{1,3})\s*(?:ha)?\s+(\d{1,2})\s*(?:a)?\s+(\d{1,2})\s*(?:ca)?$/i);
  if (haAca) {
    return Number(haAca[1]) * 10000 + Number(haAca[2]) * 100 + Number(haAca[3]);
  }
  // « 1 234 m² », « 1234 » : un entier, espaces de milliers admis.
  const entier = t.match(/^(\d[\d\s]*)\s*(?:m²|m2)?$/i);
  if (entier) {
    const n = Number(entier[1].replace(/\s/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Une parcelle lue quelque part, sous la forme que l'écran attend. */
const parcelle = (prefixe, section, numero, contenance, lieudit) => ({
  prefixe: prefixe ? String(prefixe).padStart(3, '0') : '',
  section: String(section).toUpperCase(),
  numero: String(Number(numero)),
  contenance: contenance === null || contenance === undefined ? '' : String(contenance),
  lieudit: lieudit ? propre(lieudit) : '',
});

/**
 * Lit une suite de jetons — les cellules d'une ligne de tableur, ou les mots
 * d'une ligne de PDF — et en tire une parcelle, si elle y est.
 *
 * LA CLEF EST LA PAIRE section + numéro CÔTE À CÔTE. C'est la seule chose
 * stable d'un relevé à l'autre : les colonnes changent de place, leur nombre
 * change, les en-têtes sont parfois absents, mais « AB » suivi de « 12 » reste
 * « AB 12 ».
 */
export function lireJetons(jetons) {
  const t = jetons.map(propre).filter((x) => x !== '');
  for (let i = 0; i < t.length - 1; i += 1) {
    if (!EST_SECTION.test(t[i].toUpperCase())) continue;
    if (!EST_NUMERO.test(t[i + 1])) continue;
    // Un numéro à zéro n'existe pas : c'est une colonne de comptage.
    if (Number(t[i + 1]) === 0) continue;

    const prefixe = i > 0 && EST_PREFIXE.test(t[i - 1]) ? t[i - 1] : '';
    const reste = t.slice(i + 2);

    // La contenance : le triplet hectares-ares-centiares, où qu'il soit sur la
    // ligne. Trois jetons, ou un seul déjà groupé.
    let contenance = null;
    for (let j = 0; j < reste.length; j += 1) {
      const trois = enMetresCarres(`${reste[j]} ${reste[j + 1] || ''} ${reste[j + 2] || ''}`);
      if (trois !== null && /^\d{1,2}$/.test(reste[j + 1] || '') && /^\d{1,2}$/.test(reste[j + 2] || '')) {
        contenance = trois; break;
      }
      const groupe = reste[j].match(/^\d{1,3}\s+\d{1,2}\s+\d{1,2}$/) ? enMetresCarres(reste[j]) : null;
      if (groupe !== null) { contenance = groupe; break; }
    }

    // Le lieudit : le premier jeton franchement alphabétique après le numéro.
    const mots = reste.filter((x) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ -]{2,}$/.test(x));
    return parcelle(prefixe, t[i], t[i + 1], contenance, mots[0] || '');
  }
  return null;
}

/* ------------------------------------------------------------- en colonnes */

/** L'en-tête d'un tableau, s'il y en a un : quelle colonne porte quoi. */
function trouverEntete(lignes) {
  for (let i = 0; i < Math.min(lignes.length, 12); i += 1) {
    const cellules = lignes[i].map(propre);
    const colonnes = {};
    cellules.forEach((c, j) => {
      for (const [clef, motif] of Object.entries(ENTETES)) {
        if (colonnes[clef] === undefined && motif.test(c)) colonnes[clef] = j;
      }
    });
    // Section ET numéro : deux colonnes reconnues, sinon ce n'est pas l'en-tête.
    if (colonnes.section !== undefined && colonnes.numero !== undefined) {
      return { index: i, colonnes };
    }
  }
  return null;
}

/**
 * @param {Array<Array<string>>} lignes
 * @returns {{parcelles:Array, methode:string, ignorees:number}}
 */
export function depuisTable(lignes) {
  const entete = trouverEntete(lignes);
  const parcelles = [];
  let ignorees = 0;

  if (entete) {
    const { colonnes } = entete;
    for (const ligne of lignes.slice(entete.index + 1)) {
      const cel = (clef) => (colonnes[clef] === undefined ? '' : propre(ligne[colonnes[clef]]));
      const section = cel('section').toUpperCase();
      const numero = cel('numero').replace(/\D/g, '');
      if (!EST_SECTION.test(section) || !EST_NUMERO.test(numero) || Number(numero) === 0) {
        if (ligne.some((c) => propre(c))) ignorees += 1;
        continue;
      }
      parcelles.push(parcelle(
        cel('prefixe').replace(/\D/g, ''), section, numero,
        enMetresCarres(cel('contenance')), cel('lieudit')));
    }
    return { parcelles, methode: `colonnes reconnues : ${Object.keys(colonnes).join(', ')}`, ignorees };
  }

  // Pas d'en-tête : on reconnaît les cellules à leur forme, ligne par ligne.
  for (const ligne of lignes) {
    const lue = lireJetons(ligne);
    if (lue) parcelles.push(lue);
    else if (ligne.some((c) => propre(c))) ignorees += 1;
  }
  return { parcelles, methode: 'aucun en-tête : lecture par la forme des cellules', ignorees };
}

/* --------------------------------------------------------------------- csv */

export function depuisCsv(texte) {
  const sansBom = texte.replace(/^\uFEFF/, '');
  // Le séparateur, compté sur le fichier entier : un point-virgule dans une
  // seule cellule ne doit pas l'emporter sur des virgules partout ailleurs.
  const points = (sansBom.match(/;/g) || []).length;
  const virgules = (sansBom.match(/,/g) || []).length;
  const tabulations = (sansBom.match(/\t/g) || []).length;
  const separateur = tabulations > points && tabulations > virgules ? '\t'
    : (points >= virgules ? ';' : ',');

  const lignes = sansBom.split(/\r?\n/).filter((l) => l.trim() !== '')
    .map((l) => decouperCsv(l, separateur));
  const r = depuisTable(lignes);
  return { ...r, genre: 'csv', lignes, methode: `${r.methode} (séparateur « ${separateur === '\t' ? 'tabulation' : separateur} »)` };
}

/** Un découpage qui respecte les guillemets — un lieudit contient des virgules. */
function decouperCsv(ligne, separateur) {
  const cellules = [];
  let courante = '';
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i];
    if (c === '"') {
      if (entreGuillemets && ligne[i + 1] === '"') { courante += '"'; i += 1; }
      else entreGuillemets = !entreGuillemets;
    } else if (c === separateur && !entreGuillemets) {
      cellules.push(courante); courante = '';
    } else courante += c;
  }
  cellules.push(courante);
  return cellules;
}

/* ----------------------------------------------------------------- tableur */

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };
const desechapper = (s) => String(s)
  .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENTITES[n]);

const indiceColonne = (reference) => {
  const lettres = String(reference || '').replace(/\d/g, '').toUpperCase();
  let n = 0;
  for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

/**
 * Un .xlsx est une archive de XML. On la lit directement, plutôt que d'ajouter
 * une bibliothèque de tableur entière pour n'y prendre que du texte : moins de
 * code embarqué, et rien qui interprète une formule.
 */
export async function depuisTableur(octets) {
  const { unzipSync, strFromU8 } = await import('fflate');
  let archive;
  try { archive = unzipSync(new Uint8Array(octets)); }
  catch (e) { return { erreur: `fichier tableur illisible : ${e.message}` }; }

  const lire = (chemin) => (archive[chemin] ? strFromU8(archive[chemin]) : null);

  const partagees = [];
  const sharedXml = lire('xl/sharedStrings.xml');
  if (sharedXml) {
    for (const si of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      partagees.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((t) => desechapper(t[1])).join(''));
    }
  }

  const nom = Object.keys(archive)
    .filter((c) => /^xl\/worksheets\/sheet\d+\.xml$/.test(c))
    .sort()[0];
  if (!nom) return { erreur: 'aucune feuille dans le classeur' };
  const feuille = lire(nom);

  const lignes = [];
  for (const row of feuille.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cellules = [];
    for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributs = c[1] || '';
      const contenu = c[2] || '';
      const reference = (attributs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attributs.match(/t="([^"]+)"/) || [])[1];
      const v = (contenu.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let valeur = '';
      if (type === 's') valeur = partagees[Number(v)] ?? '';
      else if (type === 'inlineStr') {
        valeur = [...contenu.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((t) => desechapper(t[1])).join('');
      } else if (v !== undefined) valeur = desechapper(v);
      const j = reference ? indiceColonne(reference) : cellules.length;
      cellules[j] = valeur;
    }
    lignes.push(Array.from(cellules, (x) => x ?? ''));
  }

  const r = depuisTable(lignes);
  return { ...r, genre: 'tableur', lignes };
}

/* --------------------------------------------------------------------- pdf */

// Le relevé porte son département et sa commune en toutes lettres, mais avec
// le code DGFiP à trois chiffres, pas le code INSEE. Les deux se recollent :
// 59 + 355 = 59355, celui que l'écran cherche.
//
// Le nom se lit en CAPITALES et s'arrête à la première minuscule — sans quoi
// « Commune : 355 LOMME  Année : 2026 » rend « LOMME Année ». (Attention au
// piège de la classe [A-ZÀ-Ÿ] : la plage Unicode À-Ÿ contient aussi les
// minuscules accentuées, et « é » y passe.)
const MAJUSCULE = 'A-Z\\u00C0-\\u00D6\\u00D8-\\u00DD';
// Deux lettres au moins par mot : sans quoi le « A » d'« Année » passerait
// pour la fin du nom de la commune.
const MOT = `[${MAJUSCULE}][${MAJUSCULE}'’-]+`;
const MOTS = `${MOT}(?:[ -]${MOT})*`;
// SANS le drapeau « i » : il rendrait [A-Z] indifférent à la casse et le nom
// avalerait le mot suivant. Les trois graphies du mot « commune » sont donc
// écrites à la main.
const COMMUNE = new RegExp(`(?:COMMUNE|Commune|commune)\\s*:?\\s*(\\d{3,5})?\\s*(${MOTS})`);
const DEPARTEMENT = /d[ée]partement\s*:?\s*(\d{1,2}[AB]?)\b/i;

/**
 * Le relevé de propriété n'a pas de colonnes : il a des mots posés à des
 * coordonnées. On les regroupe par ordonnée pour reconstituer les lignes —
 * une tolérance d'un point et demi, parce qu'un exposant ou un caractère d'une
 * autre fonte se pose à un cheveu au-dessus de ses voisins.
 */
export async function depuisPdf(octets) {
  let pdfjs;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
  catch (e) { return { erreur: `lecture des PDF indisponible : ${e.message}` }; }

  let document;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(octets),
      isEvalSupported: false,
      useSystemFonts: false,
      // Le relevé n'a pas d'images utiles : on ne les décode pas.
      disableFontFace: true,
    }).promise;
  } catch (e) {
    return { erreur: `PDF illisible : ${e.message}` };
  }

  const lignes = [];
  for (let n = 1; n <= document.numPages; n += 1) {
    const page = await document.getPage(n);
    const contenu = await page.getTextContent();
    const parY = new Map();
    for (const item of contenu.items) {
      const texte = String(item.str || '');
      if (!texte.trim()) continue;
      const x = item.transform[4];
      const y = Math.round(item.transform[5] / 1.5) * 1.5;
      if (!parY.has(y)) parY.set(y, []);
      parY.get(y).push({ x, texte });
    }
    [...parY.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, mots]) => {
        lignes.push(mots.sort((a, b) => a.x - b.x).map((m) => m.texte));
      });
  }

  // Un relevé de propriété PDF texte a des dizaines de lignes. Aucune, c'est
  // qu'il s'agit d'un scan : la question n'est pas la même, et il faut le dire
  // plutôt que de rendre une liste vide.
  if (lignes.length === 0) {
    return {
      erreur: 'aucun texte dans ce PDF : c’est une image (document scanné). '
        + 'CERTIF ne lit pas les scans — déposez le relevé tel que le service le '
        + 'délivre, ou une liste en tableur.',
      genre: 'pdf', lignes: [],
    };
  }

  const parcelles = [];
  const vues = new Set();
  for (const ligne of lignes) {
    const lue = lireJetons(ligne);
    if (!lue) continue;
    // Le relevé porte la même parcelle deux fois quand elle est bâtie : une
    // fois au tableau des propriétés bâties, une fois à celui des non bâties.
    const clef = `${lue.prefixe}|${lue.section}|${lue.numero}`;
    if (vues.has(clef)) continue;
    vues.add(clef);
    parcelles.push(lue);
  }

  const entete = lignes.slice(0, 40).map((l) => l.join(' ')).join('\n');
  const trouvee = entete.match(COMMUNE);
  const departement = (entete.match(DEPARTEMENT) || [])[1];

  return {
    genre: 'pdf',
    parcelles,
    lignes,
    commune: trouvee ? {
      code: trouvee[1] || null,
      nom: propre(trouvee[2]),
      // Le code INSEE, quand les deux morceaux sont là. Il n'est qu'une
      // PROPOSITION de recherche : c'est le choix dans la liste des communes
      // qui fixe la commune, comme pour une saisie à la main.
      codeInsee: departement && trouvee[1] && trouvee[1].length === 3
        ? `${departement.padStart(2, '0')}${trouvee[1]}` : null,
    } : null,
    methode: `${document.numPages} page(s), ${lignes.length} lignes reconstituées`,
    ignorees: lignes.length - parcelles.length,
  };
}

/* ------------------------------------------------------------------ entrée */

/**
 * @param {Uint8Array|Buffer} octets
 * @param {string} nom  le nom du fichier déposé, pour reconnaître le format
 */
export async function importerParcelles(octets, nom = '') {
  const tableau = new Uint8Array(octets);
  const debut = String.fromCharCode(...tableau.slice(0, 4));
  const extension = (String(nom).match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || '';

  let r;
  if (debut === '%PDF' || extension === 'pdf') r = await depuisPdf(tableau);
  else if (debut.startsWith('PK') || extension === 'xlsx') r = await depuisTableur(tableau);
  else if (extension === 'csv' || extension === 'txt') {
    r = depuisCsv(new TextDecoder('utf-8').decode(tableau));
  } else if (extension === 'xls') {
    r = { erreur: 'le format .xls (Excel 97) n’est pas lu : enregistrez en .xlsx ou en .csv' };
  } else {
    r = { erreur: `format non reconnu (${nom || 'sans nom'}) : déposez un PDF, un .xlsx ou un .csv` };
  }

  if (r.erreur) return { fichier: nom, ...r, parcelles: [] };

  const avertissements = [];
  if (!r.parcelles.length) {
    avertissements.push('aucune parcelle reconnue dans ce fichier. Vérifiez qu’il porte bien '
      + 'des sections et des numéros ; le détail de ce qui a été lu est consultable.');
  }
  const sansContenance = r.parcelles.filter((p) => !p.contenance).length;
  if (sansContenance) {
    avertissements.push(`${sansContenance} parcelle(s) sans contenance lue : elle n’est prise `
      + 'que si elle est écrite en hectares-ares-centiares. À compléter à la main si vous la '
      + 'voulez sur l’annexe.');
  }

  return {
    fichier: nom,
    genre: r.genre,
    methode: r.methode,
    parcelles: r.parcelles,
    commune: r.commune || null,
    ignorees: r.ignorees || 0,
    lignes: r.lignes || [],
    avertissements,
  };
}
