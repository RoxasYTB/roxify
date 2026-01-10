import { EventEmitter } from 'events';

function configureClientEventLimits(client, maxListeners = 20) {
  if (!client) {
    console.warn('Client Discord non fourni pour la configuration des limites');
    return;
  }

  try {
    client.setMaxListeners(maxListeners);

    configureWebSocketShards(client, maxListeners);
  } catch (error) {
    console.error(
      'Erreur lors de la configuration des limites du client:',
      error.message,
    );
  }
}

function configureWebSocketShards(client, maxListeners = 20) {
  try {
    if (client.ws && client.ws.shards) {
      let configuredShards = 0;

      client.ws.shards.forEach((shard) => {
        if (shard && typeof shard.setMaxListeners === 'function') {
          shard.setMaxListeners(maxListeners);
          configuredShards++;
        }
      });

      if (configuredShards > 0) {
        console.log(
          `Limites configurées pour ${configuredShards} shards WebSocket`,
        );
      }
    }
  } catch (error) {
    console.warn(
      'Erreur lors de la configuration des shards WebSocket:',
      error.message,
    );
  }
}

function configureGlobalEventLimits(maxListeners = 20) {
  try {
    EventEmitter.defaultMaxListeners = maxListeners;
  } catch (error) {
    console.error('Erreur lors de la configuration globale:', error.message);
  }
}

function monitorEventListeners(client) {
  if (!client) return;

  try {
    const clientListeners =
      client.listenerCount ?
        client.eventNames().reduce((acc, eventName) => {
          acc[eventName] = client.listenerCount(eventName);
          return acc;
        }, {})
      : {};

    console.log("Utilisation des écouteurs d'événements:", {
      client: clientListeners,
      webSocketShards: client.ws?.shards?.size || 0,
    });
  } catch (error) {
    console.warn('Erreur lors du monitoring des écouteurs:', error.message);
  }
}

export {
  configureClientEventLimits,
  configureGlobalEventLimits,
  configureWebSocketShards,
  monitorEventListeners,
};

