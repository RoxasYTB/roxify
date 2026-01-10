<p align="center">
  <img src="assets/glados_happy.png" alt="GLaDOS Bot Logo" width="180"/>
</p>

<p align="center">
<a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E=18.17.0-green?logo=node.js" alt="Node.js"></a>

<a href="https://www.npmjs.com/"><img src="https://img.shields.io/badge/npm-%3E=9.6.0-red?logo=npm" alt="npm"></a> <a href="https://github.com/RoxasYTB/Glados-Disc"><img src="https://img.shields.io/badge/Made%20with-JavaScript-yellow?logo=javascript" alt="JavaScript"></a> <a href="https://github.com/RoxasYTB/Glados-Disc"><img src="https://img.shields.io/badge/Discord.js-%5E15.0.0-blueviolet?logo=discord" alt="discord.js"></a> <a href="https://github.com/RoxasYTB/Glados-Disc"><img src="https://img.shields.io/badge/Contributions-Welcome-brightgreen" alt="Contributions"></a>

</p>

# GLaDOS Discord Bot

> Un bot Discord multifonctionnel inspiré de GLaDOS (Portal), conçu pour la gestion avancée, la modération et l'automatisation sur vos serveurs Discord.

---

## Table des matières

- [Fonctionnalités détaillées](#fonctionnalités-détaillées)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Lancement](#lancement)
- [Structure du projet](#structure-du-projet)
- [Déploiement en production](#déploiement-en-production)
- [Dépannage](#dépannage)
- [Contribution](#contribution)
- [Licence](#licence)
- [Liens utiles](#liens-utiles)

---

## Fonctionnalités détaillées

### 👥 Gestion des utilisateurs

- Renommer les membres
- Réinitialiser les pseudos
- Bannir / Débannir
- Expulser
- Mute / Unmute

### 💬 Gestion des salons

- Créer / Supprimer des salons textuels et catégories
- Créer / Supprimer des salons vocaux
- Renommer / Déplacer
- Configurer le mode lent
- Verrouiller / Déverrouiller
- Synchroniser les permissions des salons avec une catégorie
- Purger les salons
- Purger tous les salons
- Créer un système de logs
- Configurer un salon vocal pour créer des vocaux temporaires
- Changer la police d'écriture de tous les salons d'un serveur

### ⚜️ Gestion des rôles

- Créer / Supprimer des rôles
- Renommer / Changer la couleur
- Attribuer / Retirer des rôles
- Ajouter un rôle à tous les membres du serveur
- Retirer un rôle à tous les membres du serveur
- Configurer le menu de sélection de rôles
- Configurer des rôles automatiques

### 🛠️ Systèmes spéciaux

- Règlement personnalisé avec rôle optionnel
- Système de candidature (formulaire, validation, suivi)
- Système de tickets (support, logs, transcript)
- Système de vérification avec rôle
- Menu de sélection de rôles
- Créer un système de giveaway

### 🎙️ Vocal

- Parler dans les salons vocaux (présence du bot requise)
- Création de vocaux temporaires personnalisés

### 💬 Gestion des messages

- Créer des embeds personnalisés
- Créer des citations
- Générer des images
- Créer une annonce avec l'IA
- Supprimer des messages
- Envoyer des messages
- Créer des sondages

### 🔄 Gestion du serveur

- Sauvegarder les salons d'un serveur
- Restaurer les salons d'un serveur
- Configurer les messages d'arrivée/départ
- Renommer le serveur
- Copier les émojis et stickers d'un serveur
- Changer la police d'écriture de tous les salons
- Changer le style du serveur (préréglages)

### 🛡️ Sécurité & Anti-Raid

- Protection anti-raid automatique (création/suppression massive de salons, bans, etc.)
- Protection anti-nuke
- Protection intelligente des webhooks (bots vérifiés/whitelistés)
- Logs détaillés et alertes
- Système de whitelist/blacklist bots
- Surveillance et neutralisation des bots malveillants
- Restauration automatique du serveur après attaque
- Monitoring de performance anti-raid
- Validation et nettoyage automatique des permissions
- Système de rapport d'activité et de recommandations de sécurité

### 📋 Systèmes avancés

- Gestion des tickets et candidatures (multi-langues, logs, transcripts)
- Menus d'interaction (boutons, menus déroulants)
- Gestion des permissions avancées
- Système de logs personnalisable
- Gestion des backups et restaurations
- Commandes contextuelles et dot-commands
- Prise en charge multilingue (locales)
- Extensible et personnalisable

### ❓ Aide & Utilitaires

- Menu d'aide interactif
- Liste complète des commandes et actions
- Commandes utilitaires (statistiques, permissions, etc.)

---

## Prérequis

- **Node.js** v18.17.0 ou supérieur
- **npm** v9.6.0 ou supérieur
- Un compte développeur Discord avec un bot créé

## Installation

1. **Clonez le dépôt :**
   ```bash
   git clone https://github.com/Aperture-Sciences-by-Alfycore/Glados-Disc
   cd Glados-Disc
   ```
2. **Installez les dépendances :**
   ```bash
   npm install
   ```

## Configuration

1. **Variables d'environnement :**

   - Rendez-vous dans le dossier `config/` à la racine du projet.
   - Copiez le fichier `.env.example` en `.env`.
    ```bash
    cp config/.env.example config/.env
    ```
   - Ouvrez .env et remplissez les valeurs nécessaires.

2. **Fichiers de configuration :**

   - `config/config.js` : constantes, IDs, URLs, textes, mots-clés
   - `config/serverTemplate.json` : structure serveur par défaut
   - `utils/list.js` : permissions des commandes
   - `whitelist.json` & `blacklist.json` : gestion des accès

## Lancement

- **Démarrage classique :**
  ```bash
  node index.js
  ```
- **Avec PM2 (production) :**
  ```bash
  npm install -g pm2
  pm2 start index.js --name "Glados-Disc"
  pm2 startup
  pm2 save
  ```

## Structure du projet

```
Glados-Disc/
├── commands/           # Commandes du bot (par catégorie)
├── config/             # Configurations et variables d'environnement
├── events/             # Gestionnaires d'événements Discord
├── interactions/       # Gestionnaires d'interactions (boutons, menus, etc.)
├── locales/            # Fichiers de traduction
├── managers/           # Gestionnaires de fonctionnalités
├── utils/              # Fonctions utilitaires
├── assets/             # Images et ressources
├── index.js            # Point d'entrée principal
├── ...
```

## Déploiement en production

- Utilisez [PM2](https://pm2.keymetrics.io/) pour la gestion des processus et le redémarrage automatique.
- Pensez à sécuriser vos tokens et à limiter l'accès aux fichiers sensibles.

## Dépannage

- **Le bot ne démarre pas ?**
  - Vérifiez le token Discord dans `config/.env`
  - Vérifiez les intents dans le portail Discord
  - Consultez les logs pour plus de détails
- **Problèmes de permissions ?**
  - Le bot requiert `ADMINISTRATOR` ou des permissions spécifiques selon les fonctionnalités
  - Activez les intents privilégiés dans le portail Discord

## Contribution

Les contributions sont les bienvenues !

- Ouvrez une _issue_ pour signaler un bug ou suggérer une amélioration
- Proposez une _pull request_ pour contribuer au code
- Merci de respecter le style de code et la structure du projet

## Licence

Ce projet est sous licence [MIT](LICENSE).

## Liens utiles

- [Documentation Discord.js](https://discord.js.org/)
- [Créer une application Discord](https://discord.com/developers/applications)
- [PM2 - Gestionnaire de processus Node.js](https://pm2.keymetrics.io/)
- [Aide sur la configuration des webhooks](docs/WEBHOOK_CONFIGURATION.md)

---

<p align="center"><i>Made with ❤️ by RoxasYTB & contributors</i></p>
