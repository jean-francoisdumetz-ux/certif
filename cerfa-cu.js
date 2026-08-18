// CERTIF — remplissage du Cerfa 13410*13 (demande de certificat d'urbanisme)
//
// Le gabarit officiel se dépose dans data/cerfa_13410-13.pdf. Il vient de
// https://www.formulaires.service-public.gouv.fr/gf/cerfa_13410.do
// Millésime en vigueur : 13410*13, mis à jour le 8 janvier 2026.
//
// LES NOMS DE CHAMPS NE SONT PAS DEVINÉS. Ils ont été énumérés sur le fichier
// lui-même (voir diagnostiquer()) : 86 champs, nommés D2D_denomination,
// T2S_section, E1S_signature… Sur le 11565 de MATRICE ils s'appelaient a1,
// a2, cac1 — aucune convention ne se généralise d'un imprimé à l'autre, et
// une table supposée se serait trompée sur les 86.
//
// SEULES LES PAGES 1 À 3 CONSTITUENT LA DEMANDE. Le fichier en compte sept :
//   1-3  le formulaire — objet, demandeur, coordonnées, terrain, engagement
//   4    la notice RGPD
//   5-6  « Comment constituer le dossier » (Cerfa 52366#01)
//   7    la note descriptive succincte, réservée au certificat opérationnel
// Envoyer les sept, en deux exemplaires, ferait quatorze pages dont huit de
// documentation que la mairie a déjà. On n'expédie que les trois premières.
//
// Le formulaire dit lui-même, page 3 : « Votre demande doit être établie en
// deux exemplaires pour un certificat d'urbanisme d'information ». C'est la
// confirmation, par l'imprimé, de l'article R*410-2.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fontes } from './mise-en-page.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const FICHIER = 'cerfa_13410-13.pdf';
export const MILLESIME = '13410*13';
export const PAGES_DEMANDE = [1, 2, 3];
export const PARCELLES_MAX = 3; // au-delà, tout bascule en annexe

// Ce qu'on écrit dans le cadre 4.2 quand les parcelles sont renvoyées en bloc
// à l'annexe. La formule est dessinée sur le fond, pas saisie dans un champ :
// les cases de ce cadre sont à peigne, bornées à 2, 3 ou 4 caractères, et
// aucune ne peut recevoir une phrase.
export const MENTION_ANNEXE = 'Cf. annexe jointe à la présente demande.';

/**
 * Toutes les parcelles en annexe, ou toutes sur l'imprimé — jamais moitié-moitié.
 *
 * L'imprimé accepte trois lignes. Au-delà, plutôt que d'en poser trois ici et
 * le reste ailleurs — ce qui oblige le service à additionner deux listes et
 * expose au double compte —, on renvoie l'ensemble à l'annexe et le cadre 4.2
 * n'en désigne aucune. Une seule liste, un seul endroit.
 */
export const debordeEnAnnexe = (d) => ((d.terrain?.parcelles || []).length > PARCELLES_MAX);

let gabarit = null;

export const cheminGabarit = () => join(process.cwd(), 'data', FICHIER);
export const gabaritPresent = () => existsSync(cheminGabarit());

function lireGabarit() {
  if (!gabarit) {
    if (!gabaritPresent()) throw new Error(`gabarit absent : déposer le Cerfa ${MILLESIME} dans data/${FICHIER}`);
    gabarit = readFileSync(cheminGabarit());
  }
  return gabarit;
}

/** Énumère les champs réels du gabarit — l'outil qui a remplacé la devinette. */
export async function diagnostiquer() {
  const document = await PDFDocument.load(lireGabarit());
  const formulaire = document.getForm();
  const pages = document.getPages();

  const champs = formulaire.getFields().map((champ) => {
    const type = champ.constructor.name.replace(/^PDF/, '');
    const detail = { nom: champ.getName(), type, page: null };
    try {
      const ref = champ.acroField.getWidgets()[0]?.P();
      const i = pages.findIndex((p) => p.ref === ref);
      if (i >= 0) detail.page = i + 1;
    } catch { /* champ sans widget rattaché */ }
    if (type === 'TextField') {
      try { detail.longueurMax = champ.getMaxLength() ?? null; } catch { /* sans importance */ }
    }
    return detail;
  });

  return { millesime: MILLESIME, pages: pages.length, nombre: champs.length, champs };
}

/* ------------------------------------------------ découpage d'une adresse */

/**
 * L'imprimé sépare le numéro de la voie ; nos adresses sont d'un seul tenant.
 *
 * On ne coupe que sur un vrai numéro en tête — « 3 place de la Madeleine »
 * donne 3 / place de la Madeleine, « place de la Madeleine » ne donne rien et
 * part entier dans la voie. Le cas ambigu se règle en fournissant numero et
 * voie explicitement.
 */
export function couperAdresse(adresse) {
  const m = /^\s*(\d+\s*(?:bis|ter|quater|[A-Da-d])?)\s+(.+)$/.exec(String(adresse || ''));
  return m ? { numero: m[1].trim(), voie: m[2].trim() } : { numero: '', voie: String(adresse || '').trim() };
}

// Huit caractères : c'est la longueur du champ E1D_date, en cases à peigne.
const JJMMAAAA = (d) => [
  String(d.getDate()).padStart(2, '0'),
  String(d.getMonth() + 1).padStart(2, '0'),
  String(d.getFullYear()),
].join('');

/* --------------------------------------------------------- correspondance */

/**
 * Ce que CERTIF écrit sur l'imprimé, champ par champ.
 *
 * Ne figurent ici QUE les champs que l'étude remplit. Sont délibérément
 * absents :
 *   • M2C, M2K, M2S, M2D, M2M, M2E — cadre réservé à la mairie ;
 *   • U1*, U2*, U3* — cadre 5, réservé à l'administration ;
 *   • C2*, P2* — page 7, note descriptive, propre au certificat opérationnel ;
 *   • D1N, D1P — le demandeur particulier : l'étude est une personne morale.
 */
function correspondance(d) {
  const dem = d.demandeur || {};
  const adresse = dem.numero || dem.voie ? { numero: dem.numero, voie: dem.voie } : couperAdresse(dem.adresse);
  const t = d.terrain || {};
  const adresseTerrain = t.numero || t.voie ? { numero: t.numero, voie: t.voie } : couperAdresse(t.adresse);
  const [avantArobase, apresArobase] = String(dem.courriel || '').split('@');

  const champs = {
    // 2.2 — personne morale
    D2D_denomination: dem.denomination,
    D2R_raison: dem.raisonSociale,
    D2S_siret: (dem.siret || '').replace(/\D/g, ''),
    D2J_type: dem.formeSociale,
    D2N_nom: dem.representantNom,
    D2P_prenom: dem.representantPrenom,

    // 3 — coordonnées du demandeur
    D3N_numero: adresse.numero,
    D3V_voie: adresse.voie,
    D3W_lieudit: dem.lieuDit,
    D3L_localite: dem.commune,
    D3C_code: dem.codePostal,
    D3T_telephone: (dem.telephone || '').replace(/\D/g, ''),
    D5GE1_email: avantArobase,
    D5GE2_email: apresArobase,

    // 4.1 — adresse du terrain
    T2Q_numero: adresseTerrain.numero,
    T2V_voie: adresseTerrain.voie,
    // Pas de case lieu-dit : l'adresse du terrain tient en une ligne, vérifiée
    // contre la Base Adresse Nationale, et se reporte en 4.1 numéro + voie.
    T2L_localite: t.commune?.nom,
    T2C_code: t.codePostal,

    // 6 — engagement
    E1L_lieu: dem.commune,
    E1D_date: JJMMAAAA(d.date instanceof Date ? d.date : new Date()),
  };

  // 4.2 — les trois lignes de l'imprimé, remplies seulement si toutes les
  // parcelles y tiennent. Sinon on les laisse vides : la mention renvoyant à
  // l'annexe sera dessinée à leur place, après aplatissement.
  if (!debordeEnAnnexe(d)) {
    const suffixes = ['', 'P2', 'P3'];
    (t.parcelles || []).forEach((p, i) => {
      const s = suffixes[i];
      champs[`T2F${s}_prefixe`] = p.prefixe;
      champs[`T2S${s}_section`] = String(p.section || '').toUpperCase();
      champs[`T2N${s}_numero`] = p.numero;
      champs[`T2T${s}_superficie`] = p.contenance;
    });
  }

  // La superficie totale reste portée sur l'imprimé dans tous les cas : c'est
  // le chiffre que le service lit en premier, et la note [2] veut qu'il
  // couvre « le présent document ET les annexes ».
  const somme = (t.parcelles || []).reduce((s, p) => s + Number(p.contenance || 0), 0);
  champs.D5T_total = t.superficie ?? (somme || null);

  return champs;
}

/* ------------------------------------------------------------ remplissage */

// Au-delà de trois parcelles, on ne refuse plus : les trois premières restent
// sur l'imprimé, les suivantes passent dans l'annexe sur papier libre que
// compose lib/annexe.js, et le total du cadre 4.2 couvre les deux.
export async function remplirCerfa(d, images = {}) {
  const document = await PDFDocument.load(lireGabarit());
  const formulaire = document.getForm();

  for (const [nom, valeur] of Object.entries(correspondance(d))) {
    if (valeur === undefined || valeur === null || valeur === '') continue;
    let champ;
    try { champ = formulaire.getTextField(nom); }
    catch { throw new Error(`champ « ${nom} » absent du gabarit — le millésime a-t-il changé ?`); }

    // Les champs de l'imprimé sont bornés (SIRET 14, section 2, date 8…).
    // Tronquer en silence écrirait une référence cadastrale fausse ; on
    // s'arrête, en nommant le champ et ce qui dépasse.
    const texte = String(valeur);
    const max = champ.getMaxLength();
    if (max && texte.length > max) {
      throw new Error(`« ${texte} » dépasse la capacité du champ ${nom} (${max} caractères)`);
    }
    champ.setText(texte);
  }

  cocher(formulaire, 'D6A_CUA'); // a) certificat d'urbanisme d'information

  // La case du cadre 3 vaut acceptation de recevoir les réponses de
  // l'administration par voie électronique, lettre recommandée électronique
  // comprise. Elle engage, et elle n'est pas cochée parce qu'une adresse
  // traîne dans une variable : c'est une instruction expresse de l'étude,
  // prise en connaissance de ce qu'elle emporte. Le certificat revient alors
  // par courriel, sans les jours d'acheminement d'un pli.
  //
  // Elle suppose une adresse : cocher sans rien porter au cadre 3 serait
  // accepter un mode de notification qu'on ne rend pas possible.
  if (d.accepterVoieElectronique !== false) {
    if (!d.demandeur?.courriel) {
      throw new Error('acceptation de la voie électronique demandée, mais aucune adresse '
        + 'de courriel n’est renseignée pour le demandeur (CERTIF_OFFICE_COURRIEL)');
    }
    cocher(formulaire, 'D5A_acceptation');
  }

  // Deux champs de l'en-tête, N1FCA_formulaire (« CU ») et N1NCA_numero
  // (« 13410*13 »), sont posés PAR-DESSUS le texte déjà imprimé du cartouche
  // cerfa. Tant que le fichier reste un formulaire, les deux se superposent
  // exactement et cela ne se voit pas ; à l'aplatissement, la police de rendu
  // décale de quelques dixièmes et le numéro sort dédoublé — sur la première
  // chose que voit la mairie. Constaté à l'image, puis corrigé.
  //
  // On les vide plutôt que de les supprimer : removeField laisse une
  // référence pendante que flatten() ne sait plus résoudre. Les vider suffit,
  // le texte du cartouche est imprimé sur le fond de page.
  for (const nom of ['N1FCA_formulaire', 'N1NCA_numero']) {
    try { formulaire.getTextField(nom).setText(''); } catch { /* millésime sans ces champs */ }
  }

  // Aplatir AVANT d'apposer le paraphe : la zone de signature est un champ de
  // formulaire, avec son propre fond. Dessiner d'abord, c'est se faire
  // recouvrir par l'apparence du champ au moment de l'aplatissement.
  // Les rectangles se lisent AVANT l'aplatissement : après, les champs
  // n'existent plus et getField() ne rend rien. Le premier essai dessinait la
  // mention « après », c'est-à-dire nulle part — vu à l'image, page 2 vide et
  // sans renvoi. Un échec silencieux, exactement ce qu'il ne faut pas.
  const ancreAnnexe = debordeEnAnnexe(d) ? rectangle(formulaire, 'D5T_total') : null;
  const zoneSig = rectangle(formulaire, 'E1S_signature');

  formulaire.flatten();
  if (ancreAnnexe) await mentionnerAnnexe(document, ancreAnnexe);
  await apposer(document, images, zoneSig);
  await numeroterDossier(document, d.reference);

  return extraire(document, PAGES_DEMANDE, REMONTEE);
}

/**
 * De combien on remonte l'imprimé sur la feuille, en points.
 *
 * L'IMPRIMÉ OFFICIEL EST DÉSÉQUILIBRÉ, mesuré à l'encre sur un tirage réel du
 * 18 août 2026 : 9,1 mm de blanc au-dessus de la première ligne en page 1,
 * 10,7 mm en page 3, et 4,2 mm seulement sous le pied de page. Or la plupart
 * des imprimantes laser ne savent pas déposer d'encre à moins de 4 à 5 mm du
 * bord : tirée en taille réelle, la page perd sa numérotation.
 *
 * Trois millimètres suffisent à ramener le bas à 7,2 mm — hors de portée de
 * toute marge non imprimable — sans que le haut descende sous 6 mm.
 *
 * CE QUI EST DÉPLACÉ, ET CE QUI NE L'EST PAS. Le contenu de l'imprimé n'est
 * modifié d'aucune manière : pas un caractère, pas un trait, pas une cote. Seule
 * change sa POSITION sur la feuille, exactement comme le ferait un photocopieur
 * dont la vitre est décalée. Le service reçoit le formulaire officiel, complet,
 * dans son millésime — simplement posé trois millimètres plus haut.
 */
const REMONTEE = 8.5; // 3 mm

/**
 * Écrit le renvoi à l'annexe dans le cadre 4.2.
 *
 * PAS en travers des trois lignes de parcelles : les mentions « Préfixe : »,
 * « Section : », « Numéro : » sont imprimées sur le fond et restent là même
 * quand les cases sont vides. Le premier essai posait la phrase sur la
 * deuxième ligne — elle s'y croisait avec ces libellés et devenait illisible.
 * Vu à l'image, puis déplacé.
 *
 * Elle va donc sous la superficie totale, dans le blanc qui termine le cadre.
 * Position calée sur le rectangle du champ D5T_total, lu sur le gabarit.
 */
async function mentionnerAnnexe(document, ancre) {
  const page = document.getPages()[1]; // cadre 4.2, page 2
  const fonte = await document.embedFont(StandardFonts.HelveticaOblique);
  page.drawText(MENTION_ANNEXE, {
    x: 69, y: ancre.y - 26, size: 11, font: fonte, color: rgb(0.1, 0.12, 0.16),
  });
}

/**
 * Porte la référence du dossier à côté de la pagination, sur chaque page.
 *
 * Le pli qui part contient deux exemplaires de trois pages, une lettre et une
 * annexe. Si le service dégrafe, ou si la demande se sépare de sa lettre dans
 * une bannette, plus rien ne dit à quel dossier de l'étude ces feuilles se
 * rattachent — et le certificat reviendra sans référence à citer.
 *
 * La position est mesurée sur le gabarit, pas estimée : le « 1 / 7 » du pied
 * s'étend de 288,0 à 306,2 points, sur une ligne de base à 13,4 points du bas —
 * relevée sur les trois pages avec pdf.js —, sous les deux filets qui courent à
 * 39,0 et 28,4 points. La mention se pose à 314 points, immédiatement à sa
 * droite, sur la MÊME ligne de base, sans rien recouvrir.
 *
 * CE PIED EST À 4,7 mm DU BORD sur le gabarit, et c'est l'imprimé officiel qui
 * en décide, pas nous. La plupart des imprimantes laser ne savent pas descendre
 * en dessous de 4 à 5 mm : la page y perdrait sa numérotation. C'est ce qui a
 * conduit à remonter l'imprimé de 3 mm (voir REMONTEE) — le pied se retrouve
 * alors à 7,1 mm, et l'impression à 100 % redevient sûre.
 */
async function numeroterDossier(document, reference) {
  if (!reference) return;
  const f = await fontes(document);
  for (const numero of PAGES_DEMANDE) {
    const page = document.getPages()[numero - 1];
    if (!page) continue;
    page.drawText(`Dossier ${reference}`, {
      x: 314, y: 13.4, size: 8.5, font: f.sans, color: rgb(0.42, 0.45, 0.5),
    });
  }
}

function rectangle(formulaire, nom) {
  try { return formulaire.getField(nom).acroField.getWidgets()[0].getRectangle(); }
  catch { return null; }
}

function cocher(formulaire, nom) {
  try { formulaire.getCheckBox(nom).check(); }
  catch { throw new Error(`case « ${nom} » absente du gabarit`); }
}

/**
 * Zone de signature : lue sur le gabarit, pas mesurée à l'œil.
 *
 * Le champ E1S_signature porte son propre rectangle ; c'est l'imprimé qui dit
 * où signer. Une coordonnée relevée à la règle sur une capture d'écran aurait
 * été juste à quelques points près — assez pour mordre sur le trait.
 */
async function apposer(document, images, z) {
  if (!images.signature || !z) return;
  const page = document.getPages()[2]; // cadre 6, page 3

  const octets = typeof images.signature === 'string'
    ? Buffer.from(images.signature, 'base64') : images.signature;
  const img = await document.embedPng(octets);

  const marge = 4;
  const largeurMax = z.width - 2 * marge;
  const hauteurMax = z.height - 2 * marge;
  let l = largeurMax;
  let h = l * (img.height / img.width);
  if (h > hauteurMax) { h = hauteurMax; l = h * (img.width / img.height); }

  page.drawImage(img, { x: z.x + (z.width - l) / 2, y: z.y + (z.height - h) / 2, width: l, height: h });
}

/** Ne garde que les pages qui constituent la demande. */
async function extraire(source, numeros, remontee = 0) {
  const sortie = await PDFDocument.create();
  const pages = await sortie.copyPages(source, numeros.map((n) => n - 1));
  pages.forEach((p) => {
    // translateContent enveloppe le flux EXISTANT dans une translation : tout ce
    // qui a été dessiné jusqu'ici monte ensemble — le fond de l'imprimé, les
    // champs aplatis, le paraphe, la mention d'annexe et le numéro de dossier.
    // C'est pourquoi l'appel vient en dernier : rien ne doit être ajouté après,
    // sous peine d'être posé à l'ancienne hauteur.
    if (remontee) p.translateContent(0, remontee);
    sortie.addPage(p);
  });
  return sortie.save();
}
