// CERTIF — assemblage du document unique à imprimer
//
// Un seul PDF, un seul bouton, une seule impression. Pour UNE demande, l'ordre
// est fixe :
//
//   lettre d'accompagnement          une fois, pour l'envoi entier
//   exemplaire 1   Cerfa 13410*13 (p. 1 à 3) · annexe s'il y a lieu · plan
//   exemplaire 2   idem, à l'identique
//
// UNE lettre pour DEUX exemplaires : c'est un pli, pas deux envois. Le
// formulaire est celui qui se produit en deux exemplaires — l'article R*410-2
// pour un certificat relevant du a) de L. 410-1, ce que l'imprimé rappelle
// lui-même en page 3 — et la lettre est le courrier qui les accompagne.
//
// PLUSIEURS UNITÉS FONCIÈRES, PLUSIEURS DEMANDES. Quand les parcelles saisies
// forment plusieurs îlots d'un seul tenant, le document contient AUTANT DE
// BLOCS COMPLETS qu'il y a d'unités : chacun avec sa lettre, sa référence
// propre — 2026-0117/1, /2 — ses deux exemplaires et son plan. Ils se suivent
// dans le même fichier parce qu'on ne veut qu'une impression ; ils ne se
// mélangent pas, parce que chaque bloc commence sur une feuille neuve.
//
// Les deux exemplaires d'une même demande sont rigoureusement identiques. On ne
// marque RIEN dessus : ni « exemplaire 1 sur 2 », ni numéro de page. Une mention
// ajoutée sur un Cerfa officiel est une altération de l'imprimé. Les bornes de
// pages partent dans le courriel à l'assistante, pas sur le document.
//
// RECTO VERSO : CHAQUE BLOC COMMENCE SUR UNE FEUILLE NEUVE. La lettre, puis
// chaque exemplaire, sont complétés par une page blanche quand leur compte est
// impair. Sans cela l'impression recto verso colle le dos de la lettre au
// premier Cerfa, et la dernière page d'un exemplaire au dos du suivant — deux
// exemplaires qu'on ne peut plus séparer sans les déchirer, et, quand il y a
// plusieurs demandes, deux demandes qu'on met dans la même enveloppe.
//
// La règle est générale et non taillée sur un cas : elle vaut que le plan soit
// joint ou non, que l'annexe existe ou non, qu'il y ait une demande ou quatre.
// C'est ce qui la rend sûre — un calcul qui marche pour neuf pages et casse
// pour onze n'aurait été vérifié qu'une fois.
//
// Le Cerfa et le plan arrivent ici déjà fabriqués, en octets — ce qui permet
// d'éprouver tout l'assemblage sans gabarit ni accès réseau.

import { PDFDocument } from 'pdf-lib';
import { construireLettre } from './lettre.js';

/** L'A4 du format PDF, au centième de point. */
const A4_LARGEUR = 595.28;
const A4_HAUTEUR = 841.89;

async function nombreDePages(octets) {
  if (!octets) return 0;
  return (await PDFDocument.load(octets)).getPageCount();
}

/**
 * @param {object} o
 *   dossiers  [{demande, cerfa, annexe, plan}] — un par unité foncière.
 *             La forme à une demande ({demande, cerfa, annexe, plan} au
 *             premier niveau) reste acceptée : c'est le cas courant.
 *   images    {signature?} — paraphe déjà descellé
 *   rectoVerso  true par défaut : chaque bloc commence sur une feuille neuve
 * @returns {Promise<{octets:Uint8Array, pagination:object}>}
 */
export async function construireDossier({
  dossiers, demande, cerfa, annexe, plan, images = {}, rectoVerso = true,
}) {
  const liste = dossiers && dossiers.length
    ? dossiers
    : [{ demande, cerfa, annexe, plan }];

  liste.forEach((d, i) => {
    if (!d.cerfa) throw new Error(`le Cerfa rempli est requis (demande ${i + 1})`);
  });

  const pair = (n) => (rectoVerso && n % 2 ? n + 1 : n);
  const final = await PDFDocument.create();
  const rendus = [];

  for (const d of liste) {
    const lettre = await construireLettre(d.demande, images);
    const pagesImprime = (await nombreDePages(d.cerfa)) + (await nombreDePages(d.annexe));
    const pagesPlan = await nombreDePages(d.plan);
    const utiles = pagesImprime + pagesPlan;

    // TROIS BLOCS, TROIS FEUILLES NEUVES : la lettre, l'imprimé, le plan.
    //
    // LE PLAN N'EST PAS UNE PAGE DU FORMULAIRE. C'est une pièce jointe à la
    // demande — la seule qu'exige l'article R*410-1 — et une pièce jointe ne
    // s'imprime pas au dos du dernier feuillet de l'imprimé qu'elle accompagne.
    // Le service d'urbanisme la détache pour la verser au dossier, l'agrafe
    // ailleurs, la photocopie seule ; au verso du Cerfa, il faudrait couper.
    //
    // L'annexe des références cadastrales, elle, RESTE collée à l'imprimé :
    // c'est un feuillet du formulaire, pas une pièce jointe, et il se lit dans
    // la foulée du cadre 4.2 auquel il renvoie.
    const pagesLettre = pair(lettre.pages);
    const blocImprime = pair(pagesImprime);
    const blocPlan = pair(pagesPlan);
    const parExemplaire = blocImprime + blocPlan;

    const depart = final.getPageCount() + 1;
    await verser(final, lettre.octets);
    completer(final, pagesLettre - lettre.pages);

    for (let i = 0; i < 2; i += 1) {
      await verser(final, d.cerfa);
      if (d.annexe) await verser(final, d.annexe);
      completer(final, blocImprime - pagesImprime);
      if (d.plan) {
        await verser(final, d.plan);
        completer(final, blocPlan - pagesPlan);
      }
    }

    const debut = depart + pagesLettre;
    rendus.push({
      reference: d.demande?.reference || null,
      parcelles: (d.demande?.terrain?.parcelles || [])
        .map((p) => [p.prefixe, p.section, p.numero].filter(Boolean).join(' ')),
      de: depart,
      a: depart + pagesLettre + 2 * parExemplaire - 1,
      lettre: pagesLettre,
      parExemplaire,
      // De quoi dire à l'assistante où finit l'imprimé et où commence le plan.
      imprimeParExemplaire: blocImprime,
      planParExemplaire: blocPlan,
      utilesParExemplaire: utiles,
      blanches: (pagesLettre - lettre.pages) + 2 * (parExemplaire - utiles),
      exemplaires: [
        { de: debut, a: debut + parExemplaire - 1 },
        { de: debut + parExemplaire, a: debut + 2 * parExemplaire - 1 },
      ],
    });
  }

  const premier = rendus[0];
  const pagination = {
    // Le compte d'ensemble : c'est lui qui commande l'impression.
    total: rendus.reduce((n, d) => n + (d.a - d.de + 1), 0),
    feuilles: Math.ceil(rendus.reduce((n, d) => n + (d.a - d.de + 1), 0) / 2),
    blanches: rendus.reduce((n, d) => n + d.blanches, 0),
    rectoVerso,
    demandes: rendus.length,
    dossiers: rendus,
    // Les champs de la forme à une demande, conservés : l'écran, le courriel
    // et les essais s'y appuient, et la demande unique reste le cas courant.
    lettre: premier.lettre,
    parExemplaire: premier.parExemplaire,
    utilesParExemplaire: premier.utilesParExemplaire,
    exemplaires: premier.exemplaires,
  };

  // UN SEUL FORMAT POUR TOUT LE DOCUMENT. L'extrait du cadastre sort en
  // 595 × 842 points là où le Cerfa, la lettre et l'annexe font 595,28 × 841,89.
  // Un dixième de millimètre — invisible à l'œil, mais un pilote d'impression
  // qui voit deux formats dans un même fichier peut décider de tout ramener au
  // plus grand, et c'est ainsi qu'un pied de page se retrouve rogné.
  //
  // On ne redresse QUE ce qui est déjà de l'A4 à deux points près : une page
  // franchement plus grande, ou à l'italienne, serait coupée par un tel
  // recadrage. Mieux vaut la laisser telle quelle et qu'elle se voie.
  for (const page of final.getPages()) {
    const t = page.getSize();
    if (Math.abs(t.width - A4_LARGEUR) < 2 && Math.abs(t.height - A4_HAUTEUR) < 2
      && (t.width !== A4_LARGEUR || t.height !== A4_HAUTEUR)) {
      page.setMediaBox(0, 0, A4_LARGEUR, A4_HAUTEUR);
      page.setCropBox(0, 0, A4_LARGEUR, A4_HAUTEUR);
    }
  }

  const commune = liste[0]?.demande?.terrain?.commune?.nom || '';
  const reference = liste[0]?.demande?.reference || '';
  final.setTitle([
    rendus.length > 1 ? `Certificats d’urbanisme (${rendus.length} demandes)` : 'Certificat d’urbanisme',
    commune, reference.replace(/\/\d+$/, ''),
  ].filter(Boolean).join(' — '));
  final.setProducer('CERTIF');
  final.setCreator('CERTIF — FIDAL Notaires');

  const octets = await final.save();

  // Le compte annoncé dans le courriel doit être celui du document produit.
  // S'ils divergent, l'assistante sépare les exemplaires au mauvais endroit.
  if (final.getPageCount() !== pagination.total) {
    throw new Error(
      `pagination incohérente : ${final.getPageCount()} pages produites, ${pagination.total} annoncées`);
  }

  return { octets, pagination };
}

/** Nom de fichier : lisible dans une boîte aux lettres, triable, sans accent. */
export function nomFichier(demande, demandes = 1) {
  const commune = (demande.terrain?.commune?.nom || 'commune')
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
  const reference = (demande.reference || '').replace(/\/\d+$/, '').replace(/[^A-Za-z0-9-]+/g, '');
  return ['CU', commune, reference, demandes > 1 ? `${demandes}-demandes` : '']
    .filter(Boolean).join('_') + '.pdf';
}

/** Des pages blanches, au format de la page courante. */
function completer(destination, combien) {
  for (let i = 0; i < combien; i += 1) {
    const derniere = destination.getPages()[destination.getPageCount() - 1];
    const taille = derniere ? derniere.getSize() : { width: 595.276, height: 841.89 };
    destination.addPage([taille.width, taille.height]);
  }
}

async function verser(destination, octets) {
  const source = await PDFDocument.load(octets);
  const pages = await destination.copyPages(source, source.getPageIndices());
  pages.forEach((p) => destination.addPage(p));
}
