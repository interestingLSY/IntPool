var Logger = require('./../logger.js')
var Daemon = require('./daemon.js')
var Redis = require('./redis.js')
var Stratum = require('./stratum.js')

module.exports = function(portalConfig,coinConfig){
	// 注意！这里的 coinConfig 不是 coinsConfig!
	var logger = new Logger(portalConfig,coinConfig.name);

	var daemon = new Daemon(portalConfig,coinConfig);
	var redis = new Redis(portalConfig,coinConfig);
	var stratum = new Stratum(portalConfig,coinConfig);

	logger.info(coinConfig.name,'的矿池创建完毕');
}
