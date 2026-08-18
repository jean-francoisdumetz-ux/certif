// CERTIF — la lettre d'accompagnement
//
// UNE SEULE lettre pour les deux exemplaires : c'est un envoi, pas deux. La
// mairie reçoit un pli contenant une lettre et deux exemplaires identiques de
// la demande — ce que R*410-2 appelle « établie en deux exemplaires », et que
// l'imprimé rappelle lui-même en page 3.
//
// Elle se compose SUR le papier à en-tête de l'étude (lib/papier-en-tete.js),
// dont le pied de page porte déjà l'adresse, le téléphone et le site. Le
// courrier ne les répète donc pas : deux identités sur la même feuille, c'est
// une de trop, et c'est celle qui divergera.
//
// Les consignes d'impression et d'affranchissement ne sont PAS ici : elles
// vivent dans le corps du courriel adressé à l'assistante (lib/consignes.js).
// Le PDF ne contient que ce qui part réellement.

import { PDFDocument } from 'pdf-lib';
import { Feuille, fontes, MM, GRIS, A4 } from './mise-en-page.js';
import { dateLongue, adressePostale } from './format.js';
import { feuillesEnTete, ZONE } from './papier-en-tete.js';

// Marges relevées sur la trame du Drive : le corps commence à 85 pt du bord
// gauche, la colonne de droite (date, destinataire) à 317 pt.
const GAUCHE = 85;
const COLONNE_DROITE = 317;

// Le corps de la lettre est en 11 points, la taille que l'étude emploie dans
// Word. L'interligne suit : 15 points, soit l'interligne simple de Word à
// cette taille. Le bloc « Dossier suivi par » et la qualité du signataire
// restent en 10 — ce sont des mentions de service, pas du texte de lettre.
const CORPS = 11;
const INTERLIGNE = 15;

/**
 * « Me » pour Maître, dans le bloc « Dossier suivi par ».
 *
 * Pas dans le bloc de signature : la qualité y figure déjà en dessous, et
 * « Me Jean-François DUMETZ / Notaire associé » dirait deux fois la même chose.
 * Le test évite d'ajouter un titre à quelqu'un qui l'a déjà.
 */
const maitre = (nom) => (nom && !/^(Me|Ma[iî]tre)\b/i.test(nom.trim()) ? `Me ${nom}` : nom);

/**
 * Objet de la lettre — sans désignation du bien, et c'est délibéré.
 *
 * Le corps dit « un bien situé sur le territoire de votre commune » : porter
 * l'adresse en objet contredirait cette réserve, et surtout ferait cohabiter
 * deux désignations du terrain sur le même pli — celle de la lettre et celle
 * du Cerfa. Deux endroits où dire la même chose, c'est un endroit de trop pour
 * se tromper, et l'erreur porterait sur l'identification du bien.
 *
 * Le rapprochement se fait par la référence de dossier, qui figure dans le
 * bloc « Dossier suivi par ».
 */
export const objet = () => "demande de certificat d'urbanisme d'information";

export async function construireLettre(d, images = {}) {
  const pdf = await PDFDocument.create();
  const f = await fontes(pdf);
  const enTete = await feuillesEnTete(pdf);

  const feuille = new Feuille(pdf, f, {
    gauche: GAUCHE,
    droite: A4.largeur - GAUCHE - 425, // colonne de texte de 425 pt
    haut: A4.hauteur - (enTete ? ZONE.haut : 745),
    bas: enTete ? ZONE.bas : 92,
    creerPage: enTete,
  });

  const o = d.office;
  const largeurDroite = A4.largeur - COLONNE_DROITE - 60;

  // Destinataire d'abord, en haut de la colonne de droite : c'est la zone que
  // découpe la fenêtre de l'enveloppe, et rien d'autre ne doit y figurer.
  feuille.texte(adressePostale({
    destinataire: 'Monsieur le Maire',
    nom: d.mairie?.nom || `Mairie de ${d.terrain?.commune?.nom || ''}`,
    adresse: d.mairie?.adresse,
    complement: d.mairie?.complement,
    codePostal: d.mairie?.codePostal,
    commune: d.mairie?.commune || d.terrain?.commune?.nom,
  }), { taille: 11, interligne: 14, x: COLONNE_DROITE, largeur: largeurDroite });

  // Deux ou trois lignes sous l'adresse : le lieu et la date, dans la même
  // colonne de droite.
  feuille.saut(11);
  feuille.texte(`Paris, le ${dateLongue(d.date)}`,
    { taille: 11, x: COLONNE_DROITE, largeur: largeurDroite });

  // Puis, deux ou trois lignes sous la date, le bloc « Dossier suivi par », à
  // gauche. Il descend en cascade — adresse, date, suivi — et non en vis-à-vis :
  // c'est l'ordre dans lequel on lit une lettre.
  feuille.saut(11);
  feuille.texte(['Dossier suivi par', maitre(o.signataire), o.signataireCourriel, d.reference]
    .filter(Boolean).join('\n'), { taille: 10, interligne: 13, couleur: GRIS });

  feuille.saut(10);
  feuille.texte(`Objet : ${objet()}`, { fonte: f.romainGras, taille: 11 });

  feuille.saut(9);
  feuille.texte('Monsieur le Maire,', { taille: CORPS });
  feuille.saut(5);

  // Le texte est celui du notaire, mot pour mot. Seule correction subsistante :
  // « je me tiens » et non « je tiens ». La formule finale est la sienne, dans
  // sa dernière rédaction ; le remerciement du retour est conservé en tête,
  // faute d'instruction de l'ôter.
  const corps = [
    `Je vous prie de bien vouloir trouver ci-joint, en deux exemplaires, une demande de `
    + `certificat d'urbanisme d'information portant sur un bien situé sur le territoire de `
    + `votre commune.`,

    `Je me tiens à votre disposition pour toute demande d'information complémentaire qui `
    + `pourrait vous être nécessaire.`,

    `Vous remerciant par avance de votre retour, je vous assure, Monsieur le Maire, de mon `
    + `profond respect.`,
  ];

  for (const paragraphe of corps) {
    feuille.texte(paragraphe, { taille: CORPS, interligne: INTERLIGNE, alignement: 'justifie' });
    feuille.saut(4);
  }

  // Le nom d'abord, le paraphe dessous : c'est l'usage du notaire, et cela se
  // lit comme un acte — on sait qui signe avant de voir la signature.
  feuille.saut(6);
  feuille.texte(o.signataire, { fonte: f.romainGras, taille: 11, x: COLONNE_DROITE, largeur: largeurDroite });
  if (o.qualite) {
    feuille.texte(o.qualite, { taille: 10, couleur: GRIS, x: COLONNE_DROITE, largeur: largeurDroite });
  }

  // Le paraphe scellé s'il a été ouvert, sinon rien — et l'absence se voit, ce
  // qui vaut mieux qu'un cartouche « signé » sans signature.
  feuille.saut(2);
  if (images.signature) {
    const img = await pdf.embedPng(
      typeof images.signature === 'string' ? Buffer.from(images.signature, 'base64') : images.signature);
    const largeur = Math.min(52 * MM, largeurDroite);
    const hauteur = Math.min(largeur * (img.height / img.width), 28 * MM);
    const y = feuille.place(hauteur + 4);
    feuille.page.drawImage(img, { x: COLONNE_DROITE, y, width: largeur, height: hauteur });
  } else {
    feuille.saut(15);
  }

  // La mention d'annexe : sous la signature, alignée à gauche sur le texte,
  // comme le veut l'usage épistolaire. Elle n'apparaît que s'il y a une
  // annexe — annoncer une pièce absente vaut mieux que rien, mais l'inverse
  // ferait chercher au service une feuille qui n'existe pas.
  if ((d.terrain?.parcelles || []).length > 3) {
    feuille.saut(8);
    feuille.texte('Annexe : liste des parcelles objet de la présente demande', { taille: CORPS });
  }

  return { octets: await pdf.save(), pages: feuille.pages.length };
}
