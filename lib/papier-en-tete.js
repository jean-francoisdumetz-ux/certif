// CERTIF — le papier à en-tête de l'étude
//
// Deux images, et non le PDF du Drive. La raison est une fuite, constatée sur
// le document produit.
//
// La trame « papier en tete / trame courrier.pdf » n'est pas un modèle vierge :
// c'est un courrier réel exporté de Word. Elle porte le nom d'un collaborateur,
// une référence de dossier et l'intitulé d'une affaire cliente. La première
// version posait un rectangle blanc par-dessus le corps. À l'écran, impeccable.
// Mais un rectangle blanc ne supprime rien : les opérateurs de texte restent
// dans le flux, et `pdftotext` — comme un copier-coller, comme le logiciel
// d'une mairie qui indexe ses pièces reçues — ressortait les trois mentions
// intactes. Une lettre adressée à une mairie avec, dessous, le nom du client
// d'un autre dossier.
//
// Le masquage visuel n'est pas de la suppression. On ne garde donc que les deux
// bandes utiles, découpées et converties en images par
// outils/preparer-entete.py : plus aucun texte du courrier d'origine ne
// subsiste, et le PDF de la trame n'a pas à être déployé.
//
// Contrepartie assumée : l'adresse du pied de page n'est plus du texte
// sélectionnable. Sur un courrier destiné à être imprimé et posté, cela ne
// coûte rien — et cela vaut mieux que l'inverse.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { A4 } from './mise-en-page.js';

export const HAUT = 'entete-haut.png';
export const BAS = 'entete-bas.png';

// Hauteurs mesurées à la découpe (voir la sortie de preparer-entete.py).
// Le filet du haut tombe à 745 pt, celui du bas à 90,5 pt.
export const HAUTEUR_HAUT = 97.4;
export const HAUTEUR_BAS = 90.9;

/** Zone d'écriture, entre les deux bandes. */
export const ZONE = {
  haut: A4.hauteur - HAUTEUR_HAUT - 20,
  bas: HAUTEUR_BAS + 12,
};

const chemin = (nom) => join(process.cwd(), 'data', nom);
export const present = () => existsSync(chemin(HAUT)) && existsSync(chemin(BAS));

const cache = new Map();
function lire(nom) {
  if (!cache.has(nom)) cache.set(nom, readFileSync(chemin(nom)));
  return cache.get(nom);
}

/**
 * Prépare l'en-tête et rend une fabrique de pages à passer en `creerPage`.
 *
 * Les images sont incorporées une fois pour le document entier ; chaque page
 * ne fait que les dessiner. La fabrique doit rester synchrone — l'incorporation
 * se fait donc ici, avant.
 *
 * Rend null si les images n'ont pas été préparées : la lettre sort alors sur
 * fond blanc. Une lettre sans logo se voit ; une génération qui échoue bloque
 * un envoi.
 */
export async function feuillesEnTete(pdf) {
  if (!present()) return null;

  const haut = await pdf.embedPng(lire(HAUT));
  const bas = await pdf.embedPng(lire(BAS));

  return () => {
    const page = pdf.addPage([A4.largeur, A4.hauteur]);
    page.drawImage(haut, {
      x: 0, y: A4.hauteur - HAUTEUR_HAUT, width: A4.largeur, height: HAUTEUR_HAUT,
    });
    page.drawImage(bas, { x: 0, y: 0, width: A4.largeur, height: HAUTEUR_BAS });
    return page;
  };
}
