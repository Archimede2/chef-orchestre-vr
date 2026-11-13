// Lecture directe d'un fichier MIDI (.mid) -> partition de jeu.
//
// Un MIDI issu d'une partition est bien plus léger qu'un MusicXML converti depuis
// ce même MIDI, et ses temps sont déjà musicaux : les « ticks » se comptent en
// fractions de noire, indépendamment du tempo. C'est exactement ce dont le chef a
// besoin, puisque c'est sa battue qui donne le tempo.
//
// En revanche un MIDI ne contient aucune gravure : pas de portée à afficher.

const DEC = new TextDecoder('latin1');

// Les 128 instruments General MIDI, nommés comme dans la banque FluidR3.
export const SONS_GM = [
  'acoustic_grand_piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honkytonk_piano',
  'electric_piano_1', 'electric_piano_2', 'harpsichord', 'clavinet',
  'celesta', 'glockenspiel', 'music_box', 'vibraphone',
  'marimba', 'xylophone', 'tubular_bells', 'dulcimer',
  'drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ',
  'reed_organ', 'accordion', 'harmonica', 'tango_accordion',
  'acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_jazz', 'electric_guitar_clean',
  'electric_guitar_muted', 'overdriven_guitar', 'distortion_guitar', 'guitar_harmonics',
  'acoustic_bass', 'electric_bass_finger', 'electric_bass_pick', 'fretless_bass',
  'slap_bass_1', 'slap_bass_2', 'synth_bass_1', 'synth_bass_2',
  'violin', 'viola', 'cello', 'contrabass',
  'tremolo_strings', 'pizzicato_strings', 'orchestral_harp', 'timpani',
  'string_ensemble_1', 'string_ensemble_2', 'synth_strings_1', 'synth_strings_2',
  'choir_aahs', 'voice_oohs', 'synth_choir', 'orchestra_hit',
  'trumpet', 'trombone', 'tuba', 'muted_trumpet',
  'french_horn', 'brass_section', 'synth_brass_1', 'synth_brass_2',
  'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax',
  'oboe', 'english_horn', 'bassoon', 'clarinet',
  'piccolo', 'flute', 'recorder', 'pan_flute',
  'blown_bottle', 'shakuhachi', 'whistle', 'ocarina',
  'lead_1_square', 'lead_2_sawtooth', 'lead_3_calliope', 'lead_4_chiff',
  'lead_5_charang', 'lead_6_voice', 'lead_7_fifths', 'lead_8_bass__lead',
  'pad_1_new_age', 'pad_2_warm', 'pad_3_polysynth', 'pad_4_choir',
  'pad_5_bowed', 'pad_6_metallic', 'pad_7_halo', 'pad_8_sweep',
  'fx_1_rain', 'fx_2_soundtrack', 'fx_3_crystal', 'fx_4_atmosphere',
  'fx_5_brightness', 'fx_6_goblins', 'fx_7_echoes', 'fx_8_scifi',
  'sitar', 'banjo', 'shamisen', 'koto',
  'kalimba', 'bagpipe', 'fiddle', 'shanai',
  'tinkle_bell', 'agogo', 'steel_drums', 'woodblock',
  'taiko_drum', 'melodic_tom', 'synth_drum', 'reverse_cymbal',
  'guitar_fret_noise', 'breath_noise', 'seashore', 'bird_tweet',
  'telephone_ring', 'helicopter', 'applause', 'gunshot',
];

// prog : numéro General MIDI de 1 à 128 (comme dans MusicXML)
export function sonGM(prog) {
  return SONS_GM[(prog | 0) - 1] || null;
}

// Nom lisible d'un instrument GM, pour nommer un pupitre sans nom de piste
function nomGM(prog) {
  const s = sonGM(prog);
  return s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Instrument';
}

export function lireMIDI(buffer, nomFichier) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  let i = 0;

  const u08 = () => u8[i++];
  const u16 = () => { const v = dv.getUint16(i); i += 2; return v; };
  const u32 = () => { const v = dv.getUint32(i); i += 4; return v; };
  const txt = (n) => { const s = DEC.decode(u8.subarray(i, i + n)).replace(/\0/g, '').trim(); i += n; return s; };
  const vlq = () => { let v = 0, b; do { b = u8[i++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (u8.length < 14 || txt(4) !== 'MThd') throw new Error("Ce fichier n'est pas un MIDI (en-tête MThd absent).");
  const tailleEntete = u32();
  const format = u16();
  const nPistes = u16();
  const division = dv.getInt16(i); i += 2;
  i = 8 + tailleEntete;
  if (division <= 0) throw new Error('MIDI en code temporel SMPTE : format non géré.');
  if (format === 2) throw new Error('MIDI de format 2 (pistes indépendantes) : format non géré.');

  const notes = [];        // {piste, canal, hauteur, tickOn, tickOff, vel}
  const programmes = {};   // "piste:canal" -> programme 1..128
  const nomsPistes = [];
  const nomsInstruments = [];
  const tempos = [];       // {tick, us}
  const chiffrages = [];   // {tick, num, den}
  let titreMeta = '';

  for (let piste = 0; piste < nPistes && i < u8.length; piste++) {
    if (txt(4) !== 'MTrk') break;
    const taille = u32();
    const fin = Math.min(i + taille, u8.length);
    let tick = 0;
    let statut = 0;
    const enCours = new Map(); // "canal:hauteur" -> file des notes ouvertes

    while (i < fin) {
      tick += vlq();
      let octet = u8[i];
      if (octet & 0x80) { statut = octet; i++; } // sinon : statut courant (running status)
      const type = statut & 0xf0;
      const canal = statut & 0x0f;

      if (statut === 0xff) {                       // méta-événement
        const meta = u08();
        const n = vlq();
        if (meta === 0x03) { const s = txt(n); if (piste === 0 && !titreMeta) titreMeta = s; nomsPistes[piste] = nomsPistes[piste] || s; }
        else if (meta === 0x04) { nomsInstruments[piste] = txt(n); }
        else if (meta === 0x51 && n === 3) { tempos.push({ tick, us: (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2] }); i += n; }
        else if (meta === 0x58 && n >= 2) { chiffrages.push({ tick, num: u8[i], den: 2 ** u8[i + 1] }); i += n; }
        else i += n;
      } else if (statut === 0xf0 || statut === 0xf7) { // SysEx
        i += vlq();
      } else if (type === 0x90 || type === 0x80) {     // note
        const hauteur = u08();
        const vel = u08();
        const cle = canal + ':' + hauteur;
        if (type === 0x90 && vel > 0) {
          if (!enCours.has(cle)) enCours.set(cle, []);
          enCours.get(cle).push({ piste, canal, hauteur, tickOn: tick, vel });
        } else {
          const file = enCours.get(cle);
          if (file && file.length) {
            const n0 = file.shift();
            n0.tickOff = tick;
            notes.push(n0);
          }
        }
      } else if (type === 0xc0) {                      // changement de programme
        const prog = u08() + 1;
        const cle = piste + ':' + canal;
        if (programmes[cle] == null) programmes[cle] = prog;
      } else if (type === 0xd0) {                      // pression du canal
        i += 1;
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
        i += 2;
      } else {
        i = fin; // statut inconnu : on abandonne cette piste
      }
    }
    // Notes restées ouvertes : on les ferme à la fin de la piste
    for (const file of enCours.values()) {
      for (const n0 of file) { n0.tickOff = tick; notes.push(n0); }
    }
    i = fin;
  }

  if (!notes.length) throw new Error('Aucune note dans ce fichier MIDI.');

  // ----- Regroupement en pupitres, par piste et par canal
  const groupes = new Map();
  for (const n of notes) {
    const cle = n.piste + ':' + n.canal;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(n);
  }
  // Une piste qui n'utilise qu'un canal garde son nom de piste tel quel
  const canauxParPiste = {};
  for (const cle of groupes.keys()) {
    const p = +cle.split(':')[0];
    canauxParPiste[p] = (canauxParPiste[p] || 0) + 1;
  }

  const pupitres = [];
  const nomsPris = new Set();
  for (const [cle, liste] of groupes) {
    const [piste, canal] = cle.split(':').map(Number);
    const percussion = canal === 9;
    const prog = programmes[cle] || 1;
    const son = percussion ? 'synth_drum' : (sonGM(prog) || 'string_ensemble_1');

    let base = nomsPistes[piste] || nomsInstruments[piste] || '';
    if (!base) base = percussion ? 'Percussions' : nomGM(prog);
    if (canauxParPiste[piste] > 1) base += ` (canal ${canal + 1})`;
    let nom = base;
    let k = 2;
    while (nomsPris.has(nom)) nom = `${base} ${k++}`;
    nomsPris.add(nom);

    const jouees = liste.map((n) => {
      const t0 = n.tickOn / division;
      const d = Math.max(0.03, (n.tickOff - n.tickOn) / division);
      return [+t0.toFixed(4), +d.toFixed(4), n.hauteur, +Math.max(0.1, n.vel / 127).toFixed(3), 0];
    });
    jouees.sort((a, b) => a[0] - b[0]);
    pupitres.push({ nom, sons: [son, null], notes: jouees, percussion });
  }
  pupitres.sort((a, b) => a.notes[0][0] - b.notes[0][0] || b.notes.length - a.notes.length);

  // ----- Mesures, d'après les chiffrages rencontrés
  const totalTemps = Math.ceil(Math.max(...notes.map((n) => n.tickOff)) / division);
  const sigs = (chiffrages.length ? chiffrages : [{ tick: 0, num: 4, den: 4 }])
    .map((c) => ({ temps: c.tick / division, L: c.num * 4 / c.den }))
    .sort((a, b) => a.temps - b.temps);
  if (sigs[0].temps > 0) sigs.unshift({ temps: 0, L: 4 });
  const debuts = [0];
  let t = 0, si = 0;
  while (t < totalTemps - 1e-6 && debuts.length < 100000) {
    while (si + 1 < sigs.length && sigs[si + 1].temps <= t + 1e-6) si++;
    const prochain = si + 1 < sigs.length ? sigs[si + 1].temps : Infinity;
    t = Math.min(t + sigs[si].L, prochain);
    debuts.push(+t.toFixed(4));
  }

  return {
    titre: (nomFichier || titreMeta || 'Fichier MIDI').replace(/\.(mid|midi)$/i, ''),
    tempoIndique: tempos.length ? Math.round(60e6 / tempos[0].us) : 100,
    tempsParMesure: sigs[0].L,
    mesures: debuts.length - 1,
    totalTemps,
    debutsMesures: debuts,
    pupitres,
    source: 'MIDI',
    format: '[temps, durée, hauteur MIDI, nuance 0-1, pizz 0/1] — temps et durée en noires',
  };
}
