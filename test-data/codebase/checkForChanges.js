import { exec } from 'child_process';

function checkForChanges() {
  exec('cd /home/ysannier/Glados-Disc && git fetch', (error) => {
    if (error) {
      console.error('Erreur lors du git fetch :', error);
      return;
    }

    exec(
      'cd /home/ysannier/Glados-Disc && git rev-parse HEAD && git rev-parse @{u}',
      (error, stdout) => {
        if (error) {
          console.error('Erreur lors de la comparaison des commits :', error);
          return;
        }

        const [local, remote] = stdout.trim().split('\n');

        if (local !== remote) {
          console.log('Nouveaux commits détectés. Pull + restart...');
          exec(
            'cd /home/ysannier/Glados-Disc && git pull && pm2 restart Glados-Disc',
            (error) => {
              if (error) {
                console.error('Erreur lors du redémarrage :', error);
              } else {
                console.log('Application redémarrée avec succès.');
              }
            },
          );
        }
      },
    );
  });
}

setInterval(checkForChanges, 5000);

export { checkForChanges };

