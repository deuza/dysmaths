# Deploiement Dokploy

Cette application est prete pour un deploiement Docker sur Dokploy.

## Configuration recommandee

- Type: `Application`
- Source: votre depot Git
- Build type: `Dockerfile`
- Dockerfile path: `Dockerfile`
- Port expose: `3000`

## Variables d'environnement

- `NODE_ENV=production`
- `HOSTNAME=0.0.0.0`
- `PORT=3000`

## Commande lancee dans le conteneur

Le conteneur demarre le serveur Next.js autonome avec:

```sh
node server.js
```

## Notes

- Le build utilise `npm ci`, donc `package-lock.json` doit rester synchronise avec `package.json`.
- Le mode `standalone` de Next.js reduit le contenu a embarquer en production.
- Si vous placez l'application derriere un proxy Dokploy/Nginx, laissez le port interne sur `3000`.
