# Chef d'orchestre VR

Expérience VR éducative et sensorielle pour Meta Quest : diriger un orchestre virtuel à la battue et au regard.

En ligne : https://archimede2.github.io/chef-orchestre-vr/

## Proto 2 — la Pavane de Fauré

- Manette droite = baguette. Deux battues à vide, l'orchestre part sur la troisième et suit le tempo.
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
- Conversion MusicXML -> partition de jeu faite dans le navigateur (portage JS de convertir_musicxml.py).
- Plus tard : sortie MIDI vers Logic et les instruments virtuels.

## Fichiers

- `main.js` : scène, battue, regard, logique du chef.
- `orchestre.js` : chargement des sons et lecture de la partition.
- `lecteur.html` + `lecteur.js` : lecteur de partition (voir ci-dessus).
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
