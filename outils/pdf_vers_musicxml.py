#!/usr/bin/env python3
"""
pdf_vers_musicxml.py — convertit une partition PDF « numérique » en MusicXML.

Contrairement à Audiveris (qui transforme le PDF en image puis devine les notes),
ce programme lit directement ce que le logiciel de gravure a écrit dans le PDF :
chaque tête de note, silence, altération ou clé est un caractère d'une police
musicale, avec sa position exacte ; portées, hampes, barres de mesure et ligatures
sont des traits. Rien n'est deviné à partir de pixels.

Ça marche pour les PDF exportés par Finale (police Maestro) — c'est le cas de
beaucoup d'éditions de CPDL et d'IMSLP. Pour une partition scannée (une image),
il faut toujours passer par Audiveris.

Installation (une fois) :   pip3 install pdfplumber
Utilisation :               python3 pdf_vers_musicxml.py partition.pdf -o partition.musicxml

Le programme affiche un rapport : nombre de pages, de systèmes, de mesures,
et la liste des mesures dont il n'est pas sûr (à vérifier dans MuseScore).
"""
import argparse
import sys
from collections import defaultdict
from fractions import Fraction as F
from xml.sax.saxutils import escape

try:
    import pdfplumber
except ImportError:
    sys.exit("Il manque pdfplumber. Installe-le avec :  pip3 install pdfplumber")

# --------------------------------------------------------------------------- Police Maestro (Finale)
POLICES_MUSIQUE = ('Maestro',)
TETES = {'œ': 'noire', '˙': 'blanche', 'w': 'ronde'}
SILENCES = {'Œ': F(1), '‰': F(1, 2), '≈': F(1, 4), 'Ó': F(2), '∑': None}  # None = pause (mesure entière)
ALTERATIONS = {'#': 1, 'b': -1, 'n': 0, '‹': 2, 'º': -2}
CROCHETS = {'j': 1, 'J': 1, 'r': 2, 'R': 2, 'Â': 3, 'Á': 3}
CLES = {'&': 'G', '?': 'F', 'B': 'C', 'V': 'G8'}
NUANCES = {'π': 'pp', 'p': 'p', 'P': 'mp', 'F': 'mf', 'f': 'f', 'ƒ': 'ff', 'Ï': 'fff', 'ß': 'sfz'}
CHIFFRES = set('0123456789')

# Note de la ligne du bas selon la clé : (nom, octave) en degrés diatoniques
LIGNE_DU_BAS = {'G': ('E', 4), 'F': ('G', 2), 'C3': ('F', 3), 'C4': ('D', 3), 'G8': ('E', 3)}
DEGRES = 'CDEFGAB'
DEMI_TONS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
ORDRE_DIESES = 'FCGDAEB'
ORDRE_BEMOLS = 'BEADGCF'

# Instruments : mots-clés -> (nom MusicXML, transposition en demi-tons, programme MIDI)
INSTRUMENTS = [
    (['piccolo', 'ottavino'], 12, 73), (['flauto', 'flute', 'flûte', 'fl.'], 0, 74),
    (['oboe', 'hautbois', 'ob.'], 0, 69), (['corno inglese', 'cor anglais', 'english horn'], -7, 70),
    (['clarinetto in la', 'clarinet in a', 'clarinette en la', 'cl.la', 'cl. la'], -3, 72),
    (['clarinetto in si', 'clarinet in b', 'clarinette en si', 'cl.sib'], -2, 72),
    (['clarinetto', 'clarinet', 'clarinette', 'cl.'], 0, 72),
    (['fagotto', 'bassoon', 'basson', 'fg.'], 0, 71),
    (['corno in fa', 'horn in f', 'cor en fa', 'corno', 'horn', 'cor', 'cr.'], -7, 61),
    (['tromba', 'trumpet', 'trompette', 'tr.'], 0, 57), (['trombone', 'trb.'], 0, 58), (['tuba'], 0, 59),
    (['timpani', 'timbales'], 0, 48), (['arpa', 'harp', 'harpe'], 0, 47),
    (['violino', 'violin', 'violon', 'vno.', 'vl.'], 0, 41), (['viola', 'vla.', 'alto (cordes)'], 0, 42),
    (['violoncello', 'cello', 'violoncelle', 'vc.'], 0, 43),
    (['contrabbasso', 'contrebasse', 'double bass', 'cb.'], -12, 44),
    (['soprano'], 0, 54), (['alto', 'contralto'], 0, 54), (['tenore', 'tenor', 'ténor'], 0, 54),
    (['basso', 'bass', 'basse'], 0, 54),
]


def instrument(nom):
    n = nom.lower()
    for mots, transpo, prog in INSTRUMENTS:
        if any(m in n for m in mots):
            return transpo, prog
    return 0, 1


# --------------------------------------------------------------------------- Géométrie
def regrouper_traits(page):
    """Le PDF dessine les traits épais comme des paquets de traits très fins.
    On les regroupe : horizontaux, verticaux et obliques (ligatures)."""
    hor, ver, obl = defaultdict(list), defaultdict(list), defaultdict(list)
    for l in page.lines:
        (xa, ya), (xb, yb) = l['pts'][0], l['pts'][-1]
        if xa > xb:
            xa, ya, xb, yb = xb, yb, xa, ya
        if abs(ya - yb) < 0.01:
            hor[(round(xa, 1), round(xb, 1))].append(ya)
        elif abs(xa - xb) < 0.01:
            ver[(round(min(ya, yb), 1), round(max(ya, yb), 1))].append(xa)
        else:
            pente = (yb - ya) / (xb - xa)
            obl[(round(xa, 1), round(xb, 1), round(pente, 2))].append(ya)

    def paquets(valeurs):
        valeurs.sort()
        res, debut, prec = [], valeurs[0], valeurs[0]
        for v in valeurs[1:]:
            if v - prec > 0.15:
                res.append((debut, prec))
                debut = v
            prec = v
        res.append((debut, prec))
        return res

    H = [dict(x0=x0, x1=x1, y0=a, y1=b) for (x0, x1), ys in hor.items() for a, b in paquets(ys)]
    V = [dict(y0=y0, y1=y1, x0=a, x1=b) for (y0, y1), xs in ver.items() for a, b in paquets(xs)]
    O = [dict(x0=x0, x1=x1, pente=p, y0=a, y1=b) for (x0, x1, p), ys in obl.items() for a, b in paquets(ys)]
    # Polygones fermés (ligatures horizontales, liaisons)
    courbes = []
    for c in page.curves:
        pts = c['pts']
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        courbes.append(dict(x0=min(xs), x1=max(xs), y0=min(ys), y1=max(ys), pts=pts, n=len(pts)))
    return H, V, O, courbes


def trouver_portees(H):
    longues = sorted((h for h in H if h['x1'] - h['x0'] > 150), key=lambda h: h['y0'])
    lignes = [((h['y0'] + h['y1']) / 2, h) for h in longues]
    portees, i = [], 0
    while i + 4 < len(lignes):
        groupe = lignes[i:i + 5]
        ecarts = [groupe[k + 1][0] - groupe[k][0] for k in range(4)]
        if max(ecarts) - min(ecarts) < 0.3 and abs(groupe[0][1]['x0'] - groupe[4][1]['x0']) < 1:
            ys = [g[0] for g in groupe]
            portees.append(dict(lignes=ys, haut=ys[0], bas=ys[4], ecart=sum(ecarts) / 4,
                                x0=groupe[0][1]['x0'], x1=groupe[0][1]['x1']))
            i += 5
        else:
            i += 1
    return portees


# --------------------------------------------------------------------------- Lecture d'une page
def lire_page(page, num_page):
    H, V, O, courbes = regrouper_traits(page)
    portees = trouver_portees(H)
    if not portees:
        return None
    ecart = sum(p['ecart'] for p in portees) / len(portees)
    hauteur_page = page.height

    # Caractères musicaux (position de la ligne de base = centre de la tête de note)
    glyphes, textes = [], []
    taille_normale = None
    for c in page.chars:
        police = c['fontname'].split('+')[-1]
        if any(p in police for p in POLICES_MUSIQUE):
            g = dict(t=c['text'], x0=c['x0'], x1=c['x1'], x=(c['x0'] + c['x1']) / 2,
                     y=hauteur_page - c['matrix'][5], taille=c['size'])
            glyphes.append(g)
        else:
            textes.append(c)
    tailles = defaultdict(int)
    for g in glyphes:
        tailles[round(g['taille'], 1)] += 1
    taille_normale = max(tailles, key=tailles.get) if tailles else 13.3

    # Rattacher chaque élément à la portée la plus proche
    def portee_de(y, en_dessous=False):
        meilleur, d = None, 1e9
        for k, p in enumerate(portees):
            if p['haut'] - 0.5 * ecart <= y <= p['bas'] + 0.5 * ecart:
                return k
            dist = min(abs(y - p['haut']), abs(y - p['bas']))
            if en_dessous and y > p['bas']:
                dist *= 0.5  # une nuance sous une portée appartient à cette portée
            if dist < d:
                meilleur, d = k, dist
        return meilleur

    # Barres de mesure : traits verticaux allant d'une ligne du haut à une ligne du bas
    hauts = [p['haut'] for p in portees]
    bas = [p['bas'] for p in portees]
    barres = []
    hampes = []
    for v in V:
        epais = v['x1'] - v['x0']
        k_haut = next((k for k, y in enumerate(hauts) if abs(v['y0'] - y) < 0.35), None)
        k_bas = next((k for k, y in enumerate(bas) if abs(v['y1'] - y) < 0.35), None)
        if k_haut is not None and k_bas is not None and k_bas >= k_haut:
            barres.append(dict(x=(v['x0'] + v['x1']) / 2, de=k_haut, a=k_bas, epais=epais))
        elif v['y1'] - v['y0'] > 1.5 * ecart:
            hampes.append(dict(x=(v['x0'] + v['x1']) / 2, y0=v['y0'], y1=v['y1']))

    # Systèmes : portées rapprochées (un écart nettement plus grand sépare deux systèmes)
    ecarts_p = [portees[i + 1]['haut'] - portees[i]['bas'] for i in range(len(portees) - 1)]
    mediane = sorted(ecarts_p)[len(ecarts_p) // 2] if ecarts_p else 0
    systemes = [[0]]
    for i, e in enumerate(ecarts_p):
        if e > 1.8 * mediane and e > 6 * ecart:
            systemes.append([i + 1])
        else:
            systemes[-1].append(i + 1)

    # Ligatures : traits obliques ou horizontaux épais (pas les lignes de portée ni les lignes supplémentaires)
    ligatures = []
    for o in O:
        if o['y1'] - o['y0'] > 0.25 * ecart and o['x1'] - o['x0'] > 0.5 * ecart:
            ligatures.append(dict(x0=o['x0'], x1=o['x1'], ya=(o['y0'] + o['y1']) / 2, pente=o['pente']))
    for h in H:
        if h['y1'] - h['y0'] > 0.25 * ecart and 0.5 * ecart < h['x1'] - h['x0'] < 150:
            ligatures.append(dict(x0=h['x0'], x1=h['x1'], ya=(h['y0'] + h['y1']) / 2, pente=0))

    # Chiffres de n-olets (texte en italique près d'une ligature)
    nolets = []
    for c in textes:
        if c['text'] in ('3', '6') and 'Italic' in c['fontname']:
            nolets.append(dict(n=int(c['text']), x=(c['x0'] + c['x1']) / 2, y=(c['top'] + c['bottom']) / 2))

    # Noms d'instruments dans la marge gauche
    marge = min(p['x0'] for p in portees)
    noms = defaultdict(list)
    for c in textes:
        y = (c['top'] + c['bottom']) / 2
        if c['x1'] < marge - 1:
            k = portee_de(y)
            if k is not None and portees[k]['haut'] - ecart <= y <= portees[k]['bas'] + ecart:
                noms[k].append(c)
    etiquettes = {}
    for k, cs in noms.items():
        cs.sort(key=lambda c: (round(c['top']), c['x0']))
        etiquettes[k] = ''.join(c['text'] for c in cs).strip()

    return dict(page=num_page, portees=portees, ecart=ecart, systemes=systemes, barres=barres,
                hampes=hampes, ligatures=ligatures, glyphes=glyphes, courbes=courbes,
                taille_normale=taille_normale, portee_de=portee_de, nolets=nolets, etiquettes=etiquettes)


# --------------------------------------------------------------------------- Analyse d'une portée
def position(p, y, ecart):
    """Degré sur la portée : 0 = ligne du bas, 1 = interligne au-dessus, etc."""
    return round((p['bas'] - y) / (ecart / 2))


def note_depuis_degre(cle, degre):
    nom, octave = LIGNE_DU_BAS[cle]
    d = DEGRES.index(nom) + degre
    return DEGRES[d % 7], octave + d // 7


def analyser_systeme(pg, sys_portees, etat_portees, avertir):
    """Renvoie, pour chaque portée du système, la liste de ses mesures."""
    ecart = pg['ecart']
    portees = pg['portees']
    tol = 0.6 * ecart

    # Abscisses des barres de mesure du système (sauf le trait de gauche)
    x_gauche = min(portees[k]['x0'] for k in sys_portees)
    xs = sorted({round(b['x'], 1) for b in pg['barres']
                 if b['de'] in sys_portees and b['x'] > x_gauche + 3})
    barres_x = []
    for x in xs:
        if not barres_x or x - barres_x[-1] > 2:
            barres_x.append(x)
        else:
            barres_x[-1] = max(barres_x[-1], x)  # double barre : garder la dernière
    # Double barre (fine + épaisse) : un seul trait de mesure
    filtre = []
    for x in barres_x:
        if filtre and x - filtre[-1] < 3 * ecart:
            filtre[-1] = x
        else:
            filtre.append(x)
    barres_x = filtre
    if not barres_x:
        return None

    resultat = {}
    for k in sys_portees:
        p = portees[k]
        etat = etat_portees[k]
        glyphes = [g for g in pg['glyphes']
                   if pg['portee_de'](g['y'], en_dessous=g['t'] in NUANCES) == k]
        glyphes.sort(key=lambda g: g['x'])
        petite = lambda g: g['taille'] < pg['taille_normale'] * 0.85

        # Clés (début de système et changements)
        cles = []
        for g in glyphes:
            if g['t'] in CLES and not (g['t'] == 'B' and g['taille'] < pg['taille_normale'] * 0.6):
                cle = CLES[g['t']]
                if cle == 'C':
                    pos = position(p, g['y'], ecart)
                    cle = 'C4' if pos >= 5 else 'C3'
                cles.append((g['x'], cle))
        if cles:
            etat['cle'] = cles[0][1]
        cle_debut_x = cles[0][0] if cles else x_gauche

        tetes = [g for g in glyphes if g['t'] in TETES and not petite(g)]
        silences = [g for g in glyphes if g['t'] in SILENCES and not petite(g)]
        alterations = [g for g in glyphes if g['t'] in ALTERATIONS and not petite(g)]
        points = [g for g in glyphes if g['t'] == '.']
        crochets = [g for g in glyphes if g['t'] in CROCHETS]
        nuances = [g for g in glyphes if g['t'] in NUANCES]
        x_premiere = min([g['x0'] for g in tetes + silences] or [barres_x[0]])

        # Armure : altérations entre la clé et le premier événement, sans note à leur droite
        armure = []
        for a in alterations:
            if cle_debut_x < a['x'] < min(x_premiere, barres_x[0]) and a['t'] in '#b':
                voisine = any(0 < t['x0'] - a['x1'] < 2.5 * ecart and abs(t['y'] - a['y']) < 0.4 * ecart
                              for t in tetes)
                if not voisine:
                    armure.append(a)
        if armure:
            n = len(armure)
            etat['armure'] = n if armure[0]['t'] == '#' else -n
        # Chiffrage
        for g in glyphes:
            if g['x'] < x_premiere and g['t'] == 'c':
                etat['chiffrage'] = (4, 4)
            elif g['x'] < x_premiere and g['t'] == '¢':
                etat['chiffrage'] = (2, 2)
        chiffres = sorted([g for g in glyphes if g['t'] in CHIFFRES and g['x'] < x_premiere and not petite(g)],
                          key=lambda g: g['y'])
        if len(chiffres) >= 2:
            etat['chiffrage'] = (int(chiffres[0]['t']), int(chiffres[-1]['t']))

        # Hampes de la portée
        hampes = [h for h in pg['hampes'] if p['haut'] - 4 * ecart < (h['y0'] + h['y1']) / 2 < p['bas'] + 4 * ecart
                  and h['x'] > x_gauche]

        # Accords : têtes + hampe + ligatures/crochets -> durée
        evenements = []
        utilisees = set()
        for t in tetes:
            if id(t) in utilisees:
                continue
            if t['t'] == 'ronde':
                pass
            groupe = [t]
            hampe = None
            if TETES[t['t']] != 'ronde':
                cand = [h for h in hampes if (abs(h['x'] - t['x1']) < 0.6 or abs(h['x'] - t['x0']) < 0.6)
                        and h['y0'] - tol < t['y'] < h['y1'] + tol]
                if cand:
                    hampe = min(cand, key=lambda h: min(abs(h['x'] - t['x1']), abs(h['x'] - t['x0'])))
            if hampe:
                groupe = [u for u in tetes if (abs(hampe['x'] - u['x1']) < 0.6 or abs(hampe['x'] - u['x0']) < 0.6)
                          and hampe['y0'] - tol < u['y'] < hampe['y1'] + tol and u['t'] == t['t']
                          and id(u) not in utilisees]
                if t not in groupe:
                    groupe.append(t)
            else:
                groupe = [u for u in tetes if abs(u['x'] - t['x']) < 0.5 and u['t'] == t['t']]
            for u in groupe:
                utilisees.add(id(u))
            type_ = TETES[t['t']]
            if type_ == 'ronde':
                duree = F(4)
            elif type_ == 'blanche':
                duree = F(2)
            else:
                duree = F(1)
                niveaux = 0
                if hampe:
                    vers_haut = hampe['y0'] < t['y'] - 0.5 * ecart
                    bout = hampe['y0'] if vers_haut else hampe['y1']
                    poutre = None
                    for L in pg['ligatures']:
                        if L['x0'] - 0.8 <= hampe['x'] <= L['x1'] + 0.8:
                            yl = L['ya'] + L['pente'] * (hampe['x'] - L['x0'])
                            if hampe['y0'] - 0.4 * ecart <= yl <= hampe['y1'] + 0.4 * ecart \
                                    and abs(yl - bout) < 2.6 * ecart:
                                niveaux += 1
                                if poutre is None or L['x1'] - L['x0'] > poutre['x1'] - poutre['x0']:
                                    poutre = L
                    t['poutre'] = id(poutre) if poutre else None
                    if niveaux == 0:
                        for c in crochets:
                            if abs(c['x0'] - hampe['x']) < 1.2 * ecart and abs(c['y'] - bout) < 2.5 * ecart:
                                niveaux = max(niveaux, CROCHETS[c['t']])
                    # n-olet ?
                    for n in pg['nolets']:
                        if pg['portee_de'](n['y']) != k:
                            continue
                        lig = [L for L in pg['ligatures'] if L['x0'] - 0.8 <= hampe['x'] <= L['x1'] + 0.8
                               and L['x0'] - 2 <= n['x'] <= L['x1'] + 2]
                        if lig and min(abs(n['y'] - (L['ya'])) for L in lig) < 2.5 * ecart:
                            duree *= F(2, 3)
                            break
                duree /= 2 ** niveaux
            # Points de prolongation
            x_droite = max(u['x1'] for u in groupe)
            n_points = 0
            for d in points:
                if x_droite - 0.2 < d['x0'] < x_droite + 1.6 * ecart and \
                        any(abs(d['y'] - u['y']) < 0.6 * ecart for u in groupe):
                    n_points += 1
            n_points = min(n_points, 2) if n_points and len(groupe) == 1 else min(n_points, 1)
            if n_points == 1:
                duree *= F(3, 2)
            elif n_points == 2:
                duree *= F(7, 4)
            if hampe:
                vers_le_haut = hampe['y0'] < min(u['y'] for u in groupe) - 0.5 * ecart
            else:  # sans hampe : on se fie à la position sur la portée
                vers_le_haut = min(u['y'] for u in groupe) < p['lignes'][2]
            evenements.append(dict(x=min(u['x'] for u in groupe), duree=duree, tetes=groupe,
                                   hampe=hampe, type='note', haut=vers_le_haut))

        for s in silences:
            valeur = SILENCES[s['t']]
            point = any(s['x1'] - 0.2 < d['x0'] < s['x1'] + 1.5 * ecart and abs(d['y'] - s['y']) < 1.2 * ecart
                        for d in points)
            if valeur is not None and point:
                valeur *= F(3, 2)
            evenements.append(dict(x=s['x'], duree=valeur, type='silence',
                                   haut=s['y'] < p['lignes'][2] - 0.6 * ecart if s['t'] != '∑' else None,
                                   bas=s['y'] > p['lignes'][2] + 0.6 * ecart))

        # Hauteurs : clé + armure + altérations accidentelles (valables jusqu'à la barre)
        bornes = [x_gauche] + barres_x
        notes_x = sorted((e for e in evenements if e['type'] == 'note'), key=lambda e: e['x'])
        alter_mesure, mesure_courante = {}, -1
        for e in notes_x:
            i_m = next((i for i in range(len(barres_x)) if bornes[i] < e['x'] < bornes[i + 1]), -1)
            if i_m != mesure_courante:
                alter_mesure, mesure_courante = {}, i_m
            cle = etat['cle']
            for x, c in cles:
                if x < e['x']:
                    cle = c
            for t in e['tetes']:
                degre = position(p, t['y'], ecart)
                step, octave = note_depuis_degre(cle, degre)
                acc = [a for a in alterations if 0 < t['x0'] - a['x1'] < 3 * ecart and abs(a['y'] - t['y']) < 0.4 * ecart
                       and not any(a['x1'] < u['x0'] < t['x0'] - 0.3 for u in tetes if abs(u['y'] - t['y']) < 0.4 * ecart)]
                if acc:
                    alter = ALTERATIONS[max(acc, key=lambda a: a['x'])['t']]
                    alter_mesure[(step, octave)] = alter
                elif (step, octave) in alter_mesure:
                    alter = alter_mesure[(step, octave)]
                else:
                    n = etat['armure']
                    alter = 1 if n > 0 and step in ORDRE_DIESES[:n] else -1 if n < 0 and step in ORDRE_BEMOLS[:-n] else 0
                t['hauteur'] = (step, octave, alter)
                t['degre'] = degre
                # Liaison de prolongation : une courbe part juste à droite de la tête
                for c in pg['courbes']:
                    if c['n'] < 2 or c['x1'] - c['x0'] < 1.5 * ecart:
                        continue
                    if t['x1'] - 1.5 < c['x0'] < t['x1'] + 1.3 * ecart and \
                            abs((c['y0'] + c['y1']) / 2 - t['y']) < 1.3 * ecart and (c['y1'] - c['y0']) < 1.5 * ecart:
                        fin = [u for u in tetes if abs(position(p, u['y'], ecart) - degre) == 0
                               and c['x1'] - 1.3 * ecart < u['x0'] < c['x1'] + 1.5]
                        if fin or c['x1'] > barres_x[-1] - 3:
                            t['lie_debut'] = True
                            break

        # Découpage en mesures
        mesures = []
        for i in range(len(barres_x)):
            a, b = bornes[i], bornes[i + 1]
            evts = sorted((e for e in evenements if a < e['x'] < b), key=lambda e: e['x'])
            nuances_m = [(g['x'], NUANCES[g['t']]) for g in nuances if a < g['x'] < b]
            mesures.append(dict(evenements=evts, nuances=nuances_m, x0=a, x1=b,
                                cle=etat['cle'], armure=etat['armure'], chiffrage=etat['chiffrage']))
            # changement de clé en cours de système
            for x, c in cles[1:]:
                if a < x < b:
                    etat['cle'] = c
        resultat[k] = dict(mesures=mesures, alterations=alterations)
    return resultat, barres_x


def calculer_temps(mesure, longueur):
    """Place les événements dans le temps. Renvoie True si la mesure tombe juste."""
    if _placer(mesure, mesure['evenements'], longueur):
        return True
    # Triolets sans chiffre : groupes de 3 croches sous la même ligature
    groupes = defaultdict(list)
    for e in mesure['evenements']:
        if e['type'] == 'note' and e['duree'] == F(1, 2) and e['tetes'][0].get('poutre'):
            groupes[e['tetes'][0]['poutre']].append(e)
    trios = [g for g in groupes.values() if len(g) == 3]
    if trios:
        avant = {id(e): e['duree'] for g in trios for e in g}
        for g in trios:
            for e in g:
                e['duree'] = F(1, 3)
        if _placer(mesure, mesure['evenements'], longueur):
            return True
        for g in trios:
            for e in g:
                e['duree'] = avant[id(e)]
    # Deux voix sur la même portée : hampes vers le haut / vers le bas
    evts = mesure['evenements']
    haut = [e for e in evts if (e['type'] == 'note' and e['haut'] is not False)
            or (e['type'] == 'silence' and e.get('haut'))]
    bas = [e for e in evts if (e['type'] == 'note' and e['haut'] is False)
           or (e['type'] == 'silence' and e.get('bas'))]
    milieu = [e for e in evts if e['type'] == 'silence' and not e.get('haut') and not e.get('bas')]
    if haut and bas:
        for essai_haut, essai_bas in ((haut + milieu, bas), (haut, bas + milieu), (haut, bas)):
            a, b = dict(mesure), dict(mesure)
            if _placer(a, essai_haut, longueur) and _placer(b, essai_bas, longueur):
                mesure['places'] = a['places'] + b['places']
                return True
    _placer(mesure, evts, longueur)
    return False


def _placer(mesure, evts, longueur):
    evts = sorted(evts, key=lambda e: e['x'])
    if any(e['duree'] is None for e in evts):  # pause : mesure entière
        mesure['places'] = []
        return True
    colonnes = []
    for e in evts:
        if colonnes and abs(e['x'] - colonnes[-1][0]) < 1.2:
            colonnes[-1][1].append(e)
        else:
            colonnes.append([e['x'], [e]])
    t = F(0)
    places = []
    for x, groupe in colonnes:
        for e in groupe:
            places.append((t, e))
        t += min(e['duree'] for e in groupe)
    fin = max([t0 + e['duree'] for t0, e in places] or [F(0)])
    mesure['places'] = places
    return fin == longueur


# --------------------------------------------------------------------------- Programme principal
def convertir(chemin_pdf, chemin_xml, verbeux=False):
    pdf = pdfplumber.open(chemin_pdf)
    pages = []
    for i, page in enumerate(pdf.pages):
        pg = lire_page(page, i + 1)
        if pg:
            pages.append(pg)
    if not pages:
        sys.exit("Aucune portée trouvée : ce PDF est sans doute une image scannée (utilise Audiveris).")
    if not any(g for pg in pages for g in pg['glyphes']):
        sys.exit("Aucune police musicale Maestro trouvée : ce PDF n'a pas été exporté par Finale.")

    n_portees = len(pages[0]['systemes'][0])
    noms = [pages[0]['etiquettes'].get(k, f'Portée {k + 1}') for k in range(n_portees)]
    print(f"{len(pdf.pages)} pages, {n_portees} portées par système :")
    for k, n in enumerate(noms):
        print(f"   {k + 1:2}. {n}")

    etat_portees = [dict(cle='G', armure=0, chiffrage=(4, 4)) for _ in range(n_portees)]
    parties = [[] for _ in range(n_portees)]
    douteuses = []
    num_mesure = 0
    for pg in pages:
        for sp in pg['systemes']:
            if len(sp) != n_portees:
                print(f"  ! page {pg['page']} : système de {len(sp)} portées ignoré (attendu {n_portees})")
                continue
            etats = {k: etat_portees[j] for j, k in enumerate(sp)}
            r = analyser_systeme(pg, sp, etats, douteuses)
            if not r:
                continue
            res, barres_x = r
            n_mes = len(barres_x)
            # Carte abscisse -> temps du système, construite à partir des portées qui tombent juste
            cartes = [defaultdict(list) for _ in range(n_mes)]
            justes = {}
            for j, k in enumerate(sp):
                for i, m in enumerate(res[k]['mesures']):
                    num, den = m['chiffrage']
                    longueur = F(num * 4, den)
                    ok = calculer_temps(m, longueur)
                    justes[(k, i)] = ok
                    if ok:
                        for t0, e in m['places']:
                            cartes[i][round(e['x'])].append(t0)
            for i in range(n_mes):
                carte = sorted((x, max(set(v), key=v.count)) for x, v in cartes[i].items())
                cartes[i] = carte
            for j, k in enumerate(sp):
                for i, m in enumerate(res[k]['mesures']):
                    num, den = m['chiffrage']
                    longueur = F(num * 4, den)
                    if not justes[(k, i)] and cartes[i]:
                        # Recaler sur les autres portées : chaque événement prend le temps de la colonne
                        places = []
                        for e in m['evenements']:
                            if e['duree'] is None:
                                continue
                            x = e['x']
                            proche = min(cartes[i], key=lambda c: abs(c[0] - x))
                            if abs(proche[0] - x) <= 2.5:
                                t0 = proche[1]
                            else:  # interpolation entre deux colonnes connues
                                av = [c for c in cartes[i] if c[0] < x]
                                ap = [c for c in cartes[i] if c[0] > x]
                                if av and ap:
                                    (xa, ta), (xb, tb) = av[-1], ap[0]
                                    t0 = ta + (tb - ta) * F(round((x - xa) / (xb - xa) * 12), 12)
                                else:
                                    t0 = av[-1][1] if av else F(0)
                            places.append((t0, e))
                        m['places'] = places
                        douteuses.append((num_mesure + i + 1, noms[j], pg['page']))
                    elif not justes[(k, i)]:
                        douteuses.append((num_mesure + i + 1, noms[j], pg['page']))
                    m['longueur'] = longueur
                    m['juste'] = justes[(k, i)]
                    parties[j].append(m)
            num_mesure += n_mes

    # Liaisons de prolongation : relier chaque tête liée à la même hauteur dans la note suivante
    for mesures in parties:
        suite = []
        for m in mesures:
            for t0, e in sorted(m.get('places', []), key=lambda p: p[0]):
                if e['type'] == 'note':
                    suite.append(e)
        for i, e in enumerate(suite):
            for t in e['tetes']:
                if not t.get('lie_debut'):
                    continue
                suivante = suite[i + 1] if i + 1 < len(suite) else None
                cible = None
                if suivante:
                    cible = next((u for u in suivante['tetes'] if u['hauteur'][:2] == t['hauteur'][:2]), None)
                if cible:
                    cible['lie_fin'] = True
                    cible['hauteur'] = t['hauteur']
                else:
                    t['lie_debut'] = False
    ecrire_musicxml(chemin_xml, noms, parties, pages)
    print(f"\n{num_mesure} mesures écrites dans {chemin_xml}")
    if douteuses:
        print(f"\n{len(douteuses)} mesures à vérifier (durée totale incorrecte, recalées sur les autres portées) :")
        par_portee = defaultdict(list)
        for num, nom, page in douteuses:
            par_portee[nom].append(f"{num} (p.{page})")
        for nom, liste in par_portee.items():
            print(f"   {nom} : {', '.join(liste)}")
    else:
        print("Toutes les mesures tombent juste.")
    return num_mesure, douteuses


# --------------------------------------------------------------------------- Écriture MusicXML
DIVISIONS = 48
TYPES = [(F(4), 'whole'), (F(2), 'half'), (F(1), 'quarter'), (F(1, 2), 'eighth'),
         (F(1, 4), '16th'), (F(1, 8), '32nd'), (F(1, 16), '64th')]


def type_note(duree):
    for points, facteur in ((0, F(1)), (1, F(3, 2)), (2, F(7, 4))):
        for d, nom in TYPES:
            if d * facteur == duree:
                return nom, points, None
    for d, nom in TYPES:  # triolets
        if d * F(2, 3) == duree:
            return nom, 0, (3, 2)
    return 'quarter', 0, None


def ecrire_musicxml(chemin, noms, parties, pages):
    ecart_ref = pages[0]['ecart']
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
           '"http://www.musicxml.org/dtds/partwise.dtd">',
           '<score-partwise version="4.0">',
           '<identification><encoding><software>pdf_vers_musicxml.py (lecture vectorielle)</software>'
           '</encoding></identification>', '<part-list>']
    for j, nom in enumerate(noms):
        transpo, prog = instrument(nom)
        out += [f'<score-part id="P{j + 1}"><part-name>{escape(nom)}</part-name>',
                f'<score-instrument id="P{j + 1}-I1"><instrument-name>{escape(nom)}</instrument-name></score-instrument>',
                f'<midi-instrument id="P{j + 1}-I1"><midi-channel>{j % 16 + 1}</midi-channel>'
                f'<midi-program>{prog}</midi-program></midi-instrument></score-part>']
    out.append('</part-list>')

    for j, (nom, mesures) in enumerate(zip(noms, parties)):
        transpo, _ = instrument(nom)
        out.append(f'<part id="P{j + 1}">')
        cle_prec = armure_prec = chiffrage_prec = None
        tenues = {}  # liaisons ouvertes : hauteur -> True
        for n, m in enumerate(mesures):
            out.append(f'<measure number="{n + 1}">')
            attrs = []
            if n == 0:
                attrs.append(f'<divisions>{DIVISIONS}</divisions>')
            if m['armure'] != armure_prec:
                attrs.append(f'<key><fifths>{m["armure"]}</fifths></key>')
            if m['chiffrage'] != chiffrage_prec:
                attrs.append(f'<time><beats>{m["chiffrage"][0]}</beats><beat-type>{m["chiffrage"][1]}</beat-type></time>')
            if m['cle'] != cle_prec:
                signe, ligne, octave = {'G': ('G', 2, 0), 'F': ('F', 4, 0), 'C3': ('C', 3, 0),
                                        'C4': ('C', 4, 0), 'G8': ('G', 2, -1)}[m['cle']]
                attrs.append(f'<clef><sign>{signe}</sign><line>{ligne}</line>'
                             + (f'<clef-octave-change>{octave}</clef-octave-change>' if octave else '') + '</clef>')
            if n == 0 and transpo:
                diat = {-3: -2, -2: -1, -7: -4, 12: 7, -12: -7}.get(transpo, 0)
                oct_ch = 0
                chrom = transpo
                if abs(transpo) == 12:
                    chrom, diat, oct_ch = 0, 0, transpo // 12
                attrs.append(f'<transpose><diatonic>{diat}</diatonic><chromatic>{chrom}</chromatic>'
                             + (f'<octave-change>{oct_ch}</octave-change>' if oct_ch else '') + '</transpose>')
            if attrs:
                out.append('<attributes>' + ''.join(attrs) + '</attributes>')
            cle_prec, armure_prec, chiffrage_prec = m['cle'], m['armure'], m['chiffrage']

            longueur = m['longueur']
            places = m.get('places', [])
            if not places:
                out.append(f'<note><rest measure="yes"/><duration>{int(longueur * DIVISIONS)}</duration>'
                           f'<voice>1</voice></note>')
                out.append('</measure>')
                continue

            # Répartir en voix : une voix reprend dès qu'elle est libre
            voix = []  # liste de listes (t0, e)
            for t0, e in sorted(places, key=lambda p: (p[0], p[1]['x'])):
                t0 = min(t0, longueur)
                d = min(e['duree'], longueur - t0)
                if d <= 0:
                    continue
                for v in voix:
                    if v[-1][0] + v[-1][2] <= t0:
                        v.append((t0, e, d))
                        break
                else:
                    voix.append([(t0, e, d)])
            nuances = sorted(m['nuances'])
            for iv, v in enumerate(voix[:4]):
                if iv > 0:
                    out.append(f'<backup><duration>{int(longueur * DIVISIONS)}</duration></backup>')
                t = F(0)
                for t0, e, d in v:
                    if t0 > t:
                        out.append(f'<forward><duration>{int((t0 - t) * DIVISIONS)}</duration><voice>{iv + 1}</voice></forward>')
                    if iv == 0:
                        while nuances and nuances[0][0] <= e['x'] + 3:
                            out.append(f'<direction placement="below"><direction-type><dynamics><{nuances[0][1]}/>'
                                       f'</dynamics></direction-type></direction>')
                            nuances.pop(0)
                    dur = int(round(d * DIVISIONS))
                    typ, pts, tuplet = type_note(e['duree'])
                    ext = ''.join('<dot/>' for _ in range(pts))
                    if tuplet:
                        ext += f'<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
                    if e['type'] == 'silence':
                        out.append(f'<note><rest/><duration>{dur}</duration><voice>{iv + 1}</voice><type>{typ}</type>{ext}</note>')
                    else:
                        for it, tete in enumerate(sorted(e['tetes'], key=lambda u: -u['y'])):
                            step, octave, alter = tete['hauteur']
                            accord = '<chord/>' if it else ''
                            liens = ''
                            notations = ''
                            if tete.get('lie_fin'):
                                liens += '<tie type="stop"/>'
                                notations += '<tied type="stop"/>'
                            if tete.get('lie_debut'):
                                liens += '<tie type="start"/>'
                                notations += '<tied type="start"/>'
                            alt = f'<alter>{alter}</alter>' if alter else ''
                            out.append(f'<note>{accord}<pitch><step>{step}</step>{alt}<octave>{octave}</octave></pitch>'
                                       f'<duration>{dur}</duration>{liens}<voice>{iv + 1}</voice><type>{typ}</type>{ext}'
                                       + (f'<notations>{notations}</notations>' if notations else '') + '</note>')
                    t = t0 + d
                if t < longueur and iv == 0:
                    out.append(f'<forward><duration>{int((longueur - t) * DIVISIONS)}</duration><voice>1</voice></forward>')
                    t = longueur
            out.append('</measure>')
        out.append('</part>')
    out.append('</score-partwise>')
    with open(chemin, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description="Convertit une partition PDF exportée par Finale en MusicXML.")
    ap.add_argument('pdf')
    ap.add_argument('-o', '--sortie', help='fichier MusicXML (par défaut : même nom que le PDF)')
    args = ap.parse_args()
    sortie = args.sortie or args.pdf.rsplit('.', 1)[0] + '.musicxml'
    convertir(args.pdf, sortie)
