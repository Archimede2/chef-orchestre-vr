// Détection du geste circulaire qui coupe l'orchestre, comme un vrai chef.
//
// On garde une fenêtre glissante des dernières positions de la main (ou de la
// pointe de la baguette) et on mesure l'angle balayé autour de leur centre.
// Une battue ordinaire descend puis remonte : elle balaie un angle, puis le
// même en sens inverse, donc la somme signée reste proche de zéro. Un cercle,
// lui, l'accumule — et il faut le boucler vite, puisque la fenêtre est courte.
//
// Deux seuils : « préavis » (on arrête de compter les temps, le geste n'est
// plus une battue) puis « arrêt » (le tour est bouclé, l'orchestre se tait).
//
// Reste le cas gênant : une battue très ronde et rapide (un 3 temps vif) finit
// par boucler un tour par mesure. D'où `reglerFenetre()` : la fenêtre se cale
// sur la mesure en cours, si bien qu'il faut toujours boucler le cercle
// nettement plus vite qu'une mesure pour qu'il compte.

export class DetecteurCercle {
  constructor({
    fenetre = 0.85,       // s : durée de la fenêtre glissante (voir reglerFenetre)
    rayonMin = 0.05,      // dans l'unité des points fournis (mètres en VR, image en webcam)
    dispersionMax = 0.3,  // écart des rayons / rayon moyen : au-delà, ce n'est pas un cercle
    toursPreavis = 0.5,
    toursArret = 0.9,
    repos = 1.2,          // s d'insensibilité après un arrêt déclenché
  } = {}) {
    Object.assign(this, { fenetre, rayonMin, dispersionMax, toursPreavis, toursArret, repos });
    this.fenetreMax = fenetre;
    this.pts = [];
    this.tours = 0;
    this.jusqua = -Infinity;
  }

  // La fenêtre suit la mesure en cours : le cercle doit être bouclé en nettement
  // moins d'une mesure, sinon une battue ronde et rapide finirait par compter.
  reglerFenetre(dureeMesure) {
    const f = dureeMesure ? Math.min(this.fenetreMax, Math.max(0.45, 0.6 * dureeMesure)) : this.fenetreMax;
    this.fenetre = f;
  }

  reinitialiser(t) {
    this.pts.length = 0;
    this.tours = 0;
    if (t != null) this.jusqua = t + this.repos;
  }

  // Renvoie { tours, preavis, arret }
  ajouter(x, y, t) {
    if (t < this.jusqua) {
      this.pts.length = 0;
      this.tours = 0;
      return { tours: 0, preavis: false, arret: false };
    }
    const dernier = this.pts[this.pts.length - 1];
    if (dernier && t - dernier.t > 0.25) this.pts.length = 0; // trou dans le suivi : on repart
    this.pts.push({ x, y, t });
    while (this.pts.length && t - this.pts[0].t > this.fenetre) this.pts.shift();

    this.tours = this.mesurer();
    const arret = this.tours >= this.toursArret;
    if (arret) this.reinitialiser(t);
    return { tours: this.tours, preavis: this.tours >= this.toursPreavis, arret };
  }

  mesurer() {
    const p = this.pts;
    if (p.length < 10) return 0;
    let cx = 0, cy = 0;
    for (const q of p) { cx += q.x; cy += q.y; }
    cx /= p.length; cy /= p.length;

    const rayons = p.map((q) => Math.hypot(q.x - cx, q.y - cy));
    const rMoy = rayons.reduce((a, b) => a + b, 0) / rayons.length;
    if (rMoy < this.rayonMin) return 0; // geste trop petit : simple tremblement

    const ecart = Math.sqrt(rayons.reduce((a, r) => a + (r - rMoy) ** 2, 0) / rayons.length);
    if (ecart / rMoy > this.dispersionMax) return 0; // forme anguleuse : une battue, pas un cercle

    let total = 0;
    let a0 = Math.atan2(p[0].y - cy, p[0].x - cx);
    for (let i = 1; i < p.length; i++) {
      const a = Math.atan2(p[i].y - cy, p[i].x - cx);
      let d = a - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      total += d;
      a0 = a;
    }
    return Math.abs(total) / (2 * Math.PI);
  }
}
