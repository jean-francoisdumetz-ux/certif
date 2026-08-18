#!/usr/bin/env python3
"""CERTIF — découpe le papier à en-tête en deux images.

POURQUOI DES IMAGES, ET PAS LE PDF DU DRIVE.

La trame « papier en tete / trame courrier.pdf » n'est pas un modèle vierge :
c'est un courrier réel exporté de Word. Elle porte le nom d'un collaborateur,
la référence d'un dossier client et l'intitulé « VENTE SUCCESSION VIGLINO SCI
LAVINA AIX LES BAINS ».

La première version de CERTIF posait un rectangle blanc par-dessus. À l'écran
c'était propre. Mais un rectangle blanc ne supprime rien : les opérateurs de
texte restent dans le flux, et `pdftotext` — comme un copier-coller, comme le
logiciel d'une mairie qui indexe ses pièces — ressortait les trois mentions
intactes. Une lettre partant à une mairie avec, dessous, le nom d'un client
d'un autre dossier.

D'où ce découpage : on ne garde que les deux bandes utiles, l'en-tête et le
pied, converties en images. Plus aucun texte du courrier d'origine ne subsiste,
et le PDF de la trame n'a pas besoin d'être déployé.

    python3 outils/preparer-entete.py [chemin/trame.pdf]

Produit data/entete-haut.png et data/entete-bas.png. À relancer seulement si
l'étude change son papier à en-tête. Demande poppler (pdftoppm) et Pillow, qui
ne sont utiles qu'ici : rien de tout cela ne tourne en production.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

RESOLUTION = 400  # points par pouce ; au-delà, le poids ne paie plus
RACINE = Path(__file__).resolve().parent.parent


def rendre(pdf: Path, dossier: Path) -> Image.Image:
    subprocess.run(
        ["pdftoppm", "-r", str(RESOLUTION), "-f", "1", "-l", "1", "-png", str(pdf), str(dossier / "p")],
        check=True,
    )
    pages = sorted(dossier.glob("p*.png"))
    if not pages:
        raise SystemExit("pdftoppm n'a rien produit")
    return Image.open(pages[0]).convert("RGB")


def filets(image: Image.Image) -> tuple[int, int]:
    """Les deux traits horizontaux, repérés par comptage de pixels sombres.

    Mesurés, pas estimés : c'est la seule façon de rester juste si l'étude
    change sa trame et déplace les filets de quelques millimètres.
    """
    gris = np.array(image.convert("L"))
    hauteur, largeur = gris.shape
    sombres = (gris < 160).sum(axis=1)
    lignes = [y for y, c in enumerate(sombres) if c > largeur * 0.5]
    if len(lignes) < 2:
        raise SystemExit(f"filets introuvables : {len(lignes)} ligne(s) horizontale(s) détectée(s)")
    return lignes[0], lignes[-1]


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else RACINE / "data" / "trame-courrier.pdf"
    if not source.exists():
        raise SystemExit(f"introuvable : {source}")

    with tempfile.TemporaryDirectory() as tmp:
        page = rendre(source, Path(tmp))
        haut, bas = filets(page)
        largeur, hauteur = page.size

        # On coupe 2 pixels SOUS le filet du haut et 2 AU-DESSUS de celui du
        # bas : les deux traits partent avec leur bande, et rien du corps ne
        # suit.
        bande_haut = page.crop((0, 0, largeur, haut + 2))
        bande_bas = page.crop((0, bas - 2, largeur, hauteur))

        cible = RACINE / "data"
        cible.mkdir(exist_ok=True)
        for nom, bande, ancre in (
            ("entete-haut.png", bande_haut, haut + 2),
            ("entete-bas.png", bande_bas, bas - 2),
        ):
            chemin = cible / nom
            bande.save(chemin, optimize=True)
            # Hauteur en points PDF, pour que le module de composition sache
            # où poser l'image sans avoir à la remesurer.
            points = bande.height * 72 / RESOLUTION
            print(f"{nom:18s} {bande.width}x{bande.height} px  "
                  f"{points:.1f} pt  {chemin.stat().st_size / 1024:.0f} ko  "
                  f"(coupe à y={ancre}px sur {hauteur})")

        print(f"\npage : {largeur}x{hauteur} px à {RESOLUTION} dpi")
        print(f"filet haut à {(hauteur - haut) * 72 / RESOLUTION:.1f} pt du bas, "
              f"filet bas à {(hauteur - bas) * 72 / RESOLUTION:.1f} pt du bas")


if __name__ == "__main__":
    main()
