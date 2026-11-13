// Chef d'orchestre VR — Proto 1 : la battue
// Objectif : détecter la battue à la manette droite, faire partir un métronome
// sur la 3e battue (levée), suivre le tempo, puis ralentir et s'arrêter si
// le chef arrête de battre. Bonus : regard par la tête sur les pupitres.

import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// ---------------------------------------------------------------- Réglages
const REGLAGES = {
  vitesseDescente: 0.35,   // m/s vers le bas pour armer un temps
  intervalleMin: 0.25,     // s entre deux temps détectés
  intervalleMaxLevee: 2.0, // s : au-delà, la levée recommence
  tempsLeveeAvantDepart: 2,// battues à vide ; départ sur la suivante
  suiviTempo: 0.5,         // 0..1 : à quel point le tempo suit le geste
  suiviPhase: 0.5,         // 0..1 : à quel point on se recale sur le geste
  tempsSansBattue: 3,      // temps sans battue avant ralenti
  tempsRalenti: 3,         // temps de ralenti avant arrêt
  angleRegard: 14,         // degrés : cône de visée de la tête
};

// ---------------------------------------------------------------- Scène
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101018);
scene.fog = new THREE.Fog(0x101018, 8, 18);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 1.6, 0);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x202030, 1.2));
const spot = new THREE.DirectionalLight(0xffffff, 1.2);
spot.position.set(0, 6, 2);
scene.add(spot);

// Sol et estrade
const sol = new THREE.Mesh(
  new THREE.CircleGeometry(12, 64),
  new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.9 })
);
sol.rotation.x = -Math.PI / 2;
scene.add(sol);

const estrade = new THREE.Mesh(
  new THREE.CylinderGeometry(0.6, 0.6, 0.02, 32),
  new THREE.MeshStandardMaterial({ color: 0x6b4a2f })
);
estrade.position.y = 0.01;
scene.add(estrade);

// Anneau qui pulse sur les temps du métronome
const anneau = new THREE.Mesh(
  new THREE.RingGeometry(0.8, 0.86, 64),
  new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
);
anneau.rotation.x = -Math.PI / 2;
anneau.position.set(0, 0.03, -1.6);
scene.add(anneau);
let pulseAnneau = 0;

// ---------------------------------------------------------------- Pupitres (Pavane de Fauré)
function carton(nom) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2ead8';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#8a6a3e'; g.lineWidth = 10;
  g.strokeRect(5, 5, 502, 246);
  g.fillStyle = '#2a1d10';
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(nom, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const panneau = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), mat);
  const groupe = new THREE.Group();
  const pied = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 1, 8),
    new THREE.MeshStandardMaterial({ color: 0x222222 })
  );
  pied.position.y = -0.5;
  groupe.add(pied, panneau);
  return { nom, groupe, panneau, attention: 0 };
}

const pupitres = [];
function placerEnArc(noms, rayon, hauteur, ouvertureDeg) {
  noms.forEach((nom, i) => {
    const p = carton(nom);
    const t = noms.length === 1 ? 0.5 : i / (noms.length - 1);
    const a = THREE.MathUtils.degToRad(-ouvertureDeg / 2 + t * ouvertureDeg);
    p.groupe.position.set(Math.sin(a) * rayon, hauteur, -Math.cos(a) * rayon);
    p.groupe.lookAt(0, hauteur, 0);
    scene.add(p.groupe);
    pupitres.push(p);
  });
}
placerEnArc(['Violons I', 'Violons II', 'Altos', 'Violoncelles', 'Contrebasses'], 2.6, 1.2, 120);
placerEnArc(['Flûtes', 'Hautbois', 'Clarinettes', 'Bassons'], 4.0, 1.6, 60);
placerEnArc(['Cors'], 5.2, 2.0, 0);

// ---------------------------------------------------------------- Panneau d'infos
const hudCanvas = document.createElement('canvas');
hudCanvas.width = 1024; hudCanvas.height = 384;
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(
  new THREE.PlaneGeometry(1.6, 0.6),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true })
);
hud.position.set(0, 2.9, -3.2);
hud.lookAt(0, 1.6, 0);
scene.add(hud);

let hudTexte = '';
function majHud(lignes) {
  const texte = lignes.join('\n');
  if (texte === hudTexte) return;
  hudTexte = texte;
  const g = hudCanvas.getContext('2d');
  g.clearRect(0, 0, 1024, 384);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, 1024, 384);
  g.fillStyle = '#ffd27a';
  g.font = 'bold 44px system-ui, sans-serif';
  g.fillText(lignes[0], 30, 60);
  g.fillStyle = '#e8e6df';
  g.font = '38px system-ui, sans-serif';
  lignes.slice(1).forEach((l, i) => g.fillText(l, 30, 125 + i * 55));
  hudTex.needsUpdate = true;
}

// ---------------------------------------------------------------- Audio
const audio = new (window.AudioContext || window.webkitAudioContext)();
function reveilAudio() { if (audio.state !== 'running') audio.resume(); }
addEventListener('pointerdown', reveilAudio);
addEventListener('keydown', reveilAudio);
renderer.xr.addEventListener('sessionstart', reveilAudio);

function clic(quand, freq, fort = 0.4) {
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, quand);
  g.gain.linearRampToValueAtTime(fort, quand + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, quand + 0.08);
  o.connect(g).connect(audio.destination);
  o.start(quand);
  o.stop(quand + 0.1);
}

// ---------------------------------------------------------------- Baguette (manette droite)
const baguette = new THREE.Group();
const tige = new THREE.Mesh(
  new THREE.CylinderGeometry(0.004, 0.007, 0.4, 8),
  new THREE.MeshStandardMaterial({ color: 0xf5f0e6 })
);
tige.rotation.x = -Math.PI / 2;
tige.position.z = -0.2;
const pointe = new THREE.Mesh(
  new THREE.SphereGeometry(0.012, 12, 12),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
pointe.position.z = -0.4;
baguette.add(tige, pointe);
let flashPointe = 0;

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  ctrl.addEventListener('connected', (e) => {
    if (e.data.handedness === 'right') ctrl.add(baguette);
  });
  ctrl.addEventListener('disconnected', () => {
    if (baguette.parent === ctrl) ctrl.remove(baguette);
  });
  scene.add(ctrl);
}

// ---------------------------------------------------------------- Détection de la battue
// Un temps (ictus) = le point bas du geste : la pointe descendait assez vite
// puis remonte.
const posPointe = new THREE.Vector3();
let yPrec = null, vy = 0, enDescente = false;
let yHaut = -Infinity, amplitude = 0;
let dernierIctus = -Infinity;

function suivreBaguette(t, dt) {
  if (!baguette.parent || dt <= 0) { yPrec = null; return; }
  pointe.getWorldPosition(posPointe);
  if (yPrec === null) { yPrec = posPointe.y; return; }
  const vInst = (posPointe.y - yPrec) / dt;
  yPrec = posPointe.y;
  vy += (vInst - vy) * 0.5;
  yHaut = Math.max(yHaut, posPointe.y);
  if (vy < -REGLAGES.vitesseDescente) enDescente = true;
  if (enDescente && vy > 0) {
    enDescente = false;
    if (t - dernierIctus > REGLAGES.intervalleMin) {
      amplitude = Math.max(0, yHaut - posPointe.y);
      yHaut = posPointe.y;
      ictus(t);
    }
  }
}

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); reveilAudio(); amplitude = 0; ictus(audio.currentTime); }
});

// ---------------------------------------------------------------- Le « chef » : levée, tempo, arrêt
let etat = 'attente';        // attente | jeu | ralenti
let leveeTemps = [];          // instants des battues à vide
let periode = 0.8;            // s par temps
let prochainTemps = 0;        // instant du prochain temps programmé
let tempsJoues = 0;
let decalageMs = 0;
let tempsProgrammes = [];     // pour synchroniser l'image sur le son
let tempsRalentiFaits = 0;

function ictus(t) {
  dernierIctus = t;
  flashPointe = 1;

  if (etat === 'attente') {
    if (leveeTemps.length && t - leveeTemps[leveeTemps.length - 1] > REGLAGES.intervalleMaxLevee) {
      leveeTemps = [];
    }
    leveeTemps.push(t);
    if (leveeTemps.length <= REGLAGES.tempsLeveeAvantDepart) {
      clic(t, 520, 0.25); // battue à vide : petit clic grave
      return;
    }
    // Départ sur la battue suivante
    const ecarts = leveeTemps.slice(1).map((v, i) => v - leveeTemps[i]);
    periode = ecarts.reduce((a, b) => a + b, 0) / ecarts.length;
    etat = 'jeu';
    tempsJoues = 0;
    leveeTemps = [];
    prochainTemps = t;
    ictus.dernier = t;
    decalageMs = 0;
    programmer();
    return;
  }

  // En jeu ou en ralenti : on suit le chef
  if (etat === 'ralenti') { etat = 'jeu'; tempsRalentiFaits = 0; }
  const precedent = prochainTemps - periode;
  const plusProche = Math.abs(t - precedent) < Math.abs(t - prochainTemps) ? precedent : prochainTemps;
  const erreur = t - plusProche;
  decalageMs = Math.round(erreur * 1000);
  const intervalle = t - (ictus.dernier ?? t - periode);
  if (intervalle > periode * 0.5 && intervalle < periode * 2) {
    periode += (intervalle - periode) * REGLAGES.suiviTempo;
  }
  prochainTemps += erreur * REGLAGES.suiviPhase;
  ictus.dernier = t;
}

function programmer() {
  const maintenant = audio.currentTime;
  while (etat !== 'attente' && prochainTemps < maintenant + 0.1) {
    let quand = Math.max(prochainTemps, maintenant);
    if (etat === 'ralenti') quand += (Math.random() - 0.5) * 0.06; // le décalage
    const premier = tempsJoues === 0;
    clic(quand, premier ? 1320 : 990, premier ? 0.5 : 0.35);
    tempsProgrammes.push(quand);
    tempsJoues++;

    if (etat === 'jeu' && prochainTemps - dernierIctus > periode * REGLAGES.tempsSansBattue) {
      etat = 'ralenti';
      tempsRalentiFaits = 0;
    }
    if (etat === 'ralenti') {
      tempsRalentiFaits++;
      periode *= 1.15;
      if (tempsRalentiFaits >= REGLAGES.tempsRalenti) {
        etat = 'attente';
        ictus.dernier = undefined;
        break;
      }
    }
    prochainTemps += periode;
  }
}

// ---------------------------------------------------------------- Regard (orientation de la tête)
const dirTete = new THREE.Vector3();
const posTete = new THREE.Vector3();
const versPupitre = new THREE.Vector3();
let pupitreRegarde = null;

function suivreRegard(dt) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(posTete);
  cam.getWorldDirection(dirTete);
  let meilleur = null, meilleurAngle = Infinity;
  for (const p of pupitres) {
    p.panneau.getWorldPosition(versPupitre).sub(posTete).normalize();
    const angle = THREE.MathUtils.radToDeg(dirTete.angleTo(versPupitre));
    if (angle < meilleurAngle) { meilleurAngle = angle; meilleur = p; }
  }
  pupitreRegarde = meilleurAngle < REGLAGES.angleRegard ? meilleur : null;
  for (const p of pupitres) {
    const cible = p === pupitreRegarde ? 1 : 0;
    const vitesse = cible > p.attention ? 4 : 1.2; // monte vite, redescend doucement
    p.attention += (cible - p.attention) * Math.min(1, dt * vitesse);
    const l = 0.35 + 0.65 * p.attention;
    p.panneau.material.color.setRGB(l, l, l);
    p.groupe.scale.setScalar(1 + 0.12 * p.attention);
  }
}

// Sur ordinateur : la souris oriente la tête
addEventListener('mousemove', (e) => {
  if (renderer.xr.isPresenting) return;
  camera.rotation.y = -(e.clientX / innerWidth - 0.5) * 2.2;
  camera.rotation.x = -(e.clientY / innerHeight - 0.5) * 0.8;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- Boucle
const NOMS_ETAT = { attente: 'En attente de la levée', jeu: 'L’orchestre joue', ralenti: 'Ralenti, puis arrêt' };
let tPrec = audio.currentTime;
let tHorloge = performance.now();

renderer.setAnimationLoop(() => {
  const maintenantMs = performance.now();
  const dt = (maintenantMs - tHorloge) / 1000;
  tHorloge = maintenantMs;
  const t = audio.currentTime;

  suivreBaguette(t, t - tPrec || dt);
  tPrec = t;
  programmer();
  suivreRegard(dt);

  // L'image suit le son : l'anneau pulse quand un temps sonne
  while (tempsProgrammes.length && tempsProgrammes[0] <= t) {
    tempsProgrammes.shift();
    pulseAnneau = 1;
  }
  pulseAnneau = Math.max(0, pulseAnneau - dt * 5);
  anneau.material.opacity = 0.15 + 0.85 * pulseAnneau;
  anneau.scale.setScalar(1 + 0.15 * pulseAnneau);

  flashPointe = Math.max(0, flashPointe - dt * 6);
  pointe.material.color.setRGB(1, 1 - 0.6 * flashPointe, 1 - flashPointe);
  pointe.scale.setScalar(1 + 1.5 * flashPointe);

  const leveeTxt = etat === 'attente'
    ? `Levée : ${leveeTemps.length} / ${REGLAGES.tempsLeveeAvantDepart} battues à vide`
    : `Temps joués : ${tempsJoues}`;
  majHud([
    NOMS_ETAT[etat],
    `Tempo : ${etat === 'attente' ? '—' : Math.round(60 / periode) + ' BPM'}`,
    leveeTxt,
    `Décalage geste / temps : ${etat === 'attente' ? '—' : decalageMs + ' ms'}   Amplitude : ${Math.round(amplitude * 100)} cm`,
    `Regard : ${pupitreRegarde ? pupitreRegarde.nom : '—'}`,
  ]);

  renderer.render(scene, camera);
});
