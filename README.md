# Chef d'orchestre VR

Expérience VR éducative et sensorielle pour Meta Quest : diriger un orchestre virtuel à la battue et au regard.

En ligne : https://archimede2.github.io/chef-orchestre-vr/

## Proto 2 — la Pavane de Fauré

- Manette droite = baguette. Deux battues à vide, l'orchestre part sur la troisième et suit le tempo.
- Amplitude du geste = nuance générale ; le pupitre regardé (orientation de la tête) joue plus fort.
- Sans battue pendant 3 temps : ralenti désordonné, puis arrêt ; reprise au début de la mesure interrompue.
- Son spatialisé : chaque pupitre sonne depuis sa place.
- Sur ordinateur : Espace = un temps, souris = orientation de la tête.

## Fichiers

- `main.js` : scène, battue, regard, logique du chef.
- `orchestre.js` : chargement des sons et lecture de la partition.
- `partitions/pavane.json` : partition de jeu (notes en temps de battue).
- `outils/convertir_musicxml.py` : conversion MusicXML -> partition de jeu.
  `python3 outils/convertir_musicxml.py partitions/sources/faure-pavane.musicxml partitions/pavane.json`
- `partitions/sources/` : MusicXML (reconnu depuis le PDF) et PDF d'origine (CPDL).

Sons : FluidR3 GM (Frank Wen, CC BY 3.0), via midi-js-soundfonts (Benjamin Gleitzman).
Technique : WebXR, Three.js (jsDelivr), Web Audio. Aucun outil de compilation.
