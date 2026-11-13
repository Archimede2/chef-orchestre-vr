#!/usr/bin/env python3
"""Convertit une partition MusicXML en « partition de jeu » JSON pour le chef d'orchestre VR.

Chaque note est placée en temps de battue (noires), pas en secondes :
c'est la baguette du joueur qui fixe le tempo.

Usage : python3 outils/convertir_musicxml.py source.musicxml sortie.json

Corrections automatiques (la source vient d'une reconnaissance de PDF) :
- chaque mesure est recalée sur son numéro (pas de décalage qui s'accumule) ;
- une mesure trop courte reçoit un silence au début ;
- ce qui dépasse la fin d'une mesure est coupé.
"""
import json
import sys
import xml.etree.ElementTree as ET

# Pupitre du jeu pour chaque partie (le chœur est laissé de côté en V1)
PUPITRES = {
    'Flauto': 'Flûtes', 'Oboe': 'Hautbois', 'Clarinetto in La': 'Clarinettes',
    'Fagotto 1': 'Bassons', 'Fagotto 2': 'Bassons', 'Corno in Fa': 'Cors',
    'Violino I': 'Violons I', 'Violino II': 'Violons II', 'Viola': 'Altos',
    'Violoncello': 'Violoncelles', 'Contrabbasso': 'Contrebasses',
}
# Sons (banque General MIDI FluidR3) : [son principal, son pizzicato]
SONS = {
    'Flûtes': ['flute', None], 'Hautbois': ['oboe', None], 'Clarinettes': ['clarinet', None],
    'Bassons': ['bassoon', None], 'Cors': ['french_horn', None],
    'Violons I': ['string_ensemble_1', None],
    'Violons II': ['string_ensemble_1', 'pizzicato_strings'],
    'Altos': ['string_ensemble_1', 'pizzicato_strings'],
    'Violoncelles': ['string_ensemble_1', 'pizzicato_strings'],
    'Contrebasses': ['string_ensemble_1', 'pizzicato_strings'],
}
NUANCES = {'ppp': 0.15, 'pp': 0.25, 'p': 0.38, 'mp': 0.5, 'mf': 0.62, 'f': 0.75,
           'ff': 0.88, 'fff': 1.0, 'sf': 0.8, 'sfz': 0.8, 'fp': 0.75}
PAS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def numero(m):
    return int(''.join(c for c in (m.get('number') or '0') if c.isdigit()) or 0)


def convertir(chemin):
    racine = ET.parse(chemin).getroot()
    noms = {sp.get('id'): (sp.findtext('part-name') or '').strip() for sp in racine.iter('score-part')}
    temps_par_mesure = 4
    nb_mesures = 0
    pupitres = {}
    rapport = []

    for partie in racine.iter('part'):
        nom = noms.get(partie.get('id'), '')
        pupitre = PUPITRES.get(nom)
        if not pupitre:
            continue
        divisions = 1
        transpo = 0
        octave_reelle = -12 if nom == 'Contrabbasso' else 0  # la contrebasse sonne une octave plus bas
        nuance = 0.38
        en_cours = {}      # liaisons : hauteur -> note
        notes = []
        corrigees = 0
        mesures = partie.findall('measure')
        for m in mesures:
            n = numero(m)
            nb_mesures = max(nb_mesures, n)
            for d in m.iter('divisions'):
                divisions = int(d.text)
            for t in m.iter('transpose'):
                transpo = int(t.findtext('chromatic') or 0) + 12 * int(t.findtext('octave-change') or 0)
            for t in m.iter('time'):
                temps_par_mesure = int(t.findtext('beats')) * 4 // int(t.findtext('beat-type'))

            # Longueur réelle de la mesure, pour repérer les mesures abîmées
            pos = fin = 0
            for el in m:
                if el.tag == 'note' and el.find('chord') is None and el.find('grace') is None:
                    pos += int(el.findtext('duration') or 0)
                elif el.tag == 'backup':
                    pos -= int(el.findtext('duration'))
                elif el.tag == 'forward':
                    pos += int(el.findtext('duration'))
                fin = max(fin, pos)
            longueur = fin / divisions
            decalage = max(0.0, temps_par_mesure - longueur)
            if abs(longueur - temps_par_mesure) > 1e-6:
                corrigees += 1

            debut_mesure = (n - 1) * temps_par_mesure
            pos = 0
            dernier_debut = 0
            for el in m:
                if el.tag == 'direction':
                    for dy in el.iter('dynamics'):
                        for c in dy:
                            if c.tag in NUANCES:
                                nuance = NUANCES[c.tag]
                elif el.tag == 'backup':
                    pos -= int(el.findtext('duration'))
                elif el.tag == 'forward':
                    pos += int(el.findtext('duration'))
                elif el.tag == 'note':
                    if el.find('grace') is not None:
                        continue
                    duree = int(el.findtext('duration') or 0)
                    accord = el.find('chord') is not None
                    debut = dernier_debut if accord else pos
                    if not accord:
                        dernier_debut = pos
                        pos += duree
                    if el.find('rest') is not None:
                        continue
                    p = el.find('pitch')
                    hauteur = (12 * (int(p.findtext('octave')) + 1) + PAS[p.findtext('step')]
                               + int(float(p.findtext('alter') or 0)) + transpo + octave_reelle)
                    t0 = debut / divisions + decalage
                    if t0 >= temps_par_mesure - 1e-6:
                        continue
                    d = min(duree / divisions, temps_par_mesure - t0)
                    liaisons = {t.get('type') for t in el.findall('tie')}
                    if 'stop' in liaisons and hauteur in en_cours:
                        en_cours[hauteur][1] = round(debut_mesure + t0 + d - en_cours[hauteur][0], 4)
                        if 'start' not in liaisons:
                            del en_cours[hauteur]
                        continue
                    note = [round(debut_mesure + t0, 4), round(d, 4), hauteur, nuance]
                    notes.append(note)
                    if 'start' in liaisons:
                        en_cours[hauteur] = note
        pup = pupitres.setdefault(pupitre, {'nom': pupitre, 'sons': SONS[pupitre], 'notes': []})
        pup['notes'].extend(notes)
        rapport.append(f'{nom:18} -> {pupitre:13} {len(mesures):3} mesures, {len(notes):4} notes, {corrigees} mesures corrigées')

    # Articulation : cordes graves et accompagnement en pizzicato sur les notes courtes
    for pup in pupitres.values():
        pup['notes'].sort()
        for note in pup['notes']:
            pizz = pup['sons'][1] is not None and note[1] <= 1.0
            note.append(1 if pizz else 0)

    return {
        'titre': 'Gabriel Fauré — Pavane, op. 50',
        'source': 'CPDL (édition Finale), reconnue automatiquement puis corrigée',
        'tempsParMesure': temps_par_mesure,
        'mesures': nb_mesures,
        'tempoIndique': 80,
        'format': '[temps, durée, hauteur MIDI, nuance 0-1, pizz 0/1] — temps et durée en noires',
        'pupitres': list(pupitres.values()),
    }, rapport


if __name__ == '__main__':
    partition, rapport = convertir(sys.argv[1])
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump(partition, f, ensure_ascii=False, separators=(',', ':'))
    print('\n'.join(rapport))
    print(f"{partition['mesures']} mesures à {partition['tempsParMesure']} temps")
