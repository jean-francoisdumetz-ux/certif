// CERTIF — recherche d'une adresse, pour vérifier qu'elle existe
//
// POURQUOI VÉRIFIER. L'adresse du terrain part sur le Cerfa, cadre 4.1, et le
// service instructeur s'en sert pour retrouver le bien avant même de regarder
// les références cadastrales. Une voie mal orthographiée, un numéro qui n'existe
// pas, et c'est une demande de pièce complémentaire — deux mois perdus pour un
// certificat qui en prend un.
//
// LA SOURCE. La Base Adresse Nationale (api-adresse.data.gouv.fr), service
// public, ouvert, sans clef. C'est la même base qui fait autorité pour La Poste
// et pour les SDIS. Ce qu'elle ignore n'existe pas administrativement — ou pas
// encore : les lotissements récents y arrivent avec quelques mois de retard.
//
// D'OÙ : ON NE BLOQUE PAS. La route dit ce qu'elle trouve, et dit aussi quand
// elle ne trouve rien. Le notaire garde la main pour saisir une adresse que la
// BAN ignore — un terrain nu en pleine campagne n'a souvent pas d'adresse du
// tout, et il faut bien pouvoir écrire le lieu-dit dans le champ.
//
// LE PIÈGE DES COMMUNES ASSOCIÉES, encore lui. La BAN range les adresses de
// Lomme sous Lille — code 59350 — et ne connaît pas 59355. On essaie donc le
// code de la commune, puis celui de son chef-lieu, puis sans filtre du tout en
// ajoutant le nom de la commune à la recherche. La route DIT laquelle des trois
// a répondu : un filtre qui saute sans le dire ferait proposer la rue du même
// nom dans une autre commune.

import { protege } from '../lib/verrou.js';

const API = 'https://api-adresse.data.gouv.fr/search/';

async function interroger(parametres) {
  const url = `${API}?${new URLSearchParams(parametres)}`;
  let r;
  try {
    r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'CERTIF/1.0 (FIDAL Notaires)' },
    });
  } catch (e) {
    return { panne: true, motif: `base adresse injoignable : ${e.message}` };
  }
  if (r.status === 404) return { traits: [] };
  // 400 : la BAN refuse certaines recherches (trop courtes, filtre inconnu).
  // Ce n'est pas une panne, c'est une absence de résultat pour CES paramètres.
  if (r.status === 400) return { traits: [] };
  if (!r.ok) return { panne: true, motif: `base adresse indisponible (${r.status})` };

  let corps;
  try { corps = await r.json(); }
  catch { return { panne: true, motif: 'réponse de la base adresse illisible' }; }
  return { traits: Array.isArray(corps?.features) ? corps.features : [] };
}

const forme = (t) => {
  const p = t.properties || {};
  return {
    libelle: p.label || '',
    // Ce que CERTIF reporte dans le cadre 4.1 : la ligne d'adresse SANS le code
    // postal ni la commune, qui ont leurs propres cases sur l'imprimé.
    adresse: [p.housenumber, p.street || p.name].filter(Boolean).join(' ') || p.name || '',
    numero: p.housenumber || null,
    voie: p.street || null,
    codePostal: p.postcode || null,
    commune: p.city || null,
    codeInsee: p.citycode || null,
    // « quartier » quand la BAN rattache l'adresse à une commune déléguée : la
    // seule trace de Lomme dans une réponse rangée sous Lille.
    quartier: p.district || null,
    // housenumber : un numéro précis. street : une voie sans numéro.
    // locality : un lieu-dit. municipality : la commune elle-même.
    genre: p.type || null,
    score: typeof p.score === 'number' ? Math.round(p.score * 100) / 100 : null,
  };
};

export default protege(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ erreur: 'GET attendu' });

  const q = String(req.query?.q || '').trim();
  if (q.length < 3) return res.status(400).json({ erreur: 'recherche trop courte' });

  const code = String(req.query?.code || '').trim();
  const chefLieu = String(req.query?.chefLieu || '').trim();
  const commune = String(req.query?.commune || '').trim();
  const limite = Math.min(Math.max(Number(req.query?.limite) || 8, 1), 15);

  // Trois filtres, du plus sûr au plus large. On s'arrête au premier qui rend
  // quelque chose : le filtre par code INSEE ne peut pas proposer la rue d'une
  // autre commune, la recherche libre le peut.
  const essais = [];
  if (code) essais.push({ filtre: `commune ${code}`, p: { q, citycode: code, limit: limite } });
  if (chefLieu && chefLieu !== code) {
    essais.push({ filtre: `chef-lieu ${chefLieu}`, p: { q, citycode: chefLieu, limit: limite } });
  }
  essais.push({
    filtre: commune ? `recherche libre, « ${commune} » ajouté` : 'recherche libre',
    p: { q: commune ? `${q} ${commune}` : q, limit: limite },
  });

  let panne = null;
  for (const essai of essais) {
    const r = await interroger(essai.p);
    if (r.panne) { panne = panne || r.motif; break; }
    if (r.traits.length) {
      return res.status(200).json({
        q,
        filtre: essai.filtre,
        adresses: r.traits.map(forme),
      });
    }
  }

  if (panne) return res.status(502).json({ erreur: panne });
  return res.status(200).json({ q, filtre: null, adresses: [] });
});
