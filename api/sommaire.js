// CERTIF — le sommaire du dossier, en PDF et en tableur
//
// APPELÉE APRÈS LA GÉNÉRATION, avec ce qui a RÉELLEMENT été produit. L'écran a
// bouclé sur les parties, il connaît chaque demande, sa commune, sa mairie et
// ses parcelles : il les renvoie ici pour qu'on en fasse une table. Refabriquer
// le lot de zéro pour en tirer un sommaire coûterait autant que la génération —
// et surtout, rien ne garantirait que le sommaire décrive le même document.
//
// DEUX FORMES, ET ELLES NE SERVENT PAS À LA MÊME CHOSE. Le PDF se classe au
// dossier et s'imprime tel quel ; le tableur s'annote — on y coche les
// certificats à mesure qu'ils reviennent, on y note la date de dépôt et celle du
// retour. Les deux disent la même chose, produite d'une seule source.
//
// ELLE NE FABRIQUE RIEN QUI PARTE EN MAIRIE. Ce document porte le patrimoine du
// client sur toutes ses communes : il reste à l'étude.

import { protege } from '../lib/verrou.js';
import { construireSommaire, lignesDuSommaire } from '../lib/sommaire.js';
import { construireTableur } from '../lib/tableur.js';

/**
 * Les colonnes du tableur. Fonction et non constante : le sous-dossier ne
 * s'ajoute que s'il a été saisi. Une colonne vide sur toute la hauteur d'un
 * tableau fait douter de ce qu'on aurait dû y lire — même raison que pour le
 * préfixe et le lieudit dans le sommaire PDF.
 */
const colonnesTableur = (sousDossier) => [
  { titre: 'Commune', clef: 'commune', largeur: 24 },
  { titre: 'Préfixe', clef: 'prefixe', largeur: 9 },
  { titre: 'Section', clef: 'section', largeur: 9 },
  { titre: 'N°', clef: 'numero', largeur: 8 },
  { titre: 'Lieudit', clef: 'lieudit', largeur: 28 },
  { titre: 'Contenance (m²)', clef: 'contenance', largeur: 16 },
  { titre: 'Demande', clef: 'demande', largeur: 15 },
  ...(sousDossier ? [{ titre: 'Sous-dossier Data Room', clef: 'sousDossier', largeur: 24 }] : []),
  { titre: 'Mairie destinataire', clef: 'mairie', largeur: 40 },
  // Trois colonnes vides, et c'est le but : le tableur sert à SUIVRE. Sans
  // elles, il faudrait les ajouter à la main à chaque dossier.
  { titre: 'Déposé le', clef: 'depose', largeur: 14 },
  { titre: 'Reçu le', clef: 'recu', largeur: 14 },
  { titre: 'Observations', clef: 'observations', largeur: 30 },
];

const sansAccent = (v) => String(v || '')
  .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();

export default protege(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST attendu' });

  const lot = {
    reference: String(req.body?.reference || '').trim(),
    sousDossier: String(req.body?.sousDossier || '').trim().slice(0, 120),
    date: req.body?.date ? new Date(req.body.date) : new Date(),
    demandes: Array.isArray(req.body?.demandes) ? req.body.demandes : [],
  };
  if (!lot.demandes.length) return res.status(400).json({ erreur: 'aucune demande à résumer' });

  try {
    const pdf = await construireSommaire(lot);
    const COLONNES = colonnesTableur(lot.sousDossier);
    const lignes = lignesDuSommaire(lot).map((l) => ({ ...l, sousDossier: lot.sousDossier }));
    const tableur = construireTableur({
      nom: 'Sommaire',
      colonnes: COLONNES,
      lignes: lignes.map((l) => COLONNES.map((c) => l[c.clef] ?? '')),
    });

    const base = ['CU', sansAccent(lot.reference) || 'DOSSIER', 'sommaire'].join('_');
    return res.status(200).json({
      lignes: lignes.length,
      pages: pdf.pages,
      fichiers: [
        { nom: `${base}.pdf`, type: 'application/pdf', contenu: Buffer.from(pdf.octets).toString('base64') },
        {
          nom: `${base}.xlsx`,
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          contenu: Buffer.from(tableur).toString('base64'),
        },
      ],
    });
  } catch (e) {
    console.error('[CERTIF] sommaire', e);
    return res.status(500).json({ erreur: `sommaire impossible : ${e.message}` });
  }
});
