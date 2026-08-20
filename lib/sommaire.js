// CERTIF — le sommaire du lot : quelle parcelle relève de quelle demande
//
// CE QU'IL SERT À FAIRE. Un dossier de six demandes produit six certificats qui
// reviendront séparément, à des semaines d'intervalle, chacun sous sa référence.
// Sans table de correspondance, retrouver à quelle parcelle se rapporte le
// certificat 15151/2-1 arrivé un mardi matin oblige à rouvrir le PDF et à
// compter les pages. Une ligne par parcelle, la référence en dernière colonne,
// et la question ne se pose plus.
//
// IL NE PART PAS EN MAIRIE, ET C'EST DÉLIBÉRÉ. Un sommaire couvrant trois
// communes apprendrait à la mairie de Lomme que le client possède aussi à
// Villeneuve-d'Ascq et à Saint-Omer — une information qui ne la regarde pas, et
// que rien dans la demande ne l'autorise à connaître. C'est pourquoi il sort en
// FICHIER SÉPARÉ plutôt qu'en tête du document à imprimer : une page glissée
// dans le PDF est une page qu'on oublie de retirer avant de fermer l'enveloppe.
//
// À L'ITALIENNE. Huit colonnes ne tiennent pas à la française sans écraser les
// lieudits, et ce document se lit à l'écran ou se classe au dossier — il n'a pas
// à ressembler à un imprimé administratif.

import { PDFDocument, rgb } from 'pdf-lib';
import { Feuille, fontes, MM, GRIS, NOIR } from './mise-en-page.js';
import { hectaresAresCentiares, dateLongue } from './format.js';

const GRILLE = rgb(0.35, 0.38, 0.42);
const ALTERNE = rgb(0.96, 0.97, 0.98);

/**
 * Les colonnes, et pourquoi celles-là.
 *
 * Le préfixe et le lieudit n'apparaissent que s'ils portent quelque chose : une
 * colonne vide sur toute la hauteur d'un tableau fait douter de ce qu'on aurait
 * dû y lire.
 */
function colonnes(lignes, plusieursCommunes) {
  return [
    ...(plusieursCommunes ? [{ titre: 'Commune', clef: 'commune', largeur: 120 }] : []),
    ...(lignes.some((l) => l.prefixe) ? [{ titre: 'Préfixe', clef: 'prefixe', largeur: 48 }] : []),
    { titre: 'Section', clef: 'section', largeur: 52 },
    { titre: 'N°', clef: 'numero', largeur: 48 },
    ...(lignes.some((l) => l.lieudit) ? [{ titre: 'Lieudit', clef: 'lieudit', largeur: 150 }] : []),
    { titre: 'Contenance', clef: 'surface', largeur: 92 },
    { titre: 'Demande', clef: 'demande', largeur: 88 },
    { titre: 'Mairie destinataire', clef: 'mairie', largeur: 180 },
  ];
}

/**
 * Une ligne par parcelle, dans l'ordre des demandes.
 *
 * @param {object} lot  { reference, date, demandes: [{reference, commune, mairie, parcelles}] }
 * @returns {Array} les lignes du tableau, telles qu'elles partiront aussi au tableur
 */
export function lignesDuSommaire(lot) {
  const lignes = [];
  for (const demande of lot.demandes || []) {
    for (const p of demande.parcelles || []) {
      lignes.push({
        commune: demande.commune || '',
        prefixe: p.prefixe && p.prefixe !== '000' ? String(p.prefixe) : '',
        section: String(p.section || '').toUpperCase(),
        numero: String(p.numero || '').replace(/^0+(?=\d)/, ''),
        lieudit: p.lieudit || p.lieuDit || '',
        contenance: p.contenance === '' || p.contenance === null || p.contenance === undefined
          ? null : Number(p.contenance),
        surface: hectaresAresCentiares(p.contenance) || '',
        demande: demande.reference || '',
        mairie: demande.mairie || '',
      });
    }
  }
  return lignes;
}

/**
 * @param {object} lot  { reference, date, demandes: [...] }
 * @returns {Promise<{octets:Uint8Array, pages:number, lignes:number}>}
 */
export async function construireSommaire(lot) {
  const lignes = lignesDuSommaire(lot);
  const communes = new Set(lignes.map((l) => l.commune).filter(Boolean));

  const pdf = await PDFDocument.create();
  const f = await fontes(pdf);
  const feuille = new Feuille(pdf, f, {
    paysage: true, haut: 18 * MM, bas: 16 * MM, gauche: 16 * MM, droite: 16 * MM,
  });

  feuille.texte('Sommaire du dossier', { fonte: f.romainGras, taille: 15 });
  feuille.saut(2);
  feuille.texte('Demandes de certificat d’urbanisme d’information — Cerfa n° 13410*13',
    { taille: 10.5, couleur: GRIS });
  feuille.saut(5);
  feuille.filet();
  feuille.saut(4);

  const rappel = [
    ['Dossier', lot.reference],
    // Où classer les certificats à leur retour. Saisi une fois pour le lot :
    // c'est le seul lien entre la référence de la demande et le rangement.
    ['Sous-dossier Data Room', lot.sousDossier],
    ['Établi le', dateLongue(lot.date instanceof Date ? lot.date : new Date(lot.date || Date.now()))],
    ['Demandes', `${(lot.demandes || []).length} — une par unité foncière et par commune`],
    ['Communes', [...communes].join(', ')],
    ['Parcelles', String(lignes.length)],
  ].filter(([, v]) => v);
  for (const [libelle, valeur] of rappel) feuille.ligneTableau(libelle, valeur);

  feuille.saut(6);
  tableau(feuille, f, lignes, communes.size > 1);

  feuille.saut(6);
  // LE RAPPEL QUI ÉVITE UN ENVOI MALHEUREUX. Ce document porte le patrimoine du
  // client sur plusieurs communes : il n'a pas à quitter l'étude.
  feuille.texte('Document interne à l’étude : il ne fait pas partie des pièces à adresser aux '
    + 'mairies.', { taille: 9.5, couleur: GRIS });

  return { octets: await pdf.save(), pages: feuille.pages.length, lignes: lignes.length };
}

/* -------------------------------------------------------------- le tableau */

function tableau(feuille, f, lignes, plusieursCommunes) {
  const COLONNES = colonnes(lignes, plusieursCommunes);
  const taille = 9.5;
  const hauteur = taille * 1.9;
  const x0 = feuille.marges.gauche;
  const brut = COLONNES.reduce((s, c) => s + c.largeur, 0);
  const echelle = Math.min(1, feuille.largeur / brut);
  const large = brut * echelle;

  const bornes = [];
  let curseur = x0;
  for (const c of COLONNES) { bornes.push(curseur); curseur += c.largeur * echelle; }
  bornes.push(curseur);

  const ecrire = (valeurs, fonte, fond = null) => {
    const base = feuille.place(hauteur);
    const bas = base - taille * 0.55;
    const haut = bas + hauteur;

    if (fond) {
      feuille.page.drawRectangle({
        x: x0, y: bas, width: large, height: hauteur, color: fond,
      });
    }

    COLONNES.forEach((c, i) => {
      const brutTexte = String(valeurs[c.clef] ?? '');
      if (!brutTexte) return;
      // Une mairie ne tient pas toujours dans sa colonne : on coupe plutôt que
      // de laisser déborder sur la voisine, et on marque la coupure.
      const place = (bornes[i + 1] - bornes[i]) - 9;
      let texte = brutTexte;
      while (texte && fonte.widthOfTextAtSize(texte, taille) > place) {
        texte = texte.slice(0, -2);
      }
      if (texte !== brutTexte) texte = `${texte}…`;
      feuille.page.drawText(texte, {
        x: bornes[i] + 4.5, y: base, size: taille, font: fonte, color: NOIR,
      });
    });

    const trait = (a, b) => feuille.page.drawLine({ start: a, end: b, thickness: 0.6, color: GRILLE });
    trait({ x: x0, y: haut }, { x: x0 + large, y: haut });
    trait({ x: x0, y: bas }, { x: x0 + large, y: bas });
    for (const x of bornes) trait({ x, y: bas }, { x, y: haut });
  };

  const entete = Object.fromEntries(COLONNES.map((c) => [c.clef, c.titre]));
  ecrire(entete, f.sansGras);

  // Un fond alterné PAR DEMANDE, et non par ligne : c'est le regroupement qui
  // importe ici, pas le comptage. Deux parcelles d'une même demande se lisent
  // ainsi d'un bloc, et le changement de teinte marque le passage à la suivante.
  let precedente = null;
  let rang = 0;
  for (const l of lignes) {
    if (l.demande !== precedente) { precedente = l.demande; rang += 1; }
    // L'en-tête se répète en haut de chaque page. On vérifie la place AVANT de
    // poser la ligne : laisser la coupure se faire seule donnerait une seconde
    // page de colonnes anonymes.
    if (feuille.y - hauteur < feuille.marges.bas) {
      feuille.nouvellePage();
      ecrire(entete, f.sansGras);
    }
    ecrire(l, f.romain, rang % 2 === 0 ? ALTERNE : null);
  }
}
