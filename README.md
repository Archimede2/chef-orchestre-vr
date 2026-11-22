# Chef d'orchestre VR

Expérience VR éducative et sensorielle pour Meta Quest : diriger un orchestre virtuel à la battue et au regard.

En ligne : https://archimede2.github.io/chef-orchestre-vr/

## Proto 2 — la Pavane de Fauré

- Manette droite = baguette. Deux battues à vide, l'orchestre part sur la troisième et suit le tempo.
- **La battue épouse le chiffrage** lu en tête de partition (voir plus bas).
- **Un cercle de la baguette coupe l'orchestre**, comme le geste de fin d'un chef.
- Amplitude du geste = nuance générale ; le pupitre regardé (orientation de la tête) joue plus fort.
- Sans battue pendant 3 temps : ralenti désordonné, puis arrêt ; reprise au début de la mesure interrompue.
- Son spatialisé : chaque pupitre sonne depuis sa place.
- Sur ordinateur : Espace = un temps, souris = orientation de la tête.
- Mise au point : l'iPhone peut servir de baguette (bouton sur la page, puis `baguette.html` sur l'iPhone, liaison WebRTC via PeerJS).

## Lecteur pour compositeurs et arrangeurs (`lecteur.html`)

Version sans 3D, pensée pour le Mac : https://archimede2.github.io/chef-orchestre-vr/lecteur.html

- Ouvre n'importe quel MusicXML (glisser-déposer) ; la Pavane se charge par défaut.
- Partition affichée et qui défile (OpenSheetMusicDisplay), curseur sur la mesure jouée.
- Battue : Espace, webcam (MediaPipe, main droite = battue, main gauche = nuance) ou iPhone (baguette.html).
- Solo / muet par pupitre ; réglage « avance » pour compenser le retard de la caméra.
- **Unité de battue** d'après le chiffrage, ou imposée à la main dans le panneau de droite.
- **Frise en haut de la partition** : cliquer ou glisser pour aller à n'importe quelle mesure
  (fonctionne aussi sans partition affichée, pour un MIDI).
- **Cercle de la main droite = coupure** (webcam seulement : l'iPhone n'envoie que les temps).
- Conversion MusicXML -> partition de jeu faite dans le navigateur (portage JS de convertir_musicxml.py).
- **Fichiers MIDI (.mid) lus directement** (`midi.js`) : pas de partition affichée, mais c'est la bonne voie
  pour les grosses œuvres — un MIDI de quelques centaines de Ko remplace un MusicXML de dizaines de Mo.
  Les ticks MIDI se comptent déjà en fractions de noire, donc la battue pilote le tempo sans conversion.
  Le canal 10 (percussions GM) est créé en muet.
- Au-delà de 6 Mo de MusicXML, la partition n'est plus affichée mais la lecture continue.
- Plus tard : sortie MIDI vers Logic et les instruments virtuels.

## Métrique : à quoi correspond une battue

`metrique.js` lit le chiffrage en tête de partition et en déduit ce que vaut une battue.
Tout le reste du programme compte en noires ; seule l'unité de battue change.

| Chiffrage | Unité de battue | Battues par mesure |
| --- | --- | --- |
| 4/4, 3/4, 2/4, 5/4 | noire | 4, 3, 2, 5 |
| 2/2, 3/2 | blanche | 2, 3 |
| 6/8, 9/8, 12/8 | noire pointée | 2, 3, 4 |
| 6/16, 9/16 | croche pointée | 2, 3 |
| 3/8, 5/8, 7/8 | croche | 3, 5, 7 |

Les changements de mesure en cours de morceau sont suivis (MusicXML et MIDI) : la battue
change d'unité au passage, en gardant la même pulsation. Les mesures irrégulières (5/8, 7/8)
sont battues croche par croche, alors qu'un vrai chef les groupe (2+3, 3+2) : à imposer à la
main pour l'instant. `outils/convertir_musicxml.py` suppose, lui, un chiffrage constant.

## Couper l'orchestre : le geste circulaire

`cercle.js` surveille la pointe de la baguette (VR) ou la main de la battue (webcam). Il garde
une fenêtre glissante des dernières positions et mesure l'angle balayé autour de leur centre :
une battue descend puis remonte, donc la somme signée reste proche de zéro, tandis qu'un cercle
l'accumule. Deux seuils : à mi-tour les temps cessent d'être comptés (le geste n'est plus une
battue), au tour complet l'orchestre se tait et reprendra au début de la mesure interrompue.

Garde-fou : la fenêtre se cale sur la durée de la mesure en cours, donc le cercle doit toujours
être bouclé nettement plus vite qu'une mesure. Sans cela, une battue à 3 temps ronde et rapide
finirait par boucler un tour par mesure et couperait toute seule.

## Fichiers

- `main.js` : scène, battue, regard, logique du chef.
- `orchestre.js` : chargement des sons et lecture de la partition.
- `lecteur.html` + `lecteur.js` : lecteur de partition (voir ci-dessus).
- `midi.js` : lecture d'un fichier MIDI vers le même format de partition de jeu.
- `metrique.js` : chiffrage -> unité de battue.
- `cercle.js` : détection du geste circulaire de coupure.
- `partitions/pavane.json` : partition de jeu (notes en temps de battue).
- `outils/pdf_vers_musicxml.py` : lit une partition PDF exportée par Finale et écrit le MusicXML.
- `outils/convertir_musicxml.py` : conversion MusicXML -> partition de jeu.
- `partitions/sources/` : PDF d'origine (CPDL) et MusicXML lu dans le PDF.

## Ajouter une partition (sur Mac)

```
pip3 install pdfplumber
python3 outils/pdf_vers_musicxml.py partition.pdf -o partition.musicxml
python3 outils/convertir_musicxml.py partition.musicxml partitions/ma-partition.json
```

`pdf_vers_musicxml.py` ne devine rien à partir d'une image : il lit les caractères de la police
musicale (Maestro) et les traits enregistrés dans le PDF. Il fonctionne avec les PDF exportés par
Finale, pas avec les partitions scannées (pour celles-là, Audiveris). Il affiche à la fin les mesures
dont la durée ne tombe pas juste, à vérifier dans MuseScore.

Sons : FluidR3 GM (Frank Wen, CC BY 3.0), via midi-js-soundfonts (Benjamin Gleitzman).
Technique : WebXR, Three.js (jsDelivr), Web Audio. Aucun outil de compilation.
