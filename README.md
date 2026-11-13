# Chef d'orchestre VR

Expérience VR éducative et sensorielle pour Meta Quest : diriger un orchestre virtuel à la battue et au regard.

En ligne : https://archimede2.github.io/chef-orchestre-vr/

## Proto 1 — la battue

- Manette droite = baguette. Deux battues à vide, l'orchestre (un métronome pour l'instant) part sur la troisième.
- Le tempo suit la battue ; le panneau affiche le tempo, le décalage geste/temps et l'amplitude du geste.
- Sans battue pendant 3 temps : ralenti avec décalage, puis arrêt.
- Le pupitre regardé (orientation de la tête) s'éclaire.
- Sur ordinateur : Espace = un temps, souris = orientation de la tête.

Technique : WebXR, Three.js (chargé depuis jsDelivr), Web Audio. Aucun outil de compilation.
