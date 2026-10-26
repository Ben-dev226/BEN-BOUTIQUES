/** Modèles de boutique : des mises en page différentes (en-tête, accueil, cartes produit), pas seulement des couleurs. */
export type Template = { id: string; label: string; tagline: string; best: string };
export const TEMPLATES: Template[] = [
  { id: 'classique', label: 'Classique', tagline: 'Grand bandeau d\'accueil, grille de 4 produits, tout visible d\'un coup', best: 'Boutiques généralistes, mode, accessoires' },
  { id: 'vitrine', label: 'Vitrine', tagline: 'En-tête centré, accueil aéré, photos en hauteur sans cadre', best: 'Mode, beauté, bijoux : quand les photos font vendre' },
  { id: 'catalogue', label: 'Catalogue', tagline: 'Liste compacte photo à gauche, prix en évidence, recherche en premier', best: 'Beaucoup de produits, alimentation, pièces, grossistes' },
  { id: 'minimal', label: 'Éditorial', tagline: 'Beaucoup d\'espace, grand titre, 3 colonnes, lignes fines', best: 'Marques haut de gamme, petite sélection' },
  { id: 'mobile', label: 'Lien en bio', tagline: 'Une colonne façon profil : avatar, boutons WhatsApp, cartes larges', best: 'Vendeurs Instagram, TikTok, WhatsApp, 100 % téléphone' },
];
export const templateOf = (id: string | undefined) => (TEMPLATES.some(t => t.id === id) ? id! : 'classique');
