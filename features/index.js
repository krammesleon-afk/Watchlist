// Zusatzfunktionen von Satho-Net, getrennt von den Watchlist-Routen in server.js.
// server.js ruft das hier einmal auf und bekommt die Hooks für Push zurück.
const mountDrop = require('./drop');
const mountParty = require('./party');
const mountSecrets = require('./secrets');
const mountPush = require('./push');

module.exports = function mountFeatures(deps) {
  mountDrop(deps);
  mountParty(deps);
  mountSecrets(deps);
  const push = mountPush(deps);
  return { push };
};
