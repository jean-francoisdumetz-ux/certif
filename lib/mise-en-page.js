// CERTIF — composition typographique
//
// Petit moteur de mise en page pour les deux pièces que CERTIF fabrique
// lui-même : la page de garde et la lettre d'accompagnement. Le Cerfa et le
// plan de situation, eux, ne sont pas composés ici — ils sont importés tels
// quels dans lib/dossier-pdf.js.
//
// Pourquoi ne pas passer par du HTML et un moteur d'impression ? Parce qu'il
// faudrait embarquer Chromium dans une fonction serverless pour deux pages de
// texte. pdf-lib est déjà là pour le Cerfa ; il compose ces deux pages sans
// dépendance supplémentaire et sans démarrage à froid de plusieurs secondes.
//
// PIÈGE D'ENCODAGE, et il coûte cher parce qu'il ne se voit qu'à l'exécution :
// les polices standard du PDF sont encodées en WinAnsi. L'espace fine
// insécable (U+202F) et l'espace fine (U+2009) — que tout traitement de texte
// français insère automatiquement devant « ; » ou dans « 75 008 » — n'y
// figurent PAS, et pdf-lib lève une exception au moment de dessiner, pas au
// moment de recevoir le texte. D'où net() ci-dessous, appliqué sans exception.

import { StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const MM = 2.834645669; // points par millimètre
export const A4 = { largeur: 595.276, hauteur: 841.89 };

export const NOIR = rgb(0, 0, 0);
export const GRIS = rgb(0.42, 0.45, 0.5);
export const TRAIT = rgb(0.78, 0.8, 0.83);

/*
 * CE QUE LES POLICES DESSINENT VRAIMENT — DEUX RÉGIMES
 *
 * Constaté, pas supposé : essais/glyphes-couverture.mjs dessine chaque
 * caractère candidat seul dans une case, rend la page en image et compte
 * l'encre. Il a été passé sur les deux régimes.
 *
 *   • POLICES DE LA MAISON (Segoe UI, incorporée) : tout passe. Latin-1
 *     entier, exposants, guillemets français, œ, €, ½, ×, →. Seul U+00AD, la
 *     césure conditionnelle, ne sort pas — et c'est son rôle.
 *
 *   • REPLI sur les polices de base du format (Times, Helvetica) : U+00B2 (²),
 *     U+00B3 (³), U+00B9 (¹) et U+00B5 (µ) ne sortent PAS. Sans exception,
 *     sans avertissement : « 1 061 m² » s'imprime « 1 061 m », soit le bon
 *     chiffre avec la mauvaise unité. C'est pour cela que le filtre reste, et
 *     qu'il remplace l'exposant par un chiffre ordinaire dans ce régime.
 *
 * Refaire tourner l'essai si l'on change de police ou de version de pdf-lib.
 */
const EXTRAS = '\u20AC\u2018\u2019\u201C\u201D\u201A\u201E\u2013\u2014'
  + '\u2020\u2021\u2022\u2026\u2030\u2039\u203A'
  + '\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2122';

// Vérifiés en plus de Latin-1 sur Segoe UI : numéro, indice, fractions,
// opérateurs. Rien qui ne soit sorti à l'image.
const EXTRAS_MAISON = '\u2116\u2082\u00D7\u00F7\u2264\u2265\u2192';

const ASCII = Array.from({ length: 0x7F - 0x20 }, (_, i) => String.fromCharCode(0x20 + i));
const LATIN1 = Array.from({ length: 0x100 - 0xA0 }, (_, i) => String.fromCharCode(0xA0 + i));

// La césure conditionnelle est écartée des deux côtés : elle s'imprimerait en
// trait d'union au milieu d'un mot.
const RENDUS_MAISON = new Set([
  ...ASCII, ...LATIN1.filter((c) => c !== '\u00AD'), ...EXTRAS, ...EXTRAS_MAISON, '\n',
]);

const RENDUS_BASE = new Set([
  ...ASCII,
  ...LATIN1.filter((c) => !'\u00B2\u00B3\u00B9\u00B5\u00AD'.includes(c)),
  ...EXTRAS, '\n',
]);

const rendus = (maison) => (maison ? RENDUS_MAISON : RENDUS_BASE);

/** Substitutions de sens égal, appliquées avant tout filtrage. */
const REMPLACEMENTS = [
  [/[\u2000-\u200B\u202F\u205F\u3000]/g, ' '],  // espaces fines : absentes de WinAnsi
  [/\u00A0/g, ' '],                               // insécable → espace ordinaire
  [/[\u2010\u2011\u2012\u2015]/g, '-'],           // tirets exotiques
  [/\u00AD/g, ''],                                // césure conditionnelle : s'imprimerait
  [/'/g, '\u2019'],                               // apostrophe droite -> courbe :
  //   c'est la forme fran\u00e7aise, et elle se rend sans probl\u00e8me. La droite
  //   trahit un texte fabriqu\u00e9 par une machine, sur un courrier d'\u00e9tude.
  [/[\u2028\u2029]/g, '\n'],
  [/\r\n?/g, '\n'],
];

// Appliquées en plus quand on est retombé sur les polices de base : mieux vaut
// « 1 061 m2 », lisible et faux d'aspect, que « 1 061 m », lisible et faux de
// sens.
const REPLIS = [
  [/\u00B2/g, '2'], [/\u00B3/g, '3'], [/\u00B9/g, '1'], [/\u00B5/g, 'u'],
];

function substituer(v, maison) {
  let s = String(v);
  for (const [motif, par] of REMPLACEMENTS) s = s.replace(motif, par);
  if (!maison) for (const [motif, par] of REPLIS) s = s.replace(motif, par);
  return s;
}

/**
 * Ramène une chaîne à ce que les polices savent réellement dessiner.
 * @param {boolean} maison  true si les fontes de l'étude sont incorporées.
 */
export function net(v, maison = true) {
  if (v === null || v === undefined) return '';
  return Array.from(substituer(v, maison)).filter((c) => rendus(maison).has(c)).join('');
}

/**
 * Les caractères qu'une chaîne perdrait à l'impression.
 *
 * À appeler sur ce que saisit le notaire — une adresse, un motif — pour
 * l'avertir AVANT que le PDF ne parte, plutôt que de lui laisser découvrir un
 * mot tronqué sur le pli recommandé.
 */
export function caracteresPerdus(v, maison = true) {
  if (v === null || v === undefined) return [];
  return [...new Set(Array.from(substituer(v, maison)).filter((c) => !rendus(maison).has(c)))];
}

/*
 * SEGOE UI, LA POLICE DE LA MAISON
 *
 * Les quatre fontes viennent du poste du notaire (C:\Windows\Fonts) et sont
 * rangées dans data/polices. Elles sont incorporées en sous-ensemble : seuls
 * les caractères réellement employés voyagent dans le PDF, ce qui laisse un
 * fichier léger et reste dans les termes d'incorporation de Microsoft.
 *
 * Sans elles, on retombe sur les polices de base du format PDF — Times et
 * Helvetica. Le document sort, dans une autre allure. Une lettre qui n'est pas
 * à la charte se voit ; une génération qui échoue bloque un envoi.
 */
const POLICES = {
  romain: 'segoeui.ttf',
  romainGras: 'segoeuib.ttf',
  romainItalique: 'segoeuii.ttf',
  sans: 'segoeui.ttf',
  sansGras: 'seguisb.ttf', // demi-gras : les intitulés, sans le poids du gras
};

const SECOURS = {
  romain: StandardFonts.TimesRoman,
  romainGras: StandardFonts.TimesRomanBold,
  romainItalique: StandardFonts.TimesRomanItalic,
  sans: StandardFonts.Helvetica,
  sansGras: StandardFonts.HelveticaBold,
};

const dossierPolices = () => join(process.cwd(), 'data', 'polices');
export const polices = () => Object.values(POLICES).every((f) => existsSync(join(dossierPolices(), f)));

const octets = new Map();
function lirePolice(fichier) {
  if (!octets.has(fichier)) octets.set(fichier, readFileSync(join(dossierPolices(), fichier)));
  return octets.get(fichier);
}

export async function fontes(pdf) {
  if (!polices()) {
    const secours = {};
    for (const [role, nom] of Object.entries(SECOURS)) secours[role] = await pdf.embedFont(nom);
    secours.maison = false;
    return secours;
  }

  pdf.registerFontkit(fontkit);
  const f = { maison: true };
  // Un même fichier ne s'incorpore qu'une fois : romain et sans partagent
  // segoeui.ttf, et deux incorporations feraient deux sous-ensembles du même
  // dessin dans le fichier.
  const dejaVues = new Map();
  for (const [role, fichier] of Object.entries(POLICES)) {
    if (!dejaVues.has(fichier)) {
      dejaVues.set(fichier, await pdf.embedFont(lirePolice(fichier), { subset: true }));
    }
    f[role] = dejaVues.get(fichier);
  }
  return f;
}

/**
 * Une feuille en cours d'écriture : une page A4, un curseur qui descend.
 *
 * Le curseur est en coordonnées PDF (origine en bas à gauche), mais on ne
 * raisonne jamais dessus directement : on écrit, ça descend. La seule chose à
 * surveiller est le bas de page, et c'est fait dans place().
 */
export class Feuille {
  constructor(pdf, f, { haut = 25 * MM, bas = 22 * MM, gauche = 25 * MM, droite = 20 * MM,
    creerPage = null, paysage = false } = {}) {
    this.pdf = pdf;
    this.f = f;
    this.marges = { haut, bas, gauche, droite };
    // Le format de la feuille, et non A4 en dur : sans lui, `paysage: true` était
    // ignoré en silence — une propriété inconnue d'un objet déstructuré ne
    // proteste pas. Le sommaire se voulait à l'italienne depuis toujours et
    // sortait à la française, colonnes écrasées, son propre essai en échec.
    // Par défaut A4 portrait : aucun appelant existant ne change de rendu.
    this.format = paysage
      ? { largeur: A4.hauteur, hauteur: A4.largeur }
      : { largeur: A4.largeur, hauteur: A4.hauteur };
    this.largeur = this.format.largeur - gauche - droite;
    // D'où viennent les pages. Par défaut, des A4 blanches ; pour une lettre,
    // des exemplaires du papier à en-tête préparés d'avance. La fonction doit
    // être synchrone — tout ce qui demande un await se fait avant.
    this.creerPage = creerPage;
    this.page = null;
    this.y = 0;
    this.pages = [];
    this.nouvellePage();
  }

  nouvellePage() {
    // `creerPage` fournit ses propres pages — papier à en-tête notamment — et
    // impose donc son format : les deux options ne se combinent pas.
    this.page = this.creerPage
      ? this.creerPage()
      : this.pdf.addPage([this.format.largeur, this.format.hauteur]);
    this.pages.push(this.page);
    this.y = this.format.hauteur - this.marges.haut;
    return this.page;
  }

  /** Réserve h points ; ouvre une page si le bas est atteint. */
  place(h) {
    if (this.y - h < this.marges.bas) this.nouvellePage();
    this.y -= h;
    return this.y;
  }

  saut(mm) { this.y -= mm * MM; return this; }

  /** Découpe un paragraphe en lignes qui tiennent dans la largeur donnée. */
  lignes(texte, fonte, taille, largeur = this.largeur) {
    const sortie = [];
    for (const paragraphe of net(texte, this.f.maison !== false).split('\n')) {
      if (!paragraphe.trim()) { sortie.push(''); continue; }
      let courante = '';
      for (const mot of paragraphe.split(/ +/)) {
        const essai = courante ? `${courante} ${mot}` : mot;
        if (fonte.widthOfTextAtSize(essai, taille) <= largeur || !courante) courante = essai;
        else { sortie.push(courante); courante = mot; }
      }
      sortie.push(courante);
    }
    return sortie;
  }

  /**
   * Écrit un bloc de texte.
   * @param {object} o  fonte, taille, interligne, couleur, x, largeur,
   *                    alignement ('gauche'|'droite'|'centre'|'justifie')
   */
  texte(chaine, o = {}) {
    const fonte = o.fonte || this.f.romain;
    const taille = o.taille || 11;
    const interligne = o.interligne || taille * 1.35;
    const largeur = o.largeur || this.largeur;
    const x0 = o.x !== undefined ? o.x : this.marges.gauche;
    const couleur = o.couleur || NOIR;

    const lignes = this.lignes(chaine, fonte, taille, largeur);
    lignes.forEach((ligne, i) => {
      const y = this.place(interligne);
      if (!ligne) return;
      const l = fonte.widthOfTextAtSize(ligne, taille);
      let x = x0;
      if (o.alignement === 'droite') x = x0 + largeur - l;
      else if (o.alignement === 'centre') x = x0 + (largeur - l) / 2;

      // Justification : on écarte les espaces, on ne dilate pas les lettres.
      // Jamais la dernière ligne d'un paragraphe — elle resterait béante.
      const derniere = i === lignes.length - 1 || !lignes[i + 1];
      if (o.alignement === 'justifie' && !derniere && ligne.includes(' ')) {
        const mots = ligne.split(' ');
        const reste = largeur - mots.reduce((s, m) => s + fonte.widthOfTextAtSize(m, taille), 0);
        const blanc = reste / (mots.length - 1);
        let curseur = x0;
        for (const mot of mots) {
          this.page.drawText(mot, { x: curseur, y, size: taille, font: fonte, color: couleur });
          curseur += fonte.widthOfTextAtSize(mot, taille) + blanc;
        }
        return;
      }
      this.page.drawText(ligne, { x, y, size: taille, font: fonte, color: couleur });
    });
    return this;
  }

  /** Filet horizontal pleine largeur. */
  filet(couleur = TRAIT, epaisseur = 0.6) {
    const y = this.place(6);
    this.page.drawLine({
      start: { x: this.marges.gauche, y },
      end: { x: this.marges.gauche + this.largeur, y },
      thickness: epaisseur, color: couleur,
    });
    return this;
  }

  /** Ligne d'un tableau à deux colonnes — libellé à gauche, valeur à droite. */
  ligneTableau(libelle, valeur, { taille = 10.5, colonne = 42 * MM } = {}) {
    const gauche = this.lignes(libelle, this.f.sans, taille, colonne - 4 * MM);
    const droite = this.lignes(valeur, this.f.sansGras, taille, this.largeur - colonne);
    const hauteur = Math.max(gauche.length, droite.length) * taille * 1.3;
    const depart = this.place(hauteur);
    gauche.forEach((l, i) => this.page.drawText(l, {
      x: this.marges.gauche, y: depart + hauteur - (i + 1) * taille * 1.3 + taille * 0.3,
      size: taille, font: this.f.sans, color: GRIS,
    }));
    droite.forEach((l, i) => this.page.drawText(l, {
      x: this.marges.gauche + colonne, y: depart + hauteur - (i + 1) * taille * 1.3 + taille * 0.3,
      size: taille, font: this.f.sansGras, color: NOIR,
    }));
    return this;
  }
}
