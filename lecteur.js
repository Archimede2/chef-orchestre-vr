// Lecteur de partition pour compositeurs et arrangeurs (version Mac, sans 3D).
// MusicXML en glisser-déposer -> partition qui défile (OpenSheetMusicDisplay),
// battue par Espace, webcam (MediaPipe, 2 mains) ou iPhone (baguette.html).
// Même logique de chef que le jeu VR : levée, suivi du tempo, ralenti, arrêt.

import { Orchestre } from './orchestre.js?v=5';
import { lireMIDI, sonGM } from './midi.js?v=2';
import { uniteDeBattue, chiffrageA, nomUnite, decrireChiffrage, UNITES_MANUELLES } from './metrique.js?v=1';
import { DetecteurCercle } from './cercle.js?v=1';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- Réglages du chef
const REG = {
  intervalleMin: 0.25,     // s minimum entre deux temps
  intervalleMaxLevee: 2.0, // s : au-delà, la levée recommence
  tempsLevee: 2,           // battues à vide ; départ sur la suivante
  suiviTempo: 0.5,
  suiviPhase: 0.5,
  tempsSansBattue: 3,      // temps sans battue avant le ralenti
  tempsRalenti: 3,         // temps de ralenti avant l'arrêt
};

// ---------------------------------------------------------------- Conversion MusicXML -> partition de jeu
// Portage JavaScript de outils/convertir_musicxml.py, généralisé à toute partition :
// notes par pupitre en temps de battue (noires), nuances, liaisons, pizz/arco par indication.
const NUANCES = { ppp: 0.15, pp: 0.25, p: 0.38, mp: 0.5, mf: 0.62, f: 0.75, ff: 0.88, fff: 1.0, sf: 0.8, sfz: 0.8, fp: 0.75 };
const PAS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CORDES = new Set(['violin', 'viola', 'cello', 'contrabass', 'string_ensemble_1', 'string_ensemble_2', 'tremolo_strings']);
const MOTS_SONS = [
  [/picc|ottavino/i, 'piccolo'], [/fl[uû]te|flauto|\bfl\b/i, 'flute'],
  [/anglais|english|inglese/i, 'english_horn'], [/hautbois|oboe|\bob\b/i, 'oboe'],
  [/clar/i, 'clarinet'], [/basson|fagot|bassoon/i, 'bassoon'],
  [/tromp|tromba/i, 'trumpet'], [/trombone/i, 'trombone'], [/tuba/i, 'tuba'],
  [/\bcor\b|corno|horn/i, 'french_horn'], [/timbale|timpani/i, 'timpani'],
  [/harpe|\bharp\b|arpa/i, 'orchestral_harp'],
  [/violoncel|cello|\bvc\b/i, 'cello'], [/contreb|contrabb|double bass|\bcb\b/i, 'contrabass'],
  [/violon|violin|\bvno\b|\bvl\b/i, 'violin'], [/viola|\bvla\b/i, 'viola'],
  [/sopran|t[eé]nor|tenore|ch(œ|oe)ur|choir|voix|voice|vocal/i, 'choir_aahs'],
  [/piano/i, 'acoustic_grand_piano'],
];

function sonPour(nom, prog) {
  if (prog && sonGM(prog)) return sonGM(prog);
  for (const [re, son] of MOTS_SONS) if (re.test(nom)) return son;
  return 'string_ensemble_1';
}

export function convertirMusicXML(texte, nomFichier) {
  const doc = new DOMParser().parseFromString(texte, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fichier MusicXML illisible.');
  if (doc.documentElement.tagName !== 'score-partwise') {
    throw new Error('Seul le format score-partwise est géré (exporte depuis MuseScore/Finale).');
  }
  const titre = doc.querySelector('work work-title, movement-title')?.textContent?.trim()
    || (nomFichier || 'Partition').replace(/\.(musicxml|xml)$/i, '');
  const tempoIndique = Number(doc.querySelector('sound[tempo]')?.getAttribute('tempo')) || 80;

  const infos = {};
  for (const sp of doc.querySelectorAll('part-list score-part')) {
    infos[sp.getAttribute('id')] = {
      nom: sp.querySelector('part-name')?.textContent?.trim() || sp.getAttribute('id'),
      prog: Number(sp.querySelector('midi-instrument > midi-program')?.textContent) || null,
    };
  }
  const parts = [...doc.documentElement.children].filter((e) => e.tagName === 'part');
  if (!parts.length) throw new Error('Aucune partie dans ce fichier.');

  // Passe 1 : longueur de chaque mesure (en noires), chiffrage et anacrouse comprise
  const nMes = Math.max(...parts.map((p) =>
    [...p.children].filter((e) => e.tagName === 'measure').length));
  const attendu = Array(nMes).fill(0);
  const reel = Array(nMes).fill(0);
  const sigs = Array(nMes).fill(null); // chiffrage déclaré à chaque mesure
  for (const part of parts) {
    let div = 1, exp = 4;
    [...part.children].filter((e) => e.tagName === 'measure').forEach((m, i) => {
      for (const d of m.querySelectorAll('attributes > divisions')) div = +d.textContent;
      const t = m.querySelector('attributes > time');
      if (t) {
        const num = parseInt(t.querySelector('beats').textContent, 10) || 4;
        const den = parseInt(t.querySelector('beat-type').textContent, 10) || 4;
        exp = num * 4 / den;
        sigs[i] = sigs[i] || { num, den };
      }
      let pos = 0, mx = 0;
      for (const el of m.children) {
        if (el.tagName === 'note') {
          if (!el.querySelector(':scope > chord') && !el.querySelector(':scope > grace')) {
            pos += +(el.querySelector(':scope > duration')?.textContent || 0);
          }
        } else if (el.tagName === 'backup') pos -= +el.querySelector('duration').textContent;
        else if (el.tagName === 'forward') pos += +el.querySelector('duration').textContent;
        if (pos > mx) mx = pos;
      }
      attendu[i] = Math.max(attendu[i], exp);
      reel[i] = Math.max(reel[i], mx / div);
    });
  }
  const longueurs = attendu.map((e, i) =>
    (i === 0 && reel[0] > 0 && reel[0] < e - 1e-6) ? reel[0] : e); // anacrouse
  const debuts = [0];
  for (let i = 0; i < nMes; i++) debuts.push(debuts[i] + longueurs[i]);

  // Chiffrages : celui du début, puis chaque changement, repéré en noires
  const chiffrages = [];
  let sigCourant = sigs.find(Boolean) || { num: 4, den: 4 };
  for (let i = 0; i < nMes; i++) {
    if (sigs[i] && (sigs[i].num !== sigCourant.num || sigs[i].den !== sigCourant.den || !chiffrages.length)) {
      sigCourant = sigs[i];
      chiffrages.push({ temps: debuts[i], num: sigCourant.num, den: sigCourant.den });
    }
  }
  if (!chiffrages.length) chiffrages.push({ temps: 0, num: sigCourant.num, den: sigCourant.den });
  if (chiffrages[0].temps > 0) chiffrages.unshift({ temps: 0, num: 4, den: 4 });

  // Passe 2 : notes de chaque partie
  const pupitres = [];
  const nomsPris = new Set();
  for (const part of parts) {
    const info = infos[part.getAttribute('id')] || { nom: part.getAttribute('id'), prog: null };
    const son = sonPour(info.nom, info.prog);
    const pizzSon = CORDES.has(son) ? 'pizzicato_strings' : null;
    let div = 1, transpoFichier = null, nuance = 0.38, pizzMode = 0;
    const basseDefaut = /contreb|contrabb|double bass/i.test(info.nom) ? -12 : 0;
    const enCours = {};
    const notes = [];
    [...part.children].filter((e) => e.tagName === 'measure').forEach((m, i) => {
      for (const d of m.querySelectorAll('attributes > divisions')) div = +d.textContent;
      const tr = m.querySelector('attributes > transpose');
      if (tr) {
        transpoFichier = (+(tr.querySelector('chromatic')?.textContent || 0))
          + 12 * (+(tr.querySelector('octave-change')?.textContent || 0));
      }
      const debutMesure = debuts[i];
      const L = longueurs[i];
      let pos = 0, dernierDebut = 0;
      for (const el of m.children) {
        if (el.tagName === 'direction') {
          for (const dy of el.querySelectorAll('dynamics > *')) {
            if (NUANCES[dy.tagName] != null) nuance = NUANCES[dy.tagName];
          }
          for (const w of el.querySelectorAll('words')) {
            const tx = (w.textContent || '').toLowerCase();
            if (tx.includes('pizz')) pizzMode = 1;
            else if (tx.includes('arco')) pizzMode = 0;
          }
        } else if (el.tagName === 'backup') pos -= +el.querySelector('duration').textContent;
        else if (el.tagName === 'forward') pos += +el.querySelector('duration').textContent;
        else if (el.tagName === 'note') {
          if (el.querySelector(':scope > grace')) continue;
          const dur = +(el.querySelector(':scope > duration')?.textContent || 0);
          const accord = !!el.querySelector(':scope > chord');
          const debut = accord ? dernierDebut : pos;
          if (!accord) { dernierDebut = pos; pos += dur; }
          if (el.querySelector(':scope > rest')) continue;
          const p = el.querySelector(':scope > pitch');
          if (!p) continue;
          const transpo = transpoFichier == null ? basseDefaut : transpoFichier;
          const h = 12 * (+p.querySelector('octave').textContent + 1)
            + PAS[p.querySelector('step').textContent]
            + Math.round(+(p.querySelector('alter')?.textContent || 0)) + transpo;
          const t0 = debut / div;
          if (t0 >= L - 1e-6) continue;
          const d = Math.min(dur / div, L - t0);
          const liens = new Set([...el.querySelectorAll(':scope > tie')].map((t) => t.getAttribute('type')));
          if (liens.has('stop') && enCours[h]) {
            enCours[h][1] = +(debutMesure + t0 + d - enCours[h][0]).toFixed(4);
            if (!liens.has('start')) delete enCours[h];
            continue;
          }
          const note = [+(debutMesure + t0).toFixed(4), +d.toFixed(4), h, nuance,
            pizzSon && pizzMode ? 1 : 0];
          notes.push(note);
          if (liens.has('start')) enCours[h] = note;
        }
      }
    });
    if (!notes.length) continue;
    let nom = info.nom;
    let n = 2;
    while (nomsPris.has(nom)) nom = `${info.nom} ${n++}`;
    nomsPris.add(nom);
    notes.sort((a, b) => a[0] - b[0]);
    pupitres.push({ nom, sons: [son, pizzSon], notes });
  }
  if (!pupitres.length) throw new Error('Aucune note trouvée dans ce fichier.');

  return {
    titre, tempoIndique, pupitres,
    tempsParMesure: attendu[0] || 4,
    chiffrage: [chiffrages[0].num, chiffrages[0].den],
    chiffrages,
    mesures: nMes,
    totalTemps: debuts[nMes],
    debutsMesures: debuts,
    format: '[temps, durée, hauteur MIDI, nuance 0-1, pizz 0/1] — temps et durée en noires',
  };
}

// ---------------------------------------------------------------- État général
let audio = null;
let orchestre = null;
let partition = null;
let osmd = null;
let cursorMes = 0;
let partitionAffichee = false;
let curseurOsmd = 0;          // position du curseur OSMD, distincte de la mesure affichée
const LIMITE_AFFICHAGE = 6e6; // caractères : au-delà, l'affichage de la partition ne tient pas

let etat = 'attente';      // attente | jeu | ralenti
let position = 0;          // où l'on en est dans la partition, en noires
let uniteBattue = 1;       // ce que vaut une battue, en noires
let uniteManuelle = 0;     // 0 = automatique, d'après le chiffrage
let raisonArret = '';      // message passager après une coupure
let leveeTemps = [];
let periode = 0.75;
let prochainTemps = 0;
let tempsDepart = 0;
let tempsRalentiFaits = 0;
let dernierIctus = -Infinity;
let decalMs = 0;
let gainGeste = 1;         // amplitude de la battue (main droite)
let nuanceGauche = 1;      // hauteur de la main gauche
let gaucheVue = 0;         // instant où la main gauche a été vue
const solos = new Set();
const muets = new Set();
const tempsProgrammes = []; // {quand, temps} pour le curseur

const NOMS_ETAT = { attente: 'En attente de la levée', jeu: 'Lecture', ralenti: 'Ralenti…' };

// ---------------------------------------------------------------- Métrique
// Ce que vaut une battue à cet endroit de la partition : la noire en 4/4,
// la noire pointée en 6/8, la blanche en 2/2…
function uniteA(temps) {
  if (uniteManuelle) return uniteManuelle;
  const c = chiffrageA(partition, temps);
  return uniteDeBattue(c.num, c.den).unite;
}

// Durée d'une mesure, qui sert de garde-fou au détecteur de cercle
function dureeMesure() {
  if (etat === 'attente' || !partition) return 0;
  const c = chiffrageA(partition, position);
  return (c.num * 4 / c.den) * (periode / uniteBattue);
}

function statut(txt) { $('statut').textContent = txt || ''; }

function gainPupitre(nom) {
  if (solos.size && !solos.has(nom)) return 0;
  if (muets.has(nom)) return 0;
  return gainGeste * nuanceGauche;
}

function ensureAudio() {
  if (!audio) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    if (partition && !orchestre) chargerSons();
  }
  if (audio.state !== 'running') audio.resume();
  return audio;
}

function clic(quand, freq = 520, fort = 0.25) {
  if (!audio) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, quand);
  g.gain.linearRampToValueAtTime(fort, quand + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, quand + 0.08);
  o.connect(g).connect(audio.destination);
  o.start(quand); o.stop(quand + 0.1);
}

// ---------------------------------------------------------------- Le chef
// ---------------------------------------------------------------- Geste circulaire : couper
const cercle = new DetecteurCercle({ rayonMin: 0.035 }); // coordonnées d'image (0 à 1)

function couperParCercle() {
  if (etat === 'attente') {
    raisonArret = 'Cercle vu — rien à couper';
    return;
  }
  etat = 'attente';
  orchestre?.couper();
  tempsProgrammes.length = 0;
  leveeTemps = [];
  ictus.dernier = undefined;
  tempsDepart = partition?.debutsMesures?.[mesureDe(position)] ?? 0;
  raisonArret = `Coupé au cercle (mesure ${mesureDe(position) + 1})`;
  setTimeout(() => { raisonArret = ''; }, 4000);
}

function battueVisuelle() {
  const b = $('battement');
  b.style.background = '#ffd27a';
  b.style.transform = 'scale(1.5)';
  setTimeout(() => { b.style.background = '#333'; b.style.transform = 'scale(1)'; }, 90);
}

function mesureDe(beat) {
  const d = partition?.debutsMesures;
  if (!d) return 0;
  let i = 0;
  while (i + 1 < d.length - 1 && d[i + 1] <= beat + 1e-6) i++;
  return i;
}

function ictus(t, cibleGain) {
  if (t - dernierIctus < REG.intervalleMin) return;
  dernierIctus = t;
  battueVisuelle();
  if (cibleGain != null) gainGeste += (cibleGain - gainGeste) * 0.5;

  if (etat === 'attente') {
    if (leveeTemps.length && t - leveeTemps[leveeTemps.length - 1] > REG.intervalleMaxLevee) leveeTemps = [];
    leveeTemps.push(t);
    if (leveeTemps.length <= REG.tempsLevee) { clic(Math.max(t, audio?.currentTime || 0)); return; }
    const ecarts = leveeTemps.slice(1).map((v, i) => v - leveeTemps[i]);
    periode = ecarts.reduce((a, b) => a + b, 0) / ecarts.length;
    periode = Math.min(2, Math.max(0.25, periode));
    etat = 'jeu';
    position = tempsDepart;
    uniteBattue = uniteA(position);
    leveeTemps = [];
    raisonArret = '';
    prochainTemps = Math.max(t, audio.currentTime);
    ictus.dernier = t;
    decalMs = 0;
    programmer();
    return;
  }
  if (etat === 'ralenti') { etat = 'jeu'; tempsRalentiFaits = 0; }
  const precedent = prochainTemps - periode;
  const plusProche = Math.abs(t - precedent) < Math.abs(t - prochainTemps) ? precedent : prochainTemps;
  const erreur = t - plusProche;
  decalMs = Math.round(erreur * 1000);
  const intervalle = t - (ictus.dernier ?? t - periode);
  if (intervalle > periode * 0.5 && intervalle < periode * 2) {
    periode += (intervalle - periode) * REG.suiviTempo;
  }
  prochainTemps += erreur * REG.suiviPhase;
  ictus.dernier = t;
}

function programmer() {
  if (!audio) return;
  const maintenant = audio.currentTime;
  while (etat !== 'attente' && prochainTemps < maintenant + 0.1) {
    let quand = Math.max(prochainTemps, maintenant);
    if (etat === 'ralenti') quand += (Math.random() - 0.5) * 0.06;
    uniteBattue = uniteA(position);
    if (orchestre?.pret) {
      orchestre.jouerIntervalle(position, position + uniteBattue, quand, periode / uniteBattue, {
        gain: gainPupitre,
        decalage: etat === 'ralenti' ? 0.12 : 0,
      });
    } else {
      clic(quand, 990, 0.3);
    }
    tempsProgrammes.push({ quand, temps: position });
    position += uniteBattue;

    if (orchestre?.pret && position >= orchestre.totalTemps) { // fin du morceau
      etat = 'attente';
      tempsDepart = 0;
      ictus.dernier = undefined;
      break;
    }
    if (etat === 'jeu' && prochainTemps - dernierIctus > periode * REG.tempsSansBattue) {
      etat = 'ralenti';
      tempsRalentiFaits = 0;
    }
    if (etat === 'ralenti') {
      tempsRalentiFaits++;
      periode *= 1.15;
      if (tempsRalentiFaits >= REG.tempsRalenti) {
        etat = 'attente';
        orchestre?.couper();
        ictus.dernier = undefined;
        tempsDepart = partition?.debutsMesures?.[mesureDe(position)] ?? 0;
        break;
      }
    }
    prochainTemps += periode;
  }
}

// ---------------------------------------------------------------- Partition (OSMD + sons)
async function chargerFichier(f) {
  if (/\.(mid|midi)$/i.test(f.name)) return chargerMIDI(await f.arrayBuffer(), f.name);
  return chargerXML(await f.text(), f.name);
}

async function chargerMIDI(buffer, nomFichier) {
  try {
    statut('Lecture du MIDI…');
    await nouvellePartition(lireMIDI(buffer, nomFichier), null);
  } catch (e) {
    console.error(e);
    statut('Erreur : ' + e.message);
  }
}

async function chargerXML(texte, nomFichier) {
  try {
    statut('Lecture de la partition…');
    await nouvellePartition(convertirMusicXML(texte, nomFichier), texte);
  } catch (e) {
    console.error(e);
    statut('Erreur : ' + e.message);
  }
}

function sansPartition(message) {
  const n = partition.pupitres.reduce((t, q) => t + q.notes.length, 0);
  $('score').innerHTML = `<div id="accueilBis" style="color:#555;padding:40px;max-width:560px">
    <b>${partition.titre}</b><br><br>${message}<br><br>
    ${partition.pupitres.length} pupitres, ${n.toLocaleString('fr-FR')} notes,
    ${partition.mesures} mesures à ${partition.tempsParMesure} temps.<br>
    Le numéro de mesure en haut à droite suit la lecture.</div>`;
}

async function nouvellePartition(p, texteXML) {
  orchestre?.couper();
  orchestre = null;
  partition = p;
  etat = 'attente'; leveeTemps = []; tempsDepart = 0; tempsProgrammes.length = 0;
  cursorMes = 0; curseurOsmd = 0; position = 0; raisonArret = ''; mesureVisee = null;
  cercle.reinitialiser();
  uniteBattue = uniteA(0);
  $('accueil').style.display = 'none';
  construirePupitres();
  document.title = `${p.titre} — Lecteur`;

  partitionAffichee = false;
  try { osmd?.clear(); } catch (e) { /* sans importance */ }
  osmd = null;
  $('score').innerHTML = '';

  if (texteXML && texteXML.length <= LIMITE_AFFICHAGE) {
    statut('Affichage de la partition…');
    await new Promise((r) => setTimeout(r, 0)); // laisse le message s'afficher
    try {
      osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay($('score'), {
        autoResize: true, drawTitle: true, drawingParameters: 'compacttight', followCursor: false,
      });
      await osmd.load(texteXML);
      osmd.render();
      try { osmd.cursor.show(); } catch (e) { /* le son prime sur le curseur */ }
      partitionAffichee = true;
    } catch (e) {
      console.error(e);
      osmd = null;
      sansPartition(`La partition n'a pas pu être affichée (${e.message}), mais la lecture fonctionne.`);
    }
  } else if (texteXML) {
    sansPartition(`Fichier trop lourd pour afficher la partition
      (${(texteXML.length / 1e6).toFixed(0)} Mo). Lecture seule.`);
  } else {
    sansPartition(`Un fichier MIDI ne contient pas de gravure : il n'y a pas de partition à afficher.`);
  }
  statut('');
  if (audio) await chargerSons();
}

async function chargerSons() {
  if (!partition || !audio) return;
  orchestre = new Orchestre(audio);
  const n = partition.pupitres.length;
  const positions = {};
  partition.pupitres.forEach((p, i) => {
    positions[p.nom] = { x: (i - (n - 1) / 2) * 1.2, y: 1.2, z: -3 };
  });
  await orchestre.charger(partition, positions,
    (f, t) => statut(`Chargement des sons : ${f} / ${t}`));
  statut('');
}

function construirePupitres() {
  const zone = $('pupitres');
  zone.innerHTML = '';
  solos.clear(); muets.clear();
  for (const p of partition.pupitres) {
    const rang = document.createElement('div');
    rang.className = 'rang';
    const s = document.createElement('input'); s.type = 'checkbox'; s.title = 'Solo';
    const m = document.createElement('input'); m.type = 'checkbox'; m.title = 'Muet';
    s.onchange = () => { s.checked ? solos.add(p.nom) : solos.delete(p.nom); };
    m.onchange = () => { m.checked ? muets.add(p.nom) : muets.delete(p.nom); };
    if (p.percussion) { m.checked = true; muets.add(p.nom); } // la batterie GM sonne mal : muette par défaut
    const nom = document.createElement('span');
    nom.textContent = `${p.nom} (${p.notes.length})`;
    rang.append(s, m, nom);
    zone.appendChild(rang);
  }
}

function placerCurseur(mes) {
  if (!partitionAffichee || !osmd?.cursor) return;
  try {
    const c = osmd.cursor;
    const it = () => c.Iterator || c.iterator;
    if (mes < curseurOsmd) { c.reset(); curseurOsmd = 0; }
    let garde = 0;
    while (!it().EndReached && it().CurrentMeasureIndex < mes && garde++ < 20000) c.next();
    curseurOsmd = mes;
    c.update?.();
    c.cursorElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { /* le son prime sur le curseur */ }
}

// ---------------------------------------------------------------- Frise : se déplacer dans la partition
let mesureVisee = null; // mesure montrée pendant qu'on glisse, avant de valider

function allerAMesure(m) {
  if (!partition) return;
  const m2 = Math.max(0, Math.min(partition.mesures - 1, m));
  const t = partition.debutsMesures?.[m2] ?? 0;
  orchestre?.couper();
  tempsProgrammes.length = 0;
  tempsDepart = t;
  position = t;
  uniteBattue = uniteA(t);
  cursorMes = m2;
  placerCurseur(m2);
  if (etat !== 'attente' && audio) prochainTemps = audio.currentTime; // on repart d'ici sans attendre
  raisonArret = '';
}

function majFrise() {
  const m = mesureVisee ?? cursorMes;
  const n = partition?.mesures || 1;
  const f = n > 1 ? m / (n - 1) : 0;
  $('frisePlein').style.width = `${f * 100}%`;
  $('friseTete').style.left = `${f * 100}%`;
  $('friseTexte').textContent = partition
    ? `${mesureVisee != null ? 'Aller à la ' : ''}mesure ${m + 1} / ${n}` : '—';
}

{
  const frise = $('frise');
  const mesureSous = (e) => {
    const r = $('friseFond').getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return Math.round(f * ((partition?.mesures || 1) - 1));
  };
  frise.addEventListener('pointerdown', (e) => {
    if (!partition) return;
    frise.setPointerCapture(e.pointerId);
    mesureVisee = mesureSous(e); // on ne déplace vraiment qu'au relâchement : glisser reste fluide
    majFrise();
  });
  frise.addEventListener('pointermove', (e) => {
    if (mesureVisee == null) return;
    mesureVisee = mesureSous(e);
    majFrise();
  });
  const relacher = () => {
    if (mesureVisee == null) return;
    const m = mesureVisee;
    mesureVisee = null;
    allerAMesure(m);
    majFrise();
  };
  frise.addEventListener('pointerup', relacher);
  frise.addEventListener('pointercancel', () => { mesureVisee = null; majFrise(); });
}

// ---------------------------------------------------------------- Webcam (MediaPipe, 2 mains)
let landmarker = null;
let webcamActive = false;
const droite = { yPrec: null, vy: 0, desc: false, yHaut: 1, tPrec: 0 };

// Point de battue : le bas du geste, posé par l'utilisateur dans l'image.
// Toutes les battues y passent, quelle que soit la métrique : chaque passage
// est un temps, et c'est l'unité de battue (metrique.js) qui dit ce qu'il vaut.
const point = { x: 0.5, y: 0.78, delta: 0.07, armee: true, flash: 0, sommet: 1 };

async function demarrerWebcam() {
  if (webcamActive) return;
  $('btnWebcam').disabled = true;
  try {
    statut('Démarrage de la caméra…');
    const flux = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 360, frameRate: { ideal: 60 } }, audio: false,
    });
    const video = $('video');
    video.srcObject = flux;
    await video.play();
    statut('Chargement du suivi des mains…');
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const fichiers = await vision.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    landmarker = await vision.HandLandmarker.createFromOptions(fichiers, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    webcamActive = true;
    statut('');
    $('btnWebcam').textContent = 'Webcam active';
    boucleWebcam();
  } catch (e) {
    console.error(e);
    statut('Webcam impossible : ' + e.message);
    $('btnWebcam').disabled = false;
  }
}

function boucleWebcam() {
  const video = $('video');
  const pas = () => {
    if (!webcamActive) return;
    if (video.readyState >= 2) {
      let res = null;
      try { res = landmarker.detectForVideo(video, performance.now()); } catch (e) { /* image pas prête */ }
      if (res) { traiterMains(res); dessinerMains(res); }
    }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(pas);
    else requestAnimationFrame(pas);
  };
  pas();
}

function traiterMains(res) {
  const mains = res.handednesses || res.handedness || [];
  const inv = $('invG').checked;
  for (let i = 0; i < (res.landmarks || []).length; i++) {
    let label = mains[i]?.[0]?.categoryName || 'Right';
    if (inv) label = label === 'Left' ? 'Right' : 'Left';
    if (label === 'Right') mainDroite(res.landmarks[i]);
    else mainGauche(res.landmarks[i]);
  }
}

function mainDroite(lm) {
  const x = lm[8].x;
  const y = lm[8].y; // bout de l'index ; y augmente vers le bas
  const t = performance.now() / 1000;

  // Geste circulaire : coupure. Le préavis empêche le cercle de compter des temps.
  cercle.reglerFenetre(dureeMesure());
  const g = cercle.ajouter(x, y, t);
  if (g.arret) { ensureAudio(); couperParCercle(); droite.desc = false; point.armee = false; return; }
  if (g.preavis) { droite.desc = false; droite.yPrec = y; droite.tPrec = t; return; }

  if ($('modePoint').checked) { battreSurPoint(x, y); return; }

  const dt = t - droite.tPrec;
  droite.tPrec = t;
  if (droite.yPrec == null || !dt || dt > 0.2) { droite.yPrec = y; return; }
  const v = (y - droite.yPrec) / dt;
  droite.yPrec = y;
  droite.vy += (v - droite.vy) * 0.5;
  if (y < droite.yHaut) droite.yHaut = y;
  const seuil = +$('seuilCam').value;
  if (droite.vy > seuil) droite.desc = true;
  if (droite.desc && droite.vy < 0) {
    droite.desc = false;
    ensureAudio();
    const amplitude = Math.max(0, y - droite.yHaut);
    droite.yHaut = y;
    // 2 % de l'image -> piano ; 27 % et plus -> forte
    const cible = 0.6 + 0.7 * Math.min(1, Math.max(0, (amplitude - 0.02) / 0.25));
    const tIctus = audio.currentTime - (+$('avance').value) / 1000;
    ictus(tIctus, cible);
  }
}

// Distance au point, en hauteurs d'image (l'horizontale est remise à l'échelle
// pour que le delta soit un vrai cercle à l'écran et pas une ellipse).
function distanceAuPoint(x, y) {
  const v = $('video');
  const asp = (v.videoWidth || 16) / (v.videoHeight || 9);
  return Math.hypot((x - point.x) * asp, y - point.y);
}

function battreSurPoint(x, y) {
  if (y < point.sommet) point.sommet = y; // on retient le haut du geste pour la nuance
  const d = distanceAuPoint(x, y);
  if (d <= point.delta) {
    if (!point.armee) return;
    point.armee = false;
    point.flash = performance.now();
    ensureAudio();
    const amplitude = Math.max(0, point.y - point.sommet); // hauteur du geste au-dessus du point
    point.sommet = y;
    // 4 % de la hauteur d'image -> piano ; 40 % et plus -> forte
    const cible = 0.6 + 0.7 * Math.min(1, Math.max(0, (amplitude - 0.04) / 0.36));
    ictus(audio.currentTime - (+$('avance').value) / 1000, cible);
  } else if (d > point.delta * 1.35) {
    point.armee = true; // il faut ressortir avant de pouvoir rebattre
  }
}

function mainGauche(lm) {
  gaucheVue = performance.now();
  const y = lm[0].y; // poignet
  // Main en haut de l'image -> fort (x1,5) ; en bas -> doux (x0,5)
  const cible = Math.min(1.5, Math.max(0.5, 1.7 - 1.6 * y));
  nuanceGauche += (cible - nuanceGauche) * 0.15;
}

function dessinerMains(res) {
  const c = $('calque');
  const video = $('video');
  if (c.width !== video.videoWidth) { c.width = video.videoWidth; c.height = video.videoHeight; }
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);

  if ($('modePoint').checked) {
    const r = point.delta * c.height;
    const px = point.x * c.width, py = point.y * c.height;
    const vif = performance.now() - point.flash < 120;
    g.strokeStyle = vif ? '#ffd27a' : (point.armee ? 'rgba(255,210,122,.55)' : 'rgba(255,255,255,.3)');
    g.lineWidth = vif ? 5 : 2.5;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(px - 9, py); g.lineTo(px + 9, py);
    g.moveTo(px, py - 9); g.lineTo(px, py + 9); g.stroke();
  }
  const mains = res.handednesses || res.handedness || [];
  const inv = $('invG').checked;
  for (let i = 0; i < (res.landmarks || []).length; i++) {
    let label = mains[i]?.[0]?.categoryName || 'Right';
    if (inv) label = label === 'Left' ? 'Right' : 'Left';
    const lm = res.landmarks[i];
    const p = label === 'Right' ? lm[8] : lm[0];
    g.fillStyle = label === 'Right' ? '#ff9d2e' : '#4da3ff';
    g.beginPath();
    g.arc(p.x * c.width, p.y * c.height, 9, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------------------------------------------------------------- iPhone (PeerJS, comme le jeu VR)
$('btnIphoneL').addEventListener('click', async () => {
  ensureAudio();
  const info = $('infoIphoneL');
  $('btnIphoneL').disabled = true;
  info.textContent = 'Connexion…';
  try {
    if (!window.Peer) {
      await new Promise((ok, ko) => {
        const sc = document.createElement('script');
        sc.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
        sc.onload = ok; sc.onerror = () => ko(new Error('PeerJS introuvable'));
        document.head.appendChild(sc);
      });
    }
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const peer = new window.Peer('chef-orchestre-vr-' + code);
    peer.on('open', () => {
      info.innerHTML = `Sur l'iPhone : <b>${location.origin}${location.pathname.replace(/lecteur\.html$/, '')}baguette.html</b><br>Code : <b style="font-size:20px">${code}</b>`;
    });
    peer.on('connection', (conn) => {
      info.textContent = `iPhone connecté (code ${code}).`;
      conn.on('data', (d) => {
        if (d && d.type === 'ictus') {
          ensureAudio();
          const cible = 0.6 + 0.7 * Math.min(1, Math.max(0, d.force));
          ictus(audio.currentTime, cible);
        }
      });
      conn.on('close', () => { info.textContent = 'iPhone déconnecté.'; });
    });
    peer.on('error', (e) => { info.textContent = 'Erreur : ' + e.type; $('btnIphoneL').disabled = false; });
  } catch (e) {
    info.textContent = 'Erreur : ' + e.message;
    $('btnIphoneL').disabled = false;
  }
});

// ---------------------------------------------------------------- Interface
$('btnOuvrir').addEventListener('click', () => $('fichier').click());
$('fichier').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) chargerFichier(f);
});
$('btnSon').addEventListener('click', () => { ensureAudio(); $('btnSon').textContent = 'Son actif'; });
$('btnWebcam').addEventListener('click', () => { ensureAudio(); demarrerWebcam(); });
$('avance').addEventListener('input', () => { $('avanceV').textContent = $('avance').value + ' ms'; });

{
  const sel = $('unite');
  for (const [v, nom] of UNITES_MANUELLES) {
    const o = document.createElement('option');
    o.value = v; o.textContent = nom;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { uniteManuelle = parseFloat(sel.value) || 0; });
}
$('delta').addEventListener('input', () => {
  point.delta = +$('delta').value;
  $('deltaV').textContent = `${Math.round(point.delta * 100)} % de la hauteur`;
});
{
  // Poser le point de battue : cliquer ou glisser dans l'image (qui est en miroir)
  const cadre = $('cadreVideo');
  let pose = false;
  const placer = (e) => {
    const r = cadre.getBoundingClientRect();
    point.x = Math.min(1, Math.max(0, 1 - (e.clientX - r.left) / r.width));
    point.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    point.armee = true;
  };
  cadre.addEventListener('pointerdown', (e) => { pose = true; cadre.setPointerCapture(e.pointerId); placer(e); });
  cadre.addEventListener('pointermove', (e) => { if (pose) placer(e); });
  cadre.addEventListener('pointerup', () => { pose = false; });
  cadre.addEventListener('pointercancel', () => { pose = false; });
}
$('seuilCercle').addEventListener('input', () => {
  cercle.toursArret = +$('seuilCercle').value;
  cercle.toursPreavis = cercle.toursArret * 0.55;
  $('seuilCercleV').textContent = `${Math.round(cercle.toursArret * 100)} % de tour`;
});

addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    ensureAudio();
    ictus(audio.currentTime);
  }
});

// Glisser-déposer
addEventListener('dragover', (e) => { e.preventDefault(); $('glisser').style.display = 'flex'; });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('glisser').style.display = 'none'; });
addEventListener('drop', async (e) => {
  e.preventDefault();
  $('glisser').style.display = 'none';
  const f = e.dataTransfer.files[0];
  if (f && /\.(musicxml|xml|mid|midi)$/i.test(f.name)) chargerFichier(f);
  else statut('Dépose un fichier .musicxml, .xml, .mid ou .midi');
});

// ---------------------------------------------------------------- Boucle d'affichage
function boucle() {
  requestAnimationFrame(boucle);
  if (audio) programmer();
  // La main gauche relâchée revient doucement à la nuance neutre
  if (performance.now() - gaucheVue > 1500) nuanceGauche += (1 - nuanceGauche) * 0.02;
  // Curseur : suit les temps réellement joués
  if (audio) {
    while (tempsProgrammes.length && tempsProgrammes[0].quand <= audio.currentTime) {
      const { temps } = tempsProgrammes.shift();
      const mes = mesureDe(temps);
      if (mes !== cursorMes) { cursorMes = mes; placerCurseur(mes); }
    }
  }
  // HUD
  $('etatEl').textContent = raisonArret || (etat === 'attente'
    ? `${NOMS_ETAT[etat]} (${leveeTemps.length}/${REG.tempsLevee} à vide, reprise mesure ${mesureDe(tempsDepart) + 1})`
    : NOMS_ETAT[etat]);
  $('tempoEl').textContent = etat === 'attente' ? '—' : `${Math.round(60 / periode)} battues/min`;
  $('mesEl').textContent = partition ? `${cursorMes + 1} / ${partition.mesures}` : '—';
  if (partition) {
    const c = chiffrageA(partition, etat === 'attente' ? tempsDepart : position);
    const u = uniteA(etat === 'attente' ? tempsDepart : position);
    $('metriqueEl').textContent = uniteManuelle
      ? `${c.num}/${c.den} — à la ${nomUnite(u)} (imposée)`
      : decrireChiffrage(c.num, c.den);
  }
  majFrise();
  $('cercleEl').style.width = `${Math.min(100, (cercle.tours / (cercle.toursArret || 1)) * 100)}%`;
  $('decalEl').textContent = etat === 'jeu' ? `${decalMs} ms` : '—';
  $('nuanceEl').textContent = `×${(gainGeste * nuanceGauche).toFixed(2)}`;
}
boucle();

// ---------------------------------------------------------------- Pavane par défaut
(async () => {
  try {
    const r = await fetch('./partitions/sources/faure-pavane.musicxml');
    if (r.ok) chargerXML(await r.text(), 'Gabriel Fauré — Pavane, op. 50');
  } catch (e) { /* l'accueil reste affiché */ }
})();
