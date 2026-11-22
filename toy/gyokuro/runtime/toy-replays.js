importScripts("./game-services.js");

const createReplayServices = self.createEasyRpgGameServices;
self.createEasyRpgGameServices = workId => createReplayServices(workId, self.toyGyokuroReplay);
