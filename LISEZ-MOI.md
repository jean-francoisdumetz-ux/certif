# CERTIF — demandes de certificat d'urbanisme d'information

Le frère de MATRICE, pour le CU du a) de l'article L. 410-1. Un écran de
saisie, un bouton qui produit **un seul PDF** prêt à imprimer, un second qui
dépose dans Outlook un **brouillon** portant ce PDF et les consignes d'envoi.

## Ce que produit le bouton

    page 1        lettre d'accompagnement, sur le papier à en-tête de l'étude
    exemplaire 1  Cerfa 13410*13 (p. 1 à 3) · annexe s'il y a lieu · plan
    exemplaire 2  idem, à l'identique

Une lettre pour deux exemplaires : c'est un pli, pas deux envois. R*410-2 exige
deux exemplaires pour un certificat d'information, ce que l'imprimé rappelle
lui-même en page 3.

Les **consignes d'impression et d'affranchissement ne sont pas dans le PDF** :
elles vivent dans le corps du courriel. Une feuille de consignes internes posée
en tête du document, c'est une feuille qu'on oublie de retirer avant de fermer
l'enveloppe.

## Le plan de situation

Seule pièce exigée à l'appui de la demande (R*410-1). Il est joint à chaque
exemplaire, après le Cerfa. C'est **l'extrait de plan cadastral officiel de la
DGFiP, avec la parcelle colorisée**.

1. **PAINT** rend l'extrait — `GET paint-blue.vercel.app/api/extrait` — et
   l'emprise employée dans l'en-tête `X-Paint-Bbox`.
2. **CERTIF y pose le liseré carmin lui-même** (`lib/colorier.js`). PAINT, à
   l'écran, colorise par OCR des étiquettes de coordonnées, parce qu'il ne sait
   pas d'avance comment le service a composé la page. CERTIF le sait : c'est lui
   qui a demandé l'extrait. Une règle de trois suffit.
3. **En repli seulement**, une carte de tuiles sur fond cadastral IGN
   (`lib/plan-situation.js`), si le SCPC ne répond pas. Elle se dit à l'écran.

`CERTIF_PLAN_VOIE` règle l'ordre : `paint` (défaut), `carte`, `paint-seul`.

### Le cadre a été mesuré, pas supposé

Sur un extrait réel de Saint-Omer AV 168 au 1/2000, le 18 août 2026 :

- les étiquettes 1648000 et 1648200 sont centrées à 146,70 et 430,14 pt, soit
  **283,44 pt pour 200 m** — exactement 100 mm de papier au 1/2000, donc
  l'échelle demandée a bien été servie ;
- le cadre dessiné va de 33,8 à 559,4 pt en abscisse et de 33,0 à 602,7 pt en
  ordonnée, soit 185,4 × 201,0 mm ;
- `MAP_SIZES` de PAINT annonce 195,5 × 211,0 : **MAPBBOX déborde donc le cadre
  dessiné de 5 mm de papier sur chacun des quatre côtés.**

`node essais/colorier.mjs` rejoue la mesure sur le fichier et vérifie que la
règle replace les quatre étiquettes : **écart maximal 0,025 pt, soit 1,7 cm au
sol**. Reste à confirmer que le cadre est le même à une autre échelle — un
second extrait au 1/1000 suffirait.

### Trois choses héritées

- **La zone conique ne se déduit pas de la latitude.** PAINT l'a démontré à
  Boue : 49,93° arrondit à 50, mais le service sert du CC49, 889 km plus bas.
  CERTIF lit donc la zone sur l'ordonnée de l'emprise rendue —
  Y₀ = (zone − 41) × 10⁶ + 200 000 — au lieu de la deviner.
- **Le repli d'échelle du SCPC est muet**, et REDPAR l'a mesuré le 28/07/2026 :
  une demande à 1/10000 est servie à 1/1000 sans un mot. Échelles honorées :
  1000, 1250, 1500, 2000, 2500, 4000, 5000. CERTIF n'en retient que le haut
  (`CERTIF_PLAN_ECHELLES`).
- **Le préfixe.** Le PCI range les parcelles de Lomme sous Lille avec le préfixe
  355 ; interroger avec 59355 ne rend rien. CERTIF essaie les combinaisons dans
  un ordre raisonné et dit laquelle a répondu.

Diagnostic : `POST /api/plan?journal=1`, ou le bouton « Pourquoi le plan
manque » de l'écran.

## L'unité foncière

**Une demande de certificat par unité foncière.** Deux parcelles qui ne se
touchent pas en forment deux — deux Cerfa, deux plis, deux délais. Les réunir
sur un seul imprimé expose au refus, ou pire à un certificat qui ne couvre
qu'une partie du terrain sans que rien ne le signale avant l'acte.

Définition : CE 27 juin 2005, *Chambon*, n° 264667 — « un îlot de propriété
d'un seul tenant, composé d'une ou plusieurs parcelles contiguës appartenant à
un même propriétaire ». **Deux** conditions.

**CERTIF n'en vérifie qu'une.** Le plan cadastral donne les contours, jamais les
propriétaires — ceux-là sont dans la matrice, et c'est ce que MATRICE va
chercher. Le regroupement est donc une proposition géométrique, et l'écran le
dit à chaque fois.

| Constat | Conduite |
|---|---|
| Plusieurs îlots séparés, contours connus | **Une demande par îlot**, dans le même PDF : références `/1`, `/2`, chacune avec sa lettre, son annexe, son plan et ses deux exemplaires |
| Un seul îlot | Une demande, avec la réserve sur le propriétaire |
| Contour manquant ou cadastre muet | Une seule demande, avec l'avertissement — une panne du cadastre n'arrête pas les envois de l'étude, et on ne découpe que sur un CONSTAT |
| Contour manquant **et** plusieurs îlots constatés | La parcelle sans contour est **écartée** de toutes les demandes et nommée : on ne peut pas deviner à quel îlot la rattacher |

Le compte est annoncé partout : à l'écran (« 2 demandes produites »), dans le
nom du fichier (`CU_LOMME_2026-0117_2-demandes.pdf`), dans l'objet du courriel
et dans les consignes à l'assistante, qui donnent les bornes de pages de chaque
demande. **Un pli recommandé par demande** : un avis de réception unique pour
deux demandes ferait courir un seul justificatif sur deux délais distincts.

Tolérance de contiguïté : 50 cm (`lib/unite-fonciere.js`). Elle absorbe les
arrondis de numérisation sans jamais rapprocher deux parcelles séparées par une
sente. Éprouvée hors ligne sur le bord commun, le coin commun, la jonction en T
et l'écart d'un mètre : `node essais/unite-fonciere.mjs`.

Écran : `POST /api/unites`, relancé tout seul une seconde après la dernière
frappe, et seulement si les références ont changé — chaque vérification coûte
jusqu'à quatre interrogations du cadastre par parcelle.

## Plusieurs communes

Un certificat d'urbanisme se demande à la mairie du lieu du terrain : **deux
communes, ce sont deux mairies, deux plis, deux délais qui courent séparément.**
Rien ne se mutualise — pas même la lettre, qui s'adresse à « Monsieur le Maire »
de telle commune.

L'écran porte donc **un bloc par commune**, qui se déroule : sa commune, son
adresse de terrain, ses parcelles, sa mairie. Le bouton « + ajouter une commune »
en crée un ; un fichier déposé en crée autant que de communes lues.

**Deux découpages, dans cet ordre** : d'abord la commune, puis l'unité foncière à
l'intérieur de chacune. Trois communes dont l'une compte deux îlots donnent
quatre demandes, quatre lettres, quatre plis — et un seul PDF à imprimer.

Références : `15151/1-1`, `/1-2`, `/2-1` — le premier chiffre est la commune, le
second l'unité foncière. Une seule commune garde la forme courte `/1`, `/2` ; une
seule demande garde la référence nue.

Le courriel à l'assistante donne, pour chaque demande, ses bornes de pages **et
l'adresse de sa mairie**, en clair dans l'étape. Les blocs postaux sont repris en
fin de message, un par commune.

## Importer une liste de parcelles

Colonne de droite de l'écran : on y dépose un fichier, `POST /api/importer` le
lit, l'écran affiche ce qui a été reconnu, on coche, on reporte.

| Format | Lecture |
|---|---|
| `.xlsx` | L'archive XML lue directement (`fflate`) — pas de bibliothèque de tableur, rien qui interprète une formule |
| plusieurs fichiers | Déposés ensemble : trois relevés, trois communes, trois blocs |
| `.csv` | Séparateur détecté sur le fichier entier, guillemets respectés |
| `.pdf` (relevé de propriété, « M1 ») | `pdfjs-dist` rend les mots avec leurs coordonnées ; CERTIF les regroupe par ordonnée pour reconstituer les lignes |

Une colonne **Commune** (ou **Code INSEE**) suffit à faire naître un bloc par
commune, dans l'ordre d'apparition du fichier. Sans elle, il n'y a qu'un groupe,
et sa commune reste à choisir — l'import ne prétend pas connaître ce qu'il n'a
pas lu.

La clef de lecture est la paire **section + numéro côte à côte** : c'est la
seule chose stable d'un relevé à l'autre. Un en-tête reconnu (Section, N°,
Préfixe, Contenance, Lieudit) l'emporte quand il y en a un.

**La contenance n'est prise que si elle est écrite en hectares-ares-centiares**
(« 00 08 42 »), la forme du relevé. Un nombre isolé sur une ligne de M1 peut
être un code Rivoli, un revenu cadastral ou une année : dans le doute, rien —
et l'écran le dit. Une contenance fausse au dossier vaut moins qu'une absente.

**Rien n'est enchaîné.** Un relevé porte toutes les parcelles d'un propriétaire
dans la commune, souvent bien plus que celles qui sont vendues : l'import
propose, le notaire coche, le report remplace la saisie. Les scans ne sont pas
lus — c'est dit explicitement plutôt que de rendre une liste vide.

Diagnostic : le bouton « Ce que CERTIF a lu » (`POST /api/importer?journal=1`)
rend les lignes telles qu'elles ont été reconstituées. C'est ce qu'il faut
regarder le jour où un relevé d'une autre facture ne rend rien.

Éprouvé hors ligne sur trois pièces (`node essais/import.mjs`) : un tableur avec
en-tête et ligne de total, un csv sans en-tête, et un relevé de propriété
reconstitué — colonnes, contenances en ha-a-ca, doublon bâti/non bâti compris.
Cet essai vérifie la mécanique, **pas** que la mise en page réelle de la DGFiP
soit celle-là : le premier vrai relevé déposé sera l'épreuve véritable.

## L'adresse du terrain

Cherchée dans la **Base Adresse Nationale** (`api-adresse.data.gouv.fr`, ouvert,
sans clef) et **limitée à la commune retenue** : sans ce filtre, « 12 rue de la
Gare » proposerait les milliers de rues de la Gare de France.

Le piège des communes associées, encore : la BAN range les adresses de Lomme
sous Lille et ne connaît pas 59355. `GET /api/adresses` essaie le code de la
commune, puis celui du chef-lieu, puis sans filtre en ajoutant le nom de la
commune — et **dit** lequel a répondu.

Rien n'est imposé : le champ reste libre, parce qu'un terrain nu n'a souvent pas
d'adresse. La différence entre « vérifiée » et « saisie à la main » est écrite
sous le champ. Le champ *lieu-dit* distinct a été retiré — il faisait saisir deux
fois la même chose et partait dans une case du Cerfa que personne ne relisait.

## Déploiement

### Fichiers à déposer dans `data/`

| Fichier | Origine |
|---|---|
| `cerfa_13410-13.pdf` | https://www.formulaires.service-public.gouv.fr/gf/cerfa_13410.do |
| `entete-haut.png`, `entete-bas.png` | produits par `outils/preparer-entete.py` |
| `polices/segoeui.ttf`, `segoeuib.ttf`, `segoeuii.ttf`, `seguisb.ttf` | `C:\Windows\Fonts` |
| `signature/` | recopié de MATRICE — signature Outlook et ses images |

Le PDF du papier à en-tête (`trame courrier.pdf` du Drive) **n'est pas déployé** :
c'est un courrier réel, portant un nom de collaborateur et une référence
d'affaire cliente. Seules les deux bandes découpées le sont.

### Variables d'environnement (Vercel)

    CERTIF_OFFICE_NOM                 FIDAL Notaires
    CERTIF_OFFICE_ADRESSE             3 place de la Madeleine
    CERTIF_OFFICE_CP                  75008
    CERTIF_OFFICE_COMMUNE             Paris
    CERTIF_OFFICE_SIGNATAIRE          Jean-François DUMETZ
    CERTIF_OFFICE_QUALITE             Notaire associé
    CERTIF_OFFICE_FORME               SELAS
    CERTIF_OFFICE_SIRET               33102277200023
    CERTIF_OFFICE_COURRIEL            accueil@fidal.notaires.fr
    CERTIF_OFFICE_TELEPHONE           01 44 51 01 23
    CERTIF_OFFICE_SIGNATAIRE_COURRIEL jean-francois.dumetz@fidal.notaires.fr

    AZURE_TENANT_ID                   (les mêmes que MATRICE)
    AZURE_CLIENT_ID
    AZURE_CLIENT_SECRET
    CERTIF_SIGNATURE_SCELLEE          (le même bloc que MATRICE, recopié)
    CERTIF_BOITE_SERVICE              (facultatif, régime application)
    CERTIF_MOT_DE_PASSE               (facultatif, mode recette)

Chaque variable `CERTIF_*` retombe sur son équivalent `MATRICE_*` si elle est
absente : même étude, même annuaire, et deux saisies de la même valeur, c'est
l'occasion qu'elles divergent.

### Entra

CERTIF **réutilise l'inscription d'application de MATRICE**. Une seule chose à
faire dans le portail : ajouter l'adresse de CERTIF aux **URI de redirection
SPA** de l'inscription existante. Une seconde inscription voudrait dire un
second secret à faire tourner et un second consentement à obtenir.

## Les essais

    node essais/bout-en-bout.mjs        la chaîne complète, refus compris
    node essais/geo.mjs                 projection, échelle, tuiles
    node essais/plan.mjs                la mise en page du plan, sources simulées
    node essais/apercu.js               un PDF d'exemple à regarder
    node essais/glyphes-couverture.mjs  ce que les polices dessinent vraiment

Aucun ne demande le réseau ni de serveur. Ce qui ne peut pas s'éprouver hors
ligne — l'appel à PAINT, le cadastre, les tuiles — se vérifie par
`/api/plan?journal=1`, qui rend le motif plutôt que de le laisser deviner.

## Ce qui a été constaté, et pas supposé

- Les polices de base du format PDF **ne dessinent pas l'exposant deux** :
  « 1 061 m² » s'imprimait « 1 061 m ». Avec Segoe UI incorporée, tout passe
  sauf la césure conditionnelle. Vérifié en dessinant chaque caractère seul et
  en comptant l'encre.
- Un rectangle blanc posé sur du texte **ne le supprime pas** : `pdftotext`
  ressortait le nom d'un client d'un autre dossier sous la lettre. D'où les
  bandes en images.
- Deux champs de l'en-tête du Cerfa sont posés **par-dessus** le cartouche
  imprimé : à l'aplatissement, le numéro sortait dédoublé.
- Les noms des 86 champs du Cerfa ont été **énumérés sur le fichier**, jamais
  devinés.
