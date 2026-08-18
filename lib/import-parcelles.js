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
  // Le préfixe AVANT la commune : « commune absorbée » désigne un préfixe, pas
  // une commune, et l'ordre de ce tableau est l'ordre d'essai.
  prefixe: /^(pr[eé]fixe|com\.?\s*abs|commune\s+absorb|ancienne\s+commune)/i,
  section: /^(section|sect\.?|sec\.?)$/i,
  numero: /^(n[°o]?\s*(de\s*)?(plan|parcelle)?|num[eé]ro|parcelle)$/i,
  contenance: /^(contenance|surface|superficie|cont\.?)/i,
  lieudit: /^(lieu-?\s?dit|adresse|voie|situation)/i,
  // UNE LISTE PEUT PORTER SUR PLUSIEURS COMMUNES, et c'est le cas ordinaire d'un
  // dossier de succession : une colonne « Commune », et les parcelles se
  // regroupent d'elles-mêmes. Chaque groupe donnera son bloc de saisie, sa
  // mairie et ses propres demandes.
  commune: /^(commune|ville|localit[eé])$/i,
  codeInsee: /^(code\s*insee|insee|code\s*commune)$/i,
  codePostal: /^(code\s*postal|cp)$/i,
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

  // Deux écritures, et une seule des deux tolère l'absence d'espaces. « 0ha14a29ca »
  // est la forme de l'extrait cadastral modèle 1 : les unités sont écrites, donc
  // les séparateurs sont facultatifs. « 00 08 42 » est celle du relevé de
  // propriété : rien ne sépare les nombres que des espaces, qui sont alors
  // obligatoires — sans eux, « 000842 » deviendrait lisible de trois façons.
  const haAca = t.match(/^(\d{1,3})\s*ha\s*(\d{1,2})\s*a\s*(\d{1,2})\s*ca$/i)
    || t.match(/^(\d{1,3})\s+(\d{1,2})\s+(\d{1,2})$/);
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

    // La contenance, où qu'elle soit sur la ligne, sous ses trois écritures :
    // « 0ha14a29ca » d'un seul tenant, « 00 08 42 » déjà groupée, ou éclatée en
    // trois jetons par la reconstitution des lignes du PDF.
    let contenance = null;
    let ouEstElle = -1;
    for (let j = 0; j < reste.length; j += 1) {
      if (/ha.*ca$/i.test(reste[j]) || /^\d{1,3}\s+\d{1,2}\s+\d{1,2}$/.test(reste[j])) {
        const v = enMetresCarres(reste[j]);
        if (v !== null) { contenance = v; ouEstElle = j; break; }
      }
      if (/^\d{1,3}$/.test(reste[j]) && /^\d{1,2}$/.test(reste[j + 1] || '')
        && /^\d{1,2}$/.test(reste[j + 2] || '')) {
        const v = enMetresCarres(`${reste[j]} ${reste[j + 1]} ${reste[j + 2]}`);
        if (v !== null) { contenance = v; ouEstElle = j; break; }
      }
    }

    // L'ADRESSE, ET NON UN MOT D'ADRESSE. « 11 ALL DU TENNIS » vaut mieux que
    // « ALL » : c'est ce qui ira dans la colonne « lieu de situation » de
    // l'annexe, et un lieudit tronqué n'aide personne à retrouver le terrain.
    // On prend la suite de mots qui suit le numéro, précédée de son numéro de
    // voirie s'il y en a un, et on s'arrête au premier code — un nombre de
    // quatre chiffres n'est pas une adresse, c'est un code Rivoli.
    const avantContenance = reste.slice(0, ouEstElle === -1 ? reste.length : ouEstElle);
    const mots = [];
    for (const jeton of avantContenance) {
      // Deux lettres de suite quelque part dans le jeton : cela suffit, et il
      // faut que cela suffise. Un jeton n'est pas un mot — la reconstitution des
      // lignes rend « 3 ALL DES LILAS » d'un bloc quand les mots d'une cellule
      // sont serrés, et « ALL » puis « DES » puis « LILAS » quand ils sont
      // espacés. Exiger une initiale alphabétique perdrait le premier cas.
      const estMot = /[A-Za-zÀ-ÿ]{2}/.test(jeton) && !/ha.*ca/i.test(jeton);
      const estNumeroDeVoirie = mots.length === 0 && /^\d{1,3}(?:\s*(?:BIS|TER))?$/i.test(jeton);
      if (estMot || estNumeroDeVoirie) mots.push(jeton);
      else if (mots.length) break;
    }

    // UNE DÉSIGNATION NOUVELLE change la référence de la parcelle : l'extrait
    // cadastral modèle 1 la porte dans ses dernières colonnes. On ne devine pas
    // laquelle retenir — on retient l'ancienne, qui est celle de gauche, et on
    // signale qu'il y en a une seconde.
    const apres = ouEstElle === -1 ? [] : reste.slice(ouEstElle + 1);
    const seconde = apres.some((x, k) => EST_SECTION.test(x.toUpperCase())
      && EST_NUMERO.test(apres[k + 1] || '') && Number(apres[k + 1]) > 0);

    const lue = parcelle(prefixe, t[i], t[i + 1], contenance, mots.join(' '));
    if (seconde) lue.designationNouvelle = true;
    return lue;
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
    // Les groupes se forment dans l'ORDRE D'APPARITION des communes, pas dans
    // l'ordre alphabétique : la liste a été écrite dans un ordre qui a du sens
    // pour qui l'a faite, et le bousculer obligerait à s'y retrouver deux fois.
    const groupes = new Map();
    for (const ligne of lignes.slice(entete.index + 1)) {
      const cel = (clef) => (colonnes[clef] === undefined ? '' : propre(ligne[colonnes[clef]]));
      const section = cel('section').toUpperCase();
      const numero = cel('numero').replace(/\D/g, '');
      if (!EST_SECTION.test(section) || !EST_NUMERO.test(numero) || Number(numero) === 0) {
        if (ligne.some((c) => propre(c))) ignorees += 1;
        continue;
      }
      const lue = parcelle(
        cel('prefixe').replace(/\D/g, ''), section, numero,
        enMetresCarres(cel('contenance')), cel('lieudit'));
      parcelles.push(lue);

      const nom = cel('commune');
      const code = cel('codeInsee').replace(/[^0-9AB]/gi, '').toUpperCase();
      const clef = `${code}|${nom.toUpperCase()}`;
      if (!groupes.has(clef)) {
        groupes.set(clef, {
          commune: { nom: nom || null, codeInsee: code || null, codePostal: cel('codePostal') || null },
          parcelles: [],
        });
      }
      groupes.get(clef).parcelles.push(lue);
    }

    return {
      parcelles,
      // Un seul groupe sans nom de commune, c'est une liste ordinaire : on ne
      // rend alors aucun regroupement, pour ne pas faire croire à une commune
      // qu'on n'a pas lue.
      groupes: colonnes.commune !== undefined || colonnes.codeInsee !== undefined
        ? [...groupes.values()] : null,
      methode: `colonnes reconnues : ${Object.keys(colonnes).join(', ')}`,
      ignorees,
    };
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
// « VILLENEUVE D ASCQ », « SAINT-JEAN D ANGELY » : un mot d'UNE lettre est admis
// s'il est suivi d'un vrai mot. Sans cette réserve, le « A » d'« Année » passerait
// pour la fin du nom ; avec elle, le « D » d'Ascq ne le coupe plus en deux.
const SEUL = `[${MAJUSCULE}](?=[ -][${MAJUSCULE}]{2})`;
const MOTS = `${MOT}(?:[ -](?:${MOT}|${SEUL}))*`;

// LES QUATRE FAÇONS D'ÉCRIRE LA MÊME CHOSE. D'un centre des impôts fonciers à
// l'autre, l'en-tête d'un relevé de propriété s'écrit « Commune : 355 LOMME »,
// « COMMUNE 59355 LOMME », « Commune de LOMME » ou simplement « LOMME » sous le
// mot COMMUNE. On accepte les quatre, et le code — trois ou cinq chiffres — est
// facultatif : le NOM suffit à chercher dans l'annuaire.
//
// SANS le drapeau « i » : il rendrait [A-Z] indifférent à la casse et le nom
// avalerait le mot suivant (« LOMME Année »). Les graphies du mot sont donc
// écrites à la main.
const COMMUNE = new RegExp(
  `(?:COMMUNE|Commune|commune)\\s*(?:DE|de|d’|D’)?\\s*:?\\s*(\\d{3,5})?\\s*(${MOTS})`);
const DEPARTEMENT = /d[ée]p(?:artement|\.)?\s*:?\s*(\d{1,3}|2[AB])\b/i;

/**
 * La commune, lue dans l'en-tête d'un relevé.
 *
 * ELLE N'EST QU'UNE PROPOSITION DE RECHERCHE. C'est le choix dans la liste des
 * communes qui fixe la commune du dossier, exactement comme pour une saisie à
 * la main — un code lu dans un en-tête ne doit pas décider seul de la mairie à
 * qui part le recommandé.
 *
 * Le code INSEE se recolle quand les deux morceaux sont là : le relevé porte le
 * code DGFiP à trois chiffres, pas le code INSEE, et 59 + 355 = 59355. Écrit
 * déjà à cinq chiffres, il est pris tel quel. Absent, le NOM suffit : l'annuaire
 * sait chercher dessus.
 *
 * @param {string} entete  les premières lignes du document, recollées
 */
export function lireEnteteReleve(entete) {
  const texte = String(entete || '');
  const brut = (texte.match(DEPARTEMENT) || [])[1];
  // « 059 » comme « 59 » : on ramène à la forme du Code officiel géographique.
  // La Corse garde ses lettres — 2A, 2B.
  const departement = brut
    ? (/^2[AB]$/i.test(brut) ? brut.toUpperCase() : String(Number(brut)).padStart(2, '0'))
    : null;

  // TOUTES les occurrences, pas la première. « COMMUNE ABSORBÉE 355 » précède
  // souvent « Commune : 350 LILLE » sur un relevé de commune déléguée : s'en
  // tenir à la première ferait chercher une commune nommée « ABSORBÉE ».
  const candidats = [];
  for (const m of texte.matchAll(new RegExp(COMMUNE.source, 'g'))) {
    const nom = propre(m[2]);
    if (/^(ABSORB|DELEGU|D[ÉE]L[ÉE]GU|ASSOCI)/.test(nom)) continue;
    const code = m[1] || null;
    let codeInsee = null;
    if (code && code.length === 5) codeInsee = code;
    else if (code && code.length === 3 && departement) codeInsee = `${departement}${code}`;
    candidats.push({ code, nom, codeInsee });
  }
  if (!candidats.length) return null;

  // Celui qui porte un code INSEE complet l'emporte : c'est la recherche la
  // plus sûre. À défaut, le premier nom lisible.
  return candidats.find((c) => c.codeInsee) || candidats[0];
}

/**
 * Le relevé de propriété n'a pas de colonnes : il a des mots posés à des
 * coordonnées. On les regroupe par ordonnée pour reconstituer les lignes —
 * une tolérance d'un point et demi, parce qu'un exposant ou un caractère d'une
 * autre fonte se pose à un cheveu au-dessus de ses voisins.
 */
export async function depuisPdf(octets) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // LE PIÈGE DU « WORKER ». pdf.js délègue le décodage à un fil d'exécution
    // séparé. Sous Node il n'en crée pas vraiment, mais il charge quand même le
    // module du worker — par un import dont le chemin est CALCULÉ à l'exécution
    // (« ./pdf.worker.mjs », relatif à pdf.mjs). Un chemin calculé, aucun
    // empaqueteur ne sait le suivre : le fichier reste sur le serveur de
    // construction et manque à l'appel une fois déployé. C'est très exactement
    // l'erreur rendue par Vercel : « Cannot find module pdf.worker.mjs ».
    //
    // La parade est prévue par pdf.js lui-même : s'il trouve un gestionnaire
    // déjà chargé dans globalThis.pdfjsWorker, il s'en sert et ne cherche plus
    // aucun fichier. On le charge donc nous-mêmes, par un import dont le chemin
    // est ÉCRIT EN TOUTES LETTRES — celui-là, l'empaqueteur le voit, et le
    // fichier part avec la fonction.
    if (!globalThis.pdfjsWorker) {
      globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    }
  } catch (e) {
    return { erreur: `lecture des PDF indisponible : ${e.message}` };
  }

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

  return {
    genre: 'pdf',
    parcelles,
    lignes,
    commune: lireEnteteReleve(lignes.slice(0, 40).map((l) => l.join(' ')).join('\n')),
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
  // UNE DÉSIGNATION NOUVELLE N'EST PAS UN DÉTAIL. L'extrait cadastral modèle 1
  // porte, à droite, la référence issue d'un document d'arpentage : la parcelle
  // a été divisée ou remembrée, et c'est la NOUVELLE référence qui vaut. CERTIF
  // retient l'ancienne — celle de gauche — parce qu'il ne sait pas laquelle est
  // en vigueur, et le dit sans détour.
  const renumerotees = r.parcelles.filter((p) => p.designationNouvelle)
    .map((p) => [p.section, p.numero].join(' '));
  if (renumerotees.length) {
    avertissements.push(`${renumerotees.join(', ')} : une DÉSIGNATION NOUVELLE figure sur la `
      + 'même ligne. CERTIF a retenu l’ancienne référence — vérifiez laquelle est en vigueur '
      + 'avant de générer.');
  }

  const sansContenance = r.parcelles.filter((p) => !p.contenance).length;
  if (sansContenance) {
    avertissements.push(`${sansContenance} parcelle(s) sans contenance lue : elle n’est prise `
      + 'que si elle est écrite en hectares-ares-centiares. À compléter à la main si vous la '
      + 'voulez sur l’annexe.');
  }

  // LES GROUPES SONT LA FORME NORMALE DE LA RÉPONSE, même quand il n'y en a
  // qu'un : l'écran crée un bloc de saisie par groupe, et n'a pas à traiter deux
  // cas. Un tableur à colonne « Commune » en rend autant que de communes ; un
  // relevé ou un extrait en rend un seul, celui de son en-tête.
  const groupes = r.groupes && r.groupes.length
    ? r.groupes
    : [{ commune: r.commune || null, parcelles: r.parcelles }];

  if (groupes.length > 1) {
    avertissements.push(`${groupes.length} communes reconnues dans ce fichier : `
      + `${groupes.map((g) => g.commune?.nom || '?').join(', ')}. Chacune donnera sa demande, `
      + 'sa mairie et son pli.');
  }

  return {
    fichier: nom,
    genre: r.genre,
    methode: r.methode,
    parcelles: r.parcelles,
    commune: r.commune || null,
    groupes,
    ignorees: r.ignorees || 0,
    lignes: r.lignes || [],
    avertissements,
  };
}
