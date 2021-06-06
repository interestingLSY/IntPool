var Logger = require('./logger.js')
var Pool = require('./pool/pool.js')

module.exports = function(portalConfig,coinsConfig){
	var logger = new Logger(portalConfig,'multicoin');

	var pools = {};
	var SpawnPool = function(coinConfig){
		logger.debug('正在为货币',coinConfig.name,'创建矿池');
		pools[coinConfig.name] = new Pool(portalConfig,coinConfig);
	}

	for( var coin in coinsConfig ){
		var coinConfig = coinsConfig[coin];
		if(!coinConfig.enabled) continue;
		SpawnPool(coinConfig);
	}
}
