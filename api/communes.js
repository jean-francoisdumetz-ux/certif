// CERTIF — recherche d'une commune, pour l'écran de saisie
//
// Reprise telle quelle de MATRICE : le notaire cherche lui-même et choisit,
// plutôt que de laisser l'outil deviner. Les deux annuaires sont interrogés,
// car les communes ASSOCIÉES et DÉLÉGUÉES — LOMME, rattachée à Lille — ne
// figurent pas dans le premier, alors que le cadastre les distingue et que les
// parcelles y sont référencées sous leur propre nom.
//
// Elle ne touche à rien : ni base, ni écriture, ni état.

import { protege } from '../lib/verrou.js';

const API = 'https://geo.api.gouv.fr/communes';
const API_ASSOCIEES = 'https://geo.api.gouv.fr/communes_associees_deleguees';
const CODE = /^(?:\d{5}|2[AB]\d{3})$/i;

async function interroger(url) {
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'CERTIF/1.0 (FIDAL Notaires)' },
    });
    if (r.status === 404) return [];
    if (!r.ok) return null;
    const brut = await r.json();
    return Array.isArray(brut) ? brut : [brut].filter(Boolean);
  } catch { return null; }
}

const forme = (c) => ({
  code: c.code,
  nom: c.nom,
  // Le chef-lieu d'une commune associée ou déléguée. Le cadastre range les
  // parcelles de Lomme sous Lille — 59350 — avec le préfixe 355 ; sans ce
  // code, le plan de situation ne les retrouve pas.
  chefLieu: c.chefLieu || null,
  // UNE COMMUNE PEUT AVOIR PLUSIEURS CODES POSTAUX, et le premier de la liste
  // n'est pas forcément le bon : Villeneuve-d'Ascq en compte quatre, dont des
  // CEDEX. On rend le premier ET la liste entière — à l'écran de dire qu'il y
  // en a d'autres plutôt que de laisser partir un imprimé au mauvais bureau.
  codePostal: Array.isArray(c.codesPostaux) ? c.codesPostaux[0] : null,
  codesPostaux: Array.isArray(c.codesPostaux) ? c.codesPostaux : [],
  departement: [
    c.departement ? `${c.departement.nom} (${c.departement.code})` : null,
    c.type === 'commune-associee' ? 'commune associée' : null,
    c.type === 'commune-deleguee' ? 'commune déléguée' : null,
  ].filter(Boolean).join(', ') || null,
});

export default protege(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ erreur: 'GET attendu' });

  const q = String(req.query?.q || '').trim();
  if (q.length < 2) return res.status(400).json({ erreur: 'recherche trop courte' });

  const parCode = CODE.test(q);
  const code = q.toUpperCase();
  const champs = 'code,nom,departement,codesPostaux';

  const [communes, associees] = await Promise.all([
    interroger(parCode
      ? `${API}/${encodeURIComponent(code)}?fields=${champs}`
      : `${API}?nom=${encodeURIComponent(q)}&fields=${champs}&boost=population&limit=25`),
    interroger(parCode
      ? `${API_ASSOCIEES}?code=${encodeURIComponent(code)}&fields=code,nom,chefLieu,type,departement`
      : `${API_ASSOCIEES}?nom=${encodeURIComponent(q)}&fields=code,nom,chefLieu,type,departement&limit=15`),
  ]);

  if (communes === null && associees === null) {
    return res.status(502).json({ erreur: 'annuaire des communes indisponible' });
  }

  const vues = new Set();
  const liste = [...(communes || []), ...(associees || [])]
    .filter((c) => c && c.code && !vues.has(c.code) && vues.add(c.code));

  return res.status(200).json({ q, communes: liste.map(forme) });
});
