// CERTIF — annexe des références cadastrales
//
// Le cadre 4.2 du Cerfa 13410*13 n'offre que trois lignes. Au-delà, il renvoie
// à « une ou plusieurs annexes Références cadastrales complémentaires ».
// L'imprimé d'annexe officiel existe, mais rien n'oblige à l'employer : la
// pièce se fait sur papier libre dès lors qu'elle porte les mêmes mentions.
//
// TOUT OU RIEN. Quand le terrain compte plus de trois parcelles, l'annexe les
// désigne TOUTES et le cadre 4.2 n'en porte aucune : il renvoie ici. Répartir
// trois parcelles d'un côté et le reste de l'autre obligerait le service à
// additionner deux listes, avec le double compte au bout.
//
// NI SIGNATURE NI NOM, ET PAS DE NUMÉROTATION DES LIGNES. L'annexe prolonge le
// cadre 4.2 d'une demande déjà signée en son cadre 6. Et un compteur 1, 2, 3…
// introduirait une seconde façon de désigner une parcelle, à côté de sa
// référence cadastrale : le service instruit sur la section et le numéro.
//
// LA FORME EST CELLE DE REDPAR ET DE PAINT — Section, N°, Lieudit, Surface,
// grille complète, contenances en hectares-ares-centiares. Un notaire lit ses
// désignations sous cette forme ; en inventer une autre pour CERTIF obligerait
// à relire différemment la même donnée d'un outil à l'autre.

import { PDFDocument, rgb } from 'pdf-lib';
import { Feuille, fontes, MM, GRIS, NOIR } from './mise-en-page.js';
import { hectaresAresCentiares, contenanceTotale } from './format.js';
import { PARCELLES_MAX } from './cerfa-cu.js';

const GRILLE = rgb(0.35, 0.38, 0.42);

/**
 * Le préfixe n'a pas de colonne chez REDPAR, et n'en a pas besoin dans le cas
 * ordinaire où il vaut 000. Mais il porte le code de la commune absorbée dès
 * qu'une parcelle relève d'une commune associée ou déléguée — LOMME, 355 — et
 * la section AB 12 de Lomme n'est pas la section AB 12 de Lille. La colonne
 * n'apparaît donc que si au moins une parcelle en porte un.
 */
const colonnes = (parcelles) => [
  ...(parcelles.some((p) => p.prefixe && p.prefixe !== '000')
    ? [{ titre: 'Préfixe', clef: 'prefixe', largeur: 62 }] : []),
  { titre: 'Section', clef: 'section', largeur: 62 },
  { titre: 'N°', clef: 'numero', largeur: 55 },
  { titre: 'Lieudit', clef: 'lieudit', largeur: 190 },
  { titre: 'Surface', clef: 'surface', largeur: 108 },
];

/**
 * @returns {Promise<{octets:Uint8Array, pages:number, nombre:number}|null>}
 *   null quand toutes les parcelles tiennent sur l'imprimé.
 */
export async function construireAnnexe(d) {
  const parcelles = d.terrain?.parcelles || [];
  if (parcelles.length <= PARCELLES_MAX) return null;

  const pdf = await PDFDocument.create();
  const f = await fontes(pdf);
  const feuille = new Feuille(pdf, f, { haut: 22 * MM, bas: 20 * MM });

  feuille.texte('Annexe à la demande de certificat d’urbanisme', { fonte: f.romainGras, taille: 15 });
  feuille.saut(2);
  feuille.texte('Références cadastrales — cadre 4.2 du formulaire Cerfa n° 13410*13',
    { taille: 10.5, couleur: GRIS });
  feuille.saut(5);
  feuille.filet();
  feuille.saut(5);

  const rappel = [
    ['Demandeur', d.demandeur?.denomination || d.office?.nom],
    ['Dossier', d.reference],
    ['Commune', [
      (d.terrain?.commune?.nom || '').toUpperCase(),
      d.terrain?.commune?.code ? `code INSEE ${d.terrain.commune.code}` : null,
    ].filter(Boolean).join(' — ')],
    ['Lieu de situation', d.terrain?.adresse],
  ].filter(([, v]) => v);
  for (const [libelle, valeur] of rappel) feuille.ligneTableau(libelle, valeur);

  feuille.saut(8);
  feuille.texte('Liste des parcelles objet de la présente demande', { fonte: f.sansGras, taille: 11 });
  feuille.saut(4);

  tableau(feuille, f, parcelles, {
    lieudit: d.terrain?.adresse || '',
    total: d.terrain?.superficie ?? contenanceTotale(parcelles),
  });

  return { octets: await pdf.save(), pages: feuille.pages.length, nombre: parcelles.length };
}

/* -------------------------------------------------------------- le tableau */

function tableau(feuille, f, parcelles, { lieudit, total }) {
  const COLONNES = colonnes(parcelles);
  const taille = 10.5;
  const hauteur = taille * 1.85;
  const x0 = feuille.marges.gauche;
  const brut = COLONNES.reduce((s, c) => s + c.largeur, 0);
  const echelle = Math.min(1, feuille.largeur / brut);
  const large = brut * echelle;

  const bornes = [];
  let curseur = x0;
  for (const c of COLONNES) { bornes.push(curseur); curseur += c.largeur * echelle; }
  bornes.push(curseur);

  /**
   * Une ligne : le texte, puis la grille autour.
   *
   * `depuis` dit à partir de quelle colonne la grille est tracée. La ligne de
   * total s'en sert pour ne pas laisser trois cases vides encadrées à sa
   * gauche : trois cellules dessinées sur du vide se lisent comme des données
   * manquantes, alors qu'il n'y a simplement rien à y mettre.
   */
  const ligne = (valeurs, fonte, depuis = 0) => {
    const base = feuille.place(hauteur);
    const bas = base - taille * 0.5;
    const haut = bas + hauteur;

    COLONNES.forEach((c, i) => {
      const texte = String(valeurs[c.clef] ?? '');
      if (texte) {
        feuille.page.drawText(texte, {
          x: bornes[i] + 5, y: base, size: taille, font: fonte, color: NOIR,
        });
      }
    });

    const trait = (a, b) => feuille.page.drawLine({ start: a, end: b, thickness: 0.7, color: GRILLE });
    const gauche = bornes[depuis];
    trait({ x: gauche, y: haut }, { x: x0 + large, y: haut });
    trait({ x: gauche, y: bas }, { x: x0 + large, y: bas });
    for (const x of bornes.slice(depuis)) trait({ x, y: bas }, { x, y: haut });
  };

  const entete = Object.fromEntries(COLONNES.map((c) => [c.clef, c.titre]));
  ligne(entete, f.sansGras);

  for (const p of parcelles) {
    // L'en-tête se répète en haut de chaque page. On vérifie la place AVANT de
    // poser la ligne : laisser la coupure se faire seule donnerait une seconde
    // page de colonnes anonymes.
    if (feuille.y - hauteur < feuille.marges.bas) {
      feuille.nouvellePage();
      ligne(entete, f.sansGras);
    }
    ligne({
      prefixe: p.prefixe && p.prefixe !== '000' ? String(p.prefixe) : '',
      section: String(p.section || '').toUpperCase(),
      numero: String(p.numero || '').replace(/^0+(?=\d)/, ''),
      lieudit: p.lieuDit || lieudit,
      surface: hectaresAresCentiares(p.contenance) || '',
    }, f.romain);
  }

  if (total !== null && total !== undefined) {
    const depuis = COLONNES.findIndex((c) => c.clef === 'lieudit');
    ligne({ lieudit: 'Superficie totale', surface: hectaresAresCentiares(total) },
      f.sansGras, Math.max(depuis, 0));
  }
}
