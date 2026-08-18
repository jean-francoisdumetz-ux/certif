// CERTIF — le fichier déposé : ce qu'on y a lu, et rien de plus
//
// La route LIT et RESTITUE. Elle ne fabrique rien, n'enregistre rien, ne décide
// rien : elle rend la liste des parcelles reconnues, le compte de ce qu'elle a
// laissé de côté, et — sur demande — les lignes telles qu'elle les a
// reconstituées. L'écran affiche, le notaire coche, et c'est le report dans la
// saisie qui engage.
//
// C'est délibéré. Un relevé de propriété porte TOUTES les parcelles d'un
// propriétaire dans la commune, y compris celles qui ne sont pas vendues.
// Enchaîner l'import sur la génération produirait des certificats d'urbanisme
// sur des terrains dont personne n'a parlé.
//
//   POST /api/importer            { nom, contenu (base64) }
//   POST /api/importer?journal=1  ajoute les lignes reconstituées — c'est ce
//                                 qu'il faut regarder le jour où un relevé
//                                 d'une autre facture ne rend rien.
//
// Le fichier voyage en base64 dans le corps JSON, pour passer par le même
// verrou et le même en-tête d'autorisation que le reste. Vercel plafonne un
// corps de requête à 4,5 Mo : on refuse plus tôt, et on le dit.

import { protege } from '../lib/verrou.js';
import { importerParcelles } from '../lib/import-parcelles.js';

const MAXI = 3 * 1024 * 1024; // 3 Mo de fichier

export default protege(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST attendu' });

  const nom = String(req.body?.nom || '').slice(0, 200);
  const base64 = String(req.body?.contenu || '');
  if (!base64) return res.status(400).json({ erreur: 'aucun fichier reçu' });

  let octets;
  try { octets = Buffer.from(base64, 'base64'); }
  catch { return res.status(400).json({ erreur: 'fichier illisible (encodage)' }); }

  if (!octets.length) return res.status(400).json({ erreur: 'fichier vide' });
  if (octets.length > MAXI) {
    return res.status(413).json({
      erreur: `fichier trop lourd (${Math.round(octets.length / 1024)} ko) : 3 Mo au plus`,
    });
  }

  let r;
  try {
    r = await importerParcelles(octets, nom);
  } catch (e) {
    console.error('[CERTIF] importer', e);
    return res.status(500).json({ erreur: `lecture impossible : ${e.message}` });
  }

  if (r.erreur) return res.status(422).json({ erreur: r.erreur, fichier: r.fichier, genre: r.genre });

  return res.status(200).json({
    fichier: r.fichier,
    genre: r.genre,
    methode: r.methode,
    parcelles: r.parcelles,
    commune: r.commune,
    ignorees: r.ignorees,
    avertissements: r.avertissements,
    // Les lignes brutes ne partent que si on les demande : sur un relevé de
    // quarante parcelles elles pèsent plus que tout le reste de la réponse.
    ...(req.query?.journal ? { lignes: r.lignes.slice(0, 400) } : {}),
  });
});
