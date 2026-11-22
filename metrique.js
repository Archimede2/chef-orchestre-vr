// Métrique : quelle valeur de note vaut une battue du chef.
//
// Tout le reste du programme compte en noires. Ce module dit seulement combien
// de noires valent UNE battue, d'après le chiffrage lu en tête de partition :
//
//   4/4, 3/4, 2/4  -> la noire          (1 noire par battue)
//   2/2, 3/2       -> la blanche        (2 noires)
//   6/8, 9/8, 12/8 -> la noire pointée  (1,5 noire) : mesures composées, battues par groupes de 3 croches
//   5/8, 7/8, 3/8  -> la croche         (0,5 noire)
//   6/16, 9/16     -> la croche pointée (0,75 noire)
//
// Les mesures irrégulières (5/8, 7/8, 11/8) sont ici battues croche par croche.
// Un vrai chef les groupe (2+3, 3+2, 2+2+3) : c'est à régler à la main pour l'instant.

const NOMS = [
  [4, 'ronde'], [3, 'blanche pointée'], [2, 'blanche'], [1.5, 'noire pointée'],
  [1, 'noire'], [0.75, 'croche pointée'], [0.5, 'croche'],
  [0.375, 'double croche pointée'], [0.25, 'double croche'],
];

export function nomUnite(u) {
  for (const [v, nom] of NOMS) if (Math.abs(u - v) < 1e-6) return nom;
  return `${u} noire${u > 1 ? 's' : ''}`;
}

// Renvoie { unite: noires par battue, battues: battues par mesure, compose }
export function uniteDeBattue(num, den) {
  const base = 4 / den; // ce que vaut une unité du dénominateur, en noires
  if (den >= 8 && num > 3 && num % 3 === 0) {
    return { unite: base * 3, battues: num / 3, compose: true };
  }
  return { unite: base, battues: num, compose: false };
}

export function decrireChiffrage(num, den) {
  const { unite, battues, compose } = uniteDeBattue(num, den);
  return `${num}/${den} — ${battues} ${battues > 1 ? 'battues' : 'battue'} à la ${nomUnite(unite)}`
    + (compose ? ' (mesure composée)' : '');
}

// Choix proposés quand on veut imposer l'unité à la main
export const UNITES_MANUELLES = [
  ['', 'Automatique'], ['4', 'Ronde'], ['2', 'Blanche'], ['1.5', 'Noire pointée'],
  ['1', 'Noire'], ['0.75', 'Croche pointée'], ['0.5', 'Croche'], ['0.25', 'Double croche'],
];

// Chiffrage en vigueur à cet endroit de la partition (temps en noires)
export function chiffrageA(partition, temps) {
  const cs = partition?.chiffrages;
  if (!cs?.length) {
    const n = partition?.tempsParMesure || 4;
    return Number.isInteger(n) ? { num: n, den: 4 } : { num: 4, den: 4 };
  }
  let c = cs[0];
  for (const x of cs) if (x.temps <= temps + 1e-6) c = x;
  return c;
}
