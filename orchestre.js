// Moteur sonore : charge la partition de jeu et les sons, puis joue les notes
// au tempo donné par le chef. Tout se compte en noires ; une battue peut valoir
// autre chose qu'une noire (voir metrique.js), d'où jouerIntervalle().
// Sons : FluidR3 GM (Frank Wen, CC BY 3.0) via midi-js-soundfonts de Benjamin Gleitzman.

const BANQUE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
const NOMS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const nomNote = (m) => NOMS[m % 12] + (Math.floor(m / 12) - 1);

export class Orchestre {
  constructor(audio) {
    this.audio = audio;
    this.maitre = audio.createGain();
    this.maitre.gain.value = 0.8;
    const compresseur = audio.createDynamicsCompressor();
    this.maitre.connect(compresseur).connect(audio.destination);
    this.sons = {};          // nom du son -> { hauteur MIDI -> AudioBuffer }
    this.pupitres = new Map();
    this.parTemps = [];      // temps de battue -> notes qui commencent dans ce temps
    this.actives = new Set();
    this.partition = null;
    this.pret = false;
  }

  get totalTemps() {
    if (!this.partition) return 0;
    return this.partition.totalTemps || this.partition.mesures * this.partition.tempsParMesure;
  }

  // source : une URL de partition de jeu (.json), ou l'objet partition lui-même
  async charger(source, positions, progres) {
    const p = typeof source === 'string' ? await (await fetch(source)).json() : source;
    this.partition = p;

    const besoin = {};
    for (const pup of p.pupitres) {
      // Une source sonore placée à l'endroit du pupitre (son spatialisé)
      const panner = this.audio.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2;
      panner.rolloffFactor = 0.5;
      const pos = positions[pup.nom];
      if (pos) {
        if (panner.positionX) {
          panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z;
        } else {
          panner.setPosition(pos.x, pos.y, pos.z);
        }
      }
      const entree = this.audio.createGain();
      entree.connect(panner).connect(this.maitre);
      this.pupitres.set(pup.nom, { entree });

      for (const n of pup.notes) {
        const son = n[4] ? pup.sons[1] : pup.sons[0];
        (besoin[son] ||= new Set()).add(n[2]);
        const k = Math.floor(n[0] + 1e-6);
        (this.parTemps[k] ||= []).push({ pup, n });
      }
    }

    const liste = Object.keys(besoin);
    let faits = 0;
    progres?.(0, liste.length);
    await Promise.all(liste.map(async (son) => {
      try {
        const texte = await (await fetch(`${BANQUE}${son}-mp3.js`)).text();
        const dispo = {};
        const re = /"([A-G]b?-?\d)":\s*"data:audio\/mp3;base64,([^"]+)"/g;
        let m;
        while ((m = re.exec(texte))) dispo[m[1]] = m[2];
        const tampons = {};
        await Promise.all([...besoin[son]].map(async (hauteur) => {
          const b64 = dispo[nomNote(hauteur)];
          if (!b64) return;
          const octets = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          tampons[hauteur] = await this.audio.decodeAudioData(octets.buffer);
        }));
        this.sons[son] = tampons;
      } catch (e) {
        console.warn('Son indisponible, remplacé par un son de synthèse :', son, e);
        this.sons[son] = {};
      }
      faits++;
      progres?.(faits, liste.length);
    }));
    this.pret = true;
  }

  // Joue les notes dont l'attaque tombe dans [t0, t1[, en noires ; t0 sonne à
  // l'instant `quand`, et `secParNoire` dit combien de temps dure une noire.
  // Renvoie les événements [instant, pupitre, intensité] pour l'image.
  jouerIntervalle(t0, t1, quand, secParNoire, { gain, decalage = 0 }) {
    const evenements = [];
    for (let k = Math.floor(t0); k < t1; k++) {
      for (const { pup, n } of this.parTemps[k] || []) {
        if (n[0] < t0 - 1e-9 || n[0] >= t1 - 1e-9) continue;
        let q = quand + (n[0] - t0) * secParNoire + (Math.random() - 0.5) * decalage;
        q = Math.max(q, this.audio.currentTime);
        const duree = Math.max(0.08, n[1] * secParNoire);
        const intensite = n[3] * gain(pup.nom);
        this.note(pup, n[2], q, duree, intensite, n[4]);
        evenements.push([q, pup.nom, intensite]);
      }
    }
    return evenements;
  }

  // Raccourci : une battue qui vaut exactement une noire
  jouerTemps(k, t, periode, options) {
    return this.jouerIntervalle(k, k + 1, t, periode, options);
  }

  note(pup, hauteur, quand, duree, intensite, pizz) {
    const son = pizz ? pup.sons[1] : pup.sons[0];
    const tampon = this.sons[son]?.[hauteur];
    const g = this.audio.createGain();
    g.connect(this.pupitres.get(pup.nom).entree);
    let src;
    if (tampon) {
      src = this.audio.createBufferSource();
      src.buffer = tampon;
    } else {
      src = this.audio.createOscillator();
      src.type = 'triangle';
      src.frequency.value = 440 * 2 ** ((hauteur - 69) / 12);
    }
    src.connect(g);
    const niveau = Math.max(0.01, Math.min(1.2, 1.3 * intensite * intensite));
    const fin = quand + (pizz ? Math.max(duree, 0.7) : duree);
    g.gain.setValueAtTime(0, quand);
    g.gain.linearRampToValueAtTime(niveau, quand + 0.02);
    g.gain.setValueAtTime(niveau, fin);
    g.gain.exponentialRampToValueAtTime(0.0005, fin + 0.3);
    src.start(quand);
    src.stop(fin + 0.32);
    const ref = { src, g };
    this.actives.add(ref);
    src.onended = () => { this.actives.delete(ref); g.disconnect(); };
  }

  // Arrêt de l'orchestre : toutes les notes s'éteignent rapidement
  couper() {
    const t = this.audio.currentTime;
    for (const { src, g } of this.actives) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.3);
      try { src.stop(t + 0.35); } catch (e) { /* déjà arrêtée */ }
    }
  }

  // L'oreille suit la tête du joueur
  ecouter(position, devant, haut) {
    const l = this.audio.listener;
    if (l.positionX) {
      l.positionX.value = position.x; l.positionY.value = position.y; l.positionZ.value = position.z;
      l.forwardX.value = devant.x; l.forwardY.value = devant.y; l.forwardZ.value = devant.z;
      l.upX.value = haut.x; l.upY.value = haut.y; l.upZ.value = haut.z;
    } else {
      l.setPosition(position.x, position.y, position.z);
      l.setOrientation(devant.x, devant.y, devant.z, haut.x, haut.y, haut.z);
    }
  }
}
