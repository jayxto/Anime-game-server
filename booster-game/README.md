# 🎴 Anime Boosters

Jeu 100 % ouverture de boosters de cartes animé, avec le même système de packs qu'Anime Game.

## Lancer
```
cd booster-game
npm start          # http://localhost:3000
```
Aucune dépendance. La partie est sauvegardée dans le navigateur (localStorage).

## Contenu
- Tous les persos d'Anime Game (124 animés) + 43 nouveaux animés (Shaman King, Saint Seiya, Ken le Survivant, Ghibli, Baki, Kingdom…)
- Raretés : Commune, Rare, Épique, Légendaire, Mythique + raretés spéciales Secrète, Divine, Cosmique, Éternelle, Oméga
- Brillantes, finitions (Holo, Reverse, Pailletée, Gold, Dark, Full Art, Manga, Galaxie, Glitch, Signée, Numérotée)
- God Pack (1/500), cartes Duo, cartes de saison (Halloween, Noël, Saint-Valentin, Été)
- Boosters : 3 cartes, 10 cartes, Épique, Mythique, Duo, saisonniers, Pack Chance (x10) et un booster par animé
- Booster gratuit toutes les 2 h, cadeau du jour avec série, vente des doublons

## Mettre à jour les cartes
- `tools/pool.json` / `tools/extra.json` : persos extraits d'Anime Game
- `tools/new-animes.json` : nouveaux animés (ajoute des persos ici, le premier = le plus connu)
- `npm run images` cherche les photos sur AniList (reprend où il s'est arrêté), puis `npm run build` régénère `public/cards.json`
